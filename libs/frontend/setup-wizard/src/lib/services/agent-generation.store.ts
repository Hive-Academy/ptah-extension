import { Injectable, computed, inject, signal } from '@angular/core';
import type { ResumableGenerationRun } from '@ptah-extension/shared';
import { WizardRpcService } from './wizard-rpc.service';

/** Read-only checkpoint discovery and deliberate, item-scoped recovery actions. */
@Injectable({ providedIn: 'root' })
export class AgentGenerationStore {
  private readonly rpc = inject(WizardRpcService);
  private readonly checkpointValue = signal<ResumableGenerationRun | null>(
    null,
  );
  private readonly loadingValue = signal(false);
  private readonly errorValue = signal(false);
  private readonly guidanceStatusValue = signal<
    'unknown' | 'saved' | 'missing'
  >('unknown');
  private readonly retryCounts = signal<Record<string, number>>({});
  private readonly pendingRetries = signal<ReadonlySet<string>>(new Set());
  private discoveryRevision = 0;
  readonly checkpoint = this.checkpointValue.asReadonly();
  readonly loading = this.loadingValue.asReadonly();
  readonly error = this.errorValue.asReadonly();
  readonly guidanceStatus = this.guidanceStatusValue.asReadonly();
  readonly retryingIds = this.pendingRetries.asReadonly();
  readonly remainingCounts = computed(() =>
    Object.fromEntries(
      (this.checkpointValue()?.agents ?? []).map((agent) => [
        agent.agentId,
        Math.max(0, 3 - (this.retryCounts()[agent.agentId] ?? 0)),
      ]),
    ),
  );
  readonly resumable = computed(() => {
    const run = this.checkpointValue();
    return run &&
      ['running', 'paused', 'timed-out', 'failed'].includes(run.lifecycle)
      ? run
      : null;
  });

  async discover(): Promise<void> {
    const revision = ++this.discoveryRevision;
    this.checkpointValue.set(null);
    this.loadingValue.set(true);
    try {
      const result = await this.rpc.getResumableRun();
      if (revision === this.discoveryRevision) {
        this.checkpointValue.set(result.generation);
        this.errorValue.set(false);
      }
    } catch {
      if (revision === this.discoveryRevision) this.errorValue.set(true);
    } finally {
      if (revision === this.discoveryRevision) this.loadingValue.set(false);
    }
  }

  async checkGuidance(workspacePath: string): Promise<void> {
    this.guidanceStatusValue.set('unknown');
    try {
      const status = await this.rpc.getEnhancedPromptsStatus(workspacePath);
      this.guidanceStatusValue.set(
        status.error
          ? 'unknown'
          : status.hasGeneratedPrompt
            ? 'saved'
            : 'missing',
      );
    } catch {
      this.guidanceStatusValue.set('unknown');
    }
  }

  async resume(): Promise<void> {
    if (!this.resumable() || this.loadingValue()) return;
    this.loadingValue.set(true);
    try {
      const result = await this.rpc.resumeGeneration();
      this.errorValue.set(!result.success);
    } catch {
      this.errorValue.set(true);
    } finally {
      this.loadingValue.set(false);
    }
  }

  remaining(itemId: string): number {
    return Math.max(0, 3 - (this.retryCounts()[itemId] ?? 0));
  }

  retrying(itemId: string): boolean {
    return this.pendingRetries().has(itemId);
  }

  async retry(itemId: string): Promise<void> {
    if (!itemId || this.remaining(itemId) === 0 || this.retrying(itemId))
      return;
    const attempt = 3 - this.remaining(itemId);
    this.retryCounts.update((counts) => ({ ...counts, [itemId]: attempt + 1 }));
    this.pendingRetries.update((pending) => new Set([...pending, itemId]));
    try {
      await new Promise<void>((resolve) =>
        setTimeout(resolve, 1000 * 2 ** attempt),
      );
      await this.rpc.retryGenerationItem(itemId);
      this.errorValue.set(false);
    } catch {
      this.errorValue.set(true);
    } finally {
      this.pendingRetries.update((pending) => {
        const next = new Set(pending);
        next.delete(itemId);
        return next;
      });
    }
  }
}
