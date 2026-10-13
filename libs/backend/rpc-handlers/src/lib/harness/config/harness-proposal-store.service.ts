import { createHash, randomBytes } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { inject, injectable } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import { serializeByKey, withFileLock } from '@ptah-extension/harness-sync';
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
import {
  HarnessProposalSchema,
  HarnessSessionIdSchema,
} from '@ptah-extension/shared/schemas';

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
// Far above the one-read, merge, temp-write and rename critical section.
const PROPOSAL_LOCK_STALE_MS = 10_000;
// Longer than stale, so a crashed process's lock is broken within one call.
const PROPOSAL_LOCK_WAIT_MS = 12_000;

export class HarnessProposalWorkspaceError extends Error {
  readonly code = 'HARNESS_PROPOSAL_NO_WORKSPACE';

  constructor() {
    super('No workspace folder open for harness proposal storage.');
    this.name = 'HarnessProposalWorkspaceError';
  }
}

function isErrno(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === code
  );
}

@injectable()
/**
 * Stores proposals under the workspace provider's root, merging each update.
 * Rejects with HarnessProposalWorkspaceError (HARNESS_PROPOSAL_NO_WORKSPACE),
 * ZodError for an invalid session id, FileLockTimeoutError from
 * @ptah-extension/harness-sync on contention, or a file system error.
 */
export class HarnessProposalStore implements IHarnessProposalStore {
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
    sessionId = HarnessSessionIdSchema.parse(sessionId);
    const root = this.requireRoot();
    const directory = this.directory(root);
    const file = this.file(directory, sessionId);
    return serializeByKey(file, async () => {
      await fs.mkdir(directory, { recursive: true });
      await this.prune(directory);
      return withFileLock(
        `${file}.lock`,
        async () => {
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
        },
        {
          staleAfterMs: PROPOSAL_LOCK_STALE_MS,
          maxWaitMs: PROPOSAL_LOCK_WAIT_MS,
        },
      );
    });
  }

  async get(sessionId: string): Promise<HarnessProposal | null> {
    sessionId = HarnessSessionIdSchema.parse(sessionId);
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
      // degradation-audit: reported - a corrupt record (unparseable JSON) is
      // logged as a warning and read as "no proposal", so the next save
      // replaces it instead of failing the session.
      this.logger.warn('Ignoring corrupt harness proposal record', { file });
      return null;
    }
  }

  private async write(file: string, proposal: HarnessProposal): Promise<void> {
    const temp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      await fs.writeFile(temp, JSON.stringify(proposal), { flag: 'wx' });
      await fs.rename(temp, file);
    } catch (error: unknown) {
      // degradation-audit: optional-capability - best-effort removal of the
      // temp file; the original write or rename error is rethrown below.
      await fs.unlink(temp).catch(() => undefined);
      throw error;
    }
  }

  private async prune(directory: string): Promise<void> {
    let names: string[];
    try {
      names = await fs.readdir(directory);
    } catch (error: unknown) {
      // degradation-audit: reported - a readdir failure other than ENOENT is
      // logged as a warning and this prune pass is skipped; save and get
      // continue, and the next call retries the prune.
      if (!isErrno(error, 'ENOENT')) {
        this.logger.warn('Could not prune harness proposal records', {
          directory,
        });
      }
      return;
    }
    const cutoff = Date.now() - RETENTION_MS;
    for (const name of names) {
      if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
      const file = path.join(directory, name);
      try {
        try {
          await fs.access(`${file}.lock`);
          continue;
        } catch (error: unknown) {
          if (!isErrno(error, 'ENOENT')) throw error;
        }
        let valid = false;
        try {
          const record = HarnessProposalSchema.safeParse(
            JSON.parse(await fs.readFile(file, 'utf8')),
          );
          valid = record.success;
          if (record.success && Date.parse(record.data.updatedAt) < cutoff)
            await fs.unlink(file);
        } catch (error: unknown) {
          if (isErrno(error, 'ENOENT')) continue;
          if (!(error instanceof SyntaxError)) throw error;
        }
        if (!valid) {
          this.logger.warn(
            'Ignoring invalid harness proposal record during prune',
            { file },
          );
          if ((await fs.stat(file)).mtimeMs < cutoff) await fs.unlink(file);
        }
      } catch (error: unknown) {
        if (!isErrno(error, 'ENOENT'))
          this.logger.warn('Could not prune harness proposal record', { file });
      }
    }
  }
}
