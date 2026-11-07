import type { LaneCompletionDelivery, ParentDeliveryView } from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import type { NewParentDeliveryEnvelope } from './parent-delivery/parent-envelope-store.service';
import type { ParentCompletionOutboxEntry } from './parent-delivery/parent-envelope.schema';

/** What `signal` and `replay` resolve with. */
export type LaneCompletionResult = LaneCompletionDelivery & {
  readonly recorded?: boolean;
  readonly pending?: boolean;
  readonly deliveryId?: string;
};

/** Producer-side retry entries for completions with no durable record; oldest dropped first. */
export const MAX_PENDING_COMPLETION_REPLAYS = 256;

export function completionDeliveryId(dedupeKey: string): `lane-delivery:${string}` {
  return `lane-delivery:${dedupeKey}`;
}

/** The enqueue payload is derived from the outbox entry, so a replay rebuilds the same id. */
export function completionEnqueueInput(entry: ParentCompletionOutboxEntry): NewParentDeliveryEnvelope {
  return {
    id: completionDeliveryId(entry.dedupeKey),
    dedupeKey: entry.dedupeKey,
    agentId: entry.agentId,
    parentSessionId: entry.parentSessionId,
    kind: 'completion',
    body: entry.body,
    verdict: entry.verdict,
    ...(entry.stopReason ? { stopReason: entry.stopReason } : {}),
    originName: entry.originName,
    createdAt: entry.createdAt,
    completedAt: entry.completedAt,
  };
}

/** View-only `not-saved` delivery; no store record exists for it. */
export function unsavedCompletionView(
  entry: ParentCompletionOutboxEntry,
  now: number,
): ParentDeliveryView {
  return {
    deliveryId: completionDeliveryId(entry.dedupeKey),
    agentId: entry.agentId,
    parentSessionId: entry.parentSessionId,
    kind: 'completion',
    state: 'not-saved',
    createdAt: entry.createdAt,
    updatedAt: now,
    attempts: 0,
    lastError: 'storage-unavailable',
    verdict: entry.verdict,
    ...(entry.stopReason ? { stopReason: entry.stopReason } : {}),
  };
}

/** Bounded key → entry map; insertion order is age order. */
export class PendingCompletionReplays {
  private readonly entries = new Map<string, ParentCompletionOutboxEntry>();

  constructor(
    private readonly logger: Logger,
    private readonly max = MAX_PENDING_COMPLETION_REPLAYS,
  ) {}

  get size(): number {
    return this.entries.size;
  }

  get(dedupeKey: string): ParentCompletionOutboxEntry | undefined {
    return this.entries.get(dedupeKey);
  }

  set(entry: ParentCompletionOutboxEntry): void {
    this.entries.delete(entry.dedupeKey);
    this.entries.set(entry.dedupeKey, entry);
    while (this.entries.size > this.max) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) return;
      this.entries.delete(oldest);
      this.logger.error('[LaneCompletionNotifier] Dropped an unsaved completion replay',
        new Error(`Pending completion replay capacity exceeded: ${oldest}`));
    }
  }

  delete(dedupeKey: string): void {
    this.entries.delete(dedupeKey);
  }

  values(): readonly ParentCompletionOutboxEntry[] {
    return [...this.entries.values()];
  }
}
