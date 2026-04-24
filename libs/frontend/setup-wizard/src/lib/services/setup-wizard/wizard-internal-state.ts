import type { WritableSignal } from '@angular/core';
import type { StreamingState } from '@ptah-extension/chat';
import type {
  AnalysisStreamPayload,
  GenerationStreamPayload,
} from '@ptah-extension/shared';
import type {
  AgentSelection,
  AnalysisResults,
  CompletionData,
  ErrorState,
  GenerationProgress,
  ProjectContext,
  ScanProgress,
  SkillGenerationProgressItem,
} from '../setup-wizard-state.service';

/**
 * Shared signal context for setup-wizard helpers.
 *
 * All wizard signals live on the coordinator service so their identity is
 * preserved across the Wave C7b split. Helpers mutate signals through this
 * handle — no helper owns state of its own.
 */
export interface WizardInternalState {
  // Core flow signals
  readonly projectContext: WritableSignal<ProjectContext | null>;
  readonly availableAgents: WritableSignal<AgentSelection[]>;
  readonly generationProgress: WritableSignal<GenerationProgress | null>;
  readonly scanProgress: WritableSignal<ScanProgress | null>;
  readonly analysisResults: WritableSignal<AnalysisResults | null>;
  readonly completionData: WritableSignal<CompletionData | null>;
  readonly errorState: WritableSignal<ErrorState | null>;

  // Stream accumulators
  readonly analysisStream: WritableSignal<AnalysisStreamPayload[]>;
  readonly generationStream: WritableSignal<GenerationStreamPayload[]>;
  readonly enhanceStream: WritableSignal<AnalysisStreamPayload[]>;
  readonly phaseStreamingStates: WritableSignal<Map<string, StreamingState>>;

  // Multi-phase progress (TASK_2025_154)
  readonly currentPhaseNumber: WritableSignal<number | null>;
  readonly totalPhaseCount: WritableSignal<number | null>;
  readonly phaseStatuses: WritableSignal<Array<{ id: string; status: string }>>;

  // Skill generation per-item tracking
  readonly skillGenerationProgress: WritableSignal<
    SkillGenerationProgressItem[]
  >;

  // Fallback warning (agentic → quick analysis degrade)
  readonly fallbackWarning: WritableSignal<string | null>;

  // Current step transitions driven by message handlers
  /** Set step to 'analysis' (called after analysis-complete). */
  setStepToAnalysis(): void;
  /** If current step is 'generation', set it to 'enhance' (auto-transition). */
  setCurrentStepIfGeneration(): void;
}
