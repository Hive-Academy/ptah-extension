import { Injectable, signal, computed, inject, OnDestroy } from '@angular/core';
import { VSCodeService } from '@ptah-extension/core';

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
 * Scan progress tracking
 */
export interface ScanProgress {
  filesScanned: number;
  totalFiles: number;
  detections: string[];
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
}

/**
 * Error state
 */
export interface ErrorState {
  message: string;
  details?: string;
}

// =============================================================================
// Deep Analysis Types for MCP-Powered Setup Wizard (TASK_2025_111)
// =============================================================================

/**
 * Architecture pattern detected in the project.
 * Mirrors backend ArchitecturePattern interface.
 */
export interface ArchitecturePatternResult {
  /** Pattern name (e.g., 'DDD', 'Layered', 'Microservices') */
  name: string;
  /** Confidence score 0-100 */
  confidence: number;
  /** File paths or folder names that indicate this pattern */
  evidence: string[];
  /** Optional description of the detected pattern */
  description?: string;
}

/**
 * Key file locations organized by purpose.
 * Used for agent context and file discovery instructions.
 */
export interface KeyFileLocationsResult {
  /** Application entry points (main.ts, index.ts) */
  entryPoints: string[];
  /** Configuration files */
  configs: string[];
  /** Test directories */
  testDirectories: string[];
  /** API route definitions */
  apiRoutes?: string[];
  /** UI component directories */
  components?: string[];
  /** Service layer directories */
  services?: string[];
}

/**
 * Diagnostic summary from VS Code diagnostics.
 */
export interface DiagnosticSummaryResult {
  /** Total error count */
  errorCount: number;
  /** Total warning count */
  warningCount: number;
  /** Total info count */
  infoCount?: number;
}

/**
 * Test coverage estimate information.
 */
export interface TestCoverageEstimateResult {
  /** Estimated coverage percentage 0-100 */
  percentage: number;
  /** Whether any tests were detected */
  hasTests: boolean;
  /** Detected test framework (jest, mocha, vitest, etc.) */
  testFramework?: string;
  /** Whether unit tests exist */
  hasUnitTests?: boolean;
  /** Whether integration tests exist */
  hasIntegrationTests?: boolean;
  /** Whether e2e tests exist */
  hasE2eTests?: boolean;
}

/**
 * Deep project analysis result from MCP-powered analysis.
 * Contains comprehensive project insights for intelligent agent recommendations.
 *
 * This interface aligns with backend DeepProjectAnalysis but is simplified
 * for frontend display purposes.
 */
export interface ProjectAnalysisResult {
  // Basic project info (existing)
  /** Detected project type (Angular, React, Node.js, etc.) */
  projectType: string;
  /** Total file count in the workspace */
  fileCount: number;
  /** Programming languages detected */
  languages: string[];
  /** Frameworks detected */
  frameworks: string[];
  /** Monorepo type if applicable */
  monorepoType?: string;

  // Deep analysis results (new)
  /** Detected architecture patterns with confidence scores */
  architecturePatterns: ArchitecturePatternResult[];
  /** Key file locations grouped by purpose */
  keyFileLocations: KeyFileLocationsResult;
  /** Language distribution statistics */
  languageDistribution?: Array<{
    language: string;
    percentage: number;
    fileCount: number;
  }>;
  /** Existing code issues summary */
  existingIssues: DiagnosticSummaryResult;
  /** Estimated test coverage */
  testCoverage: TestCoverageEstimateResult;
  /** Detected code conventions */
  codeConventions?: {
    indentation: 'tabs' | 'spaces';
    indentSize: number;
    quoteStyle: 'single' | 'double';
    semicolons: boolean;
  };
}

/**
 * Agent category for grouping in UI.
 */
export type AgentCategory =
  | 'planning'
  | 'development'
  | 'qa'
  | 'specialist'
  | 'creative';

/**
 * Agent recommendation from deep analysis.
 * Provides a scored recommendation for each agent based on project characteristics.
 *
 * Mirrors backend AgentRecommendation interface.
 */
export interface AgentRecommendation {
  /** Unique agent identifier (kebab-case) */
  agentId: string;
  /** Human-readable agent name */
  agentName: string;
  /** Agent description for display */
  description: string;
  /** Relevance score 0-100 based on project analysis */
  relevanceScore: number;
  /** Criteria that contributed to the score */
  matchedCriteria: string[];
  /** Agent category for grouping */
  category: AgentCategory;
  /** Whether this agent is recommended (score >= 75) */
  recommended: boolean;
  /** Optional icon identifier */
  icon?: string;
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
  /** Item type: agent, command, or skill file */
  type: 'agent' | 'command' | 'skill-file';
  /** Current status */
  status: 'pending' | 'in-progress' | 'complete' | 'error';
  /** Progress percentage 0-100 (optional) */
  progress?: number;
  /** Error message if status is 'error' */
  errorMessage?: string;
}

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
export class SetupWizardStateService implements OnDestroy {
  private readonly vscodeService = inject(VSCodeService);

  /**
   * Message listener cleanup function.
   * Called in ngOnDestroy to prevent memory leaks.
   */
  private messageListenerCleanup: (() => void) | null = null;

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

  constructor() {
    this.setupMessageListener();
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
      generation: progress?.percentComplete ?? 65,
      completion: 100,
    };

