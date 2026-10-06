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
import { ObservationRetentionStore } from '../retention/observation-retention.store';
import {
  openRetentionTestDb,
  removeRetentionTempDirs,
  type RetentionTestDb,
} from '../retention/retention-sqlite.test-support';
import { BOOT_SCAN_MAX_ATTEMPTS } from './boot-scan-failure-ledger';

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
    // TASK_2026_352 defers the scan by five minutes so it cannot run during the
    // host's first minutes. This suite is about the hourly BUDGET, not about
    // when the scan starts, so it opts out of the delay rather than driving a
    // timer — the deferral has its own spec.
    'memory.triggers.bootScanDelayMs': 0,
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
  /** The curator's open network back-off window (C14 f); default none. */
  networkDeferralMs?: number;
  /** What `curate` resolves; default a clean `ran`. */
  curateResult?: Record<string, unknown>;
}): Harness {
  const events: CuratorEventLike[] = [];
  let settle: (() => void) | null = null;
  const bootScanDone = new Promise<void>((resolve) => {
    settle = resolve;
  });
  const curate = jest.fn().mockResolvedValue(
    opts.curateResult ?? {
      outcome: 'ran',
      extracted: 0,
      merged: 0,
      created: 0,
      skipped: 0,
    },
  );
  const curator = {
    curate,
    networkDeferralMs: jest.fn(() => opts.networkDeferralMs ?? 0),
    pushEvent: jest.fn((event: CuratorEventLike) => {
      events.push(event);
      if (event.kind === 'boot-scan' || event.kind === 'error') settle?.();
    }),
    recentEvents: jest.fn(() => []),
    lastRunInfo: jest.fn(() => ({ at: null, stats: null })),
    forgetSession: jest.fn(),
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

  /**
   * TASK_2026_437 C14 (f). A boot-scan pass the network back-off would defer
   * spends no hourly slot: the scan stops before `tryAcquire`, and a pass
   * deferred at dispatch gives its slot back.
   */
  it('stops at an open network back-off window without spending a slot or moving the watermark', async () => {
    const dir = await makeSessionsDir([
      { name: 'a.jsonl', mtime: now - 2 * DAY_MS },
    ]);
    const state: WatermarkState = { value: null };
    const rateLimiter = new CuratorRateLimitService(makeLogger());
    const acquire = jest.spyOn(rateLimiter, 'tryAcquire');
    const h = buildHarness({
      sessionsDir: dir,
      sqlite: makeSqlite(state),
      rateLimiter,
      maxCuratesPerHour: 5,
      networkDeferralMs: 30_000,
    });

    h.service.start();
    await h.bootScanDone;

    expect(acquire).not.toHaveBeenCalled();
    expect(h.curate).not.toHaveBeenCalled();
    expect(h.events.find((e) => e.kind === 'boot-scan')?.stats?.stalled).toBe(
      1,
    );
    expect(state.value).toBeNull();
    h.service.stop();
  });

  it('refunds the slot of a boot-scan pass deferred at dispatch by the network back-off', async () => {
    const dir = await makeSessionsDir([
      { name: 'a.jsonl', mtime: now - 2 * DAY_MS },
    ]);
    const state: WatermarkState = { value: null };
    const rateLimiter = new CuratorRateLimitService(makeLogger());
    const h = buildHarness({
      sessionsDir: dir,
      sqlite: makeSqlite(state),
      rateLimiter,
      maxCuratesPerHour: 5,
      curateResult: {
        outcome: 'stalled',
        extracted: 0,
        merged: 0,
        created: 0,
        skipped: 0,
        deferral: 'network-backoff',
      },
    });

    h.service.start();
    await h.bootScanDone;

    expect(h.curate).toHaveBeenCalledTimes(1);
    expect(rateLimiter.snapshot('memory.curate')?.count).toBe(0);
    expect(state.value).toBeNull();
    h.service.stop();
  });
});

/**
 * TASK_2026_621. A boot-scan pass whose extract/resolve call failed curated
 * nothing. Reported as `'ran'`, it advanced the watermark and the next boot's
 * `mtime > watermark` filter skipped the session for good. Now the session is
 * recorded in the `memory_boot_scan_failures` ledger (migration 0052), the
 * watermark advances so later healthy sessions are never blocked, and later
 * boots retry it a bounded number of times.
 *
 * Real SQLite (the retention test harness, migrations 0014 + 0052 applied) and
 * the real `BootScanRunner`, driven through `MemoryTriggerService.start()`.
 */
