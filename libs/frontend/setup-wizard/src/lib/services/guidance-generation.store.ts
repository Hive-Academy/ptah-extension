import { Injectable, computed, inject, signal } from '@angular/core';
import type {
  GenerationContextSource,
  SetupGenerationAccepted,
  SetupGenerationRunState,
  SetupGenerationTabBinding,
} from '@ptah-extension/shared';
import { WizardRpcService } from './wizard-rpc.service';

export type GuidanceRunStatus =
  | 'idle'
  | 'starting'
  | 'running'
  | 'cancelling'
  | 'stop-unknown'
  | 'completed'
  | 'cancelled'
  | 'failed'
  | 'timed-out'
  | 'unknown';

export interface GuidanceSnapshot {
  runId: string;
  sourceLabel: string;
  provider: string | null;
  model: string | null;
}

export interface GuidanceCommittedResult {
  generatedAt: string | null;
  enabled: boolean;
  cacheValid: boolean;
  invalidationReason?: string;
}

function sourceLabel(source: GenerationContextSource): string {
  return source.kind === 'verified-analysis'
    ? 'Verified latest analysis'
    : `Workspace discovery (${source.reason})`;
}

@Injectable({ providedIn: 'root' })
export class GuidanceGenerationStore {
  private readonly rpc = inject(WizardRpcService);
  private readonly bindingValue = signal<SetupGenerationTabBinding | null>(
    null,
  );
  private readonly runValue = signal<SetupGenerationRunState | null>(null);
  private readonly statusValue = signal<GuidanceRunStatus>('idle');
  private readonly snapshotValue = signal<GuidanceSnapshot | null>(null);
  private readonly resultValue = signal<GuidanceCommittedResult | null>(null);
  private pendingStop = false;
  private restoring = false;
  readonly binding = this.bindingValue.asReadonly();
  readonly run = this.runValue.asReadonly();
  readonly status = this.statusValue.asReadonly();
  readonly snapshot = this.snapshotValue.asReadonly();
  readonly result = this.resultValue.asReadonly();
  readonly content = signal<string | null>(null);
  readonly actionFailed = signal(false);
  readonly source = computed(() => this.snapshotValue()?.sourceLabel ?? null);

  bind(binding: SetupGenerationTabBinding): void {
    if (binding.workflow !== 'setup-project-prompt') return;
    const old = this.bindingValue();
    if (
      old?.tabId === binding.tabId &&
      old.workspacePath === binding.workspacePath
    )
      return;
    this.pendingStop = false;
    this.restoring = true;
    this.bindingValue.set(binding);
    this.runValue.set(null);
    this.snapshotValue.set(null);
    this.resultValue.set(null);
    this.statusValue.set('idle');
    this.content.set(null);
    void this.refresh();
  }

  unbind(): void {
    this.pendingStop = false;
    this.restoring = false;
    this.bindingValue.set(null);
    this.runValue.set(null);
    this.snapshotValue.set(null);
    this.resultValue.set(null);
    this.statusValue.set('idle');
    this.content.set(null);
  }

  async start(): Promise<void> {
    await this.submit(false);
  }
  async retry(): Promise<void> {
    await this.submit(false);
  }
  async regenerate(): Promise<void> {
    await this.submit(true);
  }

  private async submit(force: boolean): Promise<void> {
    const binding = this.bindingValue();
    if (
      !binding ||
      ['starting', 'running', 'cancelling'].includes(this.statusValue())
    )
      return;
    this.statusValue.set('starting');
    this.restoring = false;
    this.actionFailed.set(false);
    try {
      const response = force
        ? await this.rpc.regenerateBoundGuidance(binding)
        : await this.rpc.startBoundGuidance(binding);
      if (!this.sameBinding(binding)) return;
      if (response.accepted) this.accept(response.accepted);
      else if (response.rejection) this.statusValue.set('idle');
    } catch {
      // A lost response may still have started a run. The host is authoritative.
    }
    if (this.sameBinding(binding)) await this.refresh();
  }

  private accept(accepted: SetupGenerationAccepted): void {
    this.snapshotValue.set({
      runId: accepted.runId,
      sourceLabel: sourceLabel(accepted.source),
      provider:
        accepted.effectiveProvider === 'unknown'
          ? null
          : accepted.effectiveProvider,
      model:
        accepted.effectiveModel === 'unknown' ? null : accepted.effectiveModel,
    });
  }

