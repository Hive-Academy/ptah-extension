import { computed, inject, Injectable, signal } from '@angular/core';
import { VSCodeService } from '@ptah-extension/core';
import { type StreamingState } from '@ptah-extension/chat';
import {
  AgentRecommendation,
  AnalysisPhase,
  AnalysisStreamPayload,
  GenerationStreamPayload,
  ProjectAnalysisResult,
  SavedAnalysisMetadata,
} from '@ptah-extension/shared';
import type { AgentPackInfoDto } from '@ptah-extension/shared';
import type {
  EnhancedPromptsSummary,
  MultiPhaseAnalysisResponse,
} from '@ptah-extension/shared';
import type {
  NewProjectType,
  QuestionGroup,
  DiscoveryAnswers,
  MasterPlan,
  AnswerValue,
} from '@ptah-extension/shared';
import { WizardStreamAccumulator } from './setup-wizard/wizard-stream-accumulator';
import { WizardMessageDispatcher } from './setup-wizard/wizard-message-dispatcher';
import { WizardPhaseAnalysis } from './setup-wizard/wizard-phase-analysis';
import { WizardPhaseGeneration } from './setup-wizard/wizard-phase-generation';
import type { WizardInternalState } from './setup-wizard/wizard-internal-state';

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

/**
 * Wizard step identifiers matching the 7-step setup flow
 * Includes premium-check step for license verification before wizard access
 */
export type WizardStep =
  | 'premium-check'
  | 'welcome'
  | 'scan'
  | 'analysis'
  | 'selection'
  | 'enhance'
  | 'generation'
  | 'completion'
  // New project path
  | 'project-type'
  | 'discovery'
  | 'plan-generation'
  | 'plan-review';

/**
 * Wizard path discriminator.
 * 'existing' = analyze existing project, 'new' = start new project, null = not yet chosen.
 */
export type WizardPath = 'existing' | 'new' | null;

/**
 * Project context detected during workspace scan
 */
export interface ProjectContext {
  type: string;
  techStack: string[];
  architecture?: string;
  isMonorepo: boolean;
  monorepoType?: string;
  packageCount?: number;
}

/**
 * Agent selection with relevance scoring
 */
export interface AgentSelection {
  id: string;
  name: string;
  selected: boolean;
  score: number;
  reason: string;
  autoInclude: boolean;
}

/**
 * Generation progress tracking
 */
export interface GenerationProgress {
  phase: 'analysis' | 'selection' | 'customization' | 'rendering' | 'complete';
  percentComplete: number;
  filesScanned?: number;
  totalFiles?: number;
  detections?: string[];
  agents?: AgentProgress[];
  currentAgent?: string;
}

export interface AgentProgress {
  id: string;
  name: string;
  status: 'pending' | 'in-progress' | 'complete' | 'error';
  currentTask?: string;
  duration?: number;
  customizationSummary?: string;
  errorMessage?: string;
}

/**
 * Scan progress tracking.
 * Extended with agentic analysis fields for phase stepper and reasoning display.
 */
export interface ScanProgress {
  filesScanned: number;
  totalFiles: number;
  detections: string[];
  /** Current analysis phase (agentic analysis only) */
  currentPhase?: AnalysisPhase;
  /** Human-readable label for the current phase (agentic analysis only) */
  phaseLabel?: string;
  /** Agent reasoning/activity description (agentic analysis only) */
  agentReasoning?: string;
  /** List of completed phase identifiers (agentic analysis only) */
  completedPhases?: AnalysisPhase[];
}

/**
 * Analysis results payload
 */
export interface AnalysisResults {
  projectContext: ProjectContext;
}

/**
 * Completion data payload
 */
export interface CompletionData {
  success: boolean;
  generatedCount: number;
  duration?: number;
  errors?: string[];
  warnings?: string[];
  enhancedPromptsUsed?: boolean;
}

/**
 * Error state
 */
export interface ErrorState {
  message: string;
  details?: string;
}

/**
 * Generation progress item.
 * Tracks progress of individual items during agent generation.
 */
export interface SkillGenerationProgressItem {
  /** Unique item identifier */
  id: string;
  /** Display name */
  name: string;
  /** Item type: agent or enhanced-prompt */
  type: 'agent' | 'enhanced-prompt';
  /** Current status */
  status: 'pending' | 'in-progress' | 'complete' | 'error';
  /** Progress percentage 0-100 (optional) */
  progress?: number;
  /** Error message if status is 'error' */
  errorMessage?: string;
}

/**
 * Enhanced Prompts generation status for the wizard.
 * Tracks the state of Enhanced Prompts generation during setup.
 */
export type EnhancedPromptsWizardStatus =
  | 'idle'
  | 'generating'
  | 'complete'
  | 'error'
  | 'skipped';

/**
 * SetupWizardStateService
 *
 * Signal-based state management for the setup wizard.
 * Manages wizard step progression, project context, agent selection,
 * and generation progress using Angular signals.
 *
 * Pattern: Signal-based state (no RxJS BehaviorSubject)
 * Zoneless Compatible: Yes (pure signal-based reactivity)
 */
