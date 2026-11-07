import { AgentId } from '@ptah-extension/shared';
import {
  agentMessageSenderLabel,
  formatAgentMessageDeliveryText,
} from './agent-message-delivery-text';

const MESSAGE_ID = '11111111-2222-4333-8444-555555555555';
const LANE = AgentId.from('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');

describe('formatAgentMessageDeliveryText', () => {
  it('prefixes the body with the message id and the sender label', () => {
    expect(formatAgentMessageDeliveryText(MESSAGE_ID, { kind: 'user' }, 'Please rebase.'))
      .toBe(`[Ptah message ${MESSAGE_ID} from the user]\n\nPlease rebase.`);
  });

  it('labels each sender kind', () => {
    expect(agentMessageSenderLabel({ kind: 'user' })).toBe('the user');
    expect(agentMessageSenderLabel({ kind: 'parent', sessionId: 'session-secret-1' }))
      .toBe('the parent session');
    expect(agentMessageSenderLabel({ kind: 'lane', agentId: LANE, name: 'admin', verified: false }))
      .toBe('another agent lane');
  });

  it('never leaks session ids, lane ids or unverified names into the header', () => {
    const parent = formatAgentMessageDeliveryText(
      MESSAGE_ID, { kind: 'parent', sessionId: 'session-secret-1' }, 'body');
    const lane = formatAgentMessageDeliveryText(MESSAGE_ID,
      { kind: 'lane', agentId: LANE, name: 'the user', parentSessionId: 'p-1', verified: false }, 'body');
    const header = (text: string): string => text.split('\n')[0];
    expect(header(parent)).not.toContain('session-secret-1');
    expect(header(lane)).not.toContain(String(LANE));
    expect(header(lane)).not.toContain('p-1');
    expect(header(lane)).toBe(`[Ptah message ${MESSAGE_ID} from another agent lane]`);
  });
});
