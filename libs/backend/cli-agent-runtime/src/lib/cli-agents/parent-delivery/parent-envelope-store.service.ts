import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';

export interface ParentDeliveryEnvelope {
  readonly id: `lane-delivery:${string}`;
  readonly parentSessionId: string;
  readonly agentId: string;
  readonly kind: 'report' | 'completion';
  readonly dedupeKey: string;
  readonly body: string;
  readonly originName?: string;
  readonly createdAt: number;
  readonly state: 'pending' | 'delivered' | 'expired';
  readonly attempts: number;
  readonly lastError?: string;
}

export interface ParentEnvelopeStore {
  enqueue(envelope: Omit<ParentDeliveryEnvelope, 'state' | 'attempts'>): ParentDeliveryEnvelope | null;
  pending(parentSessionId: string): readonly ParentDeliveryEnvelope[];
  find(dedupeKey: string): ParentDeliveryEnvelope | undefined;
  markDelivered(dedupeKey: string): void;
  markFailed(dedupeKey: string, reason: string): void;
}

/** Bounded live queue. The host loses pending envelopes on restart (A2). */
@injectable()
export class ParentEnvelopeStoreService implements ParentEnvelopeStore {
  private readonly entries = new Map<string, ParentDeliveryEnvelope>();
  private static readonly maxPerParent = 32;
  private static readonly maxAgeMs = 7 * 24 * 60 * 60 * 1000;

  resolveParentSessionId(tabId: string, sessionId: string): void {
    for (const [key, envelope] of this.entries) {
      if (envelope.parentSessionId === tabId && envelope.state === 'pending') {
        this.entries.set(key, { ...envelope, parentSessionId: sessionId });
      }
    }
  }

  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  find(dedupeKey: string): ParentDeliveryEnvelope | undefined {
    this.expire();
    return this.entries.get(dedupeKey);
  }

  enqueue(input: Omit<ParentDeliveryEnvelope, 'state' | 'attempts'>): ParentDeliveryEnvelope | null {
    this.expire();
    const existing = this.entries.get(input.dedupeKey);
    if (existing) return existing;
    const siblings = [...this.entries.values()].filter(
      (item) => item.parentSessionId === input.parentSessionId && item.state === 'pending',
    );
    if (siblings.length >= ParentEnvelopeStoreService.maxPerParent) {
      const oldest = siblings.find((item) => item.kind === 'report')
        ?? (input.kind === 'completion' ? siblings[0] : undefined);
      if (!oldest) return null;
      this.entries.set(oldest.dedupeKey, { ...oldest, state: 'expired' });
      this.logger.warn('[ParentEnvelopeStore] Pending envelope evicted', {
        parentSessionId: input.parentSessionId, kind: oldest.kind,
      });
    }
    const envelope: ParentDeliveryEnvelope = { ...input, state: 'pending', attempts: 0 };
    this.entries.set(input.dedupeKey, envelope);
    return envelope;
  }

  pending(parentSessionId: string): readonly ParentDeliveryEnvelope[] {
    this.expire();
    return [...this.entries.values()].filter(
      (item) => item.parentSessionId === parentSessionId && item.state === 'pending',
    ).sort((a, b) => a.createdAt - b.createdAt);
  }

  markDelivered(dedupeKey: string): void {
    const item = this.entries.get(dedupeKey);
    if (item) this.entries.set(dedupeKey, { ...item, state: 'delivered', attempts: item.attempts + 1 });
  }

  markFailed(dedupeKey: string, reason: string): void {
    const item = this.entries.get(dedupeKey);
    if (item) this.entries.set(dedupeKey, {
      ...item, attempts: item.attempts + 1, lastError: reason,
    });
  }

  private expire(): void {
    const cutoff = Date.now() - ParentEnvelopeStoreService.maxAgeMs;
    for (const [key, item] of this.entries) {
      if (item.createdAt < cutoff) this.entries.delete(key);
    }
  }
}
