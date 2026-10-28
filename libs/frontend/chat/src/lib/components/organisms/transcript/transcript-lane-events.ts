import { parseLaneEnvelope, type ExecutionChatMessage } from '@ptah-extension/shared';
import type { LaneEventItem, LaneEventRow, LaneSlot } from '../../molecules/lane-event/lane-event-row.types';
import type { LaneEventMetrics } from '../../molecules/lane-event/lane-event-row.presentation';

export interface LaneMonitorSnapshot extends LaneEventMetrics {
  readonly agentId: string;
  readonly status: string;
  readonly startedAt: number;
  readonly completedAt?: number;
}

export function sameLaneMonitorSnapshot(a: LaneMonitorSnapshot, b: LaneMonitorSnapshot): boolean {
  return a.agentId === b.agentId && a.status === b.status && a.startedAt === b.startedAt && a.completedAt === b.completedAt &&
    a.model === b.model && a.usageTotals?.model === b.usageTotals?.model &&
    a.usageTotals?.totalTokens === b.usageTotals?.totalTokens &&
    a.usageTotals?.inputTokens === b.usageTotals?.inputTokens &&
    a.usageTotals?.outputTokens === b.usageTotals?.outputTokens &&
    a.usageTotals?.costUsd === b.usageTotals?.costUsd;
}

export function laneMetricsForRow(
  row: LaneEventRow,
  newest: ReadonlyMap<string, string>,
  monitor: LaneMonitorSnapshot | undefined,
): LaneEventMetrics | null {
  if (!monitor || monitor.agentId !== row.agentId || newest.get(row.agentId) !== row.rowKey) return null;
  const last = row.events.at(-1);
  if (!last || monitor.startedAt > last.timestamp) return null;
  const completion = row.events.filter(event => event.kind === 'completed').at(-1);
  if (completion && (monitor.status === 'running' ||
    (monitor.completedAt !== undefined && Math.abs(monitor.completedAt - completion.timestamp) > 60_000))) return null;
  return monitor;
}

/** Preserves each message's slot while merging only within a contiguous envelope run. */
export function groupLaneEvents(
  messages: readonly ExecutionChatMessage[],
  liveAgentIds: ReadonlySet<string>,
): ReadonlyMap<string, LaneSlot> {
  const slots = new Map<string, LaneSlot>();
  const earlierByAgent = new Map<string, LaneEventItem[]>();
  let previousRow: { row: LaneEventRow; events: LaneEventItem[] } | undefined;
  for (const message of messages) {
    const envelope = message.inboundPeer
      ? parseLaneEnvelope(message.rawContent ?? '')
      : null;
    if (!envelope) {
      previousRow = undefined;
      continue;
    }
    const event: LaneEventItem = {
      kind: envelope.kind,
      status: envelope.status,
      verdict: envelope.verdict,
      body: envelope.body,
      timestamp: message.timestamp,
      messageId: message.id,
      files: message.files,
      imageCount: message.imageCount,
    };
    const existing = previousRow?.row.agentId === envelope.agentId ? previousRow : undefined;
    if (existing) {
      existing.events.push(event);
      slots.set(message.id, { kind: 'merged', rowKey: existing.row.rowKey });
    } else {
      const events = [event];
      const row: LaneEventRow = {
        rowKey: message.id,
        agentId: envelope.agentId,
        agent: envelope.agent,
        cli: envelope.cli,
        peerLabel: message.inboundPeer?.label.trim() || 'peer session',
        events,
        earlier: earlierByAgent.get(envelope.agentId)?.slice() ?? [],
        liveLane: liveAgentIds.has(envelope.agentId),
      };
      previousRow = { row, events };
      slots.set(message.id, { kind: 'row', row });
    }
    const previous = earlierByAgent.get(envelope.agentId);
    if (previous) previous.push(event);
    else earlierByAgent.set(envelope.agentId, [event]);
  }
  return slots;
}

/** The final visible row for each agent owns its cumulative monitor totals. */
export function newestLaneRowKeys(slots: ReadonlyMap<string, LaneSlot>): ReadonlyMap<string, string> {
  const keys = new Map<string, string>();
  for (const slot of slots.values()) {
    if (slot.kind === 'row') keys.set(slot.row.agentId, slot.row.rowKey);
  }
  return keys;
}
