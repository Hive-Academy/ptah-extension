import { randomUUID } from 'node:crypto';
import { AgentId } from '@ptah-extension/shared';
import type { AgentMessageEnvelope } from './agent-message-envelope.schema';
import { projectAgentMessageEnvelope } from './agent-message-envelope.projection';

function envelope(overrides: Partial<AgentMessageEnvelope> = {}): AgentMessageEnvelope {
  const agentId = overrides.targetAgentId ?? AgentId.create();
  return {
    id: randomUUID(),
    targetAgentId: agentId,
    laneLineageId: overrides.laneLineageId ?? agentId,
    sender: { kind: 'user' },
    senderKey: 'user',
    state: 'not-started',
    mode: 'start-turn',
    delivery: 'queue',
    createdAt: 1,
    updatedAt: 2,
    attemptCount: 0,
    ...overrides,
  };
}

describe('projectAgentMessageEnvelope', () => {
  it('projects an undelivered envelope as accepted', () => {
    const source = envelope();
    expect(projectAgentMessageEnvelope(source)).toMatchObject({
      id: source.id,
      agentId: source.targetAgentId,
      state: 'accepted',
      sender: 'user',
      mode: 'start-turn',
      delivery: 'queue',
      createdAt: 1,
      updatedAt: 2,
      attemptCount: 0,
      hasRecoverableBody: false,
    });
  });

  it('keeps the interrupted-undelivered failure distinct', () => {
    expect(projectAgentMessageEnvelope(envelope({
      state: 'failed',
      reason: 'interrupted-undelivered',
    }))).toMatchObject({ state: 'interrupted-undelivered' });

    expect(projectAgentMessageEnvelope(envelope({ state: 'failed', reason: 'delivery-failed' })))
      .toMatchObject({ state: 'failed', reason: 'delivery-failed' });
  });

  it('flattens a lane sender and its verified flag', () => {
    const senderAgentId = AgentId.create();
    expect(projectAgentMessageEnvelope(envelope({
      sender: { kind: 'lane', agentId: senderAgentId, name: 'builder', verified: true },
    }))).toMatchObject({
      sender: 'lane',
      senderAgentId,
      senderVerified: true,
    });
  });

  it('flattens a parent sender session and omits it for an anonymous parent', () => {
    expect(projectAgentMessageEnvelope(envelope({
      sender: { kind: 'parent', sessionId: 'parent-1' },
    }))).toMatchObject({ sender: 'parent', senderSessionId: 'parent-1' });

    const anonymous = projectAgentMessageEnvelope(envelope({ sender: { kind: 'parent' } }));
    expect(anonymous.sender).toBe('parent');
    expect(anonymous).not.toHaveProperty('senderSessionId');
    expect(anonymous).not.toHaveProperty('senderAgentId');
    expect(anonymous).not.toHaveProperty('senderVerified');
  });

  it('carries every optional envelope field without inventing absent ones', () => {
    const actualAgentId = AgentId.create();
    const source = envelope({
      actualAgentId,
      state: 'blocked-retryable',
      parentSessionId: 'parent-1',
      turnSeq: 2,
      cliSessionId: 'cli-1',
      reason: 'lane-at-limit',
      partialTurnLost: true,
      turnOutcome: 'failed',
      everDispatched: true,
      lastError: 'boom',
      nextRetryAt: 9,
      limit: { known: true, resetAt: 10 },
      bodyBytes: 5,
      attemptCount: 3,
      ackState: 'acted',
      ackAt: 11,
      ackNote: 'done',
    });

    expect(projectAgentMessageEnvelope(source)).toEqual({
      id: source.id,
      agentId: source.targetAgentId,
      actualAgentId,
      state: 'blocked-retryable',
      mode: 'start-turn',
      delivery: 'queue',
      sender: 'user',
      parentSessionId: 'parent-1',
      createdAt: 1,
      updatedAt: 2,
      turnSeq: 2,
      cliSessionId: 'cli-1',
      reason: 'lane-at-limit',
      partialTurnLost: true,
      turnOutcome: 'failed',
      attemptCount: 3,
      everDispatched: true,
      lastError: 'boom',
      nextRetryAt: 9,
      limit: { known: true, resetAt: 10 },
      hasRecoverableBody: true,
      ackState: 'acted',
      ackAt: 11,
      ackNote: 'done',
    });

    const bare = projectAgentMessageEnvelope(envelope());
    expect(bare).not.toHaveProperty('actualAgentId');
    expect(bare).not.toHaveProperty('turnSeq');
    expect(bare).not.toHaveProperty('cliSessionId');
    expect(bare).not.toHaveProperty('reason');
    expect(bare).not.toHaveProperty('partialTurnLost');
    expect(bare).not.toHaveProperty('turnOutcome');
    expect(bare).not.toHaveProperty('everDispatched');
    expect(bare).not.toHaveProperty('lastError');
    expect(bare).not.toHaveProperty('nextRetryAt');
    expect(bare).not.toHaveProperty('limit');
    expect(bare).not.toHaveProperty('ackState');
    expect(bare).not.toHaveProperty('ackAt');
    expect(bare).not.toHaveProperty('ackNote');
  });

  it('reports a stored body as recoverable and a deleted one as not', () => {
    expect(projectAgentMessageEnvelope(envelope({ bodyBytes: 12 })).hasRecoverableBody).toBe(true);
    expect(projectAgentMessageEnvelope(envelope({ bodyBytes: 0 })).hasRecoverableBody).toBe(false);
  });
});
