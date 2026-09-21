import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import type { SqlitePageReclaimer } from '@ptah-extension/persistence-sqlite';
import type {
  MemoryRetentionRunDto,
  MemoryStorageHealthDto,
  RetentionHealthVerdict,
} from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  MEMORY_LIFECYCLE_DEFAULTS,
  readMemoryLifecycleSettings,
  type MemoryLifecycleSettings,
} from './memory-lifecycle-config';
import {
  DAY_MS,
  RETENTION_HEALTH_MIN_ATTEMPTS,
  RETENTION_HEALTH_MIN_AGE_MS,
  RETENTION_HEALTH_STALL_MS,
  RETENTION_HEALTH_STALL_PENDING_ROWS,
  type MemoryRetentionSettings,
} from './memory-retention-config';
import type {
  ObservationRetentionStore,
  RetentionState,
} from './observation-retention.store';

const AUTO_VACUUM_INCREMENTAL = 2;

export type { RetentionHealthVerdict } from '@ptah-extension/shared';

/** Pure verdict: null state means no row yet; undefined means the read failed. */
export function computeRetentionHealthVerdict(
  enabled: boolean,
  state:
    | Pick<
        RetentionState,
        | 'lastCompletedAt'
        | 'attemptCount'
        | 'firstAttemptAt'
        | 'backlogRemaining'
      >
    | null
    | undefined,
  now: number,
  pendingRows: number | null,
): RetentionHealthVerdict {
  if (!enabled) return 'disabled';
  if (state === undefined) return 'unknown';
  if (state === null) return 'healthy';
  if (state.lastCompletedAt === null) {
    return state.attemptCount >= RETENTION_HEALTH_MIN_ATTEMPTS &&
      state.firstAttemptAt !== null &&
      Math.max(0, now - state.firstAttemptAt) > RETENTION_HEALTH_MIN_AGE_MS
      ? 'never-completed'
      : 'healthy';
  }
  return (state.backlogRemaining ||
    (pendingRows !== null &&
      pendingRows > RETENTION_HEALTH_STALL_PENDING_ROWS)) &&
    Math.max(0, now - state.lastCompletedAt) > RETENTION_HEALTH_STALL_MS
    ? 'stalled'
    : 'healthy';
}
const RUN_OUTCOMES: ReadonlySet<string> = new Set([
  'completed',
  'partial',
  'failed',
]);

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toRunDto(state: RetentionState): MemoryRetentionRunDto | null {
  if (
    state.lastOutcome === null ||
    !RUN_OUTCOMES.has(state.lastOutcome) ||
    state.lastStartedAt === null ||
    state.lastFinishedAt === null
  ) {
    return null;
  }
  return {
    startedAt: state.lastStartedAt,
    finishedAt: state.lastFinishedAt,
    outcome: state.lastOutcome as MemoryRetentionRunDto['outcome'],
    reason: state.lastReason,
    error: state.lastError,
    durationMs: state.lastDurationMs ?? 0,
    processedPurged: state.processedPurged,
    stuckQuarantined: state.stuckQuarantined,
    ledgerPruned: state.ledgerPruned,
    freedBytes: state.freedBytes,
    pagesReclaimed: state.pagesReclaimed,
    memoriesArchived: state.memoriesArchived,
    memoriesDeleted: state.memoriesDeleted,
    memoriesEvicted: state.memoriesEvicted,
    backlogRemaining: state.backlogRemaining,
  };
}

export function readMemoryStorageHealth(input: {
  workspace: IWorkspaceProvider;
  reclaimer: SqlitePageReclaimer;
  store: ObservationRetentionStore;
  logger: Logger;
  settings: MemoryRetentionSettings;
  intervalMs: number;
  lifecycleReadErrors: readonly string[];
  sanitizeError: (message: string) => string;
}): MemoryStorageHealthDto {
  const readErrors: string[] = [];
  let lifecycleSettings: MemoryLifecycleSettings = MEMORY_LIFECYCLE_DEFAULTS;
  try {
    lifecycleSettings = readMemoryLifecycleSettings(input.workspace);
  } catch (error: unknown) {
    // degradation-audit: reported - diagnostics expose the settings failure
    // while using safe lifecycle defaults.
    readErrors.push(`lifecycleSettings: ${errorText(error)}`);
    input.logger.warn('[memory-curator] lifecycle settings unreadable', {
      error: errorText(error),
    });
  }
  const stats = input.reclaimer.readPageStats();
  const statsKnown = stats.pageSize > 0;
  if (!statsKnown) readErrors.push('pageStats: unavailable');
  const live = input.store.readLiveStorage(
    Date.now() - input.settings.stuckDays * DAY_MS,
  );
  readErrors.push(...live.readErrors, ...input.lifecycleReadErrors);
  let state: RetentionState | null | undefined;
  try {
    state = input.store.readState();
  } catch (error: unknown) {
    readErrors.push(`retentionState: ${errorText(error)}`);
  }
  const processedRows = state?.processedRowsAfter ?? null;
  const avgBytes = state?.avgProcessedRowBytes ?? null;
  const preview =
    state?.previewMeasuredAt != null &&
    state.previewForRunAt != null &&
    state.previewArchiveEligible != null &&
    state.previewDeleteEligible != null &&
    state.previewOverCap != null
      ? {
          measuredAt: state.previewMeasuredAt,
          forRunAt: state.previewForRunAt,
          archiveEligible: state.previewArchiveEligible,
          deleteEligible: state.previewDeleteEligible,
          overCap: state.previewOverCap,
        }
      : null;
  const nextDueAt = state?.backlogRemaining
    ? state.lastFinishedAt
    : state?.lastCompletedAt != null
      ? state.lastCompletedAt + input.intervalMs
      : null;
  return {
    dbBytes: statsKnown ? stats.pageCount * stats.pageSize : null,
    reclaimableBytes: statsKnown ? stats.freelistCount * stats.pageSize : null,
    autoVacuumIncremental: statsKnown
      ? stats.autoVacuumMode === AUTO_VACUUM_INCREMENTAL
      : null,
    observations: {
      pendingRows: live.pendingRows,
      pendingBytes: live.pendingBytes,
      oldestPendingAt: live.oldestPendingAt,
      stuckEligibleRows: live.stuckEligibleRows,
      processedRows,
      processedBytesEstimate:
        processedRows !== null && avgBytes !== null
          ? processedRows * avgBytes
          : null,
      measuredAt:
        processedRows !== null ? (state?.lastFinishedAt ?? null) : null,
      quarantineLedgerRows: live.quarantineLedgerRows,
    },
    retention: {
      healthVerdict: computeRetentionHealthVerdict(
        input.settings.enabled,
        state,
        Date.now(),
        live.pendingRows,
      ),
      enabled: input.settings.enabled,
      processedDays: input.settings.processedDays,
      stuckDays: input.settings.stuckDays,
      lastRun: state ? toRunDto(state) : null,
      lastCompletedAt: state?.lastCompletedAt ?? null,
      nextDueAt,
      lastSkippedAt: state?.lastSkippedAt ?? null,
      lastSkipReason: state?.lastSkipReason ?? null,
    },
    memoryLifecycle: {
      enabled: lifecycleSettings.enabled,
      archiveAfterDays: lifecycleSettings.archiveAfterDays,
      deleteAfterDays: lifecycleSettings.deleteAfterDays,
      maxPerWorkspace: lifecycleSettings.maxPerWorkspace,
      lastNote: state?.lifecycleNote ?? null,
      preview,
    },
    ...(readErrors.length > 0
      ? { readErrors: readErrors.map(input.sanitizeError) }
      : {}),
  };
}
