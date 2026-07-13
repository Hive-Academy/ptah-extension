import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  signal,
  computed,
} from '@angular/core';
import { LucideAngularModule, SendHorizontal } from 'lucide-angular';

/**
 * AgentSteerInputComponent — single-line "steer" input for a running or
 * background agent.
 *
 * Purely presentational: it self-hides unless `steerable` is true, disables
 * itself while `pending`, and emits the trimmed text on Enter (or send-button
 * click). The smart parent owns the in-flight state and the actual RPC call
 * (`sendMessageToAgent`), keeping this component free of store coupling so it
 * can be reused from the monitor panel, a canvas tile, or the strip.
 */
@Component({
  selector: 'ptah-agent-steer-input',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (steerable()) {
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
          aria-label="Send steer message"
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
  /** Placeholder / accessible label. */
  readonly placeholder = input<string>('Steer this agent…');

  /** Emits the trimmed steer text. Parent clears `pending` when done. */
  readonly steer = output<string>();

  protected readonly SendIcon = SendHorizontal;
  protected readonly draft = signal('');

  protected readonly sendDisabled = computed(
    () => this.pending() || this.draft().trim().length === 0,
  );

  protected onInput(event: Event): void {
    this.draft.set((event.target as HTMLInputElement).value);
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
    this.draft.set('');
  }
}
