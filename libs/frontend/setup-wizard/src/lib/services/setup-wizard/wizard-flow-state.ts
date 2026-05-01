import type {
  AnswerValue,
  MasterPlan,
  NewProjectType,
  QuestionGroup,
} from '@ptah-extension/shared';
import type { WizardPath, WizardStep } from '../setup-wizard-state.types';
import type { WizardInternalState } from './wizard-internal-state';

/**
 * WizardFlowState — owns the wizard step/path state machine: the current
 * step, the wizard-path discriminator (existing vs new), and the entire
 * new-project discovery flow (project type, question groups, accumulated
 * answers, master plan, and force-regenerate flag).
 *
 * Plain TypeScript class (no `@Injectable`, no `inject()`). Receives the
 * shared {@link WizardInternalState} handle via constructor; mutates the
 * coordinator-owned writable signals through the handle so signal
 * identity is preserved for `asReadonly()` consumers.
 *
 * The cross-cutting `reset()` orchestrator lives on the coordinator and
 * calls `WizardFlowState.reset()` (this helper's slice) plus the slices
 * owned by the other 4 helpers. This helper's `reset()` only touches
 * step + new-project signals (lines 1108 + 1144–1152 of the original
 * coordinator).
 */
export class WizardFlowState {
  public constructor(private readonly state: WizardInternalState) {}

  /**
   * Set current wizard step.
   */
  public setCurrentStep(step: WizardStep): void {
    this.state.currentStep.set(step);
  }

  /**
   * Set the wizard path (existing vs new project).
   * Called when the user chooses a path on the welcome screen.
   */
  public setWizardPath(path: WizardPath): void {
    this.state.wizardPath.set(path);
  }

  /**
   * Set the selected new project type.
   * Called when the user picks a project type (e.g., full-saas, angular-app).
   */
  public setNewProjectType(type: NewProjectType): void {
    this.state.newProjectType.set(type);
  }

  /**
   * Set discovery question groups from the backend.
   * Resets the current group index to 0 and clears any stale discovery answers
   * (e.g., from a previously selected project type).
   */
  public setQuestionGroups(groups: QuestionGroup[]): void {
    this.state.questionGroups.set(groups);
    this.state.currentGroupIndex.set(0);
    this.state.discoveryAnswers.set({});
  }

  /**
   * Set a single discovery answer by question ID.
   * Immutably updates the answers map.
   */
  public setDiscoveryAnswer(questionId: string, value: AnswerValue): void {
    this.state.discoveryAnswers.update((answers) => ({
      ...answers,
      [questionId]: value,
    }));
  }

  /**
   * Advance to the next question group.
   * No-op if already on the last group.
   */
  public nextQuestionGroup(): void {
    const groups = this.state.questionGroups();
    const current = this.state.currentGroupIndex();
    if (current < groups.length - 1) {
      this.state.currentGroupIndex.set(current + 1);
    }
  }

  /**
   * Go back to the previous question group.
   * No-op if already on the first group.
   */
  public previousQuestionGroup(): void {
    const current = this.state.currentGroupIndex();
    if (current > 0) {
      this.state.currentGroupIndex.set(current - 1);
    }
  }

  /**
   * Set the generated master plan.
   * Called when plan generation completes successfully, or null to clear it.
   */
  public setMasterPlan(plan: MasterPlan | null): void {
    this.state.masterPlan.set(plan);
  }

  /**
   * Set the plan generation loading state.
   */
  public setPlanGenerating(generating: boolean): void {
    this.state.planGenerating.set(generating);
  }

  /**
   * Force-regenerate flag for plan generation.
   */
  public setForceRegenerate(force: boolean): void {
    this.state.forceRegenerate.set(force);
  }

  /**
   * Reset wizard step + new-project signals owned by this helper.
   * Mirrors the source-order resets of:
   * - `currentStep` to 'welcome' (line 1108)
   * - `wizardPath` to null (line 1145)
   * - `newProjectType` to null (line 1146)
   * - `questionGroups` to [] (line 1147)
   * - `currentGroupIndex` to 0 (line 1148)
   * - `discoveryAnswers` to {} (line 1149)
   * - `masterPlan` to null (line 1150)
   * - `planGenerating` to false (line 1151)
   * - `forceRegenerate` to false (line 1152)
   */
  public reset(): void {
    this.state.currentStep.set('welcome');
    this.state.wizardPath.set(null);
    this.state.newProjectType.set(null);
    this.state.questionGroups.set([]);
    this.state.currentGroupIndex.set(0);
    this.state.discoveryAnswers.set({});
    this.state.masterPlan.set(null);
    this.state.planGenerating.set(false);
    this.state.forceRegenerate.set(false);
  }
}
