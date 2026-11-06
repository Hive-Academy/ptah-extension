import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { inject, injectable } from 'tsyringe';
import { PLATFORM_TOKENS, type IStateStorage } from '@ptah-extension/platform-core';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import type {
  LaneCompletionVerdict,
  LaneStopReason,
  ParentDeliveryState,
  ParentDeliveryView,
} from '@ptah-extension/shared';
import {
  PARENT_COMPLETION_KEYS_PREFIX,
  PARENT_COMPLETION_OUTBOX_PREFIX,
  PARENT_ENVELOPE_BODY_PREFIX,
  PARENT_ENVELOPE_INDEX_KEY,
  PARENT_TOMBSTONE_KEY,
  ParentCompletionKeySchema,
  ParentCompletionKeyShardSchema,
  ParentCompletionOutboxEntrySchema,
  ParentCompletionOutboxSchema,
  ParentEnvelopeBodySchema,
  ParentEnvelopeIndexSchema,
  ParentEnvelopeRecordSchema,
  ParentTombstoneIndexSchema,
  ParentTombstonePersistError,
  ParentTombstoneRecordSchema,
  type ParentCompletionKey,
  type ParentCompletionOutboxEntry,
  type ParentEnvelopeRecord,
  type ParentTombstonePhase,
  type ParentTombstoneRecord,
} from './parent-envelope.schema';

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const PURGED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_PENDING_REPORTS = 64;
const MAX_BODY_RECORDS = 1_024;
const MAX_TOMBSTONES = 512;

export interface ParentDeliveryEnvelope {
  readonly id: `lane-delivery:${string}`;
  readonly parentSessionId: string;
  readonly agentId: string;
  readonly kind: 'report' | 'completion';
  readonly dedupeKey: string;
  readonly body?: string;
  readonly preview?: string;
  readonly verdict?: LaneCompletionVerdict;
  readonly stopReason?: LaneStopReason;
  readonly originName?: string;
  readonly createdAt: number;
  readonly completedAt?: string;
  readonly updatedAt: number;
  readonly state: ParentDeliveryState;
  readonly attempts: number;
  readonly lastError?: string;
  readonly nextRetryAt?: number;
  readonly attemptId?: string;
  readonly everDispatched?: boolean;
  readonly bodyBytes: number;
  readonly deliveredAt?: number;
  readonly cancelledAt?: number;
  readonly waitingReason?: 'parent-offline';
  readonly removed?: true;
}

export type NewParentDeliveryEnvelope = Omit<ParentDeliveryEnvelope,
  'state' | 'attempts' | 'updatedAt' | 'bodyBytes' | 'body' | 'preview' | 'removed'
> & { readonly body: string };
export type ParentEnvelopeRefusal =
  | 'parent-inbox-full'
  | 'storage-unavailable'
  | 'parent-session-deleted';
export type ParentEnqueueResult = ParentDeliveryEnvelope | {
  readonly refused: ParentEnvelopeRefusal;
};
export type ParentMutationResult = ParentDeliveryEnvelope | {
  readonly refused: ParentEnvelopeRefusal | 'confirmation-required';
};

export interface ParentEnvelopeStore {
  enqueue(envelope: NewParentDeliveryEnvelope): Promise<ParentEnqueueResult>;
  pending(parentSessionId: string): readonly ParentDeliveryEnvelope[];
  find(dedupeKey: string): ParentDeliveryEnvelope | undefined;
  markDelivered(dedupeKey: string): Promise<ParentDeliveryEnvelope | undefined>;
  markFailed(dedupeKey: string, reason: string): Promise<ParentDeliveryEnvelope | undefined>;
}

