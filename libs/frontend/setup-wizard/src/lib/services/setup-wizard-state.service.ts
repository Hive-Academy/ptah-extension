import { Injectable, computed, inject, signal } from '@angular/core';
import { VSCodeService } from '@ptah-extension/core';
import {
  createEmptyStreamingState,
  type StreamingState,
} from '@ptah-extension/chat-types';
import { SurfaceId } from '@ptah-extension/chat-state';
import {
  StreamRouter,
  StreamingSurfaceRegistry,
} from '@ptah-extension/chat-routing';
import type {
  AgentPackInfoDto,
  AgentRecommendation,
  AnalysisStreamPayload,
  EnhancedPromptsSummary,
  FlatStreamEventUnion,
  GenerationStreamPayload,
  MultiPhaseAnalysisResponse,
  ProjectAnalysisResult,
  SavedAnalysisMetadata,
} from '@ptah-extension/shared';
import { WizardMessageDispatcher } from './setup-wizard/wizard-message-dispatcher';
import { WizardPhaseAnalysis } from './setup-wizard/wizard-phase-analysis';
import { WizardPhaseGeneration } from './setup-wizard/wizard-phase-generation';
import { WizardFlowState } from './setup-wizard/wizard-flow-state';
import { WizardScanState } from './setup-wizard/wizard-scan-state';
import { WizardAnalysisState } from './setup-wizard/wizard-analysis-state';
import { WizardGenerationState } from './setup-wizard/wizard-generation-state';
import { WizardCommunityPacksState } from './setup-wizard/wizard-community-packs-state';
import { WizardComputeds } from './setup-wizard/wizard-computeds';
import type { WizardInternalState } from './setup-wizard/wizard-internal-state';
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
} from './setup-wizard-state.types';

/**
 * Façade exposed to {@link WizardPhaseAnalysis} and {@link WizardPhaseGeneration}
 * so they can route flat events through the canonical streaming pipeline
 * without holding a reference to the entire {@link SetupWizardStateService}.
 *
 * TASK_2026_107 Phase 3: replaces the deleted `WizardStreamAccumulator`.
 *
 * - `ensurePhaseSurface` — idempotent lazy mint of a SurfaceId for a phaseKey
 * - `routePhaseEvent` — forwards a flat event to
 *   `StreamRouter.routeStreamEventForSurface` (lazy-mints the surface if not
 *   already registered)
 * - `unregisterAllPhaseSurfaces` — closes every active routing binding
 *   (called on analysis-complete) but KEEPS the accumulated StreamingStates
 *   visible in the public `phaseStreamingStates` signal so the transcript
 *   continues to render completed phases
 * - `resetPhaseSurfaces` — full teardown: closes routing AND clears the
 *   accumulated states (called on wizard reset and on generation-stream
 *   initialization to wipe stale analysis-phase entries)
 */
export interface WizardSurfaceFacade {
  ensurePhaseSurface(phaseKey: string): SurfaceId;
  routePhaseEvent(phaseKey: string, event: FlatStreamEventUnion): void;
  unregisterAllPhaseSurfaces(): void;
  resetPhaseSurfaces(): void;
}

// Re-export shared types for backward compatibility with existing consumers
export type {
  AgentCategory,
  AgentRecommendation,
  ArchitecturePattern,
  DiagnosticSummary,
  KeyFileLocations,
  ProjectAnalysisResult,
  TestCoverageEstimate,
} from '@ptah-extension/shared';

// Wizard state types (12 declarations) extracted to a sibling file in Wave C7h
// to keep the coordinator under the 800-LOC ceiling. Re-exported here so that
// existing consumer imports (`from '.../setup-wizard-state.service'`) continue
// to resolve unchanged.
export type {
  WizardStep,
  ProjectContext,
  AgentSelection,
  GenerationProgress,
  AgentProgress,
  ScanProgress,
  AnalysisResults,
  CompletionData,
  ErrorState,
  SkillGenerationProgressItem,
  EnhancedPromptsWizardStatus,
} from './setup-wizard-state.types';

/**
 * SetupWizardStateService
 *
 * Signal-based state management for the setup wizard.
 * Manages wizard step progression, project context, agent selection,
 * and generation progress using Angular signals.
 *
 * Pattern: Signal-based state (no RxJS BehaviorSubject)
 * Zoneless Compatible: Yes (pure signal-based reactivity)
 *
 * Architecture (Wave C7b + C7h):
 * - This coordinator owns ALL writable signals (signal identity preserved
 *   for `asReadonly()` consumers).
 * - State mutation logic is delegated to 9 plain-class helpers under
 *   `./setup-wizard/`. Helpers receive the writable signals via the
 *   shared {@link WizardInternalState} handle.
 * - Public surface (35 readonly signals + 20 computeds + ~50 methods) is
 *   preserved byte-identical for the 11 component consumers.
 */
