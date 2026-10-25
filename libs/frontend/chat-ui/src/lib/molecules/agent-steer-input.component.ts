import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  model,
  computed,
} from '@angular/core';
import { ArrowUp, LucideAngularModule, SendHorizontal } from 'lucide-angular';
import {
  COMPOSER_CARD_BORDER_CLASS,
  COMPOSER_CARD_CLASS,
  COMPOSER_SEND_BUTTON_CLASS,
  COMPOSER_TEXTAREA_CLASS,
  COMPOSER_TOOLBAR_CLASS,
} from './composer-card';

/**
 * AgentSteerInputComponent — single-line "steer" input for a running or
 * background agent.
 *
 * Purely presentational: it self-hides unless `steerable` is true, disables
 * itself while `pending`, and emits the trimmed text on Enter (or send-button
 * click). The consumer owns the in-flight state and the actual RPC call
 * (`sendMessageToAgent`), keeping this component free of store coupling.
 *
 * Consumed by {@link BackgroundAgentStripComponent}, which expands it inline
 * beneath a chip when the user clicks that chip's steer icon (`inline`), and
 * by the sub-agent lane, which shows it in the main chat composer's card
 * (`composer`).
 */
@Component({
  selector: 'ptah-agent-steer-input',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (steerable() && variant() === 'composer') {
      <div
        [class]="composerCardClass"
        data-glass-surface="tile"
        data-testid="steer-composer-card"
      >
        <!-- The main chat composer's shape: textarea, then a bottom row with
             its send button. No model or mode toolbar (main session only). -->
        <textarea
          style="field-sizing: content"
          rows="2"
          [class]="textareaClass"
          [placeholder]="placeholder()"
          [disabled]="pending()"
          [value]="draft()"
          [attr.aria-label]="placeholder()"
          (input)="onInput($event)"
          (keydown.enter)="onEnter($event)"
        ></textarea>
        <div [class]="toolbarClass">
          <button
            type="button"
            [class]="sendButtonClass"
            [disabled]="sendDisabled()"
            [attr.aria-label]="sendLabel()"
            [title]="sendLabel()"
            (click)="submit()"
          >
            @if (pending()) {
              <span class="loading loading-spinner loading-xs"></span>
            } @else {
              <lucide-angular
                [img]="ArrowUpIcon"
                class="w-4 h-4"
                aria-hidden="true"
              />
            }
          </button>
        </div>
      </div>
    } @else if (steerable()) {
      <div
        class="flex items-center gap-1.5 border-t border-base-content/10 px-2.5 py-1.5"
      >
        <input
          type="text"
          class="input input-bordered input-xs flex-1 text-xs"
          [placeholder]="placeholder()"
          [disabled]="pending()"
          [value]="draft()"
          [attr.aria-label]="placeholder()"
          (input)="onInput($event)"
          (keydown.enter)="onEnter($event)"
        />
        <button
          type="button"
          class="btn btn-xs btn-primary btn-square"
          [disabled]="sendDisabled()"
          [attr.aria-label]="sendLabel()"
          (click)="submit()"
        >
          @if (pending()) {
            <span class="loading loading-spinner loading-xs"></span>
          } @else {
            <lucide-angular
              [img]="SendIcon"
              class="w-3 h-3"
              aria-hidden="true"
            />
          }
        </button>
      </div>
    }
  `,
})
export class AgentSteerInputComponent {
  /** Whether the input is shown at all (agent is running or background). */
  readonly steerable = input.required<boolean>();
  /** Disables the input while a steer request is in flight. */
  readonly pending = input<boolean>(false);
  /** Keep the draft while the caller waits for a send result. */
  readonly clearOnSubmit = input<boolean>(true);
  /** Placeholder / accessible label. */
  readonly placeholder = input<string>('Steer this agent…');
  /** Accessible label of the send button. */
  readonly sendLabel = input<string>('Send steer message');
  /** `inline` under a chip; `composer` in the main chat composer's card. */
  readonly variant = input<'inline' | 'composer'>('inline');

  /** Emits the trimmed steer text. Parent clears `pending` when done. */
  readonly steer = output<string>();

  /**
   * The typed text. Two-way bindable (`[(draft)]`) so a parent that keeps the
   * draft while it waits (`clearOnSubmit` false) can clear or reset it.
   */
  readonly draft = model('');

  protected readonly SendIcon = SendHorizontal;
  protected readonly ArrowUpIcon = ArrowUp;
  protected readonly composerCardClass = `${COMPOSER_CARD_CLASS} ${COMPOSER_CARD_BORDER_CLASS}`;
  protected readonly textareaClass = COMPOSER_TEXTAREA_CLASS;
  protected readonly toolbarClass = COMPOSER_TOOLBAR_CLASS;
  protected readonly sendButtonClass = COMPOSER_SEND_BUTTON_CLASS;

  protected readonly sendDisabled = computed(
    () => this.pending() || this.draft().trim().length === 0,
  );

  protected onInput(event: Event): void {
    this.draft.set(
      (event.target as HTMLInputElement | HTMLTextAreaElement).value,
    );
  }

  protected onEnter(event: Event): void {
    const keyboardEvent = event as KeyboardEvent;
    if (keyboardEvent.shiftKey) return;
    keyboardEvent.preventDefault();
    this.submit();
  }

  protected submit(): void {
    const text = this.draft().trim();
    if (text.length === 0 || this.pending()) return;
    this.steer.emit(text);
    if (this.clearOnSubmit()) this.draft.set('');
  }
}
