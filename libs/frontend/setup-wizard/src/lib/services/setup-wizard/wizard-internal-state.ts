import { InjectionToken, type WritableSignal } from '@angular/core';
import type {
  AgentPackInfoDto,
  AgentRecommendation,
  AnalysisStreamPayload,
  EnhancedPromptsSummary,
  GenerationStreamPayload,
  MultiPhaseAnalysisResponse,
  ProjectAnalysisResult,
  SavedAnalysisMetadata,
} from '@ptah-extension/shared';
import type {
  AgentSelection,
  AnalysisResults,
  CompletionData,
  EnhancedPromptsWizardStatus,
  ErrorState,
  GenerationProgress,
  PhaseStreamingEntry,
  ProjectContext,
  ScanProgress,
  SkillGenerationProgressItem,
  WizardStep,
} from '../setup-wizard-state.types';

/**
 * Shared signal context for setup-wizard helpers.
 *
 * All wizard signals live on the coordinator service so their identity is
 * preserved. Helpers mutate signals through this handle — no helper owns
 * state of its own.
 */
export interface WizardInternalState {
  // === Core flow signals ===
  readonly projectContext: WritableSignal<ProjectContext | null>;
  readonly availableAgents: WritableSignal<AgentSelection[]>;
  readonly generationProgress: WritableSignal<GenerationProgress | null>;
  readonly scanProgress: WritableSignal<ScanProgress | null>;
  readonly analysisResults: WritableSignal<AnalysisResults | null>;
  readonly completionData: WritableSignal<CompletionData | null>;
  readonly errorState: WritableSignal<ErrorState | null>;

  // === Stream accumulators ===
  readonly analysisStream: WritableSignal<AnalysisStreamPayload[]>;
  readonly generationStream: WritableSignal<GenerationStreamPayload[]>;
  readonly enhanceStream: WritableSignal<AnalysisStreamPayload[]>;
  readonly phaseStreamingStates: WritableSignal<readonly PhaseStreamingEntry[]>;

  // === Multi-phase progress ===
  readonly currentPhaseNumber: WritableSignal<number | null>;
  readonly totalPhaseCount: WritableSignal<number | null>;
  readonly phaseStatuses: WritableSignal<Array<{ id: string; status: string }>>;

  // === Skill generation per-item tracking ===
  readonly skillGenerationProgress: WritableSignal<
    SkillGenerationProgressItem[]
  >;

  // === Fallback warning (agentic → quick analysis degrade) ===
  readonly fallbackWarning: WritableSignal<string | null>;

  // === Current step transitions driven by message handlers ===
  /** Set step to 'analysis' (called after analysis-complete). */
  setStepToAnalysis(): void;
  /** If current step is 'generation', set it to 'enhance' (auto-transition). */
  setCurrentStepIfGeneration(): void;

  // === Wizard step ===
  readonly currentStep: WritableSignal<WizardStep>;

  // === Deep analysis + recommendations + selection + history ===
  readonly deepAnalysis: WritableSignal<ProjectAnalysisResult | null>;
  readonly recommendations: WritableSignal<AgentRecommendation[]>;
  readonly selectedAgentsMap: WritableSignal<Record<string, boolean>>;
  readonly multiPhaseResult: WritableSignal<MultiPhaseAnalysisResponse | null>;
  readonly savedAnalyses: WritableSignal<SavedAnalysisMetadata[]>;
  readonly analysisLoadedFromHistory: WritableSignal<boolean>;

  // === Enhanced Prompts state ===
  readonly enhancedPromptsStatus: WritableSignal<EnhancedPromptsWizardStatus>;
  readonly enhancedPromptsError: WritableSignal<string | null>;
  readonly enhancedPromptsDetectedStack: WritableSignal<string[] | null>;
  readonly enhancedPromptsSummary: WritableSignal<EnhancedPromptsSummary | null>;

  // === Community agent packs ===
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
  EnhancedPromptsSummary,
  MultiPhaseAnalysisResponse,
  ProjectAnalysisResult,
  SavedAnalysisMetadata,
};

/**
 * DI token for {@link WizardInternalState}.
 *
 * The coordinator (`SetupWizardStateService`) constructs the
 * writable-signal map and exposes it through this token via
 * `provideWizardInternalState()`.
 *
 * Helpers that live inside this library are still constructed by the
 * coordinator via plain `new` and receive the state through their
 * constructor — so they do NOT inject this token. The token exists for
 * external consumers (and future Angular-service helpers) that need to
 * read/write wizard signals without depending on the coordinator class.
 */
export const WIZARD_INTERNAL_STATE = new InjectionToken<WizardInternalState>(
  'WIZARD_INTERNAL_STATE',
);
