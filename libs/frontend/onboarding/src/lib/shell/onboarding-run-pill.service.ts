import { Injectable, signal } from '@angular/core';

/**
 * The read-only provider/model pill in the shell's top bar.
 *
 * A page shows it once its run is accepted (the provider and model are locked
 * from then on) and clears it when the run ends or the page is left. Nothing
 * is shown when no page has set it.
 */
@Injectable({ providedIn: 'root' })
export class OnboardingRunPillService {
  private readonly _label = signal<string | null>(null);

  /** The pill text, e.g. "Claude · sonnet"; `null` hides the pill. */
  readonly label = this._label.asReadonly();

  show(label: string): void {
    this._label.set(label.trim() === '' ? null : label);
  }

  clear(): void {
    this._label.set(null);
  }
}
