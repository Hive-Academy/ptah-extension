import type { WizardStep } from '../setup-wizard-state.types';
import type { WizardInternalState } from './wizard-internal-state';

/**
 * WizardFlowState — owns the wizard step state machine.
 *
 * Plain TypeScript class (no `@Injectable`, no `inject()`). Receives the
 * shared {@link WizardInternalState} handle via constructor; mutates the
 * coordinator-owned writable signals through the handle so signal
 * identity is preserved for `asReadonly()` consumers.
 *
 * The cross-cutting `reset()` orchestrator lives on the coordinator and
 * calls `WizardFlowState.reset()` plus the slices owned by the other
 * helpers. This helper's `reset()` only touches the wizard step signal.
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
   * Reset wizard step signal owned by this helper.
   */
  public reset(): void {
    this.state.currentStep.set('welcome');
  }
}
