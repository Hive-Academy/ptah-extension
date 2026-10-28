import { parseLaneEnvelope, type ExecutionChatMessage, type LaneEnvelopeKind } from '@ptah-extension/shared';

export interface LaneEventItem {
  readonly kind: LaneEnvelopeKind;
  readonly status?: string;
  readonly verdict?: string;
  readonly body: string;
  readonly timestamp: number;
  readonly messageId: string;
  readonly files?: readonly string[];
  readonly imageCount?: number;
}

export interface LaneEventRow {
  readonly rowKey: string;
  readonly agentId: string;
  readonly agent: string;
  readonly cli: string;
  readonly peerLabel: string;
  readonly events: readonly LaneEventItem[];
  readonly earlier: readonly LaneEventItem[];
  readonly liveLane: boolean;
}

export type LaneSlot =
  | { readonly kind: 'row'; readonly row: LaneEventRow }
  | { readonly kind: 'merged'; readonly rowKey: string };

/** Preserves each message's slot while merging only within a contiguous envelope run. */
export function groupLaneEvents(
  messages: readonly ExecutionChatMessage[],
  liveAgentIds: ReadonlySet<string>,
): ReadonlyMap<string, LaneSlot> {
  const slots = new Map<string, LaneSlot>();
  const earlierByAgent = new Map<string, LaneEventItem[]>();
  const run = new Map<string, { row: LaneEventRow; events: LaneEventItem[] }>();
  for (const message of messages) {
    const envelope = message.inboundPeer
      ? parseLaneEnvelope(message.rawContent ?? '')
      : null;
    if (!envelope) {
      run.clear();
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
    const existing = run.get(envelope.agentId);
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
      run.set(envelope.agentId, { row, events });
      slots.set(message.id, { kind: 'row', row });
    }
    const previous = earlierByAgent.get(envelope.agentId);
    if (previous) previous.push(event);
    else earlierByAgent.set(envelope.agentId, [event]);
  }
  return slots;
}
