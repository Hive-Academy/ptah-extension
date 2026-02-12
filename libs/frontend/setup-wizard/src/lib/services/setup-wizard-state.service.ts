import { computed, inject, Injectable, signal } from '@angular/core';
import { VSCodeService } from '@ptah-extension/core';
import {
  AgentRecommendation,
  AnalysisCompletePayload,
  AnalysisPhase,
  AnalysisStreamPayload,
  AvailableAgentsPayload,
  GenerationCompletePayload,
  GenerationProgressPayload,
  GenerationStreamPayload,
  ProjectAnalysisResult,
  ScanProgressPayload,
  WizardErrorPayload,
  WizardMessage,
  WizardMessageType,
} from '@ptah-extension/shared';

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
  | 'completion';

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
 * Skill generation progress item.
 * Tracks progress of individual items during skill/command generation.
 */
export interface SkillGenerationProgressItem {
  /** Unique item identifier */
  id: string;
  /** Display name */
  name: string;
  /** Item type: agent, command, skill file, or enhanced-prompt */
  type: 'agent' | 'command' | 'skill-file' | 'enhanced-prompt';
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

  /**
   * Message handler reference for cleanup.
   * Stored to allow removal during dispose().
   */
  private messageHandler: ((event: MessageEvent) => void) | null = null;

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
    null
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
   * Private writable signal for generation stream messages (live transcript).
   * Accumulates GenerationStreamPayload messages during content generation.
   */
  private readonly generationStreamSignal = signal<GenerationStreamPayload[]>(
    []
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
    null
  );

  /**
   * Private writable signal for agent recommendations.
   * Contains scored recommendations for all 13 agents based on project analysis.
   */
  private readonly recommendationsSignal = signal<AgentRecommendation[]>([]);

  /**
   * Private writable signal for skill generation progress.
   * Tracks progress of agents, commands, and skill files during generation.
   */
  private readonly skillGenerationProgressSignal = signal<
    SkillGenerationProgressItem[]
  >([]);

  /**
   * Private writable signal for selected agents map.
   * Maps agentId to selection state (true = selected).
   */
  private readonly selectedAgentsMapSignal = signal<Record<string, boolean>>(
    {}
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
    null
  );

  /**
   * Public readonly signal for current wizard step
   */
  readonly currentStep = this.currentStepSignal.asReadonly();

  /**
   * Public readonly signal for detected project context
   */
  readonly projectContext = this.projectContextSignal.asReadonly();

  /**
   * Public readonly signal for available agents
   */
  readonly availableAgents = this.availableAgentsSignal.asReadonly();

  /**
   * Public readonly signal for generation progress
   */
  readonly generationProgress = this.generationProgressSignal.asReadonly();

  /**
   * Public readonly signal for scan progress
   */
  readonly scanProgress = this.scanProgressSignal.asReadonly();

  /**
   * Public readonly signal for analysis stream messages.
   * Used by AnalysisTranscriptComponent to display live agent transcript.
   */
  readonly analysisStream = this.analysisStreamSignal.asReadonly();

  /**
   * Public readonly signal for generation stream messages.
   * Used by GenerationProgressComponent to display live agent transcript during content generation.
   */
  readonly generationStream = this.generationStreamSignal.asReadonly();

  /**
   * Public readonly signal for enhance stream messages.
   * Used by PromptEnhancementComponent to display live agent transcript during enhanced prompts generation.
   */
  readonly enhanceStream = this.enhanceStreamSignal.asReadonly();

  /**
   * Public readonly signal for analysis results
   */
  readonly analysisResults = this.analysisResultsSignal.asReadonly();

  /**
   * Public readonly signal for completion data
   */
  readonly completionData = this.completionDataSignal.asReadonly();

  /**
   * Public readonly signal for error state
   */
  readonly errorState = this.errorStateSignal.asReadonly();

  // === Deep Analysis Public Signals (TASK_2025_111) ===

