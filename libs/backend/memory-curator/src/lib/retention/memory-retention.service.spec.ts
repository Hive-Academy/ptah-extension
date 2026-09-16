/**
 * MemoryRetentionService — gates, budgets, outcomes (fake store, fake
 * reclaimer, fake clock). The real-SQLite proof is
 * `memory-retention.integration.spec.ts`.
 */
import 'reflect-metadata';
import type {
  BackgroundWorkAdmission,
  Logger,
  WhenClearOptions,
  WhenClearOutcome,
} from '@ptah-extension/vscode-core';
import {
  FILE_BASED_SETTINGS_DEFAULTS,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import type {
  SqliteConnectionService,
  SqlitePageReclaimer,
  SqlitePageStats,
} from '@ptah-extension/persistence-sqlite';
import {
  MemoryRetentionService,
  sanitizeRetentionError,
} from './memory-retention.service';
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
import type {
  MemoryLifecycleStepResult,
  MemoryLifecycleService,
} from './memory-lifecycle.service';
import { MemoryLifecycleService as RealMemoryLifecycleService } from './memory-lifecycle.service';
import type { MemoryLifecycleStore } from './memory-lifecycle.store';
import type { MemoryStore } from '../memory.store';
import { RetentionRunBudget } from './retention-run-budget';
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
  onQuarantine: (() => void) | null = null;
  purgeCalls = 0;

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
    this.onQuarantine?.();
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
    this.state = state({
      lastStartedAt: record.startedAt,
      lastFinishedAt: record.finishedAt,
      lastOutcome: record.outcome,
      lastReason: record.reason,
      lastError: record.error,
      lastDurationMs: record.durationMs,
      processedPurged: record.processedPurged,
      stuckQuarantined: record.stuckQuarantined,
      ledgerPruned: record.ledgerPruned,
      freedBytes: record.freedBytes,
      pagesReclaimed: record.pagesReclaimed,
      backlogRemaining: record.backlogRemaining,
      lastCompletedAt: record.completedAt,
      processedRowsAfter: record.processedRowsAfter,
      avgProcessedRowBytes: record.avgProcessedRowBytes,
      memoriesArchived: record.memoriesArchived,
      memoriesDeleted: record.memoriesDeleted,
      memoriesEvicted: record.memoriesEvicted,
      lifecycleNote: record.lifecycleNote,
      previewMeasuredAt:
        record.preview?.measuredAt ?? this.state?.previewMeasuredAt ?? null,
      previewForRunAt:
        record.preview?.forRunAt ?? this.state?.previewForRunAt ?? null,
      previewArchiveEligible:
        record.preview?.archiveEligible ??
        this.state?.previewArchiveEligible ??
        null,
      previewDeleteEligible:
        record.preview?.deleteEligible ??
        this.state?.previewDeleteEligible ??
        null,
      previewOverCap:
        record.preview?.overCap ?? this.state?.previewOverCap ?? null,
      lastSkippedAt: this.state?.lastSkippedAt ?? null,
      lastSkipReason: this.state?.lastSkipReason ?? null,
    });
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

const EMPTY_LIFECYCLE_RESULT: MemoryLifecycleStepResult = {
  archived: 0,
  deleted: 0,
  evicted: 0,
  exhausted: true,
  stop: null,
  note: null,
  preview: null,
  readErrors: [],
  error: null,
};

class FakeLifecycle {
  calls: Array<{ budget: RetentionRunBudget; startedAt: number }> = [];
  result: MemoryLifecycleStepResult = EMPTY_LIFECYCLE_RESULT;
  implementation:
    | ((
        budget: RetentionRunBudget,
        startedAt: number,
      ) => Promise<MemoryLifecycleStepResult>)
    | null = null;

  constructor(private readonly log: string[]) {}

  async runStep(
    budget: RetentionRunBudget,
    startedAt: number,
  ): Promise<MemoryLifecycleStepResult> {
    this.log.push('lifecycle');
    this.calls.push({ budget, startedAt });
    return this.implementation
      ? this.implementation(budget, startedAt)
      : this.result;
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
    memoriesArchived: 0,
    memoriesDeleted: 0,
    memoriesEvicted: 0,
    lifecycleNote: null,
    previewMeasuredAt: null,
    previewForRunAt: null,
    previewArchiveEligible: null,
    previewDeleteEligible: null,
    previewOverCap: null,
    lastSkippedAt: null,
    lastSkipReason: null,
    ...overrides,
  };
}

class FakeGovernor implements BackgroundWorkAdmission {
  clear = true;
  whenClearCalls = 0;
  waiters: Array<{
    resolve: (outcome: WhenClearOutcome) => void;
    reject: (err: unknown) => void;
    options?: WhenClearOptions;
  }> = [];
  private onWait: (() => void) | null = null;

  isClear(): boolean {
    return this.clear;
  }

  whenClear(options?: WhenClearOptions): Promise<WhenClearOutcome> {
    this.whenClearCalls++;
    if (this.clear) return Promise.resolve('clear');
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject, options });
      this.onWait?.();
    });
  }

  waitForWaiter(): Promise<void> {
    if (this.waiters.length > 0) return Promise.resolve();
    return new Promise((resolve) => {
      this.onWait = () => {
        this.onWait = null;
        resolve();
      };
    });
  }

  release(outcome: WhenClearOutcome = 'clear'): void {
    if (outcome === 'clear') {
      this.clear = true;
    }
    const pending = this.waiters;
    this.waiters = [];
    for (const w of pending) w.resolve(outcome);
  }

  reject(error: unknown): void {
    const pending = this.waiters;
    this.waiters = [];
    for (const w of pending) w.reject(error);
  }
}

