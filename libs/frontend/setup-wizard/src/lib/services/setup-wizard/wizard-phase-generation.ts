import type {
  GenerationCompletePayload,
  GenerationProgressPayload,
  GenerationStreamPayload,
  WizardErrorPayload,
} from '@ptah-extension/shared';
import type { CompletionData, ErrorState } from '../setup-wizard-state.types';
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
      // Items not yet initialized — the frontend component that calls
      // submitAgentSelection() is responsible for seeding them.
      return;
    }

    const { currentAgent, phase, percentComplete } = payload.progress;

    if (phase === 'complete') {
      this.state.skillGenerationProgress.update((currentItems) =>
        currentItems.map((item) =>
          item.status === 'pending' || item.status === 'in-progress'
            ? { ...item, status: 'complete' as const, progress: 100 }
            : item,
        ),
      );
      return;
    }

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

          // Previously in-progress items transition to complete when a new
          // agent becomes current.
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
   * Handle generation-complete. Persists completionData and asks the
   * coordinator to advance the step if the user is currently on
   * 'generation' (auto-transition to the enhance step).
   */
  public handleGenerationComplete(payload: GenerationCompletePayload): void {
    const completionData: CompletionData = {
      success: payload.success,
      generatedCount: payload.generatedCount,
      duration: payload.duration,
      errors: payload.errors,
      warnings: payload.warnings,
      enhancedPromptsUsed: payload.enhancedPromptsUsed,
    };

    this.state.completionData.set(completionData);
    this.state.setCurrentStepIfGeneration();

    // TASK_2026_107 Phase 3: tear down generation-phase routing bindings.
    // The accumulated StreamingStates remain visible in the public
    // `phaseStreamingStates` signal until the next generation pass starts
    // (`handleGenerationStream` resets them on first event of new pass).
    this.surfaces.unregisterAllPhaseSurfaces();
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
      // TASK_2026_107 Phase 3: clear stale analysis-phase surfaces (and their
      // accumulated states) before the generation pass begins. Equivalent to
      // the deleted `WizardStreamAccumulator.reset()`.
      this.surfaces.resetPhaseSurfaces();
    }

    this.state.generationStream.update((msgs) => [...msgs, payload]);

    if (payload.flatEvent) {
      // TASK_2026_107 Phase 3: route through StreamRouter; surface is lazy-
      // minted on first event for the generation phase's messageId.
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

    // TASK_2026_107 Phase 3: a fatal wizard error tears down any active
    // surface routing bindings so residual stream events from a partially-
    // dead phase are dropped (router resolves to no adapter and no-ops).
    this.surfaces.unregisterAllPhaseSurfaces();
  }
}
