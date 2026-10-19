import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import type { SubagentRecord } from '@ptah-extension/chat-streaming';
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
  imports: [AgentSteerInputComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'sticky bottom-0 z-10 block bg-base-100' },
  template: `
    @if (mode() === 'unavailable') {
      <p
        class="border-t border-base-content/10 px-2.5 py-1.5 text-xs text-base-content-muted"
        data-testid="subagent-composer-unavailable"
      >
        {{ unavailableText() }}
      </p>
    } @else {
      <ptah-agent-steer-input
        class="block"
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
      />
      @if (mode() === 'follow-up') {
        <p
          class="px-2.5 pb-1 text-[11px] text-base-content-muted"
          data-testid="subagent-composer-hint"
        >
          Sends to the main chat as a follow-up
        </p>
      }
      @if (error(); as message) {
        <p
          role="alert"
          class="px-2.5 pb-1 text-xs text-error"
          data-testid="subagent-composer-error"
        >
          {{ message }}
        </p>
      }
      @if (status(); as message) {
        <p
          role="status"
          class="px-2.5 pb-1 text-xs text-base-content-muted"
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
    return status === 'running' || status === 'pending' || status === 'paused';
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
