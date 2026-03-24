/**
 * HistoryEventFactory - Creates FlatStreamEventUnion events for session history replay
 *
 * This service provides factory methods for creating all event types needed to
 * replay historical session data. It extracts the event creation logic from
 * SessionHistoryReaderService for better maintainability and testability.
 *
 * Features:
 * - Create message_start, text_delta, thinking_delta events
 * - Create tool_start, tool_result, agent_start events
 * - Create message_complete events
 * - Generate unique IDs for events and messages
 * - Extract text content from various content block formats
 *
 * @see TASK_2025_106 - Session History Reader Refactoring
 */

import { injectable } from 'tsyringe';
import type {
  MessageStartEvent,
  TextDeltaEvent,
  ThinkingDeltaEvent,
  ToolStartEvent,
  ToolResultEvent,
  AgentStartEvent,
  MessageCompleteEvent,
} from '@ptah-extension/shared';
import { isTaskToolInput, isAgentDispatchTool } from '@ptah-extension/shared';
import type { ContentBlock } from './history.types';

/**
 * Usage data for message completion events.
 * Includes token usage and estimated cost for per-message stats display.
 */
export interface MessageUsageData {
  /** Token counts (input/output) */
  tokenUsage?: { input: number; output: number };
  /** Estimated cost in USD */
  cost?: number;
  /** Model identifier (e.g., "claude-sonnet-4-20250514") */
  model?: string;
}

/**
 * Factory service for creating FlatStreamEventUnion events from session history.
 *
 * @injectable() decorator applied for consistency with other services in agent-sdk,
 * even though this factory has no dependencies. This allows for:
 * - Consistent DI patterns across the codebase
 * - Easy mocking in tests
 * - Future extension with injected dependencies if needed
 */
@injectable()
export class HistoryEventFactory {
  // ==========================================================================
  // MESSAGE EVENTS
  // ==========================================================================

  /**
   * Create a message_start event
   *
   * @param sessionId - Session identifier
   * @param messageId - Unique message identifier
   * @param role - Message role ('user' or 'assistant')
   * @param index - Event index for ID generation
   * @param timestamp - Event timestamp
   * @returns MessageStartEvent
   */
  createMessageStart(
    sessionId: string,
    messageId: string,
    role: 'user' | 'assistant',
    index: number,
    timestamp: number
  ): MessageStartEvent {
    return {
      eventType: 'message_start',
      id: `evt_${index}_${timestamp}`,
      sessionId,
      messageId,
      role,
      timestamp,
      source: 'history',
    };
  }

  /**
   * Create a message_complete event
   *
   * @param sessionId - Session identifier
   * @param messageId - Message identifier being completed
   * @param index - Event index for ID generation
   * @param timestamp - Event timestamp
   * @param usageData - Optional usage data (tokenUsage, cost, model) for per-message stats
   * @returns MessageCompleteEvent
   */
  createMessageComplete(
    sessionId: string,
    messageId: string,
    index: number,
    timestamp: number,
    usageData?: MessageUsageData
  ): MessageCompleteEvent {
    return {
      eventType: 'message_complete',
      id: `evt_${index}_${timestamp}`,
      sessionId,
      messageId,
      timestamp,
      source: 'history',
      // Include usage data for per-message stats display (TASK_2025_098 fix)
      ...(usageData?.tokenUsage && { tokenUsage: usageData.tokenUsage }),
      ...(usageData?.cost !== undefined && { cost: usageData.cost }),
      ...(usageData?.model && { model: usageData.model }),
    };
  }

  // ==========================================================================
  // CONTENT DELTA EVENTS
  // ==========================================================================

  /**
   * Create a text_delta event
   *
   * @param sessionId - Session identifier
   * @param messageId - Parent message identifier
   * @param text - Text content
   * @param blockIndex - Block index within message
   * @param index - Event index for ID generation
   * @param timestamp - Event timestamp
   * @returns TextDeltaEvent
   */
  createTextDelta(
    sessionId: string,
    messageId: string,
    text: string,
    blockIndex: number,
    index: number,
    timestamp: number
  ): TextDeltaEvent {
    return {
      eventType: 'text_delta',
      id: `evt_${index}_${timestamp}`,
      sessionId,
      messageId,
      blockIndex,
      delta: text,
      timestamp,
      source: 'history',
    };
  }

  /**
   * Create a thinking_delta event
   *
   * @param sessionId - Session identifier
   * @param messageId - Parent message identifier
   * @param thinking - Thinking content
   * @param blockIndex - Block index within message
   * @param index - Event index for ID generation
   * @param timestamp - Event timestamp
   * @returns ThinkingDeltaEvent
   */
  createThinkingDelta(
    sessionId: string,
    messageId: string,
    thinking: string,
    blockIndex: number,
    index: number,
    timestamp: number
  ): ThinkingDeltaEvent {
    return {
      eventType: 'thinking_delta',
      id: `evt_${index}_${timestamp}`,
      sessionId,
      messageId,
      blockIndex,
      delta: thinking,
      timestamp,
      source: 'history',
    };
  }

