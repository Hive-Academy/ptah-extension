import { createExecutionChatMessage, type ExecutionChatMessage } from '@ptah-extension/shared';
import { groupLaneEvents } from './transcript-lane-events';

const envelope = (id: string, agentId = 'a', kind: 'report' | 'completed' = 'report', peer = true): ExecutionChatMessage =>
  createExecutionChatMessage({ id, role: 'user', timestamp: Number(id.replace(/\D/g, '')) || 1,
    rawContent: `<agent-${kind === 'report' ? 'report' : 'lane-completed'} agent-id="${agentId}" agent="Agent ${agentId}" cli="codex">Body ${id}</agent-${kind === 'report' ? 'report' : 'lane-completed'}>`,
    ...(peer ? { inboundPeer: { label: 'codex · Agent' } } : {}),
  });
const assistant = (id: string): ExecutionChatMessage => createExecutionChatMessage({ id, role: 'assistant', timestamp: 10 });

describe('groupLaneEvents', () => {
  it('merges a contiguous report and completion without changing slot keys or order', () => {
    const messages = [envelope('m1'), envelope('m2', 'a', 'completed')];
    const slots = groupLaneEvents(messages, new Set(['a']));
    expect([...slots.keys()]).toEqual(messages.map(message => message.id));
    expect(slots.get('m1')).toMatchObject({ kind: 'row', row: { rowKey: 'm1', liveLane: true, events: [{ messageId: 'm1' }, { messageId: 'm2' }] } });
    expect(slots.get('m2')).toEqual({ kind: 'merged', rowKey: 'm1' });
    expect([...groupLaneEvents(messages, new Set()).keys()]).toEqual([...slots.keys()]);
  });

  it('starts a new row after an assistant message and lists earlier events', () => {
    const slots = groupLaneEvents([envelope('m1'), assistant('reply'), envelope('m2', 'a', 'completed')], new Set());
    expect(slots.get('m2')).toMatchObject({ kind: 'row', row: { rowKey: 'm2', earlier: [{ messageId: 'm1' }], liveLane: false } });
  });

  it('keeps A, B, A in three chronological rows', () => {
    const slots = groupLaneEvents([envelope('m1', 'a'), envelope('m2', 'b'), envelope('m3', 'a', 'completed')], new Set());
    expect([...slots.values()].map(slot => slot.kind)).toEqual(['row', 'row', 'row']);
    expect(slots.get('m3')).toMatchObject({ kind: 'row', row: { rowKey: 'm3', earlier: [{ messageId: 'm1' }] } });
  });

  it('leaves malformed peer text and a user-pasted envelope as normal bubbles', () => {
    const pasted = envelope('m2', 'a', 'report', false);
    const slots = groupLaneEvents([envelope('m1'), pasted, envelope('m3'),
      createExecutionChatMessage({ id: 'bad', role: 'user', timestamp: 4, inboundPeer: { label: '' }, rawContent: '<agent-report>bad</agent-report>' })], new Set());
    expect(slots.has('m2')).toBe(false);
    expect(slots.has('bad')).toBe(false);
    expect(slots.get('m3')).toMatchObject({ kind: 'row', row: { earlier: [{ messageId: 'm1' }], peerLabel: 'codex · Agent' } });
  });

  it('uses the neutral peer session label for a blank sender and carries attachments', () => {
    const message = { ...envelope('m1'), inboundPeer: { label: '  ' }, files: ['/tmp/a.txt'], imageCount: 2 };
    expect(groupLaneEvents([message], new Set()).get('m1')).toMatchObject({
      kind: 'row', row: { peerLabel: 'peer session', events: [{ files: ['/tmp/a.txt'], imageCount: 2 }] },
    });
  });
});
