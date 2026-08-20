/**
 * The durable-write helper every persistence path in this lib goes through
 * (E21, TASK_2026_278 review finding 1).
 *
 * Four of the five persistence writers had the temp+rename half of durability
 * and none of them had the RETRY half — which is backwards for the failure they
 * were guarding against. `renameSync` over a file an antivirus scanner or an
 * open editor holds is EPERM/EBUSY on Windows, and the manifest that fails to
 * land is the worst outcome this lib has: the next pass reads no ownership
 * record and freezes on Ptah's own files.
 *
 * Source-under-test: `atomicWriteWithRetry`, `withWindowsRetrySync`.
 */

// `fs.renameSync` is non-configurable on Node 20, so `jest.spyOn` cannot reach
// it. Wrapping the real implementation in a jest.fn at module-mock time is the
// only way to make the rename fail on demand — and making it fail on demand is
// the whole point, because a rename that loses to an antivirus scanner is the
// exact production failure this helper exists to survive.
jest.mock('fs', () => {
  const actual = jest.requireActual<typeof import('fs')>('fs');
  return { ...actual, renameSync: jest.fn(actual.renameSync) };
});

import * as fs from 'fs';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { atomicWriteWithRetry } from './atomic-write';
import {
  MAX_WRITE_ATTEMPTS,
  isRetryableError,
  withWindowsRetrySync,
} from './windows-retry';

const renameSync = fs.renameSync as jest.MockedFunction<typeof fs.renameSync>;

/** An error shaped like Node's, because the retry rule keys on `.code`. */
function errnoError(code: string): NodeJS.ErrnoException {
  const error: NodeJS.ErrnoException = new Error(`simulated ${code}`);
  error.code = code;
  return error;
}

describe('withWindowsRetrySync', () => {
  it('retries the transient Windows codes and returns the eventual success', () => {
    let attempts = 0;
    const value = withWindowsRetrySync(() => {
      attempts++;
      if (attempts < MAX_WRITE_ATTEMPTS) throw errnoError('EBUSY');
      return 'landed';
    });

    expect(value).toBe('landed');
    expect(attempts).toBe(MAX_WRITE_ATTEMPTS);
  });

  it('gives up after MAX_WRITE_ATTEMPTS and rethrows the last error', () => {
    let attempts = 0;

    expect(() =>
      withWindowsRetrySync(() => {
        attempts++;
        throw errnoError('EPERM');
      }),
    ).toThrow('simulated EPERM');
    expect(attempts).toBe(MAX_WRITE_ATTEMPTS);
  });

  it('does NOT retry an error that is not a sharing violation — a bad path must fail fast', () => {
    let attempts = 0;

    expect(() =>
      withWindowsRetrySync(() => {
        attempts++;
        throw errnoError('ENOENT');
      }),
    ).toThrow('simulated ENOENT');
    // One attempt, not three: retrying ENOENT would turn a programming error
    // into a 120ms stall on every pass.
    expect(attempts).toBe(1);
    expect(isRetryableError(errnoError('ENOENT'))).toBe(false);
  });
});

describe('atomicWriteWithRetry', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'harness-sync-atomic-'));
  });

  afterEach(() => {
    renameSync.mockClear();
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates the parent directory and writes the content', () => {
    const path = join(dir, 'nested', 'deeper', 'file.json');

    atomicWriteWithRetry(path, '{"ok":true}\n');

    expect(readFileSync(path, 'utf-8')).toBe('{"ok":true}\n');
  });

  it('replaces existing content and leaves no temp file behind', () => {
    const path = join(dir, 'file.json');
    atomicWriteWithRetry(path, 'first');

    atomicWriteWithRetry(path, 'second');

    expect(readFileSync(path, 'utf-8')).toBe('second');
    expect(readdirSync(dir)).toEqual(['file.json']);
  });

  it('survives a transient EPERM on the rename — the case the old writers lost', () => {
    const path = join(dir, 'claude.manifest.json');
    renameSync.mockImplementationOnce(() => {
      throw errnoError('EPERM');
    });

    atomicWriteWithRetry(path, 'payload');

    expect(renameSync).toHaveBeenCalledTimes(2);
    expect(readFileSync(path, 'utf-8')).toBe('payload');
  });

  it('throws after exhausting the retries, and cleans up its temp file', () => {
    const path = join(dir, 'doomed.json');
    renameSync.mockImplementation(() => {
      throw errnoError('EBUSY');
    });

    try {
      expect(() => atomicWriteWithRetry(path, 'payload')).toThrow(
        'simulated EBUSY',
      );
      expect(renameSync).toHaveBeenCalledTimes(MAX_WRITE_ATTEMPTS);
      // The target never appeared and no `.tmp` was stranded next to it: a
      // half-written manifest is exactly what temp+rename exists to prevent.
      expect(existsSync(path)).toBe(false);
      expect(readdirSync(dir)).toEqual([]);
    } finally {
      renameSync.mockImplementation(
        jest.requireActual<typeof import('fs')>('fs').renameSync,
      );
    }
  });

  it('writes a Buffer verbatim, for the config backups the MCP facets take', () => {
    const path = join(dir, 'config.toml.bak');

    atomicWriteWithRetry(path, Buffer.from('[mcp_servers.x]\n', 'utf-8'));

    expect(readFileSync(path, 'utf-8')).toBe('[mcp_servers.x]\n');
  });
});