  // ==========================================================================
  // TOOL EVENTS
  // ==========================================================================

  /**
   * Create a tool_start event
   *
   * @param sessionId - Session identifier
   * @param messageId - Parent message identifier
   * @param toolCallId - Unique tool call identifier
   * @param toolName - Name of the tool being called
   * @param toolInput - Tool input parameters
   * @param index - Event index for ID generation
   * @param timestamp - Event timestamp
   * @returns ToolStartEvent
   */
  createToolStart(
    sessionId: string,
    messageId: string,
    toolCallId: string,
    toolName: string,
    toolInput: Record<string, unknown> | undefined,
    index: number,
    timestamp: number
  ): ToolStartEvent {
    return {
      eventType: 'tool_start',
      id: `evt_${index}_${timestamp}`,
      sessionId,
      messageId,
      toolCallId,
      toolName,
      toolInput,
      isTaskTool: isAgentDispatchTool(toolName),
      timestamp,
      source: 'history',
    };
  }

  /**
   * Create a tool_result event
   *
   * @param sessionId - Session identifier
   * @param messageId - Parent message identifier
   * @param toolCallId - Tool call identifier being responded to
   * @param output - Tool output content
   * @param isError - Whether the result is an error
   * @param index - Event index for ID generation
   * @param timestamp - Event timestamp
   * @returns ToolResultEvent
   */
  createToolResult(
    sessionId: string,
    messageId: string,
    toolCallId: string,
    output: string,
    isError: boolean,
    index: number,
    timestamp: number
  ): ToolResultEvent {
    return {
      eventType: 'tool_result',
      id: `evt_${index}_${timestamp}`,
      sessionId,
      messageId,
      toolCallId,
      output,
      isError,
      timestamp,
      source: 'history',
    };
  }

  // ==========================================================================
  // AGENT EVENTS
  // ==========================================================================

  /**
   * Create an agent_start event for Task tool spawning
   *
   * @param sessionId - Session identifier
   * @param messageId - Parent message identifier
   * @param toolCallId - Tool call identifier for the Task tool
   * @param input - Task tool input containing agent configuration
   * @param index - Event index for ID generation
   * @param timestamp - Event timestamp
   * @param parentToolUseId - Parent tool use ID for linking nested agents
   * @returns AgentStartEvent
   */
  createAgentStart(
    sessionId: string,
    messageId: string,
    toolCallId: string,
    input: Record<string, unknown>,
    index: number,
    timestamp: number,
    parentToolUseId?: string,
    agentId?: string
  ): AgentStartEvent {
    let agentType = 'unknown';
    let agentDescription: string | undefined;
    let agentPrompt: string | undefined;

    if (isTaskToolInput(input)) {
      agentType = input.subagent_type;
      agentDescription = input.description;
      agentPrompt = input.prompt;
    }

    return {
      eventType: 'agent_start',
      id: `evt_${index}_${timestamp}`,
      sessionId,
      messageId,
      toolCallId,
      agentType,
      agentDescription,
      agentPrompt,
      timestamp,
      parentToolUseId,
      agentId,
      source: 'history',
    };
  }

  // ==========================================================================
  // AGENT-SCOPED EVENTS (for nested agent messages)
  // ==========================================================================

  /**
   * Create a message_start event for agent-scoped messages.
   *
   * CRITICAL: TASK_2025_096 FIX - Must include parentToolUseId in event ID
   * to prevent collision when multiple agents are spawned in the same message block.
   *
   * @param sessionId - Session identifier
   * @param messageId - Unique message identifier (should include parentToolUseId)
   * @param index - Event index for ID generation
   * @param timestamp - Event timestamp
   * @param parentToolUseId - Parent tool use ID linking to parent Task tool
   * @returns MessageStartEvent with parentToolUseId
   */
  createAgentMessageStart(
    sessionId: string,
    messageId: string,
    index: number,
    timestamp: number,
    parentToolUseId: string
  ): MessageStartEvent {
    return {
      eventType: 'message_start',
      id: `evt_agent_${parentToolUseId}_${index}_${Math.floor(timestamp)}`,
      sessionId,
      messageId,
      parentToolUseId,
      role: 'assistant',
      timestamp,
      source: 'history',
    };
  }

