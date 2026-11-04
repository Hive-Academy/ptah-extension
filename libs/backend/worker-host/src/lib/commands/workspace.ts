import { rename, writeFile } from 'node:fs/promises';
import type {
  WorkerPaths,
  RegisteredWorkspace,
} from '@ptah-extension/worker-runtime';

export async function workspaceCommand(
  paths: WorkerPaths,
  action: string,
  path?: string,
): Promise<RegisteredWorkspace[] | RegisteredWorkspace> {
  const { WorkspaceRegistry, ensureWorkerDirectory } =
    await import('@ptah-extension/worker-runtime');
  const registry = new WorkspaceRegistry(paths);
  await registry.load();
  if (action === 'list') return registry.list();
  if (!path) throw new Error('workspace path is required');
  if (action === 'add') return registry.register(path);
  if (action !== 'remove') throw new Error('Unknown workspace action');
  const registered = registry.list();
  const matching = registered.find(
    (item) => item.workspaceId === path || item.path === path,
  );
  if (!matching) throw new Error('Workspace is not registered');
  const next = registered.filter((item) => item !== matching);
  await ensureWorkerDirectory(paths);
  const temporary = `${paths.workspaces}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(next), { mode: 0o600 });
  await rename(temporary, paths.workspaces);
  return matching;
}
