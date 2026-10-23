import type { SessionAgent } from '@ptah-extension/chat';
import {
  formatAgentDuration,
  agentRunDurationMs,
  type AgentStatusWord,
} from '@ptah-extension/chat-ui';

/** Horizontal padding of the dock root (`px-2`). */
const DOCK_PADDING_PX = 16;
/** Width reserved for the selected pill (`max-w-[180px]`). */
const PILL_RESERVE_PX = 180;
/** Width reserved for the group rules between the four kinds. */
const DIVIDERS_PX = 27;
/** One avatar chip (38 px) plus the gap before the next. */
const CHIP_STEP_PX = 40;
/** `N agents ›` at a comfortable width, and the count badge below 480 px. */
const MENU_WIDTH_PX = 112;
const MENU_WIDTH_COMPACT_PX = 44;
const COMPACT_BELOW_PX = 480;

const STATUS_INK: Readonly<Record<AgentStatusWord, string>> = {
  running: 'text-state-run',
  waiting: 'text-state-need',
  failed: 'text-state-err',
  done: 'text-state-done',
  stopped: 'text-state-idle',
  queued: 'text-state-idle',
};

/**
 * How many avatar chips fit beside the selected pill and the menu.
 * A non-finite width (no `ResizeObserver`, or before the first measurement)
 * fits every agent. Zero width yields `0`: the pill and the menu only.
 * 400 px -> 3, 760 px -> 10.
 */
export function dockCapacity(width: number): number {
  if (!Number.isFinite(width)) return Number.POSITIVE_INFINITY;
  const menuWidth = width < COMPACT_BELOW_PX ? MENU_WIDTH_COMPACT_PX : MENU_WIDTH_PX;
  const raw = Math.floor(
    (width - DOCK_PADDING_PX - PILL_RESERVE_PX - menuWidth - DIVIDERS_PX) /
      CHIP_STEP_PX,
  );
  return Math.max(0, raw);
}

/**
 * Rank for a slot: Orchestrator, then the selected agent, then `waiting`,
 * `failed`, `running`, then everyone else. Ties keep dock order.
 */
function overflowRank(agent: SessionAgent, selectedKey: string): number {
  if (agent.kind === 'orchestrator') return 0;
  if (agent.key === selectedKey) return 1;
  switch (agent.status) {
    case 'waiting':
      return 2;
    case 'failed':
      return 3;
    case 'running':
      return 4;
    default:
      return 5;
  }
}

/**
 * Rosters of five or fewer stay inline. Larger rosters fill `capacity + 1` slots (the extra slot is the pill) by
 * rank, then both lists are returned in dock order. A worse rank is never
 * visible while a better rank is hidden.
 */
export function planDockOverflow(
  agents: readonly SessionAgent[],
  selectedKey: string,
  capacity: number,
): { visible: readonly SessionAgent[]; hidden: readonly SessionAgent[] } {
  if (agents.length <= 5 || !Number.isFinite(capacity)) return { visible: agents, hidden: [] };
  const slots = Math.max(0, Math.floor(capacity)) + 1;
  const chosen = new Set(
    agents
      .map((agent, index) => ({ agent, index, rank: overflowRank(agent, selectedKey) }))
      .sort((a, b) => a.rank - b.rank || a.index - b.index)
      .slice(0, Math.min(slots, agents.length))
      .map((row) => row.agent.key),
  );
  const visible: SessionAgent[] = [];
  const hidden: SessionAgent[] = [];
  for (const agent of agents) {
    if (chosen.has(agent.key)) visible.push(agent);
    else hidden.push(agent);
  }
  return { visible, hidden };
}

/** Running time is `now - startedAt`; a finished run is `endedAt - startedAt`. */
export function agentDurationMs(agent: SessionAgent, now: number): number | null {
  return agentRunDurationMs({
    running: agent.status === 'running',
    startedAt: agent.startedAt,
    endedAt: agent.endedAt,
  }, now);
}

/** Display text for a run, or `null` when there is nothing to show. */
export function agentDurationText(agent: SessionAgent, now: number): string | null {
  const ms = agentDurationMs(agent, now);
  return ms === null ? null : formatAgentDuration(ms);
}

/** State-ink class for a status word. Empty when the agent has no word. */
export function agentStatusInk(status: AgentStatusWord | null): string {
  return status === null ? '' : STATUS_INK[status];
}
