/**
 * MemoryRetentionService — gates, budgets, outcomes (fake store, fake
 * reclaimer, fake clock). The real-SQLite proof is
 * `memory-retention.integration.spec.ts`.
 */
import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  FILE_BASED_SETTINGS_DEFAULTS,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import type {
  SqliteConnectionService,
  SqlitePageReclaimer,
  SqlitePageStats,
} from '@ptah-extension/persistence-sqlite';
import { MemoryRetentionService } from './memory-retention.service';
import {
  MEMORY_RETENTION_DEFAULTS,
  MEMORY_RETENTION_KEYS,
  MEMORY_RETENTION_LIMITS,
  readMemoryRetentionSettings,
  type MemoryRetentionLimits,
} from './memory-retention-config';
import type {
  MemoryRetentionRunOptions,
  MemoryRetentionRunReport,
} from './memory-retention.types';
import {
  RetentionStepError,
  type LiveStorageReading,
  type ObservationRetentionStore,
  type RetentionRunRecord,
  type RetentionState,
} from './observation-retention.store';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function makeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

function makeWorkspace(
  values: Record<string, unknown> = {},
): IWorkspaceProvider {
  return {
    getConfiguration: jest.fn((_section: string, key: string, def?: unknown) =>
      key in values ? values[key] : def,
    ),
  } as unknown as IWorkspaceProvider;
}

interface Clock {
  t: number;
}

/**
 * In-memory stand-in for the store. `processed` / `stuck` are the eligible
 * counts; every call is recorded in `calls` so step order can be asserted.
 */
class FakeStore {
  processed = 0;
  stuck = 0;
  state: RetentionState | null = null;
  calls: string[] = [];
  purgeLimits: number[] = [];
  runs: RetentionRunRecord[] = [];
  skips: Array<{ at: number; reason: string }> = [];
  totalRows = 100;
  pendingRows: number | null = 40;
  /** Advance the clock by this much inside each row batch. */
  batchCostMs = 0;
  onPurge: ((call: number) => void) | null = null;
  private purgeCalls = 0;

  constructor(
    private readonly clock: Clock,
    private readonly reclaimer: FakeReclaimer,
  ) {}

  purgeProcessedBatch(_cutoff: number, limit: number, _cursor: string) {
    this.calls.push('purge');
    this.purgeLimits.push(limit);
    this.purgeCalls++;
    this.onPurge?.(this.purgeCalls);
    this.clock.t += this.batchCostMs;
    const deleted = Math.min(limit, this.processed);
    this.processed -= deleted;
    this.reclaimer.freelist += deleted;
    return { deleted, nextCursor: 's', exhausted: this.processed === 0 };
  }

  quarantineStuckBatch(_cutoff: number, limit: number, _now: number) {
    this.calls.push('quarantine');
    this.clock.t += this.batchCostMs;
    const quarantined = Math.min(limit, this.stuck);
    this.stuck -= quarantined;
    return { quarantined, payloadBytes: quarantined * 10 };
  }

  pruneLedger(_olderThan: number, _maxRows: number) {
    this.calls.push('prune');
    return { pruned: 2 };
  }

  readLiveStorage(_cutoff: number): LiveStorageReading {
    return {
      pendingRows: this.pendingRows,
      pendingBytes: 1000,
      oldestPendingAt: 5,
      stuckEligibleRows: this.stuck,
      quarantineLedgerRows: 4,
      readErrors: [],
    };
  }

  countTotalRows(): number {
    return this.totalRows;
  }

  readState(): RetentionState | null {
    this.calls.push('readState');
    return this.state;
  }

  writeRun(record: RetentionRunRecord): void {
    this.calls.push('writeRun');
    this.runs.push(record);
  }

  writeSkip(at: number, reason: string): void {
    this.calls.push('writeSkip');
    this.skips.push({ at, reason });
  }
}

class FakeReclaimer {
  freelist = 0;
  pageSize = 4096;
  autoVacuumMode = 2;
  stepCostMs = 1;
  steps: number[] = [];
  checkpoints = 0;

  constructor(private readonly log: string[]) {}

  readPageStats(): SqlitePageStats {
    return {
      pageSize: this.pageSize,
      pageCount: 10_000,
      freelistCount: this.freelist,
      autoVacuumMode: this.autoVacuumMode,
    };
  }