@Injectable({
  providedIn: 'root',
})
export class SetupWizardStateService {
  private readonly vscodeService = inject(VSCodeService);

  /**
   * Track whether message listener is registered.
   * Prevents duplicate registration for root-level service.
   */
  private isMessageListenerRegistered = false;

  // === State Signals ===

  /**
   * Private writable signal for current wizard step (6 steps total)
   */
  private readonly currentStepSignal = signal<WizardStep>('welcome');

  /**
   * Private writable signal for detected project context from workspace scan
   */
  private readonly projectContextSignal = signal<ProjectContext | null>(null);

  /**
   * Private writable signal for available agents with selection state
   */
  private readonly availableAgentsSignal = signal<AgentSelection[]>([]);

  /**
   * Private writable signal for current generation progress (null when not generating)
   */
  private readonly generationProgressSignal = signal<GenerationProgress | null>(
    null,
  );

  /**
   * Private writable signal for scan progress tracking (null when not scanning)
   */
  private readonly scanProgressSignal = signal<ScanProgress | null>(null);

  /**
   * Private writable signal for analysis stream messages (live transcript).
   * Accumulates AnalysisStreamPayload messages during agentic analysis.
   */
  private readonly analysisStreamSignal = signal<AnalysisStreamPayload[]>([]);

  /**
   * Private writable signal for per-phase StreamingState maps.
   * Keyed by phase messageId (e.g., 'wizard-phase-project-profile').
   * Each StreamingState accumulates FlatStreamEventUnion events for ExecutionNode rendering.
   * TASK_2025_229
   */
  private readonly phaseStreamingStatesSignal = signal<
    Map<string, StreamingState>
  >(new Map());

  /**
   * Private writable signal for generation stream messages (live transcript).
   * Accumulates GenerationStreamPayload messages during content generation.
   */
  private readonly generationStreamSignal = signal<GenerationStreamPayload[]>(
    [],
  );

  /**
   * Private writable signal for enhance stream messages (live transcript).
   * Accumulates AnalysisStreamPayload messages during enhanced prompts generation.
   */
  private readonly enhanceStreamSignal = signal<AnalysisStreamPayload[]>([]);

  /**
   * Private writable signal for analysis results (null until analysis complete)
   */
  private readonly analysisResultsSignal = signal<AnalysisResults | null>(null);

  /**
   * Private writable signal for completion data (null until wizard complete)
   */
  private readonly completionDataSignal = signal<CompletionData | null>(null);

  /**
   * Private writable signal for error state (null when no error)
   */
  private readonly errorStateSignal = signal<ErrorState | null>(null);

  // === Deep Analysis State Signals (TASK_2025_111) ===

  /**
   * Private writable signal for deep project analysis results.
   * Contains comprehensive project insights from MCP-powered analysis.
   */
  private readonly deepAnalysisSignal = signal<ProjectAnalysisResult | null>(
    null,
  );

  /**
   * Private writable signal for agent recommendations.
   * Contains scored recommendations for all 13 agents based on project analysis.
   */
  private readonly recommendationsSignal = signal<AgentRecommendation[]>([]);

  /**
   * Private writable signal for generation progress.
   * Tracks progress of agents during generation.
   */
  private readonly skillGenerationProgressSignal = signal<
    SkillGenerationProgressItem[]
  >([]);

  /**
   * Private writable signal for selected agents map.
   * Maps agentId to selection state (true = selected).
   */
  private readonly selectedAgentsMapSignal = signal<Record<string, boolean>>(
    {},
  );

  // === Fallback Warning State ===

  /**
   * Private writable signal for fallback warning message.
   * Set when agentic analysis falls back to quick analysis mode.
   * Displayed as a non-blocking warning in the scan progress UI.
   */
  private readonly fallbackWarningSignal = signal<string | null>(null);

  // === Enhanced Prompts State Signals ===

  /**
   * Private writable signal for Enhanced Prompts generation status.
   * Tracks whether Enhanced Prompts has been generated during wizard setup.
   */
  private readonly enhancedPromptsStatusSignal =
    signal<EnhancedPromptsWizardStatus>('idle');

  /**
   * Private writable signal for Enhanced Prompts error message.
   */
  private readonly enhancedPromptsErrorSignal = signal<string | null>(null);

  /**
   * Private writable signal for Enhanced Prompts detected stack.
   * Populated after successful generation.
   */
  private readonly enhancedPromptsDetectedStackSignal = signal<string[] | null>(
    null,
  );

  /**
   * Private writable signal for Enhanced Prompts generation summary.
   * Contains section metadata (names, word counts) without actual content.
   */
  private readonly enhancedPromptsSummarySignal =
    signal<EnhancedPromptsSummary | null>(null);

  // === Multi-Phase Analysis State Signals (TASK_2025_154) ===

