import { Injectable, computed, inject, signal } from '@angular/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import type {
  SetupGenerationAccepted,
  SetupGenerationRejection,
  SetupGenerationRunState,
  SetupGenerationTabBinding,
} from '@ptah-extension/shared';
import { WizardRpcService } from './wizard-rpc.service';

export type GenerationViewState =
  | 'idle'
  | 'starting'
  | 'running'
  | 'quiet'
  | 'cancelling'
  | 'stop-unconfirmed'
  | 'stop-unknown'
  | 'completed'
  | 'cancelled'
  | 'failed'
  | 'timed-out';

@Injectable({ providedIn: 'root' })
export class GenerationWorkflowStore {
  private readonly rpc = inject(WizardRpcService);
  private readonly tabs = inject(TabManagerService);
  private readonly bindingValue = signal<SetupGenerationTabBinding | null>(
    null,
  );
  private readonly runValue = signal<SetupGenerationRunState | null>(null);
  private readonly stateValue = signal<GenerationViewState>('idle');
  private readonly rejectionValue = signal<SetupGenerationRejection | null>(
    null,
  );
  private pendingStop = false;
  readonly binding = this.bindingValue.asReadonly();
  readonly run = this.runValue.asReadonly();
  readonly state = this.stateValue.asReadonly();
  readonly rejection = this.rejectionValue.asReadonly();
  readonly chatTurnRejection = signal<string | null>(null);
  readonly isBound = computed(() =>
    [
      'starting',
      'running',
      'quiet',
      'cancelling',
      'stop-unconfirmed',
      'stop-unknown',
    ].includes(this.stateValue()),
  );
  readonly provider = computed(() => {
    const value = this.runValue()?.effectiveProvider;
    return value && value !== 'unknown' ? value : null;
  });
  readonly model = computed(() => {
    const value = this.runValue()?.effectiveModel;
    return value && value !== 'unknown' ? value : null;
  });

  bind(binding: SetupGenerationTabBinding): void {
    const old = this.bindingValue();
    if (
      old?.tabId === binding.tabId &&
      old.workspacePath === binding.workspacePath &&
      old.workflow === binding.workflow
    )
      return;
    this.pendingStop = false;
    this.runValue.set(null);
    this.stateValue.set('idle');
    this.rejectionValue.set(null);
    this.bindingValue.set(binding);
    void this.refresh();
  }

  unbind(): void {
    this.pendingStop = false;
    this.bindingValue.set(null);
    this.runValue.set(null);
    this.stateValue.set('idle');
  }

  async startAgents(selectedAgentIds: string[]): Promise<void> {
    const binding = this.bindingValue();
    if (
      !binding ||
      binding.workflow !== 'setup-agent-generation' ||
      this.isBound()
    )
      return;
    if (!this.canStartInChat(binding)) return;
    this.stateValue.set('starting');
    try {
      const response = await this.rpc.startBoundAgents(
        binding,
        selectedAgentIds,
      );
      if (!this.sameBinding(binding)) return;
      if (response.accepted) await this.accept(binding, response.accepted);
      else if (response.rejection) this.reject(response.rejection);
      else await this.refresh();
    } catch {
      if (this.sameBinding(binding)) await this.refresh();
    }
  }

  async startGuidance(): Promise<void> {
    const binding = this.bindingValue();
    if (
      !binding ||
      binding.workflow !== 'setup-project-prompt' ||
      this.isBound()
    )
      return;
    if (!this.canStartInChat(binding)) return;
    this.stateValue.set('starting');
    try {
      const response = await this.rpc.startBoundGuidance(binding);
      if (!this.sameBinding(binding)) return;
      if (response.accepted) await this.accept(binding, response.accepted);
      else if (response.rejection) this.reject(response.rejection);
      else await this.refresh();
    } catch {
      if (this.sameBinding(binding)) await this.refresh();
    }
  }

  private reject(rejection: SetupGenerationRejection): void {
    this.pendingStop = false;
    this.rejectionValue.set(rejection);
    this.stateValue.set('idle');
  }