  reclaimStep(maxPages: number) {
    this.log.push('reclaim');
    this.steps.push(maxPages);
    const pagesReclaimed = Math.min(maxPages, this.freelist);
    this.freelist -= pagesReclaimed;
    return { pagesReclaimed, durationMs: this.stepCostMs };
  }

  checkpointPassive(): void {
    this.log.push('checkpoint');
    this.checkpoints++;
  }
}

function state(overrides: Partial<RetentionState> = {}): RetentionState {
  return {
    lastStartedAt: null,
    lastFinishedAt: null,
    lastOutcome: null,
    lastReason: null,
    lastError: null,
    lastDurationMs: null,
    processedPurged: 0,
    stuckQuarantined: 0,
    ledgerPruned: 0,
    freedBytes: 0,
    pagesReclaimed: 0,
    backlogRemaining: false,
    lastCompletedAt: null,
    processedRowsAfter: null,
    avgProcessedRowBytes: null,
    lastSkippedAt: null,
    lastSkipReason: null,
    ...overrides,
  };
}

function harness(
  opts: {
    settings?: Record<string, unknown>;
    limits?: Partial<MemoryRetentionLimits>;
    dbThrows?: boolean;
  } = {},
) {
  const clock: Clock = { t: 0 };
  const log: string[] = [];
  const reclaimer = new FakeReclaimer(log);
  const store = new FakeStore(clock, reclaimer);
  // Steps from both fakes land in one ordered log.
  store.calls = log;
  const sqlite = {
    get db(): unknown {
      if (opts.dbThrows) throw new Error('PERSISTENCE_UNAVAILABLE');
      return {};
    },
  } as unknown as SqliteConnectionService;
  const logger = makeLogger();
  const service = new MemoryRetentionService(
    logger,
    makeWorkspace(opts.settings),
    sqlite,
    reclaimer as unknown as SqlitePageReclaimer,
    store as unknown as ObservationRetentionStore,
    { ...MEMORY_RETENTION_LIMITS, ...opts.limits },
  );
  // Past the 10-minute boot deferral, measured from construction.
  clock.t = Date.now() + HOUR;
  const signal = new AbortController();
  let onBattery = false;
  let foregroundMs = Number.POSITIVE_INFINITY;
  const options: MemoryRetentionRunOptions = {
    signal: signal.signal,
    isOnBattery: () => onBattery,
    msSinceForegroundActivity: () => foregroundMs,
    now: () => clock.t,
  };
  return {
    clock,
    log,
    store,
    reclaimer,
    service,
    logger,
    options,
    abort: () => signal.abort(),
    setBattery: (v: boolean) => {
      onBattery = v;
    },
    setForegroundMs: (v: number) => {
      foregroundMs = v;
    },
  };
}

describe('memory retention settings', () => {
  it('defaults equal the platform-core FILE_BASED_SETTINGS_DEFAULTS entries (parity)', () => {
    expect(FILE_BASED_SETTINGS_DEFAULTS[MEMORY_RETENTION_KEYS.enabled]).toBe(
      MEMORY_RETENTION_DEFAULTS.enabled,
    );
    expect(
      FILE_BASED_SETTINGS_DEFAULTS[MEMORY_RETENTION_KEYS.processedDays],
    ).toBe(MEMORY_RETENTION_DEFAULTS.processedDays);
    expect(FILE_BASED_SETTINGS_DEFAULTS[MEMORY_RETENTION_KEYS.stuckDays]).toBe(
      MEMORY_RETENTION_DEFAULTS.stuckDays,
    );
    expect(FILE_BASED_SETTINGS_DEFAULTS[MEMORY_RETENTION_KEYS.batchSize]).toBe(
      MEMORY_RETENTION_DEFAULTS.batchSize,
    );
  });

  it('pins the measured reclaim step limits', () => {
    expect(MEMORY_RETENTION_LIMITS.reclaimPagesPerStep).toBe(256);
    expect(MEMORY_RETENTION_LIMITS.minReclaimPagesPerStep).toBe(64);
  });

  it('reads defaults when nothing is set', () => {
    expect(readMemoryRetentionSettings(makeWorkspace())).toEqual({
      enabled: true,
      processedDays: 7,
      stuckDays: 14,
      batchSize: 500,
    });
  });

  it('clamps out-of-range numbers and falls back on non-finite or mistyped values', () => {
    expect(
      readMemoryRetentionSettings(
        makeWorkspace({
          'memory.retention.enabled': 'no',
          'memory.retention.processedDays': 0,
          'memory.retention.stuckDays': 1,
          'memory.retention.batchSize': 1e9,
        }),
      ),
    ).toEqual({
      enabled: true,
      processedDays: 1,
      stuckDays: 7,
      batchSize: 5000,
    });
    expect(
      readMemoryRetentionSettings(
        makeWorkspace({
          'memory.retention.enabled': false,
          'memory.retention.processedDays': Number.NaN,
          'memory.retention.stuckDays': Number.POSITIVE_INFINITY,
          'memory.retention.batchSize': 10.9,
        }),
      ),
    ).toEqual({
      enabled: false,
      processedDays: 7,
      stuckDays: 14,
      batchSize: 50,
    });
    expect(
      readMemoryRetentionSettings(
        makeWorkspace({ 'memory.retention.processedDays': 400.7 }),
      ).processedDays,
    ).toBe(365);
  });
});

