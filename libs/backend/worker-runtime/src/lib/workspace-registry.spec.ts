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

  it('keeps concurrent writers from two instances and removes by ID or path', async () => {
    const home = await mkdtemp(join(tmpdir(), 'worker-registry-'));
    try {
      const paths = workerPaths(home);
      await Promise.all(
        ['a', 'b', 'c', 'd'].map((name) => mkdir(join(home, name))),
      );
      // Two processes' views: each writes from a stale in-memory list.
      const service = new WorkspaceRegistry(paths);
      const command = new WorkspaceRegistry(paths);
      const [a, b, c, d] = await Promise.all([
        service.register(join(home, 'a')),
        command.register(join(home, 'b')),
        service.register(join(home, 'c')),
        command.register(join(home, 'd')),
      ]);
      const loaded = new WorkspaceRegistry(paths);
      await loaded.load();
      expect(
        loaded
          .list()
          .map((item) => item.workspaceId)
          .sort(),
      ).toEqual([a, b, c, d].map((item) => item.workspaceId).sort());
      expect(await command.unregister(a.workspaceId)).toEqual(a);
      expect(await command.unregister(join(home, 'b'))).toEqual(b);
      expect(await command.unregister(join(home, 'b'))).toBeUndefined();
      // The service reloads under the lock: its stale list does not restore them.
      await service.register(join(home, 'a'));
      await loaded.load();
      expect(
        loaded
          .list()
          .map((item) => item.path)
          .sort(),
      ).toEqual([join(home, 'a'), c.path, d.path].sort());
      expect(loaded.has(c.workspaceId)).toBe(true);
      expect(loaded.resolveIds([c.path, d.workspaceId])).toEqual([
        c.workspaceId,
        d.workspaceId,
      ]);
      expect(() => loaded.resolveIds(['/nowhere'])).toThrow(
        'Unknown workspace',
      );
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
