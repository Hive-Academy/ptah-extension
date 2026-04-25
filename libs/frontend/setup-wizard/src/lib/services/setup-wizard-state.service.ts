import { Injectable, inject, signal } from '@angular/core';
import { VSCodeService } from '@ptah-extension/core';
import { type StreamingState } from '@ptah-extension/chat-types';
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
import { WizardStreamAccumulator } from './setup-wizard/wizard-stream-accumulator';
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
  ProjectContext,
  ScanProgress,
  SkillGenerationProgressItem,
  WizardPath,
  WizardStep,
} from './setup-wizard-state.types';

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
  WizardPath,
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

  /** Per-coordinator-instance gate preventing duplicate listener registration. */
  private isMessageListenerRegistered = false;

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
  // TASK_2025_229: per-phase StreamingState maps keyed by phase messageId.
  private readonly phaseStreamingStatesSignal = signal<
    Map<string, StreamingState>
  >(new Map());
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

  // New Project Path
  private readonly wizardPathSignal = signal<WizardPath>(null);
  private readonly newProjectTypeSignal = signal<NewProjectType | null>(null);
  private readonly questionGroupsSignal = signal<QuestionGroup[]>([]);
  private readonly currentGroupIndexSignal = signal<number>(0);
  private readonly discoveryAnswersSignal = signal<DiscoveryAnswers>({});
  private readonly masterPlanSignal = signal<MasterPlan | null>(null);
  private readonly planGeneratingSignal = signal<boolean>(false);
  private readonly forceRegenerateSignal = signal<boolean>(false);

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

  // New Project Path
  public readonly wizardPath = this.wizardPathSignal.asReadonly();
  public readonly newProjectType = this.newProjectTypeSignal.asReadonly();
  public readonly questionGroups = this.questionGroupsSignal.asReadonly();
  public readonly currentGroupIndex = this.currentGroupIndexSignal.asReadonly();
  public readonly discoveryAnswers = this.discoveryAnswersSignal.asReadonly();
  public readonly masterPlan = this.masterPlanSignal.asReadonly();
  public readonly planGenerating = this.planGeneratingSignal.asReadonly();
  public readonly forceRegenerate = this.forceRegenerateSignal.asReadonly();

  // Multi-Phase Analysis (TASK_2025_154)
  public readonly currentPhaseNumber = this._currentPhaseNumber.asReadonly();
  public readonly totalPhaseCount = this._totalPhaseCount.asReadonly();
  public readonly phaseStatuses = this._phaseStatuses.asReadonly();
  public readonly multiPhaseResult = this.multiPhaseResultSignal.asReadonly();

  // ============================================================================
  // HELPER COMPOSITION (Wave C7b + C7h split)
  // ============================================================================

  // C7b helpers — message-handling pipeline
  private readonly streamAccumulator: WizardStreamAccumulator;
  private readonly phaseAnalysis: WizardPhaseAnalysis;
  private readonly phaseGeneration: WizardPhaseGeneration;
  private readonly messageDispatcher: WizardMessageDispatcher;

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
  public readonly currentQuestionGroup: WizardComputeds['currentQuestionGroup'];
  public readonly currentGroupComplete: WizardComputeds['currentGroupComplete'];
  public readonly isLastGroup: WizardComputeds['isLastGroup'];
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
    const internalState: WizardInternalState = {
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
      // C7h: wizard step + new-project flow
      currentStep: this.currentStepSignal,
      wizardPath: this.wizardPathSignal,
      newProjectType: this.newProjectTypeSignal,
      questionGroups: this.questionGroupsSignal,
      currentGroupIndex: this.currentGroupIndexSignal,
      discoveryAnswers: this.discoveryAnswersSignal,
      masterPlan: this.masterPlanSignal,
      planGenerating: this.planGeneratingSignal,
      forceRegenerate: this.forceRegenerateSignal,
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
    this.streamAccumulator = new WizardStreamAccumulator(
      this.phaseStreamingStatesSignal,
    );
    this.phaseAnalysis = new WizardPhaseAnalysis(
      internalState,
      this.streamAccumulator,
    );
    this.phaseGeneration = new WizardPhaseGeneration(
      internalState,
      this.streamAccumulator,
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
    this.flowState = new WizardFlowState(internalState);
    this.scanState = new WizardScanState(internalState);
    this.analysisState = new WizardAnalysisState(internalState);
    this.generationState = new WizardGenerationState(internalState);
    this.communityPacksState = new WizardCommunityPacksState(internalState);

    // C7h: derived signals — delegated 1:1 (same Signal instance)
    this.computeds = new WizardComputeds(internalState);
    this.installedCommunityAgentCount =
      this.computeds.installedCommunityAgentCount;
    this.isMultiPhaseAnalysis = this.computeds.isMultiPhaseAnalysis;
    this.hasMultiPhaseResult = this.computeds.hasMultiPhaseResult;
    this.currentQuestionGroup = this.computeds.currentQuestionGroup;
    this.currentGroupComplete = this.computeds.currentGroupComplete;
    this.isLastGroup = this.computeds.isLastGroup;
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
    this.phaseStreamingStatesSignal.set(new Map()); // TASK_2025_229
    this.generationStreamSignal.set([]);
    this.enhanceStreamSignal.set([]);
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

  // === New Project State Mutations ===

  public setWizardPath(path: WizardPath): void {
    this.flowState.setWizardPath(path);
  }

  public setNewProjectType(type: NewProjectType): void {
    this.flowState.setNewProjectType(type);
  }

  public setQuestionGroups(groups: QuestionGroup[]): void {
    this.flowState.setQuestionGroups(groups);
  }

  public setDiscoveryAnswer(questionId: string, value: AnswerValue): void {
    this.flowState.setDiscoveryAnswer(questionId, value);
  }

  public nextQuestionGroup(): void {
    this.flowState.nextQuestionGroup();
  }

  public previousQuestionGroup(): void {
    this.flowState.previousQuestionGroup();
  }

  public setMasterPlan(plan: MasterPlan | null): void {
    this.flowState.setMasterPlan(plan);
  }

  public setPlanGenerating(generating: boolean): void {
    this.flowState.setPlanGenerating(generating);
  }

  public setForceRegenerate(force: boolean): void {
    this.flowState.setForceRegenerate(force);
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
  }
}
