/**
 * SubagentRpcSchema — unit specs (Phase 2 update).
 *
 * Surface under test: Zod schemas for the three Phase 2 RPC methods
 * (`subagent:send-message`, `subagent:stop`, `subagent:interrupt`).
 *
 * Note: `chat:subagent-query` has no Zod schema (uses static TS types
 * with trivial presence checks — see SubagentRpcHandlers).
 */

import 'reflect-metadata';

import {
  SubagentSendMessageSchema,
  SubagentStopSchema,
  SubagentInterruptSchema,
} from './subagent-rpc.schema';

describe('SubagentSendMessageSchema', () => {
  it('accepts valid params', () => {
    const result = SubagentSendMessageSchema.safeParse({
      sessionId: 'sess-abc',
      parentToolUseId: 'toolu_xyz',
      text: 'hello subagent',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty sessionId', () => {
    const result = SubagentSendMessageSchema.safeParse({
      sessionId: '',
      parentToolUseId: 'toolu_xyz',
      text: 'hello',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty parentToolUseId', () => {
    const result = SubagentSendMessageSchema.safeParse({
      sessionId: 'sess-abc',
      parentToolUseId: '',
      text: 'hello',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty text', () => {
    const result = SubagentSendMessageSchema.safeParse({
      sessionId: 'sess-abc',
      parentToolUseId: 'toolu_xyz',
      text: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing fields', () => {
    const result = SubagentSendMessageSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('SubagentStopSchema', () => {
  it('accepts valid params', () => {
    const result = SubagentStopSchema.safeParse({
      sessionId: 'sess-abc',
      taskId: 'task-123',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty sessionId', () => {
    const result = SubagentStopSchema.safeParse({
      sessionId: '',
      taskId: 'task-123',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty taskId', () => {
    const result = SubagentStopSchema.safeParse({
      sessionId: 'sess-abc',
      taskId: '',
    });
    expect(result.success).toBe(false);
  });
});

describe('SubagentInterruptSchema', () => {
  it('accepts valid params', () => {
    const result = SubagentInterruptSchema.safeParse({
      sessionId: 'sess-abc',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty sessionId', () => {
    const result = SubagentInterruptSchema.safeParse({ sessionId: '' });
    expect(result.success).toBe(false);
  });

  it('rejects missing sessionId', () => {
    const result = SubagentInterruptSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});