  /**
   * Public readonly signal for deep project analysis results.
   * Use this to display architecture patterns, key files, and code health.
   */
  readonly deepAnalysis = this.deepAnalysisSignal.asReadonly();

  /**
   * Public readonly signal for agent recommendations.
   * Contains all 13 agents with relevance scores and matched criteria.
   */
  readonly recommendations = this.recommendationsSignal.asReadonly();

  /**
   * Public readonly signal for skill generation progress.
   * Tracks individual progress of agents, commands, and skill files.
   */
  readonly skillGenerationProgress =
    this.skillGenerationProgressSignal.asReadonly();

  /**
   * Public readonly signal for selected agents map.
   * Provides direct access to agent selection state.
   */
  readonly selectedAgentsMap = this.selectedAgentsMapSignal.asReadonly();

  // === Fallback Warning Public Signal ===

  /**
   * Public readonly signal for fallback warning message.
   * Non-null when agentic analysis fell back to quick analysis mode.
   */
  readonly fallbackWarning = this.fallbackWarningSignal.asReadonly();

  // === Enhanced Prompts Public Signals ===

  /**
   * Public readonly signal for Enhanced Prompts generation status.
   */
  readonly enhancedPromptsStatus =
    this.enhancedPromptsStatusSignal.asReadonly();

  /**
   * Public readonly signal for Enhanced Prompts error message.
   */
  readonly enhancedPromptsError = this.enhancedPromptsErrorSignal.asReadonly();

  /**
   * Public readonly signal for Enhanced Prompts detected stack labels.
   */
  readonly enhancedPromptsDetectedStack =
    this.enhancedPromptsDetectedStackSignal.asReadonly();

  constructor() {
    this.ensureMessageListenerRegistered();
  }

  /**
   * Ensure message listener is registered exactly once.
   * Safe to call multiple times - uses flag to prevent duplicate registration.
   * This is the proper pattern for root-level services that are never destroyed.
   */
  private ensureMessageListenerRegistered(): void {
    if (this.isMessageListenerRegistered) {
      return;
    }

    this.setupMessageListener();
    this.isMessageListenerRegistered = true;
  }

  // === Computed Signals ===

  /**
   * Selected agents count (for display)
   */
  readonly selectedCount = computed(() => {
    return this.availableAgentsSignal().filter((a) => a.selected).length;
  });