@Injectable({
  providedIn: 'root',
})
export class SetupWizardStateService {
  private readonly vscodeService = inject(VSCodeService);
  // TASK_2026_107 Phase 3: surface routing dependencies. Wizard registers a
  // SurfaceId per analysis/generation phase so its stream events flow through
  // the canonical pipeline (dedup, batching, agent stores, session binding).
  private readonly streamRouter = inject(StreamRouter);
  private readonly surfaceRegistry = inject(StreamingSurfaceRegistry);

  /** Per-coordinator-instance gate preventing duplicate listener registration. */
  private isMessageListenerRegistered = false;

  // TASK_2026_107 Phase 3: surface registration state.
  //
  // Surfaces are minted lazily on first stream event for a given phaseKey
  // (the wizard backend uses `event.messageId === wizard-phase-${currentPhase}`
  // to discriminate phases). The Map below holds the SurfaceId for each
  // active phaseKey; a sibling Map holds the live StreamingState reference
  // each surface adapter exposes via getState().
  //
  // The accumulator-core mutates StreamingState in place. To trigger Angular
  // signal reactivity for `phaseStreamingStates` consumers, we re-emit the
  // signal with a freshly-built array after every routed event — see
  // `nudgePhaseStreamingStates()`. The inner StreamingState objects are
  // shared with `_phaseStateRefs` so consumers always read the latest data.
  private readonly _phaseSurfaces = new Map<string, SurfaceId>();
  private readonly _phaseStateRefs = new Map<string, StreamingState>();

  // === Private Writable Signals ===
  // All signals live on the coordinator so signal IDENTITY is preserved for
  // `asReadonly()` consumers. C7b/C7h helpers mutate these via the shared
  // `WizardInternalState` handle (see constructor). Public docs for each
  // signal live alongside its `public readonly X = ...asReadonly()` projection
  // below.

  // Core flow
  private readonly currentStepSignal = signal<WizardStep>('welcome');
  private readonly projectContextSignal = signal<ProjectContext | null>(null);
  private readonly availableAgentsSignal = signal<AgentSelection[]>([]);
  private readonly generationProgressSignal = signal<GenerationProgress | null>(
    null,
  );
  private readonly scanProgressSignal = signal<ScanProgress | null>(null);
  private readonly analysisStreamSignal = signal<AnalysisStreamPayload[]>([]);
  // TASK_2025_229 / Wave F2: per-phase StreamingState entries keyed by phase
  // messageId. Stored as an immutable list so Angular's reference-equality
  // change detection always sees a new array on update; the byId computed
  // below provides O(1) lookup for the rare consumer that needs it.
  private readonly phaseStreamingStatesSignal = signal<
    readonly PhaseStreamingEntry[]
  >([]);
  private readonly phaseStreamingStatesByIdSignal = computed(() => {
    const m = new Map<string, StreamingState>();
    for (const entry of this.phaseStreamingStatesSignal()) {
      m.set(entry.phaseKey, entry.state);
    }
    return m;
  });
  private readonly generationStreamSignal = signal<GenerationStreamPayload[]>(
    [],
  );
  private readonly enhanceStreamSignal = signal<AnalysisStreamPayload[]>([]);
  private readonly analysisResultsSignal = signal<AnalysisResults | null>(null);
  private readonly completionDataSignal = signal<CompletionData | null>(null);
  private readonly errorStateSignal = signal<ErrorState | null>(null);

  // Deep Analysis (TASK_2025_111)
  private readonly deepAnalysisSignal = signal<ProjectAnalysisResult | null>(
    null,
  );
  private readonly recommendationsSignal = signal<AgentRecommendation[]>([]);
  private readonly skillGenerationProgressSignal = signal<
    SkillGenerationProgressItem[]
  >([]);
  private readonly selectedAgentsMapSignal = signal<Record<string, boolean>>(
    {},
  );

  // Fallback Warning + Enhanced Prompts
  private readonly fallbackWarningSignal = signal<string | null>(null);
  private readonly enhancedPromptsStatusSignal =
    signal<EnhancedPromptsWizardStatus>('idle');
  private readonly enhancedPromptsErrorSignal = signal<string | null>(null);
  private readonly enhancedPromptsDetectedStackSignal = signal<string[] | null>(
    null,
  );
  private readonly enhancedPromptsSummarySignal =
    signal<EnhancedPromptsSummary | null>(null);

