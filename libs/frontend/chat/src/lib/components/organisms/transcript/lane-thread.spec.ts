import { createExecutionChatMessage, type AgentDeliveryReceipt } from '@ptah-extension/shared';
import { laneThreadEntries } from './lane-thread';

describe('laneThreadEntries', () => {
  it('adds preview receipts and failed completion in chronological order', () => {
    const receipt: AgentDeliveryReceipt = { id: 'r', agentId: 'lane', sender: 'parent', preview: 'Check the files',
      state: 'accepted', mode: 'queue-next-turn', delivery: 'queue', createdAt: 10, updatedAt: 10 };
    const entries = laneThreadEntries([], [receipt], 'Claude', 'Docs', 'Codex',
      [{ agentId: 'lane', kind: 'completion', state: 'pending' }], { status: 'failed', timestamp: 20 });
    expect(entries.map(entry => entry.body)).toEqual(['Check the files', 'Failed']);
    expect(entries[0].sender).toBe('Parent agent · Claude');
    expect(entries[1]).toMatchObject({ verdict: 'Failed', parentSignal: 'Waiting for parent' });
  });
  it('orders text messages and only attributes a receipt on exact id', () => {
    const messages = [
      createExecutionChatMessage({ id: 'lane:user:a', role: 'user', timestamp: 200, rawContent: 'Second' }),
      createExecutionChatMessage({ id: 'lane:user:b', role: 'user', timestamp: 100, rawContent: 'First' }),
    ];
    const receipt: AgentDeliveryReceipt = {
      id: 'a', agentId: 'lane', state: 'accepted', mode: 'queue-next-turn',
      delivery: 'queue', createdAt: 200, updatedAt: 200,
    };
    const entries = laneThreadEntries(messages, [receipt], 'Claude', 'Docs', 'Codex');
    expect(entries.map(entry => entry.body)).toEqual(['First', 'Second']);
    expect(entries.map(entry => entry.sender)).toEqual(['Parent agent · Claude', 'You']);
    expect(entries[1].receipt).toBe(receipt);
  });
});
