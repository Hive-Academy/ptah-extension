import type { AgentDeliveryReceipt, AgentMessageAckState, ExecutionChatMessage } from '@ptah-extension/shared';
import { AgentDeliveryStore, type ParentDeliveryItem } from '@ptah-extension/chat-streaming';

/** Who wrote an entry: the user, the parent agent, another lane, or the lane this thread belongs to. */
export type LaneThreadSenderKind = 'user' | 'parent' | 'peer-lane' | 'this-lane';

export interface LaneThreadEntry {
  readonly id: string;
  /** Display label; styling keys off `senderKind`, never this text. */
  readonly sender: string;
  readonly senderKind: LaneThreadSenderKind;
  /** The sending lane, for a `peer-lane` entry. */
  readonly senderAgentId?: string;
  readonly kind: 'message' | 'report' | 'completion' | 'ack';
  readonly timestamp: number;
  readonly body: string;
  readonly receipt?: AgentDeliveryReceipt;
  readonly ackState?: AgentMessageAckState;
  readonly verdict?: string;
  /** Delivery of this report or completion to the parent; its label comes from AgentDeliveryStore. */
  readonly parentDelivery?: ParentDeliveryItem;
}

/** Resolves a lane's display name from the monitor's agent list; `undefined` when unknown. */
export type LaneNameResolver = (agentId: string) => string | undefined;

type EntrySender = Pick<LaneThreadEntry, 'sender' | 'senderKind' | 'senderAgentId'>;

function inboundSender(receipt: AgentDeliveryReceipt | undefined, parentFamily: string, laneNameOf: LaneNameResolver): EntrySender {
  if (receipt?.sender === 'user') return { sender: 'You', senderKind: 'user' };
  if (receipt?.sender === 'lane') {
    const id = receipt.senderAgentId;
    if (!id) return { sender: 'From another lane', senderKind: 'peer-lane' };
    return { sender: `From lane ${laneNameOf(id)?.trim() || id}`, senderKind: 'peer-lane', senderAgentId: id };
  }
  return { sender: parentFamily ? `Parent agent · ${parentFamily}` : 'Parent agent', senderKind: 'parent' };
}

/** Receipt ids are independent of transcript ids; match user text before adding preview rows. */
export function laneThreadEntries(
  messages: readonly ExecutionChatMessage[],
  receipts: readonly AgentDeliveryReceipt[],
  parentFamily: string,
  laneLabel: string,
  cli: string,
  parentDelivery: readonly ParentDeliveryItem[] = [],
  completion?: { readonly status: string; readonly timestamp: number },
  laneNameOf: LaneNameResolver = () => undefined,
): LaneThreadEntry[] {
  const byId = new Map(receipts.map(receipt => [receipt.id, receipt]));
  // "kimi · kimi" reads as a stutter: name the CLI once when the label is the CLI.
  const laneSender = laneLabel && laneLabel.trim().toLowerCase() !== cli.trim().toLowerCase() ? `${laneLabel} · ${cli}` : cli;
  const self: EntrySender = { sender: laneSender, senderKind: 'this-lane' };
  const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();
  const matched = new Set<string>();
  const entries: LaneThreadEntry[] = messages.filter(message => message.role === 'user' && message.rawContent && message.timestamp > 0).map(message => {
    const receipt = byId.get(message.id) ?? byId.get(message.id.split(':').at(-1) ?? '') ??
      receipts.find(item => item.preview && !matched.has(item.id) && normalize(message.rawContent ?? '').startsWith(normalize(item.preview)));
    if (receipt) matched.add(receipt.id);
    return { id: message.id, ...inboundSender(receipt, parentFamily, laneNameOf), kind: 'message' as const,
      timestamp: message.timestamp, body: message.rawContent ?? '', receipt };
  });
  for (const receipt of receipts) {
    if (!receipt.preview || matched.has(receipt.id)) continue;
    entries.push({ id: `receipt:${receipt.id}`, ...inboundSender(receipt, parentFamily, laneNameOf),
      kind: 'message', timestamp: receipt.createdAt, body: receipt.preview, receipt });
  }
  for (const receipt of receipts) {
    if (
      (receipt.ackState !== 'read' && receipt.ackState !== 'acted' && receipt.ackState !== 'rejected') ||
      receipt.ackAt === undefined
    ) {
      continue;
    }
    const ackLabel = AgentDeliveryStore.ackLabel(receipt);
    if (!ackLabel) continue;
    entries.push({
      id: `ack:${receipt.id}`,
      ...self,
      kind: 'ack',
      timestamp: receipt.ackAt,
      body: ackLabel,
      ackState: receipt.ackState,
    });
  }
  for (const event of parentDelivery.filter(event => event.kind === 'report')) {
    entries.push({ id: `report:${event.deliveryId ?? event.agentId}`, ...self,
      kind: 'report', timestamp: event.createdAt ?? completion?.timestamp ?? 0, body: event.preview ?? 'Report to parent',
      parentDelivery: event });
  }
  if (completion) {
    const delivery = [...parentDelivery].reverse().find(event => event.kind === 'completion');
    const verdict = delivery?.verdict === 'delivered' ? 'Deliverables written'
      : delivery?.verdict === 'no-deliverable' ? 'No deliverable'
      : delivery?.verdict === 'failed' ? 'Failed'
      : delivery?.verdict === 'unverified' ? 'Unverified'
      : completion.status === 'failed' ? 'Failed' : 'Unverified';
    // No parent-delivery push means the state is unknown (for example a lane from an earlier
    // app run), so no parent signal is shown instead of a false "Waiting for parent".
    entries.push({ id: 'completion', ...self, kind: 'completion', timestamp: completion.timestamp,
      body: '', verdict, parentDelivery: delivery });
  }
  return entries.sort((a, b) => a.timestamp - b.timestamp);
}
