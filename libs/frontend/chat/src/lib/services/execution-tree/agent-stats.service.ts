/**
 * AgentStatsService - Aggregates per-agent stats (model/tokens/cost/duration).
 *
 * Extracted from ExecutionTreeBuilderService (Wave C7f) — owns the
 * `agentStatsCache` Map and the `aggregateAgentStats()` event-scanning logic.
 *
 * The cache lifetime is per-build: ExecutionTreeBuilderService.buildTree() calls
 * `resetPerBuildCache()` at the start of every cache-miss build cycle to avoid
 * stale stats bleeding across rebuilds.
 */

import { Injectable } from '@angular/core';
import type { MessageCompleteEvent } from '@ptah-extension/shared';
import type { StreamingState } from '../chat.types';

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
   * TASK_2025_132: Populates agent nodes with aggregated stats from their child messages.
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
    // Check per-build cache to avoid redundant scans
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
      // Only look at events linked to this agent's tool call
      if (event.parentToolUseId !== toolCallId) continue;

      if (event.eventType === 'message_complete') {
        const complete = event as MessageCompleteEvent;

        // Capture model from first message_complete that has it
        if (!model && complete.model) {
          model = complete.model;
        }

        // Accumulate token usage
        if (complete.tokenUsage) {
          totalInputTokens += complete.tokenUsage.input;
          totalOutputTokens += complete.tokenUsage.output;
          hasTokenData = true;
        }

        // Accumulate cost
        if (complete.cost) {
          totalCost += complete.cost;
        }

        // Track latest timestamp for duration calculation
        if (!latestEnd || complete.timestamp > latestEnd) {
          latestEnd = complete.timestamp;
        }
      }

      if (event.eventType === 'message_start') {
        // Track earliest timestamp for duration calculation
        if (!earliestStart || event.timestamp < earliestStart) {
          earliestStart = event.timestamp;
        }
      }
    }

    const result = {
      agentModel: model,
      // Note: MessageCompleteEvent.tokenUsage only carries input/output.
      // Cache token fields (cacheRead, cacheCreation) are not available
      // at the per-message event level from the SDK.
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

    // Cache for subsequent calls within this build cycle
    this.agentStatsCache.set(toolCallId, result);
    return result;
  }
}
