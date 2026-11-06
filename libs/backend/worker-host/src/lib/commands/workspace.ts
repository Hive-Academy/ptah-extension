import { resolve } from 'node:path';
import type {
  WorkerPaths,
  RegisteredWorkspace,
} from '@ptah-extension/worker-runtime';
import { adminCall } from './admin-client';
import { WorkerNotRunningError } from './status';

/** A registered workspace ID; anything else is a path. */
const WORKSPACE_ID = /^ws_[0-9a-f]{12}$/;

/**
 * `workspace add|remove|list`. While the service runs, add and remove go to
 * it over the admin channel so its live registry changes at once. When no
 * service runs, the registry file is changed under its lock.
 */
export async function workspaceCommand(
  paths: WorkerPaths,
  action: string,
  path?: string,
): Promise<RegisteredWorkspace[] | RegisteredWorkspace> {
  const { WorkspaceRegistry } = await import('@ptah-extension/worker-runtime');
  const registry = new WorkspaceRegistry(paths);
  if (action === 'list') {
    await registry.load();
    return registry.list();
  }
  if (!path) throw new Error('workspace path is required');
  if (action !== 'add' && action !== 'remove')
    throw new Error('Unknown workspace action');
  // The service has its own working directory: send absolute paths.
  const target = WORKSPACE_ID.test(path) ? path : resolve(path);
  try {
    return action === 'add'
      ? await adminCall(paths, 'admin.workspace.add', { path: target })
      : await adminCall(paths, 'admin.workspace.remove', {
          workspace: target,
        });
  } catch (error) {
    // Only a stopped service falls through to the file; any other failure
    // (a refusal, or a listener that is not this worker) is reported.
    if (!(error instanceof WorkerNotRunningError)) throw error;
  }
  if (action === 'add') return registry.register(target);
  const removed = await registry.unregister(target);
  if (!removed) throw new Error('Workspace is not registered');
  return removed;
}
