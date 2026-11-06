import { randomUUID } from 'node:crypto';
import { AgentId } from '@ptah-extension/shared';
import { parseLegacyReceipts } from './legacy-receipt-migration';

function receipt(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: randomUUID(),
    agentId: AgentId.create(),
    state: 'settled',
    mode: 'start-turn',
    delivery: 'queue',
    createdAt: 10,
    updatedAt: 20,
    ...overrides,
  };
}

describe('parseLegacyReceipts', () => {
  it('returns nothing for a value that is not an array', () => {
    expect(parseLegacyReceipts(undefined)).toEqual([]);
    expect(parseLegacyReceipts({ records: [] })).toEqual([]);
    expect(parseLegacyReceipts('receipts')).toEqual([]);
  });

  it('skips entries that do not match the legacy v1 shape', () => {
    const valid = receipt();
    const result = parseLegacyReceipts([
      valid,
      { ...receipt(), id: 'not-a-uuid' },
      { ...receipt(), agentId: 'agent-1' },
      { ...receipt(), state: 'unknown' },
      { ...receipt(), extra: true },
      null,
      'nope',
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(valid.id);
  });

  it('imports terminal receipts as metadata-only terminal envelopes', () => {
    const agentId = AgentId.create();
    const [settled, failed, expired, interrupted] = parseLegacyReceipts([
      receipt({
        agentId,
        state: 'settled',
        sender: 'parent',
        updatedAt: 20,
        turnSeq: 3,
        cliSessionId: 'cli-1',
        turnOutcome: 'completed',
      }),
      receipt({ agentId, state: 'failed', sender: 'user', reason: 'delivery-failed' }),
      receipt({ agentId, state: 'expired', reason: 'not_found' }),
      receipt({
        agentId,
        state: 'interrupted-undelivered',
        reason: 'interrupted-undelivered',
        partialTurnLost: true,
      }),
    ]);

    expect(settled).toMatchObject({
      targetAgentId: agentId,
      laneLineageId: agentId,
      state: 'settled',
      senderKey: 'parent:legacy',
      terminalAt: 20,
      turnSeq: 3,
      cliSessionId: 'cli-1',
      turnOutcome: 'completed',
      attemptCount: 0,
      bodyBytes: 0,
    });
    expect(failed).toMatchObject({
      state: 'failed',
      senderKey: 'user',
      reason: 'delivery-failed',
      terminalAt: 20,
      bodyBytes: 0,
    });
    expect(expired).toMatchObject({ state: 'expired', reason: 'not_found', bodyBytes: 0 });
    expect(interrupted).toMatchObject({
      state: 'failed',
      reason: 'interrupted-undelivered',
      partialTurnLost: true,
      bodyBytes: 0,
    });
  });

  it('imports nonterminal receipts as failed/host-restarted', () => {
    const [accepted, started] = parseLegacyReceipts([
      receipt({ state: 'accepted' }),
      receipt({ state: 'started' }),
    ]);

    expect(accepted).toMatchObject({ state: 'failed', reason: 'host-restarted', terminalAt: 20 });
    expect(started).toMatchObject({ state: 'failed', reason: 'host-restarted' });
  });

  it('derives the sender key and the legacy parent sender', () => {
    const [user] = parseLegacyReceipts([receipt({ sender: 'user' })]);
    const [legacyParent] = parseLegacyReceipts([receipt()]);

    expect(user.sender).toEqual({ kind: 'user' });
    expect(user.senderKey).toBe('user');
    expect(legacyParent.sender).toEqual({ kind: 'parent' });
    expect(legacyParent.senderKey).toBe('parent:legacy');
  });
});
