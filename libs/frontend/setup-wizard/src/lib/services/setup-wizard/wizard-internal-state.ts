import type { WritableSignal } from '@angular/core';
import type { StreamingState } from '@ptah-extension/chat-types';
import type {
  AgentPackInfoDto,
  AgentRecommendation,
  AnalysisStreamPayload,
  AnswerValue,
  DiscoveryAnswers,
  EnhancedPromptsSummary,
  GenerationStreamPayload,
  MasterPlan,
  MultiPhaseAnalysisResponse,
  NewProjectType,
  ProjectAnalysisResult,
  QuestionGroup,
  SavedAnalysisMetadata,
} from '@ptah-extension/shared';
import type {
  AgentSelection,
  AnalysisResults,
  CompletionData,
  EnhancedPromptsWizardStatus,
  ErrorState,
  GenerationProgress,
  ProjectContext,
  ScanProgress,
  SkillGenerationProgressItem,
  WizardPath,
  WizardStep,
} from '../setup-wizard-state.types';

/**
 * Shared signal context for setup-wizard helpers.
 *
 * All wizard signals live on the coordinator service so their identity is
 * preserved across the Wave C7b/C7h splits. Helpers mutate signals through
 * this handle — no helper owns state of its own.
 *
 * Wave C7h: extended additively with 22 new writable-signal fields to
 * support the 5 new state-management helpers (`WizardFlowState`,
 * `WizardScanState`, `WizardAnalysisState`, `WizardGenerationState`,
 * `WizardCommunityPacksState`).
 */
export interface WizardInternalState {
  // === Core flow signals (C7b) ===
  readonly projectContext: WritableSignal<ProjectContext | null>;
  readonly availableAgents: WritableSignal<AgentSelection[]>;
  readonly generationProgress: WritableSignal<GenerationProgress | null>;
  readonly scanProgress: WritableSignal<ScanProgress | null>;
  readonly analysisResults: WritableSignal<AnalysisResults | null>;
  readonly completionData: WritableSignal<CompletionData | null>;
  readonly errorState: WritableSignal<ErrorState | null>;

  // === Stream accumulators (C7b) ===
  readonly analysisStream: WritableSignal<AnalysisStreamPayload[]>;
  readonly generationStream: WritableSignal<GenerationStreamPayload[]>;
  readonly enhanceStream: WritableSignal<AnalysisStreamPayload[]>;
  readonly phaseStreamingStates: WritableSignal<Map<string, StreamingState>>;

  // === Multi-phase progress (C7b — TASK_2025_154) ===
  readonly currentPhaseNumber: WritableSignal<number | null>;
  readonly totalPhaseCount: WritableSignal<number | null>;
  readonly phaseStatuses: WritableSignal<Array<{ id: string; status: string }>>;

  // === Skill generation per-item tracking (C7b) ===
  readonly skillGenerationProgress: WritableSignal<
    SkillGenerationProgressItem[]
  >;

  // === Fallback warning (C7b — agentic → quick analysis degrade) ===
  readonly fallbackWarning: WritableSignal<string | null>;

  // === Current step transitions driven by message handlers (C7b) ===
  /** Set step to 'analysis' (called after analysis-complete). */
  setStepToAnalysis(): void;
  /** If current step is 'generation', set it to 'enhance' (auto-transition). */
  setCurrentStepIfGeneration(): void;

  // === Wave C7h: Wizard step + new-project flow ===
  readonly currentStep: WritableSignal<WizardStep>;
  readonly wizardPath: WritableSignal<WizardPath>;
  readonly newProjectType: WritableSignal<NewProjectType | null>;
  readonly questionGroups: WritableSignal<QuestionGroup[]>;
  readonly currentGroupIndex: WritableSignal<number>;
  readonly discoveryAnswers: WritableSignal<DiscoveryAnswers>;
  readonly masterPlan: WritableSignal<MasterPlan | null>;
  readonly planGenerating: WritableSignal<boolean>;
  readonly forceRegenerate: WritableSignal<boolean>;

  // === Wave C7h: Deep analysis + recommendations + selection + history ===
  readonly deepAnalysis: WritableSignal<ProjectAnalysisResult | null>;
  readonly recommendations: WritableSignal<AgentRecommendation[]>;
  readonly selectedAgentsMap: WritableSignal<Record<string, boolean>>;
  readonly multiPhaseResult: WritableSignal<MultiPhaseAnalysisResponse | null>;
  readonly savedAnalyses: WritableSignal<SavedAnalysisMetadata[]>;
  readonly analysisLoadedFromHistory: WritableSignal<boolean>;

  // === Wave C7h: Enhanced Prompts state ===
  readonly enhancedPromptsStatus: WritableSignal<EnhancedPromptsWizardStatus>;
  readonly enhancedPromptsError: WritableSignal<string | null>;
  readonly enhancedPromptsDetectedStack: WritableSignal<string[] | null>;
  readonly enhancedPromptsSummary: WritableSignal<EnhancedPromptsSummary | null>;

  // === Wave C7h: Community agent packs (TASK_2025_258) ===
  readonly communityPacks: WritableSignal<AgentPackInfoDto[]>;
  readonly communityPacksLoading: WritableSignal<boolean>;
  readonly agentInstallStatus: WritableSignal<
    Record<string, 'idle' | 'installing' | 'installed' | 'error'>
  >;
  readonly expandedPackSource: WritableSignal<string | null>;
}

/**
 * Type-only re-exports used by helpers below to type their public surface.
 * These re-exports are kept here so helpers can `import type { ... } from
 * './wizard-internal-state'` without pulling the whole coordinator module.
 */
export type {
  AgentPackInfoDto,
  AgentRecommendation,
  AnswerValue,
  DiscoveryAnswers,
  EnhancedPromptsSummary,
  MasterPlan,
  MultiPhaseAnalysisResponse,
  NewProjectType,
  ProjectAnalysisResult,
  QuestionGroup,
  SavedAnalysisMetadata,
};