  /**
   * Private writable signal for current phase number in multi-phase analysis.
   * 1-based index of the currently running phase.
   */
  private readonly _currentPhaseNumber = signal<number | null>(null);

  /**
   * Private writable signal for total number of phases in multi-phase analysis.
   */
  private readonly _totalPhaseCount = signal<number | null>(null);

  /**
   * Private writable signal for per-phase status tracking.
   * Each entry tracks a phase's id and its current status.
   */
  private readonly _phaseStatuses = signal<
    Array<{ id: string; status: string }>
  >([]);

  /**
   * Private writable signal for multi-phase analysis result.
   * Contains the full MultiPhaseAnalysisResponse when multi-phase pipeline was used.
   */
  private readonly multiPhaseResultSignal =
    signal<MultiPhaseAnalysisResponse | null>(null);

  // === Saved Analysis History State Signals ===

  /**
   * Private writable signal for saved analyses list (metadata only).
   * Populated from backend via wizard:list-analyses RPC.
   */
  private readonly savedAnalysesSignal = signal<SavedAnalysisMetadata[]>([]);

  /**
   * Private writable signal tracking whether current analysis was loaded from history.
   * When true, the analysis was loaded (not scanned fresh).
   */
  private readonly analysisLoadedFromHistorySignal = signal(false);

  // === Community Agent Pack State (TASK_2025_258) ===

  /**
   * Private writable signal for available community agent packs.
   * Populated from backend via wizard:list-agent-packs RPC.
   */
  private readonly communityPacksSignal = signal<AgentPackInfoDto[]>([]);

  /**
   * Private writable signal for community packs loading state.
   */
  private readonly communityPacksLoadingSignal = signal(false);

  /**
   * Private writable signal for per-agent install status.
   * Key format: "{source}::{file}" for unique identification across packs.
   */
  private readonly agentInstallStatusSignal = signal<
    Record<string, 'idle' | 'installing' | 'installed' | 'error'>
  >({});

  /**
   * Private writable signal for currently expanded pack source.
   * Only one pack can be expanded at a time.
   */
  private readonly expandedPackSourceSignal = signal<string | null>(null);

  // === New Project State Signals ===

  /**
   * Private writable signal for wizard path (existing vs new project).
   * null until the user chooses a path on the welcome screen.
   */
  private readonly wizardPathSignal = signal<WizardPath>(null);

  /**
   * Private writable signal for the selected new project type.
   */
  private readonly newProjectTypeSignal = signal<NewProjectType | null>(null);

  /**
   * Private writable signal for discovery question groups.
   * Populated from backend after project type selection.
   */
  private readonly questionGroupsSignal = signal<QuestionGroup[]>([]);

  /**
   * Private writable signal for the currently displayed question group index.
   */
  private readonly currentGroupIndexSignal = signal<number>(0);

  /**
   * Private writable signal for accumulated discovery answers.
   * Keyed by question ID.
   */
  private readonly discoveryAnswersSignal = signal<DiscoveryAnswers>({});

  /**
   * Private writable signal for the generated master plan.
   */
  private readonly masterPlanSignal = signal<MasterPlan | null>(null);

  /**
   * Private writable signal for plan generation loading state.
   */
  private readonly planGeneratingSignal = signal<boolean>(false);

  private readonly forceRegenerateSignal = signal<boolean>(false);

  /**
   * Public readonly signal for current wizard step
   */
  public readonly currentStep = this.currentStepSignal.asReadonly();

  /**
   * Public readonly signal for detected project context
   */
  public readonly projectContext = this.projectContextSignal.asReadonly();

  /**
   * Public readonly signal for available agents
   */
  public readonly availableAgents = this.availableAgentsSignal.asReadonly();

  /**
   * Public readonly signal for generation progress
   */
  public readonly generationProgress =
    this.generationProgressSignal.asReadonly();

  /**
   * Public readonly signal for scan progress
   */
  public readonly scanProgress = this.scanProgressSignal.asReadonly();

  /**
   * Public readonly signal for analysis stream messages.
   * Used by AnalysisTranscriptComponent to display live agent transcript.
   */
  public readonly analysisStream = this.analysisStreamSignal.asReadonly();

  /**
   * Public readonly signal for per-phase streaming states.
   * Used by AnalysisTranscriptComponent to build ExecutionNode trees.
   * TASK_2025_229
   */
  public readonly phaseStreamingStates =
    this.phaseStreamingStatesSignal.asReadonly();

  /**
   * Public readonly signal for generation stream messages.
   * Used by GenerationProgressComponent to display live agent transcript during content generation.
   */
  public readonly generationStream = this.generationStreamSignal.asReadonly();

  /**
   * Public readonly signal for enhance stream messages.
   * Used by PromptEnhancementComponent to display live agent transcript during enhanced prompts generation.
   */
  public readonly enhanceStream = this.enhanceStreamSignal.asReadonly();

  /**
   * Public readonly signal for analysis results
   */
  public readonly analysisResults = this.analysisResultsSignal.asReadonly();