  /**
   * Can proceed to next step (validation logic)
   */
  readonly canProceed = computed(() => {
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
      default:
        return false;
    }
  });

  /**
   * Overall wizard completion percentage (0-100)
   */
  readonly percentComplete = computed(() => {
    const step = this.currentStepSignal();
    const progress = this.generationProgressSignal();

    // Base progress from step progression (7 steps with premium-check)
    const stepProgress: Record<WizardStep, number> = {
      'premium-check': 0,
      welcome: 5,
      scan: 20,
      analysis: 35,
      selection: 50,
      enhance: 55,
      generation: progress?.percentComplete ?? 65,
      completion: 100,
    };

    return stepProgress[step];
  });

  /**
   * Current step index (0-based) for the UI progress indicator.
   * Excludes 'premium-check' since that step is not displayed in the stepper.
   */
  readonly stepIndex = computed(() => {
    const step = this.currentStepSignal();
    const uiStepOrder: WizardStep[] = [
      'welcome',
      'scan',
      'analysis',
      'selection',
      'enhance',
      'generation',
      'completion',
    ];
    // 'premium-check' maps to -1 (not shown in stepper)
    return uiStepOrder.indexOf(step);
  });

  // === Deep Analysis Computed Signals (TASK_2025_111) ===

  /**
   * Computed signal for recommended agents (score >= 75).
   * Returns agents that are highly relevant to the project.
   */
  readonly recommendedAgents = computed(() => {
    return this.recommendationsSignal().filter(
      (recommendation) => recommendation.relevanceScore >= 75
    );
  });

  /**
   * Computed signal for total generation items count.
   * Includes selected agents + commands (5) + skill files (7).
   *
   * Command count: 5 (review-code, review-logic, review-security, orchestrate, orchestrate-help)
   * Skill file count: 7 (SKILL.md + 6 references)
   */
  readonly totalGenerationItems = computed(() => {
    const selectedAgents = this.selectedAgentsMapSignal();
    const selectedAgentCount =
      Object.values(selectedAgents).filter(Boolean).length;

    const COMMAND_COUNT = 5; // Fixed: review-code, review-logic, review-security, orchestrate, orchestrate-help
    const SKILL_FILE_COUNT = 7; // Fixed: SKILL.md + 6 reference files

    return selectedAgentCount + COMMAND_COUNT + SKILL_FILE_COUNT;
  });

  /**
   * Computed signal for generation completion percentage.
   * Based on skill generation progress items.
   */
  readonly generationCompletionPercentage = computed(() => {
    const items = this.skillGenerationProgressSignal();
    if (items.length === 0) return 0;

    const completedCount = items.filter(
      (item) => item.status === 'complete'
    ).length;
    return Math.round((completedCount / items.length) * 100);
  });

  /**
   * Computed signal indicating if all generation items are complete.
   */
  readonly isGenerationComplete = computed(() => {
    const items = this.skillGenerationProgressSignal();
    if (items.length === 0) return false;

    return items.every(
      (item) => item.status === 'complete' || item.status === 'error'
    );
  });

  /**
   * Computed signal for generation items with errors.
   */
  readonly failedGenerationItems = computed(() => {
    return this.skillGenerationProgressSignal().filter(
      (item) => item.status === 'error'
    );
  });

  // === State Mutations ===

  /**
   * Set current wizard step
   */
  setCurrentStep(step: WizardStep): void {
    this.currentStepSignal.set(step);
  }

  /**
   * Update project context from scan results
   */
  setProjectContext(context: ProjectContext): void {
    this.projectContextSignal.set(context);
  }

  /**
   * Set available agents (from backend)
   */
  setAvailableAgents(agents: AgentSelection[]): void {
    this.availableAgentsSignal.set(agents);
  }

  /**
   * Toggle agent selection
   */
  toggleAgentSelection(agentId: string): void {
    this.availableAgentsSignal.update((agents) =>
      agents.map((agent) =>
        agent.id === agentId ? { ...agent, selected: !agent.selected } : agent
      )
    );
  }

  /**
   * Update generation progress
   */
  updateGenerationProgress(progress: GenerationProgress): void {
    this.generationProgressSignal.set(progress);
  }

  /**
   * Reset wizard state (for restart)
   */
  reset(): void {
    this.currentStepSignal.set('welcome');
    this.projectContextSignal.set(null);
    this.availableAgentsSignal.set([]);
    this.generationProgressSignal.set(null);
    this.scanProgressSignal.set(null);
    this.analysisStreamSignal.set([]);
    this.generationStreamSignal.set([]);
    this.enhanceStreamSignal.set([]);
    this.analysisResultsSignal.set(null);
    this.completionDataSignal.set(null);
    this.errorStateSignal.set(null);
    this.fallbackWarningSignal.set(null);
    // Reset deep analysis state (TASK_2025_111)
    this.deepAnalysisSignal.set(null);
    this.recommendationsSignal.set([]);
    this.skillGenerationProgressSignal.set([]);
    this.selectedAgentsMapSignal.set({});
    // Reset Enhanced Prompts state
    this.enhancedPromptsStatusSignal.set('idle');
    this.enhancedPromptsErrorSignal.set(null);
    this.enhancedPromptsDetectedStackSignal.set(null);
  }

  // === Deep Analysis State Mutations (TASK_2025_111) ===

  /**
   * Set deep project analysis results.
   * Called after MCP-powered analysis completes.
   *
   * @param analysis - Comprehensive project analysis from backend
   */
  setDeepAnalysis(analysis: ProjectAnalysisResult): void {
    this.deepAnalysisSignal.set(analysis);
  }

  /**
   * Set agent recommendations from deep analysis.
   * Auto-selects agents with relevance score >= 80.
   *
   * @param recommendations - Array of agent recommendations with scores
   */
  setRecommendations(recommendations: AgentRecommendation[]): void {
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
  toggleAgentRecommendationSelection(agentId: string): void {
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
  setAgentSelections(selections: Record<string, boolean>): void {
    this.selectedAgentsMapSignal.set(selections);
  }

  /**
   * Select all recommended agents (score >= 75).
   */
  selectAllRecommended(): void {
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
  deselectAllAgents(): void {
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
  setFallbackWarning(warning: string | null): void {
    this.fallbackWarningSignal.set(warning);
  }

  // === Enhanced Prompts State Mutations ===

  /**
   * Set Enhanced Prompts generation status.
   */
  setEnhancedPromptsStatus(status: EnhancedPromptsWizardStatus): void {
    this.enhancedPromptsStatusSignal.set(status);
  }

  /**
   * Set Enhanced Prompts error message.
   */
  setEnhancedPromptsError(error: string | null): void {
    this.enhancedPromptsErrorSignal.set(error);
  }

  /**
   * Set Enhanced Prompts detected stack for display.
   */
  setEnhancedPromptsDetectedStack(stack: string[] | null): void {
    this.enhancedPromptsDetectedStackSignal.set(stack);
  }

  /**
   * Set skill generation progress items.
   * Called when generation begins with initial item list.
   *
   * @param items - Array of generation progress items
   */
  setSkillGenerationProgress(items: SkillGenerationProgressItem[]): void {
    this.skillGenerationProgressSignal.set(items);
  }

  /**
   * Update a single skill generation progress item.
   *
   * @param itemId - Item identifier to update
   * @param update - Partial update to apply
   */
  updateSkillGenerationItem(
    itemId: string,
    update: Partial<SkillGenerationProgressItem>
  ): void {
    this.skillGenerationProgressSignal.update((items) =>
      items.map((item) => (item.id === itemId ? { ...item, ...update } : item))
    );
  }

  /**
   * Reset a failed generation item for retry.
   *
   * @param itemId - Item identifier to reset
   */
  retryGenerationItem(itemId: string): void {
    this.updateSkillGenerationItem(itemId, {
      status: 'pending',
      progress: 0,
      errorMessage: undefined,
    });
  }

  // ============================================================================
  // Message Handling with Discriminated Union (TASK_2025_113 - T3.2)
  // ============================================================================

  /**
   * Type guard for WizardMessage discriminated union.
   * Validates message structure matches expected format for type-safe handling.
   *
   * @param message - Unknown message from MessageEvent
   * @returns true if message is a valid WizardMessage
   */
  private isWizardMessage(message: unknown): message is WizardMessage {
    if (
      typeof message !== 'object' ||
      message === null ||
      !('type' in message) ||
      !('payload' in message)
    ) {
      return false;
    }

    const validTypes: WizardMessageType[] = [
      'setup-wizard:scan-progress',
      'setup-wizard:analysis-stream',
      'setup-wizard:analysis-complete',
      'setup-wizard:available-agents',
      'setup-wizard:generation-progress',
      'setup-wizard:generation-complete',
      'setup-wizard:generation-stream',
      'setup-wizard:enhance-stream',
      'setup-wizard:error',
    ];

    return validTypes.includes(
      (message as { type: string }).type as WizardMessageType
    );
  }

  /**
   * Setup message listener for backend progress updates.
   * Uses discriminated union for type-safe message handling.
   * Handles all setup-wizard:* messages from the extension backend.
   * Stores handler reference for cleanup in dispose().
   */
  private setupMessageListener(): void {
    this.messageHandler = (event: MessageEvent) => {
      const message = event.data;

      // Validate message is a wizard message using discriminated union type guard
      if (!this.isWizardMessage(message)) {
        return; // Ignore non-wizard messages
      }

      try {
        // Type-safe switch with exhaustive checking via discriminated union
        switch (message.type) {
          case 'setup-wizard:scan-progress':
            this.handleScanProgress(message.payload);
            break;

          case 'setup-wizard:analysis-complete':
            this.handleAnalysisComplete(message.payload);
            break;

          case 'setup-wizard:available-agents':
            this.handleAvailableAgents(message.payload);
            break;

          case 'setup-wizard:generation-progress':
            this.handleGenerationProgress(message.payload);
            break;

          case 'setup-wizard:generation-complete':
            this.handleGenerationComplete(message.payload);
            break;

          case 'setup-wizard:analysis-stream':
            this.handleAnalysisStream(message.payload);
            break;

          case 'setup-wizard:generation-stream':
            this.generationStreamSignal.update((msgs) => [
              ...msgs,
              message.payload,
            ]);
            break;

          case 'setup-wizard:enhance-stream':
            this.enhanceStreamSignal.update((msgs) => [
              ...msgs,
              message.payload,
            ]);
            break;

          case 'setup-wizard:error':
            this.handleError(message.payload);
            break;

          default: {
            const _exhaustiveCheck: never = message;
            console.warn('Unhandled wizard message type:', _exhaustiveCheck);
          }
        }
      } catch (error) {
        console.error('Error handling setup wizard message:', error);
        this.errorStateSignal.set({
          message: 'Failed to process backend message',
          details: error instanceof Error ? error.message : String(error),
        });
      }
    };

    window.addEventListener('message', this.messageHandler);
  }

  /**
   * Handle scan progress updates.
   * Payload is now typed via discriminated union.
   * Propagates agentic analysis fields (currentPhase, phaseLabel, etc.) when present.
   *
   * @param payload - Typed ScanProgressPayload from shared types
   */
  private handleScanProgress(payload: ScanProgressPayload): void {
    this.scanProgressSignal.set({
      filesScanned: payload.filesScanned,
      totalFiles: payload.totalFiles,
      detections: payload.detections,
      currentPhase: payload.currentPhase,
      phaseLabel: payload.phaseLabel,
      agentReasoning: payload.agentReasoning,
      completedPhases: payload.completedPhases,
    });
    this.generationProgressSignal.set({
      phase: 'analysis',
      percentComplete:
        payload.totalFiles > 0
          ? Math.round((payload.filesScanned / payload.totalFiles) * 100)
          : 0,
      filesScanned: payload.filesScanned,
      totalFiles: payload.totalFiles,
      detections: payload.detections,
    });
  }

  /**
   * Handle analysis stream messages for live transcript display.
   * Appends each message to the accumulated stream.
   *
   * @param payload - Typed AnalysisStreamPayload from shared types
   */
  private handleAnalysisStream(payload: AnalysisStreamPayload): void {
    this.analysisStreamSignal.update((messages) => [...messages, payload]);
  }

  /**
   * Handle analysis complete.
   * Payload is now typed via discriminated union.
   *
   * @param payload - Typed AnalysisCompletePayload from shared types
   */
  private handleAnalysisComplete(payload: AnalysisCompletePayload): void {
    // Map AnalysisCompletePayload to local AnalysisResults format
    const analysisResults: AnalysisResults = {
      projectContext: {
        type: payload.projectContext.type,
        techStack: payload.projectContext.techStack,
        architecture: payload.projectContext.architecture,
        isMonorepo: payload.projectContext.isMonorepo,
        monorepoType: payload.projectContext.monorepoType,
        packageCount: payload.projectContext.packageCount,
      },
    };

    this.analysisResultsSignal.set(analysisResults);
    this.projectContextSignal.set(analysisResults.projectContext);
    this.currentStepSignal.set('analysis');
  }

  /**
   * Handle available agents.
   * Payload is now typed via discriminated union.
   *
   * @param payload - Typed AvailableAgentsPayload from shared types
   */
  private handleAvailableAgents(payload: AvailableAgentsPayload): void {
    // Map AvailableAgentsPayload to local AgentSelection[] format
    const agents: AgentSelection[] = payload.agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      selected: agent.selected,
      score: agent.score,
      reason: agent.reason,
      autoInclude: agent.autoInclude,
    }));

    this.availableAgentsSignal.set(agents);
  }

  /**
   * Handle generation progress updates.
   * Payload is now typed via discriminated union.
   *
   * Updates both the overall generation progress signal and per-item
   * skill generation progress when currentAgent information is available.
   *
   * @param payload - Typed GenerationProgressPayload from shared types
   */
  private handleGenerationProgress(payload: GenerationProgressPayload): void {
    this.generationProgressSignal.set(payload.progress);

    // Update per-item tracking in skillGenerationProgressSignal
    const items = this.skillGenerationProgressSignal();
    if (items.length === 0) {
      // Items not yet initialized -- skip per-item updates.
      // The items are initialized by the frontend component that calls
      // submitAgentSelection() before generation begins.
      return;
    }

    const { currentAgent, phase, percentComplete } = payload.progress;

    if (phase === 'complete') {
      // Mark all remaining pending/in-progress items as complete
      this.skillGenerationProgressSignal.update((currentItems) =>
        currentItems.map((item) =>
          item.status === 'pending' || item.status === 'in-progress'
            ? { ...item, status: 'complete' as const, progress: 100 }
            : item
        )
      );
      return;
    }

    if (currentAgent) {
      this.skillGenerationProgressSignal.update((currentItems) =>
        currentItems.map((item) => {
          // Match by name or ID (backend may send either)
          const isCurrentAgent =
            item.name === currentAgent || item.id === currentAgent;

          if (isCurrentAgent) {
            // Mark this item as in-progress
            return {
              ...item,
              status: 'in-progress' as const,
              progress: Math.min(percentComplete, 99),
            };
          }

          // Mark previously in-progress items as complete
          // (if a new agent is current, the previous one must be done)
          if (item.status === 'in-progress') {
            return {
              ...item,
              status: 'complete' as const,
              progress: 100,
            };
          }

          return item;
        })
      );
    }
  }

  /**
   * Handle generation complete.
   * Payload is now typed via discriminated union.
   *
   * @param payload - Typed GenerationCompletePayload from shared types
   */
  private handleGenerationComplete(payload: GenerationCompletePayload): void {
    const completionData: CompletionData = {
      success: payload.success,
      generatedCount: payload.generatedCount,
      duration: payload.duration,
      errors: payload.errors,
      warnings: payload.warnings,
      enhancedPromptsUsed: payload.enhancedPromptsUsed,
    };

    // Always store completion data so it's available when generation step mounts
    this.completionDataSignal.set(completionData);

    // Only auto-transition to completion if we're on the generation step.
    // If we're on the enhance step (or earlier), generation runs in the background
    // and the user should complete the enhance step first. The generation-progress
    // component will pick up completionData when it mounts.
    const currentStep = this.currentStepSignal();
    if (currentStep === 'generation') {
      this.currentStepSignal.set('completion');
    }
  }

  /**
   * Handle error messages.
   * Payload is now typed via discriminated union.
   *
   * @param payload - Typed ErrorPayload from shared types
   */
  private handleError(payload: WizardErrorPayload): void {
    if (payload.type === 'fallback-warning') {
      this.fallbackWarningSignal.set(payload.message);
      return;
    }

    const errorState: ErrorState = {
      message: payload.message,
      details: payload.details,
    };

    this.errorStateSignal.set(errorState);
  }

  /**
   * Cleanup for testing or explicit teardown.
   * Removes message listener and resets registration flag.
   *
   * Note: Root services (providedIn: 'root') are never destroyed in normal operation.
   * This method is provided for:
   * - Unit tests that need to clean up between test runs
   * - Explicit teardown scenarios
   * - Debugging memory leaks
   *
   * In production, this method is typically not called since root services
   * persist for the lifetime of the application.
   */
  dispose(): void {
    if (this.messageHandler) {
      window.removeEventListener('message', this.messageHandler);
      this.messageHandler = null;
      this.isMessageListenerRegistered = false;
    }
  }
}
