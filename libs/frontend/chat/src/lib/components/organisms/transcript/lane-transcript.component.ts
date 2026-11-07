import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { injectWallClock } from '@ptah-extension/core';
import { AgentDeliveryStore, AgentMonitorStore } from '@ptah-extension/chat-streaming';
import type {
  ExecutionNode,
  FlatStreamEventUnion,
  PermissionRequest,
  PermissionResponse,
} from '@ptah-extension/shared';
import {
  MessageBubbleComponent,
  type TurnLogToggle,
} from '../message-bubble.component';
import {
  TranscriptTurnContexts,
  streamingTurnIdsOf,
  turnLogOpenOf,
} from './transcript-turn-contexts';
import { laneTranscriptMessages } from './lane-transcript-messages';
import { LaneLogChoicesStore } from './lane-log-choices.store';
import { laneThreadEntries } from './lane-thread';
import { LaneThreadRowComponent } from './lane-thread-row.component';

/** Message chrome is owned by MessageBubbleComponent for every transcript host. */
@Component({
  selector: 'ptah-lane-transcript',
  standalone: true,
  imports: [MessageBubbleComponent, LaneThreadRowComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./chat-transcript.component.css'],
  host: { class: 'block min-w-0' },
  template: `
    <div class="chat-scroll-content">
      @if (thread().length) {
        <section class="mb-4 border-b border-base-content/10 pb-3" aria-label="Parent and lane communication">
          <h3 class="mb-2 text-xs font-semibold text-base-content-muted">Parent ↔ lane communication</h3>
          <div role="list" class="space-y-1">
            @for (entry of thread(); track entry.id) {
              <ptah-lane-thread-row [entry]="entry" [laneLabel]="laneLabel()" />
            }
          </div>
        </section>
      }
      @for (message of messages(); track message.id; let i = $index) {
        @let turn = contexts().get(message.id) ?? null;
        @let live = turn !== null && liveTurns().has(turn.turnId);
        <div
          class="chat-msg-slot"
          [attr.data-ptah-transcript-message-id]="message.id"
        >
          <ptah-message-bubble
            class="block pb-3"
            [message]="message"
            [agentTileMode]="true"
            [isStreaming]="
              isStreaming() &&
              i === messages().length - 1 &&
              message.role === 'assistant'
            "
            [turn]="turn"
            [turnLive]="live"
            [now]="live ? now() : 0"
            [logOpen]="turn ? logOpenFor(turn.turnId) : null"
            [permissionLookup]="getPermissionForTool()"
            [userActions]="false"
            (permissionResponded)="permissionResponded.emit($event)"
            (logToggled)="toggleLog($event)"
          />
        </div>
      }
    </div>
  `,
})
export class LaneTranscriptComponent {
  readonly laneId = input.required<string>();
  readonly nodes = input.required<readonly ExecutionNode[]>();
  readonly events = input<readonly FlatStreamEventUnion[]>([]);
  readonly isStreaming = input(false);
  readonly getPermissionForTool = input<
    ((id: string) => PermissionRequest | null) | undefined
  >();
  readonly permissionResponded = output<PermissionResponse>();
  protected readonly monitor = inject(AgentMonitorStore, { optional: true });
  private readonly delivery = inject(AgentDeliveryStore, { optional: true });
  private readonly turnContexts = new TranscriptTurnContexts();
  /** Kept outside the component so a tab switch keeps the user's choice. */
  private readonly logChoices = inject(LaneLogChoicesStore);
  protected readonly messages = computed(() =>
    laneTranscriptMessages(this.laneId(), this.nodes(), this.events()),
  );
  private readonly agent = computed(() => this.monitor?.agentsById?.().get(this.laneId()));
  protected readonly laneLabel = computed(() => this.agent()?.displayName ?? this.agent()?.cli ?? 'Lane');
  protected readonly thread = computed(() => {
    const agent = this.agent();
    if (!agent) return [];
    const receipts = this.delivery?.receipts().get(this.laneId()) ?? [];
    const parentDelivery = this.delivery?.parentDelivery().get(this.laneId()) ?? [];
    const completion = agent.completedAt ? { status: agent.status, timestamp: agent.completedAt } : undefined;
    return laneThreadEntries(this.messages(), receipts, '', this.laneLabel(), agent.cli ?? 'CLI', parentDelivery, completion,
      (id) => this.laneNameOf(id));
  });
  /** A sender lane's name from the monitor's agent list; `undefined` when the lane is unknown. */
  private laneNameOf(agentId: string): string | undefined {
    const sender = this.monitor?.agentsById?.().get(agentId);
    return sender ? (sender.displayName ?? sender.cli) : undefined;
  }
  protected readonly contexts = computed(() =>
    this.turnContexts.compute(this.messages()),
  );
  protected readonly liveTurns = computed(() =>
    streamingTurnIdsOf(
      this.messages(),
      this.isStreaming()
        ? Math.max(0, this.messages().length - 1)
        : this.messages().length,
      this.contexts(),
    ),
  );
  protected readonly now = injectWallClock(
    'second',
    () => this.liveTurns().size > 0,
  );
  /** The main transcript's rule (`turnLogOpenOf`); a lane is always `full`. */
  protected logOpenFor(turnId: string): boolean | null {
    return turnLogOpenOf(
      this.logChoices.choicesFor(this.laneId()).get(turnId),
      'full',
      this.liveTurns().has(turnId),
    );
  }
  protected toggleLog(toggle: TurnLogToggle): void {
    this.logChoices.set(this.laneId(), toggle.turnId, toggle.open);
  }
}
