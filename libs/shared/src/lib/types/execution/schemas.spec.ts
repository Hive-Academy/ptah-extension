import { ChatSessionSummarySchema, ExecutionNodeSchema } from './schemas';

describe('ChatSessionSummarySchema', () => {
  const row = { id: 'session-1', name: 'Session', messageCount: 0, createdAt: 1, lastActivityAt: 1, isActive: false };

  it('accepts a canonical provider ID and old rows without one', () => {
    expect(ChatSessionSummarySchema.parse({ ...row, providerId: 'openrouter' }).providerId).toBe('openrouter');
    expect(ChatSessionSummarySchema.parse(row).providerId).toBeUndefined();
    expect(ChatSessionSummarySchema.safeParse({ ...row, providerId: '' }).success).toBe(false);
  });
});

describe('ExecutionNodeSchema', () => {
  const node = {
    id: 'tool-1',
    type: 'tool' as const,
    status: 'complete' as const,
    content: null,
    children: [],
    isCollapsed: false,
  };

  it.each([true, false])('preserves isError=%s through parsing', (isError) => {
    expect(ExecutionNodeSchema.parse({ ...node, isError }).isError).toBe(
      isError,
    );
  });
});
