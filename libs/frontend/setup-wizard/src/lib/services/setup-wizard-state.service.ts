import { Injectable, signal, computed } from '@angular/core';

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
  }
}
