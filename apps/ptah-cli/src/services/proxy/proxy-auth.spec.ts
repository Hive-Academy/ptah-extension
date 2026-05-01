/**
 * Unit tests for `proxy-auth` — TASK_2026_104 P2.
 *
 * Covers:
 *   1. mintProxyToken — produces 64-char hex, distinct per call.
 *   2. verifyProxyToken — accepts equal tokens, rejects mismatched/length-
 *      different/empty.
 *   3. extractProxyToken — handles `x-api-key`, `authorization: Bearer`, and
 *      array-valued headers.
 *   4. writeProxyTokenFile / deleteProxyTokenFile — round-trip with mode
 *      0o600 (POSIX only — Windows skips the mode assertion).
 */

import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import {
  deleteProxyTokenFile,
  extractProxyToken,
  mintProxyToken,
  resolveProxyTokenPath,
  verifyProxyToken,
  writeProxyTokenFile,
} from './proxy-auth.js';

describe('proxy-auth', () => {
  describe('mintProxyToken', () => {
    it('produces a 64-character lowercase hex string', () => {
      const token = mintProxyToken();
      expect(token).toMatch(/^[0-9a-f]{64}$/);
    });

    it('produces distinct tokens across calls', () => {
      const a = mintProxyToken();
      const b = mintProxyToken();
      expect(a).not.toBe(b);
    });
  });

  describe('verifyProxyToken', () => {
    it('returns true for identical tokens', () => {
      const token = mintProxyToken();
      expect(verifyProxyToken(token, token)).toBe(true);
    });

    it('returns false for mismatched same-length tokens', () => {
      const a = mintProxyToken();
      const b = mintProxyToken();
      expect(verifyProxyToken(a, b)).toBe(false);
    });

    it('returns false for length-mismatch', () => {
      expect(verifyProxyToken('short', 'a-much-longer-string')).toBe(false);
    });

    it('returns false for empty tokens', () => {
      expect(verifyProxyToken('', '')).toBe(false);
    });

    it('returns false for non-string inputs', () => {
      // Cast through unknown to exercise the runtime guard.
      expect(verifyProxyToken(undefined as unknown as string, 'abc')).toBe(
        false,
      );
      expect(verifyProxyToken('abc', null as unknown as string)).toBe(false);
    });
  });

  describe('extractProxyToken', () => {
    it('extracts x-api-key (string header)', () => {
      expect(extractProxyToken({ 'x-api-key': 'tok123' })).toBe('tok123');
    });

    it('extracts x-api-key (array header)', () => {
      expect(extractProxyToken({ 'x-api-key': ['tok123', 'second'] })).toBe(
        'tok123',
      );
    });

    it('strips Bearer prefix from authorization', () => {
      expect(extractProxyToken({ authorization: 'Bearer tok-value' })).toBe(
        'tok-value',
      );
    });

    it('handles bearer prefix case-insensitively', () => {
      expect(extractProxyToken({ authorization: 'bearer tok-value' })).toBe(
        'tok-value',
      );
    });

    it('returns trimmed authorization without Bearer when no prefix', () => {
      expect(extractProxyToken({ authorization: '  raw-tok  ' })).toBe(
        'raw-tok',
      );
    });

    it('prefers x-api-key over authorization', () => {
      expect(
        extractProxyToken({
          'x-api-key': 'preferred',
          authorization: 'Bearer ignored',
        }),
      ).toBe('preferred');
    });

    it('returns null when neither header is present', () => {
      expect(extractProxyToken({})).toBeNull();
    });

    it('returns null for empty x-api-key string', () => {
      expect(extractProxyToken({ 'x-api-key': '' })).toBeNull();
    });
  });

  describe('writeProxyTokenFile / deleteProxyTokenFile', () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await mkdtemp(path.join(tmpdir(), 'ptah-proxy-auth-'));
    });

    afterEach(async () => {
      await rm(tempDir, { recursive: true, force: true });
    });

    it('writes the token to <userDataPath>/proxy/<port>.token', async () => {
      const token = mintProxyToken();
      const filePath = await writeProxyTokenFile(token, 51234, tempDir);
      expect(filePath).toBe(path.join(tempDir, 'proxy', '51234.token'));
      const contents = await readFile(filePath, 'utf8');
      expect(contents).toBe(token);
    });

    it('writes with mode 0o600 on POSIX', async () => {
      if (process.platform === 'win32') {
        // NTFS ignores POSIX mode bits — skip the assertion on Windows.
        return;
      }
      const filePath = await writeProxyTokenFile('tok', 51235, tempDir);
      const stats = await stat(filePath);
      // Bottom 9 bits = permission triplet.
      expect(stats.mode & 0o777).toBe(0o600);
    });

    it('overwrites a stale token file', async () => {
      await writeProxyTokenFile('first', 51236, tempDir);
      await writeProxyTokenFile('second', 51236, tempDir);
      const contents = await readFile(
        resolveProxyTokenPath(51236, tempDir),
        'utf8',
      );
      expect(contents).toBe('second');
    });

    it('deleteProxyTokenFile removes the file', async () => {
      await writeProxyTokenFile('tok', 51237, tempDir);
      await deleteProxyTokenFile(51237, tempDir);
      await expect(
        readFile(resolveProxyTokenPath(51237, tempDir), 'utf8'),
      ).rejects.toThrow();
    });

    it('deleteProxyTokenFile is idempotent (no throw on missing)', async () => {
      await expect(
        deleteProxyTokenFile(99999, tempDir),
      ).resolves.toBeUndefined();
    });
  });
});
