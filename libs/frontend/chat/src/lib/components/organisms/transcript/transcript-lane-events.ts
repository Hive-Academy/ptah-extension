import { parseLaneEnvelope, type ExecutionChatMessage } from '@ptah-extension/shared';
import type { LaneEventItem, LaneEventRow, LaneSlot } from '../../molecules/lane-event/lane-event-row.types';

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
