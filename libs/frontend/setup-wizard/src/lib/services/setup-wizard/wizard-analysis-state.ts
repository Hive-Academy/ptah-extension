import type {
  AgentRecommendation,
  MultiPhaseAnalysisResponse,
  ProjectAnalysisResult,
  SavedAnalysisMetadata,
} from '@ptah-extension/shared';
import type { WizardInternalState } from './wizard-internal-state';

/**
 * WizardAnalysisState — owns deep-analysis results, agent recommendations
 * (with auto-selection on score ≥ 80), selection map, multi-phase
 * analysis result, and saved-analysis history loading.
 *
 * Plain TypeScript class (no `@Injectable`, no `inject()`). Receives the
 * shared {@link WizardInternalState} handle via constructor; mutates the
 * coordinator-owned writable signals through the handle so signal
 * identity is preserved for `asReadonly()` consumers.
 *
 * Cross-helper write: `loadSavedAnalysis` also writes `projectContext`
 * (owned by `WizardScanState`) through the shared internal-state handle.
 * Both helpers write the same writable-signal instance — signal identity
 * is preserved.
 */
export class WizardAnalysisState {
  public constructor(private readonly state: WizardInternalState) {}

  /**
   * Set deep project analysis results.
   * Called after MCP-powered analysis completes.
   *
   * @param analysis - Comprehensive project analysis from backend
   */
  public setDeepAnalysis(analysis: ProjectAnalysisResult): void {
    this.state.deepAnalysis.set(analysis);
  }

  /**
   * Set agent recommendations from deep analysis.
   * Auto-selects agents with relevance score >= 80.
   *
   * @param recommendations - Array of agent recommendations with scores
   */
  public setRecommendations(recommendations: AgentRecommendation[]): void {
    this.state.recommendations.set(recommendations);

    // Auto-select agents with score >= 80 (highly recommended)
    const autoSelected: Record<string, boolean> = {};
    for (const rec of recommendations) {
      autoSelected[rec.agentId] = rec.relevanceScore >= 80;
    }
    this.state.selectedAgentsMap.set(autoSelected);
  }

  /**
   * Toggle agent selection in the recommendations map.
   *
   * @param agentId - Agent identifier to toggle
   */
  public toggleAgentRecommendationSelection(agentId: string): void {
    this.state.selectedAgentsMap.update((selected) => ({
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
    this.state.selectedAgentsMap.set(selections);
  }

  /**
   * Select all recommended agents (score >= 75).
   */
  public selectAllRecommended(): void {
    this.state.selectedAgentsMap.update((selected) => {
      const updated = { ...selected };
      for (const rec of this.state.recommendations()) {
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
    this.state.selectedAgentsMap.update((selected) => {
      const updated = { ...selected };
      for (const key of Object.keys(updated)) {
        updated[key] = false;
      }
      return updated;
    });
  }

  /**
   * Set multi-phase analysis result.
   * Called when wizard:deep-analyze returns a MultiPhaseAnalysisResponse.
   */
  public setMultiPhaseResult(result: MultiPhaseAnalysisResponse): void {
    this.state.multiPhaseResult.set(result);
  }

  /**
   * Set saved analyses list from backend.
   * Called when the welcome component fetches the list.
   */
  public setSavedAnalyses(analyses: SavedAnalysisMetadata[]): void {
    this.state.savedAnalyses.set(analyses);
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
    this.state.multiPhaseResult.set(multiPhase);
    this.state.analysisLoadedFromHistory.set(true);

    // Set projectContext from slug for backward compatibility.
    // Cross-helper write: projectContext is owned by WizardScanState but
    // shared via the WizardInternalState handle (signal identity preserved).
    const projectType = multiPhase.manifest.slug
      .replace(/-/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
    this.state.projectContext.set({
      type: projectType,
      techStack: [],
      isMonorepo: false,
    });
  }

  /**
   * Reset deep-analysis + recommendations + selection + multi-phase +
   * history-flag signals owned by this helper.
   *
   * IMPORTANT: does NOT reset `savedAnalyses` — the saved-analyses list is
   * intentionally kept intact across wizard restarts (line 1137 of
   * original coordinator: "Reset analysis history state (keep
   * savedAnalyses list intact)").
   *
   * Mirrors lines 1123–1124 + 1125 + 1126 + 1133–1136 + 1138 of the
   * original coordinator's `reset()` body.
   */
  public reset(): void {
    this.state.deepAnalysis.set(null);
    this.state.recommendations.set([]);
    this.state.selectedAgentsMap.set({});
    this.state.currentPhaseNumber.set(null);
    this.state.totalPhaseCount.set(null);
    this.state.phaseStatuses.set([]);
    this.state.multiPhaseResult.set(null);
    this.state.analysisLoadedFromHistory.set(false);
  }
}
