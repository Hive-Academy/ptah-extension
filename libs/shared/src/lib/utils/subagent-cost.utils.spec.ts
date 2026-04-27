/**
 * Unit tests for subagent-cost.utils.ts.
 *
 * Builds minimal `ExecutionNode` / `ExecutionChatMessage` fixtures and
 * exercises every branch of:
 *   - calculateTotalTreeCost
 *   - calculateTotalTreeTokens (cache fields present vs absent)
 *   - getAgentCostBreakdown (agent detection, depth increments, nested)
 *   - countAgents (nested trees)
 *   - calculateSessionCostSummary (per-message + per-agent aggregation)
 */

import type {
  ExecutionChatMessage,
  ExecutionNode,
  ExecutionNodeType,
} from '../types/execution';
import {
  calculateSessionCostSummary,
  calculateTotalTreeCost,
  calculateTotalTreeTokens,
  countAgents,
  getAgentCostBreakdown,
} from './subagent-cost.utils';

/**
 * Build a minimal ExecutionNode. Only fields referenced by the utils under
 * test need real values; the rest are set to sensible defaults.
 */
function makeNode(
  type: ExecutionNodeType,
  overrides: Partial<ExecutionNode> = {},
): ExecutionNode {
  return {
    id: overrides.id ?? 'n-' + Math.random().toString(36).slice(2, 8),
    type,
    status: overrides.status ?? 'complete',
    content: overrides.content ?? null,
    children: overrides.children ?? [],
    isCollapsed: overrides.isCollapsed ?? false,
    ...overrides,
  };
}

function makeMessage(
  partial: Partial<ExecutionChatMessage> = {},
): ExecutionChatMessage {
  return {
    id: 'msg-' + Math.random().toString(36).slice(2, 8),
    role: 'assistant',
    timestamp: 1_700_000_000_000,
    streamingState: null,
    ...partial,
  };
}

