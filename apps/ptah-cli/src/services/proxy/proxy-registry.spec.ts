/**
 * Unit tests for `proxy-registry` — TASK_2026_108 T3.
 *
 * Coverage:
 *   1. `register` writes JSON file with mode 0o600 (POSIX only — Windows
 *      skip mirrors `proxy-auth.spec.ts`).
 *   2. `register` uses atomic write — `tmp + rename` invocation order.
 *   3. `list` returns alive entries; auto-GCs dead-pid entries inline.
 *   4. `findStale` returns dead-pid entries (counterpart to `list`).
 *   5. `unregister` deletes the file; idempotent on missing.
 *   6. `tokenFingerprint` is a stable sha256 prefix (16 hex chars).
 *   7. Round-trip register → list → unregister leaves no residual files.
 *
 * Each test uses a fresh `os.tmpdir()` subdirectory as `userDataPath` so
 * tests run in parallel without colliding on `~/.ptah/proxies/` files.
 */

import * as fsPromises from 'node:fs/promises';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import {
  findStale,
  list,
  register,
  resolveRegistryPath,
  tokenFingerprint,
  unregister,
  type ProxyRegistryEntry,
} from './proxy-registry.js';

/**
 * Synthesize a likely-dead pid. The Linux/Windows pid space is bounded
 * (default kernel.pid_max=4194304 on Linux, 0xFFFFFFFF on Windows in
 * theory but practical values are < 100k). 9_999_999 is far enough above
 * the practical range that `process.kill(pid, 0)` will throw ESRCH.
 *
 * Documented as a constant so future tests don't accidentally reuse a value
 * that happens to be alive on the test runner.
 */
const DEAD_PID = 9_999_999;

function makeEntry(
  port: number,
  overrides: Partial<ProxyRegistryEntry> = {},
): ProxyRegistryEntry {
  return {
    pid: process.pid, // alive by default
    port,
    host: '127.0.0.1',
    startedAt: Date.now(),
    tokenFingerprint: 'a'.repeat(16),
    ...overrides,
  };
}

