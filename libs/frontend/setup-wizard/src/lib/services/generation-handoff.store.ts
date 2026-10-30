import { Injectable, effect, inject, signal } from '@angular/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import { GenerationWorkflowLauncherService } from '@ptah-extension/chat-ui';
import { WizardRpcService } from './wizard-rpc.service';
import { findBoundGenerationTab } from './bound-generation-tab';
import type { SetupGenerationRunBinding } from '@ptah-extension/shared';

export interface GuidanceHandoff {
  agentTabId: string;
  workspacePath: string;
  guidanceStartDeadline: number;
}

@Injectable({ providedIn: 'root' })
export class GenerationHandoffStore {
  private readonly tabs = inject(TabManagerService);
  private readonly launcher = inject(GenerationWorkflowLauncherService);
  private readonly rpc = inject(WizardRpcService);
  private readonly pendingValue = signal<GuidanceHandoff | null>(null);
  private readonly startedValue = signal<SetupGenerationRunBinding | null>(null);
  private readonly openedTabValue = signal<{ tabId: string; workspacePath: string } | null>(null);
  private readonly inFlightValue = signal(false);
  private readonly outcomeValue = signal<
    'idle' | 'started' | 'manual-recovery' | 'skipped'
  >('idle');
  private timer: ReturnType<typeof setTimeout> | null = null;
  private revision = 0;
  readonly pending = this.pendingValue.asReadonly();
  readonly started = this.startedValue.asReadonly();
  readonly openedTab = this.openedTabValue.asReadonly();
  readonly inFlight = this.inFlightValue.asReadonly();
  readonly outcome = this.outcomeValue.asReadonly();

  constructor() {
    effect(() => {
      this.tabs.tabs();
      const pending = this.pendingValue();
      if (
        pending &&
        !this.tabs
          .getWorkspaceTabs(pending.workspacePath)
          .some((tab) => tab.id === pending.agentTabId)
      )
        this.skip();
    });
  }

  schedule(agentTabId: string, workspacePath: string): void {
    this.revision++;
    this.clearTimer();
    this.startedValue.set(null);
    this.openedTabValue.set(null);
    this.inFlightValue.set(false);
    this.pendingValue.set(null);
    const handoff = {
      agentTabId,
      workspacePath,
      guidanceStartDeadline: Date.now() + 5_000,
    };
    this.pendingValue.set(handoff);
    this.outcomeValue.set('idle');
    this.timer = setTimeout(() => void this.startNow(), 5_000);
  }

  skip(): void {
    this.revision++;
    this.clearTimer();
    this.startedValue.set(null);
    this.openedTabValue.set(null);
    this.inFlightValue.set(false);
    this.pendingValue.set(null);
    this.outcomeValue.set('skipped');
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  tabClosed(tabId: string): void {
    if (this.pendingValue()?.agentTabId === tabId) this.skip();
  }

  async startNow(): Promise<void> {
    const pending = this.pendingValue();
    if (!pending) return;
    this.clearTimer();
    this.pendingValue.set(null);
    if (
      !this.tabs
        .getWorkspaceTabs(pending.workspacePath)
        .some((tab) => tab.id === pending.agentTabId)
    )
      return;
    await this.openAndStart(pending.workspacePath, false);
  }

  async manualContinue(workspacePath: string): Promise<void> {
    this.revision++;
    this.clearTimer();
    this.startedValue.set(null);
    this.openedTabValue.set(null);
    this.pendingValue.set(null);
    this.outcomeValue.set('idle');
    await this.openAndStart(workspacePath, true);
  }

  private async openAndStart(
    workspacePath: string,
    focus: boolean,
  ): Promise<void> {
    const revision = this.revision;
    this.inFlightValue.set(true);
    try {
      const opened = await this.launcher.open({
        workspacePath,
        workflow: 'setup-project-prompt',
        origin: focus ? 'independent-start' : 'analysis-result-continue',
        focus,
      });
      if (revision !== this.revision) return;
      if (opened.outcome !== 'landed') {
        this.outcomeValue.set('manual-recovery');
        return;
      }
      this.openedTabValue.set({ tabId: opened.tabId, workspacePath });
      const tab = findBoundGenerationTab(this.tabs, {
        tabId: opened.tabId,
        workspacePath,
      });
      if (
        !tab ||
        tab.status === 'streaming' ||
        tab.status === 'resuming' ||
        this.tabs.isTabStreaming(opened.tabId) ||
        (tab.streamingState?.currentMessageId != null &&
          tab.status !== 'awaiting-background' &&
          tab.status !== 'sleeping') ||
        Boolean(tab.queuedContent?.trim()) ||
        Boolean(tab.queuedOptions)
      ) {
        this.outcomeValue.set('manual-recovery');
        return;
      }
      const response = await this.rpc.startBoundGuidance({
        workspacePath,
        tabId: opened.tabId,
        workflow: 'setup-project-prompt',
      });
      if (revision !== this.revision) return;
      this.startedValue.set(response.accepted ? {
        workspacePath, tabId: opened.tabId,
        workflow: 'setup-project-prompt', runId: response.accepted.runId,
      } : null);
      this.outcomeValue.set(response.accepted ? 'started' : 'manual-recovery');
    } catch {
      if (revision === this.revision) this.outcomeValue.set('manual-recovery');
    } finally {
      if (revision === this.revision) this.inFlightValue.set(false);
    }
  }
}
