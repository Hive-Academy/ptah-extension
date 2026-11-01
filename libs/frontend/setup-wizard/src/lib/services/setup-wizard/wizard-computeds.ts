import { computed, type Signal } from '@angular/core';
import type { AgentRecommendation } from '@ptah-extension/shared';
import type { SkillGenerationProgressItem } from '../setup-wizard-state.types';
import type { WizardInternalState } from './wizard-internal-state';

/**
 * WizardComputeds — owns the derived (`computed(...)`) signals exposed by
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

  /** Selected agents count (for display). */
  public readonly selectedCount: Signal<number>;

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

    this.selectedCount = computed(
      () => state.availableAgents().filter((a) => a.selected).length,
    );

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
