import type { WorkerPaths } from '@ptah-extension/worker-runtime';
import { adminCall } from './admin-client';

export async function grantsCommand(
  paths: WorkerPaths,
  action: 'list' | 'add' | 'revoke',
  tokenId?: string,
  workspaces: readonly string[] = [],
): Promise<unknown> {
  if (action === 'list') return adminCall(paths, 'admin.grants.list', {});
  if (action === 'revoke') {
    if (!tokenId || workspaces.length > 0)
      throw new Error('grants revoke requires exactly one token ID');
    return adminCall(paths, 'admin.grants.revoke', { tokenId });
  }
  if (!tokenId || workspaces.length === 0)
    throw new Error('grants add requires a token ID and workspaces');
  return adminCall(paths, 'admin.grants.add', {
    tokenId,
    workspaces: [...workspaces],
  });
}
