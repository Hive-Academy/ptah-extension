import type {
  GenerationAgentOutcome,
  GenerationCompletePayload,
  GenerationProgressPayload,
  GenerationStreamPayload,
  WizardErrorPayload,
} from '@ptah-extension/shared';
import type {
  CompletionData,
  ErrorState,
  SkillGenerationProgressItem,
} from '../setup-wizard-state.types';
import type { WizardInternalState } from './wizard-internal-state';
import type { WizardSurfaceFacade } from '../setup-wizard-state.service';

/**
 * WizardPhaseGeneration — handlers for the content-generation lifecycle
 * plus the cross-cutting error handler.
 *
 * Owns no signals. Clears stale analysis-phase streaming states on the
 * first generation event (so the transcript component shows current
 * generation output rather than stale analysis data).
 */
/** Last path segment of an absolute file path (either separator), or null. */
function fileNameOf(filePath: string): string | null {
  const segment = filePath.split(/[\\/]/).pop();
  return segment && segment.length > 0 ? segment : null;
}

export class WizardPhaseGeneration {
  /**
   * True once the first generation-stream event has been seen for the
   * current generation pass. Used to reset stale streaming states exactly
   * once per pass.
   */
  private generationStreamInitialized = false;

  public constructor(
    private readonly state: WizardInternalState,
    private readonly surfaces: WizardSurfaceFacade,
  ) {}

  /**
   * Handle generation progress (per-item + overall). Updates the overall
   * GenerationProgress signal and per-item skillGenerationProgress when
   * currentAgent info is present.
   */
  public handleGenerationProgress(payload: GenerationProgressPayload): void {
    this.state.generationProgress.set(payload.progress);

    const items = this.state.skillGenerationProgress();
    if (items.length === 0) {
      return;
    }

    const { currentAgent, percentComplete } = payload.progress;

    // A final progress event carries no per-agent truth. Terminal item
    // states come only from the explicit outcomes on generation-complete
    // (see applyAgentOutcomes) — never from `phase === 'complete'`.
    if (currentAgent) {
      this.state.skillGenerationProgress.update((currentItems) =>
        currentItems.map((item) => {
          const isCurrentAgent =
            item.name === currentAgent || item.id === currentAgent;

          if (isCurrentAgent && item.status !== 'complete') {
            return {
              ...item,
              status: 'in-progress' as const,
              progress: Math.min(percentComplete, 99),
            };
          }
          if (item.status === 'in-progress') {
            return {
              ...item,
              status: 'complete' as const,
              progress: 100,
            };
          }

          return item;
        }),
      );
    }
  }

  /**
   * Handle generation-complete. Persists completionData, maps the explicit
   * terminal agent outcomes into the item-progress signal, and asks the
   * coordinator to advance the step if the user is currently on
   * 'generation' (auto-transition to the enhance step).
   */
  public handleGenerationComplete(payload: GenerationCompletePayload): void {
    const completionData: CompletionData = {
      success: payload.success,
      outputDirectory: payload.outputDirectory,
      writtenCount: payload.writtenCount,
      unchangedCount: payload.unchangedCount,
      failedCount: payload.failedCount,
      rejectedSections: payload.rejectedSections,
      tailoredSections: payload.tailoredSections,
      agents: payload.agents,
      duration: payload.duration,
      errors: payload.errors,
      warnings: payload.warnings,
      enhancedPromptsUsed: payload.enhancedPromptsUsed,
    };

    this.state.completionData.set(completionData);
    this.applyAgentOutcomes(payload.agents);
    this.state.setCurrentStepIfGeneration();
    this.surfaces.unregisterAllPhaseSurfaces();
  }

  /**
   * Map explicit terminal outcomes into item progress: `written` and
   * `unchanged` are complete, `failed` is error. An outcome without a
   * matching pre-seeded item (a resumed run after a restart) becomes a new
   * item, so the completion view always accounts for every selected agent.
   */
  private applyAgentOutcomes(outcomes: GenerationAgentOutcome[]): void {
    if (outcomes.length === 0) {
      return;
    }

    this.state.skillGenerationProgress.update((items) => {
      const unmatched = new Map(
        outcomes.map((outcome) => [outcome.agentId, outcome]),
      );
      const next = items.map((item) => {
        if (item.type !== 'agent') {
          return item;
        }
        const outcome = unmatched.get(item.id) ?? unmatched.get(item.name);
        if (!outcome) {
          return item;
        }
        unmatched.delete(outcome.agentId);
        return this.toTerminalItem(item, outcome);
      });

      for (const outcome of unmatched.values()) {
        next.push(
          this.toTerminalItem(
            {
              id: outcome.agentId,
              name: fileNameOf(outcome.filePath) ?? outcome.agentId,
              type: 'agent',
              status: 'pending',
            },
            outcome,
          ),
        );
      }
      return next;
    });
  }

  private toTerminalItem(
    item: SkillGenerationProgressItem,
    outcome: GenerationAgentOutcome,
  ): SkillGenerationProgressItem {
    if (outcome.status === 'failed') {
      return {
        ...item,
        status: 'error' as const,
        errorMessage: outcome.error ?? 'Generation failed',
      };
    }
    return { ...item, status: 'complete' as const, progress: 100 };
  }

  /**
   * Handle a generation-stream event (live transcript). Clears stale
   * analysis streaming states on the first event of the pass, appends to
   * the flat accumulator, and forwards flat events to the per-phase
   * StreamingState builder.
   */
  public handleGenerationStream(payload: GenerationStreamPayload): void {
    if (!this.generationStreamInitialized) {
      this.generationStreamInitialized = true;
      this.surfaces.resetPhaseSurfaces();
    }

    this.state.generationStream.update((msgs) => [...msgs, payload]);

    if (payload.flatEvent) {
      this.surfaces.routePhaseEvent(
        payload.flatEvent.messageId,
        payload.flatEvent,
      );
    }
  }

  /**
   * Reset per-generation-pass state. Called by the coordinator's reset().
   */
  public resetPassState(): void {
    this.generationStreamInitialized = false;
  }

  /**
   * Handle error messages. Fallback-warning errors set the dedicated
   * fallback signal instead of the fatal errorState.
   */
  public handleError(payload: WizardErrorPayload): void {
    if (payload.type === 'fallback-warning') {
      this.state.fallbackWarning.set(payload.message);
      return;
    }

    const errorState: ErrorState = {
      message: payload.message,
      details: payload.details,
    };
    this.state.errorState.set(errorState);
    this.surfaces.unregisterAllPhaseSurfaces();
  }
}
