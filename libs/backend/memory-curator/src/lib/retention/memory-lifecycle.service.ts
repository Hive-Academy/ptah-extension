import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  PLATFORM_TOKENS,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import { MEMORY_TOKENS } from '../di/tokens';
import { MemoryStore } from '../memory.store';
import { DAY_MS, type MemoryRetentionLimits } from './memory-retention-config';
import type { RetentionStopReason } from './memory-retention.types';
import {
  MEMORY_LIFECYCLE_DEFAULTS,
  readMemoryLifecycleSettings,
  type MemoryLifecycleSettings,
} from './memory-lifecycle-config';
import {
  MemoryLifecycleStore,
  type MemoryLifecycleBatchResult,
  type MemoryArchiveBatchResult,
} from './memory-lifecycle.store';
import {
  RetentionRunBudget,
  type RetentionBatchKind,
} from './retention-run-budget';
import { RetentionStepError } from './observation-retention.store';

export type MemoryLifecycleNote = 'disabled' | 'vec-unavailable';

export interface MemoryLifecyclePreview {
  readonly measuredAt: number;
  readonly forRunAt: number;
  readonly archiveEligible: number | null;
  readonly deleteEligible: number | null;
  readonly overCap: number | null;
}

export interface MemoryLifecycleStepResult {
  readonly archived: number;
  readonly deleted: number;
  readonly evicted: number;
  readonly exhausted: boolean;
  readonly stop: RetentionStopReason | null;
  readonly note: MemoryLifecycleNote | null;
  readonly preview: MemoryLifecyclePreview | null;
  readonly readErrors: readonly string[];
  readonly error?: RetentionStepError | null;
}

interface MutableResult {
  archived: number;
  deleted: number;
  evicted: number;
  exhausted: boolean;
  stop: RetentionStopReason | null;
  note: MemoryLifecycleNote | null;
  preview: MemoryLifecyclePreview | null;
  readErrors: string[];
  error: RetentionStepError | null;
}

type CountedBatch =
  | MemoryLifecycleBatchResult
  | MemoryArchiveBatchResult
  | { readonly evicted: number };

