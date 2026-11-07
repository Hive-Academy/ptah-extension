import { randomUUID } from 'node:crypto';
import {
  AGENT_LANE_MESSAGE_MAX_CHARS,
  AGENT_MESSAGE_MAX_CHARS,
  AgentId,
} from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  AGENT_MESSAGE_BODY_PREFIX,
  AGENT_MESSAGE_ENVELOPE_INDEX_KEY,
  type AgentMessageBody,
  type AgentMessageEnvelope,
  type NewEnvelope,
} from './agent-message-envelope.schema';
import {
  AgentMessageEnvelopeStore,
  AgentMessageStorageError,
  AgentMessageValidationError,
  type AgentMessagePersistence,
} from './agent-message-envelope.store';
import { LEGACY_RECEIPT_KEY } from './legacy-receipt-migration';

const DAY = 24 * 60 * 60 * 1000;
const MAX_BODY_RECORDS = 2_048;
const MAX_UNDELIVERED = 512;
const MAX_UNDELIVERED_PER_LINEAGE = 32;

class FakeStorage implements AgentMessagePersistence {
  private readonly values = new Map<string, unknown>();
  failIndexWrites = 0;
  failBodyWrites = 0;

  get<T>(key: string): T | undefined {
    return this.values.get(key) as T | undefined;
  }

  async update(key: string, value: unknown): Promise<void> {
    if (key === AGENT_MESSAGE_ENVELOPE_INDEX_KEY && this.failIndexWrites > 0) {
      this.failIndexWrites -= 1;
      throw new Error('index write failed');
    }
    if (key.startsWith(AGENT_MESSAGE_BODY_PREFIX) && value !== undefined && this.failBodyWrites > 0) {
      this.failBodyWrites -= 1;
      throw new Error('body write failed');
    }
    if (value === undefined) this.values.delete(key);
    else this.values.set(key, value);
  }

  keys(): readonly string[] {
    return [...this.values.keys()];
  }

  seed(key: string, value: unknown): void {
    this.values.set(key, value);
  }

  has(key: string): boolean {
    return this.values.has(key);
  }
}

interface PersistedIndex {
  readonly version: 1;
  readonly records: readonly AgentMessageEnvelope[];
}

function createLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as Partial<Logger> as Logger;
}

function input(overrides: Partial<NewEnvelope> = {}): NewEnvelope {
  const targetAgentId = overrides.targetAgentId ?? AgentId.create();
  return {
    targetAgentId,
    laneLineageId: overrides.laneLineageId ?? targetAgentId,
    sender: { kind: 'parent', sessionId: 'parent-session' },
    senderKey: 'parent:parent-session',
    mode: 'start-turn',
    delivery: 'queue',
    ...overrides,
  };
}

function settledRecord(index: number): AgentMessageEnvelope {
  const agentId = AgentId.create();
  return {
    id: randomUUID(),
    targetAgentId: agentId,
    laneLineageId: agentId,
    sender: { kind: 'user' },
    senderKey: 'user',
    state: 'settled',
    mode: 'start-turn',
    delivery: 'queue',
    createdAt: index,
    updatedAt: index,
    terminalAt: index,
    attemptCount: 1,
    bodyBytes: 1,
  };
}

function undeliveredRecord(index: number): AgentMessageEnvelope {
  const agentId = AgentId.create();
  return {
    id: randomUUID(),
    targetAgentId: agentId,
    laneLineageId: agentId,
    sender: { kind: 'user' },
    senderKey: 'user',
    state: 'failed',
    mode: 'start-turn',
    delivery: 'queue',
    createdAt: index,
    updatedAt: index,
    attemptCount: 0,
    bodyBytes: 0,
  };
}

async function settle(
  store: AgentMessageEnvelopeStore,
  body: string,
  targetAgentId: AgentId = AgentId.create(),
): Promise<AgentMessageEnvelope> {
  const created = await store.put(input({ targetAgentId, laneLineageId: targetAgentId }), body);
  await store.markDispatching(created.envelope.id);
  await store.transition(created.envelope.id, { state: 'started', turnSeq: 1 });
  const settled = await store.transition(created.envelope.id, {
    state: 'settled',
    turnSeq: 1,
    turnOutcome: 'completed',
  });
  if (!settled) throw new Error('Envelope did not settle');
  return settled;
}