  // Multi-Phase Analysis (TASK_2025_154) — 1-based phase counters.
  private readonly _currentPhaseNumber = signal<number | null>(null);
  private readonly _totalPhaseCount = signal<number | null>(null);
  private readonly _phaseStatuses = signal<
    Array<{ id: string; status: string }>
  >([]);
  private readonly multiPhaseResultSignal =
    signal<MultiPhaseAnalysisResponse | null>(null);

  // Saved Analysis History
  private readonly savedAnalysesSignal = signal<SavedAnalysisMetadata[]>([]);
  private readonly analysisLoadedFromHistorySignal = signal(false);

  // Community Agent Pack (TASK_2025_258)
  private readonly communityPacksSignal = signal<AgentPackInfoDto[]>([]);
  private readonly communityPacksLoadingSignal = signal(false);
  // agentInstallStatus key format: "{source}::{file}".
  private readonly agentInstallStatusSignal = signal<
    Record<string, 'idle' | 'installing' | 'installed' | 'error'>
  >({});
  private readonly expandedPackSourceSignal = signal<string | null>(null);

  // === Public Readonly Projections ===
  // One-line projections for each writable signal above. Per-field JSDoc was
  // intentionally removed in Wave C7h to keep the coordinator under the LOC
  // ceiling — field names + their declared types provide sufficient context.

  // Core flow
  public readonly currentStep = this.currentStepSignal.asReadonly();
  public readonly projectContext = this.projectContextSignal.asReadonly();
  public readonly availableAgents = this.availableAgentsSignal.asReadonly();
  public readonly generationProgress =
    this.generationProgressSignal.asReadonly();
  public readonly scanProgress = this.scanProgressSignal.asReadonly();
  public readonly analysisStream = this.analysisStreamSignal.asReadonly();
  public readonly phaseStreamingStates =
    this.phaseStreamingStatesSignal.asReadonly();
  /** O(1) lookup by phaseKey. Derived from {@link phaseStreamingStates}. */
  public readonly phaseStreamingStatesById =
    this.phaseStreamingStatesByIdSignal;
  public readonly generationStream = this.generationStreamSignal.asReadonly();
  public readonly enhanceStream = this.enhanceStreamSignal.asReadonly();
  public readonly analysisResults = this.analysisResultsSignal.asReadonly();
  public readonly completionData = this.completionDataSignal.asReadonly();
  public readonly errorState = this.errorStateSignal.asReadonly();

  // Deep Analysis (TASK_2025_111)
  public readonly deepAnalysis = this.deepAnalysisSignal.asReadonly();
  public readonly recommendations = this.recommendationsSignal.asReadonly();
  public readonly skillGenerationProgress =
    this.skillGenerationProgressSignal.asReadonly();
  public readonly selectedAgentsMap = this.selectedAgentsMapSignal.asReadonly();

  // Fallback Warning + Enhanced Prompts
  public readonly fallbackWarning = this.fallbackWarningSignal.asReadonly();
  public readonly enhancedPromptsStatus =
    this.enhancedPromptsStatusSignal.asReadonly();
  public readonly enhancedPromptsError =
    this.enhancedPromptsErrorSignal.asReadonly();
  public readonly enhancedPromptsDetectedStack =
    this.enhancedPromptsDetectedStackSignal.asReadonly();
  public readonly enhancedPromptsSummary =
    this.enhancedPromptsSummarySignal.asReadonly();

  // Saved Analysis History
  public readonly savedAnalyses = this.savedAnalysesSignal.asReadonly();
  public readonly analysisLoadedFromHistory =
    this.analysisLoadedFromHistorySignal.asReadonly();

  // Community Agent Pack (TASK_2025_258)
  public readonly communityPacks = this.communityPacksSignal.asReadonly();
  public readonly communityPacksLoading =
    this.communityPacksLoadingSignal.asReadonly();
  public readonly agentInstallStatus =
    this.agentInstallStatusSignal.asReadonly();
  public readonly expandedPackSource =
    this.expandedPackSourceSignal.asReadonly();

  // Multi-Phase Analysis (TASK_2025_154)
  public readonly currentPhaseNumber = this._currentPhaseNumber.asReadonly();
  public readonly totalPhaseCount = this._totalPhaseCount.asReadonly();
  public readonly phaseStatuses = this._phaseStatuses.asReadonly();
  public readonly multiPhaseResult = this.multiPhaseResultSignal.asReadonly();

  // ============================================================================
  // HELPER COMPOSITION (Wave C7b + C7h split)
  // ============================================================================

