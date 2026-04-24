import type {
  GenerationCompletePayload,
  GenerationProgressPayload,
  GenerationStreamPayload,
  WizardErrorPayload,
} from '@ptah-extension/shared';
import type { CompletionData, ErrorState } from '../setup-wizard-state.service';
import type { WizardInternalState } from './wizard-internal-state';
import type { WizardStreamAccumulator } from './wizard-stream-accumulator';

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
    private readonly accumulator: WizardStreamAccumulator,
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
      this.accumulator.reset();
    }

    this.state.generationStream.update((msgs) => [...msgs, payload]);

    if (payload.flatEvent) {
      this.accumulator.accumulate(payload.flatEvent);
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
  }
}
