import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
  mkdir,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InsecureTokenFileError, TokenStore } from './token-store';
import { workerPaths } from './paths';

describe('TokenStore', () => {
  it('refuses group or world readable files and writes private tokens atomically', async () => {
    const home = await mkdtemp(join(tmpdir(), 'worker-token-'));
    try {
      const paths = workerPaths(home);
      await mkdir(paths.directory, { recursive: true });
      await writeFile(paths.tokens, '[]');
      await chmod(paths.tokens, 0o644);
      await expect(new TokenStore(paths).load()).rejects.toBeInstanceOf(
        InsecureTokenFileError,
      );
      await chmod(paths.tokens, 0o600);
      const store = new TokenStore(paths);
      await store.load();
      const issued = await store.issue('client', {
        machineId: 'machine',
        workspaceIds: ['ws_1'],
      });
      expect(issued.token).toMatch(
        /^ptw1\.[0-9A-HJKMNP-TV-Z]{12}\.[A-Za-z0-9_-]{43}$/,
      );
      expect(store.authenticate(issued.token)?.tokenId).toBe(issued.tokenId);
      expect((await stat(paths.tokens)).mode & 0o777).toBe(0o600);
      expect(await readFile(paths.tokens, 'utf8')).not.toContain(issued.token);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
