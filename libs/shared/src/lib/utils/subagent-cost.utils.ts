/**
 * Subagent Cost Utilities
 *
 * Utility functions for aggregating costs from nested agent execution trees.
 * These enable showing per-agent cost breakdown and total session costs
 * including all subagent executions.
 *
 * @see https://platform.claude.com/docs/en/agent-sdk/subagents
 */

import type {
  ExecutionNode,
  ExecutionChatMessage,
  MessageTokenUsage,
} from '../types/execution';

/**
 * Agent cost breakdown for display
 */
export interface AgentCostBreakdown {
  /** Agent type (e.g., 'Explore', 'Plan', 'code-reviewer') */
  readonly agentType: string;
  /** Tool call ID that spawned this agent */
  readonly toolCallId?: string;
  /** Token usage for this agent */
  readonly tokens: MessageTokenUsage;
  /** Cost in USD */
  readonly cost: number;
  /** Nesting depth (0 = top-level agent) */
  readonly depth: number;
  /** Number of tool calls within this agent */
  readonly toolCount: number;
}

/**
 * Session cost summary
 */
export interface SessionCostSummary {
  /** Total cost in USD for all messages */
  readonly totalCost: number;
  /** Total token usage across all messages */
  readonly totalTokens: MessageTokenUsage;
  /** Total duration in milliseconds */
  readonly totalDuration: number;
  /** Number of user messages */
  readonly messageCount: number;
  /** Number of agent executions (including nested) */
  readonly agentCount: number;
  /** Per-agent cost breakdown */
  readonly agentBreakdown: AgentCostBreakdown[];
}

/**
 * Recursively calculate total cost from an ExecutionNode tree
 * Includes all nested agent costs
 */
export function calculateTotalTreeCost(node: ExecutionNode): number {
  let total = node.cost ?? 0;

  // Recurse into children
  for (const child of node.children) {
    total += calculateTotalTreeCost(child);
  }

  return total;
}

/**
 * Recursively calculate total tokens from an ExecutionNode tree
 */
export function calculateTotalTreeTokens(
  node: ExecutionNode,
): MessageTokenUsage {
  // Use mutable accumulator internally
  let input = node.tokenUsage?.input ?? 0;
  let output = node.tokenUsage?.output ?? 0;
  let cacheRead = node.tokenUsage?.cacheRead ?? 0;
  let cacheCreation = node.tokenUsage?.cacheCreation ?? 0;

  // Recurse into children
  for (const child of node.children) {
    const childTokens = calculateTotalTreeTokens(child);
    input += childTokens.input;
    output += childTokens.output;
    cacheRead += childTokens.cacheRead ?? 0;
    cacheCreation += childTokens.cacheCreation ?? 0;
  }

  return { input, output, cacheRead, cacheCreation };
}

/**
 * Get per-agent cost breakdown from an ExecutionNode tree
 */
export function getAgentCostBreakdown(
  node: ExecutionNode,
  depth = 0,
): AgentCostBreakdown[] {
  const breakdown: AgentCostBreakdown[] = [];

  if (node.type === 'agent') {
    const toolCount = countToolCalls(node);
    breakdown.push({
      agentType: node.agentType ?? 'unknown',
      toolCallId: node.toolCallId,
      tokens: node.tokenUsage ?? { input: 0, output: 0 },
      cost: node.cost ?? 0,
      depth,
      toolCount,
    });
  }

  // Recurse into children (incrementing depth for nested agents)
  for (const child of node.children) {
    const childBreakdown = getAgentCostBreakdown(
      child,
      node.type === 'agent' ? depth + 1 : depth,
    );
    breakdown.push(...childBreakdown);
  }

  return breakdown;
}

/**
 * Count tool calls within an ExecutionNode tree
 */
function countToolCalls(node: ExecutionNode): number {
  let count = 0;

  if (node.type === 'tool') {
    count = 1;
  }

  for (const child of node.children) {
    count += countToolCalls(child);
  }

  return count;
}

/**
 * Count total agents in an ExecutionNode tree
 */
export function countAgents(node: ExecutionNode): number {
  let count = 0;

  if (node.type === 'agent') {
    count = 1;
  }

  for (const child of node.children) {
    count += countAgents(child);
  }

  return count;
}

/**
 * Calculate session cost summary from all messages
 */
export function calculateSessionCostSummary(
  messages: ExecutionChatMessage[],
): SessionCostSummary {
  let totalCost = 0;
  let totalDuration = 0;
  let messageCount = 0;
  let agentCount = 0;
  // Use mutable primitives for accumulation
  let tokensInput = 0;
  let tokensOutput = 0;
  let tokensCacheRead = 0;
  let tokensCacheCreation = 0;
  const allAgentBreakdown: AgentCostBreakdown[] = [];

  for (const message of messages) {
    if (message.role === 'user') {
      messageCount++;
    }

    // Add message-level stats if available
    if (message.tokens) {
      tokensInput += message.tokens.input;
      tokensOutput += message.tokens.output;
      tokensCacheRead += message.tokens.cacheRead ?? 0;
      tokensCacheCreation += message.tokens.cacheCreation ?? 0;
    }
    if (message.cost) {
      totalCost += message.cost;
    }
    if (message.duration) {
      totalDuration += message.duration;
    }

    // Process streaming state tree for agent breakdown
    if (message.streamingState) {
      const agents = getAgentCostBreakdown(message.streamingState);
      allAgentBreakdown.push(...agents);
      agentCount += countAgents(message.streamingState);
    }
  }

  return {
    totalCost,
    totalTokens: {
      input: tokensInput,
      output: tokensOutput,
      cacheRead: tokensCacheRead,
      cacheCreation: tokensCacheCreation,
    },
    totalDuration,
    messageCount,
    agentCount,
    agentBreakdown: allAgentBreakdown,
  };
}
