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

  it('serializes issue, revoke and grant writers from two instances; a revoked token stays revoked', async () => {
    const home = await mkdtemp(join(tmpdir(), 'worker-token-'));
    try {
      const paths = workerPaths(home);
      const grant = { machineId: 'machine', workspaceIds: ['ws_1'] };
      // The service and a second writer, each with its own stale memory.
      const service = new TokenStore(paths);
      const other = new TokenStore(paths);
      const first = await service.issue('laptop', grant);
      await other.load();
      const [, second] = await Promise.all([
        other.revoke(first.tokenId),
        service.issue('phone', grant),
        other.addWorkspaces(first.tokenId, ['ws_2']),
      ]);
      const third = await service.issue('tablet', grant);
      const loaded = new TokenStore(paths);
      await loaded.load();
      const records = loaded.list();
      expect(records.map((item) => item.tokenId).sort()).toEqual(
        [first.tokenId, second.tokenId, third.tokenId].sort(),
      );
      const revoked = records.find((item) => item.tokenId === first.tokenId);
      expect(revoked?.revokedAt).toEqual(expect.any(String));
      expect(loaded.authenticate(first.token)).toBeNull();
      expect(service.authenticate(first.token)).toBeNull();
      expect(loaded.authenticate(second.token)?.clientName).toBe('phone');
      // A grant change never reaches a revoked token.
      expect(
        await service.addWorkspaces(first.tokenId, ['ws_3']),
      ).toBeUndefined();
      const widened = await other.addWorkspaces(second.tokenId, ['ws_2']);
      expect(widened?.grant.workspaceIds).toEqual(['ws_1', 'ws_2']);
      expect(await service.revoke('UNKNOWN00000')).toBeUndefined();
      expect((await stat(paths.tokens)).mode & 0o777).toBe(0o600);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it('records lastUsedAt on use at most once per minute', async () => {
    const home = await mkdtemp(join(tmpdir(), 'worker-token-'));
    try {
      const paths = workerPaths(home);
      const store = new TokenStore(paths);
      const issued = await store.issue('laptop', {
        machineId: 'machine',
        workspaceIds: [],
      });
      expect(store.list()[0]?.lastUsedAt).toBeNull();
      const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
      try {
        await store.recordUse(issued.tokenId);
        const recorded = store.list()[0]?.lastUsedAt;
        expect(recorded).toBe(new Date(1_000_000).toISOString());
        now.mockReturnValue(1_030_000);
        await store.recordUse(issued.tokenId);
        expect(store.list()[0]?.lastUsedAt).toBe(recorded);
        now.mockReturnValue(1_061_000);
        await store.recordUse(issued.tokenId);
        expect(store.list()[0]?.lastUsedAt).toBe(
          new Date(1_061_000).toISOString(),
        );
      } finally {
        now.mockRestore();
      }
      const loaded = new TokenStore(paths);
      await loaded.load();
      expect(loaded.list()[0]?.lastUsedAt).toBe(
        new Date(1_061_000).toISOString(),
      );
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
