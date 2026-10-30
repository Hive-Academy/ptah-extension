import { Injectable, computed, inject, signal } from '@angular/core';
import { ClaudeRpcService } from '@ptah-extension/core';
import type { AgentRecommendation, MultiPhaseAnalysisResponse, SavedAnalysisMetadata, SetupGenerationRejection, SetupGenerationTabBinding } from '@ptah-extension/shared';
import { GenerationWorkflowStore, SetupWizardStateService, WizardAnalysisRunner, WizardRpcService, type BoundAgentDecisions } from '@ptah-extension/setup-wizard';

export type PhaseStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
export interface PhaseRow { readonly id: string; readonly label: string; readonly status: PhaseStatus; readonly durationMs?: number }
export interface StreamCounts { readonly total: number; readonly text: number; readonly thinking: number; readonly tool: number; readonly errors: number }

const phaseLabels: Readonly<Record<string, string>> = {
  'project-profile': 'Project profile',
  'architecture-assessment': 'Architecture assessment',
  'quality-audit': 'Quality audit',
  'elevation-plan': 'Elevation plan',
};
const phaseStatuses: readonly PhaseStatus[] = ['pending', 'running', 'completed', 'failed', 'skipped'];

@Injectable({ providedIn: 'root' })
export class AnalysisStepStore {
  private readonly rpc = inject(WizardRpcService);
  private readonly catalogRpc = inject(ClaudeRpcService);
  private readonly wizard = inject(SetupWizardStateService);
  private readonly runner = inject(WizardAnalysisRunner);
  private readonly generation = inject(GenerationWorkflowStore);
  private readonly savedValue = signal<readonly SavedAnalysisMetadata[]>([]);
  private readonly hiddenValue = signal<ReadonlySet<string>>(new Set());
  private readonly selectedValue = signal<string | null>(null);
  private readonly loadedValue = signal<MultiPhaseAnalysisResponse | null>(null);
  private readonly recommendationsValue = signal<readonly AgentRecommendation[]>([]);
  private readonly selectionValue = signal<ReadonlySet<string>>(new Set());
  private readonly attachedValue = signal(false);
  readonly saved = this.savedValue.asReadonly();
  readonly hidden = this.hiddenValue.asReadonly();
  readonly selected = this.selectedValue.asReadonly();
  readonly loaded = computed(() => this.selectedValue() ? this.loadedValue() : this.completedLiveResult());
  readonly recommendations = this.recommendationsValue.asReadonly();
  readonly selection = this.selectionValue.asReadonly();
  readonly phaseRows = computed<readonly PhaseRow[]>(() => {
    const result = this.loaded();
    const phases = result?.manifest.phases;
    const live = this.selectedValue() ? [] : this.wizard.phaseStatuses();
    const ids = phases ? Object.keys(phases) : live.map((phase) => phase.id);
    return ids.map((id) => {
      const raw = live.find((phase) => phase.id === id)?.status ?? phases?.[id]?.status ?? 'pending';
      const status: PhaseStatus = phaseStatuses.includes(raw as PhaseStatus) ? raw as PhaseStatus : 'pending';
      return { id, label: phaseLabels[id] ?? id.replaceAll('-', ' '), status,
        ...(result && phases?.[id] ? { durationMs: phases[id].durationMs } : {}) };
    });
  });
  readonly phaseHeader = computed(() => {
    if (!this.attachedValue() || !this.runner.isRunning() || this.selectedValue()) return null;
    const current = this.wizard.currentPhaseNumber();
    const total = this.wizard.totalPhaseCount();
    return current !== null && total !== null ? { current, total } : null;
  });
  readonly streamCounts = computed<StreamCounts | null>(() => {
    if (!this.attachedValue() || !this.runner.isRunning() || this.selectedValue()) return null;
    const events = this.wizard.analysisStream();
    return { total: events.length, text: events.filter((event) => event.kind === 'text').length,
      thinking: events.filter((event) => event.kind === 'thinking').length,
      tool: events.filter((event) => event.kind.startsWith('tool_')).length,
      errors: events.filter((event) => event.kind === 'error' || event.isError).length };
  });

  private completedLiveResult(): MultiPhaseAnalysisResponse | null {
    const result = this.wizard.multiPhaseResult();
    return result?.manifest.lifecycle === 'completed' ? result : null;
  }

