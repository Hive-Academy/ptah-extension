/**
 * Cross-process workspace lock unit tests (required coverage item 5, E11 b/c).
 *
 * Source-under-test: `acquireWorkspaceLock`, `lockPath`, `STALE_AFTER_MS`.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  acquireWorkspaceLock,
  lockPath,
  STALE_AFTER_MS,
} from './workspace-lock';

describe('acquireWorkspaceLock', () => {
  let ws: string;

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), 'harness-sync-lock-'));
  });

  afterEach(() => {
    rmSync(ws, { recursive: true, force: true });
  });

  it('[E11] breaks a lock older than STALE_AFTER_MS and acquires it, instead of assuming a live owner', async () => {
    mkdirSync(join(ws, '.ptah', 'harness'), { recursive: true });
    writeFileSync(
      lockPath(ws),
      JSON.stringify({ pid: 1, at: Date.now() - STALE_AFTER_MS - 5_000 }),
    );

    const handle = await acquireWorkspaceLock(ws);

    expect(handle.acquired).toBe(true);
    handle.release();
  });

  it('[E11] does not acquire a fresh lock, and still returns instead of hanging past maxWaitMs', async () => {
    mkdirSync(join(ws, '.ptah', 'harness'), { recursive: true });
    writeFileSync(lockPath(ws), JSON.stringify({ pid: 1, at: Date.now() }));

    const start = Date.now();
    const handle = await acquireWorkspaceLock(ws, { maxWaitMs: 100 });
    const elapsed = Date.now() - start;

    expect(handle.acquired).toBe(false);
    // The call must return, not hang — a generous upper bound well short of
    // the default 5s window proves it did not fall back to that default.
    expect(elapsed).toBeLessThan(3_000);
    handle.release();
  });

  it('acquires an uncontended lock immediately and release() is idempotent-safe', async () => {
    const handle = await acquireWorkspaceLock(ws);

    expect(handle.acquired).toBe(true);
    handle.release();
    // Calling release() twice must not throw — the second call finds nothing
    // to remove and swallows the error.
    expect(() => handle.release()).not.toThrow();
  });
});
