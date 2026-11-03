import type { SessionAgent } from '@ptah-extension/chat';
import {
  formatAgentDuration,
  agentRunDurationMs,
  type AgentStatusWord,
} from '@ptah-extension/chat-ui';

/** Horizontal padding of the dock root (`px-2`). */
const DOCK_PADDING_PX = 16;
/** Flex gap between dock items (`gap-1`). */
const DOCK_GAP_PX = 4;
/** The selected pill (`max-w-[190px]`) plus the gap after it. */
export const PILL_RESERVE_PX = 190 + DOCK_GAP_PX;
/** One avatar circle (`size-8`) plus the gap after it. */
const CHIP_STEP_PX = 32 + DOCK_GAP_PX;
/** One named chip (`max-w-[140px]`) plus the gap after it. */
export const NAMED_CHIP_STEP_PX = 140 + DOCK_GAP_PX;
/**
 * One group marker: divider (`w-px`), inner `gap-1`, a 14 px icon, plus the
 * gap after it. The dock reserves two, one per group.
 */
export const GROUP_MARKER_PX = 1 + 4 + 14 + DOCK_GAP_PX;
const GROUP_MARKERS_PX = 2 * GROUP_MARKER_PX;
/** `N agents ›` at a comfortable width, and the count badge below 480 px. */
const MENU_WIDTH_PX = 120;
const MENU_WIDTH_COMPACT_PX = 44;
const COMPACT_BELOW_PX = 480;
/** Maximum number of agent chips, including the selected pill. */
export const DOCK_INLINE_MAX = 5;

/** Dock group of one agent: the pinned orchestrator, live agents, or finished ones. */
export type DockGroup = 'orchestrator' | 'active' | 'finished';

const STATUS_INK: Readonly<Record<AgentStatusWord, string>> = {
  running: 'text-state-run',
  waiting: 'text-state-need',
  failed: 'text-state-err',
  done: 'text-state-done',
  stopped: 'text-state-idle',
  queued: 'text-state-idle',
};

/**
 * Total chips that fit beside the overflow trigger and both group markers:
 * one selected pill, then avatar circles (the pinned orchestrator is a circle
 * unless it is the selection). Unknown width is safe.
 */
export function dockCapacity(width: number): number {
  if (!Number.isFinite(width)) return 1;
  const menuWidth =
    width < COMPACT_BELOW_PX ? MENU_WIDTH_COMPACT_PX : MENU_WIDTH_PX;
  const room = width - DOCK_PADDING_PX - GROUP_MARKERS_PX - menuWidth;
  if (room < PILL_RESERVE_PX) return 0;
  const circles = Math.floor((room - PILL_RESERVE_PX) / CHIP_STEP_PX);
  return Math.min(DOCK_INLINE_MAX, 1 + circles);
}

/**
 * The orchestrator is pinned. Running, waiting, queued and status-less agents
 * are active; done, stopped and failed agents are finished.
 */
export function dockGroup(agent: SessionAgent): DockGroup {
  if (agent.kind === 'orchestrator') return 'orchestrator';
  switch (agent.status) {
    case 'done':
    case 'stopped':
    case 'failed':
      return 'finished';
    default:
      return 'active';
  }
}

const GROUP_ORDER: Readonly<Record<DockGroup, number>> = {
  orchestrator: 0,
  active: 1,
  finished: 2,
};

/**
 * Orchestrator first, then active, then finished agents. Roster order is kept
 * inside each group, so a status change never reshuffles a group.
 */
export function orderDockAgents(agents: readonly SessionAgent[]): readonly SessionAgent[] {
  return agents
    .map((agent, index) => ({ agent, index, group: GROUP_ORDER[dockGroup(agent)] }))
    .sort((a, b) => a.group - b.group || a.index - b.index)
    .map(({ agent }) => agent);
}

/**
 * Partition every agent exactly once, with all chip ordering decided here.
 * At most `capacity` chips are visible, except that the orchestrator is never
 * moved to the overflow menu, so it shows even when the capacity is 0. The
 * orchestrator takes the first slot; the selected agent takes the next one
 * in its own group position. The overflow takes finished agents from the
 * end first, then active agents from the end of their group.
 */
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
  const byKey = new Map(agents.map((agent) => [agent.key, agent]));
  const selected = byKey.get(selectedKey);
  const ordered = orderDockAgents(agents);
  const pinned = ordered.find((agent) => dockGroup(agent) === 'orchestrator');
  const limit = pinned ? Math.max(1, slots) : slots;
  const kept = new Set<string>();
  if (pinned) kept.add(pinned.key);
  const keep = (key: string): void => {
    if (kept.size < limit) kept.add(key);
  };
  let visible: SessionAgent[];
  if (frozenKeys) {
    const frozenAgents = [...new Set(frozenKeys)].flatMap((key) => {
      const agent = byKey.get(key);
      return agent ? [agent] : [];
    });
    const frozen = selected && slots > 0 && !frozenAgents.includes(selected)
      ? [...frozenAgents, selected] : frozenAgents;
    // Selection and keyboard focus take priority when a resize reduces slots.
    if (selected && frozen.includes(selected)) keep(selected.key);
    if (focusedKey && frozen.some((agent) => agent.key === focusedKey)) keep(focusedKey);
    for (const agent of frozen) keep(agent.key);
    // Frozen order stays put while focus is in the dock; the orchestrator leads.
    const rest = frozen.filter((agent) => agent !== pinned && kept.has(agent.key));
    visible = pinned ? [pinned, ...rest] : rest;
  } else {
    if (selected) keep(selected.key);
    for (const agent of ordered) keep(agent.key);
    visible = ordered.filter((agent) => kept.has(agent.key));
  }
  const chosen = new Set(visible.map((agent) => agent.key));
  return { visible, hidden: orderDockAgents(agents.filter((agent) => !chosen.has(agent.key))) };
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
