import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  signal,
  computed,
  viewChild,
  ElementRef,
} from '@angular/core';
import { LucideAngularModule, Send, Square } from 'lucide-angular';

/**
 * CompactSessionInputComponent - Mini input for the compact session card.
 *
 * Stripped-down textarea with send/stop buttons. No model/effort/agent selectors —
 * those are inherited from the tab's existing settings.
 *
 * Complexity Level: 1 (Molecule with minimal logic)
 * Patterns: Signal inputs/outputs, OnPush
 */
@Component({
  selector: 'ptah-compact-session-input',
  standalone: true,
  imports: [LucideAngularModule],
  template: `
    <div class="flex items-end gap-1.5 px-3 py-2">
      <textarea
        #inputEl
        class="textarea textarea-bordered textarea-xs flex-1 min-h-[32px] max-h-[64px] resize-none leading-snug text-xs"
        placeholder="Ask something..."
        [value]="currentMessage()"
        (input)="handleInput($event)"
        (keydown)="handleKeyDown($event)"
        rows="1"
      ></textarea>

      <div class="flex flex-col gap-0.5 pb-0.5">
        @if (isStreaming()) {
          <button
            class="btn btn-error btn-xs btn-square"
            (click)="stopRequested.emit()"
            title="Stop"
            type="button"
          >
            <lucide-angular [img]="SquareIcon" class="w-3 h-3" />
          </button>
        }
        <button
          class="btn btn-primary btn-xs btn-square"
          [disabled]="!canSend()"
          (click)="handleSend()"
          title="Send"
          type="button"
        >
          <lucide-angular [img]="SendIcon" class="w-3 h-3" />
        </button>
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CompactSessionInputComponent {
  readonly isStreaming = input<boolean>(false);
  readonly messageSent = output<string>();
  readonly stopRequested = output<void>();

  protected readonly SendIcon = Send;
  protected readonly SquareIcon = Square;

  readonly currentMessage = signal('');
  readonly canSend = computed(() => this.currentMessage().trim().length > 0);

  private readonly inputRef =
    viewChild<ElementRef<HTMLTextAreaElement>>('inputEl');

  handleInput(event: Event): void {
    const textarea = event.target as HTMLTextAreaElement;
    this.currentMessage.set(textarea.value);
    // Auto-resize
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 64)}px`;
  }

  handleKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.handleSend();
    }
  }

  handleSend(): void {
    const msg = this.currentMessage().trim();
    if (!msg) return;

    this.messageSent.emit(msg);
    this.currentMessage.set('');

    // Reset textarea height
    const el = this.inputRef()?.nativeElement;
    if (el) {
      el.value = '';
      el.style.height = 'auto';
    }
  }
}
