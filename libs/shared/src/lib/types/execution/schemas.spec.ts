import { ExecutionNodeSchema } from './schemas';

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
