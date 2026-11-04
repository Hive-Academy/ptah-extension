import { createHash } from 'node:crypto';
import { readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { ensureWorkerDirectory, WorkerPaths } from './paths';

export interface RegisteredWorkspace {
  workspaceId: string;
  name: string;
  path: string;
}

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
      if (isMissing(error)) return;
      throw error;
    }
  }

  list(): RegisteredWorkspace[] {
    return this.workspaces.map((workspace) => ({ ...workspace }));
  }

  async register(path: string): Promise<RegisteredWorkspace> {
    const canonical = await realpath(path);
    const workspace: RegisteredWorkspace = {
      workspaceId: `ws_${createHash('sha256').update(canonical).digest('hex').slice(0, 12)}`,
      name: basename(canonical),
      path: canonical,
    };
    const next = [
      ...this.workspaces.filter(
        (item) => item.workspaceId !== workspace.workspaceId,
      ),
      workspace,
    ];
    await ensureWorkerDirectory(this.paths);
    const temporary = `${this.paths.workspaces}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(next), { mode: 0o600 });
    await rename(temporary, this.paths.workspaces);
    this.workspaces = next;
    return { ...workspace };
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
