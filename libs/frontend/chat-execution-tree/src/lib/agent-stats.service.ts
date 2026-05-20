/**
 * AgentStatsService - Aggregates per-agent stats (model/tokens/cost/duration).
 *
 * Owns the `agentStatsCache` Map and the `aggregateAgentStats()`
 * event-scanning logic.
 *
 * The cache lifetime is per-build: ExecutionTreeBuilderService.buildTree() calls
 * `resetPerBuildCache()` at the start of every cache-miss build cycle to avoid
 * stale stats bleeding across rebuilds.
 */

import { Injectable } from '@angular/core';
import type { MessageCompleteEvent } from '@ptah-extension/shared';
import type { StreamingState } from '@ptah-extension/chat-types';

@Injectable({ providedIn: 'root' })
export class AgentStatsService {
  /**
   * Per-build-cycle cache for aggregateAgentStats results.
   * Cleared at the start of each buildTree() call to avoid stale data.
   * Prevents redundant full-event scans when the same toolCallId is
   * queried from multiple agent node creation sites within a single build.
   */
  private agentStatsCache = new Map<
    string,
    {
      agentModel?: string;
      tokenUsage?: { input: number; output: number };
      cost?: number;
      duration?: number;
    }
  >();

  /**
   * Reset the per-build cache. Called by ExecutionTreeBuilderService.buildTree()
   * at the start of every cache-miss build cycle.
   */
  resetPerBuildCache(): void {
    this.agentStatsCache.clear();
  }

  /**
   * Aggregate model, token usage, cost, and duration from child message events.
   * Scans all message_complete events linked to this agent via parentToolUseId.
   * Results are cached per toolCallId within a single buildTree() cycle.
   *
   * @param toolCallId - The agent's parent tool call ID
   * @param state - Current streaming state
   * @returns Aggregated stats for the agent node
   */
  aggregateAgentStats(
    toolCallId: string,
    state: StreamingState,
  ): {
    agentModel?: string;
    tokenUsage?: { input: number; output: number };
    cost?: number;
    duration?: number;
  } {
    const cached = this.agentStatsCache.get(toolCallId);
    if (cached) return cached;

    let model: string | undefined;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCost = 0;
    let hasTokenData = false;
    let earliestStart: number | undefined;
    let latestEnd: number | undefined;

    for (const event of state.events.values()) {
      if (event.parentToolUseId !== toolCallId) continue;

      if (event.eventType === 'message_complete') {
        const complete = event as MessageCompleteEvent;
        if (!model && complete.model) {
          model = complete.model;
        }
        if (complete.tokenUsage) {
          totalInputTokens += complete.tokenUsage.input;
          totalOutputTokens += complete.tokenUsage.output;
          hasTokenData = true;
        }
        if (complete.cost) {
          totalCost += complete.cost;
        }
        if (!latestEnd || complete.timestamp > latestEnd) {
          latestEnd = complete.timestamp;
        }
      }

      if (event.eventType === 'message_start') {
        if (!earliestStart || event.timestamp < earliestStart) {
          earliestStart = event.timestamp;
        }
      }
    }

    const result = {
      agentModel: model,
      tokenUsage: hasTokenData
        ? {
            input: totalInputTokens,
            output: totalOutputTokens,
          }
        : undefined,
      cost: totalCost > 0 ? totalCost : undefined,
      duration:
        earliestStart && latestEnd && latestEnd > earliestStart
          ? latestEnd - earliestStart
          : undefined,
    };
    this.agentStatsCache.set(toolCallId, result);
    return result;
  }
}
