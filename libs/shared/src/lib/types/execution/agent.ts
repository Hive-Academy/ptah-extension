/**
 * Agent / chat-message wrappers for ExecutionNode-based chat UI.
 *
 * Extracted from execution-node.types.ts (TASK_2025_291 Wave C2) — zero behavior change.
 */

import type { ExecutionNode, MessageRole, MessageTokenUsage } from './node';

// ============================================================================
// EXECUTION CHAT MESSAGE WRAPPER
// ============================================================================

/**
 * AgentInfo - Metadata for agent-specific chat bubbles
 *
 * When a message is an agent bubble (extracted from parent assistant message),
 * this contains the agent's identifying information for custom styling.
 *
 * Agent bubbles have two sections:
 * 1. Summary Section - Real-time progress updates (XML-like format)
 * 2. Execution Section - Actual tool calls and detailed results
 *
 * During streaming, either section may be missing. The UI should gracefully
 * handle partial data and show appropriate loading states.
 */
export interface AgentInfo {
  /** Agent subtype (e.g., 'Explore', 'Plan', 'software-architect') */
  readonly agentType: string;

  /** Short description of the agent task */
  readonly agentDescription?: string;

  /** Model used by agent (opus, sonnet, haiku) */
  readonly agentModel?: string;

  /**
   * Summary content - The XML-like progress updates from the summary session.
   * Contains <function_calls>, <thinking>, etc. tags that show real-time progress.
   * May be undefined during streaming or if no summary session exists.
   */
  readonly summaryContent?: string;

  /**
   * Indicates if we expect a summary section (for streaming state).
   * When true but summaryContent is undefined, show a loading placeholder.
   */
  readonly hasSummary?: boolean;

  /**
   * Indicates if we have execution data (tool calls, results).
   * When true but streamingState is empty, show a loading placeholder.
   */
  readonly hasExecution?: boolean;

  /**
   * Indicates if this agent was interrupted (session closed mid-execution).
   * When true, show "interrupted" state instead of "in progress" loading spinner.
   * This happens when loading historical sessions that were not completed.
   */
  readonly isInterrupted?: boolean;

  /**
   * True while agent is actively streaming.
   * Used to show streaming indicators (typing cursor, loading spinner).
   */
  readonly isStreaming?: boolean;

  /**
   * Whether this agent is running in the background.
   * Background agents continue executing independently of the main turn.
   * When true, the agent card shows a background badge and different controls.
   */
  readonly isBackground?: boolean;

  /**
   * Links to parent Task tool_use ID for message updates.
   * Used during streaming to route nested content to the correct agent bubble.
   */
  readonly toolUseId?: string;
}

/**
 * ExecutionChatMessage - Top-level message wrapper for the ExecutionNode-based chat UI
 *
 * Each ExecutionChatMessage contains either:
 * - rawContent (for user messages): Plain text input
 * - streamingState (for assistant messages): Root ExecutionNode with nested children
 *
 * Note: Named "ExecutionChatMessage" to avoid conflict with legacy ChatMessage type
 */
export interface ExecutionChatMessage {
  /** Unique message identifier */
  readonly id: string;

  /** Message role */
  readonly role: MessageRole;

  /** Message timestamp (Unix epoch ms) */
  readonly timestamp: number;

  /**
   * Finalized execution tree (null during streaming)
   * This contains all nested content: text, thinking, tools, agents
   * Built from StreamingState after message completion.
   */
  readonly streamingState: ExecutionNode | null;

  /** Raw text content (for user messages) */
  readonly rawContent?: string;

  /** Attached file paths (for user messages with @ syntax) */
  readonly files?: readonly string[];

  /** Number of inline images sent with this message */
  readonly imageCount?: number;

  /** Session ID this message belongs to */
  readonly sessionId?: string;

  /**
   * Agent information (for extracted agent bubbles)
   * When present, this message is an agent execution extracted as a separate bubble.
   */
  readonly agentInfo?: AgentInfo;

  // ---- Usage Metrics (TASK_2025_047) ----

  /** Token usage for this message (aligned with Claude SDK) */
  readonly tokens?: MessageTokenUsage;

  /** Cost in USD for this message */
  readonly cost?: number;

  /** Duration in milliseconds for this message */
  readonly duration?: number;
}