/** Durable parent reports, completions, deletion tombstones and completion replay keys. */
@injectable()
export class ParentEnvelopeStoreService implements ParentEnvelopeStore {
  private readonly entries = new Map<string, ParentDeliveryEnvelope>();
  private readonly tombstones = new Map<string, ParentTombstoneRecord>();
  private chain: Promise<void> = Promise.resolve();
  private restorePromise?: Promise<void>;
  private restored = false;
  readonly ready: Promise<void>;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PLATFORM_TOKENS.STATE_STORAGE) private readonly storage: IStateStorage,
  ) {
    this.ready = this.restore();
    this.ready.catch((error: unknown) => {
      // Degradation: the store stays not-ready; enqueue refuses and the drainer timer retries.
      this.logger.error('[ParentEnvelopeStore] Restore failed', this.error(error));
    });
  }

  restore(): Promise<void> {
    if (this.restored) return Promise.resolve();
    if (!this.restorePromise) {
      this.restorePromise = this.performRestore().then(() => {
        this.restored = true;
      }, (error: unknown) => {
        this.restorePromise = undefined;
        throw error;
      });
    }
    return this.restorePromise;
  }

  find(dedupeKey: string): ParentDeliveryEnvelope | undefined {
    return this.entries.get(dedupeKey);
  }

  findById(id: string): ParentDeliveryEnvelope | undefined {
    return [...this.entries.values()].find((entry) => entry.id === id);
  }

  list(parentSessionId?: string): readonly ParentDeliveryEnvelope[] {
    return [...this.entries.values()]
      .filter((entry) => !parentSessionId || entry.parentSessionId === parentSessionId)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  pending(parentSessionId: string): readonly ParentDeliveryEnvelope[] {
    return this.list(parentSessionId).filter((entry) => entry.state === 'pending');
  }

  async getBody(id: string): Promise<string | undefined> {
    await this.restore();
    return this.serialize(async () => {
      await this.pruneSafelyLocked();
      const entry = this.findById(id);
      if (!entry || entry.bodyBytes === 0) return undefined;
      const parsed = ParentEnvelopeBodySchema.safeParse(
        this.storage.get<unknown>(`${PARENT_ENVELOPE_BODY_PREFIX}${id}`),
      );
      return parsed.success ? parsed.data.text : undefined;
    });
  }

  async enqueue(input: NewParentDeliveryEnvelope): Promise<ParentEnqueueResult> {
    try {
      await this.restore();
    } catch (error: unknown) {
      // Degradation: an unrestored store refuses acceptance instead of creating memory-only work.
      this.logger.error('[ParentEnvelopeStore] Restore unavailable', this.error(error));
      return { refused: 'storage-unavailable' };
    }
    return this.serialize(async () => {
      await this.pruneSafelyLocked();
      if (this.isParentFrozen(input.parentSessionId)) return { refused: 'parent-session-deleted' };
      const existing = this.entries.get(input.dedupeKey);
      if (existing) {
        if (existing.kind === 'completion') await this.finalizeCompletionLocked(existing);
        return existing;
      }
      if (input.kind === 'report') {
        const pending = this.list(input.parentSessionId).filter((entry) =>
          entry.kind === 'report' && entry.state !== 'delivered' && entry.state !== 'cancelled');
        const bodyRecords = this.list().filter((entry) => entry.bodyBytes > 0 &&
          entry.state !== 'cancelled');
        if (pending.length >= MAX_PENDING_REPORTS || bodyRecords.length >= MAX_BODY_RECORDS)
          return { refused: 'parent-inbox-full' };
      }
      const now = Date.now();
      const record = this.toRecord({
        ...input,
        state: 'pending',
        attempts: 0,
        updatedAt: now,
        bodyBytes: Buffer.byteLength(input.body, 'utf8'),
      });
      try {
        await this.writeBodyLocked(record, input.body);
        this.entries.set(record.dedupeKey, record);
        await this.persistIndexLocked();
      } catch (error: unknown) {
        // Degradation: fail closed; a written body is an orphan that restore re-indexes.
        this.entries.delete(record.dedupeKey);
        this.logger.error('[ParentEnvelopeStore] Envelope persist failed', this.error(error));
        return { refused: 'storage-unavailable' };
      }
      const accepted: ParentDeliveryEnvelope = { ...record, body: input.body };
      if (record.kind === 'completion') await this.finalizeCompletionLocked(record);
      return accepted;
    });
  }

  async markSending(id: string): Promise<ParentDeliveryEnvelope> {
    await this.restore();
    return this.serialize(async () => {
      const existing = this.requireById(id);
      if (this.isParentFrozen(existing.parentSessionId))
        throw new Error('parent-session-deleted');
      return this.replaceLocked(existing, {
        state: 'sending',
        attempts: existing.attempts + 1,
        attemptId: randomUUID(),
        everDispatched: true,
        nextRetryAt: undefined,
        waitingReason: undefined,
      });
    });
  }

  async markDelivered(dedupeKey: string): Promise<ParentDeliveryEnvelope | undefined> {
    await this.restore();
    return this.serialize(async () => {
      const existing = this.entries.get(dedupeKey);
      if (!existing) return undefined;
      const delivered = await this.replaceLocked(existing, {
        state: 'delivered', deliveredAt: Date.now(), lastError: undefined,
        nextRetryAt: undefined, waitingReason: undefined,
      });
      if (delivered.kind === 'completion') await this.finalizeCompletionLocked(delivered);
      return delivered;
    });
  }

  async markFailed(
    dedupeKey: string,
    reason: string,
  ): Promise<ParentDeliveryEnvelope | undefined> {
    return this.markBlocked(dedupeKey, reason, 5_000);
  }

  async markBlocked(
    idOrKey: string,
    reason: string,
    delayMs: number,
  ): Promise<ParentDeliveryEnvelope | undefined> {
    await this.restore();
    return this.serialize(async () => {
      const existing = this.entries.get(idOrKey) ?? this.findById(idOrKey);
      if (!existing) return undefined;
      return this.replaceLocked(existing, {
        state: 'blocked-retryable', lastError: reason,
        nextRetryAt: Date.now() + delayMs, waitingReason: undefined,
      });
    });
  }

  async markOutcomeUnknown(idOrKey: string, reason: string): Promise<ParentDeliveryEnvelope | undefined> {
    await this.restore();
    return this.serialize(async () => {
      const existing = this.entries.get(idOrKey) ?? this.findById(idOrKey);
      if (!existing) return undefined;
      return this.replaceLocked(existing, {
        state: 'outcome-unknown', lastError: reason,
        nextRetryAt: undefined, waitingReason: undefined,
      });
    });
  }

  async markWaiting(parentSessionId: string): Promise<void> {
    await this.restore();
    return this.serialize(async () => {
      for (const entry of this.list(parentSessionId)) {
        const waiting = entry.state === 'pending' && entry.waitingReason === 'parent-offline';
        if (!waiting && (entry.state === 'blocked-retryable' || entry.state === 'pending'))
          await this.replaceLocked(entry, { state: 'pending', waitingReason: 'parent-offline' });
      }
    });
  }

  async cancel(id: string): Promise<ParentMutationResult> {
    await this.restore();
    return this.serialize(async () => {
      const existing = this.findById(id);
      if (!existing) return { refused: 'storage-unavailable' };
      if (this.isParentFrozen(existing.parentSessionId))
        return { refused: 'parent-session-deleted' };
      return this.cancelLocked(existing);
    });
  }

  async retry(
    id: string,
    options: { confirmDuplicateRisk?: boolean } = {},
  ): Promise<ParentMutationResult> {
    await this.restore();
    return this.serialize(async () => {
      const existing = this.findById(id);
      if (!existing) return { refused: 'storage-unavailable' };
      if (this.isParentFrozen(existing.parentSessionId))
        return { refused: 'parent-session-deleted' };
      if (existing.state === 'outcome-unknown' && options.confirmDuplicateRisk !== true)
        return { refused: 'confirmation-required' };
      if (existing.state === 'delivered' || existing.state === 'cancelled') return existing;
      return this.replaceLocked(existing, {
        state: 'pending', nextRetryAt: undefined, lastError: undefined,
        waitingReason: undefined,
      });
    });
  }

  async resolveParentSessionId(tabId: string, sessionId: string): Promise<void> {
    await this.restore();
    return this.serialize(async () => {
      for (const entry of this.list(tabId)) {
        if (entry.state !== 'pending') continue;
        const body = ParentEnvelopeBodySchema.safeParse(
          this.storage.get<unknown>(`${PARENT_ENVELOPE_BODY_PREFIX}${entry.id}`),
        );
        if (body.success) await this.storage.update(`${PARENT_ENVELOPE_BODY_PREFIX}${entry.id}`, {
          ...body.data, parentSessionId: sessionId,
        });
        await this.replaceLocked(entry, { parentSessionId: sessionId });
      }
      await this.moveParentShardLocked(PARENT_COMPLETION_OUTBOX_PREFIX, tabId, sessionId);
      await this.moveParentShardLocked(PARENT_COMPLETION_KEYS_PREFIX, tabId, sessionId);
    });
  }

  async putCompletionOutbox(entry: ParentCompletionOutboxEntry): Promise<void> {
    await this.restore();
    return this.serialize(async () => {
      const validated = ParentCompletionOutboxEntrySchema.parse(entry);
      const entries = await this.readOutboxLocked(validated.parentSessionId);
      const next = [...entries.filter((item) => item.dedupeKey !== validated.dedupeKey), validated];
      await this.storage.update(this.outboxKey(validated.parentSessionId), {
        version: 1, entries: next,
      });
    });
  }

  async listCompletionOutbox(
    parentSessionId?: string,
  ): Promise<readonly ParentCompletionOutboxEntry[]> {
    await this.restore();
    if (parentSessionId) return this.readOutboxLocked(parentSessionId);
    const result: ParentCompletionOutboxEntry[] = [];
    for (const key of this.storage.keys()) {
      if (!key.startsWith(PARENT_COMPLETION_OUTBOX_PREFIX)) continue;
      result.push(...await this.readOutboxLocked(key.slice(PARENT_COMPLETION_OUTBOX_PREFIX.length)));
    }
    return result;
  }

  async removeCompletionOutbox(parentSessionId: string, dedupeKey: string): Promise<void> {
    await this.restore();
    return this.serialize(() => this.removeCompletionOutboxLocked(parentSessionId, dedupeKey));
  }

  async isCompletionSatisfied(parentSessionId: string, dedupeKey: string): Promise<boolean> {
    await this.restore();
    return this.serialize(async () => {
      const indexed = this.entries.get(dedupeKey);
      if (indexed?.kind === 'completion' && indexed.parentSessionId === parentSessionId) return true;
      const keys = await this.readCompletionKeysLocked(parentSessionId);
      return keys.some((entry) => entry.dedupeKey === dedupeKey);
    });
  }

  async backfillCompletionKeys(parentSessionId?: string): Promise<void> {
    await this.restore();
    return this.serialize(async () => {
      await this.pruneSafelyLocked();
      for (const entry of this.list(parentSessionId)) {
        if (entry.kind !== 'completion') continue;
        try {
          await this.writeCompletionKeyLocked(entry);
          await this.removeCompletionOutboxLocked(entry.parentSessionId, entry.dedupeKey);
          await this.pruneCompletionIndexLocked(entry);
        } catch (error: unknown) {
          // Degradation: the retained index and outbox replay the backfill on the next tick.
          this.logger.error('[ParentEnvelopeStore] Completion key backfill failed', this.error(error));
        }
      }
      await this.dropShardSatisfiedOutboxLocked(parentSessionId);
    });
  }

  async markIntent(sessionId: string): Promise<void> {
    await this.restoreForTombstone(sessionId, 'intent');
    return this.serialize(async () => {
      if (this.tombstones.has(sessionId)) return;
      this.pruneTombstonesLocked();
      while (this.tombstones.size >= MAX_TOMBSTONES) {
        const oldest = [...this.tombstones.values()].filter((entry) => entry.phase === 'purged')
          .sort((a, b) => a.updatedAt - b.updatedAt)[0];
        if (!oldest) throw new ParentTombstonePersistError(sessionId, 'intent',
          new Error('Tombstone capacity contains only pending purges.'));
        this.tombstones.delete(oldest.sessionId);
      }
      const now = Date.now();
      const record: ParentTombstoneRecord = {
        sessionId, phase: 'intent', markedAt: now, updatedAt: now,
      };
      this.tombstones.set(sessionId, record);
      try {
        await this.persistTombstonesLocked();
      } catch (error: unknown) {
        this.tombstones.delete(sessionId);
        throw new ParentTombstonePersistError(sessionId, 'intent', error);
      }
    });
  }

  async markMetadataDeleted(sessionId: string): Promise<void> {
    await this.restoreForTombstone(sessionId, 'metadata-deleted');
    return this.serialize(async () => {
      const previous = this.tombstones.get(sessionId);
      const now = Date.now();
      this.tombstones.set(sessionId, {
        sessionId, phase: 'metadata-deleted', markedAt: previous?.markedAt ?? now, updatedAt: now,
      });
      try {
        await this.persistTombstonesLocked();
      } catch (error: unknown) {
        throw new ParentTombstonePersistError(sessionId, 'metadata-deleted', error);
      }
    });
  }

  async markPurged(sessionId: string): Promise<void> {
    await this.restoreForTombstone(sessionId, 'purged');
    return this.serialize(async () => {
      const previous = this.tombstones.get(sessionId);
      const now = Date.now();
      this.tombstones.set(sessionId, {
        sessionId, phase: 'purged', markedAt: previous?.markedAt ?? now,
        updatedAt: now, purgedAt: now,
      });
      try {
        await this.persistTombstonesLocked();
      } catch (error: unknown) {
        if (previous) this.tombstones.set(sessionId, previous);
        else this.tombstones.delete(sessionId);
        throw new ParentTombstonePersistError(sessionId, 'purged', error);
      }
    });
  }

  async clearTombstone(sessionId: string): Promise<void> {
    await this.restoreForTombstone(sessionId, 'cleared');
    return this.serialize(async () => {
      const previous = this.tombstones.get(sessionId);
      this.tombstones.delete(sessionId);
      try {
        await this.persistTombstonesLocked();
      } catch (error: unknown) {
        if (previous) this.tombstones.set(sessionId, previous);
        throw new ParentTombstonePersistError(sessionId, 'cleared', error);
      }
    });
  }

  tombstonePhase(sessionId: string): ParentTombstonePhase | undefined {
    return this.tombstones.get(sessionId)?.phase;
  }

  isParentFrozen(sessionId: string): boolean {
    return this.tombstones.has(sessionId);
  }

  listPendingPurges(): readonly ParentTombstoneRecord[] {
    return [...this.tombstones.values()].filter((entry) => entry.phase !== 'purged');
  }

  async purgeUndeliveredForParent(sessionId: string): Promise<number> {
    await this.restore();
    return this.serialize(async () => {
      if (this.tombstonePhase(sessionId) !== 'metadata-deleted') {
        this.logger.error('[ParentEnvelopeStore] Purge refused before metadata deletion', {
          sessionId,
        });
        return 0;
      }
      let count = 0;
      for (const entry of this.list(sessionId)) {
        if (entry.state === 'delivered' || entry.state === 'cancelled') continue;
        await this.cancelLocked(entry);
        count++;
      }
      await this.storage.update(this.outboxKey(sessionId), undefined);
      await this.storage.update(this.completionKeysKey(sessionId), undefined);
      return count;
    });
  }

  toView(entry: ParentDeliveryEnvelope): ParentDeliveryView {
    return {
      deliveryId: entry.id,
      agentId: entry.agentId,
      parentSessionId: entry.parentSessionId,
      kind: entry.kind,
      state: entry.state,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      attempts: entry.attempts,
      ...(entry.lastError ? { lastError: entry.lastError } : {}),
      ...(entry.nextRetryAt !== undefined ? { nextRetryAt: entry.nextRetryAt } : {}),
      ...(entry.waitingReason ? { waitingReason: entry.waitingReason } : {}),
      ...(entry.everDispatched !== undefined ? { everDispatched: entry.everDispatched } : {}),
      ...(entry.preview ? { preview: entry.preview } : {}),
      ...(entry.verdict ? { verdict: entry.verdict } : {}),
      ...(entry.stopReason ? { stopReason: entry.stopReason } : {}),
    };
  }

  private async performRestore(): Promise<void> {
    this.entries.clear();
    this.tombstones.clear();
    const tombstoneIndex = ParentTombstoneIndexSchema.parse(
      this.storage.get<unknown>(PARENT_TOMBSTONE_KEY) ?? { version: 1, records: [] },
    );
    let malformedTombstones = 0;
    for (const value of tombstoneIndex.records) {
      const parsed = ParentTombstoneRecordSchema.safeParse(value);
      if (!parsed.success) malformedTombstones++;
      else this.tombstones.set(parsed.data.sessionId, parsed.data);
    }
    if (malformedTombstones > 0) {
      this.logger.error('[ParentEnvelopeStore] Dropped malformed tombstones', {
        count: malformedTombstones,
      });
      this.pruneTombstonesLocked();
      await this.persistTombstonesLocked();
    }
    const stored = this.storage.get<unknown>(PARENT_ENVELOPE_INDEX_KEY);
    const index = ParentEnvelopeIndexSchema.parse(stored ?? { version: 1, records: [] });
    let malformed = 0;
    for (const value of index.records) {
      const parsed = ParentEnvelopeRecordSchema.safeParse(value);
      if (!parsed.success) {
        malformed++;
        continue;
      }
      const restored = parsed.data.state === 'sending' ? {
        ...parsed.data,
        state: 'outcome-unknown' as const,
        lastError: 'host-restarted',
        updatedAt: Date.now(),
      } : parsed.data;
      this.entries.set(restored.dedupeKey, restored);
    }
    await this.reindexOrphansLocked();
    if (malformed > 0)
      this.logger.error('[ParentEnvelopeStore] Dropped malformed parent envelopes', { malformed });
    await this.persistIndexLocked();
    await this.pruneSafelyLocked();
    await this.backfillRestoredCompletionsLocked();
  }

  private async writeBodyLocked(record: ParentEnvelopeRecord, text: string): Promise<void> {
    await this.storage.update(`${PARENT_ENVELOPE_BODY_PREFIX}${record.id}`, {
      text,
      envelopeId: record.id,
      parentSessionId: record.parentSessionId,
      agentId: record.agentId,
      kind: record.kind,
      dedupeKey: record.dedupeKey,
      ...(record.verdict ? { verdict: record.verdict } : {}),
      ...(record.stopReason ? { stopReason: record.stopReason } : {}),
      ...(record.originName ? { originName: record.originName } : {}),
      createdAt: record.createdAt,
    });
  }

  private async pruneSafelyLocked(): Promise<void> {
    try {
      await this.pruneExpiredLocked();
    } catch (error: unknown) {
      // Degradation: retention is retried by the next store operation; nothing is lost.
      this.logger.error('[ParentEnvelopeStore] Retention pass failed', this.error(error));
    }
  }

  private async reindexOrphansLocked(): Promise<void> {
    for (const key of this.storage.keys()) {
      if (!key.startsWith(PARENT_ENVELOPE_BODY_PREFIX)) continue;
      const parsed = ParentEnvelopeBodySchema.safeParse(this.storage.get<unknown>(key));
      if (!parsed.success || this.entries.has(parsed.data.dedupeKey)) continue;
      const { text, envelopeId, ...metadata } = parsed.data;
      const record = ParentEnvelopeRecordSchema.parse({
        ...metadata,
        id: envelopeId,
        state: 'pending',
        attempts: 0,
        updatedAt: Date.now(),
        lastError: 'index-lost',
        bodyBytes: Buffer.byteLength(text, 'utf8'),
      });
      this.entries.set(record.dedupeKey, record);
    }
  }

  private async replaceLocked(
    existing: ParentDeliveryEnvelope,
    patch: Partial<ParentDeliveryEnvelope>,
  ): Promise<ParentDeliveryEnvelope> {
    const next = this.toRecord({
      ...existing,
      ...patch,
      updatedAt: Date.now(),
    });
    this.entries.set(next.dedupeKey, next);
    try {
      await this.persistIndexLocked();
    } catch (error: unknown) {
      this.entries.set(existing.dedupeKey, existing);
      throw error;
    }
    return next;
  }

  private async cancelLocked(existing: ParentDeliveryEnvelope): Promise<ParentDeliveryEnvelope> {
    let cancelled = await this.replaceLocked(existing, {
      state: 'cancelled', cancelledAt: Date.now(), nextRetryAt: undefined,
      waitingReason: undefined,
    });
    if (existing.bodyBytes > 0) {
      try {
        await this.storage.update(`${PARENT_ENVELOPE_BODY_PREFIX}${existing.id}`, undefined);
        cancelled = await this.replaceLocked(cancelled, { bodyBytes: 0 });
      } catch (error: unknown) {
        // Degradation: retention retries a body delete that failed after cancellation.
        this.logger.error('[ParentEnvelopeStore] Cancelled body delete failed', this.error(error));
      }
    }
    if (cancelled.kind === 'completion') await this.finalizeCompletionLocked(cancelled);
    return cancelled;
  }

  /** Acceptance order: durable body and index → durable shard key → outbox removal. */
  private async finalizeCompletionLocked(entry: ParentDeliveryEnvelope): Promise<void> {
    try {
      await this.writeCompletionKeyLocked(entry);
    } catch (error: unknown) {
      // Degradation: acceptance remains durable and the pinned index drives a later backfill.
      this.logger.error('[ParentEnvelopeStore] Completion key persist failed', this.error(error));
      return;
    }
    try {
      await this.removeCompletionOutboxLocked(entry.parentSessionId, entry.dedupeKey);
    } catch (error: unknown) {
      // Degradation: a durable outbox entry makes the later replay a no-op.
      this.logger.error('[ParentEnvelopeStore] Completion outbox removal failed', this.error(error));
    }
    try {
      await this.pruneCompletionIndexLocked(entry);
    } catch (error: unknown) {
      // Degradation: retention retries index pruning after delivery is already durable.
      this.logger.error('[ParentEnvelopeStore] Completion index pruning failed', this.error(error));
    }
  }

  private async writeCompletionKeyLocked(entry: ParentDeliveryEnvelope): Promise<void> {
    const keys = await this.readCompletionKeysLocked(entry.parentSessionId);
    if (keys.some((key) => key.dedupeKey === entry.dedupeKey)) return;
    const key: ParentCompletionKey = {
      dedupeKey: entry.dedupeKey,
      state: entry.state === 'cancelled' ? 'cancelled' : 'accepted',
      at: Date.now(),
    };
    await this.storage.update(this.completionKeysKey(entry.parentSessionId), {
      version: 1, keys: [...keys, key],
    });
  }

  private async readCompletionKeysLocked(parentSessionId: string): Promise<ParentCompletionKey[]> {
    const shard = ParentCompletionKeyShardSchema.parse(
      this.storage.get<unknown>(this.completionKeysKey(parentSessionId)) ?? { version: 1, keys: [] },
    );
    return shard.keys.map((value) => ParentCompletionKeySchema.parse(value));
  }

  private async readOutboxLocked(
    parentSessionId: string,
  ): Promise<ParentCompletionOutboxEntry[]> {
    const outbox = ParentCompletionOutboxSchema.parse(
      this.storage.get<unknown>(this.outboxKey(parentSessionId)) ?? { version: 1, entries: [] },
    );
    return outbox.entries.map((value) => ParentCompletionOutboxEntrySchema.parse(value));
  }

  private async removeCompletionOutboxLocked(
    parentSessionId: string,
    dedupeKey: string,
  ): Promise<void> {
    const entries = await this.readOutboxLocked(parentSessionId);
    if (!entries.some((entry) => entry.dedupeKey === dedupeKey)) return;
    await this.storage.update(this.outboxKey(parentSessionId), {
      version: 1,
      entries: entries.filter((entry) => entry.dedupeKey !== dedupeKey),
    });
  }

  /** An outbox entry whose key is already durable in the shard is a finished replay. */
  private async dropShardSatisfiedOutboxLocked(parentSessionId?: string): Promise<void> {
    const parents = parentSessionId ? [parentSessionId] : this.storage.keys()
      .filter((key) => key.startsWith(PARENT_COMPLETION_OUTBOX_PREFIX))
      .map((key) => key.slice(PARENT_COMPLETION_OUTBOX_PREFIX.length));
    for (const parent of parents) {
      try {
        const keys = new Set((await this.readCompletionKeysLocked(parent)).map((key) => key.dedupeKey));
        for (const entry of await this.readOutboxLocked(parent))
          if (keys.has(entry.dedupeKey)) await this.removeCompletionOutboxLocked(parent, entry.dedupeKey);
      } catch (error: unknown) {
        // Degradation: an unreadable shard or outbox keeps the entry for a later no-op replay.
        this.logger.error('[ParentEnvelopeStore] Completion outbox cleanup failed', this.error(error));
      }
    }
  }

  private async pruneExpiredLocked(): Promise<void> {
    const now = Date.now();
    for (const entry of this.list()) {
      if (entry.state !== 'delivered' && entry.state !== 'cancelled') continue;
      const at = entry.deliveredAt ?? entry.cancelledAt ?? entry.updatedAt;
      const expired = now - at >= RETENTION_MS;
      const completionExpired = entry.kind === 'completion' &&
        (entry.state === 'cancelled' || expired);
      if ((expired || entry.state === 'cancelled') && entry.bodyBytes > 0) {
        await this.storage.update(`${PARENT_ENVELOPE_BODY_PREFIX}${entry.id}`, undefined);
        await this.replaceLocked(entry, { bodyBytes: 0 });
      }
      if (entry.kind === 'report' && expired) {
        this.entries.delete(entry.dedupeKey);
        await this.persistIndexLocked();
      } else if (entry.kind === 'completion' && completionExpired) {
        const keys = await this.readCompletionKeysLocked(entry.parentSessionId);
        if (keys.some((key) => key.dedupeKey === entry.dedupeKey)) {
          this.entries.delete(entry.dedupeKey);
          await this.persistIndexLocked();
        }
      }
    }
  }

  private async pruneCompletionIndexLocked(entry: ParentDeliveryEnvelope): Promise<void> {
    const current = this.entries.get(entry.dedupeKey);
    if (!current || current.kind !== 'completion') return;
    const expired = current.state === 'cancelled' ||
      (current.deliveredAt !== undefined && Date.now() - current.deliveredAt >= RETENTION_MS);
    if (!expired) return;
    const keys = await this.readCompletionKeysLocked(current.parentSessionId);
    if (!keys.some((key) => key.dedupeKey === current.dedupeKey)) return;
    this.entries.delete(current.dedupeKey);
    await this.persistIndexLocked();
  }

  private async backfillRestoredCompletionsLocked(): Promise<void> {
    for (const entry of this.list()) {
      if (entry.kind !== 'completion') continue;
      try {
        await this.writeCompletionKeyLocked(entry);
        await this.removeCompletionOutboxLocked(entry.parentSessionId, entry.dedupeKey);
        await this.pruneCompletionIndexLocked(entry);
      } catch (error: unknown) {
        // Degradation: a shard outage leaves both durable dedupe sources available for retry.
        this.logger.error('[ParentEnvelopeStore] Restored completion backfill failed', this.error(error));
      }
    }
  }

  private async moveParentShardLocked(
    prefix: string,
    tabId: string,
    sessionId: string,
  ): Promise<void> {
    const oldKey = `${prefix}${tabId}`;
    const value = this.storage.get<unknown>(oldKey);
    if (value === undefined) return;
    await this.storage.update(`${prefix}${sessionId}`, value);
    await this.storage.update(oldKey, undefined);
  }

  private requireById(id: string): ParentDeliveryEnvelope {
    const existing = this.findById(id);
    if (!existing) throw new Error('Parent delivery was not found.');
    return existing;
  }

  private toRecord(entry: ParentDeliveryEnvelope): ParentEnvelopeRecord {
    const { body, preview, removed, completedAt, ...record } = entry;
    void body;
    void preview;
    void removed;
    void completedAt;
    return ParentEnvelopeRecordSchema.parse(record);
  }

  private async persistIndexLocked(): Promise<void> {
    await this.storage.update(PARENT_ENVELOPE_INDEX_KEY, {
      version: 1,
      records: this.list().map((entry) => this.toRecord(entry)),
    });
  }

  private pruneTombstonesLocked(): void {
    const cutoff = Date.now() - PURGED_RETENTION_MS;
    for (const entry of [...this.tombstones.values()])
      if (entry.phase === 'purged' && (entry.purgedAt ?? entry.updatedAt) < cutoff)
        this.tombstones.delete(entry.sessionId);
  }

  private async persistTombstonesLocked(): Promise<void> {
    await this.storage.update(PARENT_TOMBSTONE_KEY, {
      version: 1, records: [...this.tombstones.values()],
    });
  }

  private async restoreForTombstone(
    sessionId: string,
    phase: ParentTombstonePhase | 'cleared',
  ): Promise<void> {
    try {
      await this.restore();
    } catch (error: unknown) {
      throw new ParentTombstonePersistError(sessionId, phase, error);
    }
  }

  private outboxKey(parentSessionId: string): string {
    return `${PARENT_COMPLETION_OUTBOX_PREFIX}${parentSessionId}`;
  }

  private completionKeysKey(parentSessionId: string): string {
    return `${PARENT_COMPLETION_KEYS_PREFIX}${parentSessionId}`;
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.chain.then(operation);
    this.chain = result.then(() => undefined, () => undefined);
    return result;
  }

  private error(error: unknown): Error {
    return error instanceof Error ? error : new Error('Parent envelope storage operation failed');
  }
}
