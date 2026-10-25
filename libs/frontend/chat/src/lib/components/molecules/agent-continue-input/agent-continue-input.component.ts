import {
  Component,
  input,
  signal,
  computed,
  effect,
  untracked,
  inject,
  ChangeDetectionStrategy,
} from '@angular/core';
import { ArrowUp, LucideAngularModule, SendHorizontal, X } from 'lucide-angular';
import type { MonitoredAgent } from '@ptah-extension/chat-streaming';
import {
  COMPOSER_CARD_BORDER_CLASS,
  COMPOSER_CARD_CLASS,
  COMPOSER_SEND_BUTTON_CLASS,
  COMPOSER_TEXTAREA_CLASS,
  COMPOSER_TOOLBAR_CLASS,
} from '@ptah-extension/chat-ui';
import {
  AgentFollowUpQueueService,
  followUpResumesInstead,
} from '../../../services/agent-follow-up-queue.service';

@Component({
  selector: 'ptah-agent-continue-input',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visible() && variant() === 'composer') {
      <!-- A canvas lane: the main chat composer's card, hint below it. -->
      <div class="flex flex-col gap-1 pb-2">
        <div
          [class]="composerCardClass"
          data-glass-surface="tile"
          data-testid="continue-composer-card"
        >
          <!-- The main chat composer's shape: textarea, then a bottom row
               with its send button. No model or mode toolbar. -->
          <textarea
            style="field-sizing: content"
            rows="2"
            [class]="textareaClass"
            placeholder="Send a follow-up…"
            [attr.aria-label]="subtitle()"
            [disabled]="disabled()"
            [value]="draft()"
            (input)="onInput($event)"
            (keydown.enter)="onEnter($event)"
          ></textarea>
          <div [class]="toolbarClass">
            <button
              type="button"
              [class]="sendButtonClass"
              aria-label="Send follow-up"
              title="Send follow-up"
              [disabled]="sendDisabled()"
              (click)="submit()"
            >
              @if (submitting()) {
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
        <span class="px-1 text-[11px] text-base-content-muted">
          {{ subtitle() }}
        </span>
        @if (queued(); as pending) {
          <button
            type="button"
            class="flex items-start gap-1.5 rounded border border-base-content/10 bg-base-200/60 px-2 py-1 text-left text-[11px] text-base-content-muted hover:bg-base-200"
            title="Click to edit — puts the message back in the box"
            (click)="unqueue()"
          >
            <lucide-angular
              [img]="CancelIcon"
              class="w-3 h-3 mt-0.5 shrink-0"
            />
            <span class="flex-1">
              <span class="font-medium">Queued</span> — sends when this run
              finishes: {{ pending }}
            </span>
          </button>
        }
        @if (error(); as message) {
          <span class="px-1 text-[11px] text-warning">{{ message }}</span>
        }
      </div>
    } @else if (visible()) {
      <div
        class="flex flex-col gap-1.5 border-t border-base-content/10 px-2.5 py-2"
      >
        <span class="text-[11px] font-medium text-base-content-muted">
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
        @if (queued(); as pending) {
          <button
            type="button"
            class="flex items-start gap-1.5 rounded border border-base-content/10 bg-base-200/60 px-2 py-1 text-left text-[11px] text-base-content-muted hover:bg-base-200"
            title="Click to edit — puts the message back in the box"
            (click)="unqueue()"
          >
            <lucide-angular
              [img]="CancelIcon"
              class="w-3 h-3 mt-0.5 shrink-0"
            />
            <span class="flex-1">
              <span class="font-medium">Queued</span> — sends when this run
              finishes: {{ pending }}
            </span>
          </button>
        }
        @if (error(); as message) {
          <span class="text-[11px] text-warning">{{ message }}</span>
        }
      </div>
    }
  `,
})
export class AgentContinueInputComponent {
  private readonly followUps = inject(AgentFollowUpQueueService);

  readonly agent = input.required<MonitoredAgent>();
  /** `panel` in the agent monitor; `composer` in a canvas lane's column. */
  readonly variant = input<'panel' | 'composer'>('panel');
  protected readonly composerCardClass = `${COMPOSER_CARD_CLASS} ${COMPOSER_CARD_BORDER_CLASS}`;
  protected readonly textareaClass = COMPOSER_TEXTAREA_CLASS;
  protected readonly toolbarClass = COMPOSER_TOOLBAR_CLASS;
  protected readonly sendButtonClass = COMPOSER_SEND_BUTTON_CLASS;
  readonly ArrowUpIcon = ArrowUp;

  readonly SendIcon = SendHorizontal;
  readonly CancelIcon = X;

  protected readonly draft = signal('');

  /**
   * Follow-up typed while the agent was still running, held until the run
   * ends (TASK_2026_294 follow-up).
   *
   * The backend refuses `agent:continue` on a running agent with `busy`, so
   * the message waits. The queue and its flush live in the root
   * `AgentFollowUpQueueService`, not here: this box sits in the shell row,
   * which is detached on a standalone surface, and a component effect would
   * not send the follow-up until the user came back to chat.
   */
  protected readonly queued = computed(() =>
    this.followUps.queued(this.agent().agentId),
  );
  protected readonly submitting = computed(() =>
    this.followUps.sending(this.agent().agentId),
  );
  protected readonly error = computed(() =>
    this.followUps.error(this.agent().agentId),
  );

  protected readonly visible = computed(
    () =>
      this.agent().supportsContinuation === true ||
      !!this.agent().cliSessionId,
  );

  /**
   * Only an in-flight send blocks the box. A RUNNING agent no longer does —
   * typing during a run is the whole point; the message queues instead.
   */
  protected readonly disabled = computed(() => this.submitting());

  /**
   * Take back a follow-up that failed to send, including one the service
   * flushed while this box was detached. Runs again whenever the box is
   * attached and the service holds undelivered text for this agent.
   */
  private readonly restoreUndelivered = effect(() => {
    const agentId = this.agent().agentId;
    if (this.followUps.undelivered(agentId) === null) return;
    untracked(() => this.absorbUndelivered(agentId));
  });

  protected readonly resumesInstead = computed(() =>
    followUpResumesInstead(this.agent()),
  );

  protected readonly subtitle = computed(() => {
    if (this.agent().status === 'running')
      return 'Agent is working — your message queues until it finishes';
    return this.resumesInstead()
      ? 'Send a follow-up — resumes the session'
      : 'Send a follow-up';
  });

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

    const agent = this.agent();
    this.draft.set('');
    if (agent.status === 'running') {
      this.followUps.enqueue(agent.agentId, message);
      return;
    }
    await this.followUps.send(agent, message);
    // A direct send that failed is put back now, not on the next change
    // detection pass, so the box never shows empty in between.
    this.absorbUndelivered(agent.agentId);
  }

  /**
   * Put a queued message back in the box so it can be edited or dropped.
   * Mirrors `ChatStore.moveQueueToInput`.
   */
  protected unqueue(): void {
    const pending = this.followUps.unqueue(this.agent().agentId);
    if (pending !== null) this.prependToDraft(pending);
  }

  private absorbUndelivered(agentId: string): void {
    const message = this.followUps.takeUndelivered(agentId);
    if (message !== null) this.prependToDraft(message);
  }

  private prependToDraft(message: string): void {
    const draft = this.draft().trim();
    this.draft.set(draft ? `${message}\n${draft}` : message);
  }
}