  /**
   * Public readonly signal for completion data
   */
  public readonly completionData = this.completionDataSignal.asReadonly();

  /**
   * Public readonly signal for error state
   */
  public readonly errorState = this.errorStateSignal.asReadonly();

  // === Deep Analysis Public Signals (TASK_2025_111) ===

  /**
   * Public readonly signal for deep project analysis results.
   * Use this to display architecture patterns, key files, and code health.
   */
  public readonly deepAnalysis = this.deepAnalysisSignal.asReadonly();

  /**
   * Public readonly signal for agent recommendations.
   * Contains all 13 agents with relevance scores and matched criteria.
   */
  public readonly recommendations = this.recommendationsSignal.asReadonly();

  /**
   * Public readonly signal for generation progress.
   * Tracks individual progress of agents.
   */
  public readonly skillGenerationProgress =
    this.skillGenerationProgressSignal.asReadonly();

  /**
   * Public readonly signal for selected agents map.
   * Provides direct access to agent selection state.
   */
  public readonly selectedAgentsMap = this.selectedAgentsMapSignal.asReadonly();

  // === Fallback Warning Public Signal ===

  /**
   * Public readonly signal for fallback warning message.
   * Non-null when agentic analysis fell back to quick analysis mode.
   */
  public readonly fallbackWarning = this.fallbackWarningSignal.asReadonly();

  // === Enhanced Prompts Public Signals ===

  /**
   * Public readonly signal for Enhanced Prompts generation status.
   */
  public readonly enhancedPromptsStatus =
    this.enhancedPromptsStatusSignal.asReadonly();

  /**
   * Public readonly signal for Enhanced Prompts error message.
   */
  public readonly enhancedPromptsError =
    this.enhancedPromptsErrorSignal.asReadonly();

  /**
   * Public readonly signal for Enhanced Prompts detected stack labels.
   */
  public readonly enhancedPromptsDetectedStack =
    this.enhancedPromptsDetectedStackSignal.asReadonly();

  /**
   * Public readonly signal for Enhanced Prompts generation summary.
   * Contains section metadata (names, word counts) without actual content.
   */
  public readonly enhancedPromptsSummary =
    this.enhancedPromptsSummarySignal.asReadonly();

  // === Saved Analysis History Public Signals ===

  /**
   * Public readonly signal for saved analyses metadata.
   * Used by the welcome component to display analysis history cards.
   */
  public readonly savedAnalyses = this.savedAnalysesSignal.asReadonly();

  /**
   * Public readonly signal for whether the current analysis was loaded from history.
   */
  public readonly analysisLoadedFromHistory =
    this.analysisLoadedFromHistorySignal.asReadonly();

  // === Community Agent Pack Public Signals (TASK_2025_258) ===

  /**
   * Public readonly signal for available community agent packs.
   */
  public readonly communityPacks = this.communityPacksSignal.asReadonly();

  /**
   * Public readonly signal for community packs loading state.
   */
  public readonly communityPacksLoading =
    this.communityPacksLoadingSignal.asReadonly();

  /**
   * Public readonly signal for per-agent install status map.
   */
  public readonly agentInstallStatus =
    this.agentInstallStatusSignal.asReadonly();

  /**
   * Public readonly signal for currently expanded pack source.
   */
  public readonly expandedPackSource =
    this.expandedPackSourceSignal.asReadonly();

  // === New Project Public Signals ===

  /**
   * Public readonly signal for wizard path (existing vs new project).
   */
  public readonly wizardPath = this.wizardPathSignal.asReadonly();

  /**
   * Public readonly signal for selected new project type.
   */
  public readonly newProjectType = this.newProjectTypeSignal.asReadonly();

  /**
   * Public readonly signal for discovery question groups.
   */
  public readonly questionGroups = this.questionGroupsSignal.asReadonly();

  /**
   * Public readonly signal for current question group index.
   */
  public readonly currentGroupIndex = this.currentGroupIndexSignal.asReadonly();

  /**
   * Public readonly signal for accumulated discovery answers.
   */
  public readonly discoveryAnswers = this.discoveryAnswersSignal.asReadonly();

  /**
   * Public readonly signal for the generated master plan.
   */
  public readonly masterPlan = this.masterPlanSignal.asReadonly();

  /**
   * Public readonly signal for plan generation loading state.
   */
  public readonly planGenerating = this.planGeneratingSignal.asReadonly();

  public readonly forceRegenerate = this.forceRegenerateSignal.asReadonly();

  /**
   * Computed signal for count of installed community agents.
   */
  public readonly installedCommunityAgentCount = computed(() => {
    const statuses = this.agentInstallStatusSignal();
    return Object.values(statuses).filter((s) => s === 'installed').length;
  });

  // === Multi-Phase Analysis Public Signals (TASK_2025_154) ===

  /**
   * Public readonly signal for current phase number (1-based).
   */
  public readonly currentPhaseNumber = this._currentPhaseNumber.asReadonly();

  /**
   * Public readonly signal for total number of phases.
   */
  public readonly totalPhaseCount = this._totalPhaseCount.asReadonly();