function harness(
  opts: {
    settings?: Record<string, unknown>;
    limits?: Partial<MemoryRetentionLimits>;
    dbThrows?: boolean;
    governor?: BackgroundWorkAdmission;
    lifecycle?: MemoryLifecycleService;
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
  const lifecycle = opts.lifecycle ?? new FakeLifecycle(log);
  const service = new MemoryRetentionService(
    logger,
    makeWorkspace(opts.settings),
    sqlite,
    reclaimer as unknown as SqlitePageReclaimer,
    store as unknown as ObservationRetentionStore,
    { ...MEMORY_RETENTION_LIMITS, ...opts.limits },
    lifecycle as unknown as MemoryLifecycleService,
    opts.governor ?? null,
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
    lifecycle: lifecycle as FakeLifecycle,
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
    expect(h.lifecycle.calls).toHaveLength(0);
  });

  it('boot-deferred within 10 minutes of construction', async () => {
    const h = harness();
    h.clock.t = Date.now() + 60_000;
    await expect(h.service.run(h.options)).resolves.toEqual({
      status: 'skipped',
      reason: 'boot-deferred',
    });
    expect(h.log).toEqual(['writeSkip']);
    expect(h.lifecycle.calls).toHaveLength(0);
  });

  it('on-battery', async () => {
    const h = harness();
    h.setBattery(true);
    await expect(h.service.run(h.options)).resolves.toEqual({
      status: 'skipped',
      reason: 'on-battery',
    });
    expect(h.log).toEqual(['writeSkip']);
    expect(h.lifecycle.calls).toHaveLength(0);
  });

  it('foreground-active when chat moved in the last 5 minutes', async () => {
    const h = harness();
    h.setForegroundMs(4 * 60_000);
    await expect(h.service.run(h.options)).resolves.toEqual({
      status: 'skipped',
      reason: 'foreground-active',
    });
    expect(h.log).toEqual(['writeSkip']);
    expect(h.lifecycle.calls).toHaveLength(0);
  });

  it('aborted', async () => {
    const h = harness();
    h.abort();
    await expect(h.service.run(h.options)).resolves.toEqual({
      status: 'skipped',
      reason: 'aborted',
    });
    expect(h.lifecycle.calls).toHaveLength(0);
  });

  it('persistence-unavailable writes nothing', async () => {
    const h = harness({ dbThrows: true });
    await expect(h.service.run(h.options)).resolves.toEqual({
      status: 'skipped',
      reason: 'persistence-unavailable',
    });
    expect(h.log).toEqual([]);
    expect(h.lifecycle.calls).toHaveLength(0);
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
    expect(h.lifecycle.calls).toHaveLength(0);
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
      memoriesArchived: 0,
      memoriesDeleted: 0,
      memoriesEvicted: 0,
      lifecycleNote: null,
      backlogRemaining: false,
      durationMs: 0,
      error: null,
    });
    const order = h.log.filter((c, i, all) => all[i - 1] !== c);
    expect(order).toEqual([
      'readState',
      'purge',
      'quarantine',
      'lifecycle',
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

  it('passes the run budget by identity to lifecycle and persists its counters, note and preview', async () => {
    const h = harness();
    const queueBudgets: RetentionRunBudget[] = [];
    const waitForGovernor = RetentionRunBudget.prototype.waitForGovernor;
    const waitSpy = jest
      .spyOn(RetentionRunBudget.prototype, 'waitForGovernor')
      .mockImplementation(function (this: RetentionRunBudget) {
        queueBudgets.push(this);
        return waitForGovernor.call(this);
      });
    const preview = {
      measuredAt: h.clock.t,
      forRunAt: h.clock.t + DAY,
      archiveEligible: 7,
      deleteEligible: 3,
      overCap: 2,
    };
    h.lifecycle.result = {
      archived: 7,
      deleted: 3,
      evicted: 2,
      exhausted: true,
      stop: null,
      note: 'vec-unavailable',
      preview,
      readErrors: ['preview: C:\\Users\\alice\\ptah.sqlite'],
    };

    let report: MemoryRetentionRunReport;
    try {
      report = (await h.service.run(h.options)) as MemoryRetentionRunReport;
    } finally {
      waitSpy.mockRestore();
    }

    expect(h.lifecycle.calls).toHaveLength(1);
    expect(queueBudgets.length).toBeGreaterThan(0);
    expect(h.lifecycle.calls[0].budget).toBe(queueBudgets[0]);
    expect(h.lifecycle.calls[0].startedAt).toBe(h.clock.t);
    expect(report).toMatchObject({
      memoriesArchived: 7,
      memoriesDeleted: 3,
      memoriesEvicted: 2,
      lifecycleNote: 'vec-unavailable',
    });
    expect(h.store.runs[0]).toMatchObject({
      memoriesArchived: 7,
      memoriesDeleted: 3,
      memoriesEvicted: 2,
      lifecycleNote: 'vec-unavailable',
      preview,
    });
    expect(h.service.storageHealth().readErrors).toEqual([
      'preview: [path redacted]',
    ]);
  });

  it('clears lifecycle read errors before a later lifecycle throw', async () => {
    const h = harness();
    h.lifecycle.result = {
      ...EMPTY_LIFECYCLE_RESULT,
      readErrors: ['x'],
    };
    await expect(h.service.run(h.options)).resolves.toMatchObject({
      status: 'completed',
    });
    expect(h.service.storageHealth().readErrors).toContain('x');

    h.store.state = null;
    h.lifecycle.implementation = async () => {
      throw new Error('later lifecycle failure');
    };
    await expect(h.service.run(h.options)).resolves.toMatchObject({
      status: 'failed',
    });
    expect(h.service.storageHealth().readErrors ?? []).not.toContain('x');
  });

  it('uses lifecycle exhaustion in the completed decision', async () => {
    const h = harness();
    h.lifecycle.result = {
      ...EMPTY_LIFECYCLE_RESULT,
      exhausted: false,
      stop: 'memory-row-budget',
    };
    await expect(h.service.run(h.options)).resolves.toMatchObject({
      status: 'partial',
      reason: 'memory-row-budget',
      backlogRemaining: true,
    });
  });

  it('prunes the ledger and reclaims pages after a memory row budget stop', async () => {
    const h = harness();
    h.lifecycle.result = {
      ...EMPTY_LIFECYCLE_RESULT,
      exhausted: false,
      stop: 'memory-row-budget',
    };
    h.reclaimer.freelist = 5;

    await expect(h.service.run(h.options)).resolves.toMatchObject({
      status: 'partial',
      reason: 'memory-row-budget',
      pagesReclaimed: 5,
    });
    expect(h.store.calls).toContain('prune');
    expect(h.log).toContain('reclaim');
  });

  it('a canDelete throw fails the run, dispatches no lifecycle batch and releases single-flight', async () => {
    const logger = makeLogger();
    const archiveBatch = jest.fn();
    const deleteArchivedBatch = jest.fn();
    const lifecycle = new RealMemoryLifecycleService(
      logger,
      makeWorkspace(),
      {
        canDelete: jest.fn(() => {
          throw new Error('connection.db unavailable');
        }),
        archiveBatch,
        deleteArchivedBatch,
      } as unknown as MemoryLifecycleStore,
      { markWorkspacesChanged: jest.fn() } as unknown as MemoryStore,
      MEMORY_RETENTION_LIMITS,
    );
    const h = harness({ lifecycle });

    await expect(h.service.run(h.options)).resolves.toMatchObject({
      status: 'failed',
      reason: 'unexpected-error',
    });
    expect(archiveBatch).not.toHaveBeenCalled();
    expect(deleteArchivedBatch).not.toHaveBeenCalled();
    h.store.state = null;
    await expect(h.service.run(h.options)).resolves.toMatchObject({
      status: 'failed',
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
    expect(h.lifecycle.calls).toHaveLength(1);
    expect(h.store.runs[0]).toMatchObject({
      outcome: 'partial',
      completedAt: null,
      backlogRemaining: true,
    });
  });

  it('preserves row-budget reason when purge hits row cap and reclaim stops on reclaim budget', async () => {
    const h = harness({
      limits: {
        maxRowsPerRun: 250,
        maxReclaimPagesPerRun: 100,
      },
    });
    h.store.processed = 400;
    h.store.stuck = 50;
    const report = (await h.service.run(h.options)) as MemoryRetentionRunReport;
    expect(report).toMatchObject({
      status: 'partial',
      reason: 'row-budget',
      processedPurged: 250,
      pagesReclaimed: 100,
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
    expect(h.lifecycle.calls).toHaveLength(0);
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
          memoriesArchived: 0,
          memoriesDeleted: 0,
          memoriesEvicted: 0,
          backlogRemaining: false,
        },
        lastCompletedAt: 2000,
        nextDueAt: 2000 + DAY,
        lastSkippedAt: 3000,
        lastSkipReason: 'foreground-active',
      },
      memoryLifecycle: {
        enabled: true,
        archiveAfterDays: 30,
        deleteAfterDays: 60,
        maxPerWorkspace: 25_000,
        lastNote: null,
        preview: null,
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

  it('sanitizes absolute Windows and POSIX database paths in readErrors for every read-error source', () => {
    const h = harness();
    h.store.readLiveStorage = () => ({
      pendingRows: null,
      pendingBytes: null,
      oldestPendingAt: null,
      stuckEligibleRows: null,
      quarantineLedgerRows: null,
      readErrors: [
        'connection: failed to open C:\\Users\\alice\\.ptah\\state\\db.sqlite - busy',
        'pending: query failed on /home/bob/.ptah/state/db.sqlite',
        'pendingBytes: read failed on C:/Users/alice/.ptah/state/db.sqlite',
        'stuckEligible: scan error at /Users/charlie/.ptah/state/db.sqlite',
        'quarantineLedger: table missing in /root/.ptah/state/db.sqlite',
      ],
    });
    h.store.readState = () => {
      throw new Error(
        'read failure at C:\\Users\\alice\\.ptah\\state\\db.sqlite',
      );
    };

    const health = h.service.storageHealth();

    expect(health.readErrors).toEqual([
      'connection: failed to open [path redacted] - busy',
      'pending: query failed on [path redacted]',
      'pendingBytes: read failed on [path redacted]',
      'stuckEligible: scan error at [path redacted]',
      'quarantineLedger: table missing in [path redacted]',
      'retentionState: read failure at [path redacted]',
    ]);
    for (const err of health.readErrors ?? []) {
      expect(err).not.toMatch(/[A-Za-z]:[/\\]/);
      expect(err).not.toMatch(/\/(?:home|Users|root)\//);
      expect(err).toContain('[path redacted]');
    }
  });

  it('sanitizes /var and /tmp POSIX paths in readErrors while preserving non-path text and ratios', () => {
    const h = harness();
    h.store.readLiveStorage = () => ({
      pendingRows: 40,
      pendingBytes: 1000,
      oldestPendingAt: 5,
      stuckEligibleRows: 0,
      quarantineLedgerRows: 0,
      readErrors: [
        'pending: query failed on /var/lib/ptah/state.sqlite',
        'quarantineLedger: table missing in /tmp/ptah-x/db.sqlite',
      ],
    });
    h.store.readState = () => null;

    const health = h.service.storageHealth();

    expect(health.readErrors).toEqual([
      'pending: query failed on [path redacted]',
      'quarantineLedger: table missing in [path redacted]',
    ]);
    for (const err of health.readErrors ?? []) {
      expect(err).not.toContain('/var/');
      expect(err).not.toContain('/tmp/');
      expect(err).toContain('[path redacted]');
    }
  });
});

describe('sanitizeRetentionError', () => {
  it('redacts absolute POSIX paths with at least two segments across /var, /tmp, /opt, /home, /Users, /root', () => {
    expect(sanitizeRetentionError('failed on /var/lib/ptah/state.sqlite')).toBe(
      'failed on [path redacted]',
    );
    expect(sanitizeRetentionError('failed on /tmp/ptah-x/db.sqlite')).toBe(
      'failed on [path redacted]',
    );
    expect(sanitizeRetentionError('failed on /opt/ptah/db')).toBe(
      'failed on [path redacted]',
    );
    expect(sanitizeRetentionError('failed on /home/bob/db.sqlite')).toBe(
      'failed on [path redacted]',
    );
    expect(sanitizeRetentionError('failed on /Users/charlie/db.sqlite')).toBe(
      'failed on [path redacted]',
    );
    expect(sanitizeRetentionError('failed on /root/db.sqlite')).toBe(
      'failed on [path redacted]',
    );
    expect(sanitizeRetentionError('open (file)/home/bob/db.sqlite')).toBe(
      'open (file)[path redacted]',
    );
  });

  it('preserves non-path text, ratios, conjunctions, and single-slash words', () => {
    expect(
      sanitizeRetentionError('no such table: memory_retention_state'),
    ).toBe('no such table: memory_retention_state');
    expect(sanitizeRetentionError('SQLITE_BUSY: database is locked')).toBe(
      'SQLITE_BUSY: database is locked',
    );
    expect(sanitizeRetentionError('ratio 1/2')).toBe('ratio 1/2');
    expect(sanitizeRetentionError('processed and/or quarantined')).toBe(
      'processed and/or quarantined',
    );
    expect(sanitizeRetentionError('operation: read/write error')).toBe(
      'operation: read/write error',
    );
    expect(sanitizeRetentionError('options: /help')).toBe('options: /help');
  });
});

describe('MemoryRetentionService — background-work governor', () => {
  it('holds the first lifecycle batch behind the same run budget until clear', async () => {
    const governor = new FakeGovernor();
    const h = harness({ governor });
    let lifecycleBatchDispatched = false;
    h.store.onQuarantine = () => {
      governor.clear = false;
    };
    h.lifecycle.implementation = async (budget) => {
      expect(budget).toBe(h.lifecycle.calls[0].budget);
      const stop = await budget.waitForGovernor();
      if (stop !== null) {
        return { ...EMPTY_LIFECYCLE_RESULT, exhausted: false, stop };
      }
      lifecycleBatchDispatched = true;
      return EMPTY_LIFECYCLE_RESULT;
    };

    const runPromise = h.service.run(h.options);
    await governor.waitForWaiter();
    expect(lifecycleBatchDispatched).toBe(false);
    expect(h.log).not.toContain('prune');

    governor.release('clear');
    await expect(runPromise).resolves.toMatchObject({ status: 'completed' });
    expect(lifecycleBatchDispatched).toBe(true);
  });

  it('an AbortError during lifecycle wait is partial/aborted and dispatches no prune or reclaim', async () => {
    const governor = new FakeGovernor();
    const h = harness({ governor });
    let lifecycleBatchDispatched = false;
    h.store.onQuarantine = () => {
      governor.clear = false;
    };
    h.lifecycle.implementation = async (budget) => {
      const stop = await budget.waitForGovernor();
      if (stop !== null) {
        return { ...EMPTY_LIFECYCLE_RESULT, exhausted: false, stop };
      }
      lifecycleBatchDispatched = true;
      return EMPTY_LIFECYCLE_RESULT;
    };

    const runPromise = h.service.run(h.options);
    await governor.waitForWaiter();
    governor.reject(
      Object.assign(new Error('governor disposed'), { name: 'AbortError' }),
    );

    await expect(runPromise).resolves.toMatchObject({
      status: 'partial',
      reason: 'aborted',
    });
    expect(lifecycleBatchDispatched).toBe(false);
    expect(h.log).not.toContain('prune');
    expect(h.log).not.toContain('reclaim');
  });

  it('waits when governor is busy; no batch runs until cleared', async () => {
    const governor = new FakeGovernor();
    governor.clear = false;
    const h = harness({ governor });
    h.store.processed = 50;

    let finished = false;
    const runPromise = h.service.run(h.options).then((res) => {
      finished = true;
      return res;
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(finished).toBe(false);
    expect(h.store.purgeCalls).toBe(0);
    expect(governor.waiters).toHaveLength(1);
    expect(governor.waiters[0].options?.lane).toBe('memory-retention');

    governor.release('clear');
    const report = await runPromise;

    expect(report.status).toBe('completed');
    expect(h.store.purgeCalls).toBe(1);
  });

  it('ends as partial with time-budget and backlog remaining when wait consumes the wall budget', async () => {
    const governor = new FakeGovernor();
    governor.clear = false;
    const h = harness({ governor });
    h.store.processed = 100;

    const runPromise = h.service.run(h.options);
    await governor.waitForWaiter();

    expect(governor.waiters).toHaveLength(1);
    const waitOpts = governor.waiters[0].options;
    expect(waitOpts?.maxDeferMs).toBeDefined();
    expect(waitOpts?.maxDeferMs).toBeLessThanOrEqual(
      MEMORY_RETENTION_LIMITS.maxRunMs,
    );
    expect(waitOpts?.maxDeferMs).toBeGreaterThan(0);
    expect(waitOpts?.maxDeferMs).not.toBe(600_000);

    h.clock.t += waitOpts?.maxDeferMs ?? MEMORY_RETENTION_LIMITS.maxRunMs;
    governor.release('timeout');

    const report = (await runPromise) as MemoryRetentionRunReport;

    expect(report.status).toBe('partial');
    expect(report.reason).toBe('time-budget');
    expect(report.backlogRemaining).toBe(true);
    expect(h.store.purgeCalls).toBe(0);

    const health = h.service.storageHealth();
    expect(health.retention.nextDueAt).toBe(h.clock.t);
  });

  it('cleanly stops with aborted outcome when governor aborts; earlier committed batches are preserved', async () => {
    const governor = new FakeGovernor();
    const h = harness({
      governor,
      settings: { 'memory.retention.batchSize': 50 },
    });
    h.store.processed = 100;

    governor.clear = true;
    h.store.onPurge = (callCount) => {
      if (callCount === 1) {
        governor.clear = false;
      }
    };

    const runPromise = h.service.run(h.options);
    await governor.waitForWaiter();

    expect(h.store.purgeCalls).toBe(1);
    expect(governor.waiters).toHaveLength(1);

    governor.reject(
      Object.assign(new Error('governor disposed'), { name: 'AbortError' }),
    );

    const report = (await runPromise) as MemoryRetentionRunReport;

    expect(report.status).toBe('partial');
    expect(report.reason).toBe('aborted');
    expect(report.backlogRemaining).toBe(true);
    expect(report.processedPurged).toBe(50);
    expect(h.store.purgeCalls).toBe(1);

    expect(h.store.runs).toHaveLength(1);
    expect(h.store.runs[0].outcome).toBe('partial');
    expect(h.store.runs[0].reason).toBe('aborted');
    expect(h.store.runs[0].processedPurged).toBe(50);
  });

  it('fails open and continues run when governor rejects unexpectedly, logging warn once', async () => {
    const governor = new FakeGovernor();
    governor.clear = false;
    const h = harness({
      governor,
      settings: { 'memory.retention.batchSize': 50 },
    });
    h.store.processed = 100;

    let whenClearCalls = 0;
    governor.whenClear = jest.fn(async () => {
      whenClearCalls++;
      throw new Error('unexpected governor crash');
    });

    const report = await h.service.run(h.options);

    expect(report.status).toBe('completed');
    expect(h.store.purgeCalls).toBe(2);
    expect(whenClearCalls).toBeGreaterThanOrEqual(2);

    const warnCalls = (h.logger.warn as jest.Mock).mock.calls.filter((c) =>
      c[0].includes('background-work wait failed'),
    );
    expect(warnCalls).toHaveLength(1);
    expect(warnCalls[0][1]).toEqual({
      error: 'unexpected governor crash',
    });
  });

  it('proceeds when governor times out', async () => {
    const governor = new FakeGovernor();
    governor.clear = false;
    const h = harness({ governor });
    h.store.processed = 50;

    const runPromise = h.service.run(h.options);
    await governor.waitForWaiter();

    expect(governor.waiters).toHaveLength(1);
    governor.release('timeout');
    governor.clear = true;

    const report = await runPromise;
    expect(report.status).toBe('completed');
    expect(h.store.purgeCalls).toBe(1);
  });

  it('preserves governor busy state across timeouts so subsequent batches wait again', async () => {
    const governor = new FakeGovernor();
    governor.clear = false;
    const h = harness({
      governor,
      settings: { 'memory.retention.batchSize': 50 },
    });
    h.store.processed = 100;

    const runPromise = h.service.run(h.options);
    await governor.waitForWaiter();

    expect(governor.whenClearCalls).toBe(1);
    expect(h.store.purgeCalls).toBe(0);

    // Timeout first wait; budget is not exhausted, so batch 1 runs
    governor.release('timeout');

    // Wait for batch 2's whenClear call to register before batch 2 runs
    await governor.waitForWaiter();

    expect(governor.whenClearCalls).toBe(2);
    expect(h.store.purgeCalls).toBe(1);

    // Second wait clears; batch 2 runs and the run completes
    governor.release('clear');
    const report = (await runPromise) as MemoryRetentionRunReport;

    expect(report.status).toBe('completed');
    expect(h.store.purgeCalls).toBe(2);
    expect(report.processedPurged).toBe(100);
  });

  it('skips governor whenClear call when deadline has already passed', async () => {
    const governor = new FakeGovernor();
    const h = harness({
      governor,
      settings: { 'memory.retention.batchSize': 50 },
    });
    h.store.processed = 100;

    governor.clear = true;
    h.store.onPurge = (callCount) => {
      if (callCount === 1) {
        governor.clear = false;
        // Advance clock past deadline
        h.clock.t += MEMORY_RETENTION_LIMITS.maxRunMs + 1000;
      }
    };

    const report = (await h.service.run(h.options)) as MemoryRetentionRunReport;

    expect(governor.waiters).toHaveLength(0);
    expect(report.status).toBe('partial');
    expect(report.reason).toBe('time-budget');
    expect(report.processedPurged).toBe(50);
  });
});