  // C7b helpers — message-handling pipeline
  private readonly phaseAnalysis: WizardPhaseAnalysis;
  private readonly phaseGeneration: WizardPhaseGeneration;
  private readonly messageDispatcher: WizardMessageDispatcher;

  /**
   * Wave F1 (TASK_2026_103): the {@link WizardInternalState} handle the
   * coordinator constructs for its in-process helpers. Exposed so
   * `provideWizardInternalState()` can bind it to the
   * `WIZARD_INTERNAL_STATE` DI token for external consumers without
   * re-importing the coordinator class (which would re-form a cycle).
   */
  private internalState!: WizardInternalState;

  // C7h helpers — state-mutation surface
  private readonly flowState: WizardFlowState;
  private readonly scanState: WizardScanState;
  private readonly analysisState: WizardAnalysisState;
  private readonly generationState: WizardGenerationState;
  private readonly communityPacksState: WizardCommunityPacksState;

  // C7h: derived (computed) signals — see ./setup-wizard/wizard-computeds.ts
  private readonly computeds: WizardComputeds;

  // === Public Computed Signals (delegated to WizardComputeds) ===
  // Signal IDENTITY is preserved: each delegate exposes the SAME `Signal`
  // instance constructed inside the helper, so Angular's reactive root tracking
  // sees a single signal across coordinator + helper.
  public readonly installedCommunityAgentCount: WizardComputeds['installedCommunityAgentCount'];
  public readonly isMultiPhaseAnalysis: WizardComputeds['isMultiPhaseAnalysis'];
  public readonly hasMultiPhaseResult: WizardComputeds['hasMultiPhaseResult'];
  public readonly activeStepConfig: WizardComputeds['activeStepConfig'];
  public readonly selectedCount: WizardComputeds['selectedCount'];
  public readonly canProceed: WizardComputeds['canProceed'];
  public readonly percentComplete: WizardComputeds['percentComplete'];
  public readonly stepIndex: WizardComputeds['stepIndex'];
  public readonly recommendedAgents: WizardComputeds['recommendedAgents'];
  public readonly totalGenerationItems: WizardComputeds['totalGenerationItems'];
  public readonly generationCompletionPercentage: WizardComputeds['generationCompletionPercentage'];
  public readonly isGenerationComplete: WizardComputeds['isGenerationComplete'];
  public readonly failedGenerationItems: WizardComputeds['failedGenerationItems'];

