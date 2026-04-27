import { computed, type Signal } from '@angular/core';
import type {
  AgentRecommendation,
  QuestionGroup,
} from '@ptah-extension/shared';
import type {
  SkillGenerationProgressItem,
  WizardStep,
} from '../setup-wizard-state.types';
import type { WizardInternalState } from './wizard-internal-state';

/**
 * WizardComputeds — owns the 16 derived (`computed(...)`) signals exposed by
 * the setup wizard coordinator.
 *
 * Plain TypeScript class (no `@Injectable`, no `inject()`). Receives the
 * shared {@link WizardInternalState} handle via constructor; reads the
 * coordinator-owned writable signals through the handle. Each computed is
 * constructed once in the constructor body and exposed as a public readonly
 * field, preserving signal IDENTITY when delegated 1:1 from the coordinator
 * (Angular's reactive root tracking sees the same `Signal` instance).
 *
 * The set of computeds mirrors the original coordinator declarations
 * verbatim — only the source-of-state changes from `this.fooSignal()` to
 * `state.foo()`.
 */
export class WizardComputeds {
  /** Count of installed community agents. */
  public readonly installedCommunityAgentCount: Signal<number>;

  /** Whether a multi-phase analysis is active (totalPhaseCount > 0). */
  public readonly isMultiPhaseAnalysis: Signal<boolean>;

  /** Whether a completed multi-phase result is available. */
  public readonly hasMultiPhaseResult: Signal<boolean>;

  /** Currently displayed question group (null when none / out of bounds). */
  public readonly currentQuestionGroup: Signal<QuestionGroup | null>;

  /** Whether all required questions in the current group are answered. */
  public readonly currentGroupComplete: Signal<boolean>;

  /** Whether the current group is the last in the sequence. */
  public readonly isLastGroup: Signal<boolean>;

  /** Active wizard step configuration based on chosen path. */
  public readonly activeStepConfig: Signal<{
    steps: WizardStep[];
    labels: string[];
  }>;

  /** Selected agents count (for display). */
  public readonly selectedCount: Signal<number>;

  /** Whether the wizard can proceed to the next step. */
  public readonly canProceed: Signal<boolean>;

  /** Overall wizard completion percentage (0-100). */
  public readonly percentComplete: Signal<number>;

  /**
   * Current step index (0-based) for the UI progress indicator.
   * Excludes 'premium-check' since it's not displayed in the stepper.
   */
  public readonly stepIndex: Signal<number>;

  /** Recommended agents (relevanceScore >= 75). */
  public readonly recommendedAgents: Signal<AgentRecommendation[]>;

  /** Total generation items (selected agents only). */
  public readonly totalGenerationItems: Signal<number>;

  /** Generation completion percentage (based on skill progress items). */
  public readonly generationCompletionPercentage: Signal<number>;

  /** Whether all generation items are complete (or errored). */
  public readonly isGenerationComplete: Signal<boolean>;

  /** Generation items currently in error state. */
  public readonly failedGenerationItems: Signal<SkillGenerationProgressItem[]>;

  public constructor(state: WizardInternalState) {
    this.installedCommunityAgentCount = computed(() => {
      const statuses = state.agentInstallStatus();
      return Object.values(statuses).filter((s) => s === 'installed').length;
    });

    this.isMultiPhaseAnalysis = computed(
      () =>
        state.totalPhaseCount() !== null && (state.totalPhaseCount() ?? 0) > 0,
    );

    this.hasMultiPhaseResult = computed(
      () => state.multiPhaseResult() !== null,
    );

    this.currentQuestionGroup = computed(() => {
      const groups = state.questionGroups();
      const index = state.currentGroupIndex();
      return groups[index] ?? null;
    });

    this.currentGroupComplete = computed(() => {
      const group = this.currentQuestionGroup();
      if (!group) return false;
      const answers = state.discoveryAnswers();
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

    this.isLastGroup = computed(() => {
      const groups = state.questionGroups();
      return state.currentGroupIndex() >= groups.length - 1;
    });

    this.activeStepConfig = computed<{
      steps: WizardStep[];
      labels: string[];
    }>(() => {
      const path = state.wizardPath();
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

    this.selectedCount = computed(
      () => state.availableAgents().filter((a) => a.selected).length,
    );

    this.canProceed = computed(() => {
      const step = state.currentStep();
      switch (step) {
        case 'premium-check':
          return false;
        case 'welcome':
          return true;
        case 'scan':
          return false;
        case 'analysis':
          return state.projectContext() !== null;
        case 'selection':
          return this.selectedCount() > 0;
        case 'enhance':
          return false;
        case 'generation':
          return false;
        case 'completion':
          return true;
        case 'project-type':
          return state.newProjectType() !== null;
        case 'discovery':
          return this.currentGroupComplete();
        case 'plan-generation':
          return false;
        case 'plan-review':
          return state.masterPlan() !== null;
        default:
          return false;
      }
    });

    this.percentComplete = computed(() => {
      const step = state.currentStep();
      const progress = state.generationProgress();
      const stepProgress: Record<WizardStep, number> = {
        'premium-check': 0,
        welcome: 5,
        scan: 20,
        analysis: 35,
        selection: 50,
        generation: progress?.percentComplete ?? 55,
        enhance: 85,
        completion: 100,
        'project-type': 15,
        discovery: 30,
        'plan-generation': 45,
        'plan-review': 55,
      };
      return stepProgress[step];
    });

    this.stepIndex = computed(() => {
      const step = state.currentStep();
      const config = this.activeStepConfig();
      return config.steps.indexOf(step);
    });

    this.recommendedAgents = computed(() =>
      state
        .recommendations()
        .filter((recommendation) => recommendation.relevanceScore >= 75),
    );

    this.totalGenerationItems = computed(() => {
      const selectedAgents = state.selectedAgentsMap();
      return Object.values(selectedAgents).filter(Boolean).length;
    });

    this.generationCompletionPercentage = computed(() => {
      const items = state.skillGenerationProgress();
      if (items.length === 0) return 0;
      const completedCount = items.filter(
        (item) => item.status === 'complete',
      ).length;
      return Math.round((completedCount / items.length) * 100);
    });

    this.isGenerationComplete = computed(() => {
      const items = state.skillGenerationProgress();
      if (items.length === 0) return false;
      return items.every(
        (item) => item.status === 'complete' || item.status === 'error',
      );
    });

    this.failedGenerationItems = computed(() =>
      state.skillGenerationProgress().filter((item) => item.status === 'error'),
    );
  }
}