  /**
   * Public readonly signal for per-phase status tracking.
   */
  public readonly phaseStatuses = this._phaseStatuses.asReadonly();

  /**
   * Public readonly signal for multi-phase analysis result.
   * Non-null when the wizard used the multi-phase pipeline.
   */
  public readonly multiPhaseResult = this.multiPhaseResultSignal.asReadonly();

  /**
   * Computed signal indicating whether a multi-phase analysis is active.
   * True when totalPhaseCount is set and greater than zero.
   */
  public readonly isMultiPhaseAnalysis = computed(
    () =>
      this._totalPhaseCount() !== null && (this._totalPhaseCount() ?? 0) > 0,
  );

  /**
   * Computed signal indicating whether we have a completed multi-phase result.
   */
  public readonly hasMultiPhaseResult = computed(
    () => this.multiPhaseResultSignal() !== null,
  );

  // === New Project Computed Signals ===

  /**
   * Computed signal for the currently displayed question group.
   * Returns null if no groups are loaded or index is out of bounds.
   */
  public readonly currentQuestionGroup = computed(() => {
    const groups = this.questionGroupsSignal();
    const index = this.currentGroupIndexSignal();
    return groups[index] ?? null;
  });

  /**
   * Computed signal indicating whether all required questions in the current group are answered.
   */
  public readonly currentGroupComplete = computed(() => {
    const group = this.currentQuestionGroup();
    if (!group) return false;
    const answers = this.discoveryAnswersSignal();
    return group.questions
      .filter((q) => q.required)
      .every((q) => {
        const answer = answers[q.id];
        if (answer === undefined || answer === null) return false;
        if (Array.isArray(answer))
          return answer.length >= (q.minSelections ?? 1);
        return String(answer).trim().length > 0;
      });
  });

  /**
   * Computed signal indicating whether the current group is the last in the sequence.
   */
  public readonly isLastGroup = computed(() => {
    const groups = this.questionGroupsSignal();
    return this.currentGroupIndexSignal() >= groups.length - 1;
  });

  /**
   * Computed signal for the active wizard step configuration based on the chosen path.
   * Returns different step sequences and labels for 'existing' vs 'new' project paths.
   */
  public readonly activeStepConfig = computed<{
    steps: WizardStep[];
    labels: string[];
  }>(() => {
    const path = this.wizardPathSignal();
    if (path === 'new') {
      return {
        steps: [
          'welcome',
          'project-type',
          'discovery',
          'plan-generation',
          'plan-review',
          'selection',
          'generation',
          'completion',
        ],
        labels: [
          'Welcome',
          'Type',
          'Discovery',
          'Planning',
          'Review',
          'Select',
          'Generate',
          'Complete',
        ],
      };
    }
    return {
      steps: [
        'welcome',
        'scan',
        'analysis',
        'selection',
        'generation',
        'enhance',
        'completion',
      ],
      labels: [
        'Welcome',
        'Scan',
        'Analysis',
        'Select',
        'Generate',
        'Enhance',
        'Complete',
      ],
    };
  });

  // ============================================================================
  // HELPER COMPOSITION (Wave C7b split)
  // ============================================================================

  private readonly streamAccumulator: WizardStreamAccumulator;
  private readonly phaseAnalysis: WizardPhaseAnalysis;
  private readonly phaseGeneration: WizardPhaseGeneration;
  private readonly messageDispatcher: WizardMessageDispatcher;

