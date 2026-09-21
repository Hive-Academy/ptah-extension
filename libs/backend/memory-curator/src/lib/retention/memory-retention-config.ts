/**
 * Memory retention configuration (TASK_2026_440).
 *
 * Two kinds of bound live here:
 *
 * - **Settings** — the four user-facing `memory.retention.*` keys, read through
 *   `IWorkspaceProvider.getConfiguration` (so they resolve from
 *   `~/.ptah/settings.json` on every host). The file is an external boundary,
 *   so every value is validated here: a non-finite number or a wrong type falls
 *   back to the default and a number is clamped into range.
 *   `MEMORY_RETENTION_DEFAULTS` must equal the `memory.retention.*` entries in
 *   `platform-core` `FILE_BASED_SETTINGS_DEFAULTS`; `memory-retention.service.spec.ts`
 *   pins that parity.
 * - **Limits** — budget constants that are not settings. They bound how much
 *   main-thread SQLite work one hourly run may do. `MEMORY_RETENTION_LIMITS` is
 *   the injected default; a spec may substitute a copy with a smaller budget.
 */
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';

export const MEMORY_RETENTION_SECTION = 'ptah';

export const MEMORY_RETENTION_KEYS = {
  enabled: 'memory.retention.enabled',
  processedDays: 'memory.retention.processedDays',
  stuckDays: 'memory.retention.stuckDays',
  batchSize: 'memory.retention.batchSize',
} as const;

export const MEMORY_RETENTION_DEFAULTS = {
  enabled: true,
  processedDays: 7,
  stuckDays: 14,
  batchSize: 500,
} as const;

/** Inclusive clamp ranges for the numeric settings. */
export const MEMORY_RETENTION_SETTING_RANGES = {
  processedDays: { min: 1, max: 365 },
  // Seven days minimum: a stuck row is deleted, so the grace window must stay
  // longer than any plausible curator outage.
  stuckDays: { min: 7, max: 365 },
  batchSize: { min: 50, max: 5_000 },
} as const;

export interface MemoryRetentionSettings {
  readonly enabled: boolean;
  readonly processedDays: number;
  readonly stuckDays: number;
  readonly batchSize: number;
}

export const DAY_MS = 86_400_000;

/**
 * Three days of hourly cron ticks. Both the count and age bounds must pass:
 * fresh installs and machines that were asleep must not raise a false alarm.
 */
export const RETENTION_HEALTH_MIN_ATTEMPTS = 72;
/** Three elapsed days prevent a burst of recorded attempts from alarming early. */
export const RETENTION_HEALTH_MIN_AGE_MS = 72 * 60 * 60 * 1000;
/** A week without completion is a fault when stored or live backlog indicates work. */
export const RETENTION_HEALTH_STALL_MS = 7 * DAY_MS;
/** A substantial live queue detects starvation even after a previously clean run. */
export const RETENTION_HEALTH_STALL_PENDING_ROWS = 10_000;

/** Both row steps combined, per run. */
export const RETENTION_MAX_ROWS_PER_RUN = 50_000;
/** Archive, age-delete and cap-eviction rows combined, per run. */
export const RETENTION_MAX_MEMORY_ROWS_PER_RUN = 25_000;
/**
 * Initial batch size for deletes that fan out through FTS and vec triggers.
 * 100 from the TASK_2026_443 cap-eviction sweep: 200 reached max 133-1730 ms
 * on a 1.18 GB file; 100 passed the 120 ms bound.
 */
export const RETENTION_MEMORY_DELETE_BATCH_SIZE = 100;
/** Newly archived rows remain protected from cap eviction for seven days. */
export const RETENTION_CAP_EVICTION_GRACE_MS = 7 * DAY_MS;
/** Wall clock per run, yields included. */
export const RETENTION_MAX_RUN_MS = 60_000;
/** A batch or reclaim step slower than this halves its size for the rest of the run. */
export const RETENTION_SLOW_CALL_MS = 120;
/** Floor for the adaptive batch size. */
export const RETENTION_MIN_BATCH_SIZE = 50;
/**
 * Initial `incremental_vacuum` step (1 MB at 4 KB pages). Halving is per run,
 * so this first step must itself stay under the 120 ms bound; measured p95
 * 44 ms on a 1.18 GB copy under production pragmas (TASK_2026_440 test-report
 * Task 7.4).
 */
export const RETENTION_RECLAIM_PAGES_PER_STEP = 256;
/** Adaptive floor for the reclaim step. */
export const RETENTION_MIN_RECLAIM_PAGES_PER_STEP = 64;
/** Pages handed back to the filesystem per run (128 MB at 4 KB pages). */
export const RETENTION_MAX_RECLAIM_PAGES_PER_RUN = 32_768;
/** Ledger rows older than this are pruned. */
export const RETENTION_LEDGER_MAX_AGE_MS = 90 * DAY_MS;
/** The ledger keeps at most this many newest rows. */
export const RETENTION_LEDGER_MAX_ROWS = 5_000;
/** A completed run is followed by the next one no sooner than this. */
export const RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** No retention work this soon after the service was constructed. */
export const RETENTION_BOOT_DEFERRAL_MS = 10 * 60 * 1000;
/** Matches `skillSynthesis.drain.foregroundBackoffMs`' default. */
export const RETENTION_FOREGROUND_BACKOFF_MS = 5 * 60 * 1000;
/**
 * A busy governor may defer one batch for at most this long. The live failure
 * consumed 59,997 ms of a 60,000 ms run before its first batch. The measured
 * worst event-loop block on that host was 2,912.9 ms, so 5 seconds gives the
 * governor another ~2.1 seconds to observe clearance while preserving 55
 * seconds of the run wall budget. A still-busy timeout is handled separately
 * by `RetentionRunBudget`; it never unlocks repeated full-size batches.
 */
