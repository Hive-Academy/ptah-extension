/**
 * History Types Module
 *
 * Centralized type definitions for session history processing services.
 * Extracted from session-history-reader.service.ts for better maintainability.
 *
 * @see TASK_2025_106 - Session History Reader Refactoring
 */

import type { JSONLMessage } from '@ptah-extension/shared';
import type { ClaudeApiUsage } from '../usage-extraction.utils';

// ============================================================================
// JSONL FILE TYPES
// ============================================================================

/**
 * Raw JSONL message line from Claude session files.
 * This is the actual format stored in .jsonl files.
 */
export interface JsonlMessageLine {
  uuid: string;
  sessionId: string;
  timestamp: string;
  cwd?: string;
  type?: string;
  /** Subtype for system messages (e.g., 'init', 'compact_boundary', 'status') */
  subtype?: string;
  /** Model identifier from system init messages (e.g., 'claude-sonnet-4-20250514') */
  model?: string;
  message?: {
    role: string;
    content: string | ContentBlock[];
    /** Claude API usage data - present on assistant messages */
    usage?: {
      input_tokens: number;
      output_tokens: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
  isMeta?: boolean;
  slug?: string;
}

/**
 * Extended message type for session history processing.
 * Uses Omit to override the `message` property from JSONLMessage with
 * a version that includes the `role` field present in actual JSONL files.
 *
 * Fields added for:
 * - Session matching (sessionId)
 * - Correlation (timestamp)
 * - Warmup filtering (slug, isMeta)
 * - Message tracking (uuid)
 * - Usage stats extraction
 */
export interface SessionHistoryMessage extends Omit<JSONLMessage, 'message'> {
  readonly uuid?: string;
  readonly sessionId?: string;
  readonly timestamp?: string;
  readonly isMeta?: boolean;
  readonly slug?: string;
  /** Model identifier from system init messages (e.g., 'claude-sonnet-4-20250514') */
  readonly model?: string;
  /** Claude API usage data from assistant messages */
  readonly usage?: ClaudeApiUsage;
  /** Message with role field - actual JSONL format */
  readonly message?: {
    readonly role?: string;
    /** Model identifier from Claude API response (e.g., 'claude-sonnet-4-20250514') */
    readonly model?: string;
    readonly content?: readonly ContentBlock[] | string;
    readonly stop_reason?: string;
    readonly usage?: {
      readonly input_tokens?: number;
      readonly output_tokens?: number;
      readonly cache_read_input_tokens?: number;
      readonly cache_creation_input_tokens?: number;
    };
  };
}

// ============================================================================
// CONTENT TYPES
// ============================================================================

/**
 * Content block within a message.
 * Can be text, thinking, tool_use, or tool_result.
 */
export interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string | unknown[];
  is_error?: boolean;
}

// ============================================================================
// AGENT & SESSION TYPES
// ============================================================================

/**
 * Data structure for an agent session.
 * Contains all messages from a linked agent file (agent-*.jsonl).
 */
export interface AgentSessionData {
  agentId: string;
  filePath: string;
  messages: SessionHistoryMessage[];
}

/**
 * Tool result data extracted from user messages.
 * Used to link tool_result blocks to their corresponding tool_use.
 */
export interface ToolResultData {
  content: string;
  isError: boolean;
}

// ============================================================================
// CORRELATION TYPES
// ============================================================================

/**
 * Agent data map entry for correlation.
 * Built from AgentSessionData, filtered to exclude warmup agents.
 */
export interface AgentDataMapEntry {
  agentId: string;
  timestamp: number;
  executionMessages: SessionHistoryMessage[];
}

/**
 * Task tool_use extracted from assistant messages.
 * Used for timestamp-based correlation with agent sessions.
 */
export interface TaskToolUse {
  toolUseId: string;
  timestamp: number;
  subagentType: string;
  /** Agent ID from `resume` field in Task tool input — enables direct correlation */
  resumeAgentId?: string;
}
