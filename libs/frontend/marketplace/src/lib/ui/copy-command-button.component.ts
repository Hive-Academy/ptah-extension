import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { Check, Copy, LucideAngularModule } from 'lucide-angular';

/** How long the "Copied" confirmation stays before the button resets. */
export const COPIED_FEEDBACK_MS = 2000;

/** Announced after the clipboard write succeeds. */
const COPIED_MESSAGE = 'Copied';

type CopyState = 'idle' | 'copied' | 'selected';

/**
 * Why the clipboard write failed, for the live region. The failure's shape is
 * checked before its `name` is read: a denied permission is a `DOMException`
 * named `NotAllowedError`; anything else (no `navigator.clipboard` in the
 * host, a type error) reads as "unavailable".
 */
function clipboardFailureMessage(error: unknown): string {
  const denied =
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === 'NotAllowedError';
  return denied
    ? 'Clipboard access was denied. The command is selected; copy it with your keyboard.'
    : 'Clipboard is unavailable. The command is selected; copy it with your keyboard.';
}

/**
 * A button that copies a shell command, with a "Copied" confirmation in a
 * polite live region.
 *
 * When the clipboard write fails (permission denied, or no
 * `navigator.clipboard` in the host) the text of `selectTarget` is selected
 * instead, so the user can copy it by hand; the live region says so. Never
 * throws. Renders nothing for a blank command.
 *
 * `selectTarget` is the element that shows the command, usually a `<code>`
 * next to the button, passed as a template reference.
 *
 * @example
 * ```html
 * <code #fix>{{ command }}</code>
 * <ptah-copy-command-button [command]="command" [selectTarget]="fix" />
 * ```
 */
@Component({
  selector: 'ptah-copy-command-button',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex shrink-0' },
  template: `
    @if (hasCommand()) {
      <button
        type="button"
        class="btn btn-ghost btn-xs gap-1"
        [attr.aria-label]="label()"
        data-testid="copy-command-button"
        (click)="copy()"
      >
        <lucide-angular
          [img]="state() === 'copied' ? CheckIcon : CopyIcon"
          class="h-3 w-3"
          aria-hidden="true"
        />
        <span aria-hidden="true">{{
          state() === 'copied' ? 'Copied' : 'Copy'
        }}</span>
      </button>
    }
    <span
      class="sr-only"
      role="status"
      aria-live="polite"
      data-testid="copy-command-status"
      >{{ announcement() }}</span
    >
  `,
})
export class CopyCommandButtonComponent {
  /** The command to copy. A blank command renders no button. */
  public readonly command = input.required<string>();

  /** The element showing the command; selected when the clipboard fails. */
  public readonly selectTarget = input.required<HTMLElement>();

  /** Accessible name of the button. @default 'Copy command' */
  public readonly label = input<string>('Copy command');

  protected readonly CopyIcon = Copy;
  protected readonly CheckIcon = Check;

  protected readonly state = signal<CopyState>('idle');
  protected readonly announcement = signal('');

  protected readonly hasCommand = computed(
    () => this.command().trim().length > 0,
  );

  private feedbackTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  /** A clipboard write is in flight. */
  private pending = false;

  public constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.cancelFeedbackTimer();
    });
  }

  /**
   * Copy once at a time: a click while a write is pending is ignored, so two
   * quick clicks cannot settle out of order and leave "Copied" next to a
   * selection fallback (or the reverse).
   */
  protected async copy(): Promise<void> {
    const command = this.command();
    if (this.pending || command.trim().length === 0) return;
    this.pending = true;
    try {
      await this.writeOrSelect(command);
    } finally {
      this.pending = false;
    }
  }

  private async writeOrSelect(command: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(command);
      if (this.destroyed) return;
      this.state.set('copied');
      this.announcement.set(COPIED_MESSAGE);
      this.scheduleReset();
    } catch (error: unknown) {
      if (this.destroyed) return;
      this.cancelFeedbackTimer();
      this.selectCommandText();
      this.state.set('selected');
      this.announcement.set(clipboardFailureMessage(error));
    }
  }

  /** Select the target's text so the user can copy it with the keyboard. */
  private selectCommandText(): void {
    const target = this.selectTarget();
    const selection = target.ownerDocument.defaultView?.getSelection();
    if (!selection) return;
    const range = target.ownerDocument.createRange();
    range.selectNodeContents(target);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  private scheduleReset(): void {
    this.cancelFeedbackTimer();
    this.feedbackTimer = setTimeout(() => {
      this.feedbackTimer = null;
      if (this.destroyed) return;
      this.state.set('idle');
      this.announcement.set('');
    }, COPIED_FEEDBACK_MS);
  }

  private cancelFeedbackTimer(): void {
    if (this.feedbackTimer !== null) {
      clearTimeout(this.feedbackTimer);
      this.feedbackTimer = null;
    }
  }
}
