import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { Clipboard } from '@angular/cdk/clipboard';
import { Check, Copy, LucideAngularModule, X } from 'lucide-angular';

type CopyState = 'idle' | 'copied' | 'failed';

/** How long the copied/failed feedback stays before the button resets. */
const FEEDBACK_MS = 2000;

/**
 * CopyTextButtonComponent - icon button that copies a given string.
 *
 * Complexity Level: 1 (Simple atom)
 * Patterns: CDK Clipboard, signal state, OnPush
 *
 * Used for tool previews ("Copy command", "Copy output"). The whole-message
 * `ptah-copy-button` stays separate: its input is a chat message, not text.
 * The outcome is announced in a polite live region ("Copied" or "Copy
 * failed"); a clipboard failure never throws.
 */
@Component({
  selector: 'ptah-copy-text-button',
  standalone: true,
  imports: [LucideAngularModule],
  template: `
    <button
      type="button"
      class="btn btn-ghost btn-square btn-xs h-7 w-7 min-h-0"
      [class.text-success]="state() === 'copied'"
      [class.text-error]="state() === 'failed'"
      [attr.aria-label]="label()"
      [title]="title()"
      [disabled]="!text()"
      (click)="copy()"
    >
      <lucide-angular [img]="icon()" class="w-3.5 h-3.5" aria-hidden="true" />
    </button>
    <span class="sr-only" aria-live="polite" role="status">{{
      announcement()
    }}</span>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CopyTextButtonComponent {
  private readonly clipboard = inject(Clipboard);

  /** The exact text placed on the clipboard. */
  readonly text = input.required<string>();
  /** Accessible name and tooltip, e.g. "Copy command". */
  readonly label = input.required<string>();

  protected readonly state = signal<CopyState>('idle');

  protected readonly icon = computed(() => {
    const state = this.state();
    return state === 'copied' ? Check : state === 'failed' ? X : Copy;
  });

  protected readonly announcement = computed(() => {
    const state = this.state();
    return state === 'copied'
      ? 'Copied'
      : state === 'failed'
        ? 'Copy failed'
        : '';
  });

  protected readonly title = computed(
    () => this.announcement() || this.label(),
  );

  private resetTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.resetTimer));
  }

  protected copy(): void {
    let copied: boolean;
    try {
      copied = this.clipboard.copy(this.text());
    } catch {
      // The webview can deny clipboard access; report it, never throw.
      copied = false;
    }
    this.state.set(copied ? 'copied' : 'failed');
    clearTimeout(this.resetTimer);
    this.resetTimer = setTimeout(() => this.state.set('idle'), FEEDBACK_MS);
  }
}
