import 'reflect-metadata';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { Logger } from '@ptah-extension/vscode-core';
import type {
  IFileSystemProvider,
  IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import type {
  SqliteConnectionService,
  SqliteDatabase,
} from '@ptah-extension/persistence-sqlite';
import type { ITranscriptReader } from '@ptah-extension/memory-contracts';
import type { JsonlReaderService } from '@ptah-extension/agent-sdk';
import { CuratorRateLimitService } from '@ptah-extension/agent-sdk';
import { MemoryTriggerService } from './memory-trigger.service';
import type { MemoryCuratorService } from '../memory-curator.service';
import type { ObservationQueueStore } from '../observation-queue.store';

/**
 * TASK_2026_319, defect 2 — the boot scan draws from the hourly curate budget.
 *
 * `runBootScan` calls `curator.curate` directly, and `curate` holds no limiter
 * of its own, so `maxCuratesPerHour` did not apply to it at all: the cue path
 * and the episode path were budgeted, the one path that could fire once per
 * session at startup was not.
 *
 * These tests drive the REAL `CuratorRateLimitService` and the REAL
 * `BootScanRunner` through `MemoryTriggerService.start()`, because the property
 * under test is the interaction between them — a refusal must reach the runner
 * as `'stalled'` so the watermark stays put and the session is retried.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

interface CuratorEventLike {
  readonly kind: string;
  readonly sessionId?: string;
  readonly stats?: Readonly<Record<string, unknown>>;
}

function makeLogger(): Logger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as Logger;
}

/** Every callback registry the service subscribes to, reduced to a no-op. */
function makeRegistry(): unknown {
  return {
    register: jest.fn(() => () => undefined),
    notifyAll: jest.fn(),
    size: 0,
  };
}

interface WatermarkState {
  value: number | null;
}

function makeSqlite(state: WatermarkState): SqliteConnectionService {
  const db = {
    prepare: jest.fn((sql: string) => {
      if (sql.includes('SELECT last_scanned_session_mtime')) {
        return {
          get: jest.fn(() =>
            state.value === null
              ? undefined
              : { last_scanned_session_mtime: state.value },
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
  return { db, isOpen: true } as unknown as SqliteConnectionService;
}

function makeWorkspace(maxCuratesPerHour: number): IWorkspaceProvider {
  const cfg: Record<string, unknown> = {
    'memory.triggers.bootScan': true,
    'memory.triggers.idleMs': 600000,
    'memory.triggers.maxCuratesPerHour': maxCuratesPerHour,
    'memory.triggers.maxObservationsPerCurate': 500,
  };
  return {
    getWorkspaceRoot: jest.fn(() => '/ws'),
    getWorkspaceFolders: jest.fn(() => ['/ws']),
    getConfiguration: jest.fn(
      (_section: string, key: string, def: unknown) => cfg[key] ?? def,
    ),
    setConfiguration: jest.fn().mockResolvedValue(undefined),
    onDidChangeConfiguration: jest.fn(),
    onDidChangeWorkspaceFolders: jest.fn(),
  } as unknown as IWorkspaceProvider;
}

interface Harness {
  service: MemoryTriggerService;
  curate: jest.Mock;
  events: CuratorEventLike[];
  /** Resolves once the runner has published its terminal `boot-scan` event. */
  bootScanDone: Promise<void>;
}

function buildHarness(opts: {
  sessionsDir: string;
  sqlite: SqliteConnectionService;
  rateLimiter: CuratorRateLimitService;
  maxCuratesPerHour: number;
}): Harness {
  const events: CuratorEventLike[] = [];
  let settle: (() => void) | null = null;
  const bootScanDone = new Promise<void>((resolve) => {
    settle = resolve;
  });
  const curate = jest.fn().mockResolvedValue({
    outcome: 'ran',
    extracted: 0,
    merged: 0,
    created: 0,
    skipped: 0,
  });
  const curator = {
    curate,
    pushEvent: jest.fn((event: CuratorEventLike) => {
      events.push(event);
      if (event.kind === 'boot-scan' || event.kind === 'error') settle?.();
    }),
    recentEvents: jest.fn(() => []),
    lastRunInfo: jest.fn(() => ({ at: null, stats: null })),
    rekeySession: jest.fn(),
  } as unknown as MemoryCuratorService;

  const service = new MemoryTriggerService(
    makeLogger(),
    curator,
    makeRegistry() as never,
    makeRegistry() as never,
    makeWorkspace(opts.maxCuratesPerHour),
    {} as unknown as IFileSystemProvider,
    opts.sqlite,
    {
      findSessionsDirectory: jest.fn().mockResolvedValue(opts.sessionsDir),
    } as unknown as JsonlReaderService,
    makeRegistry() as never,
    makeRegistry() as never,
    makeRegistry() as never,
    makeRegistry() as never,
    makeRegistry() as never,
    opts.rateLimiter,
    {
      enqueue: jest.fn(),
      flush: jest.fn(),
      drainForSession: jest.fn(() => []),
      markProcessed: jest.fn(),
      purgeOlderThan: jest.fn(() => 0),
      countUnprocessed: jest.fn(() => 0),
      backfillSessionId: jest.fn(() => 0),
    } as unknown as ObservationQueueStore,
    makeRegistry() as never,
    { read: jest.fn().mockResolvedValue('') } as unknown as ITranscriptReader,
    makeRegistry() as never,
  );

  return { service, curate, events, bootScanDone };
}

async function makeSessionsDir(
  files: { name: string; mtime: number }[],
): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'boot-budget-test-'));
  for (const f of files) {
    const full = path.join(dir, f.name);
    await fs.writeFile(full, '{}\n');
    await fs.utimes(full, new Date(f.mtime), new Date(f.mtime));
  }
  return dir;
}

describe('MemoryTriggerService boot scan — the hourly curate budget (TASK_2026_319)', () => {
  const now = Date.now();

  it('stops the scan, leaves the watermark unmoved and emits rate-limited when the budget runs out', async () => {
    const dir = await makeSessionsDir([
      { name: 'older.jsonl', mtime: now - 3 * DAY_MS },
      { name: 'newer.jsonl', mtime: now - 1 * DAY_MS },
    ]);
    const state: WatermarkState = { value: null };
    const h = buildHarness({
      sessionsDir: dir,
      sqlite: makeSqlite(state),
      rateLimiter: new CuratorRateLimitService(makeLogger()),
      maxCuratesPerHour: 1,
    });

    h.service.start();
    await h.bootScanDone;

    // One session bought the single available permit; the second was refused
    // and must NOT have reached the curator.
    expect(h.curate).toHaveBeenCalledTimes(1);
    expect(h.curate.mock.calls[0][0].sessionId).toBe('older');

    const limited = h.events.find((e) => e.kind === 'rate-limited');
    expect(limited).toBeDefined();
    expect(limited?.sessionId).toBe('newer');
    expect(limited?.stats?.source).toBe('boot');
    expect(limited?.stats?.limit).toBe(1);

    const bootScan = h.events.find((e) => e.kind === 'boot-scan');
    expect(bootScan?.stats?.stalled).toBe(1);
    expect(bootScan?.stats?.succeeded).toBe(1);

    // The watermark stops at the session that actually ran, never past the
    // refused one — the refusal must not be recorded as work done.
    expect(state.value).not.toBeNull();
    expect(Math.floor(state.value as number)).toBeLessThan(now - 1 * DAY_MS);

    h.service.stop();
  });

  it('the refused session is eligible again on the next boot — nothing was lost', async () => {
    const dir = await makeSessionsDir([
      { name: 'older.jsonl', mtime: now - 3 * DAY_MS },
      { name: 'newer.jsonl', mtime: now - 1 * DAY_MS },
    ]);
    const state: WatermarkState = { value: null };
    const sqlite = makeSqlite(state);

    const first = buildHarness({
      sessionsDir: dir,
      sqlite,
      rateLimiter: new CuratorRateLimitService(makeLogger()),
      maxCuratesPerHour: 1,
    });
    first.service.start();
    await first.bootScanDone;
    first.service.stop();
    expect(first.curate).toHaveBeenCalledTimes(1);

    // Next boot, budget restored, same watermark row.
    const second = buildHarness({
      sessionsDir: dir,
      sqlite,
      rateLimiter: new CuratorRateLimitService(makeLogger()),
      maxCuratesPerHour: 10,
    });
    second.service.start();
    await second.bootScanDone;

    expect(second.curate).toHaveBeenCalledTimes(1);
    expect(second.curate.mock.calls[0][0].sessionId).toBe('newer');
    second.service.stop();
  });

  it('with budget available the scan still runs every session and still advances the watermark', async () => {
    // The paired positive. Without it, "the scan must stop" could be satisfied
    // forever by a boot scan that never does anything.
    const dir = await makeSessionsDir([
      { name: 'a.jsonl', mtime: now - 4 * DAY_MS },
      { name: 'b.jsonl', mtime: now - 2 * DAY_MS },
    ]);
    const state: WatermarkState = { value: null };
    const h = buildHarness({
      sessionsDir: dir,
      sqlite: makeSqlite(state),
      rateLimiter: new CuratorRateLimitService(makeLogger()),
      maxCuratesPerHour: 20,
    });

    h.service.start();
    await h.bootScanDone;

    expect(h.curate).toHaveBeenCalledTimes(2);
    expect(h.events.some((e) => e.kind === 'rate-limited')).toBe(false);
    const bootScan = h.events.find((e) => e.kind === 'boot-scan');
    expect(bootScan?.stats?.succeeded).toBe(2);
    expect(bootScan?.stats?.stalled).toBe(0);
    expect(Math.floor(state.value as number)).toBeGreaterThanOrEqual(
      now - 2 * DAY_MS - 1,
    );

    h.service.stop();
  });

  it('bounds the cold start to the last 7 days — history predating Ptah is never curated', async () => {
    const dir = await makeSessionsDir([
      { name: 'ancient.jsonl', mtime: now - 60 * DAY_MS },
      { name: 'recent.jsonl', mtime: now - 1 * DAY_MS },
    ]);
    const state: WatermarkState = { value: null };
    const h = buildHarness({
      sessionsDir: dir,
      sqlite: makeSqlite(state),
      rateLimiter: new CuratorRateLimitService(makeLogger()),
      maxCuratesPerHour: 20,
    });

    h.service.start();
    await h.bootScanDone;

    expect(h.curate).toHaveBeenCalledTimes(1);
    expect(h.curate.mock.calls[0][0].sessionId).toBe('recent');

    h.service.stop();
  });
});
