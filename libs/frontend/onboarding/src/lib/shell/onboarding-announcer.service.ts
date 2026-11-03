import { Injectable, signal } from '@angular/core';

/**
 * Short polite announcements for the shell's one visually hidden
 * `role="status"` region ("Agent senior-tester written", "Command copied").
 *
 * The card grids and the proposal are not live regions; pages announce
 * discrete events through here instead.
 */
@Injectable({ providedIn: 'root' })
export class OnboardingAnnouncerService {
  private readonly _message = signal('');
  private sequence = 0;

  /** The text currently in the status region. */
  readonly message = this._message.asReadonly();

  /**
   * Announce `text`. The region is cleared first and filled on the next task,
   * so repeating the same message is announced again.
   */
  announce(text: string): void {
    const id = ++this.sequence;
    this._message.set('');
    setTimeout(() => {
      if (id === this.sequence) this._message.set(text);
    }, 0);
  }
}
