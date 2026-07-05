import {
  Component,
  input,
  signal,
  computed,
  inject,
  ChangeDetectionStrategy,
} from '@angular/core';
import { LucideAngularModule, SendHorizontal } from 'lucide-angular';
import {
  AgentMonitorStore,
  type MonitoredAgent,
} from '@ptah-extension/chat-streaming';

@Component({
  selector: 'ptah-agent-continue-input',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visible()) {
      <div
        class="flex flex-col gap-1.5 border-t border-base-content/10 px-2.5 py-2"
      >
        <span class="text-[11px] font-medium text-base-content/50">
          {{ subtitle() }}
        </span>
        <div class="flex items-end gap-1.5">
          <textarea
            class="textarea textarea-bordered textarea-sm flex-1 min-h-[2.25rem] resize-none text-xs"
            rows="1"
            placeholder="Send a follow-up…"
            [disabled]="disabled()"
            [value]="draft()"
            (input)="onInput($event)"
            (keydown.enter)="onEnter($event)"
          ></textarea>
          <button
            type="button"
            class="btn btn-sm btn-primary btn-square"
            [disabled]="sendDisabled()"
            (click)="submit()"
          >
            @if (submitting()) {
              <span class="loading loading-spinner loading-xs"></span>
            } @else {
              <lucide-angular [img]="SendIcon" class="w-3.5 h-3.5" />
            }
          </button>
        </div>
        @if (error(); as message) {
          <span class="text-[11px] text-warning">{{ message }}</span>
        }
      </div>
    }
  `,
})
export class AgentContinueInputComponent {
  private readonly store = inject(AgentMonitorStore);

  readonly agent = input.required<MonitoredAgent>();

  readonly SendIcon = SendHorizontal;

  protected readonly draft = signal('');
  protected readonly submitting = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly visible = computed(
    () => this.agent().supportsContinuation === true,
  );

  protected readonly disabled = computed(
    () => this.submitting() || this.agent().status === 'running',
  );

  protected readonly subtitle = computed(() =>
    this.agent().status === 'running'
      ? 'Agent is working…'
      : 'Send a follow-up',
  );

  protected readonly sendDisabled = computed(
    () => this.disabled() || this.draft().trim().length === 0,
  );

  protected onInput(event: Event): void {
    this.draft.set((event.target as HTMLTextAreaElement).value);
  }

  protected onEnter(event: Event): void {
    const keyboardEvent = event as KeyboardEvent;
    if (keyboardEvent.shiftKey) return;
    keyboardEvent.preventDefault();
    void this.submit();
  }

  protected async submit(): Promise<void> {
    const message = this.draft().trim();
    if (message.length === 0 || this.disabled()) return;

    this.submitting.set(true);
    this.error.set(null);
    try {
      const result = await this.store.continueAgent(
        this.agent().agentId,
        message,
      );
      if (result.ok) {
        this.draft.set('');
      } else if (result.code === 'busy') {
        this.error.set('Agent is busy, try again when it finishes.');
      } else if (result.code === 'not_found') {
        this.error.set('Agent expired — start a new one.');
      } else {
        this.error.set('Could not send the follow-up. Try again.');
      }
    } catch (error: unknown) {
      this.error.set(
        error instanceof Error
          ? error.message
          : 'Could not send the follow-up. Try again.',
      );
    } finally {
      this.submitting.set(false);
    }
  }
}
