import type { AgentDeliveryReceipt } from '@ptah-extension/shared';

/** Push port kept stable while durable envelope storage replaces receipt storage. */
export interface AgentDeliveryReceiptEventSink {
  changed(receipt: AgentDeliveryReceipt): void;
}