describe('MemoryTriggerService boot scan — failed sessions go to the failure ledger (TASK_2026_621)', () => {
  const now = Date.now();
  const FAILED = {
    outcome: 'failed',
    extracted: 0,
    merged: 0,
    created: 0,
    skipped: 0,
  };
  const RAN = { ...FAILED, outcome: 'ran' };
  const opened: RetentionTestDb[] = [];

  afterEach(() => {
    for (const t of opened.splice(0)) t.close();
  });
  afterAll(() => removeRetentionTempDirs());

  function openDb(): RetentionTestDb {
    const t = openRetentionTestDb();
    opened.push(t);
    return t;
  }

  /** One boot: a fresh service over the same database and sessions dir. */
  async function boot(
    t: RetentionTestDb,
    dir: string,
    results: ReadonlyArray<Record<string, unknown>>,
  ): Promise<Harness> {
    const h = buildHarness({
      sessionsDir: dir,
      sqlite: t.connection,
      rateLimiter: new CuratorRateLimitService(makeLogger()),
      maxCuratesPerHour: 100,
    });
    for (const r of results) h.curate.mockResolvedValueOnce(r);
    h.service.start();
    await h.bootScanDone;
    h.service.stop();
    return h;
  }

  function ledgerRows(t: RetentionTestDb): Array<Record<string, unknown>> {
    return t.raw
      .prepare(
        'SELECT session_id, attempt_count, status, give_up_reason FROM memory_boot_scan_failures ORDER BY session_id',
      )
      .all() as Array<Record<string, unknown>>;
  }

  function watermark(t: RetentionTestDb): number | null {
    const row = t.raw
      .prepare(
        `SELECT last_scanned_session_mtime AS m FROM boot_scan_state WHERE pipeline = 'memory'`,
      )
      .get() as { m: number } | undefined;
    return row === undefined ? null : Number(row.m);
  }

  function sessionIds(h: Harness): string[] {
    return h.curate.mock.calls.map(
      (c) => (c[0] as { sessionId: string }).sessionId,
    );
  }

  it('a failed session does not block a later healthy session, and is recorded pending', async () => {
    const t = openDb();
    const dir = await makeSessionsDir([
      { name: 'failing.jsonl', mtime: now - 3 * DAY_MS },
      { name: 'healthy.jsonl', mtime: now - 1 * DAY_MS },
    ]);

    const h = await boot(t, dir, [FAILED, RAN]);

    expect(sessionIds(h)).toEqual(['failing', 'healthy']);
    const bootScan = h.events.find((e) => e.kind === 'boot-scan');
    expect(bootScan?.stats).toMatchObject({ failed: 1, succeeded: 1 });
    expect(watermark(t)).toBeGreaterThanOrEqual(now - 1 * DAY_MS - 1);
    expect(ledgerRows(t)).toEqual([
      {
        session_id: 'failing',
        attempt_count: 1,
        status: 'pending',
        give_up_reason: null,
      },
    ]);
  });

  it('retries the failed session on the next boot even though the watermark is past it; success removes the row', async () => {
    const t = openDb();
    const dir = await makeSessionsDir([
      { name: 'failing.jsonl', mtime: now - 3 * DAY_MS },
    ]);
    await boot(t, dir, [FAILED]);
    expect(ledgerRows(t)).toHaveLength(1);

    const second = await boot(t, dir, [RAN]);

    expect(sessionIds(second)).toEqual(['failing']);
    expect(
      second.events.find((e) => e.kind === 'boot-scan')?.stats,
    ).toMatchObject({ retried: 1, recovered: 1 });
    expect(ledgerRows(t)).toEqual([]);
  });

  it('marks the session given_up after the maximum attempts and counts it in diagnostics', async () => {
    const t = openDb();
    const dir = await makeSessionsDir([
      { name: 'failing.jsonl', mtime: now - 3 * DAY_MS },
    ]);
    // Attempt 1 in the scan, attempts 2 and 3 as retries on later boots.
    await boot(t, dir, [FAILED]);
    await boot(t, dir, [FAILED]);
    expect(ledgerRows(t)[0]).toMatchObject({
      attempt_count: 2,
      status: 'pending',
    });
    const third = await boot(t, dir, [FAILED]);
    expect(
      third.events.find((e) => e.kind === 'boot-scan')?.stats,
    ).toMatchObject({ retried: 1, givenUp: 1 });
    expect(ledgerRows(t)).toEqual([
      {
        session_id: 'failing',
        attempt_count: BOOT_SCAN_MAX_ATTEMPTS,
        status: 'given_up',
        give_up_reason: 'max-attempts',
      },
    ]);

    // A given-up session is not retried again.
    const fourth = await boot(t, dir, []);
    expect(fourth.curate).not.toHaveBeenCalled();

    const live = new ObservationRetentionStore(
      makeLogger(),
      t.connection,
    ).readLiveStorage(now);
    expect(live.bootScanFailuresPending).toBe(0);
    expect(live.bootScanFailuresGivenUp).toBe(1);
  });

  it('gives up on a session whose file no longer exists instead of retrying it forever', async () => {
    const t = openDb();
    const dir = await makeSessionsDir([
      { name: 'gone.jsonl', mtime: now - 3 * DAY_MS },
    ]);
    await boot(t, dir, [FAILED]);
    await fs.rm(path.join(dir, 'gone.jsonl'));

    const second = await boot(t, dir, []);

    expect(second.curate).not.toHaveBeenCalled();
    expect(ledgerRows(t)).toEqual([
      {
        session_id: 'gone',
        attempt_count: 1,
        status: 'given_up',
        give_up_reason: 'session-file-missing',
      },
    ]);
  });

  it('a gate stop during retries spends no attempt and does not start the scan', async () => {
    const t = openDb();
    const dir = await makeSessionsDir([
      { name: 'failing.jsonl', mtime: now - 3 * DAY_MS },
    ]);
    await boot(t, dir, [FAILED]);
    const before = watermark(t);
    // A later session appears, but the curator's gate stalls every pass.
    await fs.writeFile(path.join(dir, 'later.jsonl'), '{}\n');

    const h = buildHarness({
      sessionsDir: dir,
      sqlite: t.connection,
      rateLimiter: new CuratorRateLimitService(makeLogger()),
      maxCuratesPerHour: 100,
    });
    h.curate.mockResolvedValue({ ...FAILED, outcome: 'stalled' });
    h.service.start();
    await h.bootScanDone;
    h.service.stop();

    expect(h.curate).toHaveBeenCalledTimes(1);
    expect(ledgerRows(t)[0]).toMatchObject({
      attempt_count: 1,
      status: 'pending',
    });
    expect(watermark(t)).toBe(before);
  });
});
