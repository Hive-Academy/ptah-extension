import type { AgentDeliveryReceipt, AgentMonitorParentDeliveryPayload, ExecutionChatMessage } from '@ptah-extension/shared';

export interface LaneThreadEntry {
  readonly id: string;
  readonly sender: string;
  readonly kind: 'message' | 'report' | 'completion';
  readonly timestamp: number;
  readonly body: string;
  readonly receipt?: AgentDeliveryReceipt;
  readonly verdict?: string;
  readonly parentSignal?: string;
}

/** Receipt ids are independent of transcript ids, so only an exact id joins them. */
export function laneThreadEntries(
  messages: readonly ExecutionChatMessage[],
  receipts: readonly AgentDeliveryReceipt[],
  parentFamily: string,
  laneLabel: string,
  cli: string,
  parentDelivery: readonly AgentMonitorParentDeliveryPayload[] = [],
  completion?: { readonly status: string; readonly timestamp: number },
): LaneThreadEntry[] {
  const byId = new Map(receipts.map(receipt => [receipt.id, receipt]));
  const entries: LaneThreadEntry[] = messages.filter(message => message.rawContent && message.timestamp > 0).map(message => {
    const receipt = byId.get(message.id) ?? byId.get(message.id.split(':').at(-1) ?? '');
    const sender = message.role === 'user'
      ? receipt ? 'You' : `Parent agent · ${parentFamily}`
      : `${laneLabel} · ${cli}`;
    return { id: message.id, sender, kind: 'message' as const, timestamp: message.timestamp,
      body: message.rawContent ?? '', receipt };
  });
  for (const receipt of receipts) {
    if (!receipt.preview || entries.some(entry => entry.receipt?.id === receipt.id)) continue;
    entries.push({ id: `receipt:${receipt.id}`, sender: receipt.sender === 'user' ? 'You' : `Parent agent · ${parentFamily}`,
      kind: 'message', timestamp: receipt.createdAt, body: receipt.preview, receipt });
  }
  for (const event of parentDelivery.filter(event => event.kind === 'report')) {
    entries.push({ id: `report:${event.deliveryId ?? event.agentId}`, sender: `${laneLabel} · ${cli}`,
      kind: 'report', timestamp: event.createdAt ?? completion?.timestamp ?? 0, body: event.preview ?? 'Report to parent',
      parentSignal: event.state === 'delivered' ? 'Sent to parent' : 'Waiting for parent' });
  }
  if (completion) {
    const verdict = completion.status === 'failed' ? 'Failed' : completion.status === 'completed' ? 'Deliverables written' : 'Unverified';
    const delivery = parentDelivery.find(event => event.kind === 'completion');
    entries.push({ id: 'completion', sender: `${laneLabel} · ${cli}`, kind: 'completion', timestamp: completion.timestamp,
      body: verdict, verdict, parentSignal: delivery?.state === 'delivered' ? 'Sent to parent' : 'Waiting for parent' });
  }
  return entries.sort((a, b) => a.timestamp - b.timestamp);
}
