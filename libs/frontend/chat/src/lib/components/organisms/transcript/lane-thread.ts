import type { AgentDeliveryReceipt, ExecutionChatMessage } from '@ptah-extension/shared';
import type { ParentDeliveryItem } from '@ptah-extension/chat-streaming';

export interface LaneThreadEntry {
  readonly id: string;
  readonly sender: string;
  readonly kind: 'message' | 'report' | 'completion';
  readonly timestamp: number;
  readonly body: string;
  readonly receipt?: AgentDeliveryReceipt;
  readonly verdict?: string;
  /** Delivery of this report or completion to the parent; its label comes from AgentDeliveryStore. */
  readonly parentDelivery?: ParentDeliveryItem;
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
): LaneThreadEntry[] {
  const byId = new Map(receipts.map(receipt => [receipt.id, receipt]));
  // "kimi · kimi" reads as a stutter: name the CLI once when the label is the CLI.
  const laneSender = laneLabel && laneLabel.trim().toLowerCase() !== cli.trim().toLowerCase() ? `${laneLabel} · ${cli}` : cli;
  const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();
  const matched = new Set<string>();
  const entries: LaneThreadEntry[] = messages.filter(message => message.role === 'user' && message.rawContent && message.timestamp > 0).map(message => {
    const receipt = byId.get(message.id) ?? byId.get(message.id.split(':').at(-1) ?? '') ??
      (message.role === 'user' ? receipts.find(item => item.preview && !matched.has(item.id) && normalize(message.rawContent ?? '').startsWith(normalize(item.preview))) : undefined);
    if (receipt) matched.add(receipt.id);
    const sender = message.role === 'user'
      ? receipt?.sender === 'user' ? 'You' : (parentFamily ? `Parent agent · ${parentFamily}` : 'Parent agent')
      : laneSender;
    return { id: message.id, sender, kind: 'message' as const, timestamp: message.timestamp,
      body: message.rawContent ?? '', receipt };
  });
  for (const receipt of receipts) {
    if (!receipt.preview || matched.has(receipt.id)) continue;
    entries.push({ id: `receipt:${receipt.id}`, sender: receipt.sender === 'user' ? 'You' : (parentFamily ? `Parent agent · ${parentFamily}` : 'Parent agent'),
      kind: 'message', timestamp: receipt.createdAt, body: receipt.preview, receipt });
  }
  for (const event of parentDelivery.filter(event => event.kind === 'report')) {
    entries.push({ id: `report:${event.deliveryId ?? event.agentId}`, sender: laneSender,
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
    entries.push({ id: 'completion', sender: laneSender, kind: 'completion', timestamp: completion.timestamp,
      body: '', verdict, parentDelivery: delivery });
  }
  return entries.sort((a, b) => a.timestamp - b.timestamp);
}