  public constructor() {
    const internalState: WizardInternalState = {
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
    };

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

  // === Computed Signals ===

  /**
   * Selected agents count (for display)
   */
  public readonly selectedCount = computed(() => {
    return this.availableAgentsSignal().filter((a) => a.selected).length;
  });

  /**
   * Can proceed to next step (validation logic)
   */
  public readonly canProceed = computed(() => {
    const step = this.currentStepSignal();
    switch (step) {
      case 'premium-check':
        return false; // Cannot proceed until license verified
      case 'welcome':
        return true; // Always can start
      case 'scan':
        return false; // Cannot proceed during scan
      case 'analysis':
        return this.projectContextSignal() !== null; // Need project context
      case 'selection':
        return this.selectedCount() > 0; // Need at least one agent
      case 'enhance':
        return false; // Enhance step manages its own Continue button
      case 'generation':
        return false; // Cannot proceed during generation
      case 'completion':
        return true; // Wizard complete
      // New project path steps
      case 'project-type':
        return this.newProjectTypeSignal() !== null;
      case 'discovery':
        return this.currentGroupComplete();
      case 'plan-generation':
        return false; // Cannot proceed during plan generation
      case 'plan-review':
        return this.masterPlanSignal() !== null;
      default:
        return false;
    }
  });

  /**
   * Overall wizard completion percentage (0-100)
   */
  public readonly percentComplete = computed(() => {
    const step = this.currentStepSignal();
    const progress = this.generationProgressSignal();

    // Base progress from step progression
    const stepProgress: Record<WizardStep, number> = {
      'premium-check': 0,
      welcome: 5,
      scan: 20,
      analysis: 35,
      selection: 50,
      generation: progress?.percentComplete ?? 55,
      enhance: 85,
      completion: 100,
      // New project path steps
      'project-type': 15,
      discovery: 30,
      'plan-generation': 45,
      'plan-review': 55,
    };

    return stepProgress[step];
  });

  /**
   * Current step index (0-based) for the UI progress indicator.
   * Excludes 'premium-check' since that step is not displayed in the stepper.
   * Uses activeStepConfig to support both existing and new project paths.
   */
  public readonly stepIndex = computed(() => {
    const step = this.currentStepSignal();
    const config = this.activeStepConfig();
    return config.steps.indexOf(step);
  });

  // === Deep Analysis Computed Signals (TASK_2025_111) ===

  /**
   * Computed signal for recommended agents (score >= 75).
   * Returns agents that are highly relevant to the project.
   */
  public readonly recommendedAgents = computed(() => {
    return this.recommendationsSignal().filter(
      (recommendation) => recommendation.relevanceScore >= 75,
    );
  });

  /**
   * Computed signal for total generation items count.
   * Counts selected agents only.
   */
  public readonly totalGenerationItems = computed(() => {
    const selectedAgents = this.selectedAgentsMapSignal();
    return Object.values(selectedAgents).filter(Boolean).length;
  });

  /**
   * Computed signal for generation completion percentage.
   * Based on skill generation progress items.
   */
  public readonly generationCompletionPercentage = computed(() => {
    const items = this.skillGenerationProgressSignal();
    if (items.length === 0) return 0;

    const completedCount = items.filter(
      (item) => item.status === 'complete',
    ).length;
    return Math.round((completedCount / items.length) * 100);
  });

  /**
   * Computed signal indicating if all generation items are complete.
   */
  public readonly isGenerationComplete = computed(() => {
    const items = this.skillGenerationProgressSignal();
    if (items.length === 0) return false;

    return items.every(
      (item) => item.status === 'complete' || item.status === 'error',
    );
  });

  /**
   * Computed signal for generation items with errors.
   */
  public readonly failedGenerationItems = computed(() => {
    return this.skillGenerationProgressSignal().filter(
      (item) => item.status === 'error',
    );
  });

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

  // === State Mutations ===

  /**
   * Set current wizard step
   */
  public setCurrentStep(step: WizardStep): void {
    this.currentStepSignal.set(step);
  }

  /**
   * Update project context from scan results
   */
  public setProjectContext(context: ProjectContext): void {
    this.projectContextSignal.set(context);
  }

  /**
   * Set available agents (from backend)
   */
  public setAvailableAgents(agents: AgentSelection[]): void {
    this.availableAgentsSignal.set(agents);
  }

  /**
   * Toggle agent selection
   */
  public toggleAgentSelection(agentId: string): void {
    this.availableAgentsSignal.update((agents) =>
      agents.map((agent) =>
        agent.id === agentId ? { ...agent, selected: !agent.selected } : agent,
      ),
    );
  }

  /**
   * Update generation progress
   */
  public updateGenerationProgress(progress: GenerationProgress): void {
    this.generationProgressSignal.set(progress);
  }

  /**
   * Reset wizard state (for restart)
   */
  public reset(): void {
    this.currentStepSignal.set('welcome');
    this.projectContextSignal.set(null);
    this.availableAgentsSignal.set([]);
    this.generationProgressSignal.set(null);
    this.scanProgressSignal.set(null);
    this.analysisStreamSignal.set([]);
    this.phaseStreamingStatesSignal.set(new Map()); // TASK_2025_229: Clear streaming states
    this.generationStreamSignal.set([]);
    this.enhanceStreamSignal.set([]);
    this.analysisResultsSignal.set(null);
    this.completionDataSignal.set(null);
    this.errorStateSignal.set(null);
    this.fallbackWarningSignal.set(null);
    this.phaseGeneration.resetPassState();
    // Reset deep analysis state (TASK_2025_111)
    this.deepAnalysisSignal.set(null);
    this.recommendationsSignal.set([]);
    this.skillGenerationProgressSignal.set([]);
    this.selectedAgentsMapSignal.set({});
    // Reset Enhanced Prompts state
    this.enhancedPromptsStatusSignal.set('idle');
    this.enhancedPromptsErrorSignal.set(null);
    this.enhancedPromptsDetectedStackSignal.set(null);
    this.enhancedPromptsSummarySignal.set(null);
    // Reset multi-phase analysis state (TASK_2025_154)
    this._currentPhaseNumber.set(null);
    this._totalPhaseCount.set(null);
    this._phaseStatuses.set([]);
    this.multiPhaseResultSignal.set(null);
    // Reset analysis history state (keep savedAnalyses list intact)
    this.analysisLoadedFromHistorySignal.set(false);
    // Reset community agent pack state (TASK_2025_258)
    this.communityPacksSignal.set([]);
    this.communityPacksLoadingSignal.set(false);
    this.agentInstallStatusSignal.set({});
    this.expandedPackSourceSignal.set(null);
    // Reset new project state
    this.wizardPathSignal.set(null);
    this.newProjectTypeSignal.set(null);
    this.questionGroupsSignal.set([]);
    this.currentGroupIndexSignal.set(0);
    this.discoveryAnswersSignal.set({});
    this.masterPlanSignal.set(null);
    this.planGeneratingSignal.set(false);
    this.forceRegenerateSignal.set(false);
  }

  // === Community Agent Pack State Mutations (TASK_2025_258) ===

  /**
   * Set available community agent packs.
   * Called after fetching pack manifests from backend.
   *
   * @param packs - Array of community agent pack info DTOs
   */
  public setCommunityPacks(packs: AgentPackInfoDto[]): void {
    this.communityPacksSignal.set(packs);
  }

  /**
   * Set community packs loading state.
   *
   * @param loading - Whether packs are currently being fetched
   */
  public setCommunityPacksLoading(loading: boolean): void {
    this.communityPacksLoadingSignal.set(loading);
  }

  /**
   * Set install status for a specific agent.
   * Key format: "{source}::{file}" for unique identification across packs.
   *
   * @param key - Unique key identifying the agent ({source}::{file})
   * @param status - Current install status
   */
  public setAgentInstallStatus(
    key: string,
    status: 'idle' | 'installing' | 'installed' | 'error',
  ): void {
    this.agentInstallStatusSignal.update((map) => ({
      ...map,
      [key]: status,
    }));
  }

  /**
   * Toggle expanded pack source.
   * Collapses if the same source is already expanded, otherwise expands.
   *
   * @param source - Pack source URL to toggle
   */
  public toggleExpandedPack(source: string): void {
    this.expandedPackSourceSignal.update((current) =>
      current === source ? null : source,
    );
  }

  // === New Project State Mutations ===

  /**
   * Set the wizard path (existing vs new project).
   * Called when the user chooses a path on the welcome screen.
   */
  public setWizardPath(path: WizardPath): void {
    this.wizardPathSignal.set(path);
  }

  /**
   * Set the selected new project type.
   * Called when the user picks a project type (e.g., full-saas, angular-app).
   */
  public setNewProjectType(type: NewProjectType): void {
    this.newProjectTypeSignal.set(type);
  }

  /**
   * Set discovery question groups from the backend.
   * Resets the current group index to 0 and clears any stale discovery answers
   * (e.g., from a previously selected project type).
   */
  public setQuestionGroups(groups: QuestionGroup[]): void {
    this.questionGroupsSignal.set(groups);
    this.currentGroupIndexSignal.set(0);
    this.discoveryAnswersSignal.set({});
  }

  /**
   * Set a single discovery answer by question ID.
   * Immutably updates the answers map.
   */
  public setDiscoveryAnswer(questionId: string, value: AnswerValue): void {
    this.discoveryAnswersSignal.update((answers) => ({
      ...answers,
      [questionId]: value,
    }));
  }

  /**
   * Advance to the next question group.
   * No-op if already on the last group.
   */
  public nextQuestionGroup(): void {
    const groups = this.questionGroupsSignal();
    const current = this.currentGroupIndexSignal();
    if (current < groups.length - 1) {
      this.currentGroupIndexSignal.set(current + 1);
    }
  }

  /**
   * Go back to the previous question group.
   * No-op if already on the first group.
   */
  public previousQuestionGroup(): void {
    const current = this.currentGroupIndexSignal();
    if (current > 0) {
      this.currentGroupIndexSignal.set(current - 1);
    }
  }

  /**
   * Set the generated master plan.
   * Called when plan generation completes successfully, or null to clear it.
   */
  public setMasterPlan(plan: MasterPlan | null): void {
    this.masterPlanSignal.set(plan);
  }

  /**
   * Set the plan generation loading state.
   */
  public setPlanGenerating(generating: boolean): void {
    this.planGeneratingSignal.set(generating);
  }

  public setForceRegenerate(force: boolean): void {
    this.forceRegenerateSignal.set(force);
  }

  // === Deep Analysis State Mutations (TASK_2025_111) ===

  /**
   * Set deep project analysis results.
   * Called after MCP-powered analysis completes.
   *
   * @param analysis - Comprehensive project analysis from backend
   */
  public setDeepAnalysis(analysis: ProjectAnalysisResult): void {
    this.deepAnalysisSignal.set(analysis);
  }

  /**
   * Set agent recommendations from deep analysis.
   * Auto-selects agents with relevance score >= 80.
   *
   * @param recommendations - Array of agent recommendations with scores
   */
  public setRecommendations(recommendations: AgentRecommendation[]): void {
    this.recommendationsSignal.set(recommendations);

    // Auto-select agents with score >= 80 (highly recommended)
    const autoSelected: Record<string, boolean> = {};
    for (const rec of recommendations) {
      autoSelected[rec.agentId] = rec.relevanceScore >= 80;
    }
    this.selectedAgentsMapSignal.set(autoSelected);
  }

  /**
   * Toggle agent selection in the recommendations map.
   *
   * @param agentId - Agent identifier to toggle
   */
  public toggleAgentRecommendationSelection(agentId: string): void {
    this.selectedAgentsMapSignal.update((selected) => ({
      ...selected,
      [agentId]: !selected[agentId],
    }));
  }

  /**
   * Set multiple agent selections at once.
   *
   * @param selections - Map of agentId to selection state
   */
  public setAgentSelections(selections: Record<string, boolean>): void {
    this.selectedAgentsMapSignal.set(selections);
  }

  /**
   * Select all recommended agents (score >= 75).
   */
  public selectAllRecommended(): void {
    this.selectedAgentsMapSignal.update((selected) => {
      const updated = { ...selected };
      for (const rec of this.recommendationsSignal()) {
        if (rec.recommended) {
          updated[rec.agentId] = true;
        }
      }
      return updated;
    });
  }

  /**
   * Deselect all agents.
   */
  public deselectAllAgents(): void {
    this.selectedAgentsMapSignal.update((selected) => {
      const updated = { ...selected };
      for (const key of Object.keys(updated)) {
        updated[key] = false;
      }
      return updated;
    });
  }

  // === Fallback Warning State Mutation ===

  /**
   * Set or clear the fallback warning message.
   * Called when agentic analysis falls back to quick analysis mode.
   */
  public setFallbackWarning(warning: string | null): void {
    this.fallbackWarningSignal.set(warning);
  }

  // === Enhanced Prompts State Mutations ===

  /**
   * Set Enhanced Prompts generation status.
   */
  public setEnhancedPromptsStatus(status: EnhancedPromptsWizardStatus): void {
    this.enhancedPromptsStatusSignal.set(status);
  }

  /**
   * Set Enhanced Prompts error message.
   */
  public setEnhancedPromptsError(error: string | null): void {
    this.enhancedPromptsErrorSignal.set(error);
  }

  /**
   * Set Enhanced Prompts detected stack for display.
   */
  public setEnhancedPromptsDetectedStack(stack: string[] | null): void {
    this.enhancedPromptsDetectedStackSignal.set(stack);
  }

  /**
   * Set Enhanced Prompts generation summary.
   * Contains section metadata without actual prompt content (IP protection).
   */
  public setEnhancedPromptsSummary(
    summary: EnhancedPromptsSummary | null,
  ): void {
    this.enhancedPromptsSummarySignal.set(summary);
  }

  // === Multi-Phase Result State Mutation ===

  /**
   * Set multi-phase analysis result.
   * Called when wizard:deep-analyze returns a MultiPhaseAnalysisResponse.
   */
  public setMultiPhaseResult(result: MultiPhaseAnalysisResponse): void {
    this.multiPhaseResultSignal.set(result);
  }

  // === Saved Analysis History State Mutations ===

  /**
   * Set saved analyses list from backend.
   * Called when the welcome component fetches the list.
   */
  public setSavedAnalyses(analyses: SavedAnalysisMetadata[]): void {
    this.savedAnalysesSignal.set(analyses);
  }

  /**
   * Load a saved multi-phase analysis into state.
   * Sets multiPhaseResult and marks as loaded from history.
   * Does NOT set recommendations — caller should fetch them separately
   * via recommendAgents() after loading.
   *
   * @param multiPhase - Multi-phase analysis response
   */
  public loadSavedAnalysis(multiPhase: MultiPhaseAnalysisResponse): void {
    this.multiPhaseResultSignal.set(multiPhase);
    this.analysisLoadedFromHistorySignal.set(true);

    // Set projectContext from slug for backward compatibility
    const projectType = multiPhase.manifest.slug
      .replace(/-/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
    this.projectContextSignal.set({
      type: projectType,
      techStack: [],
      isMonorepo: false,
    });
  }

  /**
   * Set skill generation progress items.
   * Called when generation begins with initial item list.
   *
   * @param items - Array of generation progress items
   */
  public setSkillGenerationProgress(
    items: SkillGenerationProgressItem[],
  ): void {
    this.skillGenerationProgressSignal.set(items);
  }

  /**
   * Update a single skill generation progress item.
   *
   * @param itemId - Item identifier to update
   * @param update - Partial update to apply
   */
  public updateSkillGenerationItem(
    itemId: string,
    update: Partial<SkillGenerationProgressItem>,
  ): void {
    this.skillGenerationProgressSignal.update((items) =>
      items.map((item) => (item.id === itemId ? { ...item, ...update } : item)),
    );
  }

  /**
   * Reset a failed generation item for retry.
   *
   * @param itemId - Item identifier to reset
   */
  public retryGenerationItem(itemId: string): void {
    this.updateSkillGenerationItem(itemId, {
      status: 'pending',
      progress: 0,
      errorMessage: undefined,
    });
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