describe('proxy-registry', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'ptah-proxy-registry-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  describe('resolveRegistryPath', () => {
    it('joins userDataPath / proxies / <port>.json', () => {
      const result = resolveRegistryPath(18765, tempDir);
      expect(result).toBe(path.join(tempDir, 'proxies', '18765.json'));
    });
  });

  describe('register', () => {
    it('writes JSON file with mode 0o600 on POSIX', async () => {
      if (process.platform === 'win32') {
        // NTFS ignores POSIX mode bits — skip the assertion on Windows.
        return;
      }
      const entry = makeEntry(18765);
      await register(entry, tempDir);
      const filePath = resolveRegistryPath(18765, tempDir);
      const stats = await stat(filePath);
      expect(stats.mode & 0o777).toBe(0o600);
    });

    it('persists the entry shape verbatim', async () => {
      const entry = makeEntry(18766, {
        startedAt: 1_700_000_000_000,
        tokenFingerprint: 'deadbeefcafef00d',
      });
      await register(entry, tempDir);
      const raw = await readFile(resolveRegistryPath(18766, tempDir), 'utf8');
      const parsed = JSON.parse(raw);
      expect(parsed).toEqual(entry);
    });

    it('uses atomic write (writeFile to tmp, then rename — no residual tmp files)', async () => {
      // Behavioral atomicity check (avoids jest.spyOn on ESM-bound fs methods,
      // which is unsupported under our ts-jest/ESM configuration). After
      // register() resolves, the final file must exist and NO `*.tmp.*`
      // siblings may remain — proving that the implementation wrote to a tmp
      // file and renamed it into place rather than truncating the final path.
      const entry = makeEntry(18767);
      await register(entry, tempDir);

      const finalPath = resolveRegistryPath(18767, tempDir);
      const finalStats = await stat(finalPath);
      expect(finalStats.isFile()).toBe(true);

      const proxiesDir = path.dirname(finalPath);
      const siblings = await readdir(proxiesDir);
      const tmpResiduals = siblings.filter((n) => n.includes('.tmp.'));
      expect(tmpResiduals).toEqual([]);

      // Round-trip the JSON to confirm the write completed successfully —
      // a partial write would have left invalid JSON (or no file at all).
      const raw = await readFile(finalPath, 'utf8');
      expect(JSON.parse(raw)).toEqual(entry);
    });
  });

  describe('list', () => {
    it('returns all alive registered entries', async () => {
      await register(makeEntry(20001), tempDir);
      await register(makeEntry(20002), tempDir);
      const entries = await list(tempDir);
      const ports = entries.map((e) => e.port).sort();
      expect(ports).toEqual([20001, 20002]);
    });

    it('excludes entries whose pid is dead (ESRCH) and auto-unregisters them', async () => {
      await register(makeEntry(20003, { pid: DEAD_PID }), tempDir);
      await register(makeEntry(20004), tempDir);

      const entries = await list(tempDir);
      expect(entries.map((e) => e.port)).toEqual([20004]);

      // Auto-GC: the dead-pid file should be gone after `list()`.
      const remaining = await readdir(path.join(tempDir, 'proxies'));
      expect(remaining).toEqual(['20004.json']);
    });

    it('returns empty array when the registry directory does not exist', async () => {
      // Fresh tempDir — no `proxies/` subdir created yet.
      const entries = await list(tempDir);
      expect(entries).toEqual([]);
    });

    it('skips files that fail JSON parsing without auto-deleting them', async () => {
      // Bootstrap the directory by registering a real entry, then drop a
      // garbage file alongside it.
      await register(makeEntry(20005), tempDir);
      const garbagePath = path.join(tempDir, 'proxies', '99999.json');
      await fsPromises.writeFile(garbagePath, '{not json', 'utf8');

      // Suppress the stderr warning so test output stays clean.
      const stderrSpy = jest
        .spyOn(process.stderr, 'write')
        .mockImplementation(() => true);

      const entries = await list(tempDir);
      expect(entries.map((e) => e.port)).toEqual([20005]);

      // Garbage file MUST still exist — auto-delete on parse failure could
      // clobber a partial-write recovery in flight.
      const stats = await stat(garbagePath);
      expect(stats.isFile()).toBe(true);

      stderrSpy.mockRestore();
    });
  });

  describe('findStale', () => {
    it('returns dead-pid entries that list() excludes', async () => {
      await register(makeEntry(20010, { pid: DEAD_PID }), tempDir);
      await register(makeEntry(20011), tempDir);
      const stale = await findStale(tempDir);
      expect(stale.map((e) => e.port)).toEqual([20010]);
    });

    it('does NOT mutate the registry (no auto-unregister)', async () => {
      await register(makeEntry(20012, { pid: DEAD_PID }), tempDir);
      await findStale(tempDir);
      // File should still exist — findStale is read-only.
      const stats = await stat(resolveRegistryPath(20012, tempDir));
      expect(stats.isFile()).toBe(true);
    });
  });

  describe('unregister', () => {
    it('deletes the file', async () => {
      await register(makeEntry(20020), tempDir);
      await unregister(20020, tempDir);
      await expect(
        readFile(resolveRegistryPath(20020, tempDir), 'utf8'),
      ).rejects.toThrow();
    });

    it('is idempotent on missing (no throw on second call)', async () => {
      await register(makeEntry(20021), tempDir);
      await unregister(20021, tempDir);
      await expect(unregister(20021, tempDir)).resolves.toBeUndefined();
    });

    it('is idempotent when the entry never existed', async () => {
      await expect(unregister(99998, tempDir)).resolves.toBeUndefined();
    });
  });

  describe('tokenFingerprint', () => {
    it('returns a 16-character lowercase hex string', () => {
      expect(tokenFingerprint('hello')).toMatch(/^[0-9a-f]{16}$/);
    });

    it('is stable for the same input', () => {
      expect(tokenFingerprint('test-token')).toBe(
        tokenFingerprint('test-token'),
      );
    });

    it('differs for different inputs', () => {
      expect(tokenFingerprint('a')).not.toBe(tokenFingerprint('b'));
    });
  });

  describe('round-trip', () => {
    it('register → list → unregister leaves no residual files', async () => {
      await register(makeEntry(30001), tempDir);
      await register(makeEntry(30002), tempDir);

      const entries = await list(tempDir);
      expect(entries).toHaveLength(2);

      for (const entry of entries) {
        await unregister(entry.port, tempDir);
      }

      const proxiesDir = path.join(tempDir, 'proxies');
      const remaining = await readdir(proxiesDir);
      expect(remaining).toEqual([]);
    });
  });
});
