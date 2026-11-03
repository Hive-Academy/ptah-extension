import type { ExecutionNode } from '@ptah-extension/shared';
import { subagentToolCount } from './subagent-tool-count';

function tools(count: number): ExecutionNode[] {
  return Array.from({ length: count }, (_, index): ExecutionNode => ({
    id: `tool-${index}`,
    type: 'tool',
    status: 'complete',
    content: null,
    children: [],
    isCollapsed: false,
  }));
}

describe('subagentToolCount', () => {
  it('uses the larger current source and counts nested tools', () => {
    const displayed = [{
      ...tools(1)[0],
      children: tools(2),
    }];
    expect(subagentToolCount({ toolUses: 4 }, displayed)).toBe(4);
    expect(subagentToolCount({ toolUses: 1 }, displayed)).toBe(3);
  });

  it('follows the displayed count through host lag and trimming', () => {
    expect(subagentToolCount({ toolUses: 2 }, tools(3))).toBe(3);
    expect(subagentToolCount({ toolUses: 2 }, tools(1))).toBe(2);
    expect(subagentToolCount({ toolUses: 3 }, tools(1))).toBe(3);
  });

  it('treats a non-finite host count as zero', () => {
    expect(subagentToolCount({ toolUses: Number.NaN }, [])).toBe(0);
    expect(subagentToolCount({ toolUses: Number.POSITIVE_INFINITY }, [])).toBe(0);
  });
});
