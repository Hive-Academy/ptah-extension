import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import {
  AGENT_LANE_MESSAGE_MAX_CHARS,
  AGENT_MESSAGE_MAX_CHARS,
  type AgentDeliveryReceipt,
  type AgentId,
  type AgentMessageEnvelopeState,
} from '@ptah-extension/shared';
import type { IStateStorage } from '@ptah-extension/platform-core';
import type { Logger } from '@ptah-extension/vscode-core';
import type { AgentDeliveryReceiptEventSink } from '../agent-delivery-receipt-event-sink';
import {
  AGENT_MESSAGE_BODY_PREFIX,
  AGENT_MESSAGE_ENVELOPE_INDEX_KEY,
  AgentMessageBodySchema,
  AgentMessageEnvelopeIndexSchema,
  AgentMessageEnvelopeSchema,
  type AgentMessageEnvelope,
  type EnvelopePatch,
  type NewEnvelope,
} from './agent-message-envelope.schema';
import { projectAgentMessageEnvelope } from './agent-message-envelope.projection';
import { LEGACY_RECEIPT_KEY, parseLegacyReceipts } from './legacy-receipt-migration';

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_UNDELIVERED_PER_LINEAGE = 32;
const MAX_UNDELIVERED = 512;
const MAX_BODY_RECORDS = 2_048;
const MAX_BODYLESS = 256;
const MAX_BODYLESS_PER_AGENT = 64;
const UNDELIVERED = new Set<AgentMessageEnvelopeState>([
  'not-started', 'dispatching', 'blocked-retryable', 'outcome-unknown', 'failed', 'expired',
]);

export interface AgentMessagePersistence {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Promise<void>;
  keys?(): readonly string[];
}

export class AgentMessageStorageError extends Error {
  constructor(
    readonly code: 'storage-unavailable' | 'storage-capacity' | 'queue-full',
    readonly nextCapacityAt?: number,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = 'AgentMessageStorageError';
  }
}

export class AgentMessageValidationError extends Error {
  constructor(readonly code: 'body-too-large' | 'idempotency-key-requires-identity') {
    super(code);
    this.name = 'AgentMessageValidationError';
  }
}

export class AgentMessageEnvelopeStore {
  private readonly envelopes = new Map<string, AgentMessageEnvelope>();
  private chain: Promise<void> = Promise.resolve();
  readonly ready: Promise<void>;

  constructor(
    private readonly storage: AgentMessagePersistence,
    private readonly sink?: AgentDeliveryReceiptEventSink,
    private readonly clock: () => number = Date.now,
    private readonly logger?: Logger,
  ) {
    this.ready = this.restore().catch((error: unknown) => {
      // Degradation: unavailable receipt storage must not disable new live messaging.
      this.logger?.error('[AgentMessageEnvelopeStore] Restore failed', this.error(error));
      this.envelopes.clear();
    });
  }

  static fromStateStorage(
    storage: IStateStorage,
    sink?: AgentDeliveryReceiptEventSink,
    logger?: Logger,
  ): AgentMessageEnvelopeStore {
    return new AgentMessageEnvelopeStore(storage, sink, Date.now, logger);
  }

  async put(
    input: NewEnvelope,
    body: string | undefined,
  ): Promise<{ envelope: AgentMessageEnvelope; deduplicated: boolean }> {
    await this.ready;
    return this.serialize(async () => {
      await this.pruneExpiredLocked();
      const duplicate = this.findDuplicate(input);
      if (duplicate) return { envelope: duplicate, deduplicated: true };
      if (input.sender.kind === 'parent' && !('sessionId' in input.sender && input.sender.sessionId) &&
        input.idempotencyKey)
        throw new AgentMessageValidationError('idempotency-key-requires-identity');
      this.validateBody(input, body);
      this.checkCapacity(input, body !== undefined);
      const now = this.clock();
      const envelope = AgentMessageEnvelopeSchema.parse({
        ...input,
        id: input.id ?? randomUUID(),
        state: input.state ?? 'not-started',
        createdAt: input.createdAt ?? now,
        updatedAt: input.updatedAt ?? now,
        attemptCount: input.attemptCount ?? 0,
        bodyBytes: body === undefined ? 0 : Buffer.byteLength(body, 'utf8'),
      });
      if (body !== undefined) {
        await this.storage.update(`${AGENT_MESSAGE_BODY_PREFIX}${envelope.id}`, {
          text: body,
          envelopeId: envelope.id,
          targetAgentId: envelope.targetAgentId,
          ...(envelope.parentSessionId
            ? { parentSessionId: envelope.parentSessionId } : {}),
          createdAt: envelope.createdAt,
        });
      }
      const previous = this.envelopes.get(envelope.id);
      this.envelopes.set(envelope.id, envelope);
      try {
        await this.persistLocked();
      } catch (error: unknown) {
        if (previous) this.envelopes.set(envelope.id, previous);
        else this.envelopes.delete(envelope.id);
        throw new AgentMessageStorageError('storage-unavailable', undefined, { cause: error });
      }
      this.emit(envelope);
      return { envelope, deduplicated: false };
    });
  }