describe('AgentMessageEnvelopeStore', () => {
  let storage: FakeStorage;
  let now: number;

  beforeEach(() => {
    storage = new FakeStorage();
    now = 1_000_000;
  });

  function store(logger?: Logger): AgentMessageEnvelopeStore {
    return new AgentMessageEnvelopeStore(storage, undefined, () => now, logger);
  }

  it('persists a message body under its own key and reports the byte size', async () => {
    const envelopes = store();
    const { envelope } = await envelopes.put(input(), 'hello body');

    expect(envelope.bodyBytes).toBe('hello body'.length);
    expect(JSON.stringify(storage.get(AGENT_MESSAGE_ENVELOPE_INDEX_KEY)))
      .not.toContain('hello body');
    expect(storage.get<AgentMessageBody>(`${AGENT_MESSAGE_BODY_PREFIX}${envelope.id}`))
      .toMatchObject({ text: 'hello body', envelopeId: envelope.id });
    await expect(envelopes.getBody(envelope.id)).resolves.toBe('hello body');
  });

  it('collapses concurrent duplicate keys to one envelope', async () => {
    const envelopes = store();
    const target = AgentId.create();
    const request = input({
      targetAgentId: target,
      laneLineageId: target,
      idempotencyKey: 'dup-key',
    });

    const results = await Promise.all([
      envelopes.put(request, 'first'),
      envelopes.put(request, 'second'),
    ]);

    expect(results[0].envelope.id).toBe(results[1].envelope.id);
    expect(results.filter((result) => result.deduplicated)).toHaveLength(1);
    await expect(envelopes.list({})).resolves.toHaveLength(1);
  });

  it('scopes an idempotency key to its sender', async () => {
    const envelopes = store();

    const user = await envelopes.put(input({
      sender: { kind: 'user' },
      senderKey: 'user',
      idempotencyKey: 'shared-key',
    }), 'user body');
    const parent = await envelopes.put(input({
      sender: { kind: 'parent', sessionId: 'parent-2' },
      senderKey: 'parent:parent-2',
      idempotencyKey: 'shared-key',
    }), 'parent body');

    expect(user.deduplicated).toBe(false);
    expect(parent.deduplicated).toBe(false);
    expect(user.envelope.id).not.toBe(parent.envelope.id);
    await expect(envelopes.list({})).resolves.toHaveLength(2);
  });

  it('returns the original envelope when a key is retried after a resume', async () => {
    const envelopes = store();
    const addressedId = AgentId.create();
    const resumedId = AgentId.create();

    const first = await envelopes.put(input({
      targetAgentId: addressedId,
      laneLineageId: addressedId,
      idempotencyKey: 'resume-key',
    }), 'body');
    const retriedToAddressed = await envelopes.put(input({
      targetAgentId: addressedId,
      laneLineageId: addressedId,
      idempotencyKey: 'resume-key',
    }), 'body');
    const retriedToResumed = await envelopes.put(input({
      targetAgentId: resumedId,
      laneLineageId: addressedId,
      idempotencyKey: 'resume-key',
    }), 'body');

    expect(retriedToAddressed.envelope.id).toBe(first.envelope.id);
    expect(retriedToResumed.envelope.id).toBe(first.envelope.id);
    expect(retriedToResumed.envelope.targetAgentId).toBe(addressedId);
    expect(retriedToResumed.deduplicated).toBe(true);
    await expect(envelopes.list({})).resolves.toHaveLength(1);
  });

  it('refuses an idempotency key from an anonymous parent', async () => {
    const envelopes = store();
    const anonymous = input({
      sender: { kind: 'parent' },
      senderKey: 'parent:anonymous',
      idempotencyKey: 'anonymous-key',
    });

    const error = await envelopes.put(anonymous, 'body').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AgentMessageValidationError);
    if (!(error instanceof AgentMessageValidationError)) throw new Error('Expected validation error');
    expect(error.code).toBe('idempotency-key-requires-identity');
    await expect(envelopes.list({})).resolves.toHaveLength(0);

    await expect(envelopes.put(input({
      sender: { kind: 'parent' },
      senderKey: 'parent:anonymous',
    }), 'body')).resolves.toMatchObject({ deduplicated: false });
  });

  it('enforces the sender-specific body caps', async () => {
    const envelopes = store();
    const lane = AgentId.create();

    await expect(envelopes.put(input({
      sender: { kind: 'user' },
      senderKey: 'user',
    }), 'a'.repeat(AGENT_MESSAGE_MAX_CHARS))).resolves.toBeDefined();
    await expect(envelopes.put(input(), 'b'.repeat(AGENT_MESSAGE_MAX_CHARS + 1)))
      .rejects.toMatchObject({ code: 'body-too-large' });
    await expect(envelopes.put(input({
      sender: { kind: 'lane', agentId: lane, verified: true },
      senderKey: `lane:${lane}`,
    }), 'c'.repeat(AGENT_LANE_MESSAGE_MAX_CHARS))).resolves.toBeDefined();
    await expect(envelopes.put(input({
      sender: { kind: 'lane', agentId: lane, verified: true },
      senderKey: `lane:${lane}`,
    }), 'd'.repeat(AGENT_LANE_MESSAGE_MAX_CHARS + 1)))
      .rejects.toMatchObject({ code: 'body-too-large' });
  });

  it('recovers interrupted states after a restart', async () => {
    const first = store();
    const notStarted = await first.put(input({ state: 'not-started' }), 'not-started body');
    const dispatching = await first.put(input({ state: 'dispatching' }), 'dispatching body');
    const started = await first.put(input({ state: 'started', turnSeq: 1 }), 'started body');
    const blocked = await first.put(input({
      state: 'blocked-retryable',
      reason: 'lane-at-limit',
    }), 'blocked body');

    const restored = store();

    await expect(restored.get(notStarted.envelope.id)).resolves.toMatchObject({
      state: 'blocked-retryable',
      reason: 'awaiting-resume',
    });
    await expect(restored.get(dispatching.envelope.id)).resolves.toMatchObject({
      state: 'outcome-unknown',
      reason: 'dispatch-interrupted',
    });
    await expect(restored.get(started.envelope.id)).resolves.toMatchObject({
      state: 'outcome-unknown',
      reason: 'host-restarted',
    });
    await expect(restored.get(blocked.envelope.id)).resolves.toMatchObject({
      state: 'blocked-retryable',
      reason: 'lane-at-limit',
    });
    await expect(restored.getBody(blocked.envelope.id)).resolves.toBe('blocked body');
  });

  it('expires a settled body after seven days but keeps failed and expired bodies', async () => {
    const envelopes = store();
    const settled = await settle(envelopes, 'settled body');
    const failed = await envelopes.put(input({
      state: 'failed',
      reason: 'delivery-failed',
    }), 'failed body');
    const expired = await envelopes.put(input({
      state: 'expired',
      reason: 'not_found',
    }), 'expired body');

    now += 7 * DAY;

    await expect(envelopes.get(settled.id)).resolves.toBeUndefined();
    await expect(envelopes.getBody(settled.id)).resolves.toBeUndefined();
    expect(storage.has(`${AGENT_MESSAGE_BODY_PREFIX}${settled.id}`)).toBe(false);

    now += 23 * DAY;

    await expect(envelopes.get(failed.envelope.id)).resolves.toMatchObject({ state: 'failed' });
    await expect(envelopes.getBody(failed.envelope.id)).resolves.toBe('failed body');
    await expect(envelopes.get(expired.envelope.id)).resolves.toMatchObject({ state: 'expired' });
    await expect(envelopes.getBody(expired.envelope.id)).resolves.toBe('expired body');
  });

  it('keeps 300 settled bodies across a restart beyond both old caps', async () => {
    const envelopes = store();
    const bodies = new Map<string, string>();
    const terminalTimes: number[] = [];
    const base = now;

    for (let index = 0; index < 300; index += 1) {
      now = base + index * 1_000;
      const settled = await settle(envelopes, `burst-${index}`);
      bodies.set(settled.id, `burst-${index}`);
      terminalTimes.push(settled.terminalAt ?? 0);
    }

    const restored = store();
    const records = await restored.list({});
    expect(records).toHaveLength(300);
    for (const record of records)
      await expect(restored.getBody(record.id)).resolves.toBe(bodies.get(record.id));

    const firstId = records[0].id;
    now = terminalTimes[0] + 7 * DAY - 1;
    await expect(restored.get(firstId)).resolves.toBeDefined();
    now = terminalTimes[0] + 7 * DAY;
    await expect(restored.get(firstId)).resolves.toBeUndefined();

    now = Math.max(...terminalTimes) + 7 * DAY + 1;
    await expect(restored.list({})).resolves.toHaveLength(0);
  });

  it('refuses the 2,049th body-bearing message without evicting anything', async () => {
    const records = Array.from({ length: MAX_BODY_RECORDS }, (_, index) => settledRecord(index));
    storage.seed(AGENT_MESSAGE_ENVELOPE_INDEX_KEY, { version: 1, records });
    const envelopes = store();

    const error = await envelopes.put(input(), 'one body too many')
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AgentMessageStorageError);
    if (!(error instanceof AgentMessageStorageError)) throw new Error('Expected storage error');
    expect(error.code).toBe('storage-capacity');
    expect(error.nextCapacityAt).toBe((records[0].terminalAt ?? 0) + 7 * DAY);

    const kept = await envelopes.list({});
    expect(kept).toHaveLength(MAX_BODY_RECORDS);
    expect(kept.some((envelope) => envelope.id === records[0].id)).toBe(true);
  });

  it('refuses the 33rd undelivered message for one lineage', async () => {
    const envelopes = store();
    const lineage = AgentId.create();
    for (let index = 0; index < MAX_UNDELIVERED_PER_LINEAGE; index += 1)
      await envelopes.put(input({ targetAgentId: lineage, laneLineageId: lineage }), undefined);

    const error = await envelopes.put(
      input({ targetAgentId: lineage, laneLineageId: lineage }),
      undefined,
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AgentMessageStorageError);
    if (!(error instanceof AgentMessageStorageError)) throw new Error('Expected storage error');
    expect(error.code).toBe('queue-full');
    await expect(envelopes.list({})).resolves.toHaveLength(MAX_UNDELIVERED_PER_LINEAGE);
  });

  it('refuses a new message when 512 undelivered envelopes are held', async () => {
    const records = Array.from({ length: MAX_UNDELIVERED }, (_, index) => undeliveredRecord(index));
    storage.seed(AGENT_MESSAGE_ENVELOPE_INDEX_KEY, { version: 1, records });
    const envelopes = store();

    const error = await envelopes.put(input(), undefined).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AgentMessageStorageError);
    if (!(error instanceof AgentMessageStorageError)) throw new Error('Expected storage error');
    expect(error.code).toBe('queue-full');
    await expect(envelopes.list({})).resolves.toHaveLength(MAX_UNDELIVERED);
  });

  it('re-indexes a body orphaned by a failed index write as failed/index-lost', async () => {
    const envelopes = store();
    await envelopes.ready;
    storage.failIndexWrites = 1;
    const request = input();

    const error = await envelopes.put(request, 'orphan body').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AgentMessageStorageError);
    if (!(error instanceof AgentMessageStorageError)) throw new Error('Expected storage error');
    expect(error.code).toBe('storage-unavailable');
    await expect(envelopes.list({})).resolves.toHaveLength(0);

    const bodyKey = storage.keys().find((key) => key.startsWith(AGENT_MESSAGE_BODY_PREFIX));
    expect(bodyKey).toBeDefined();
    if (!bodyKey) throw new Error('Expected an orphan body key');
    const body = storage.get<AgentMessageBody>(bodyKey);
    expect(body).toBeDefined();
    if (!body) throw new Error('Expected an orphan body record');

    const restored = store();
    await expect(restored.get(body.envelopeId)).resolves.toMatchObject({
      state: 'failed',
      reason: 'index-lost',
      targetAgentId: request.targetAgentId,
    });
    await expect(restored.getBody(body.envelopeId)).resolves.toBe('orphan body');
  });

  it('drops malformed index entries and recovers their bodies', async () => {
    const first = store();
    const { envelope } = await first.put(input(), 'malformed body');
    storage.seed(AGENT_MESSAGE_ENVELOPE_INDEX_KEY, {
      version: 1,
      records: [{ id: envelope.id, broken: true }],
    });
    const logger = createLogger();

    const restored = store(logger);

    await expect(restored.get(envelope.id)).resolves.toMatchObject({
      state: 'failed',
      reason: 'index-lost',
    });
    await expect(restored.getBody(envelope.id)).resolves.toBe('malformed body');
    expect(logger.warn).toHaveBeenCalledWith(
      '[AgentMessageEnvelopeStore] Dropped malformed envelope records',
      { malformed: 1 },
    );
  });

  it('rejects markDispatching when the dispatching write fails', async () => {
    const envelopes = store();
    const { envelope } = await envelopes.put(input(), 'body');
    storage.failIndexWrites = 1;

    const error = await envelopes.markDispatching(envelope.id).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AgentMessageStorageError);
    if (!(error instanceof AgentMessageStorageError)) throw new Error('Expected storage error');
    expect(error.code).toBe('storage-unavailable');
    await expect(envelopes.get(envelope.id)).resolves.toMatchObject({
      state: 'not-started',
      attemptCount: 0,
    });
  });

  it('starts empty and keeps accepting messages when restore fails', async () => {
    const logger = createLogger();
    const locked: AgentMessagePersistence = {
      get: () => { throw new Error('locked'); },
      update: async () => undefined,
    };
    const envelopes = new AgentMessageEnvelopeStore(locked, undefined, () => now, logger);

    await expect(envelopes.list({})).resolves.toHaveLength(0);
    await expect(envelopes.put(input(), 'body')).resolves.toBeDefined();
    expect(logger.error).toHaveBeenCalledWith(
      '[AgentMessageEnvelopeStore] Restore failed',
      expect.any(Error),
    );
  });

  it('imports and clears the v1 receipts once', async () => {
    const settledId = randomUUID();
    const startedId = randomUUID();
    const agentId = AgentId.create();
    storage.seed(LEGACY_RECEIPT_KEY, [
      {
        id: settledId,
        agentId,
        state: 'settled',
        mode: 'start-turn',
        delivery: 'queue',
        sender: 'parent',
        createdAt: 10,
        updatedAt: 20,
        turnSeq: 1,
      },
      {
        id: startedId,
        agentId,
        state: 'started',
        mode: 'queue-next-turn',
        delivery: 'queue',
        sender: 'user',
        createdAt: 30,
        updatedAt: 40,
      },
    ]);

    const envelopes = store();

    await expect(envelopes.get(settledId)).resolves.toMatchObject({
      state: 'settled',
      laneLineageId: agentId,
      bodyBytes: 0,
      terminalAt: 20,
    });
    await expect(envelopes.get(startedId)).resolves.toMatchObject({
      state: 'failed',
      reason: 'host-restarted',
      bodyBytes: 0,
    });
    expect(storage.has(LEGACY_RECEIPT_KEY)).toBe(false);

    const restarted = store();
    await expect(restarted.get(settledId)).resolves.toMatchObject({ state: 'settled' });
    await expect(restarted.list({})).resolves.toHaveLength(2);
  });

  it('cancels undelivered envelopes and deletes their bodies on parent purge', async () => {
    const envelopes = store();
    const doomed = await envelopes.put(input({ parentSessionId: 'parent-1' }), 'doomed body');
    const kept = await envelopes.put(input({ parentSessionId: 'parent-2' }), 'kept body');
    const dispatched = await envelopes.put(input({
      parentSessionId: 'parent-1',
      state: 'dispatching',
    }), 'in flight');

    await expect(envelopes.purgeByParent('parent-1')).resolves.toBe(1);

    await expect(envelopes.get(doomed.envelope.id)).resolves.toMatchObject({
      state: 'cancelled',
      reason: 'parent-session-deleted',
    });
    await expect(envelopes.getBody(doomed.envelope.id)).resolves.toBeUndefined();
    await expect(envelopes.get(kept.envelope.id)).resolves.toMatchObject({ state: 'not-started' });
    await expect(envelopes.getBody(kept.envelope.id)).resolves.toBe('kept body');
    await expect(envelopes.get(dispatched.envelope.id)).resolves.toMatchObject({
      state: 'dispatching',
    });
  });

  it('fails closed with storage-unavailable when the body write fails', async () => {
    const envelopes = store();
    await envelopes.ready;
    storage.failBodyWrites = 1;

    const error = await envelopes.put(input(), 'lost body').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AgentMessageStorageError);
    if (!(error instanceof AgentMessageStorageError)) throw new Error('Expected storage error');
    expect(error.code).toBe('storage-unavailable');
    expect(error.cause).toBeInstanceOf(Error);
    await expect(envelopes.list({})).resolves.toHaveLength(0);
    expect(storage.keys().some((key) => key.startsWith(AGENT_MESSAGE_BODY_PREFIX))).toBe(false);
    await expect(envelopes.put(input(), 'next body')).resolves.toMatchObject({
      deduplicated: false,
    });
  });

  function refusal(lineage: AgentId): NewEnvelope {
    return input({
      targetAgentId: lineage,
      laneLineageId: lineage,
      state: 'failed',
      mode: 'unsupported',
      reason: 'delivery-refused',
    });
  }

  it('does not count 40 send-time refusals toward the lane queue cap', async () => {
    const envelopes = store();
    const lineage = AgentId.create();
    for (let index = 0; index < 40; index += 1)
      await envelopes.put(refusal(lineage), undefined);

    await expect(envelopes.put(
      input({ targetAgentId: lineage, laneLineageId: lineage }),
      'accepted body',
    )).resolves.toMatchObject({ envelope: { state: 'not-started' } });
    for (let index = 1; index < MAX_UNDELIVERED_PER_LINEAGE; index += 1)
      await envelopes.put(input({ targetAgentId: lineage, laneLineageId: lineage }), 'held');

    await expect(envelopes.put(refusal(lineage), undefined)).resolves.toMatchObject({
      envelope: { state: 'failed', mode: 'unsupported' },
    });
    const error = await envelopes.put(
      input({ targetAgentId: lineage, laneLineageId: lineage }),
      'one too many',
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AgentMessageStorageError);
    if (!(error instanceof AgentMessageStorageError)) throw new Error('Expected storage error');
    expect(error.code).toBe('queue-full');
  });

  it('expires send-time refusals at seven days and prunes them by the body-less count cap', async () => {
    const envelopes = store();
    const lineage = AgentId.create();
    const first = await envelopes.put(refusal(lineage), undefined);
    for (let index = 1; index < 70; index += 1) {
      now += 1;
      await envelopes.put(refusal(lineage), undefined);
    }

    const kept = await envelopes.list({ targetAgentId: lineage });
    expect(kept).toHaveLength(64);
    expect(kept.some((envelope) => envelope.id === first.envelope.id)).toBe(false);

    const held = await envelopes.put(input({ targetAgentId: lineage, laneLineageId: lineage }),
      'held body');
    now += 7 * DAY;

    await expect(envelopes.list({ targetAgentId: lineage })).resolves.toEqual([
      expect.objectContaining({ id: held.envelope.id, state: 'not-started' }),
    ]);
  });
});
