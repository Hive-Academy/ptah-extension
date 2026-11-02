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
/** One avatar chip (28 px) plus the gap before the next. */
const CHIP_STEP_PX = 30;
/** `N agents ›` at a comfortable width, and the count badge below 480 px. */
const MENU_WIDTH_PX = 112;
const MENU_WIDTH_COMPACT_PX = 44;
const COMPACT_BELOW_PX = 480;
/** Maximum number of agent chips, including the selected pill. */
export const DOCK_INLINE_MAX = 5;

const STATUS_INK: Readonly<Record<AgentStatusWord, string>> = {
  running: 'text-state-run',
  waiting: 'text-state-need',
  failed: 'text-state-err',
  done: 'text-state-done',
  stopped: 'text-state-idle',
  queued: 'text-state-idle',
};

/** Total chips that fit beside the overflow trigger. Unknown width is safe. */
export function dockCapacity(width: number): number {
  if (!Number.isFinite(width)) return 1;
  const menuWidth =
    width < COMPACT_BELOW_PX ? MENU_WIDTH_COMPACT_PX : MENU_WIDTH_PX;
  const spare = width - DOCK_PADDING_PX - PILL_RESERVE_PX - menuWidth;
  if (spare < 0) return 0;
  return Math.min(DOCK_INLINE_MAX, 1 + Math.floor(spare / CHIP_STEP_PX));
}

function chipRank(agent: SessionAgent): number {
  return menuRank(agent);
}

/** Menu status order. Agents with no status sit beside queued agents. */
function menuRank(agent: SessionAgent): number {
  switch (agent.status) {
    case 'running': return 0;
    case 'waiting': return 1;
    case 'failed': return 2;
    case 'queued': return 3;
    case 'done': return 4;
    case 'stopped': return 5;
    default: return 3;
  }
}

/** Every menu entry, sorted by status with dock order preserved within a status. */
export function orderDockMenuAgents(agents: readonly SessionAgent[]): readonly SessionAgent[] {
  return agents
    .map((agent, index) => ({ agent, index }))
    .sort((a, b) => menuRank(a.agent) - menuRank(b.agent) || a.index - b.index)
    .map(({ agent }) => agent);
}

/** Partition every agent exactly once, with all chip ordering decided here. */
export function planDockOverflow(
  agents: readonly SessionAgent[],
  selectedKey: string,
  capacity: number,
  frozenKeys?: readonly string[] | null,
  focusedKey?: string | null,
): { visible: readonly SessionAgent[]; hidden: readonly SessionAgent[] } {
  const slots = Number.isFinite(capacity)
    ? Math.min(DOCK_INLINE_MAX, Math.max(0, Math.floor(capacity)))
    : 1;
  const roster = agents.map((agent, index) => ({ agent, index }));
  const byKey = new Map(agents.map((agent) => [agent.key, agent]));
  const selected = byKey.get(selectedKey);
  const ordered = roster
    .sort((a, b) => chipRank(a.agent) - chipRank(b.agent) || a.index - b.index)
    .map(({ agent }) => agent);
  if (selected && selected.status !== 'running') {
    ordered.splice(ordered.indexOf(selected), 1);
    ordered.unshift(selected);
  }
  let visible: SessionAgent[];
  if (frozenKeys) {
    const frozenAgents = [...new Set(frozenKeys)].flatMap((key) => {
      const agent = byKey.get(key);
      return agent ? [agent] : [];
    });
    const frozen = selected && slots > 0 && !frozenAgents.includes(selected)
      ? [...frozenAgents, selected] : frozenAgents;
    const kept = new Set<string>();
    // Selection and keyboard focus take priority when a resize reduces slots.
    if (selected && frozen.includes(selected)) kept.add(selected.key);
    if (focusedKey && frozen.some((agent) => agent.key === focusedKey) && kept.size < slots) {
      kept.add(focusedKey);
    }
    for (const agent of frozen) {
      if (kept.size >= slots) break;
      kept.add(agent.key);
    }
    visible = frozen.filter((agent) => kept.has(agent.key)).slice(0, slots);
  } else {
    // Reserve a slot for selection even when it is late in the running roster.
    const kept = new Set<string>();
    if (selected && slots > 0) kept.add(selected.key);
    for (const agent of ordered) {
      if (kept.size >= slots) break;
      kept.add(agent.key);
    }
    visible = ordered.filter((agent) => kept.has(agent.key));
  }
  const chosen = new Set(visible.map((agent) => agent.key));
  return { visible, hidden: agents.filter((agent) => !chosen.has(agent.key)) };
}

/** Running time is `now - startedAt`; a finished run is `endedAt - startedAt`. */
export function agentDurationMs(
  agent: SessionAgent,
  now: number,
): number | null {
  return agentRunDurationMs(
    {
      running: agent.status === 'running',
      startedAt: agent.startedAt,
      endedAt: agent.endedAt,
    },
    now,
  );
}

/** Display text for a run, or `null` when there is nothing to show. */
export function agentDurationText(
  agent: SessionAgent,
  now: number,
): string | null {
  const ms = agentDurationMs(agent, now);
  return ms === null ? null : formatAgentDuration(ms);
}

/** State-ink class for a status word. Empty when the agent has no word. */
export function agentStatusInk(status: AgentStatusWord | null): string {
  return status === null ? '' : STATUS_INK[status];
}
