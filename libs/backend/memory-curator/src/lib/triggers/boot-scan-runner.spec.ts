import 'reflect-metadata';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { Logger } from '@ptah-extension/vscode-core';
import type {
  SqliteConnectionService,
  SqliteDatabase,
} from '@ptah-extension/persistence-sqlite';
import { BootScanRunner } from './boot-scan-runner';

function makeLogger(): Logger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as Logger;
}

interface WatermarkState {
  value: number;
}

function makeSqlite(
  state: WatermarkState,
  isOpen = true,
): SqliteConnectionService {
  const db = {
    prepare: jest.fn((sql: string) => {
      if (sql.includes('SELECT last_scanned_session_mtime')) {
        return {
          get: jest.fn(() =>
            state.value > 0
              ? { last_scanned_session_mtime: state.value }
              : undefined,
          ),
        };
      }
      return {
        run: jest.fn((..._args: unknown[]) => {
          const args = _args as [string, string, number, number];
          state.value = args[2];
          return { changes: 1, lastInsertRowid: 1 };
        }),
      };
    }),
  } as unknown as SqliteDatabase;
  return { db, isOpen } as unknown as SqliteConnectionService;
}

/**
 * A connection whose watermark row EXISTS and holds `value` — including `0`.
 *
 * `makeSqlite` cannot express this: it reports "no row" for any value `<= 0`,
 * which is the very conflation TASK_2026_319 removed. Kept separate so the
 * absent case and the stored-zero case can be asserted against each other.
 */
function makeSqliteWithRow(value: number): SqliteConnectionService {
  const db = {
    prepare: jest.fn((sql: string) => {
      if (sql.includes('SELECT last_scanned_session_mtime')) {
        return { get: jest.fn(() => ({ last_scanned_session_mtime: value })) };
      }
      return { run: jest.fn(() => ({ changes: 1, lastInsertRowid: 1 })) };
    }),
  } as unknown as SqliteDatabase;
  return { db, isOpen: true } as unknown as SqliteConnectionService;
}

/** A connection whose watermark SELECT throws — a locked or corrupt database. */
function makeSqliteReadThrows(state: WatermarkState): SqliteConnectionService {
  const db = {
    prepare: jest.fn((sql: string) => {
      if (sql.includes('SELECT last_scanned_session_mtime')) {
        return {
          get: jest.fn(() => {
            throw new Error('SQLITE_CORRUPT: database disk image is malformed');
          }),
        };
      }
      return {
        run: jest.fn((..._args: unknown[]) => {
          const args = _args as [string, string, number, number];
          state.value = args[2];
          return { changes: 1, lastInsertRowid: 1 };
        }),
      };
    }),
  } as unknown as SqliteDatabase;
  return { db, isOpen: true } as unknown as SqliteConnectionService;
}

const DAY_MS = 24 * 60 * 60 * 1000;

async function makeTempSessionsDir(
  files: { name: string; mtime: number }[],
): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'boot-scan-test-'));
  for (const f of files) {
    const full = path.join(dir, f.name);
    await fs.writeFile(full, '{}\n');
    await fs.utimes(full, new Date(f.mtime), new Date(f.mtime));
  }
  return dir;
}

