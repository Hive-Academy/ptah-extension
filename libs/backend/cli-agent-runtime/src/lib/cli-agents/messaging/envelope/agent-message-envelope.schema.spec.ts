import { AGENT_MESSAGE_MAX_CHARS, AgentId } from '@ptah-extension/shared';
import {
  AgentMessageBodySchema,
  AgentMessageEnvelopeIndexSchema,
  AgentMessageEnvelopeSchema,
} from './agent-message-envelope.schema';

const MESSAGE_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const ATTEMPT_ID = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';

function record(): Record<string, unknown> {
  return {
    id: MESSAGE_ID,
    targetAgentId: AgentId.create(),
    laneLineageId: AgentId.create(),
    sender: { kind: 'user' },
    senderKey: 'user',
    state: 'not-started',
    mode: 'start-turn',
    delivery: 'queue',
    createdAt: 1,
    updatedAt: 2,
    attemptCount: 0,
  };
}

describe('AgentMessageEnvelopeSchema', () => {
  it('parses a complete envelope and brands its agent ids', () => {
    const targetAgentId = AgentId.create();
    const actualAgentId = AgentId.create();
    const laneLineageId = AgentId.create();
    const parsed = AgentMessageEnvelopeSchema.parse({
      ...record(),
      targetAgentId,
      laneLineageId,
      actualAgentId,
      parentSessionId: 'parent-1',
      idempotencyKey: 'key-1',
      state: 'dispatching',
      attemptId: ATTEMPT_ID,
      everDispatched: true,
      route: 'cold',
      allowPartialTurnLoss: true,
      terminalAt: 3,
      turnSeq: 2,
      cliSessionId: 'cli-1',
      reason: 'reason',
      lastError: 'error',
      nextRetryAt: 4,
      limit: { known: true, resetAt: 5 },
      partialTurnLost: true,
      turnOutcome: 'completed',
      bodyBytes: 10,
      ackState: 'read',
      ackAt: 6,
      ackNote: 'note',
    });

    expect(parsed).toMatchObject({
      id: MESSAGE_ID,
      targetAgentId,
      laneLineageId,
      actualAgentId,
      parentSessionId: 'parent-1',
      idempotencyKey: 'key-1',
      state: 'dispatching',
      attemptId: ATTEMPT_ID,
      everDispatched: true,
      route: 'cold',
      allowPartialTurnLoss: true,
      terminalAt: 3,
      turnSeq: 2,
      cliSessionId: 'cli-1',
      reason: 'reason',
      lastError: 'error',
      nextRetryAt: 4,
      limit: { known: true, resetAt: 5 },
      partialTurnLost: true,
      turnOutcome: 'completed',
      bodyBytes: 10,
      ackState: 'read',
      ackAt: 6,
      ackNote: 'note',
      attemptCount: 0,
    });
  });

  it('rejects unknown keys', () => {
    expect(AgentMessageEnvelopeSchema.safeParse({ ...record(), extra: true }).success).toBe(false);
  });

  it('transforms the legacy string senders', () => {
    expect(AgentMessageEnvelopeSchema.parse({ ...record(), sender: 'user' }).sender)
      .toEqual({ kind: 'user' });
    expect(AgentMessageEnvelopeSchema.parse({ ...record(), sender: 'parent' }).sender)
      .toEqual({ kind: 'parent' });
  });

  it('validates the structured sender shapes', () => {
    expect(AgentMessageEnvelopeSchema.parse({
      ...record(),
      sender: { kind: 'parent', sessionId: 'parent-1' },
    }).sender).toEqual({ kind: 'parent', sessionId: 'parent-1' });

    const lane = AgentId.create();
    expect(AgentMessageEnvelopeSchema.parse({
      ...record(),
      sender: { kind: 'lane', agentId: lane, name: 'builder', verified: true },
    }).sender).toEqual({ kind: 'lane', agentId: lane, name: 'builder', verified: true });

    expect(AgentMessageEnvelopeSchema.safeParse({
      ...record(),
      sender: { kind: 'lane', agentId: lane },
    }).success).toBe(false);
  });

  it('enforces the idempotency key charset and length', () => {
    expect(AgentMessageEnvelopeSchema.safeParse({ ...record(), idempotencyKey: 'a.b_c:d-1' }).success)
      .toBe(true);
    expect(AgentMessageEnvelopeSchema.safeParse({ ...record(), idempotencyKey: 'has space' }).success)
      .toBe(false);
    expect(AgentMessageEnvelopeSchema.safeParse({ ...record(), idempotencyKey: 'x'.repeat(129) }).success)
      .toBe(false);
    expect(AgentMessageEnvelopeSchema.safeParse({ ...record(), idempotencyKey: '' }).success)
      .toBe(false);
  });

  it('rejects invalid envelope values', () => {
    expect(AgentMessageEnvelopeSchema.safeParse({ ...record(), id: 'not-a-uuid' }).success).toBe(false);
    expect(AgentMessageEnvelopeSchema.safeParse({ ...record(), targetAgentId: 'agent-1' }).success)
      .toBe(false);
    expect(AgentMessageEnvelopeSchema.safeParse({ ...record(), state: 'unknown' }).success).toBe(false);
    expect(AgentMessageEnvelopeSchema.safeParse({ ...record(), bodyBytes: -1 }).success).toBe(false);
    expect(AgentMessageEnvelopeSchema.safeParse({ ...record(), reason: 'r'.repeat(201) }).success)
      .toBe(false);
    expect(AgentMessageEnvelopeSchema.safeParse({ ...record(), limit: { known: true, extra: 1 } }).success)
      .toBe(false);
  });
});

describe('AgentMessageEnvelopeIndexSchema', () => {
  it('accepts version 1 with opaque records', () => {
    const parsed = AgentMessageEnvelopeIndexSchema.parse({
      version: 1,
      records: [record(), { malformed: true }],
    });
    expect(parsed.records).toHaveLength(2);
  });

  it('rejects another version and unknown index keys', () => {
    expect(AgentMessageEnvelopeIndexSchema.safeParse({ version: 2, records: [] }).success).toBe(false);
    expect(AgentMessageEnvelopeIndexSchema.safeParse({ version: 1, records: [], extra: true }).success)
      .toBe(false);
  });
});

describe('AgentMessageBodySchema', () => {
  it('accepts the maximum body and rejects one more character', () => {
    const body = {
      envelopeId: MESSAGE_ID,
      targetAgentId: AgentId.create(),
      createdAt: 1,
    };
    expect(AgentMessageBodySchema.safeParse({ ...body, text: 'x'.repeat(AGENT_MESSAGE_MAX_CHARS) }).success)
      .toBe(true);
    expect(AgentMessageBodySchema.safeParse({ ...body, text: 'x'.repeat(AGENT_MESSAGE_MAX_CHARS + 1) }).success)
      .toBe(false);
  });

  it('requires a body envelope id and rejects unknown keys', () => {
    expect(AgentMessageBodySchema.safeParse({
      envelopeId: 'not-a-uuid',
      targetAgentId: AgentId.create(),
      createdAt: 1,
      text: 'body',
    }).success).toBe(false);
    expect(AgentMessageBodySchema.safeParse({
      envelopeId: MESSAGE_ID,
      targetAgentId: AgentId.create(),
      createdAt: 1,
      text: 'body',
      extra: true,
    }).success).toBe(false);
  });
});
