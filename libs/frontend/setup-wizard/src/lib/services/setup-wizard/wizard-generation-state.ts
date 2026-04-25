import type {
  GenerationProgress,
  SkillGenerationProgressItem,
} from '../setup-wizard-state.types';
import type { WizardInternalState } from './wizard-internal-state';

/**
 * WizardGenerationState — owns generation progress (legacy
 * `generationProgressSignal`) and per-skill-item progress tracking
 * (`skillGenerationProgressSignal`).
 *
 * Plain TypeScript class (no `@Injectable`, no `inject()`). Receives the
 * shared {@link WizardInternalState} handle via constructor; mutates the
 * coordinator-owned writable signals through the handle so signal
 * identity is preserved for `asReadonly()` consumers.
 */
export class WizardGenerationState {
  public constructor(private readonly state: WizardInternalState) {}

  /**
   * Update generation progress.
   */
  public updateGenerationProgress(progress: GenerationProgress): void {
    this.state.generationProgress.set(progress);
  }

  /**
   * Set skill generation progress items.
   * Called when generation begins with initial item list.
   *
   * @param items - Array of generation progress items
   */
  public setSkillGenerationProgress(
    items: SkillGenerationProgressItem[],
  ): void {
    this.state.skillGenerationProgress.set(items);
  }

  /**
   * Update a single skill generation progress item.
   *
   * @param itemId - Item identifier to update
   * @param update - Partial update to apply
   */
  public updateSkillGenerationItem(
    itemId: string,
    update: Partial<SkillGenerationProgressItem>,
  ): void {
    this.state.skillGenerationProgress.update((items) =>
      items.map((item) => (item.id === itemId ? { ...item, ...update } : item)),
    );
  }

  /**
   * Reset a failed generation item for retry.
   *
   * @param itemId - Item identifier to reset
   */
  public retryGenerationItem(itemId: string): void {
    this.updateSkillGenerationItem(itemId, {
      status: 'pending',
      progress: 0,
      errorMessage: undefined,
    });
  }

  /**
   * Reset generation signals owned by this helper.
   * Mirrors lines 1111 + 1125 of the original coordinator's `reset()` body
   * (generationProgress + skillGenerationProgress).
   */
  public reset(): void {
    this.state.generationProgress.set(null);
    this.state.skillGenerationProgress.set([]);
  }
}