describe('BootScanRunner', () => {
  it('returns 0 when sessions directory is null', async () => {
    const state: WatermarkState = { value: 0 };
    const runner = new BootScanRunner();
    const result = await runner.run({
      pipeline: 'memory',
      workspaceRoot: '/ws',
      workspaceFingerprint: 'fp1',
      sessionsDirectory: null,
      sqlite: makeSqlite(state),
      logger: makeLogger(),
      run: jest.fn(),
    });
    expect(result).toEqual({
      scanned: 0,
      succeeded: 0,
      skipped: 0,
      stalled: 0,
    });
  });

  it('scans ALL JSONL files when watermark is 0', async () => {
    const now = Date.now();
    const dir = await makeTempSessionsDir([
      { name: 's1.jsonl', mtime: now - 5000 },
      { name: 's2.jsonl', mtime: now - 3000 },
      { name: 's3.jsonl', mtime: now - 1000 },
      { name: 'not-jsonl.txt', mtime: now },
    ]);
    const state: WatermarkState = { value: 0 };
    const sqlite = makeSqlite(state);
    const run = jest.fn().mockResolvedValue(undefined);
    const result = await new BootScanRunner().run({
      pipeline: 'memory',
      workspaceRoot: '/ws',
      workspaceFingerprint: 'fp1',
      sessionsDirectory: dir,
      sqlite,
      logger: makeLogger(),
      run,
      throttleMs: 0,
    });
    expect(result.scanned).toBe(3);
    expect(result.succeeded).toBe(3);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it('skips files with mtime <= watermark', async () => {
    const now = Date.now();
    const dir = await makeTempSessionsDir([
      { name: 'old.jsonl', mtime: now - 10000 },
      { name: 'new.jsonl', mtime: now - 1000 },
    ]);
    const state: WatermarkState = { value: now - 5000 };
    const run = jest.fn().mockResolvedValue(undefined);
    const result = await new BootScanRunner().run({
      pipeline: 'memory',
      workspaceRoot: '/ws',
      workspaceFingerprint: 'fp1',
      sessionsDirectory: dir,
      sqlite: makeSqlite(state),
      logger: makeLogger(),
      run,
      throttleMs: 0,
    });
    expect(result.scanned).toBe(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith('new', '/ws', undefined);
  });

  it('updates watermark to max mtime processed', async () => {
    const now = Date.now();
    const dir = await makeTempSessionsDir([
      { name: 'a.jsonl', mtime: now - 5000 },
      { name: 'b.jsonl', mtime: now - 1000 },
    ]);
    const state: WatermarkState = { value: 0 };
    const sqlite = makeSqlite(state);
    await new BootScanRunner().run({
      pipeline: 'memory',
      workspaceRoot: '/ws',
      workspaceFingerprint: 'fp1',
      sessionsDirectory: dir,
      sqlite,
      logger: makeLogger(),
      run: jest.fn().mockResolvedValue(undefined),
      throttleMs: 0,
    });
    expect(Math.floor(state.value)).toBeGreaterThanOrEqual(now - 1000 - 1);
  });

  it('skips the watermark write silently when the connection is closed', async () => {
    const now = Date.now();
    const dir = await makeTempSessionsDir([
      { name: 'a.jsonl', mtime: now - 5000 },
      { name: 'b.jsonl', mtime: now - 1000 },
    ]);
    const state: WatermarkState = { value: 0 };
    const sqlite = makeSqlite(state, false);
    const logger = makeLogger();
    await new BootScanRunner().run({
      pipeline: 'memory',
      workspaceRoot: '/ws',
      workspaceFingerprint: 'fp1',
      sessionsDirectory: dir,
      sqlite,
      logger,
      run: jest.fn().mockResolvedValue(undefined),
      throttleMs: 0,
    });
    expect(state.value).toBe(0);
    expect(logger.warn).not.toHaveBeenCalledWith(
      '[boot-scan] watermark write failed',
      expect.anything(),
    );
  });

  it('continues scan when per-session run throws', async () => {
    const now = Date.now();
    const dir = await makeTempSessionsDir([
      { name: 's1.jsonl', mtime: now - 5000 },
      { name: 's2.jsonl', mtime: now - 4000 },
      { name: 's3.jsonl', mtime: now - 3000 },
    ]);
    const state: WatermarkState = { value: 0 };
    const run = jest
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined);
    const result = await new BootScanRunner().run({
      pipeline: 'memory',
      workspaceRoot: '/ws',
      workspaceFingerprint: 'fp1',
      sessionsDirectory: dir,
      sqlite: makeSqlite(state),
      logger: makeLogger(),
      run,
      throttleMs: 0,
    });
    expect(result.scanned).toBe(3);
    expect(result.succeeded).toBe(2);
    expect(result.skipped).toBe(1);
  });

  it('aborts mid-scan when AbortSignal triggers', async () => {
    const now = Date.now();
    const dir = await makeTempSessionsDir([
      { name: 's1.jsonl', mtime: now - 5000 },
      { name: 's2.jsonl', mtime: now - 4000 },
      { name: 's3.jsonl', mtime: now - 3000 },
    ]);
    const state: WatermarkState = { value: 0 };
    const controller = new AbortController();
    const run = jest.fn(async () => {
      controller.abort();
      return 'ran' as const;
    });
    const result = await new BootScanRunner().run({
      pipeline: 'memory',
      workspaceRoot: '/ws',
      workspaceFingerprint: 'fp1',
      sessionsDirectory: dir,
      sqlite: makeSqlite(state),
      logger: makeLogger(),
      run,
      throttleMs: 0,
      signal: controller.signal,
    });
    expect(result.succeeded).toBeLessThanOrEqual(1);
    expect(run.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('forwards the AbortSignal into the per-session run callback (Serious-2)', async () => {
    const now = Date.now();
    const dir = await makeTempSessionsDir([
      { name: 's1.jsonl', mtime: now - 5000 },
    ]);
    const state: WatermarkState = { value: 0 };
    const controller = new AbortController();
    const run = jest.fn().mockResolvedValue(undefined);
    await new BootScanRunner().run({
      pipeline: 'memory',
      workspaceRoot: '/ws',
      workspaceFingerprint: 'fp1',
      sessionsDirectory: dir,
      sqlite: makeSqlite(state),
      logger: makeLogger(),
      run,
      throttleMs: 0,
      signal: controller.signal,
    });
    expect(run).toHaveBeenCalledWith('s1', '/ws', controller.signal);
  });

  /**
   * TASK_2026_306 Batch 10 (F1) — a stalled item is not a scanned item.
   *
   * The watermark is the scan's memory of what it has already handled. A pass
   * the provider quota gate stopped read the session and curated nothing from
   * it, so recording it would lose it permanently at the next boot's
   * `mtime > watermark` filter — the second route by which F1 destroys data,
   * independent of `markProcessed`.
   */
  describe('a stalled run (TASK_2026_306 F1)', () => {
    it('does NOT advance the watermark past the stalled session', async () => {
      const now = Date.now();
      const dir = await makeTempSessionsDir([
        { name: 's1.jsonl', mtime: now - 5000 },
        { name: 's2.jsonl', mtime: now - 1000 },
      ]);
      const state: WatermarkState = { value: 0 };
      const result = await new BootScanRunner().run({
        pipeline: 'memory',
        workspaceRoot: '/ws',
        workspaceFingerprint: 'fp1',
        sessionsDirectory: dir,
        sqlite: makeSqlite(state),
        logger: makeLogger(),
        run: jest.fn().mockResolvedValue('stalled'),
        throttleMs: 0,
      });
      // Nothing ran, so nothing may be remembered as run. `0` is the untouched
      // watermark: both sessions are still eligible on the next boot.
      expect(state.value).toBe(0);
      expect(result.stalled).toBe(1);
      expect(result.succeeded).toBe(0);
    });

    it('keeps the watermark at the last session that actually ran', async () => {
      const now = Date.now();
      const dir = await makeTempSessionsDir([
        { name: 'a.jsonl', mtime: now - 9000 },
        { name: 'b.jsonl', mtime: now - 6000 },
        { name: 'c.jsonl', mtime: now - 3000 },
      ]);
      const state: WatermarkState = { value: 0 };
      const run = jest
        .fn()
        .mockResolvedValueOnce('ran')
        .mockResolvedValueOnce('stalled')
        .mockResolvedValueOnce('ran');
      const result = await new BootScanRunner().run({
        pipeline: 'memory',
        workspaceRoot: '/ws',
        workspaceFingerprint: 'fp1',
        sessionsDirectory: dir,
        sqlite: makeSqlite(state),
        logger: makeLogger(),
        run,
        throttleMs: 0,
      });
      // `eligible` is mtime-ascending and the watermark is the MAX over handled
      // items, so letting `c` run after `b` stalled would jump the watermark
      // over `b` and lose it. Stopping at the stall is what keeps the watermark
      // monotonic AND complete.
      expect(run).toHaveBeenCalledTimes(2);
      expect(result.succeeded).toBe(1);
      expect(result.stalled).toBe(1);
      expect(Math.floor(state.value)).toBeLessThan(now - 6000);
    });

    it('a run that reports "ran" but extracted nothing still advances the watermark', async () => {
      // The inverse guard. Without it, "never advance" would satisfy the case
      // above — and turn every empty session into a permanent re-scan.
      const now = Date.now();
      const dir = await makeTempSessionsDir([
        { name: 'a.jsonl', mtime: now - 4000 },
      ]);
      const state: WatermarkState = { value: 0 };
      const result = await new BootScanRunner().run({
        pipeline: 'memory',
        workspaceRoot: '/ws',
        workspaceFingerprint: 'fp1',
        sessionsDirectory: dir,
        sqlite: makeSqlite(state),
        logger: makeLogger(),
        run: jest.fn().mockResolvedValue('ran'),
        throttleMs: 0,
      });
      expect(result.succeeded).toBe(1);
      expect(result.stalled).toBe(0);
      expect(Math.floor(state.value)).toBeGreaterThanOrEqual(now - 4000 - 1);
    });
  });

  /**
   * TASK_2026_319 — a cold start is bounded to the last 7 days.
   *
   * With no persisted row the watermark used to be `0`, so `mtime > watermark`
   * admitted every session file on disk and the FIRST launch in a workspace
   * curated that project's entire Claude history, one LLM call each. Steady
   * state hid it: once the watermark advances there is nothing left to scan.
   */
  describe('the cold-start floor (TASK_2026_319)', () => {
    it('makes a session older than 7 days ineligible, and one inside the window eligible', async () => {
      const now = Date.now();
      const dir = await makeTempSessionsDir([
        { name: 'ancient.jsonl', mtime: now - 30 * DAY_MS },
        { name: 'lastweek.jsonl', mtime: now - 8 * DAY_MS },
        { name: 'recent.jsonl', mtime: now - 2 * DAY_MS },
      ]);
      const state: WatermarkState = { value: 0 };
      const run = jest.fn().mockResolvedValue('ran');
      const result = await new BootScanRunner().run({
        pipeline: 'memory',
        workspaceRoot: '/ws',
        workspaceFingerprint: 'fp1',
        sessionsDirectory: dir,
        sqlite: makeSqlite(state),
        logger: makeLogger(),
        run,
        throttleMs: 0,
        now,
      });
      expect(result.scanned).toBe(1);
      expect(run).toHaveBeenCalledTimes(1);
      expect(run).toHaveBeenCalledWith('recent', '/ws', undefined);
    });

    it('uses a PERSISTED watermark verbatim, even one older than 7 days', async () => {
      // Flooring a live watermark FORWARD would silently skip every session
      // between the real mark and `now - 7 days` — the sessions the scan
      // exists to pick up. The floor is for absence only.
      const now = Date.now();
      const dir = await makeTempSessionsDir([
        { name: 'before.jsonl', mtime: now - 40 * DAY_MS },
        { name: 'after.jsonl', mtime: now - 20 * DAY_MS },
      ]);
      const run = jest.fn().mockResolvedValue('ran');
      const result = await new BootScanRunner().run({
        pipeline: 'memory',
        workspaceRoot: '/ws',
        workspaceFingerprint: 'fp1',
        sessionsDirectory: dir,
        sqlite: makeSqliteWithRow(now - 30 * DAY_MS),
        logger: makeLogger(),
        run,
        throttleMs: 0,
        now,
      });
      expect(result.scanned).toBe(1);
      expect(run).toHaveBeenCalledWith('after', '/ws', undefined);
    });

    it('honours a persisted watermark of 0 — a stored zero is not an absent row', async () => {
      const now = Date.now();
      const dir = await makeTempSessionsDir([
        { name: 'ancient.jsonl', mtime: now - 30 * DAY_MS },
      ]);
      const run = jest.fn().mockResolvedValue('ran');
      const result = await new BootScanRunner().run({
        pipeline: 'memory',
        workspaceRoot: '/ws',
        workspaceFingerprint: 'fp1',
        sessionsDirectory: dir,
        sqlite: makeSqliteWithRow(0),
        logger: makeLogger(),
        run,
        throttleMs: 0,
        now,
      });
      expect(result.scanned).toBe(1);
      expect(run).toHaveBeenCalledWith('ancient', '/ws', undefined);
    });

    it('treats a watermark read that THROWS as cold, so it floors rather than scanning everything', async () => {
      const now = Date.now();
      const dir = await makeTempSessionsDir([
        { name: 'ancient.jsonl', mtime: now - 30 * DAY_MS },
        { name: 'recent.jsonl', mtime: now - 2 * DAY_MS },
      ]);
      const state: WatermarkState = { value: 0 };
      const logger = makeLogger();
      const run = jest.fn().mockResolvedValue('ran');
      const result = await new BootScanRunner().run({
        pipeline: 'memory',
        workspaceRoot: '/ws',
        workspaceFingerprint: 'fp1',
        sessionsDirectory: dir,
        sqlite: makeSqliteReadThrows(state),
        logger,
        run,
        throttleMs: 0,
        now,
      });
      expect(result.scanned).toBe(1);
      expect(run).toHaveBeenCalledWith('recent', '/ws', undefined);
      expect(logger.warn).toHaveBeenCalledWith(
        '[boot-scan] watermark read failed — treating as cold',
        expect.objectContaining({ error: expect.stringContaining('SQLITE') }),
      );
    });

    it('applies the same floor to the skills pipeline', async () => {
      // The runner is shared. Neither pipeline should reach back into history
      // the user accumulated before Ptah existed.
      const now = Date.now();
      const dir = await makeTempSessionsDir([
        { name: 'ancient.jsonl', mtime: now - 30 * DAY_MS },
        { name: 'recent.jsonl', mtime: now - 1 * DAY_MS },
      ]);
      const state: WatermarkState = { value: 0 };
      const run = jest.fn().mockResolvedValue('ran');
      const result = await new BootScanRunner().run({
        pipeline: 'skills',
        workspaceRoot: '/ws',
        workspaceFingerprint: 'fp1',
        sessionsDirectory: dir,
        sqlite: makeSqlite(state),
        logger: makeLogger(),
        run,
        throttleMs: 0,
        now,
      });
      expect(result.scanned).toBe(1);
      expect(run).toHaveBeenCalledWith('recent', '/ws', undefined);
    });

    it('writes NO watermark when the 7-day window is empty, so the next boot re-floors', async () => {
      // The rolling half of the design. `maxMtime > watermark` is false when
      // nothing ran, so no row is written and the next cold read floors to a
      // fresh `now - 7 days` rather than freezing this boot's floor forever.
      const now = Date.now();
      const dir = await makeTempSessionsDir([
        { name: 'ancient.jsonl', mtime: now - 30 * DAY_MS },
      ]);
      const state: WatermarkState = { value: 0 };
      const run = jest.fn().mockResolvedValue('ran');
      const result = await new BootScanRunner().run({
        pipeline: 'memory',
        workspaceRoot: '/ws',
        workspaceFingerprint: 'fp1',
        sessionsDirectory: dir,
        sqlite: makeSqlite(state),
        logger: makeLogger(),
        run,
        throttleMs: 0,
        now,
      });
      expect(result.scanned).toBe(0);
      expect(run).not.toHaveBeenCalled();
      expect(state.value).toBe(0);
    });

    it('still advances the watermark when the cold window DOES hold sessions', async () => {
      // The paired positive: the floor must bound the scan, not disable it.
      const now = Date.now();
      const dir = await makeTempSessionsDir([
        { name: 'a.jsonl', mtime: now - 3 * DAY_MS },
        { name: 'b.jsonl', mtime: now - 1 * DAY_MS },
      ]);
      const state: WatermarkState = { value: 0 };
      const result = await new BootScanRunner().run({
        pipeline: 'memory',
        workspaceRoot: '/ws',
        workspaceFingerprint: 'fp1',
        sessionsDirectory: dir,
        sqlite: makeSqlite(state),
        logger: makeLogger(),
        run: jest.fn().mockResolvedValue('ran'),
        throttleMs: 0,
        now,
      });
      expect(result.succeeded).toBe(2);
      expect(Math.floor(state.value)).toBeGreaterThanOrEqual(
        now - 1 * DAY_MS - 1,
      );
    });
  });

  it('logs a warning when the watermark write throws (Moderate-4)', async () => {
    const now = Date.now();
    const dir = await makeTempSessionsDir([
      { name: 's1.jsonl', mtime: now - 5000 },
    ]);
    const logger = makeLogger();
    const sqlite = {
      db: {
        prepare: jest.fn((sql: string) => {
          if (sql.includes('SELECT last_scanned_session_mtime')) {
            return { get: jest.fn(() => undefined) };
          }
          return {
            run: jest.fn(() => {
              throw new Error('SQLITE_BUSY: database is locked');
            }),
          };
        }),
      },
      isOpen: true,
    } as unknown as SqliteConnectionService;
    await new BootScanRunner().run({
      pipeline: 'memory',
      workspaceRoot: '/ws',
      workspaceFingerprint: 'fp1',
      sessionsDirectory: dir,
      sqlite,
      logger,
      run: jest.fn().mockResolvedValue(undefined),
      throttleMs: 0,
    });
    expect(logger.warn).toHaveBeenCalledWith(
      '[boot-scan] watermark write failed',
      expect.objectContaining({
        pipeline: 'memory',
        error: expect.stringContaining('SQLITE_BUSY'),
      }),
    );
  });
});
