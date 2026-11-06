import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import type { LaneCompletionVerdict, LaneStopReason } from '@ptah-extension/shared';

export interface ParentDeliveryEnvelope {
  readonly id: `lane-delivery:${string}`;
  readonly parentSessionId: string;
  readonly agentId: string;
  readonly kind: 'report' | 'completion';
  readonly dedupeKey: string;
  readonly body: string;
  readonly verdict?: LaneCompletionVerdict;
  readonly stopReason?: LaneStopReason;
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
  private onExpired?: (envelope: ParentDeliveryEnvelope) => void;

  setExpirationSink(sink: (envelope: ParentDeliveryEnvelope) => void): void {
    this.onExpired = sink;
  }

  resolveParentSessionId(tabId: string, sessionId: string): void {
    for (const [key, envelope] of this.entries) {
      if (envelope.parentSessionId === tabId && envelope.state === 'pending') {
        const siblings = this.pending(sessionId);
        if (siblings.length >= ParentEnvelopeStoreService.maxPerParent) {
          const oldest = siblings.find((item) => item.kind === 'report')
            ?? (envelope.kind === 'completion' ? siblings[0] : undefined);
          if (!oldest) {
            this.markExpired(envelope);
            continue;
          }
          this.markExpired(oldest);
          this.logger.warn('[ParentEnvelopeStore] Pending envelope evicted on re-key', {
            parentSessionId: sessionId, kind: oldest.kind,
          });
        }
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
      this.markExpired(oldest);
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
      if (item.createdAt < cutoff && item.state === 'pending') this.markExpired(item);
      if (item.createdAt < cutoff && item.state === 'delivered') this.entries.delete(key);
      if (item.createdAt < cutoff - ParentEnvelopeStoreService.maxAgeMs && item.state === 'expired')
        this.entries.delete(key);
    }
  }

  private markExpired(item: ParentDeliveryEnvelope): void {
    const expired = { ...item, state: 'expired' as const, lastError: 'delivery-expired' };
    this.entries.set(item.dedupeKey, expired);
    this.logger.warn('[ParentEnvelopeStore] Pending envelope expired', {
      parentSessionId: item.parentSessionId, kind: item.kind,
    });
    this.onExpired?.(expired);
  }
}