  private canStartInChat(binding: SetupGenerationTabBinding): boolean {
    const located = this.tabs.findTabByIdAcrossWorkspaces(binding.tabId);
    const tab =
      located?.workspacePath === binding.workspacePath ? located.tab : null;
    const busy =
      !tab ||
      tab.status === 'streaming' ||
      tab.status === 'resuming' ||
      this.tabs.isTabStreaming(binding.tabId) ||
      (tab.streamingState?.currentMessageId != null &&
        tab.status !== 'awaiting-background' &&
        tab.status !== 'sleeping') ||
      Boolean(tab.queuedContent?.trim()) ||
      Boolean(tab.queuedOptions);
    this.chatTurnRejection.set(busy ? 'Finish this chat reply first' : null);
    return !busy;
  }

  private async accept(
    binding: SetupGenerationTabBinding,
    accepted: SetupGenerationAccepted,
  ): Promise<void> {
    this.runValue.set({
      binding: { ...binding, runId: accepted.runId },
      status: 'starting',
      source: accepted.source,
      effectiveProvider: accepted.effectiveProvider,
      effectiveModel: accepted.effectiveModel,
    });
    const run = await this.safeLookup(binding, accepted.runId);
    if (!this.sameBinding(binding)) return;
    if (run?.binding.runId === accepted.runId) this.applyRun(run);
    else this.stateValue.set('quiet');
    if (this.pendingStop) await this.flushStop(binding, accepted.runId);
  }

  stop(): void {
    if (!this.bindingValue() || !this.isBound()) return;
    this.pendingStop = true;
    this.stateValue.set('cancelling');
    void this.refresh();
  }

  async refresh(): Promise<void> {
    const binding = this.bindingValue();
    if (!binding) return;
    const run = await this.safeLookup(binding, this.runValue()?.binding.runId);
    if (!this.sameBinding(binding)) return;
    if (!run) {
      this.stateValue.set(
        this.pendingStop
          ? 'stop-unknown'
          : this.stateValue() === 'idle'
            ? 'idle'
            : 'quiet',
      );
      return;
    }
    const expectedRunId = this.runValue()?.binding.runId;
    if (expectedRunId && run.binding.runId !== expectedRunId) return;
    this.applyRun(run);
    if (this.pendingStop && !this.isTerminal(run.status))
      await this.flushStop(binding, run.binding.runId);
  }

  private async flushStop(
    binding: SetupGenerationTabBinding,
    runId: string,
  ): Promise<void> {
    if (!this.pendingStop || !runId) return;
    this.pendingStop = false;
    try {
      const cancelled = await this.rpc.cancelBoundRun({ ...binding, runId });
      if (this.sameBinding(binding)) {
        this.stateValue.set(cancelled ? 'cancelling' : 'stop-unconfirmed');
        await this.refresh();
      }
    } catch {
      if (this.sameBinding(binding)) {
        this.stateValue.set('stop-unconfirmed');
        void this.refresh();
      }
    }
  }

  private async safeLookup(
    binding: SetupGenerationTabBinding,
    runId?: string,
  ): Promise<SetupGenerationRunState | null> {
    try {
      return await this.rpc.getBoundRunState(binding, runId);
    } catch {
      return null;
    }
  }

  private applyRun(run: SetupGenerationRunState): void {
    const binding = this.bindingValue();
    if (
      !binding ||
      run.binding.tabId !== binding.tabId ||
      run.binding.workspacePath !== binding.workspacePath ||
      run.binding.workflow !== binding.workflow
    )
      return;
    this.runValue.set(run);
    this.stateValue.set(
      this.isTerminal(run.status)
        ? run.status
        : run.status === 'starting'
          ? 'starting'
          : this.stateValue() === 'stop-unconfirmed'
            ? 'stop-unconfirmed'
            : this.pendingStop
              ? 'cancelling'
              : run.status,
    );
    if (this.isTerminal(run.status)) this.pendingStop = false;
  }

  private sameBinding(binding: SetupGenerationTabBinding): boolean {
    const current = this.bindingValue();
    return (
      current?.tabId === binding.tabId &&
      current.workflow === binding.workflow &&
      current.workspacePath === binding.workspacePath
    );
  }

  private isTerminal(
    status: string,
  ): status is 'completed' | 'cancelled' | 'failed' | 'timed-out' {
    return ['completed', 'cancelled', 'failed', 'timed-out'].includes(status);
  }
}