  async get(id: string): Promise<AgentMessageEnvelope | undefined> {
    await this.ready;
    return this.serialize(async () => {
      await this.pruneExpiredLocked();
      return this.envelopes.get(id);
    });
  }

  async getBody(id: string): Promise<string | undefined> {
    await this.ready;
    return this.serialize(async () => {
      await this.pruneExpiredLocked();
      const envelope = this.envelopes.get(id);
      if (!envelope || !envelope.bodyBytes) return undefined;
      const parsed = AgentMessageBodySchema.safeParse(
        this.storage.get<unknown>(`${AGENT_MESSAGE_BODY_PREFIX}${id}`),
      );
      return parsed.success ? parsed.data.text : undefined;
    });
  }

  async transition(
    id: string,
    patch: EnvelopePatch,
    expect?: readonly AgentMessageEnvelopeState[],
  ): Promise<AgentMessageEnvelope | undefined> {
    await this.ready;
    return this.serialize(() => this.transitionLocked(id, patch, expect, false));
  }

  async markDispatching(id: string): Promise<AgentMessageEnvelope> {
    await this.ready;
    return this.serialize(async () => {
      const existing = this.envelopes.get(id);
      if (!existing) throw new AgentMessageStorageError('storage-unavailable');
      const next = await this.transitionLocked(id, {
        state: 'dispatching',
        attemptId: randomUUID(),
        everDispatched: true,
        attemptCount: existing.attemptCount + 1,
        nextRetryAt: undefined,
      }, ['not-started', 'blocked-retryable'], true);
      if (!next || next.state !== 'dispatching')
        throw new AgentMessageStorageError('storage-unavailable');
      return next;
    });
  }

  async list(filter: {
    targetAgentId?: AgentId;
    parentSessionId?: string;
    states?: readonly AgentMessageEnvelopeState[];
  }): Promise<readonly AgentMessageEnvelope[]> {
    await this.ready;
    return this.serialize(async () => {
      await this.pruneExpiredLocked();
      return [...this.envelopes.values()].filter((envelope) =>
        (!filter.targetAgentId || envelope.targetAgentId === filter.targetAgentId) &&
        (!filter.parentSessionId || envelope.parentSessionId === filter.parentSessionId) &&
        (!filter.states || filter.states.includes(envelope.state)));
    });
  }

  async purgeByParent(parentSessionId: string): Promise<number> {
    await this.ready;
    return this.serialize(async () => {
      const targets = [...this.envelopes.values()].filter((envelope) =>
        envelope.parentSessionId === parentSessionId && UNDELIVERED.has(envelope.state) &&
        envelope.state !== 'dispatching');
      let count = 0;
      for (const envelope of targets) {
        const next = await this.transitionLocked(envelope.id, {
          state: 'cancelled', reason: 'parent-session-deleted',
        }, undefined, true);
        if (next) count++;
      }
      return count;
    });
  }

  toReceipt(envelope: AgentMessageEnvelope): AgentDeliveryReceipt {
    return projectAgentMessageEnvelope(envelope);
  }

  private async restore(): Promise<void> {
    const stored = this.storage.get<unknown>(AGENT_MESSAGE_ENVELOPE_INDEX_KEY);
    const index = AgentMessageEnvelopeIndexSchema.safeParse(stored);
    const records = index.success ? index.data.records : Array.isArray(stored) ? stored : [];
    let malformed = 0;
    for (const record of records) {
      const parsed = AgentMessageEnvelopeSchema.safeParse(record);
      if (!parsed.success) {
        malformed++;
        continue;
      }
      this.envelopes.set(parsed.data.id, this.restoredEnvelope(parsed.data));
    }
    const legacy = parseLegacyReceipts(this.storage.get<unknown>(LEGACY_RECEIPT_KEY));
    for (const envelope of legacy) this.envelopes.set(envelope.id, envelope);
    await this.reindexOrphans();
    await this.pruneExpiredLocked();
    await this.persistLocked();
    if (legacy.length > 0 || this.storage.get<unknown>(LEGACY_RECEIPT_KEY) !== undefined)
      await this.storage.update(LEGACY_RECEIPT_KEY, undefined);
    if (malformed > 0)
      this.logger?.warn('[AgentMessageEnvelopeStore] Dropped malformed envelope records', {
        malformed,
      });
  }