describe('MemoryRetentionService — gates', () => {
  it('disabled → skipped/disabled, recorded, no row work', async () => {
    const h = harness({ settings: { 'memory.retention.enabled': false } });
    h.store.processed = 10;
    await expect(h.service.run(h.options)).resolves.toEqual({
      status: 'skipped',
      reason: 'disabled',
    });
    expect(h.log).toEqual(['writeSkip']);
    expect(h.store.skips[0].reason).toBe('disabled');
  });

  it('boot-deferred within 10 minutes of construction', async () => {
    const h = harness();
    h.clock.t = Date.now() + 60_000;
    await expect(h.service.run(h.options)).resolves.toEqual({
      status: 'skipped',
      reason: 'boot-deferred',
    });
    expect(h.log).toEqual(['writeSkip']);
  });

  it('on-battery', async () => {
    const h = harness();
    h.setBattery(true);
    await expect(h.service.run(h.options)).resolves.toEqual({
      status: 'skipped',
      reason: 'on-battery',
    });
    expect(h.log).toEqual(['writeSkip']);
  });

  it('foreground-active when chat moved in the last 5 minutes', async () => {
    const h = harness();
    h.setForegroundMs(4 * 60_000);
    await expect(h.service.run(h.options)).resolves.toEqual({
      status: 'skipped',
      reason: 'foreground-active',
    });
    expect(h.log).toEqual(['writeSkip']);
  });

  it('aborted', async () => {
    const h = harness();
    h.abort();
    await expect(h.service.run(h.options)).resolves.toEqual({
      status: 'skipped',
      reason: 'aborted',
    });
  });

  it('persistence-unavailable writes nothing', async () => {
    const h = harness({ dbThrows: true });
    await expect(h.service.run(h.options)).resolves.toEqual({
      status: 'skipped',
      reason: 'persistence-unavailable',
    });
    expect(h.log).toEqual([]);
  });

  it('not-due costs one state read and writes nothing', async () => {
    const h = harness();
    h.store.processed = 10;
    h.store.state = state({ lastCompletedAt: h.clock.t - 23 * HOUR });
    await expect(h.service.run(h.options)).resolves.toEqual({
      status: 'skipped',
      reason: 'not-due',
    });
    expect(h.log).toEqual(['readState']);
  });

  it('is due after 24 h, and immediately when the last run left a backlog', async () => {
    const h = harness();
    h.store.state = state({ lastCompletedAt: h.clock.t - 25 * HOUR });
    expect((await h.service.run(h.options)).status).toBe('completed');

    const b = harness();
    b.store.state = state({
      lastCompletedAt: b.clock.t - HOUR,
      backlogRemaining: true,
    });
    expect((await b.service.run(b.options)).status).toBe('completed');
  });

  it('a concurrent second run returns already-running; the flag clears afterwards', async () => {
    const h = harness();
    h.store.processed = 1000;
    h.store.stuck = 0;
    const first = h.service.run(h.options);
    const second = await h.service.run(h.options);
    expect(second).toEqual({ status: 'skipped', reason: 'already-running' });
    expect((await first).status).toBe('completed');
    h.store.state = null;
    expect((await h.service.run(h.options)).status).toBe('completed');
  });
});

