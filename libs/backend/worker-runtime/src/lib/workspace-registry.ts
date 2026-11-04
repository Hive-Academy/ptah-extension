import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { basename } from 'node:path';
import { ensureWorkerDirectory, WorkerPaths } from './paths';
import { writeJsonAtomic } from './atomic-file';
import { withFileLock } from './file-lock';

export interface RegisteredWorkspace {
  workspaceId: string;
  name: string;
  path: string;
}

export class UnknownWorkspaceError extends Error {
  readonly code = 'UNKNOWN_WORKSPACE';
  constructor() {
    super('Unknown workspace');
    this.name = 'UnknownWorkspaceError';
  }
}

/**
 * The worker's workspace file. Writers take the file lock and reload under
 * it, so the running service and an offline `workspace` command never drop
 * each other's changes.
 */
export class WorkspaceRegistry {
  private workspaces: RegisteredWorkspace[] = [];

  constructor(private readonly paths: WorkerPaths) {}

  async load(): Promise<void> {
    try {
      const value: unknown = JSON.parse(
        await readFile(this.paths.workspaces, 'utf8'),
      );
      if (!Array.isArray(value) || !value.every(isWorkspace)) {
        throw new Error('Invalid worker workspace registry');
      }
      this.workspaces = value;
    } catch (error) {
      if (!isMissing(error)) throw error;
      this.workspaces = [];
    }
  }

  list(): RegisteredWorkspace[] {
    return this.workspaces.map((workspace) => ({ ...workspace }));
  }

  /** Whether the workspace ID is registered now. */
  has(workspaceId: string): boolean {
    return this.workspaces.some((item) => item.workspaceId === workspaceId);
  }

  /** Maps registered workspace IDs or paths to IDs; any other value throws. */
  resolveIds(values: readonly string[]): string[] {
    return values.map((value) => {
      const found = this.workspaces.find(
        (item) => item.workspaceId === value || item.path === value,
      );
      if (!found) throw new UnknownWorkspaceError();
      return found.workspaceId;
    });
  }

  async register(path: string): Promise<RegisteredWorkspace> {
    const canonical = await realpath(path);
    const workspace: RegisteredWorkspace = {
      workspaceId: `ws_${createHash('sha256').update(canonical).digest('hex').slice(0, 12)}`,
      name: basename(canonical),
      path: canonical,
    };
    await this.mutate((workspaces) => [
      ...workspaces.filter(
        (item) => item.workspaceId !== workspace.workspaceId,
      ),
      workspace,
    ]);
    return { ...workspace };
  }

  /**
   * Removes a workspace by ID or path (a path is also matched after
   * `realpath`). Returns the removed entry, or undefined when none matched.
   */
  async unregister(idOrPath: string): Promise<RegisteredWorkspace | undefined> {
    const canonical = await realpath(idOrPath).catch((error: unknown) => {
      if (isMissing(error)) return idOrPath;
      throw error;
    });
    let removed: RegisteredWorkspace | undefined;
    await this.mutate((workspaces) => {
      removed = workspaces.find(
        (item) =>
          item.workspaceId === idOrPath ||
          item.path === idOrPath ||
          item.path === canonical,
      );
      return workspaces.filter((item) => item !== removed);
    });
    return removed && { ...removed };
  }

  private async mutate(
    change: (workspaces: RegisteredWorkspace[]) => RegisteredWorkspace[],
  ): Promise<void> {
    await ensureWorkerDirectory(this.paths);
    await withFileLock(this.paths.workspaces, async () => {
      await this.load();
      const next = change(this.list());
      await writeJsonAtomic(this.paths.workspaces, next);
      this.workspaces = next;
    });
  }
}

function isWorkspace(value: unknown): value is RegisteredWorkspace {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as RegisteredWorkspace).workspaceId === 'string' &&
    typeof (value as RegisteredWorkspace).name === 'string' &&
    typeof (value as RegisteredWorkspace).path === 'string'
  );
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}