@injectable()
export class MemoryLifecycleService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspace: IWorkspaceProvider,
    @inject(MEMORY_TOKENS.MEMORY_LIFECYCLE_STORE)
    private readonly store: MemoryLifecycleStore,
    @inject(MEMORY_TOKENS.MEMORY_STORE)
    private readonly memoryStore: MemoryStore,
    @inject(MEMORY_TOKENS.MEMORY_RETENTION_LIMITS)
    private readonly limits: MemoryRetentionLimits,
  ) {}

  async runStep(
    budget: RetentionRunBudget,
    nowMs: number,
  ): Promise<MemoryLifecycleStepResult> {
    const settings = this.readSettings();
    const result: MutableResult = {
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
    const roots = new Set<string | null>();

    if (!settings.enabled) {
      result.note = 'disabled';
      const preview = this.preview(settings, nowMs);
      result.preview = preview.value;
      result.readErrors.push(...preview.readErrors);
      return result;
    }

    try {
      const deleteAdmission = this.store.canDelete();
      if (!deleteAdmission.allowed) {
        result.note = 'vec-unavailable';
        this.logger.warn(
          '[memory-curator] lifecycle deletes paused because sqlite-vec is unavailable',
        );
      } else {
        await this.runLoop(
          budget,
          'delete',
          (limit) =>
            this.store.deleteArchivedBatch(
              nowMs - settings.deleteAfterDays * DAY_MS,
              limit,
            ),
          (batch) => {
            const deleted = 'deleted' in batch ? batch.deleted : 0;
            result.deleted += deleted;
            if ('workspaceRoots' in batch) {
              for (const root of batch.workspaceRoots) roots.add(root);
            }
            return deleted;
          },
          result,
        );
      }

      if (result.stop === null) {
        await this.runLoop(
          budget,
          'archive',
          (limit) =>
            this.store.archiveBatch(
              nowMs - settings.archiveAfterDays * DAY_MS,
              nowMs,
              limit,
            ),
          (batch) => {
            const archived = 'archived' in batch ? batch.archived : 0;
            result.archived += archived;
            if ('workspaceRoots' in batch) {
              for (const root of batch.workspaceRoots) roots.add(root);
            }
            return archived;
          },
          result,
        );
      }

      if (result.stop === null && deleteAdmission.allowed) {
        const overCap = this.store.overCapWorkspaces(settings.maxPerWorkspace);
        result.readErrors.push(...overCap.readErrors);
        for (const workspace of overCap.workspaces) {
          const archivalExcess = Math.max(
            0,
            workspace.evictable - settings.maxPerWorkspace,
          );
          await this.runEviction(
            budget,
            workspace.workspaceRoot,
            'archival',
            archivalExcess,
            nowMs - this.limits.capEvictionGraceMs,
            result,
            () => roots.add(workspace.workspaceRoot),
          );
          if (result.stop !== null) break;
          const recallExcess = Math.max(
            0,
            workspace.recallEvictable - settings.maxPerWorkspace,
          );
          if (recallExcess > 0) {
            await this.runEviction(
              budget,
              workspace.workspaceRoot,
              'recall',
              recallExcess,
              nowMs - this.limits.capEvictionGraceMs,
              result,
              () => roots.add(workspace.workspaceRoot),
            );
          }
          if (result.stop !== null) break;
        }
      }

      if (result.stop === null) {
        const preview = this.preview(settings, nowMs);
        result.preview = preview.value;
        result.readErrors.push(...preview.readErrors);
      }
      return result;
    } catch (error: unknown) {
      // degradation-audit: reported - the retention service receives the
      // attached step error, persists committed counters, and reports outcome.
      if (!(error instanceof RetentionStepError)) throw error;
      result.error = error;
      result.exhausted = false;
      // The retention service maps the attached RetentionStepError to the run outcome (database-busy -> partial, anything else -> failed), so error paths carry the error and committed counters, never a stop token.
      return result;
    } finally {
      if (roots.size > 0) this.memoryStore.markWorkspacesChanged(roots);
    }
  }

  private async runLoop(
    budget: RetentionRunBudget,
    kind: RetentionBatchKind,
    call: (limit: number) => CountedBatch,
    consume: (batch: CountedBatch) => number,
    result: MutableResult,
  ): Promise<void> {
    for (;;) {
      const room = await this.beforeBatch(budget, result);
      if (room === null) return;
      const msBefore = budget.msLeft();
      const batch = call(Math.min(room, budget.batchSize(kind)));
      const count = consume(batch);
      budget.observe(kind, msBefore - budget.msLeft());
      budget.consumeMemoryRows(count);
      if (count === 0) return;
      await budget.yieldToEventLoop();
    }
  }

  private async runEviction(
    budget: RetentionRunBudget,
    workspaceRoot: string | null,
    tier: 'archival' | 'recall',
    target: number,
    graceCutoffMs: number,
    result: MutableResult,
    markChanged: () => void,
  ): Promise<number> {
    let remaining = target;
    while (remaining > 0) {
      const room = await this.beforeBatch(budget, result);
      if (room === null) return remaining;
      const limit = Math.min(room, budget.batchSize('delete'), remaining);
      const msBefore = budget.msLeft();
      const batch = this.store.evictBatch(
        workspaceRoot,
        tier,
        graceCutoffMs,
        limit,
      );
      budget.observe('delete', msBefore - budget.msLeft());
      result.evicted += batch.evicted;
      if (batch.evicted > 0) markChanged();
      remaining -= batch.evicted;
      budget.consumeMemoryRows(batch.evicted);
      if (batch.evicted === 0) return remaining;
      await budget.yieldToEventLoop();
    }
    return remaining;
  }

  private async beforeBatch(
    budget: RetentionRunBudget,
    result: MutableResult,
  ): Promise<number | null> {
    const hardStop = budget.hardStop();
    if (hardStop !== null) {
      result.stop = hardStop;
      result.exhausted = false;
      return null;
    }
    const room = budget.memoryRowRoom();
    if (room <= 0) {
      result.stop = 'memory-row-budget';
      result.exhausted = false;
      return null;
    }
    const governorStop = await budget.waitForGovernor();
    if (governorStop !== null) {
      result.stop = governorStop;
      result.exhausted = false;
      return null;
    }
    return room;
  }

  private preview(
    settings: MemoryLifecycleSettings,
    nowMs: number,
  ): {
    readonly value: MemoryLifecyclePreview;
    readonly readErrors: readonly string[];
  } {
    const forRunAt = nowMs + this.limits.intervalMs;
    const reading = this.store.readPreview(
      forRunAt - settings.archiveAfterDays * DAY_MS,
      forRunAt - settings.deleteAfterDays * DAY_MS,
      settings.maxPerWorkspace,
    );
    const { readErrors, ...counts } = reading;
    return {
      value: { measuredAt: nowMs, forRunAt, ...counts },
      readErrors,
    };
  }

  private readSettings(): MemoryLifecycleSettings {
    try {
      return readMemoryLifecycleSettings(this.workspace);
    } catch (error: unknown) {
      // degradation-audit: optional-capability - unreadable settings degrade to
      // the file-settings defaults so retention remains bounded and predictable.
      this.logger.warn('[memory-curator] lifecycle settings unreadable', {
        error: error instanceof Error ? error.message : String(error),
      });
      return MEMORY_LIFECYCLE_DEFAULTS;
    }
  }
}