  private restoredEnvelope(envelope: AgentMessageEnvelope): AgentMessageEnvelope {
    const now = this.clock();
    if (envelope.state === 'not-started') return {
      ...envelope, state: 'blocked-retryable', reason: 'awaiting-resume', updatedAt: now,
    };
    if (envelope.state === 'dispatching') return {
      ...envelope, state: 'outcome-unknown', reason: 'dispatch-interrupted', updatedAt: now,
    };
    if (envelope.state === 'started') return {
      ...envelope, state: 'outcome-unknown', reason: 'host-restarted', updatedAt: now,
    };
    return envelope;
  }

  private async reindexOrphans(): Promise<void> {
    for (const key of this.storage.keys?.() ?? []) {
      if (!key.startsWith(AGENT_MESSAGE_BODY_PREFIX)) continue;
      const parsed = AgentMessageBodySchema.safeParse(this.storage.get<unknown>(key));
      if (!parsed.success || this.envelopes.has(parsed.data.envelopeId)) continue;
      const body = parsed.data;
      const now = this.clock();
      const envelope = AgentMessageEnvelopeSchema.parse({
        id: body.envelopeId,
        targetAgentId: body.targetAgentId,
        laneLineageId: body.targetAgentId,
        ...(body.parentSessionId ? { parentSessionId: body.parentSessionId } : {}),
        sender: { kind: 'user' },
        senderKey: 'user',
        state: 'failed',
        mode: 'unsupported',
        delivery: 'queue',
        reason: 'index-lost',
        createdAt: body.createdAt,
        updatedAt: now,
        attemptCount: 0,
        bodyBytes: Buffer.byteLength(body.text, 'utf8'),
      });
      this.envelopes.set(envelope.id, envelope);
    }
  }

  private findDuplicate(input: NewEnvelope): AgentMessageEnvelope | undefined {
    if (!input.idempotencyKey) return undefined;
    return [...this.envelopes.values()].find((envelope) =>
      envelope.senderKey === input.senderKey &&
      envelope.laneLineageId === input.laneLineageId &&
      envelope.idempotencyKey === input.idempotencyKey);
  }

  private validateBody(input: NewEnvelope, body: string | undefined): void {
    const cap = input.sender.kind === 'lane'
      ? AGENT_LANE_MESSAGE_MAX_CHARS
      : AGENT_MESSAGE_MAX_CHARS;
    if (body !== undefined && body.length > cap)
      throw new AgentMessageValidationError('body-too-large');
  }

  private checkCapacity(input: NewEnvelope, hasBody: boolean): void {
    if (UNDELIVERED.has(input.state ?? 'not-started')) {
      const undelivered = [...this.envelopes.values()].filter((envelope) =>
        UNDELIVERED.has(envelope.state));
      const lineage = undelivered.filter((envelope) =>
        envelope.laneLineageId === input.laneLineageId);
      if (lineage.length >= MAX_UNDELIVERED_PER_LINEAGE || undelivered.length >= MAX_UNDELIVERED)
        throw new AgentMessageStorageError('queue-full');
    }
    if (!hasBody) return;
    const bodies = [...this.envelopes.values()].filter((envelope) =>
      (envelope.bodyBytes ?? 0) > 0 &&
      (UNDELIVERED.has(envelope.state) || envelope.state === 'settled'));
    if (bodies.length < MAX_BODY_RECORDS) return;
    const nextCapacityAt = Math.min(...bodies.filter((envelope) =>
      envelope.state === 'settled' && envelope.terminalAt !== undefined)
      .map((envelope) => (envelope.terminalAt ?? 0) + RETENTION_MS));
    throw new AgentMessageStorageError(
      'storage-capacity', Number.isFinite(nextCapacityAt) ? nextCapacityAt : undefined,
    );
  }