  public constructor() {
    this.internalState = {
      // C7b core flow
      projectContext: this.projectContextSignal,
      availableAgents: this.availableAgentsSignal,
      generationProgress: this.generationProgressSignal,
      scanProgress: this.scanProgressSignal,
      analysisResults: this.analysisResultsSignal,
      completionData: this.completionDataSignal,
      errorState: this.errorStateSignal,
      analysisStream: this.analysisStreamSignal,
      generationStream: this.generationStreamSignal,
      enhanceStream: this.enhanceStreamSignal,
      phaseStreamingStates: this.phaseStreamingStatesSignal,
      currentPhaseNumber: this._currentPhaseNumber,
      totalPhaseCount: this._totalPhaseCount,
      phaseStatuses: this._phaseStatuses,
      skillGenerationProgress: this.skillGenerationProgressSignal,
      fallbackWarning: this.fallbackWarningSignal,
      setStepToAnalysis: (): void => {
        this.currentStepSignal.set('analysis');
      },
      setCurrentStepIfGeneration: (): void => {
        if (this.currentStepSignal() === 'generation') {
          this.currentStepSignal.set('enhance');
        }
      },
      // C7h: wizard step
      currentStep: this.currentStepSignal,
      // C7h: deep analysis + recommendations + selection + history
      deepAnalysis: this.deepAnalysisSignal,
      recommendations: this.recommendationsSignal,
      selectedAgentsMap: this.selectedAgentsMapSignal,
      multiPhaseResult: this.multiPhaseResultSignal,
      savedAnalyses: this.savedAnalysesSignal,
      analysisLoadedFromHistory: this.analysisLoadedFromHistorySignal,
      // C7h: enhanced prompts
      enhancedPromptsStatus: this.enhancedPromptsStatusSignal,
      enhancedPromptsError: this.enhancedPromptsErrorSignal,
      enhancedPromptsDetectedStack: this.enhancedPromptsDetectedStackSignal,
      enhancedPromptsSummary: this.enhancedPromptsSummarySignal,
      // C7h: community packs (TASK_2025_258)
      communityPacks: this.communityPacksSignal,
      communityPacksLoading: this.communityPacksLoadingSignal,
      agentInstallStatus: this.agentInstallStatusSignal,
      expandedPackSource: this.expandedPackSourceSignal,
    };

    // C7b helpers
    // TASK_2026_107 Phase 3: WizardStreamAccumulator deleted; the helpers
    // below now route stream events through StreamRouter via the surface
    // management methods on `this` (registerPhaseSurface / routePhaseEvent /
    // resetPhaseSurfaces). The state service is passed as a thin façade so
    // helpers stay loosely coupled to the wider coordinator surface.
    const surfaceFacade: WizardSurfaceFacade = {
      ensurePhaseSurface: (phaseKey): SurfaceId =>
        this.registerPhaseSurface(phaseKey),
      routePhaseEvent: (phaseKey, event): void =>
        this.routePhaseEvent(phaseKey, event),
      unregisterAllPhaseSurfaces: (): void => this.unregisterAllPhaseSurfaces(),
      resetPhaseSurfaces: (): void => this.resetPhaseSurfaces(),
    };
    this.phaseAnalysis = new WizardPhaseAnalysis(
      this.internalState,
      surfaceFacade,
    );
    this.phaseGeneration = new WizardPhaseGeneration(
      this.internalState,
      surfaceFacade,
    );

    this.messageDispatcher = new WizardMessageDispatcher(
      {
        handleScanProgress: (p): void =>
          this.phaseAnalysis.handleScanProgress(p),
        handleAnalysisStream: (p): void =>
          this.phaseAnalysis.handleAnalysisStream(p),
        handleAnalysisComplete: (p): void =>
          this.phaseAnalysis.handleAnalysisComplete(p),
        handleAvailableAgents: (p): void =>
          this.phaseAnalysis.handleAvailableAgents(p),
        handleEnhanceStream: (p): void =>
          this.phaseAnalysis.handleEnhanceStream(p),
        handleGenerationProgress: (p): void =>
          this.phaseGeneration.handleGenerationProgress(p),
        handleGenerationComplete: (p): void =>
          this.phaseGeneration.handleGenerationComplete(p),
        handleGenerationStream: (p): void =>
          this.phaseGeneration.handleGenerationStream(p),
        handleError: (p): void => this.phaseGeneration.handleError(p),
      },
      this.errorStateSignal,
    );

    // C7h helpers — state-mutation surface
    this.flowState = new WizardFlowState(this.internalState);
    this.scanState = new WizardScanState(this.internalState);
    this.analysisState = new WizardAnalysisState(this.internalState);
    this.generationState = new WizardGenerationState(this.internalState);
    this.communityPacksState = new WizardCommunityPacksState(
      this.internalState,
    );

    // C7h: derived signals — delegated 1:1 (same Signal instance)
    this.computeds = new WizardComputeds(this.internalState);
    this.installedCommunityAgentCount =
      this.computeds.installedCommunityAgentCount;
    this.isMultiPhaseAnalysis = this.computeds.isMultiPhaseAnalysis;
    this.hasMultiPhaseResult = this.computeds.hasMultiPhaseResult;
    this.activeStepConfig = this.computeds.activeStepConfig;
    this.selectedCount = this.computeds.selectedCount;
    this.canProceed = this.computeds.canProceed;
    this.percentComplete = this.computeds.percentComplete;
    this.stepIndex = this.computeds.stepIndex;
    this.recommendedAgents = this.computeds.recommendedAgents;
    this.totalGenerationItems = this.computeds.totalGenerationItems;
    this.generationCompletionPercentage =
      this.computeds.generationCompletionPercentage;
    this.isGenerationComplete = this.computeds.isGenerationComplete;
    this.failedGenerationItems = this.computeds.failedGenerationItems;

    this.ensureMessageListenerRegistered();
  }

  /**
   * Wave F1 (TASK_2026_103): expose the internal-state handle for the
   * `WIZARD_INTERNAL_STATE` provider. Caller MUST be `provideWizardInternalState`
   * — components and other services should use the dedicated public surface.
   */
  public getInternalState(): WizardInternalState {
    return this.internalState;
  }

  /**
   * Ensure message listener is registered exactly once.
   * Safe to call multiple times. Delegates to the message dispatcher.
   */
  private ensureMessageListenerRegistered(): void {
    if (this.isMessageListenerRegistered) return;
    this.messageDispatcher.ensureRegistered();
    this.isMessageListenerRegistered = true;
  }

  // === Prerequisite-Based Navigation (Persistent Analysis History) ===

