import type {
  BackgroundWorkAdmission,
  Logger,
} from '@ptah-extension/vscode-core';
import type { MemoryRetentionLimits } from './memory-retention-config';
import type {
  MemoryRetentionRunOptions,
  RetentionStopReason,
} from './memory-retention.types';

export const GOVERNOR_LANE = 'memory-retention';

export type RetentionBatchKind = 'queue' | 'archive' | 'delete';

export interface RetentionRunBudgetOptions {
  readonly options: MemoryRetentionRunOptions;
  readonly limits: MemoryRetentionLimits;
  readonly now: () => number;
  readonly startedAt: number;
  readonly logger: Logger;
  readonly governor: BackgroundWorkAdmission | null;
  readonly queueBatchSize: number;
  readonly archiveBatchSize: number;
  readonly deleteBatchSize: number;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Per-run wall, row, adaptive-batch and governor budget. */
export class RetentionRunBudget {
  private queueRows = 0;
  private memoryRows = 0;
  private governorWarned = false;
  private readonly sizes: Record<RetentionBatchKind, number>;

  constructor(private readonly input: RetentionRunBudgetOptions) {
    this.sizes = {
      queue: input.queueBatchSize,
      archive: input.archiveBatchSize,
      delete: input.deleteBatchSize,
    };
  }

  msLeft(): number {
    return this.input.startedAt + this.input.limits.maxRunMs - this.input.now();
  }

  hardStop(): RetentionStopReason | null {
    const { options, limits, now, startedAt } = this.input;
    if (options.signal.aborted) return 'aborted';
    if (options.isOnBattery()) return 'on-battery';
    if (options.msSinceForegroundActivity() < limits.foregroundBackoffMs) {
      return 'foreground-active';
    }
    if (now() >= startedAt + limits.maxRunMs) return 'time-budget';
    return null;
  }

  async waitForGovernor(): Promise<RetentionStopReason | null> {
    const { governor, options, logger } = this.input;
    if (governor === null || governor.isClear()) return this.hardStop();
    const remainingMs = this.msLeft();
    if (remainingMs <= 0) return this.hardStop();
    try {
      await governor.whenClear({
        signal: options.signal,
        lane: GOVERNOR_LANE,
        maxDeferMs: Math.max(1, remainingMs),
      });
    } catch (error: unknown) {
      // degradation-audit: reported - an unexpected governor failure is logged
      // once per run and retention fails open as required by the admission port.
      if (
        options.signal.aborted ||
        (error instanceof Error && error.name === 'AbortError')
      ) {
        return 'aborted';
      }
      if (!this.governorWarned) {
        this.governorWarned = true;
        logger.warn(
          '[memory-curator] background-work wait failed — continuing retention anyway',
          { error: errorText(error) },
        );
      }
    }
    return this.hardStop();
  }

  queueRowRoom(): number {
    return Math.max(0, this.input.limits.maxRowsPerRun - this.queueRows);
  }

  consumeQueueRows(count: number): void {
    this.queueRows += Math.max(0, count);
  }

  memoryRowRoom(): number {
    return Math.max(0, this.input.limits.maxMemoryRowsPerRun - this.memoryRows);
  }

  consumeMemoryRows(count: number): void {
    this.memoryRows += Math.max(0, count);
  }

  batchSize(kind: RetentionBatchKind): number {
    return this.sizes[kind];
  }

  observe(kind: RetentionBatchKind, durationMs: number): void {
    const { limits, logger } = this.input;
    const current = this.sizes[kind];
    if (durationMs <= limits.slowCallMs || current <= limits.minBatchSize) {
      return;
    }
    const batchSize = Math.max(limits.minBatchSize, Math.floor(current / 2));
    this.sizes[kind] = batchSize;
    logger.debug('[memory-curator] retention batch slow; halved', {
      durationMs,
      batchSize,
    });
  }

  yieldToEventLoop(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
  }
}
