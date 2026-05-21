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

function makeSqlite(state: WatermarkState): SqliteConnectionService {
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
  return { db } as unknown as SqliteConnectionService;
}

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
    expect(result).toEqual({ scanned: 0, succeeded: 0, skipped: 0 });
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
    expect(state.value).toBeGreaterThanOrEqual(now - 1000);
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
