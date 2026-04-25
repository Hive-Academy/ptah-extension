/**
 * ToolNodeBuilderService - Builds tool ExecutionNodes and routes Task→agent dispatch.
 *
 * Extracted from ExecutionTreeBuilderService (Wave C7f) — owns
 * `collectTools` (the 353-LOC three-strategy agent dispatch router),
 * `buildToolNode`, `buildToolChildren`, `parseToolInput`, and the
 * `loggedUnmatchedToolCallIds` Set (cleared via `clearLoggedUnmatched()`).
 *
 * The `buildToolChildren` body delegates agent-node construction to
 * AgentNodeBuilderService.buildAgentNode to dedupe ~110 LOC while preserving
 * byte-identical output (parent toolCallId is used for stats / status / bg
 * background-agent lookup in both code paths).
 *
 * Mutual recursion with AgentNodeBuilderService and MessageNodeBuilderService
 * is resolved via Angular's `inject()` (use-time resolution, not constructor-time).
 */

import { Injectable, inject } from '@angular/core';
import type {
  AgentStartEvent,
  ExecutionNode,
  ToolResultEvent,
  ToolStartEvent,
} from '@ptah-extension/shared';
import {
  createExecutionNode,
  isAgentDispatchTool,
} from '@ptah-extension/shared';
import type { StreamingState } from '../chat.types';
import { AgentNodeBuilderService } from './agent-node-builder.service';
import { ToolTaskDispatchService } from './tool-task-dispatch.service';
import { MAX_DEPTH } from './execution-tree.constants';

/**
 * ParseResult - Result of safe JSON parsing with error tracking
 * TASK_2025_088 Batch 2 Task 2.1: Prevents data loss from silent parse failures
 */
interface ParseResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  raw?: string;
}

@Injectable({ providedIn: 'root' })
export class ToolNodeBuilderService {
  private readonly agentBuilder = inject(AgentNodeBuilderService);
  private readonly taskDispatch = inject(ToolTaskDispatchService);

  /**
   * Tracks toolCallIds that have already been logged as unmatched to prevent
   * log spam — buildTree() is called on every streaming event, so the same
   * unmatched Task tools would otherwise log hundreds of times.
   */
  private readonly loggedUnmatchedToolCallIds = new Set<string>();

  /**
   * Reset the unmatched-tool-call diagnostic Set.
   * Called by ExecutionTreeBuilderService.clearCache() when invoked without a key.
   */
  clearLoggedUnmatched(): void {
    this.loggedUnmatchedToolCallIds.clear();
  }

