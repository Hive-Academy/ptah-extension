/**
 * SubagentRpcSchema — unit specs.
 *
 * Surface under test: Zod schemas for the four command RPC methods
 * (`subagent:send-message`, `subagent:stop`, `subagent:interrupt`,
 * `subagent:background`) and, since TASK_2026_296, `chat:subagent-query`.
 *
 * The query schema is deliberately weaker than its four siblings: shape only,
 * no `.min(1)`. The block below pins that weakness as intentional, because
 * "tighten it to match the others" is the single change most likely to be
 * proposed here and it would reintroduce a fixed cross-session leak.
 */

import 'reflect-metadata';

import {
  SubagentQuerySchema,
  SubagentSendMessageSchema,
  SubagentStopSchema,
  SubagentInterruptSchema,
  SubagentBackgroundSchema,
} from './subagent-rpc.schema';

describe('SubagentQuerySchema', () => {
  it('accepts no params at all (the unscoped query)', () => {
    const result = SubagentQuerySchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts a real sessionId', () => {
    const result = SubagentQuerySchema.safeParse({ sessionId: 'sess-abc' });
    expect(result.success).toBe(true);
  });

  it('accepts a real toolCallId', () => {
    const result = SubagentQuerySchema.safeParse({ toolCallId: 'toolu_abc' });
    expect(result.success).toBe(true);
  });

  // THE load-bearing assertion in this file. `chat:subagent-query` answers a
  // present-but-empty sessionId with an empty result, on purpose. If the
  // schema rejected `''`, that deliberate empty result would become an error;
  // if it normalized `''` away, the query would fall through to the UNSCOPED
  // branch and offer this session another session's interrupted subagents.
  // Zod must pass `''` through UNCHANGED and let the handler decide.
  it('accepts an empty sessionId and preserves it verbatim', () => {
    const result = SubagentQuerySchema.safeParse({ sessionId: '' });
    expect(result.success).toBe(true);
    expect(result.data?.['sessionId']).toBe('');
  });

  it('does not trim a whitespace-only sessionId into absence', () => {
    const result = SubagentQuerySchema.safeParse({ sessionId: '   ' });
    expect(result.success).toBe(true);
    expect(result.data?.['sessionId']).toBe('   ');
  });

  it('rejects a non-string sessionId', () => {
    const result = SubagentQuerySchema.safeParse({ sessionId: 123 });
    expect(result.success).toBe(false);
  });

  it('rejects a non-string toolCallId', () => {
    const result = SubagentQuerySchema.safeParse({ toolCallId: [] });
    expect(result.success).toBe(false);
  });

  it('rejects a non-object param bag', () => {
    expect(SubagentQuerySchema.safeParse('nope').success).toBe(false);
    expect(SubagentQuerySchema.safeParse(null).success).toBe(false);
  });

  it('passes unknown fields through rather than rejecting them', () => {
    const result = SubagentQuerySchema.safeParse({
      sessionId: 'sess-abc',
      someFutureField: 'from a newer webview',
    });
    expect(result.success).toBe(true);
    expect(result.data?.['someFutureField']).toBe('from a newer webview');
  });
});

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

describe('SubagentBackgroundSchema', () => {
  it('accepts params with a toolUseId', () => {
    const result = SubagentBackgroundSchema.safeParse({
      sessionId: 'sess-abc',
      toolUseId: 'toolu_fg',
    });
    expect(result.success).toBe(true);
  });

  it('accepts params without a toolUseId (optional)', () => {
    const result = SubagentBackgroundSchema.safeParse({
      sessionId: 'sess-abc',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty sessionId', () => {
    const result = SubagentBackgroundSchema.safeParse({ sessionId: '' });
    expect(result.success).toBe(false);
  });

  it('rejects an empty-string toolUseId', () => {
    const result = SubagentBackgroundSchema.safeParse({
      sessionId: 'sess-abc',
      toolUseId: '',
    });
    expect(result.success).toBe(false);
  });
});