describe('MemoryRetentionService — run', () => {
  it('runs purge → quarantine → prune → reclaim → checkpoint → record, and completes', async () => {
    const h = harness();
    h.store.processed = 1200;
    h.store.stuck = 300;
    const report = (await h.service.run(h.options)) as MemoryRetentionRunReport;

    expect(report).toEqual({
      status: 'completed',
      reason: null,
      processedPurged: 1200,
      stuckQuarantined: 300,
      ledgerPruned: 2,
      freedBytes: 1200 * 4096,
      pagesReclaimed: 1200,
      backlogRemaining: false,
      durationMs: 0,
      error: null,
    });
    const order = h.log.filter((c, i, all) => all[i - 1] !== c);
    expect(order).toEqual([
      'readState',
      'purge',
      'quarantine',
      'prune',
      'reclaim',
      'checkpoint',
      'writeRun',
    ]);
    expect(h.store.purgeLimits).toEqual([500, 500, 500]);
    const record = h.store.runs[0];
    expect(record).toMatchObject({
      outcome: 'completed',
      completedAt: h.clock.t,
      backlogRemaining: false,
      processedRowsAfter: 60,
      avgProcessedRowBytes: 4096,
    });
  });

  it('halves the batch size after a batch slower than 120 ms, down to the floor of 50', async () => {
    const h = harness();
    h.store.processed = 2000;
    h.store.batchCostMs = 200;
    const report = (await h.service.run(h.options)) as MemoryRetentionRunReport;
    expect(report.status).toBe('completed');
    expect(h.store.purgeLimits.slice(0, 6)).toEqual([
      500, 250, 125, 62, 50, 50,
    ]);
  });

  it('halves the reclaim step after a slow step, down to 64', async () => {
    const h = harness();
    h.store.processed = 5000;
    h.reclaimer.stepCostMs = 500;
    await h.service.run(h.options);
    expect(h.reclaimer.steps.slice(0, 4)).toEqual([256, 128, 64, 64]);
  });

  it('the row cap stops the row steps partial with a backlog, and still reclaims', async () => {
    const h = harness({ limits: { maxRowsPerRun: 250 } });
    h.store.processed = 400;
    h.store.stuck = 50;
    const report = (await h.service.run(h.options)) as MemoryRetentionRunReport;
    expect(report).toMatchObject({
      status: 'partial',
      reason: 'row-budget',
      processedPurged: 250,
      stuckQuarantined: 0,
      backlogRemaining: true,
      pagesReclaimed: 250,
    });
    expect(h.log).not.toContain('quarantine');
    expect(h.store.runs[0]).toMatchObject({
      outcome: 'partial',
      completedAt: null,
      backlogRemaining: true,
    });
  });

  it('the wall budget stops the run partial', async () => {
    const h = harness({ limits: { maxRunMs: 1000 } });
    h.store.processed = 5000;
    h.store.batchCostMs = 400;
    const report = (await h.service.run(h.options)) as MemoryRetentionRunReport;
    expect(report.status).toBe('partial');
    expect(report.reason).toBe('time-budget');
    expect(report.processedPurged).toBeGreaterThan(0);
    expect(h.log).not.toContain('prune');
    expect(h.log).not.toContain('reclaim');
  });

  it('a mid-run foreground change stops after the current batch', async () => {
    const h = harness();
    h.store.processed = 5000;
    h.store.onPurge = (call) => {
      if (call === 2) h.setForegroundMs(1000);
    };
    const report = (await h.service.run(h.options)) as MemoryRetentionRunReport;
    expect(report).toMatchObject({
      status: 'partial',
      reason: 'foreground-active',
      processedPurged: 1000,
      backlogRemaining: true,
    });
    expect(h.store.purgeLimits).toHaveLength(2);
  });

  it('the reclaim page cap ends the run partial so the next hour continues', async () => {
    const h = harness({ limits: { maxReclaimPagesPerRun: 3000 } });
    h.store.processed = 5000;
    const report = (await h.service.run(h.options)) as MemoryRetentionRunReport;
    expect(report).toMatchObject({
      status: 'partial',
      reason: 'reclaim-budget',
      pagesReclaimed: 3000,
    });
    expect(h.reclaimer.checkpoints).toBe(1);
  });

  it('a reclaim step that frees nothing while a freelist remains stops once, partial / reclaim-stalled', async () => {
    const h = harness();
    h.reclaimer.freelist = 100;
    h.reclaimer.autoVacuumMode = 2;
    // A regression that loops on zero progress would spin forever; the second
    // call aborts the run so such a regression fails on the call count below
    // instead of hanging the suite.
    const reclaimStep = jest.fn((maxPages: number) => {
      h.reclaimer.steps.push(maxPages);
      if (reclaimStep.mock.calls.length >= 2) h.abort();
      return { pagesReclaimed: 0, durationMs: 1 };
    });
    h.reclaimer.reclaimStep = reclaimStep;

    const report = (await h.service.run(h.options)) as MemoryRetentionRunReport;

    expect(reclaimStep).toHaveBeenCalledTimes(1);
    expect(reclaimStep).toHaveBeenCalledWith(100);
    expect(report).toMatchObject({
      status: 'partial',
      reason: 'reclaim-stalled',
      pagesReclaimed: 0,
      backlogRemaining: true,
      error: null,
    });
    expect(h.reclaimer.freelist).toBe(100);
    expect(h.reclaimer.checkpoints).toBe(1);
    expect(h.store.runs).toHaveLength(1);
    expect(h.store.runs[0]).toMatchObject({
      outcome: 'partial',
      reason: 'reclaim-stalled',
      backlogRemaining: true,
      completedAt: null,
    });
  });

  it('a degraded pre-purge page-stat sample records freedBytes 0 and keeps the previous average', async () => {
    const h = harness();
    h.store.state = state({ avgProcessedRowBytes: 777 });
    h.store.processed = 10;
    // Pre-existing free pages the purge did not create.
    h.reclaimer.freelist = 500;
    const realRead = h.reclaimer.readPageStats.bind(h.reclaimer);
    let reads = 0;
    h.reclaimer.readPageStats = (): SqlitePageStats => {
      reads++;
      // The first read is the pre-purge sample; it fails and degrades to zeros.
      if (reads === 1) {
        return {
          pageSize: 0,
          pageCount: 0,
          freelistCount: 0,
          autoVacuumMode: 0,
        };
      }
      return realRead();
    };

    const report = (await h.service.run(h.options)) as MemoryRetentionRunReport;

    // The post-purge sample was valid and held 510 free pages.
    expect(reads).toBeGreaterThanOrEqual(2);
    expect(report).toMatchObject({
      status: 'completed',
      processedPurged: 10,
      freedBytes: 0,
    });
    // `null` is the store's keep-previous value (COALESCE, pinned in
    // observation-retention.store.spec.ts), so the prior 777 survives.
    expect(h.store.runs[0]).toMatchObject({
      processedPurged: 10,
      freedBytes: 0,
      avgProcessedRowBytes: null,
    });
  });

  it('page-stat samples with different page sizes are not compared', async () => {
    const h = harness();
    h.store.processed = 10;
    h.reclaimer.freelist = 5;
    const realRead = h.reclaimer.readPageStats.bind(h.reclaimer);
    let reads = 0;
    h.reclaimer.readPageStats = (): SqlitePageStats => {
      reads++;
      const stats = realRead();
      return reads === 1 ? { ...stats, pageSize: 1024 } : stats;
    };

    const report = (await h.service.run(h.options)) as MemoryRetentionRunReport;

    expect(report.freedBytes).toBe(0);
    expect(h.store.runs[0].avgProcessedRowBytes).toBeNull();
  });

  it('skips reclaim with a reason when the file is not in incremental auto-vacuum', async () => {
    const h = harness();
    h.store.processed = 10;
    h.reclaimer.autoVacuumMode = 0;
    const report = (await h.service.run(h.options)) as MemoryRetentionRunReport;
    expect(report).toMatchObject({
      status: 'completed',
      reason: 'auto-vacuum-not-incremental',
      pagesReclaimed: 0,
    });
    expect(h.log).not.toContain('reclaim');
    expect(h.log).not.toContain('checkpoint');
  });

  it('a thrown store error fails the run, keeps earlier counts, sanitizes paths and clears the flag', async () => {
    const h = harness();
    h.store.processed = 5000;
    h.store.onPurge = (call) => {
      if (call === 3) {
        throw new RetentionStepError(
          'sql-error',
          'purge-processed',
          new Error(
            'disk I/O error at C:\\Users\\someone\\.ptah\\state\\ptah.sqlite',
          ),
        );
      }
    };
    const report = (await h.service.run(h.options)) as MemoryRetentionRunReport;
    expect(report).toMatchObject({
      status: 'failed',
      reason: 'sql-error',
      processedPurged: 1000,
      backlogRemaining: true,
    });
    expect(report.error).toContain('[path redacted]');
    expect(report.error).not.toContain('someone');
    expect(h.store.runs[0]).toMatchObject({
      outcome: 'failed',
      processedPurged: 1000,
      backlogRemaining: true,
      completedAt: null,
    });
    expect(h.logger.warn).toHaveBeenCalledTimes(1);

    h.store.onPurge = null;
    const next = await h.service.run(h.options);
    expect(next.status).not.toBe('skipped');
  });

  it('database-busy stops the run partial, not failed', async () => {
    const h = harness();
    h.store.processed = 5000;
    h.store.onPurge = (call) => {
      if (call === 2) {
        throw new RetentionStepError(
          'database-busy',
          'purge-processed',
          new Error('database is locked'),
        );
      }
    };
    const report = (await h.service.run(h.options)) as MemoryRetentionRunReport;
    expect(report).toMatchObject({
      status: 'partial',
      reason: 'database-busy',
      processedPurged: 500,
      error: null,
    });
  });

  it('never rejects when a gate input throws, and clears the flag', async () => {
    const h = harness();
    const throwing: MemoryRetentionRunOptions = {
      ...h.options,
      isOnBattery: () => {
        throw new Error('power monitor gone');
      },
    };
    await expect(h.service.run(throwing)).resolves.toMatchObject({
      status: 'failed',
      reason: 'unexpected-error',
    });
    expect((await h.service.run(h.options)).status).toBe('completed');
  });

  it('a failed run record write is logged, not thrown', async () => {
    const h = harness();
    h.store.writeRun = () => {
      throw new Error('SQLITE_BUSY');
    };
    await expect(h.service.run(h.options)).resolves.toMatchObject({
      status: 'completed',
    });
    expect(h.logger.warn).toHaveBeenCalled();
  });
});