  /**
   * Check if a step can be jumped to based on prerequisites.
   * Used by the wizard view stepper to enable forward-jumps
   * when a saved analysis is loaded.
   *
   * - 'selection': requires deepAnalysis + recommendations loaded
   * - 'enhance': requires deepAnalysis loaded
   * - Others: only accessible via normal flow
   */
  public canJumpToStep(step: WizardStep): boolean {
    const hasAnalysis =
      this.multiPhaseResultSignal() !== null ||
      this.deepAnalysisSignal() !== null;
    const hasRecommendations = this.recommendationsSignal().length > 0;

    switch (step) {
      case 'selection':
        return hasAnalysis && hasRecommendations;
      case 'enhance':
        return hasAnalysis;
      default:
        return false;
    }
  }

  // === State Mutations (delegated to C7h sub-helpers) ===
  // Per-method JSDoc lives on the helper classes under ./setup-wizard/.
  // Coordinator methods are thin 1-line passthroughs; method names + signatures
  // are preserved byte-identical for the 11 component consumers.

  public setCurrentStep(step: WizardStep): void {
    this.flowState.setCurrentStep(step);
  }

  public setProjectContext(context: ProjectContext): void {
    this.scanState.setProjectContext(context);
  }

  public setAvailableAgents(agents: AgentSelection[]): void {
    this.scanState.setAvailableAgents(agents);
  }

  public toggleAgentSelection(agentId: string): void {
    this.scanState.toggleAgentSelection(agentId);
  }

  public updateGenerationProgress(progress: GenerationProgress): void {
    this.generationState.updateGenerationProgress(progress);
  }

  /**
   * Reset wizard state (for restart).
   *
   * Orchestrates the cross-cutting reset by invoking each sub-helper's
   * `reset()` slice plus `phaseGeneration.resetPassState()` plus 5
   * direct-set calls for signals owned by C7b helpers that don't expose
   * a `reset()` method (analysisStream, phaseStreamingStates,
   * generationStream, enhanceStream, scanProgress).
   *
   * The set of signals reset here is byte-equivalent to the original
   * 47-LOC body at lines 1107–1153 (pre-C7h). Source order is not
   * strictly preserved because the helper-level groupings interleave —
   * however all `.set()` calls are independent and computeds re-run only
   * after all sets complete, so final state is identical.
   *
   * Note: `savedAnalyses` is intentionally NOT reset (kept intact across
   * wizard restarts — see `WizardAnalysisState.reset()` JSDoc).
   */
  public reset(): void {
    this.flowState.reset();
    this.scanState.reset();
    this.analysisState.reset();
    this.generationState.reset();
    this.communityPacksState.reset();
    this.phaseGeneration.resetPassState();

    // Direct-set: signals owned by C7b helpers without reset() methods.
    this.scanProgressSignal.set(null);
    this.analysisStreamSignal.set([]);
    this.phaseStreamingStatesSignal.set([]); // TASK_2025_229 / Wave F2
    this.generationStreamSignal.set([]);
    this.enhanceStreamSignal.set([]);

    // TASK_2026_107 Phase 3: tear down all per-phase surface registrations
    // when the wizard restarts. Each phase's SurfaceId is unbound from its
    // conversation and removed from the surface adapter registry so the
    // router doesn't fan stale events to a dead phase entry.
    this.resetPhaseSurfaces();
  }

  // === Community Agent Pack State Mutations (TASK_2025_258) ===

  public setCommunityPacks(packs: AgentPackInfoDto[]): void {
    this.communityPacksState.setCommunityPacks(packs);
  }

  public setCommunityPacksLoading(loading: boolean): void {
    this.communityPacksState.setCommunityPacksLoading(loading);
  }

  public setAgentInstallStatus(
    key: string,
    status: 'idle' | 'installing' | 'installed' | 'error',
  ): void {
    this.communityPacksState.setAgentInstallStatus(key, status);
  }

  public toggleExpandedPack(source: string): void {
    this.communityPacksState.toggleExpandedPack(source);
  }

  // === Deep Analysis State Mutations (TASK_2025_111) ===

  public setDeepAnalysis(analysis: ProjectAnalysisResult): void {
    this.analysisState.setDeepAnalysis(analysis);
  }

  public setRecommendations(recommendations: AgentRecommendation[]): void {
    this.analysisState.setRecommendations(recommendations);
  }

  public toggleAgentRecommendationSelection(agentId: string): void {
    this.analysisState.toggleAgentRecommendationSelection(agentId);
  }

  public setAgentSelections(selections: Record<string, boolean>): void {
    this.analysisState.setAgentSelections(selections);
  }

