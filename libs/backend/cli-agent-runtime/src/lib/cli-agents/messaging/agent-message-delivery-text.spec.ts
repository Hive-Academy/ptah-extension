import { AgentId } from '@ptah-extension/shared';
import {
  agentMessageAckLine,
  agentMessageSenderLabel,
  formatAgentMessageDeliveryText,
} from './agent-message-delivery-text';

const MESSAGE_ID = '11111111-2222-4333-8444-555555555555';
const LANE = AgentId.from('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');

describe('formatAgentMessageDeliveryText', () => {
  it('prefixes the body with the message id and the sender label', () => {
    expect(formatAgentMessageDeliveryText(MESSAGE_ID, { kind: 'user' }, 'Please rebase.', false))
      .toBe(`[Ptah message ${MESSAGE_ID} from the user]\n\nPlease rebase.`);
  });

  it('appends the ack line only when the lane can acknowledge', () => {
    const line = agentMessageAckLine(MESSAGE_ID);
    expect(line).toBe(
      `[Reply with ptah_agent_message_ack { messageId: "${MESSAGE_ID}", state: "read" | "acted" | "rejected" }]`);
    expect(formatAgentMessageDeliveryText(MESSAGE_ID, { kind: 'user' }, 'Please rebase.', true))
      .toBe(`[Ptah message ${MESSAGE_ID} from the user]\n\nPlease rebase.\n\n${line}`);
    expect(formatAgentMessageDeliveryText(MESSAGE_ID, { kind: 'user' }, 'Please rebase.', false))
      .not.toContain('ptah_agent_message_ack');
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
      MESSAGE_ID, { kind: 'parent', sessionId: 'session-secret-1' }, 'body', true);
    const lane = formatAgentMessageDeliveryText(MESSAGE_ID,
      { kind: 'lane', agentId: LANE, name: 'the user', parentSessionId: 'p-1', verified: false }, 'body', true);
    const header = (text: string): string => text.split('\n')[0];
    expect(header(parent)).not.toContain('session-secret-1');
    expect(header(lane)).not.toContain(String(LANE));
    expect(header(lane)).not.toContain('p-1');
    expect(header(lane)).toBe(`[Ptah message ${MESSAGE_ID} from another agent lane]`);
  });
});
