import { Injectable, signal, computed, inject, OnDestroy } from '@angular/core';
import { VSCodeService } from '@ptah-extension/core';

/**
 * Wizard step identifiers matching the 6-step setup flow
 */
export type WizardStep =
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
  status: 'pending' | 'in-progress' | 'complete';
  currentTask?: string;
  duration?: number;
  customizationSummary?: string;
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

    // Base progress from step progression
    const stepProgress: Record<WizardStep, number> = {
      welcome: 0,
      scan: 20,
      analysis: 30,
      selection: 40,
      generation: progress?.percentComplete ?? 50,
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
      'welcome',
      'scan',
      'analysis',
      'selection',
      'generation',
      'completion',
    ];
    return stepOrder.indexOf(step);
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
