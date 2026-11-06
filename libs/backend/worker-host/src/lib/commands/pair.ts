import type { WorkerPaths } from '@ptah-extension/worker-runtime';
import { adminCall } from './admin-client';

export async function pairCommand(
  paths: WorkerPaths,
  ttlSeconds: number,
  workspaces?: string[],
): Promise<unknown> {
  return adminCall(paths, 'admin.pairing.open', {
    ttlSeconds,
    ...(workspaces ? { workspaces } : {}),
  });
}
