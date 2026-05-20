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
export type {
  AgentCategory,
  AgentRecommendation,
  ArchitecturePattern,
  DiagnosticSummary,
  KeyFileLocations,
  ProjectAnalysisResult,
  TestCoverageEstimate,
} from '@ptah-extension/shared';
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
 * Architecture:
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
  private readonly streamRouter = inject(StreamRouter);
  private readonly surfaceRegistry = inject(StreamingSurfaceRegistry);

  /** Per-coordinator-instance gate preventing duplicate listener registration. */
  private isMessageListenerRegistered = false;
  private readonly _phaseSurfaces = new Map<string, SurfaceId>();
  private readonly _phaseStateRefs = new Map<string, StreamingState>();
  private readonly currentStepSignal = signal<WizardStep>('welcome');
  private readonly projectContextSignal = signal<ProjectContext | null>(null);
  private readonly availableAgentsSignal = signal<AgentSelection[]>([]);
  private readonly generationProgressSignal = signal<GenerationProgress | null>(
    null,
  );
  private readonly scanProgressSignal = signal<ScanProgress | null>(null);
  private readonly analysisStreamSignal = signal<AnalysisStreamPayload[]>([]);
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
  private readonly fallbackWarningSignal = signal<string | null>(null);
  private readonly enhancedPromptsStatusSignal =
    signal<EnhancedPromptsWizardStatus>('idle');
  private readonly enhancedPromptsErrorSignal = signal<string | null>(null);
  private readonly enhancedPromptsDetectedStackSignal = signal<string[] | null>(
    null,
  );
  private readonly enhancedPromptsSummarySignal =
    signal<EnhancedPromptsSummary | null>(null);
  private readonly _currentPhaseNumber = signal<number | null>(null);
  private readonly _totalPhaseCount = signal<number | null>(null);
  private readonly _phaseStatuses = signal<
    Array<{ id: string; status: string }>
  >([]);
  private readonly multiPhaseResultSignal =
    signal<MultiPhaseAnalysisResponse | null>(null);
  private readonly savedAnalysesSignal = signal<SavedAnalysisMetadata[]>([]);
  private readonly analysisLoadedFromHistorySignal = signal(false);
  private readonly communityPacksSignal = signal<AgentPackInfoDto[]>([]);
  private readonly communityPacksLoadingSignal = signal(false);
  private readonly agentInstallStatusSignal = signal<
    Record<string, 'idle' | 'installing' | 'installed' | 'error'>
  >({});
  private readonly expandedPackSourceSignal = signal<string | null>(null);
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
  public readonly deepAnalysis = this.deepAnalysisSignal.asReadonly();
  public readonly recommendations = this.recommendationsSignal.asReadonly();
  public readonly skillGenerationProgress =
    this.skillGenerationProgressSignal.asReadonly();
  public readonly selectedAgentsMap = this.selectedAgentsMapSignal.asReadonly();
  public readonly fallbackWarning = this.fallbackWarningSignal.asReadonly();
  public readonly enhancedPromptsStatus =
    this.enhancedPromptsStatusSignal.asReadonly();
  public readonly enhancedPromptsError =
    this.enhancedPromptsErrorSignal.asReadonly();
  public readonly enhancedPromptsDetectedStack =
    this.enhancedPromptsDetectedStackSignal.asReadonly();
  public readonly enhancedPromptsSummary =
    this.enhancedPromptsSummarySignal.asReadonly();
  public readonly savedAnalyses = this.savedAnalysesSignal.asReadonly();
  public readonly analysisLoadedFromHistory =
    this.analysisLoadedFromHistorySignal.asReadonly();
  public readonly communityPacks = this.communityPacksSignal.asReadonly();
  public readonly communityPacksLoading =
    this.communityPacksLoadingSignal.asReadonly();
  public readonly agentInstallStatus =
    this.agentInstallStatusSignal.asReadonly();
  public readonly expandedPackSource =
    this.expandedPackSourceSignal.asReadonly();
  public readonly currentPhaseNumber = this._currentPhaseNumber.asReadonly();
  public readonly totalPhaseCount = this._totalPhaseCount.asReadonly();
  public readonly phaseStatuses = this._phaseStatuses.asReadonly();
  public readonly multiPhaseResult = this.multiPhaseResultSignal.asReadonly();
  private readonly phaseAnalysis: WizardPhaseAnalysis;
  private readonly phaseGeneration: WizardPhaseGeneration;
  private readonly messageDispatcher: WizardMessageDispatcher;

  /**
   * The {@link WizardInternalState} handle the coordinator constructs for
   * its in-process helpers. Exposed so `provideWizardInternalState()` can
   * bind it to the `WIZARD_INTERNAL_STATE` DI token for external consumers
   * without re-importing the coordinator class (which would re-form a
   * cycle).
   */
  private internalState!: WizardInternalState;
  private readonly flowState: WizardFlowState;
  private readonly scanState: WizardScanState;
  private readonly analysisState: WizardAnalysisState;
  private readonly generationState: WizardGenerationState;
  private readonly communityPacksState: WizardCommunityPacksState;
  private readonly computeds: WizardComputeds;
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
      currentStep: this.currentStepSignal,
      deepAnalysis: this.deepAnalysisSignal,
      recommendations: this.recommendationsSignal,
      selectedAgentsMap: this.selectedAgentsMapSignal,
      multiPhaseResult: this.multiPhaseResultSignal,
      savedAnalyses: this.savedAnalysesSignal,
      analysisLoadedFromHistory: this.analysisLoadedFromHistorySignal,
      enhancedPromptsStatus: this.enhancedPromptsStatusSignal,
      enhancedPromptsError: this.enhancedPromptsErrorSignal,
      enhancedPromptsDetectedStack: this.enhancedPromptsDetectedStackSignal,
      enhancedPromptsSummary: this.enhancedPromptsSummarySignal,
      communityPacks: this.communityPacksSignal,
      communityPacksLoading: this.communityPacksLoadingSignal,
      agentInstallStatus: this.agentInstallStatusSignal,
      expandedPackSource: this.expandedPackSourceSignal,
    };
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
    this.flowState = new WizardFlowState(this.internalState);
    this.scanState = new WizardScanState(this.internalState);
    this.analysisState = new WizardAnalysisState(this.internalState);
    this.generationState = new WizardGenerationState(this.internalState);
    this.communityPacksState = new WizardCommunityPacksState(
      this.internalState,
    );
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
   * Expose the internal-state handle for the `WIZARD_INTERNAL_STATE`
   * provider. Caller MUST be `provideWizardInternalState` — components and
   * other services should use the dedicated public surface.
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
   * `reset()` slice plus `phaseGeneration.resetPassState()` plus direct-set
   * calls for signals whose owning helper doesn't expose a `reset()` method
   * (analysisStream, phaseStreamingStates, generationStream, enhanceStream,
   * scanProgress).
   *
   * Source order is not strictly preserved because the helper-level
   * groupings interleave — however all `.set()` calls are independent and
   * computeds re-run only after all sets complete, so final state is
   * identical.
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
    this.scanProgressSignal.set(null);
    this.analysisStreamSignal.set([]);
    this.phaseStreamingStatesSignal.set([]);
    this.generationStreamSignal.set([]);
    this.enhanceStreamSignal.set([]);
    this.resetPhaseSurfaces();
  }

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

  public setMultiPhaseResult(result: MultiPhaseAnalysisResponse): void {
    this.analysisState.setMultiPhaseResult(result);
  }

  public setSavedAnalyses(analyses: SavedAnalysisMetadata[]): void {
    this.analysisState.setSavedAnalyses(analyses);
  }

  public loadSavedAnalysis(multiPhase: MultiPhaseAnalysisResponse): void {
    this.analysisState.loadSavedAnalysis(multiPhase);
  }

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

  /**
   * Mint (or return existing) SurfaceId for a phase. Idempotent — repeat
   * calls for the same `phaseKey` return the same SurfaceId. Synchronously
   * binds via `StreamRouter.onSurfaceCreated` and registers the surface
   * adapter with `StreamingSurfaceRegistry` BEFORE this method returns, so
   * the very next `routeStreamEventForSurface` call has a live adapter to
   * resolve (registration must precede the first event).
   */
  public registerPhaseSurface(phaseKey: string): SurfaceId {
    const existing = this._phaseSurfaces.get(phaseKey);
    if (existing) return existing;

    const surfaceId = SurfaceId.create();
    this._phaseSurfaces.set(phaseKey, surfaceId);
    const initialState = createEmptyStreamingState();
    this._phaseStateRefs.set(phaseKey, initialState);
    this.streamRouter.onSurfaceCreated(surfaceId);
    this.surfaceRegistry.register(
      surfaceId,
      () => {
        return (
          this._phaseStateRefs.get(phaseKey) ?? createEmptyStreamingState()
        );
      },
      (next) => {
        this._phaseStateRefs.set(phaseKey, next);
        this.nudgePhaseStreamingStates();
      },
    );
    this.nudgePhaseStreamingStates();
    return surfaceId;
  }

  /**
   * Tear down a single phase surface. Calls `StreamRouter.onSurfaceClosed`
   * (which handles unregistering the adapter from `StreamingSurfaceRegistry`
   * — do NOT call surfaceRegistry.unregister here)
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
    this.streamRouter.onSurfaceClosed(surfaceId);
    this._phaseSurfaces.delete(phaseKey);
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
    this.resetPhaseSurfaces();
  }
}
