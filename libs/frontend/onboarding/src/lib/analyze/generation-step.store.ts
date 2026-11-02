import { Injectable, computed, effect, inject, signal } from '@angular/core';
import type {
  SetupGenerationRunState,
  SetupGenerationTabBinding,
} from '@ptah-extension/shared';
import { TabManagerService } from '@ptah-extension/chat-state';
import {
  findBoundGenerationTab,
  GenerationWorkflowStore,
  GuidanceGenerationStore,
  WizardRpcService,
} from '@ptah-extension/setup-wizard';
import {
  parseGuidanceSectionCounts,
  type GuidanceSectionCounts,
} from './guidance-section-counts';

export interface AnalyzeDoneFacts {
  readonly agents: SetupGenerationRunState | null;
  readonly guidance: SetupGenerationRunState | null;
}

@Injectable({ providedIn: 'root' })
export class GenerationStepStore {
  private readonly tabs = inject(TabManagerService);
  private readonly workflow = inject(GenerationWorkflowStore);
  private readonly guidance = inject(GuidanceGenerationStore);
  private readonly rpc = inject(WizardRpcService);
  private readonly captured = signal<{
    key: string;
    counts: GuidanceSectionCounts;
  } | null>(null);
  private readonly inFlight = new Map<
    string,
    Promise<'captured' | 'unavailable' | 'stale'>
  >();
  readonly doneFacts = computed<AnalyzeDoneFacts | null>(() => {
    const run = this.workflow.run();
    const guidance = this.guidance.run();
    const agents =
      run?.binding.workflow === 'setup-agent-generation' &&
      this.isTerminal(run.status)
        ? run
        : null;
    const guidanceRun =
      guidance && this.isTerminal(guidance.status) ? guidance : null;
    return agents || guidanceRun ? { agents, guidance: guidanceRun } : null;
  });

  constructor() {
    let observed: { runId: string; status: string } | null = null;
    effect(() => {
      const binding = this.guidance.binding();
      const run = this.guidance.run();
      const status = this.guidance.status();
      const runId = run?.binding.runId;
      if (!binding || !runId) {
        observed = null;
        return;
      }
      const wasActive =
        observed?.runId === runId &&
        observed.status !== 'completed' &&
        ['starting', 'running', 'cancelling', 'stop-unknown'].includes(
          observed.status,
        );
      observed = { runId, status };
      if (wasActive && status === 'completed')
        void this.captureGuidanceSections(binding, runId);
    });
  }

  bindAgents(
    binding: SetupGenerationTabBinding,
    runId?: string,
  ): 'bound' | 'invalid-tab' | 'workspace-mismatch' {
    return this.bind(binding, 'setup-agent-generation', runId);
  }

  bindGuidance(
    binding: SetupGenerationTabBinding,
    runId?: string,
  ): 'bound' | 'invalid-tab' | 'workspace-mismatch' {
    const result = this.bind(binding, 'setup-project-prompt', runId);
    if (result === 'bound') this.guidance.bind(binding);
    return result;
  }

  private bind(
    binding: SetupGenerationTabBinding,
    workflow: SetupGenerationTabBinding['workflow'],
    runId?: string,
  ): 'bound' | 'invalid-tab' | 'workspace-mismatch' {
    if (binding.workflow !== workflow) return 'invalid-tab';
    const located = this.tabs.findTabByIdAcrossWorkspaces(binding.tabId);
    if (!located) return 'invalid-tab';
    const tab = findBoundGenerationTab(this.tabs, binding);
    if (!tab) return 'workspace-mismatch';
    if (tab.workflow !== workflow) return 'invalid-tab';
    this.workflow.bind(binding, runId);
    return 'bound';
  }

  async captureGuidanceSections(
    binding: SetupGenerationTabBinding,
    runId: string,
  ): Promise<'captured' | 'unavailable' | 'stale'> {
    const key = `${binding.workspacePath}\u0000${runId}`;
    const pending = this.inFlight.get(key);
    if (pending) return pending;
    const capture = this.readGuidanceSections(binding, runId);
    this.inFlight.set(key, capture);
    try {
      return await capture;
    } finally {
      if (this.inFlight.get(key) === capture) this.inFlight.delete(key);
    }
  }

  private async readGuidanceSections(
    binding: SetupGenerationTabBinding,
    runId: string,
  ): Promise<'captured' | 'unavailable' | 'stale'> {
    const current = async (): Promise<boolean> => {
      const run = await this.rpc.getBoundRunState(binding);
      return (
        run?.binding.tabId === binding.tabId &&
        run.binding.workspacePath === binding.workspacePath &&
        run.binding.workflow === binding.workflow &&
        run.binding.runId === runId &&
        run.status === 'completed' &&
        (run.committedState ?? run.result?.committedState) === 'committed'
      );
    };
    try {
      if (!(await current())) return 'stale';
      const first = await this.rpc.getEnhancedPromptsStatus(
        binding.workspacePath,
      );
      if (
        !first.enabled ||
        !first.hasGeneratedPrompt ||
        first.error ||
        first.generatedAt === null
      )
        return 'unavailable';
      const content = await this.rpc.getEnhancedPromptContent(
        binding.workspacePath,
      );
      if (content === null) return 'unavailable';
      const second = await this.rpc.getEnhancedPromptsStatus(
        binding.workspacePath,
      );
      if (
        !second.enabled ||
        !second.hasGeneratedPrompt ||
        second.error ||
        second.generatedAt !== first.generatedAt
      )
        return 'stale';
      if (!(await current())) return 'stale';
      const localBinding = this.guidance.binding();
      if (
        !localBinding ||
        localBinding.tabId !== binding.tabId ||
        localBinding.workspacePath !== binding.workspacePath ||
        localBinding.workflow !== binding.workflow ||
        this.guidance.run()?.binding.runId !== runId ||
        this.guidance.status() !== 'completed'
      )
        return 'stale';
      const counts = parseGuidanceSectionCounts(content);
      if (!counts) return 'unavailable';
      this.captured.set({
        key: `${binding.workspacePath}\u0000${runId}\u0000${first.generatedAt}`,
        counts,
      });
      return 'captured';
    } catch {
      // degradation-audit: optional-capability — section counts are supplemental; the completed guidance remains available.
      return 'unavailable';
    }
  }

  guidanceSections(
    workspacePath: string,
    runId: string,
    generatedAt: string | null,
  ): GuidanceSectionCounts | null {
    if (
      !generatedAt ||
      this.guidance.result()?.generatedAt !== generatedAt ||
      this.guidance.run()?.binding.runId !== runId ||
      this.guidance.status() !== 'completed'
    )
      return null;
    const captured = this.captured();
    return captured?.key ===
      `${workspacePath}\u0000${runId}\u0000${generatedAt}`
      ? captured.counts
      : null;
  }

  private isTerminal(status: SetupGenerationRunState['status']): boolean {
    return ['completed', 'cancelled', 'failed', 'timed-out'].includes(status);
  }
}