describe('MemoryRetentionService — storageHealth', () => {
  it('maps live reads and the run record; nextDueAt is last_completed_at + 24 h', () => {
    const h = harness();
    h.reclaimer.freelist = 10;
    h.store.state = state({
      lastStartedAt: 1000,
      lastFinishedAt: 2000,
      lastOutcome: 'completed',
      lastDurationMs: 1000,
      processedPurged: 5,
      lastCompletedAt: 2000,
      processedRowsAfter: 60,
      avgProcessedRowBytes: 100,
      lastSkippedAt: 3000,
      lastSkipReason: 'foreground-active',
    });
    expect(h.service.storageHealth()).toEqual({
      dbBytes: 10_000 * 4096,
      reclaimableBytes: 10 * 4096,
      autoVacuumIncremental: true,
      observations: {
        pendingRows: 40,
        pendingBytes: 1000,
        oldestPendingAt: 5,
        stuckEligibleRows: 0,
        processedRows: 60,
        processedBytesEstimate: 6000,
        measuredAt: 2000,
        quarantineLedgerRows: 4,
      },
      retention: {
        enabled: true,
        processedDays: 7,
        stuckDays: 14,
        lastRun: {
          startedAt: 1000,
          finishedAt: 2000,
          outcome: 'completed',
          reason: null,
          error: null,
          durationMs: 1000,
          processedPurged: 5,
          stuckQuarantined: 0,
          ledgerPruned: 0,
          freedBytes: 0,
          pagesReclaimed: 0,
          backlogRemaining: false,
        },
        lastCompletedAt: 2000,
        nextDueAt: 2000 + DAY,
        lastSkippedAt: 3000,
        lastSkipReason: 'foreground-active',
      },
    });
  });

  it('nextDueAt is last_finished_at when a backlog remains, null when never ran', () => {
    const h = harness();
    h.store.state = state({
      lastStartedAt: 1,
      lastFinishedAt: 50,
      lastOutcome: 'partial',
      lastReason: 'row-budget',
      backlogRemaining: true,
    });
    expect(h.service.storageHealth().retention.nextDueAt).toBe(50);

    const n = harness();
    const health = n.service.storageHealth();
    expect(health.retention.nextDueAt).toBeNull();
    expect(health.retention.lastRun).toBeNull();
    expect(health.observations.processedRows).toBeNull();
    expect(health.observations.processedBytesEstimate).toBeNull();
  });

  it('never throws: unavailable page stats and a failed state read become nulls and readErrors', () => {
    const h = harness();
    h.reclaimer.pageSize = 0;
    h.store.readState = () => {
      throw new Error('no such table: memory_retention_state');
    };
    const health = h.service.storageHealth();
    expect(health.dbBytes).toBeNull();
    expect(health.reclaimableBytes).toBeNull();
    expect(health.autoVacuumIncremental).toBeNull();
    expect(health.retention.lastRun).toBeNull();
    expect(health.readErrors).toEqual([
      'pageStats: unavailable',
      'retentionState: no such table: memory_retention_state',
    ]);
  });
});