  async listAnalyses(): Promise<void> { this.savedValue.set(await this.rpc.listAnalyses({ throwOnError: true })); }
  attachStream(): void { this.attachedValue.set(true); }
  detachStream(): void { this.attachedValue.set(false); }
  hideAnalysis(filename: string): void { this.hiddenValue.update((current) => new Set([...current, filename])); }
  async selectAnalysis(filename: string): Promise<'loaded' | 'not-found' | 'failed'> {
    if (!this.savedValue().some((item) => item.filename === filename)) return 'not-found';
    try {
      const result = await this.rpc.loadAnalysis(filename);
      if (result.manifest.lifecycle !== 'completed') return 'not-found';
      this.selectedValue.set(filename);
      this.loadedValue.set(result);
      return 'loaded';
    } catch { return 'failed'; }
  }
  clearSelection(): void { this.selectedValue.set(null); this.loadedValue.set(null); }
  toggleAgent(id: string): void {
    this.selectionValue.update((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  selectRecommended(): void { this.selectionValue.set(new Set(this.recommendationsValue().filter((agent) => agent.recommended).map((agent) => agent.agentId))); }
  clearAgents(): void { this.selectionValue.set(new Set()); }
  async loadRecommendations(binding: SetupGenerationTabBinding, source: 'analysis' | 'catalog'): Promise<void> {
    this.recommendationsValue.set([]);
    const result = source === 'analysis' ? this.loaded() : null;
    if (source === 'analysis' && !result) throw new Error('Choose a completed analysis first.');
    const recommendations = source === 'analysis'
      ? await this.rpc.recommendAgents(result!)
      : await this.loadCatalog(binding);
    this.recommendationsValue.set(recommendations);
    this.selectRecommended();
  }
  private async loadCatalog(binding: SetupGenerationTabBinding): Promise<AgentRecommendation[]> {
    const response = await this.catalogRpc.call('wizard:recommend-agents',
      { mode: 'workspace-catalog', tabBinding: binding }, { timeout: 60_000 });
    if (!response.isSuccess() || !Array.isArray(response.data)) throw new Error('Catalog unavailable');
    return response.data.flatMap((value: unknown): AgentRecommendation[] => {
      if (typeof value !== 'object' || value === null) return [];
      const row = value as Record<string, unknown>;
      if (typeof row['agentId'] !== 'string' || typeof row['agentName'] !== 'string' ||
          typeof row['relevanceScore'] !== 'number' || typeof row['recommended'] !== 'boolean' ||
          !['planning', 'development', 'qa', 'specialist', 'creative'].includes(String(row['category']))) return [];
      return [{ agentId: row['agentId'], agentName: row['agentName'], relevanceScore: row['relevanceScore'],
        recommended: row['recommended'], category: row['category'] as AgentRecommendation['category'],
        matchedCriteria: Array.isArray(row['matchedCriteria']) ? row['matchedCriteria'].filter((item): item is string => typeof item === 'string') : [],
        ...(typeof row['description'] === 'string' ? { description: row['description'] } : {}),
        ...(typeof row['icon'] === 'string' ? { icon: row['icon'] } : {}) }];
    });
  }
  async submit(binding: SetupGenerationTabBinding, decisions?: BoundAgentDecisions): Promise<{ runId: string } | { rejection: SetupGenerationRejection } | { error: string }> {
    this.generation.bind(binding);
    const bound = this.generation.binding();
    if (bound?.tabId !== binding.tabId || bound.workspacePath !== binding.workspacePath || bound.workflow !== binding.workflow)
      return { error: 'Generation tab is unavailable. Try again.' };
    const previous = this.generation.acceptedRun();
    const previousRejection = this.generation.rejection();
    const previousError = this.generation.startError();
    await this.generation.startAgents([...this.selectionValue()], decisions);
    const accepted = this.generation.acceptedRun();
    if (accepted && (!previous || accepted.runId !== previous.runId || accepted.revision !== previous.revision)) return { runId: accepted.runId };
    const rejection = this.generation.rejection();
    if (rejection && rejection !== previousRejection) return { rejection };
    const error = this.generation.startError();
    return { error: error && error !== previousError ? error : 'Generation could not start. Try again.' };
  }
}
