/**
 * `file-lock` — the timeout resolution (TASK_2026_332).
 *
 * The defect these specs pin: `acquireFileLock` retried with backoff until
 * `maxWaitMs`, returned an unheld handle, and `withFileLock` ran the task
 * ANYWAY. Under cross-process contention lasting longer than the deadline —
 * an Electron host and a VS Code host reconciling the same workspace — both
 * processes proceeded unlocked and lost each other's key, with no error, no
 * torn file and nothing in any health report to notice it by. That is exactly
 * the lost update TASK_2026_318 removed, coming back through the one door the
 * lock left open.
 *
 * The resolution chosen is FAIL: past the deadline the mutation is refused and
 * a `FileLockTimeoutError` names the file and the wait. `acquireFileLock` is
 * deliberately NOT changed — `acquireWorkspaceLock` inspects `acquired` and
 * genuinely does want to proceed degraded.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  acquireFileLock,
  FileLockTimeoutError,
  isFileLockTimeoutError,
  withFileLock,
} from './file-lock';
import {
  MCP_CONFIG_LOCK_MAX_WAIT_MS,
  mcpConfigLockPath,
  withMcpConfigLock,
} from '../targets/mcp/mcp-config-lock';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ptah-file-lock-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A lock file whose payload is fresh, so stale-reclaim cannot break it. */
function holdLock(lockFilePath: string): void {
  writeFileSync(
    lockFilePath,
    JSON.stringify({ pid: process.pid + 1, at: Date.now() }),
  );
}

describe('withFileLock — uncontended', () => {
  it('runs the task and releases the lock', async () => {
    const lockFilePath = join(dir, 'thing.lock');

    const first = await withFileLock(lockFilePath, async () => 'ran');
    // A lock that was not released would make the second call time out.
    const second = await withFileLock(lockFilePath, async () => 'ran again', {
      maxWaitMs: 50,
    });

    expect(first).toBe('ran');
    expect(second).toBe('ran again');
  });

  it('releases the lock even when the task throws', async () => {
    const lockFilePath = join(dir, 'thing.lock');

    await expect(
      withFileLock(lockFilePath, async () => {
        throw new Error('task exploded');
      }),
    ).rejects.toThrow('task exploded');

    await expect(
      withFileLock(lockFilePath, async () => 'recovered', { maxWaitMs: 50 }),
    ).resolves.toBe('recovered');
  });
});

describe('withFileLock — contended past the deadline', () => {
  it('REFUSES to run the task and reports the file and the wait', async () => {
    const lockFilePath = join(dir, 'thing.lock');
    holdLock(lockFilePath);

    const task = jest.fn(async () => 'must not run');

    const error: unknown = await withFileLock(lockFilePath, task, {
      maxWaitMs: 60,
    }).catch((caught: unknown) => caught);

    // The whole point: the mutation did not happen. Running it here is the
    // silent lost update.
    expect(task).not.toHaveBeenCalled();

    expect(isFileLockTimeoutError(error)).toBe(true);
    const timeout = error as FileLockTimeoutError;
    expect(timeout.lockFilePath).toBe(lockFilePath);
    expect(timeout.waitedMs).toBeGreaterThanOrEqual(60);
    // A `writeFailed` row naming neither the file nor the wait is
    // indistinguishable from an ordinary disk error.
    expect(timeout.message).toContain(lockFilePath);
    expect(timeout.message).toContain('ms');
  });

  it('reclaims a STALE lock instead of failing (a crash must not disable the write)', async () => {
    const lockFilePath = join(dir, 'thing.lock');
    writeFileSync(
      lockFilePath,
      JSON.stringify({ pid: process.pid + 1, at: Date.now() - 60_000 }),
    );

    await expect(
      withFileLock(lockFilePath, async () => 'reclaimed', {
        maxWaitMs: 60,
        staleAfterMs: 1_000,
      }),
    ).resolves.toBe('reclaimed');
  });
});

describe('acquireFileLock — unchanged, and the two reasons are distinct', () => {
  it('still returns an unheld handle on timeout rather than throwing', async () => {
    // `acquireWorkspaceLock` builds on this and reports `lock.acquired` itself
    // (`harness-reconciler.service.ts`), so this half must not start throwing.
    const lockFilePath = join(dir, 'thing.lock');
    holdLock(lockFilePath);

    const handle = await acquireFileLock(lockFilePath, { maxWaitMs: 60 });

    expect(handle.acquired).toBe(false);
    expect(handle.reason).toBe('timeout');
    expect(handle.waitedMs).toBeGreaterThanOrEqual(60);
    expect(() => handle.release()).not.toThrow();
  });

  it('reports an uncreatable lock directory as its OWN reason, not a timeout', async () => {
    // A file where the lock's parent directory should be: `mkdirSync` fails
    // with ENOTDIR. That is not contention — nobody holds anything — so
    // `withFileLock` proceeds and lets the caller's own write report the real
    // permission problem, rather than masking it with a lock error.
    const notADirectory = join(dir, 'blocker');
    writeFileSync(notADirectory, 'i am a file');
    const lockFilePath = join(notADirectory, 'nested', 'thing.lock');

    const handle = await acquireFileLock(lockFilePath, { maxWaitMs: 60 });
    expect(handle.acquired).toBe(false);
    expect(handle.reason).toBe('no-lock-directory');

    await expect(
      withFileLock(lockFilePath, async () => 'proceeded', { maxWaitMs: 60 }),
    ).resolves.toBe('proceeded');
  });
});

describe('withMcpConfigLock — the resolution reaches the MCP mutations', () => {
  it(
    'fails a config mutation held by another process instead of writing unlocked',
    async () => {
      const configPath = join(dir, 'ws', '.mcp.json');
      mkdirSync(join(dir, 'ws'), { recursive: true });
      holdLock(mcpConfigLockPath(configPath));

      const mutate = jest.fn(async () => undefined);

      await expect(
        withMcpConfigLock(configPath, mutate),
      ).rejects.toBeInstanceOf(FileLockTimeoutError);
      expect(mutate).not.toHaveBeenCalled();
    },
    MCP_CONFIG_LOCK_MAX_WAIT_MS + 8_000,
  );

  it('serializes two in-process mutations without either one timing out', async () => {
    // The in-process queue is what covers the common case, and it must keep
    // covering it — a second caller inside ONE host must not sit on the file
    // lock until the deadline and then fail.
    const configPath = join(dir, 'ws', '.mcp.json');
    mkdirSync(join(dir, 'ws'), { recursive: true });

    const order: string[] = [];
    const [a, b] = await Promise.all([
      withMcpConfigLock(configPath, async () => {
        order.push('a:start');
        await new Promise((resolve) => setTimeout(resolve, 20));
        order.push('a:end');
        return 'a';
      }),
      withMcpConfigLock(configPath, async () => {
        order.push('b:start');
        order.push('b:end');
        return 'b';
      }),
    ]);

    expect([a, b]).toEqual(['a', 'b']);
    expect(order).toEqual(['a:start', 'a:end', 'b:start', 'b:end']);
  });
});
