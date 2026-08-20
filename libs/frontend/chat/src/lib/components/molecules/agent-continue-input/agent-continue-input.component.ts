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
import { LucideAngularModule, SendHorizontal, X } from 'lucide-angular';
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
  private readonly store = inject(AgentMonitorStore);

  readonly agent = input.required<MonitoredAgent>();

  readonly SendIcon = SendHorizontal;
  readonly CancelIcon = X;

  protected readonly draft = signal('');
  protected readonly submitting = signal(false);
  protected readonly error = signal<string | null>(null);

  /**
   * Follow-up typed while the agent was still running, held here until the run
   * ends (TASK_2026_294 follow-up).
   *
   * The backend refuses `agent:continue` on a running agent with `busy`, and
   * this box used to be disabled outright for the whole run — so steering a
   * working agent was impossible and the typed text was lost. The queue lives
   * in the component for the same reason chat's lives in `TabManagerService`:
   * the message has not been sent, so nothing downstream should know about it
   * yet.
   */
  protected readonly queued = signal<string | null>(null);

  protected readonly visible = computed(
    () => this.agent().supportsContinuation === true,
  );

  /**
   * Only an in-flight send blocks the box. A RUNNING agent no longer does —
   * typing during a run is the whole point; the message queues instead.
   */
  protected readonly disabled = computed(() => this.submitting());

  /**
   * Send the held follow-up as soon as the agent leaves `running`.
   *
   * Tracks `agent()` alone; `queued` is read and cleared through `untracked` so
   * writing it cannot re-trigger this effect.
   */
  private readonly flushOnIdle = effect(() => {
    const status = this.agent().status;
    if (status === 'running') return;
    const pending = untracked(() => this.queued());
    if (!pending) return;
    untracked(() => this.queued.set(null));
    void this.deliver(pending);
  });

  /**
   * The backend dropped the process record, so a follow-up has to go through a
   * session resume. Only true when there is a session to resume with — without
   * `cliSessionId` there is no path at all, and saying "resumes the session"
   * would promise one.
   */
  protected readonly resumesInstead = computed(
    () =>
      this.agent().continuationExpired === true && !!this.agent().cliSessionId,
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

    if (this.agent().status === 'running') {
      this.enqueue(message);
      return;
    }
    this.draft.set('');
    await this.deliver(message);
  }

  /**
   * Put a queued message back in the box so it can be edited or dropped.
   * Mirrors `ChatStore.moveQueueToInput`.
   */
  protected unqueue(): void {
    const pending = this.queued();
    if (!pending) return;
    this.queued.set(null);
    const draft = this.draft().trim();
    this.draft.set(draft ? `${pending}\n${draft}` : pending);
  }

  /**
   * Hold a follow-up for the end of the current run, coalescing repeats into
   * one message the same way `ConversationService.queueOrAppendMessage` does —
   * a second thought should not become a second turn.
   */
  private enqueue(message: string): void {
    this.error.set(null);
    this.queued.update((existing) =>
      existing ? `${existing}\n${message}` : message,
    );
    this.draft.set('');
  }

  /**
   * Actually send a follow-up. Shared by the direct send and the queue flush.
   */
  private async deliver(message: string): Promise<void> {
    this.submitting.set(true);
    this.error.set(null);
    try {
      // A card whose record we already know is gone skips the round trip that
      // can only answer `not_found` and resumes straight away.
      if (this.resumesInstead()) {
        await this.sendByResuming(message);
        return;
      }

      const result = await this.store.continueAgent(
        this.agent().agentId,
        message,
      );
      if (result.ok) {
        return;
      }
      if (result.code === 'busy') {
        // The card's status had not caught up with the backend yet. Re-queue
        // rather than erroring — the flush effect retries at the real turn end.
        this.enqueue(message);
      } else if (result.code === 'not_found') {
        // The record aged out (or the host restarted) without us hearing about
        // it. The CONVERSATION is still on disk, so resume it rather than
        // telling the user to start over and lose the context.
        await this.sendByResuming(message);
      } else {
        this.restoreUndelivered(message);
        this.error.set('Could not send the follow-up. Try again.');
      }
    } catch (error: unknown) {
      this.restoreUndelivered(message);
      this.error.set(
        error instanceof Error
          ? error.message
          : 'Could not send the follow-up. Try again.',
      );
    } finally {
      this.submitting.set(false);
    }
  }

  /**
   * Put a message that failed to send back in the box. Without this a queued
   * follow-up that fails at flush time is gone — the user never retyped it and
   * never saw it leave, which is the loss this whole change exists to stop.
   */
  private restoreUndelivered(message: string): void {
    const draft = this.draft().trim();
    this.draft.set(draft ? `${message}\n${draft}` : message);
  }

  /**
   * Deliver the follow-up by resuming the CLI-native session. The resumed run
   * arrives as a fresh agent card (a new `agentId`), which replaces this one —
   * so the draft is cleared here and this component is on its way out.
   */
  private async sendByResuming(message: string): Promise<void> {
    if (!this.agent().cliSessionId) {
      this.restoreUndelivered(message);
      this.error.set('Agent expired and has no session to resume.');
      return;
    }

    const resumed = await this.store.resumeAgentWithMessage(
      this.agent(),
      message,
    );
    if (resumed.ok) {
      return;
    }
    this.restoreUndelivered(message);
    this.error.set(
      resumed.error
        ? `Could not resume the session: ${resumed.error}`
        : 'Could not resume the session. Try again.',
    );
  }
}