  public selectAllRecommended(): void {
    this.analysisState.selectAllRecommended();
  }

  public deselectAllAgents(): void {
    this.analysisState.deselectAllAgents();
  }

  // === Fallback Warning + Enhanced Prompts ===

  public setFallbackWarning(warning: string | null): void {
    this.scanState.setFallbackWarning(warning);
  }

  public setEnhancedPromptsStatus(status: EnhancedPromptsWizardStatus): void {
    this.scanState.setEnhancedPromptsStatus(status);
  }

  public setEnhancedPromptsError(error: string | null): void {
    this.scanState.setEnhancedPromptsError(error);
  }

  public setEnhancedPromptsDetectedStack(stack: string[] | null): void {
    this.scanState.setEnhancedPromptsDetectedStack(stack);
  }

  public setEnhancedPromptsSummary(
    summary: EnhancedPromptsSummary | null,
  ): void {
    this.scanState.setEnhancedPromptsSummary(summary);
  }

  // === Multi-Phase Result + Saved Analysis History ===

  public setMultiPhaseResult(result: MultiPhaseAnalysisResponse): void {
    this.analysisState.setMultiPhaseResult(result);
  }

  public setSavedAnalyses(analyses: SavedAnalysisMetadata[]): void {
    this.analysisState.setSavedAnalyses(analyses);
  }

  public loadSavedAnalysis(multiPhase: MultiPhaseAnalysisResponse): void {
    this.analysisState.loadSavedAnalysis(multiPhase);
  }

  // === Skill Generation Progress ===

  public setSkillGenerationProgress(
    items: SkillGenerationProgressItem[],
  ): void {
    this.generationState.setSkillGenerationProgress(items);
  }

  public updateSkillGenerationItem(
    itemId: string,
    update: Partial<SkillGenerationProgressItem>,
  ): void {
    this.generationState.updateSkillGenerationItem(itemId, update);
  }

  public retryGenerationItem(itemId: string): void {
    this.generationState.retryGenerationItem(itemId);
  }

  // ===========================================================================
  // TASK_2026_107 Phase 3 — Surface routing (replaces WizardStreamAccumulator).
  //
  // Wizard phases (analysis + generation) participate in the canonical chat
  // streaming pipeline by registering a `SurfaceId` per `phaseKey`. The
  // SurfaceId is bound to a fresh ConversationId via StreamRouter, and the
  // accumulator-core mutates a per-phase `StreamingState` slot exposed via
  // the surface adapter's `getState`/`setState`. After every routed event we
  // re-emit `phaseStreamingStatesSignal` so consumers re-evaluate the tree
  // builder against the mutated state.
  // ===========================================================================

  /**
   * Mint (or return existing) SurfaceId for a phase. Idempotent — repeat
   * calls for the same `phaseKey` return the same SurfaceId. Synchronously
   * binds via `StreamRouter.onSurfaceCreated` and registers the surface
   * adapter with `StreamingSurfaceRegistry` BEFORE this method returns, so
   * the very next `routeStreamEventForSurface` call has a live adapter to
   * resolve (Phase 2 discovery #3 — registration must precede the first event).
   */
  public registerPhaseSurface(phaseKey: string): SurfaceId {
    const existing = this._phaseSurfaces.get(phaseKey);
    if (existing) return existing;

    const surfaceId = SurfaceId.create();
    this._phaseSurfaces.set(phaseKey, surfaceId);

    // Seed the per-phase StreamingState slot. The adapter exposes this same
    // reference via getState() so the accumulator-core mutates it in place.
    const initialState = createEmptyStreamingState();
    this._phaseStateRefs.set(phaseKey, initialState);

    // Bind to a fresh conversation BEFORE registering the adapter — order
    // doesn't strictly matter (router methods are independent), but doing
    // bind-first mirrors the chat path's onTabCreated → first event order.
    this.streamRouter.onSurfaceCreated(surfaceId);
    this.surfaceRegistry.register(
      surfaceId,
      () => {
        // Always return the live ref. If a phase ever swaps its state object
        // (compaction_complete), this getter will be replaced via setState
        // below — but the Map entry tracks the latest reference for any
        // subsequent getState() call.
        return (
          this._phaseStateRefs.get(phaseKey) ?? createEmptyStreamingState()
        );
      },
      (next) => {
        // setState fires when the accumulator-core hands back a
        // `replacementState` (currently only on compaction_complete).
        this._phaseStateRefs.set(phaseKey, next);
        this.nudgePhaseStreamingStates();
      },
    );

    // Surface the new phase entry in the public `phaseStreamingStates`
    // signal so consumers see the (initially empty) state immediately.
    this.nudgePhaseStreamingStates();
    return surfaceId;
  }