  private async transitionLocked(
    id: string,
    patch: EnvelopePatch,
    expect: readonly AgentMessageEnvelopeState[] | undefined,
    strict: boolean,
  ): Promise<AgentMessageEnvelope | undefined> {
    await this.pruneExpiredLocked();
    const existing = this.envelopes.get(id);
    if (!existing) return undefined;
    if (expect && !expect.includes(existing.state)) {
      this.logger?.debug('[AgentMessageEnvelopeStore] Ignored unexpected transition', {
        id, state: existing.state,
      });
      return existing;
    }
    if (existing.state === 'settled' || existing.state === 'cancelled') return existing;
    const state = patch.state ?? existing.state;
    if (state === 'started' && !(patch.turnSeq ?? existing.turnSeq))
      throw new Error('A started envelope requires turnSeq.');
    if (state === 'settled' &&
      (existing.state !== 'started' || existing.turnSeq !== (patch.turnSeq ?? existing.turnSeq)))
      throw new Error('An envelope settles only its started turn.');
    const now = this.clock();
    const next = AgentMessageEnvelopeSchema.parse({
      ...existing,
      ...patch,
      updatedAt: now,
      ...((state === 'settled' || state === 'cancelled') && !patch.terminalAt
        ? { terminalAt: now } : {}),
    });
    try {
      await this.persistReplacementLocked(next);
    } catch (error: unknown) {
      if (strict) throw new AgentMessageStorageError('storage-unavailable', undefined, {
        cause: error,
      });
      this.logger?.error('[AgentMessageEnvelopeStore] Transition persist failed; retrying once',
        this.error(error));
      try {
        await this.persistReplacementLocked(next);
      } catch (retryError: unknown) {
        // Degradation: memory rolls back to disk when both transition writes fail.
        this.logger?.error('[AgentMessageEnvelopeStore] Transition rolled back',
          this.error(retryError));
        return existing;
      }
    }
    if (next.state === 'cancelled' && (existing.bodyBytes ?? 0) > 0) {
      try {
        await this.storage.update(`${AGENT_MESSAGE_BODY_PREFIX}${id}`, undefined);
        const withoutBody = { ...next, bodyBytes: 0 };
        await this.persistReplacementLocked(withoutBody);
        this.emit(withoutBody);
        return withoutBody;
      } catch (error: unknown) {
        // Degradation: a cancelled body delete is retried by a later retention pass.
        this.logger?.error('[AgentMessageEnvelopeStore] Cancelled body delete failed',
          this.error(error));
      }
    }
    this.emit(next);
    return next;
  }

  private async persistReplacementLocked(next: AgentMessageEnvelope): Promise<void> {
    const previous = this.envelopes.get(next.id);
    this.envelopes.set(next.id, next);
    try {
      await this.persistLocked();
    } catch (error: unknown) {
      if (previous) this.envelopes.set(next.id, previous);
      else this.envelopes.delete(next.id);
      throw error;
    }
  }

  private async pruneExpiredLocked(): Promise<void> {
    const now = this.clock();
    let changed = false;
    for (const [id, envelope] of [...this.envelopes]) {
      const expiry = envelope.terminalAt === undefined ? undefined : envelope.terminalAt + RETENTION_MS;
      if (envelope.state === 'cancelled' && (envelope.bodyBytes ?? 0) > 0) {
        await this.storage.update(`${AGENT_MESSAGE_BODY_PREFIX}${id}`, undefined);
        this.envelopes.set(id, { ...envelope, bodyBytes: 0 });
        changed = true;
      }
      if (expiry !== undefined && now >= expiry &&
        (envelope.state === 'settled' || envelope.state === 'cancelled')) {
        if ((envelope.bodyBytes ?? 0) > 0)
          await this.storage.update(`${AGENT_MESSAGE_BODY_PREFIX}${id}`, undefined);
        this.envelopes.delete(id);
        changed = true;
      }
    }
    const bodyless = [...this.envelopes.values()].filter((envelope) =>
      (envelope.bodyBytes ?? 0) === 0 && envelope.state === 'cancelled');
    const remove = new Set<string>();
    const global = bodyless.sort((a, b) => b.updatedAt - a.updatedAt);
    for (const envelope of global.slice(MAX_BODYLESS)) remove.add(envelope.id);
    const agents = new Set(bodyless.map((envelope) => envelope.targetAgentId));
    for (const agentId of agents) {
      const records = bodyless.filter((envelope) => envelope.targetAgentId === agentId)
        .sort((a, b) => b.updatedAt - a.updatedAt);
      for (const envelope of records.slice(MAX_BODYLESS_PER_AGENT)) remove.add(envelope.id);
    }
    for (const id of remove) {
      this.envelopes.delete(id);
      changed = true;
    }
    if (changed) await this.persistLocked();
  }

  private async persistLocked(): Promise<void> {
    await this.storage.update(AGENT_MESSAGE_ENVELOPE_INDEX_KEY, {
      version: 1,
      records: [...this.envelopes.values()],
    });
  }

  private emit(envelope: AgentMessageEnvelope): void {
    try {
      this.sink?.changed(this.toReceipt(envelope));
    } catch (error: unknown) {
      // Degradation: a push sink cannot reverse a durable envelope transition.
      this.logger?.error('[AgentMessageEnvelopeStore] Receipt sink failed', this.error(error));
    }
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.chain.then(operation);
    this.chain = result.then(() => undefined, () => undefined);
    return result;
  }

  private error(error: unknown): Error {
    return error instanceof Error ? error : new Error('Agent message storage operation failed');
  }
}
