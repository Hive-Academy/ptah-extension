/**
 * Pins the shape decision behind `ExecutionChatMessage.inboundPeer`
 * (TASK_2026_402, Component 9): an optional display-only field carried
 * ALONGSIDE `role: 'user'`, never a fourth `MessageRole`.
 */

import { createExecutionChatMessage } from './factories';
import { ExecutionChatMessageSchema, MessageRoleSchema } from './schemas';

describe('ExecutionChatMessage.inboundPeer', () => {
  it('carries the peer label through the factory while the role stays user', () => {
    const message = createExecutionChatMessage({
      id: 'msg-1',
      role: 'user',
      rawContent: 'hello from the reviewer',
      inboundPeer: { label: 'reviewer' },
    });

    expect(message.role).toBe('user');
    expect(message.inboundPeer).toEqual({ label: 'reviewer' });
  });

  it('omits the key entirely for an ordinary user turn', () => {
    const message = createExecutionChatMessage({
      id: 'msg-2',
      role: 'user',
      rawContent: 'typed by the person watching',
    });

    expect(message).not.toHaveProperty('inboundPeer');
  });

  it('round-trips the peer label through the Zod mirror', () => {
    const parsed = ExecutionChatMessageSchema.parse({
      id: 'msg-3',
      role: 'user',
      timestamp: 1,
      streamingState: null,
      rawContent: 'body',
      inboundPeer: { label: 'planner' },
    });

    expect(parsed.inboundPeer).toEqual({ label: 'planner' });
  });

  it('accepts a message with no peer field', () => {
    const result = ExecutionChatMessageSchema.safeParse({
      id: 'msg-4',
      role: 'user',
      timestamp: 1,
      streamingState: null,
      rawContent: 'body',
    });

    expect(result.success).toBe(true);
  });

  it('rejects a non-string label', () => {
    const result = ExecutionChatMessageSchema.safeParse({
      id: 'msg-5',
      role: 'user',
      timestamp: 1,
      streamingState: null,
      inboundPeer: { label: 42 },
    });

    expect(result.success).toBe(false);
  });

  it('leaves MessageRole a three-value union', () => {
    expect(MessageRoleSchema.options).toEqual(['user', 'assistant', 'system']);
  });
});