  stop(): void {
    if (
      !this.bindingValue() ||
      !['starting', 'running'].includes(this.statusValue())
    )
      return;
    this.pendingStop = true;
    this.statusValue.set('cancelling');
    void this.refresh();
  }

  async refresh(): Promise<void> {
    const binding = this.bindingValue();
    if (!binding) return;
    let run: SetupGenerationRunState | null = null;
    try {
      run = await this.rpc.getBoundRunState(
        binding,
        this.snapshotValue()?.runId,
      );
    } catch {
      if (this.sameBinding(binding))
        this.statusValue.set(this.pendingStop ? 'stop-unknown' : 'unknown');
    }
    if (!this.sameBinding(binding)) return;
    if (
      run &&
      run.binding.tabId === binding.tabId &&
      run.binding.workspacePath === binding.workspacePath &&
      run.binding.workflow === binding.workflow &&
      (!this.snapshotValue() ||
        run.binding.runId === this.snapshotValue()?.runId)
    ) {
      this.runValue.set(run);
      if (!this.snapshotValue())
        this.accept({
          runId: run.binding.runId,
          source: run.source,
          status: 'starting',
          effectiveProvider: run.effectiveProvider,
          effectiveModel: run.effectiveModel,
        });
      const terminal = [
        'completed',
        'cancelled',
        'failed',
        'timed-out',
      ].includes(run.status);
      const committed = run.committedState ?? run.result?.committedState;
      this.statusValue.set(
        this.restoring && terminal && run.status !== 'cancelled'
          ? 'idle'
          : run.status === 'completed' &&
              committed !== 'committed' &&
              committed !== 'unchanged'
            ? 'failed'
            : run.status,
      );
      if (!terminal) this.restoring = false;
      if (terminal) this.pendingStop = false;
      if (this.pendingStop && !terminal) {
        this.pendingStop = false;
        try {
          await this.rpc.cancelBoundRun({
            ...binding,
            runId: run.binding.runId,
          });
        } catch {
          /* Re-read below; no raw transport error is shown. */
        }
        if (this.sameBinding(binding)) await this.refresh();
      }
    } else if (this.pendingStop) {
      this.statusValue.set('stop-unknown');
    } else if (!run && this.statusValue() === 'starting') {
      this.statusValue.set('unknown');
    }
    await this.refreshCommitted(binding);
  }

  async refreshCommitted(binding = this.bindingValue()): Promise<void> {
    if (!binding) return;
    try {
      const status = await this.rpc.getEnhancedPromptsStatus(
        binding.workspacePath,
      );
      if (this.sameBinding(binding) && !status.error) {
        this.resultValue.set(
          status.hasGeneratedPrompt
            ? {
                generatedAt: status.generatedAt,
                enabled: status.enabled,
                cacheValid: status.cacheValid,
                invalidationReason: status.invalidationReason,
              }
            : null,
        );
      }
    } catch {
      if (this.sameBinding(binding)) this.actionFailed.set(true);
    }
  }

  async setEnabled(enabled: boolean): Promise<void> {
    const binding = this.bindingValue();
    if (!binding) return;
    try {
      await this.rpc.toggleEnhancedPrompts(binding.workspacePath, enabled);
      await this.refreshCommitted(binding);
    } catch {
      if (this.sameBinding(binding)) this.actionFailed.set(true);
    }
  }

  async loadContent(): Promise<void> {
    const binding = this.bindingValue();
    if (!binding) return;
    try {
      const content = await this.rpc.getEnhancedPromptContent(
        binding.workspacePath,
      );
      if (this.sameBinding(binding)) this.content.set(content);
    } catch {
      if (this.sameBinding(binding)) this.actionFailed.set(true);
    }
  }

  async download(): Promise<void> {
    const binding = this.bindingValue();
    if (!binding) return;
    try {
      const result = await this.rpc.downloadEnhancedPrompt(
        binding.workspacePath,
      );
      if (this.sameBinding(binding)) this.actionFailed.set(!result.success);
    } catch {
      if (this.sameBinding(binding)) this.actionFailed.set(true);
    }
  }

  private sameBinding(binding: SetupGenerationTabBinding): boolean {
    const current = this.bindingValue();
    return (
      current?.tabId === binding.tabId &&
      current.workspacePath === binding.workspacePath &&
      current.workflow === binding.workflow
    );
  }
}