  /**
   * Tear down a single phase surface. Calls `StreamRouter.onSurfaceClosed`
   * (which handles unregistering the adapter from `StreamingSurfaceRegistry`
   * — see Phase 2 discovery #1: do NOT call surfaceRegistry.unregister here)
   * and removes the per-phase Map entries.
   *
   * The phase's accumulated `StreamingState` is intentionally retained in
   * the public `phaseStreamingStates` signal so the analysis transcript
   * keeps rendering the completed phase's tree after teardown — only the
   * routing/registry state is torn down.
   */
  public unregisterPhaseSurface(phaseKey: string): void {
    const surfaceId = this._phaseSurfaces.get(phaseKey);
    if (!surfaceId) return;

    // Phase 2 discovery #1: onSurfaceClosed handles surfaceRegistry.unregister
    // internally; calling it ourselves first would race residual events into
    // the void.
    this.streamRouter.onSurfaceClosed(surfaceId);
    this._phaseSurfaces.delete(phaseKey);
    // _phaseStateRefs stays — the analysis-transcript reads completed-phase
    // states from the signal until the wizard resets.
  }

  /** Lookup helper. Returns the SurfaceId for `phaseKey` or null. */
  public surfaceForPhase(phaseKey: string): SurfaceId | null {
    return this._phaseSurfaces.get(phaseKey) ?? null;
  }

  /**
   * Route a flat event for a phase through the canonical streaming pipeline.
   * Lazy-mints the surface if `phaseKey` hasn't been seen yet (covers the
   * stream-arrives-before-explicit-startPhase ordering — the wizard backend
   * doesn't emit a discrete "phase start" message, just begins streaming).
   *
   * After the router returns, the StreamingState referenced by the phase's
   * adapter has been mutated in place. We re-emit
   * `phaseStreamingStatesSignal` so computed consumers (analysis-transcript
   * tree builder) re-run.
   */
  public routePhaseEvent(phaseKey: string, event: FlatStreamEventUnion): void {
    const surfaceId = this.registerPhaseSurface(phaseKey);
    this.streamRouter.routeStreamEventForSurface(event, surfaceId);
    this.nudgePhaseStreamingStates();
  }

  /**
   * Close routing for every active phase surface but PRESERVE the
   * accumulated StreamingStates in the public signal so the transcript
   * continues to render completed phases. Called on analysis-complete.
   */
  public unregisterAllPhaseSurfaces(): void {
    const keys = Array.from(this._phaseSurfaces.keys());
    for (const phaseKey of keys) {
      this.unregisterPhaseSurface(phaseKey);
    }
    // _phaseStateRefs intentionally retained — completed phases stay visible.
  }

  /**
   * Full teardown: close routing for every phase AND clear all accumulated
   * states. Called on wizard reset and on generation-stream initialization
   * (so stale analysis-phase entries don't bleed into the generation
   * transcript).
   */
  public resetPhaseSurfaces(): void {
    this.unregisterAllPhaseSurfaces();
    this._phaseStateRefs.clear();
    this.phaseStreamingStatesSignal.set([]);
  }

  /**
   * Re-emit `phaseStreamingStatesSignal` with a freshly-built array drawn
   * from `_phaseStateRefs`. The inner StreamingState objects are shared
   * across emissions (the accumulator-core mutates them in place), so
   * downstream computeds must rebuild from `state.events` etc. on each
   * emission rather than caching by reference. The single existing consumer
   * (`AnalysisTranscriptComponent.allPhaseTrees`) already does this — it
   * calls `treeBuilder.buildTree(state, phaseKey)` from scratch on each run.
   */
  private nudgePhaseStreamingStates(): void {
    const next: PhaseStreamingEntry[] = [];
    for (const [phaseKey, state] of this._phaseStateRefs) {
      next.push({ phaseKey, state });
    }
    this.phaseStreamingStatesSignal.set(next);
  }

  /**
   * Cleanup for testing or explicit teardown.
   * Removes the message listener and resets the registration flag.
   *
   * Note: Root services (providedIn: 'root') are never destroyed in
   * normal operation. This method exists for unit tests, explicit
   * teardown scenarios, and memory-leak debugging.
   */
  public dispose(): void {
    this.messageDispatcher.dispose();
    this.isMessageListenerRegistered = false;
    // Tear down any lingering surface registrations so subsequent test
    // instances of the service don't see leaked routing state.
    this.resetPhaseSurfaces();
  }
}
