import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAdminKey, verifyAdminKey } from './admin-key';
import { workerPaths } from './paths';

describe('admin key', () => {
  it('creates fresh private 32-byte material on each start', async () => {
    const home = await mkdtemp(join(tmpdir(), 'worker-admin-'));
    try {
      const paths = workerPaths(home);
      const first = await createAdminKey(paths);
      const second = await createAdminKey(paths);
      expect(first).toHaveLength(32);
      expect(first).not.toEqual(second);
      expect(verifyAdminKey(second, second)).toBe(true);
      expect(verifyAdminKey(second, first)).toBe(false);
      expect((await stat(paths.adminKey)).mode & 0o777).toBe(0o600);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