describe('subagent-cost.utils', () => {
  describe('calculateTotalTreeCost', () => {
    it('sums cost across a single node with no children', () => {
      const node = makeNode('message', { cost: 0.5 });
      expect(calculateTotalTreeCost(node)).toBe(0.5);
    });

    it('returns 0 when cost is undefined', () => {
      const node = makeNode('message');
      expect(calculateTotalTreeCost(node)).toBe(0);
    });

    it('recursively sums costs across nested children', () => {
      const tree = makeNode('message', {
        cost: 1,
        children: [
          makeNode('agent', {
            cost: 2,
            children: [makeNode('tool', { cost: 0.25 })],
          }),
          makeNode('tool', { cost: 0.75 }),
        ],
      });
      expect(calculateTotalTreeCost(tree)).toBe(4);
    });
  });

  describe('calculateTotalTreeTokens', () => {
    it('returns zeros for a node without tokenUsage', () => {
      const node = makeNode('message');
      expect(calculateTotalTreeTokens(node)).toEqual({
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheCreation: 0,
      });
    });

    it('reads tokenUsage from the node (all fields)', () => {
      const node = makeNode('message', {
        tokenUsage: {
          input: 10,
          output: 5,
          cacheRead: 2,
          cacheCreation: 3,
        },
      });
      expect(calculateTotalTreeTokens(node)).toEqual({
        input: 10,
        output: 5,
        cacheRead: 2,
        cacheCreation: 3,
      });
    });

    it('defaults missing cache fields to 0', () => {
      const node = makeNode('message', {
        tokenUsage: { input: 1, output: 2 }, // cacheRead/cacheCreation absent
      });
      expect(calculateTotalTreeTokens(node)).toEqual({
        input: 1,
        output: 2,
        cacheRead: 0,
        cacheCreation: 0,
      });
    });

    it('aggregates tokens across a deeply nested tree', () => {
      const tree = makeNode('message', {
        tokenUsage: { input: 100, output: 50, cacheRead: 10 },
        children: [
          makeNode('agent', {
            tokenUsage: {
              input: 20,
              output: 10,
              cacheRead: 5,
              cacheCreation: 2,
            },
            children: [
              makeNode('tool', {
                tokenUsage: { input: 3, output: 1 },
              }),
            ],
          }),
        ],
      });

      expect(calculateTotalTreeTokens(tree)).toEqual({
        input: 123,
        output: 61,
        cacheRead: 15,
        cacheCreation: 2,
      });
    });
  });

  describe('getAgentCostBreakdown', () => {
    it('returns [] for non-agent nodes without agent children', () => {
      const node = makeNode('message', {
        children: [makeNode('tool'), makeNode('text')],
      });
      expect(getAgentCostBreakdown(node)).toEqual([]);
    });

    it('extracts a single top-level agent with its tool count', () => {
      const agent = makeNode('agent', {
        agentType: 'Explore',
        toolCallId: 'tc-123',
        tokenUsage: { input: 100, output: 50 },
        cost: 0.002,
        children: [
          makeNode('tool', { toolName: 'Read' }),
          makeNode('tool', { toolName: 'Bash' }),
        ],
      });

      const breakdown = getAgentCostBreakdown(agent);
      expect(breakdown).toHaveLength(1);
      expect(breakdown[0]).toEqual({
        agentType: 'Explore',
        toolCallId: 'tc-123',
        tokens: { input: 100, output: 50 },
        cost: 0.002,
        depth: 0,
        toolCount: 2,
      });
    });

    it('defaults agentType to "unknown" and tokens/cost to zero', () => {
      const agent = makeNode('agent'); // no agentType / tokenUsage / cost
      const [entry] = getAgentCostBreakdown(agent);
      expect(entry.agentType).toBe('unknown');
      expect(entry.tokens).toEqual({ input: 0, output: 0 });
      expect(entry.cost).toBe(0);
      expect(entry.toolCount).toBe(0);
    });

    it('increments depth for nested agents', () => {
      const tree = makeNode('agent', {
        agentType: 'Outer',
        children: [
          makeNode('agent', {
            agentType: 'Inner',
            children: [
              makeNode('agent', {
                agentType: 'Deepest',
              }),
            ],
          }),
        ],
      });

      const breakdown = getAgentCostBreakdown(tree);
      expect(
        breakdown.map((b) => ({ type: b.agentType, depth: b.depth })),
      ).toEqual([
        { type: 'Outer', depth: 0 },
        { type: 'Inner', depth: 1 },
        { type: 'Deepest', depth: 2 },
      ]);
    });

    it('keeps depth flat when the parent is not an agent (e.g. message container)', () => {
      const tree = makeNode('message', {
        children: [
          makeNode('agent', { agentType: 'A' }),
          makeNode('agent', { agentType: 'B' }),
        ],
      });

      const breakdown = getAgentCostBreakdown(tree);
      // Both agents are siblings at depth 0 because the parent is 'message'
      // (non-agent) — depth is only incremented when the parent is an agent.
      expect(breakdown.map((b) => b.depth)).toEqual([0, 0]);
    });
  });

  describe('countAgents', () => {
    it('returns 0 for a tree without agent nodes', () => {
      const tree = makeNode('message', {
        children: [makeNode('tool'), makeNode('text')],
      });
      expect(countAgents(tree)).toBe(0);
    });

    it('counts a single agent', () => {
      const tree = makeNode('agent');
      expect(countAgents(tree)).toBe(1);
    });

    it('counts nested agents', () => {
      const tree = makeNode('message', {
        children: [
          makeNode('agent', {
            children: [makeNode('agent'), makeNode('tool')],
          }),
          makeNode('agent'),
        ],
      });
      expect(countAgents(tree)).toBe(3);
    });
  });

  describe('calculateSessionCostSummary', () => {
    it('returns zeros for an empty messages array', () => {
      const summary = calculateSessionCostSummary([]);
      expect(summary).toEqual({
        totalCost: 0,
        totalTokens: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheCreation: 0,
        },
        totalDuration: 0,
        messageCount: 0,
        agentCount: 0,
        agentBreakdown: [],
      });
    });

    it('counts only user messages in messageCount (not assistant)', () => {
      const messages: ExecutionChatMessage[] = [
        makeMessage({ role: 'user' }),
        makeMessage({ role: 'assistant' }),
        makeMessage({ role: 'user' }),
        makeMessage({ role: 'system' }),
      ];
      const summary = calculateSessionCostSummary(messages);
      expect(summary.messageCount).toBe(2);
    });

    it('aggregates tokens, cost and duration across messages', () => {
      const messages: ExecutionChatMessage[] = [
        makeMessage({
          role: 'assistant',
          tokens: {
            input: 100,
            output: 50,
            cacheRead: 5,
            cacheCreation: 2,
          },
          cost: 0.01,
          duration: 500,
        }),
        makeMessage({
          role: 'assistant',
          tokens: { input: 50, output: 25 }, // no cache
          cost: 0.005,
          duration: 250,
        }),
      ];

      const summary = calculateSessionCostSummary(messages);
      expect(summary.totalCost).toBeCloseTo(0.015, 6);
      expect(summary.totalDuration).toBe(750);
      expect(summary.totalTokens).toEqual({
        input: 150,
        output: 75,
        cacheRead: 5,
        cacheCreation: 2,
      });
    });

    it('ignores falsy cost / duration values gracefully', () => {
      const messages: ExecutionChatMessage[] = [
        makeMessage({ role: 'assistant', cost: 0, duration: 0 }),
        makeMessage({ role: 'assistant' }), // undefined cost/duration
      ];

      const summary = calculateSessionCostSummary(messages);
      expect(summary.totalCost).toBe(0);
      expect(summary.totalDuration).toBe(0);
    });

    it('walks streamingState trees for agent breakdown + count', () => {
      const tree = makeNode('message', {
        children: [
          makeNode('agent', {
            agentType: 'Plan',
            cost: 0.01,
            tokenUsage: { input: 10, output: 5 },
            children: [makeNode('tool', { toolName: 'Read' })],
          }),
          makeNode('agent', {
            agentType: 'Execute',
            cost: 0.02,
            tokenUsage: { input: 20, output: 10 },
          }),
        ],
      });

      const messages: ExecutionChatMessage[] = [
        makeMessage({ role: 'assistant', streamingState: tree }),
      ];

      const summary = calculateSessionCostSummary(messages);
      expect(summary.agentCount).toBe(2);
      expect(summary.agentBreakdown).toHaveLength(2);
      expect(summary.agentBreakdown.map((a) => a.agentType)).toEqual([
        'Plan',
        'Execute',
      ]);
    });

    it('skips messages with null streamingState (no agent contribution)', () => {
      const messages: ExecutionChatMessage[] = [
        makeMessage({ role: 'assistant', streamingState: null }),
      ];
      const summary = calculateSessionCostSummary(messages);
      expect(summary.agentCount).toBe(0);
      expect(summary.agentBreakdown).toEqual([]);
    });
  });
});
