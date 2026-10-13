import { createHash, randomBytes } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { inject, injectable } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import {
  PLATFORM_TOKENS,
  type IHarnessProposalStore,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import {
  mergeHarnessConfigUpdates,
  type HarnessConfig,
  type HarnessProposal,
} from '@ptah-extension/shared';
import { HarnessProposalSchema } from '@ptah-extension/shared/schemas';

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const LOCK_STALE_MS = 5_000;
const LOCK_WAIT_MS = 1_000;
const LOCK_RETRY_MS = 25;

export class HarnessProposalWorkspaceError extends Error {
  readonly code = 'HARNESS_PROPOSAL_NO_WORKSPACE';

  constructor() {
    super('No workspace folder open for harness proposal storage.');
    this.name = 'HarnessProposalWorkspaceError';
  }
}

export class HarnessProposalLockError extends Error {
  readonly code = 'HARNESS_PROPOSAL_LOCK_TIMEOUT';

  constructor() {
    super('Timed out waiting for the harness proposal lock.');
    this.name = 'HarnessProposalLockError';
  }
}

function isErrno(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null &&
    'code' in error && error.code === code;
}

@injectable()
export class HarnessProposalStore implements IHarnessProposalStore {
  private static readonly queues = new Map<string, Promise<void>>();

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspaceProvider: IWorkspaceProvider,
  ) {}

  async save(
    sessionId: string,
    update: Partial<HarnessConfig>,
    complete: boolean,
  ): Promise<HarnessProposal> {
    const root = this.requireRoot();
    const directory = this.directory(root);
    const file = this.file(directory, sessionId);
    const previous = HarnessProposalStore.queues.get(file) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(async () => {
      await fs.mkdir(directory, { recursive: true });
      await this.prune(directory);
      const release = await this.acquireLock(`${file}.lock`);
      try {
        const current = await this.read(file, root, sessionId);
        const proposal: HarnessProposal = {
          version: 1,
          workspaceRoot: root,
          sessionId,
          configUpdates: mergeHarnessConfigUpdates(
            current?.configUpdates ?? {},
            mergeHarnessConfigUpdates({}, update),
          ),
          isConfigComplete: complete,
          updatedAt: new Date().toISOString(),
        };
        const validated = HarnessProposalSchema.parse(proposal);
        await this.write(file, validated);
        return validated;
      } finally {
        await release();
      }
    });
    const tail = operation.then(() => undefined, () => undefined);
    HarnessProposalStore.queues.set(file, tail);
    void tail.then(() => {
      if (HarnessProposalStore.queues.get(file) === tail) {
        HarnessProposalStore.queues.delete(file);
      }
    });
    return operation;
  }

  async get(sessionId: string): Promise<HarnessProposal | null> {
    const root = this.requireRoot();
    const directory = this.directory(root);
    await this.prune(directory);
    return this.read(this.file(directory, sessionId), root, sessionId);
  }

  private requireRoot(): string {
    const root = this.workspaceProvider.getWorkspaceRoot();
    if (!root) throw new HarnessProposalWorkspaceError();
    return root;
  }

  private directory(root: string): string {
    return path.join(root, '.ptah', 'harness', 'proposals');
  }

  private file(directory: string, sessionId: string): string {
    const name = createHash('sha256').update(sessionId).digest('hex');
    return path.join(directory, `${name}.json`);
  }

  private async read(
    file: string,
    root: string,
    sessionId: string,
  ): Promise<HarnessProposal | null> {
    let contents: string;
    try {
      contents = await fs.readFile(file, 'utf8');
    } catch (error: unknown) {
      if (isErrno(error, 'ENOENT')) return null;
      throw error;
    }
    try {
      const result = HarnessProposalSchema.safeParse(JSON.parse(contents));
      if (
        !result.success ||
        result.data.sessionId !== sessionId ||
        result.data.workspaceRoot !== root
      ) {
        this.logger.warn('Ignoring invalid harness proposal record', { file });
        return null;
      }
      return result.data;
    } catch {
      this.logger.warn('Ignoring corrupt harness proposal record', { file });
      return null;
    }
  }

  private async acquireLock(file: string): Promise<() => Promise<void>> {
    const deadline = Date.now() + LOCK_WAIT_MS;
    while (true) {
      try {
        const handle = await fs.open(file, 'wx');
        try {
          await handle.close();
        } catch (error: unknown) {
          await fs.unlink(file).catch(() => undefined);
          throw error;
        }
        return async () => {
          await fs.unlink(file);
        };
      } catch (error: unknown) {
        if (!isErrno(error, 'EEXIST')) throw error;
        try {
          const stat = await fs.stat(file);
          if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
            await fs.unlink(file);
            continue;
          }
        } catch (statError: unknown) {
          if (!isErrno(statError, 'ENOENT')) throw statError;
          continue;
        }
        if (Date.now() >= deadline) throw new HarnessProposalLockError();
        await new Promise<void>((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
      }
    }
  }

  private async write(file: string, proposal: HarnessProposal): Promise<void> {
    const temp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      await fs.writeFile(temp, JSON.stringify(proposal), { flag: 'wx' });
      await fs.rename(temp, file);
    } catch (error: unknown) {
      await fs.unlink(temp).catch(() => undefined);
      throw error;
    }
  }

  private async prune(directory: string): Promise<void> {
    try {
      const names = await fs.readdir(directory);
      const cutoff = Date.now() - RETENTION_MS;
      for (const name of names) {
        if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
        const file = path.join(directory, name);
        try {
          await fs.access(`${file}.lock`);
          continue;
        } catch (error: unknown) {
          if (!isErrno(error, 'ENOENT')) throw error;
        }
        try {
          const record = HarnessProposalSchema.safeParse(
            JSON.parse(await fs.readFile(file, 'utf8')),
          );
          if (record.success && Date.parse(record.data.updatedAt) < cutoff) {
            await fs.unlink(file);
          }
        } catch (error: unknown) {
          if (!isErrno(error, 'ENOENT')) throw error;
        }
      }
    } catch (error: unknown) {
      if (!isErrno(error, 'ENOENT')) {
        this.logger.warn('Could not prune harness proposal records', { directory });
      }
    }
  }
}