  /**
   * Collect and build tool nodes from tool_start events
   *
   * @param messageId - Parent message ID
   * @param state - Streaming state
   * @param depth - Current recursion depth (propagate to tool nodes)
   * @returns Array of tool ExecutionNode objects
   */
  collectTools(
    messageId: string,
    state: StreamingState,
    depth: number,
  ): ExecutionNode[] {
    const tools: ExecutionNode[] = [];

    // TASK_2025_095 FIX: Collect tools based on messageId AND context depth
    // - For root-level messages (depth 0): Only collect tools WITHOUT parentToolUseId
    //   These are direct tool calls from the main assistant message.
    // - For nested messages (depth > 0): Collect tools WITH parentToolUseId
    //   These are tool calls from within agent messages, linked to parent Task tool.
    const toolStarts = [...state.events.values()].filter((e) => {
      if (e.eventType !== 'tool_start') return false;
      if (e.messageId !== messageId) return false;

      // Root-level: only tools without parentToolUseId (direct tools)
      // Nested: collect any tools (they have parentToolUseId linking to Task)
      if (depth === 0 && e.parentToolUseId) return false;

      return true;
    }) as ToolStartEvent[];

    // Track used agent event IDs to prevent duplicate agent nodes.
    // When multiple tool_start events exist for the same logical agent (different
    // toolCallId formats), the agentType fallback matching could find the same
    // agent_start multiple times. Track used agent event IDs to prevent this.
    // IMPORTANT: Do NOT deduplicate by agentType alone - parallel agents can share
    // the same agentType (e.g., two "backend-developer" agents running concurrently).
    const usedAgentEventIds = new Set<string>();
    // Track toolCallIds that already have a placeholder or agent node
    const usedToolCallIds = new Set<string>();

    for (const toolStart of toolStarts) {
      // TASK_2025_095: For Task tools that spawn agents, show agent directly instead of Task wrapper
      // This prevents the duplication: Task tool → Agent → tools
      // User should see only: Agent → tools
      // TASK_2025_211 Bug 6: Broaden detection to handle dispatch_agent/dispatch_subagent tool names
      // and data-driven detection via subagent_type in tool input
      let isAgentDispatch =
        toolStart.isTaskTool || isAgentDispatchTool(toolStart.toolName);

      // Data-driven fallback: check tool input for subagent_type signal
      if (!isAgentDispatch) {
        const inputKey = `${toolStart.toolCallId}-input`;
        const inputString = state.toolInputAccumulators.get(inputKey) || '';
        if (
          inputString.includes('"subagent_type"') ||
          inputString.includes('"subagentType"')
        ) {
          isAgentDispatch = true;
        }
      }

      if (isAgentDispatch) {
        // Check if this Task tool has an agent child
        // TASK_2025_128 FIX: The parentToolUseId matching often fails because:
        // - Hook-based agent_start uses UUID format for parentToolUseId
        // - SDK tool_start uses toolu_* format for toolCallId
        // These IDs refer to the SAME tool but use different formats.
        let agentStarts = [...state.events.values()].filter(
          (e) =>
            e.eventType === 'agent_start' &&
            e.parentToolUseId === toolStart.toolCallId,
        ) as AgentStartEvent[];

        // TASK_2025_128 FIX: Fallback - match by agentType when ID matching fails.
        // Extract agentType from tool input and find matching agent_start.
        // This handles the UUID vs toolu_* format mismatch.
        if (agentStarts.length === 0) {
          const inputKey = `${toolStart.toolCallId}-input`;
          const inputString = state.toolInputAccumulators.get(inputKey) || '';
          const typeMatch = inputString.match(
            /"subagent_type"\s*:\s*"([^"]+)"/,
          );

          if (typeMatch) {
            const agentType = typeMatch[1];
            agentStarts = [...state.events.values()].filter(
              (e) =>
                e.eventType === 'agent_start' &&
                (e as AgentStartEvent).agentType === agentType &&
                // Only match agent_starts that belong to THIS tool or aren't
                // correlated to a different tool yet. A backfilled parentToolUseId
                // in toolu_* format pointing to a different tool means this
                // agent_start was already claimed by another tool_start.
                (!e.parentToolUseId ||
                  e.parentToolUseId === toolStart.toolCallId ||
                  !e.parentToolUseId.startsWith('toolu_')),
            ) as AgentStartEvent[];

            // BUGFIX: Sort by timestamp proximity to the tool_start.
            // When multiple agents of the same type exist (e.g., 5 frontend-developer
            // agents from history + 1 streaming), the closest by timestamp is most likely
            // the correct match for this tool_start. Without sorting, Map iteration order
            // (insertion order) picks the oldest historical agent, causing content block
            // lookups to use the wrong agentId.
            agentStarts.sort(
              (a, b) =>
                Math.abs(a.timestamp - toolStart.timestamp) -
                Math.abs(b.timestamp - toolStart.timestamp),
            );
          }
        }

        if (agentStarts.length > 0) {
          // Build agent node directly (skip the Task tool wrapper).
          // For parallel agents of the same type, only take the FIRST unused agent_start.
          // Each tool_start should map to exactly one agent_start.
          let matchedAgent: AgentStartEvent | null = null;

          for (const agentStart of agentStarts) {
            // Skip if this specific agent_start event was already consumed by another tool_start
            if (usedAgentEventIds.has(agentStart.id)) {
              continue;
            }
            if (
              agentStart.agentId &&
              usedAgentEventIds.has(agentStart.agentId)
            ) {
              continue;
            }
            matchedAgent = agentStart;
            break; // Take the first unused match
          }

          if (matchedAgent) {
            // Mark this agent_start as consumed so other tool_starts won't reuse it
            usedAgentEventIds.add(matchedAgent.id);
            if (matchedAgent.agentId) {
              usedAgentEventIds.add(matchedAgent.agentId);
            }
            usedToolCallIds.add(toolStart.toolCallId);

            const agentNode = this.agentBuilder.buildAgentNode(
              matchedAgent,
              toolStart.toolCallId,
              state,
              depth,
            );
            if (agentNode) {
              tools.push(agentNode);
            }
          }
          continue; // Skip building the Task tool node
        } else {
          // DIAGNOSTIC: Log once per toolCallId to avoid spam during streaming rebuilds.
          // buildTree() is called on every streaming event, so this would otherwise
          // log hundreds of times for the same unmatched tool calls.
          if (!this.loggedUnmatchedToolCallIds.has(toolStart.toolCallId)) {
            this.loggedUnmatchedToolCallIds.add(toolStart.toolCallId);
            console.debug(
              '[ExecutionTreeBuilder] No agent_start match for Task tool:',
              {
                toolCallId: toolStart.toolCallId,
                toolSource: toolStart.source,
              },
            );
          }
          // TASK_2025_099 FIX: Create streaming agent placeholder when no agent_start yet.
          // Wave C7f: delegated to ToolTaskDispatchService.
          const dispatchResult = this.taskDispatch.tryBuildPlaceholderAgent(
            toolStart,
            state,
            depth,
            usedAgentEventIds,
            usedToolCallIds,
          );
          if (dispatchResult.kind === 'placeholder') {
            tools.push(dispatchResult.node);
            continue; // Skip building the Task tool node
          }
          if (dispatchResult.kind === 'skip') {
            continue;
          }
          // dispatchResult.kind === 'fallthrough' — tool already has a result;
          // fall through and build the normal tool node below.
        }
      }