export const RETENTION_GOVERNOR_MAX_DEFER_MS = 5_000;
/**
 * The cron ticks hourly. After two foreground deferrals, the third eligible
 * attempt runs under the normal bounded/yielding budgets, guaranteeing backlog
 * progress at least every three hours even when concurrent sessions never let
 * the foreground-idle gate open naturally.
 */
export const RETENTION_FOREGROUND_MAX_CONSECUTIVE_SKIPS = 2;

export interface MemoryRetentionLimits {
  readonly maxRowsPerRun: number;
  readonly maxMemoryRowsPerRun: number;
  readonly memoryDeleteBatchSize: number;
  readonly capEvictionGraceMs: number;
  readonly maxRunMs: number;
  readonly slowCallMs: number;
  readonly minBatchSize: number;
  readonly reclaimPagesPerStep: number;
  readonly minReclaimPagesPerStep: number;
  readonly maxReclaimPagesPerRun: number;
  readonly ledgerMaxAgeMs: number;
  readonly ledgerMaxRows: number;
  readonly intervalMs: number;
  readonly bootDeferralMs: number;
  readonly foregroundBackoffMs: number;
  readonly governorMaxDeferMs: number;
  readonly foregroundMaxConsecutiveSkips: number;
}

export const MEMORY_RETENTION_LIMITS: MemoryRetentionLimits = Object.freeze({
  maxRowsPerRun: RETENTION_MAX_ROWS_PER_RUN,
  maxMemoryRowsPerRun: RETENTION_MAX_MEMORY_ROWS_PER_RUN,
  memoryDeleteBatchSize: RETENTION_MEMORY_DELETE_BATCH_SIZE,
  capEvictionGraceMs: RETENTION_CAP_EVICTION_GRACE_MS,
  maxRunMs: RETENTION_MAX_RUN_MS,
  slowCallMs: RETENTION_SLOW_CALL_MS,
  minBatchSize: RETENTION_MIN_BATCH_SIZE,
  reclaimPagesPerStep: RETENTION_RECLAIM_PAGES_PER_STEP,
  minReclaimPagesPerStep: RETENTION_MIN_RECLAIM_PAGES_PER_STEP,
  maxReclaimPagesPerRun: RETENTION_MAX_RECLAIM_PAGES_PER_RUN,
  ledgerMaxAgeMs: RETENTION_LEDGER_MAX_AGE_MS,
  ledgerMaxRows: RETENTION_LEDGER_MAX_ROWS,
  intervalMs: RETENTION_INTERVAL_MS,
  bootDeferralMs: RETENTION_BOOT_DEFERRAL_MS,
  foregroundBackoffMs: RETENTION_FOREGROUND_BACKOFF_MS,
  governorMaxDeferMs: RETENTION_GOVERNOR_MAX_DEFER_MS,
  foregroundMaxConsecutiveSkips:
    RETENTION_FOREGROUND_MAX_CONSECUTIVE_SKIPS,
});

/** Finite number → truncated and clamped; anything else → `fallback`. */
function clampInteger(
  value: unknown,
  fallback: number,
  range: { readonly min: number; readonly max: number },
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(range.max, Math.max(range.min, Math.trunc(value)));
}

export function readMemoryRetentionSettings(
  ws: IWorkspaceProvider,
): MemoryRetentionSettings {
  const enabled = ws.getConfiguration<unknown>(
    MEMORY_RETENTION_SECTION,
    MEMORY_RETENTION_KEYS.enabled,
    MEMORY_RETENTION_DEFAULTS.enabled,
  );
  return {
    enabled:
      typeof enabled === 'boolean'
        ? enabled
        : MEMORY_RETENTION_DEFAULTS.enabled,
    processedDays: clampInteger(
      ws.getConfiguration<unknown>(
        MEMORY_RETENTION_SECTION,
        MEMORY_RETENTION_KEYS.processedDays,
        MEMORY_RETENTION_DEFAULTS.processedDays,
      ),
      MEMORY_RETENTION_DEFAULTS.processedDays,
      MEMORY_RETENTION_SETTING_RANGES.processedDays,
    ),
    stuckDays: clampInteger(
      ws.getConfiguration<unknown>(
        MEMORY_RETENTION_SECTION,
        MEMORY_RETENTION_KEYS.stuckDays,
        MEMORY_RETENTION_DEFAULTS.stuckDays,
      ),
      MEMORY_RETENTION_DEFAULTS.stuckDays,
      MEMORY_RETENTION_SETTING_RANGES.stuckDays,
    ),
    batchSize: clampInteger(
      ws.getConfiguration<unknown>(
        MEMORY_RETENTION_SECTION,
        MEMORY_RETENTION_KEYS.batchSize,
        MEMORY_RETENTION_DEFAULTS.batchSize,
      ),
      MEMORY_RETENTION_DEFAULTS.batchSize,
      MEMORY_RETENTION_SETTING_RANGES.batchSize,
    ),
  };
}