  /**
   * Create a text_delta event for agent-scoped messages.
   *
   * @param sessionId - Session identifier
   * @param messageId - Parent message identifier
   * @param text - Text content
   * @param blockIndex - Block index within message
   * @param index - Event index for ID generation
   * @param timestamp - Event timestamp
   * @param parentToolUseId - Parent tool use ID linking to parent Task tool
   * @returns TextDeltaEvent with parentToolUseId
   */
  createAgentTextDelta(
    sessionId: string,
    messageId: string,
    text: string,
    blockIndex: number,
    index: number,
    timestamp: number,
    parentToolUseId: string
  ): TextDeltaEvent {
    return {
      eventType: 'text_delta',
      id: `evt_agent_${parentToolUseId}_${index}_${Math.floor(timestamp)}`,
      sessionId,
      messageId,
      parentToolUseId,
      blockIndex,
      delta: text,
      timestamp,
      source: 'history',
    };
  }

  /**
   * Create a tool_start event for agent-scoped tool calls.
   *
   * @param sessionId - Session identifier
   * @param messageId - Parent message identifier
   * @param toolCallId - Unique tool call identifier
   * @param toolName - Name of the tool being called
   * @param toolInput - Tool input parameters
   * @param index - Event index for ID generation
   * @param timestamp - Event timestamp
   * @param parentToolUseId - Parent tool use ID linking to parent Task tool
   * @returns ToolStartEvent with parentToolUseId
   */
  createAgentToolStart(
    sessionId: string,
    messageId: string,
    toolCallId: string,
    toolName: string,
    toolInput: Record<string, unknown> | undefined,
    index: number,
    timestamp: number,
    parentToolUseId: string
  ): ToolStartEvent {
    return {
      eventType: 'tool_start',
      id: `evt_agent_${parentToolUseId}_${index}_${Math.floor(timestamp)}`,
      sessionId,
      messageId,
      parentToolUseId,
      toolCallId,
      toolName,
      toolInput,
      isTaskTool: isAgentDispatchTool(toolName),
      timestamp,
      source: 'history',
    };
  }

  /**
   * Create a tool_result event for agent-scoped tool results.
   *
   * @param sessionId - Session identifier
   * @param messageId - Parent message identifier
   * @param toolCallId - Tool call identifier being responded to
   * @param output - Tool output content
   * @param isError - Whether the result is an error
   * @param index - Event index for ID generation
   * @param timestamp - Event timestamp
   * @param parentToolUseId - Parent tool use ID linking to parent Task tool
   * @returns ToolResultEvent with parentToolUseId
   */
  createAgentToolResult(
    sessionId: string,
    messageId: string,
    toolCallId: string,
    output: string,
    isError: boolean,
    index: number,
    timestamp: number,
    parentToolUseId: string
  ): ToolResultEvent {
    return {
      eventType: 'tool_result',
      id: `evt_agent_${parentToolUseId}_${index}_${Math.floor(timestamp)}`,
      sessionId,
      messageId,
      parentToolUseId,
      toolCallId,
      output,
      isError,
      timestamp,
      source: 'history',
    };
  }

  /**
   * Create a message_complete event for agent-scoped messages.
   *
   * @param sessionId - Session identifier
   * @param messageId - Message identifier being completed
   * @param index - Event index for ID generation
   * @param timestamp - Event timestamp
   * @param parentToolUseId - Parent tool use ID linking to parent Task tool
   * @param usageData - Optional usage data (tokenUsage, cost, model) for per-message stats
   * @returns MessageCompleteEvent with parentToolUseId
   */
  createAgentMessageComplete(
    sessionId: string,
    messageId: string,
    index: number,
    timestamp: number,
    parentToolUseId: string,
    usageData?: MessageUsageData
  ): MessageCompleteEvent {
    return {
      eventType: 'message_complete',
      id: `evt_agent_${parentToolUseId}_${index}_${Math.floor(timestamp)}`,
      sessionId,
      messageId,
      parentToolUseId,
      timestamp,
      source: 'history',
      // Include usage data for per-message stats display (TASK_2025_098 fix)
      ...(usageData?.tokenUsage && { tokenUsage: usageData.tokenUsage }),
      ...(usageData?.cost !== undefined && { cost: usageData.cost }),
      ...(usageData?.model && { model: usageData.model }),
    };
  }

  // ==========================================================================
  // UTILITIES
  // ==========================================================================

  /**
   * Generate a unique message ID
   *
   * @returns Unique message ID string
   */
  generateId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Extract text content from various content block formats
   *
   * Handles:
   * - String content (returns as-is)
   * - Array of ContentBlocks (extracts and joins text blocks)
   * - Other formats (returns empty string)
   *
   * @param content - Content in various formats
   * @returns Extracted text content
   */
  extractTextContent(content: unknown): string {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return (content as ContentBlock[])
        .filter((b) => b.type === 'text')
        .map((b) => b.text || '')
        .join('\n');
    }
    return '';
  }
}
