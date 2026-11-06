import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import type { SubagentRecord } from '@ptah-extension/chat-streaming';
import { LucideAngularModule, Moon, Square } from 'lucide-angular';
import { AgentSteerInputComponent } from '@ptah-extension/chat-ui';
import { SessionAgentTrayService } from '../../../services/session-agents/session-agent-tray.service';
import type { TrayAgentContext } from '../../../services/session-agents/session-agent-tray';
import { ChatAgentFeedbackSender } from '../../../services/agent-feedback/chat-agent-feedback-sender.service';
import { subagentFollowUpPrompt } from '../../../utils/subagent-follow-up-prompt';

/** How the composer delivers the text for the agent's current state. */
export type SubagentComposerMode = 'steer' | 'follow-up' | 'unavailable';

const STEER_FAILED = 'Could not send your message. Try again.';
const FOLLOW_UP_FAILED = 'Could not send the follow-up. Try again.';

/**
 * SubagentLaneComposerComponent - the always-visible message input at the
 * bottom of a sub-agent lane.
 *
 * A running, steerable agent gets the text over `subagent:send-message`
 * (through the tray). Any other agent with a known owning session gets it as a
 * main-chat follow-up that asks the main agent to continue it. The draft is
 * kept on failure and reset whenever the lane shows a different agent.
 */