      // Normal tool - build tool node as usual
      tools.push(this.buildToolNode(toolStart, state, depth));
    }

    return tools;
  }

  /**
   * Parse tool input JSON with error tracking
   * TASK_2025_088 Batch 2 Task 2.1: Safe JSON parser with error tracking
   *
   * @param input - Raw JSON string
   * @returns ParseResult with success/error state
   */
  private parseToolInput(input: string): ParseResult<Record<string, unknown>> {
    try {
      const parsed = JSON.parse(input);
      if (typeof parsed !== 'object' || parsed === null) {
        return { success: false, error: 'Not an object', raw: input };
      }
      return { success: true, data: parsed };
    } catch (e) {
      return { success: false, error: String(e), raw: input };
    }
  }

  /**
   * Build a single tool node with nested children (RECURSIVE)
   *
   * @param toolStart - Tool start event
   * @param state - Streaming state
   * @param depth - Current recursion depth (for preventing stack overflow)
   * @returns Tool ExecutionNode with nested execution
   */
  buildToolNode(
    toolStart: ToolStartEvent,
    state: StreamingState,
    depth = 0,
  ): ExecutionNode {
    // Find tool result FIRST - we only parse input when tool is complete
    const resultEvent = [...state.events.values()].find(
      (e) =>
        e.eventType === 'tool_result' && e.toolCallId === toolStart.toolCallId,
    ) as ToolResultEvent | undefined;

    // Get accumulated input
    const inputKey = `${toolStart.toolCallId}-input`;
    const inputString = state.toolInputAccumulators.get(inputKey) || '';

    // Parse JSON into toolInput field ONLY when tool is complete
    // FIX: During streaming, input JSON is incomplete (e.g., '{"file_path": "d:\\proje')
    // Attempting to parse causes ~15+ SyntaxError warnings per tool call
    // Solution: Defer parsing until tool_result arrives
    let toolInput: Record<string, unknown> | undefined;
    if (inputString && resultEvent) {
      // Tool completed - safe to parse full JSON
      const result = this.parseToolInput(inputString);
      if (result.success) {
        toolInput = result.data;
      } else if (
        toolStart.toolInput &&
        Object.keys(toolStart.toolInput).length > 0
      ) {
        // FIX: Accumulator has partial/corrupt JSON (e.g., streaming deltas were
        // interrupted when the 'complete' event replaced the 'stream' tool_start).
        // The 'complete' source tool_start carries the fully-parsed toolInput —
        // use it instead of showing a parse error.
        toolInput = toolStart.toolInput;
      } else {
        // No fallback available — preserve parse error for UI display
        toolInput = {
          __parseError: result.error,
          __raw: result.raw,
        } as Record<string, unknown>;

        // TASK_2025_100 FIX: Only warn if JSON looks complete (ends with }).
        // During rapid tree rebuilds, tool_result may arrive before accumulator
        // has the complete JSON, causing noisy warnings for incomplete JSON.
        const trimmed = result.raw?.trim() || '';
        const looksComplete = trimmed.endsWith('}') || trimmed.endsWith(']');
        if (looksComplete) {
          console.warn(
            '[ExecutionTreeBuilderService] Tool input parse failed',
            {
              toolCallId: toolStart.toolCallId,
              error: result.error,
              raw: result.raw?.substring(0, 100), // Log first 100 chars
            },
          );
        }
      }
    } else if (inputString) {
      // Tool still streaming - don't parse, show raw snippet for debugging
      toolInput = {
        __streaming: true,
        __rawSnippet:
          inputString.substring(0, 50) + (inputString.length > 50 ? '...' : ''),
      } as Record<string, unknown>;
    } else if (
      toolStart.toolInput &&
      Object.keys(toolStart.toolInput).length > 0
    ) {
      // Fallback to toolStart.toolInput for historical sessions
      // Historical session loading (SessionHistoryReaderService) populates
      // toolInput directly on ToolStartEvent - no accumulator parsing needed
      toolInput = toolStart.toolInput;
    } else {
      toolInput = undefined;
    }

    // Build nested children (RECURSIVE - sub-agent messages!)
    const children = this.buildToolChildren(toolStart.toolCallId, state, depth);

    return createExecutionNode({
      id: toolStart.id,
      type: 'tool',
      status: resultEvent ? 'complete' : 'streaming',
      content: null, // Content is null, not the JSON string
      toolInput, // Parsed JSON in correct field
      children,
      startTime: toolStart.timestamp,
      toolName: toolStart.toolName,
      toolCallId: toolStart.toolCallId,
      toolOutput: resultEvent?.output,
      isPermissionRequest: resultEvent?.isPermissionRequest,
    });
  }

  /**
   * Build children for a tool node (nested messages for agents)
   * This is RECURSIVE - agent tools contain nested message nodes
   *
   * @param toolCallId - Parent tool call ID
   * @param state - Streaming state
   * @param depth - Current recursion depth (default 0)
   * @returns Array of nested ExecutionNode objects
   */
  buildToolChildren(
    toolCallId: string,
    state: StreamingState,
    depth = 0,
  ): ExecutionNode[] {
    // Early exit if max depth exceeded
    if (depth >= MAX_DEPTH) {
      console.warn(
        '[ExecutionTreeBuilderService] Max recursion depth exceeded',
        {
          toolCallId,
          depth,
          maxDepth: MAX_DEPTH,
        },
      );
      return [];
    }

    const children: ExecutionNode[] = [];

    // Find all agent_start events where parentToolUseId = toolCallId
    const agentStarts = [...state.events.values()].filter(
      (e) => e.eventType === 'agent_start' && e.parentToolUseId === toolCallId,
    ) as AgentStartEvent[];

    // For each agent, create an AGENT node containing its messages.
    // Wave C7f: Delegate to AgentNodeBuilderService.buildAgentNode for byte-identical
    // output (the original buildToolChildren body duplicated ~110 LOC of buildAgentNode
    // with identical semantics — both paths use the parent toolCallId for stats /
    // status / background-agent lookup).
    for (const agentStart of agentStarts) {
      const agentNode = this.agentBuilder.buildAgentNode(
        agentStart,
        toolCallId,
        state,
        depth,
      );
      if (agentNode) {
        children.push(agentNode);
      }
    }

    return children;
  }
}
