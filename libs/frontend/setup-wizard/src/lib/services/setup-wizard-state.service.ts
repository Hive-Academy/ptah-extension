import { Injectable, signal, computed, inject } from '@angular/core';
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
export class SetupWizardStateService {
  private readonly vscodeService = inject(VSCodeService);

  // === State Signals ===

  /**
   * Current wizard step (6 steps total)
   */
  readonly currentStep = signal<WizardStep>('welcome');

  /**
   * Detected project context from workspace scan
   */
  readonly projectContext = signal<ProjectContext | null>(null);

  /**
   * Available agents with selection state
   */
  readonly availableAgents = signal<AgentSelection[]>([]);

  /**
   * Current generation progress (null when not generating)
   */
  readonly generationProgress = signal<GenerationProgress | null>(null);

  /**
   * Scan progress tracking (null when not scanning)
   */
  readonly scanProgress = signal<ScanProgress | null>(null);

  /**
   * Analysis results (null until analysis complete)
   */
  readonly analysisResults = signal<AnalysisResults | null>(null);

  /**
   * Completion data (null until wizard complete)
   */
  readonly completionData = signal<CompletionData | null>(null);

  /**
   * Error state (null when no error)
   */
  readonly errorState = signal<ErrorState | null>(null);

  constructor() {
    this.setupMessageListener();
  }

  // === Computed Signals ===

  /**
   * Selected agents count (for display)
   */
  readonly selectedCount = computed(() => {
    return this.availableAgents().filter((a) => a.selected).length;
  });

  /**
   * Can proceed to next step (validation logic)
   */
  readonly canProceed = computed(() => {
    const step = this.currentStep();
    switch (step) {
      case 'welcome':
        return true; // Always can start
      case 'scan':
        return false; // Cannot proceed during scan
      case 'analysis':
        return this.projectContext() !== null; // Need project context
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
    const step = this.currentStep();
    const progress = this.generationProgress();

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

  // === State Mutations ===

  /**
   * Set current wizard step
   */
  setCurrentStep(step: WizardStep): void {
    this.currentStep.set(step);
  }

  /**
   * Update project context from scan results
   */
  setProjectContext(context: ProjectContext): void {
    this.projectContext.set(context);
  }

  /**
   * Set available agents (from backend)
   */
  setAvailableAgents(agents: AgentSelection[]): void {
    this.availableAgents.set(agents);
  }

  /**
   * Toggle agent selection
   */
  toggleAgentSelection(agentId: string): void {
    this.availableAgents.update((agents) =>
      agents.map((agent) =>
        agent.id === agentId ? { ...agent, selected: !agent.selected } : agent
      )
    );
  }

  /**
   * Update generation progress
   */
  updateGenerationProgress(progress: GenerationProgress): void {
    this.generationProgress.set(progress);
  }

  /**
   * Reset wizard state (for restart)
   */
  reset(): void {
    this.currentStep.set('welcome');
    this.projectContext.set(null);
    this.availableAgents.set([]);
    this.generationProgress.set(null);
    this.scanProgress.set(null);
    this.analysisResults.set(null);
    this.completionData.set(null);
    this.errorState.set(null);
  }

  /**
   * Setup message listener for backend progress updates
   * Handles all setup-wizard:* messages from the extension backend
   */
  private setupMessageListener(): void {
    window.addEventListener('message', (event) => {
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
        this.errorState.set({
          message: 'Failed to process backend message',
          details: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }

  /**
   * Handle scan progress updates
   */
  private handleScanProgress(payload: unknown): void {
    if (!this.isValidScanProgress(payload)) {
      console.warn('Invalid scan progress payload:', payload);
      return;
    }

    this.scanProgress.set(payload);
    this.generationProgress.set({
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

    this.analysisResults.set(payload);
    this.projectContext.set(payload.projectContext);
    this.currentStep.set('analysis');
  }

  /**
   * Handle available agents
   */
  private handleAvailableAgents(payload: unknown): void {
    if (!this.isValidAvailableAgents(payload)) {
      console.warn('Invalid available agents payload:', payload);
      return;
    }

    this.availableAgents.set(payload.agents);
  }

  /**
   * Handle generation progress updates
   */
  private handleGenerationProgress(payload: unknown): void {
    if (!this.isValidGenerationProgress(payload)) {
      console.warn('Invalid generation progress payload:', payload);
      return;
    }

    this.generationProgress.set(payload.progress);
  }

  /**
   * Handle generation complete
   */
  private handleGenerationComplete(payload: unknown): void {
    if (!this.isValidCompletionData(payload)) {
      console.warn('Invalid completion data payload:', payload);
      return;
    }

    this.completionData.set(payload);
    this.currentStep.set('completion');
  }

  /**
   * Handle error messages
   */
  private handleError(payload: unknown): void {
    if (!this.isValidErrorState(payload)) {
      console.warn('Invalid error payload:', payload);
      return;
    }

    this.errorState.set(payload);
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
}