@Component({
  selector: 'ptah-subagent-lane-composer',
  standalone: true,
  imports: [AgentSteerInputComponent, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // The lane places it below its scroller, in the chat column; the input
  // sits in the main chat composer's card.
  host: { class: 'block' },
  template: `
    @if (mode() === 'unavailable') {
      @if (context(); as ctx) {
        <div class="flex items-center justify-end gap-1 py-1">
          @if (ctx.entry.canBackground) {
            <button type="button" class="btn btn-ghost btn-xs btn-square"
              aria-label="Send to background" title="Send to background"
              [disabled]="backgroundPending()" (click)="backgroundRequested.emit(ctx)">
              <lucide-angular [img]="MoonIcon" class="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          }
          @if (ctx.entry.stoppable) {
            <button type="button" [class]="stopButtonClass"
              aria-label="Stop generating" title="Stop generating"
              [disabled]="stopPending()" (click)="stopRequested.emit(ctx)">
              <lucide-angular [img]="SquareIcon" class="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          }
        </div>
      }
      <p
        class="px-1 py-1.5 text-xs text-base-content-muted"
        data-testid="subagent-composer-unavailable"
      >
        {{ unavailableText() }}
      </p>
    } @else {
      <ptah-agent-steer-input
        class="block pt-1"
        variant="composer"
        [steerable]="true"
        [clearOnSubmit]="false"
        [pending]="pending()"
        [placeholder]="placeholder()"
        [sendLabel]="
          mode() === 'steer' ? 'Send steer message' : 'Send follow-up'
        "
        [draft]="draft()"
        (draftChange)="onDraft($event)"
        (steer)="onSubmit($event)"
      >
        @if (context(); as ctx) {
          <ng-container composerActions>
            @if (ctx.entry.canBackground) {
              <button type="button" class="btn btn-ghost btn-xs btn-square"
                aria-label="Send to background" title="Send to background"
                [disabled]="backgroundPending()" (click)="backgroundRequested.emit(ctx)">
                <lucide-angular [img]="MoonIcon" class="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            }
            @if (ctx.entry.stoppable) {
              <button type="button" [class]="stopButtonClass"
                aria-label="Stop generating" title="Stop generating"
                [disabled]="stopPending()" (click)="stopRequested.emit(ctx)">
                <lucide-angular [img]="SquareIcon" class="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            }
          </ng-container>
        }
      </ptah-agent-steer-input>
      @if (mode() === 'follow-up') {
        <p
          class="px-1 pt-1 text-[11px] text-base-content-muted"
          data-testid="subagent-composer-hint"
        >
          Sends to the main chat as a follow-up
        </p>
      }
      @if (error(); as message) {
        <p
          role="alert"
          class="px-1 pt-1 text-xs text-error"
          data-testid="subagent-composer-error"
        >
          {{ message }}
        </p>
      }
      @if (status(); as message) {
        <p
          role="status"
          class="px-1 pt-1 text-xs text-base-content-muted"
          data-testid="subagent-composer-status"
        >
          {{ message }}
        </p>
      }
    }
  `,
})
export class SubagentLaneComposerComponent {
  readonly record = input.required<SubagentRecord>();
  readonly stopPending = input(false);
  readonly backgroundPending = input(false);
  readonly stopRequested = output<TrayAgentContext>();
  readonly backgroundRequested = output<TrayAgentContext>();
  protected readonly MoonIcon = Moon;
  protected readonly SquareIcon = Square;
  protected readonly stopButtonClass = 'inline-flex items-center justify-center h-7 w-7 flex-shrink-0 rounded-full bg-error/15 text-error hover:bg-error/25 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2';
  readonly context = input<TrayAgentContext | null>(null);
  /** The lane's fallback session, used when neither record nor tray knows it. */
  readonly sessionId = input<string | null>(null);

  private readonly tray = inject(SessionAgentTrayService);
  private readonly sender = inject(ChatAgentFeedbackSender);

  protected readonly draft = signal('');
  protected readonly pending = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly status = signal<string | null>(null);
  /** Bumped per agent key, so a reply for agent A never lands on agent B. */
  private generation = 0;

  private readonly key = computed(() => this.record().parentToolUseId);
  private readonly owningSession = computed(
    () =>
      this.record().parentSessionId ??
      this.context()?.sessionId ??
      this.sessionId() ??
      null,
  );
  protected readonly name = computed(() => {
    const record = this.record();
    return (
      record.teammateName || record.agentType || record.agentId || 'sub-agent'
    );
  });
  /** Still active, so the text must steer it, never go to the main chat. */
  private readonly live = computed(() => {
    const status = this.record().status;
    return (
      status === 'running' ||
      status === 'pending' ||
      status === 'paused' ||
      status === 'background'
    );
  });
  readonly mode = computed<SubagentComposerMode>(() => {
    if (this.context()?.entry.steerable) return 'steer';
    if (this.live()) return 'unavailable';
    return this.owningSession() ? 'follow-up' : 'unavailable';
  });
  protected readonly unavailableText = computed(() =>
    this.live()
      ? 'This agent cannot take messages right now'
      : "This agent's session is not open",
  );
  protected readonly placeholder = computed(() =>
    this.mode() === 'steer'
      ? `Message ${this.name()}…`
      : `Ask the main agent to continue ${this.name()}…`,
  );

  constructor() {
    effect(() => {
      this.key();
      untracked(() => {
        this.generation++;
        this.draft.set('');
        this.pending.set(false);
        this.error.set(null);
        this.status.set(null);
      });
    });
  }

  protected onDraft(text: string): void {
    this.draft.set(text);
    this.status.set(null);
  }

  protected async onSubmit(text: string): Promise<void> {
    if (this.pending()) return;
    const mode = this.mode();
    if (mode === 'unavailable') return;
    const generation = this.generation;
    this.error.set(null);
    this.status.set(null);
    this.pending.set(true);
    try {
      const failure =
        mode === 'steer' ? await this.steer(text) : await this.followUp(text);
      if (generation !== this.generation) return;
      if (failure) {
        this.error.set(failure);
        return;
      }
      this.draft.set('');
      if (mode === 'follow-up') this.status.set('Sent to the main chat');
    } finally {
      if (generation === this.generation) this.pending.set(false);
    }
  }

  /** `null` on success, else the user-facing failure line. */
  private async steer(text: string): Promise<string | null> {
    const context = this.context();
    if (!context) return STEER_FAILED;
    // The tray catches transport errors; the RPC error itself is shown by
    // the lane's command-error line.
    return (await this.tray.steer(context, text)) ? null : STEER_FAILED;
  }

  /** `null` on success, else the sender's user-facing error. */
  private async followUp(text: string): Promise<string | null> {
    const sessionId = this.owningSession();
    if (!sessionId) return FOLLOW_UP_FAILED;
    const result = await this.sender.send(
      { sessionId },
      subagentFollowUpPrompt(this.record(), text),
    );
    return result.sent ? null : (result.error ?? FOLLOW_UP_FAILED);
  }
}
