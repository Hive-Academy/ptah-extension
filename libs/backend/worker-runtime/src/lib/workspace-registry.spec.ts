import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { workerPaths } from './paths';
import { WorkspaceRegistry } from './workspace-registry';

describe('WorkspaceRegistry', () => {
  it('derives the ID from the real path and persists it', async () => {
    const home = await mkdtemp(join(tmpdir(), 'worker-registry-'));
    try {
      const directory = join(home, 'project');
      await mkdir(directory);
      const registry = new WorkspaceRegistry(workerPaths(home));
      const workspace = await registry.register(directory);
      expect(workspace.workspaceId).toBe(
        `ws_${createHash('sha256').update(directory).digest('hex').slice(0, 12)}`,
      );
      expect(workspace.workspaceId).toMatch(/^ws_[0-9a-f]{12}$/);
      const loaded = new WorkspaceRegistry(workerPaths(home));
      await loaded.load();
      expect(loaded.list()).toEqual([workspace]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
