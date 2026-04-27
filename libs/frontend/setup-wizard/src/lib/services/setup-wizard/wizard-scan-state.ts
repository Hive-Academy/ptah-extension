import type { EnhancedPromptsSummary } from '@ptah-extension/shared';
import type {
  AgentSelection,
  EnhancedPromptsWizardStatus,
  ProjectContext,
} from '../setup-wizard-state.types';
import type { WizardInternalState } from './wizard-internal-state';

/**
 * WizardScanState — owns the existing-project scan + analysis entry-side
 * state: `projectContext`, `availableAgents` (legacy non-recommended
 * list), per-agent selection toggle, fallback-warning, and Enhanced
 * Prompts state.
 *
 * Plain TypeScript class (no `@Injectable`, no `inject()`). Receives the
 * shared {@link WizardInternalState} handle via constructor; mutates the
 * coordinator-owned writable signals through the handle so signal
 * identity is preserved for `asReadonly()` consumers.
 *
 * Note: `projectContext` is also written by `WizardAnalysisState`'s
 * `loadSavedAnalysis` via the shared internal-state handle. Both helpers
 * write the same writable-signal instance — signal identity is preserved.
 */
export class WizardScanState {
  public constructor(private readonly state: WizardInternalState) {}

  /**
   * Update project context from scan results.
   */
  public setProjectContext(context: ProjectContext): void {
    this.state.projectContext.set(context);
  }

  /**
   * Set available agents (from backend).
   */
  public setAvailableAgents(agents: AgentSelection[]): void {
    this.state.availableAgents.set(agents);
  }

  /**
   * Toggle agent selection.
   */
  public toggleAgentSelection(agentId: string): void {
    this.state.availableAgents.update((agents) =>
      agents.map((agent) =>
        agent.id === agentId ? { ...agent, selected: !agent.selected } : agent,
      ),
    );
  }

  /**
   * Set or clear the fallback warning message.
   * Called when agentic analysis falls back to quick analysis mode.
   */
  public setFallbackWarning(warning: string | null): void {
    this.state.fallbackWarning.set(warning);
  }

  /**
   * Set Enhanced Prompts generation status.
   */
  public setEnhancedPromptsStatus(status: EnhancedPromptsWizardStatus): void {
    this.state.enhancedPromptsStatus.set(status);
  }

  /**
   * Set Enhanced Prompts error message.
   */
  public setEnhancedPromptsError(error: string | null): void {
    this.state.enhancedPromptsError.set(error);
  }

  /**
   * Set Enhanced Prompts detected stack for display.
   */
  public setEnhancedPromptsDetectedStack(stack: string[] | null): void {
    this.state.enhancedPromptsDetectedStack.set(stack);
  }

  /**
   * Set Enhanced Prompts generation summary.
   * Contains section metadata without actual prompt content (IP protection).
   */
  public setEnhancedPromptsSummary(
    summary: EnhancedPromptsSummary | null,
  ): void {
    this.state.enhancedPromptsSummary.set(summary);
  }

  /**
   * Reset scan + enhanced-prompts signals owned by this helper.
   * Mirrors the source-order resets of:
   * - `projectContext` (line 1109)
   * - `availableAgents` (line 1110)
   * - `analysisResults` (line 1117)
   * - `completionData` (line 1118)
   * - `errorState` (line 1119)
   * - `fallbackWarning` (line 1120)
   * - Enhanced Prompts: status/error/detectedStack/summary (lines 1128–1131)
   */
  public reset(): void {
    this.state.projectContext.set(null);
    this.state.availableAgents.set([]);
    this.state.analysisResults.set(null);
    this.state.completionData.set(null);
    this.state.errorState.set(null);
    this.state.fallbackWarning.set(null);
    this.state.enhancedPromptsStatus.set('idle');
    this.state.enhancedPromptsError.set(null);
    this.state.enhancedPromptsDetectedStack.set(null);
    this.state.enhancedPromptsSummary.set(null);
  }
}