    return stepProgress[step];
  });

  /**
   * Current step index (0-based) for progress indicator
   */
  readonly stepIndex = computed(() => {
    const step = this.currentStepSignal();
    const stepOrder: WizardStep[] = [
      'premium-check',
      'welcome',
      'scan',
      'analysis',
      'selection',
      'generation',
      'completion',
    ];
    return stepOrder.indexOf(step);
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
    this.analysisResultsSignal.set(null);
    this.completionDataSignal.set(null);
    this.errorStateSignal.set(null);
    // Reset deep analysis state (TASK_2025_111)
    this.deepAnalysisSignal.set(null);
    this.recommendationsSignal.set([]);
    this.skillGenerationProgressSignal.set([]);
    this.selectedAgentsMapSignal.set({});
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

  /**
   * Setup message listener for backend progress updates
   * Handles all setup-wizard:* messages from the extension backend
   */
  private setupMessageListener(): void {
    const messageHandler = (event: MessageEvent) => {
      const message = event.data;

      // Type guard for message type
      if (!message || typeof message.type !== 'string') {
        return;
      }

      try {
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

          case 'setup-wizard:error':
            this.handleError(message.payload);
            break;

          default:
            // Ignore unknown message types
            break;
        }
      } catch (error) {
        console.error('Error handling setup wizard message:', error);
        this.errorStateSignal.set({
          message: 'Failed to process backend message',
          details: error instanceof Error ? error.message : String(error),
        });
      }
    };

    window.addEventListener('message', messageHandler);

    // Store cleanup function for ngOnDestroy
    this.messageListenerCleanup = () => {
      window.removeEventListener('message', messageHandler);
    };
  }

  /**
   * Handle scan progress updates
   */
  private handleScanProgress(payload: unknown): void {
    if (!this.isValidScanProgress(payload)) {
      console.warn('Invalid scan progress payload:', payload);
      return;
    }

    this.scanProgressSignal.set(payload);
    this.generationProgressSignal.set({
      phase: 'analysis',
      percentComplete: Math.round(
        (payload.filesScanned / payload.totalFiles) * 100
      ),
      filesScanned: payload.filesScanned,
      totalFiles: payload.totalFiles,
      detections: payload.detections,
    });
  }

  /**
   * Handle analysis complete
   */
  private handleAnalysisComplete(payload: unknown): void {
    if (!this.isValidAnalysisResults(payload)) {
      console.warn('Invalid analysis results payload:', payload);
      return;
    }

    this.analysisResultsSignal.set(payload);
    this.projectContextSignal.set(payload.projectContext);
    this.currentStepSignal.set('analysis');
  }

  /**
   * Handle available agents
   */
  private handleAvailableAgents(payload: unknown): void {
    if (!this.isValidAvailableAgents(payload)) {
      console.warn('Invalid available agents payload:', payload);
      return;
    }

    this.availableAgentsSignal.set(payload.agents);
  }

  /**
   * Handle generation progress updates
   */
  private handleGenerationProgress(payload: unknown): void {
    if (!this.isValidGenerationProgress(payload)) {
      console.warn('Invalid generation progress payload:', payload);
      return;
    }

    this.generationProgressSignal.set(payload.progress);
  }

  /**
   * Handle generation complete
   */
  private handleGenerationComplete(payload: unknown): void {
    if (!this.isValidCompletionData(payload)) {
      console.warn('Invalid completion data payload:', payload);
      return;
    }

    this.completionDataSignal.set(payload);
    this.currentStepSignal.set('completion');
  }

  /**
   * Handle error messages
   */
  private handleError(payload: unknown): void {
    if (!this.isValidErrorState(payload)) {
      console.warn('Invalid error payload:', payload);
      return;
    }

    this.errorStateSignal.set(payload);
  }

  /**
   * Type guard for ScanProgress
   */
  private isValidScanProgress(payload: unknown): payload is ScanProgress {
    return (
      typeof payload === 'object' &&
      payload !== null &&
      'filesScanned' in payload &&
      'totalFiles' in payload &&
      'detections' in payload &&
      typeof (payload as ScanProgress).filesScanned === 'number' &&
      typeof (payload as ScanProgress).totalFiles === 'number' &&
      Array.isArray((payload as ScanProgress).detections)
    );
  }

  /**
   * Type guard for AnalysisResults
   */
  private isValidAnalysisResults(payload: unknown): payload is AnalysisResults {
    return (
      typeof payload === 'object' &&
      payload !== null &&
      'projectContext' in payload &&
      typeof (payload as AnalysisResults).projectContext === 'object'
    );
  }

  /**
   * Type guard for AvailableAgents payload
   */
  private isValidAvailableAgents(
    payload: unknown
  ): payload is { agents: AgentSelection[] } {
    return (
      typeof payload === 'object' &&
      payload !== null &&
      'agents' in payload &&
      Array.isArray((payload as { agents: AgentSelection[] }).agents)
    );
  }

  /**
   * Type guard for GenerationProgress payload
   */
  private isValidGenerationProgress(
    payload: unknown
  ): payload is { progress: GenerationProgress } {
    return (
      typeof payload === 'object' &&
      payload !== null &&
      'progress' in payload &&
      typeof (payload as { progress: GenerationProgress }).progress === 'object'
    );
  }

  /**
   * Type guard for CompletionData
   */
  private isValidCompletionData(payload: unknown): payload is CompletionData {
    return (
      typeof payload === 'object' &&
      payload !== null &&
      'success' in payload &&
      'generatedCount' in payload &&
      typeof (payload as CompletionData).success === 'boolean' &&
      typeof (payload as CompletionData).generatedCount === 'number'
    );
  }

  /**
   * Type guard for ErrorState
   */
  private isValidErrorState(payload: unknown): payload is ErrorState {
    return (
      typeof payload === 'object' &&
      payload !== null &&
      'message' in payload &&
      typeof (payload as ErrorState).message === 'string'
    );
  }

  /**
   * Angular lifecycle hook - cleanup on service destruction.
   * Removes message listener to prevent memory leaks.
   */
  ngOnDestroy(): void {
    if (this.messageListenerCleanup) {
      this.messageListenerCleanup();
      this.messageListenerCleanup = null;
    }
  }
}
