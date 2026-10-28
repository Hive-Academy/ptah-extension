import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import {
  AgentAvatarComponent,
  agentAccessibleLabel,
  formatAgentDuration,
  type AgentStatusWord,
} from '@ptah-extension/chat-ui';
import type { SessionAgent } from '../../../services/session-agents/session-agent-roster';
import { SESSION_CARD_ACTIONS } from '../../../tokens/session-context.token';

/** Status word ink (design-spec §3.5); a word, never a fill. */
const STATUS_INK: Readonly<Record<AgentStatusWord, string>> = {
  running: 'text-state-run',
  waiting: 'text-state-need',
  done: 'text-state-done',
  failed: 'text-state-err',
  stopped: 'text-state-idle',
  queued: 'text-state-idle',
};

/** Statuses whose run time is final, so the chip can show it. */
const SETTLED: ReadonlySet<AgentStatusWord> = new Set<AgentStatusWord>([
  'done',
  'failed',
  'stopped',
]);

interface ChipView {
  readonly agent: SessionAgent;
  readonly inkClass: string;
  /** `2m 41s` for a settled run with both ends known; else `null`. */
  readonly duration: string | null;
  readonly ariaLabel: string;
  /** False when the host has no surface for this lane: status only. */
  readonly openable: boolean;
}

function durationOf(agent: SessionAgent): number | null {
  if (agent.status === null || !SETTLED.has(agent.status)) return null;
  if (agent.startedAt === null || agent.endedAt === null) return null;
  return agent.endedAt - agent.startedAt;
}

function toChipView(agent: SessionAgent, openable: boolean): ChipView {
  const durationMs = durationOf(agent);
  const label = agentAccessibleLabel({
    name: agent.name,
    kind: agent.kind,
    status: agent.status,
    durationMs,
  });
  return {
    agent,
    inkClass: agent.status ? STATUS_INK[agent.status] : '',
    duration: durationMs === null ? null : formatAgentDuration(durationMs),
    ariaLabel: openable ? `${label}. Open lane` : label,
    openable,
  };
}

/**
 * The agents of one turn as a row of chips (design-spec §3.5): avatar, name
 * and status word in state ink; a settled run adds its own duration
 * (§3.9 "each chip shows its own `done · {duration}`").
 *
 * The host passes roster entries linked to the turn (sub-agents, background
 * agents, and CLI lanes with a successful spawn tool result). Activating a chip emits
 * the agent's lane key; the host opens the lane.
 *
 * Presentational only: no timer and no service, so a running chip shows its
 * word without a ticking time.
 */
@Component({
  selector: 'ptah-turn-agent-chips',
  standalone: true,
  imports: [AgentAvatarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    @if (chips().length > 0) {
      <div
        class="mt-3 flex flex-wrap gap-2"
        role="group"
        aria-label="Agents in this turn"
        data-test="turn-agent-chips"
      >
        @for (chip of chips(); track chip.agent.key) {
          <button
            type="button"
            class="inline-flex h-[30px] min-w-0 max-w-full items-center gap-[7px] rounded-md border border-surface-border bg-surface-1 px-2.5 text-xs shadow-[inset_0_1px_0_var(--surface-highlight)] transition-colors enabled:hover:border-[var(--surface-border-strong)] enabled:hover:bg-surface-2 disabled:cursor-default"
            data-test="turn-agent-chip"
            [attr.data-agent-key]="chip.agent.key"
            [attr.aria-label]="chip.ariaLabel"
            [attr.title]="chip.agent.name"
            [disabled]="!chip.openable"
            (click)="laneRequested.emit(chip.agent.key)"
          >
            <ptah-agent-avatar
              [kind]="chip.agent.kind"
              [status]="chip.agent.status"
              [cliId]="chip.agent.cliId"
              [agentType]="chip.agent.agentType"
              [size]="24"
            />
            <span class="min-w-0 truncate font-medium">{{
              chip.agent.name
            }}</span>
            @if (chip.agent.status; as status) {
              <span [class]="'shrink-0 font-medium ' + chip.inkClass">{{
                status
              }}</span>
            }
            @if (chip.duration; as duration) {
              <span class="shrink-0 tabular-nums text-base-content-muted"
                >· {{ duration }}</span
              >
            }
          </button>
        }
      </div>
    }
  `,
})
export class TurnAgentChipsComponent {
  /** Roster entries owned by this turn, in roster order. */
  readonly agents = input<readonly SessionAgent[]>([]);

  /** Emits the `SessionAgent.key` of the chip the user activated. */
  readonly laneRequested = output<string>();

  private readonly actions = inject(SESSION_CARD_ACTIONS, { optional: true });

  protected readonly chips = computed(() =>
    this.agents().map((agent) =>
      toChipView(agent, this.actions?.canOpenLane?.(agent.key) ?? true),
    ),
  );
}
