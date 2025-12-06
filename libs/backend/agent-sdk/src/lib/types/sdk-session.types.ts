/**
 * SDK Session Storage Types
 *
 * Custom session storage format with explicit parent-child relationships
 * to eliminate timestamp-based correlation bugs from CLI-based approach.
 *
 * Key Innovation: Explicit parentId field enables O(n) tree reconstruction
 * instead of O(n²) timestamp correlation that caused bugs in CLI integration.
 */

import { SessionId, MessageId } from '@ptah-extension/shared';
import { ExecutionNode } from '@ptah-extension/shared';

/**
 * Custom session message storage format
 * Explicit parent-child relationships eliminate correlation bugs
 */
export interface StoredSessionMessage {
  /**
   * Unique message identifier
   */
  readonly id: MessageId;

  /**
   * Explicit parent message reference
   * - null for root messages (first user message in conversation)
   * - MessageId for all other messages (forms explicit tree structure)
   *
   * Critical: This field enables O(n) tree reconstruction without timestamp guessing
   */
  readonly parentId: MessageId | null;

  /**
   * Links agent messages to their spawning Task tool_use
   * Present when this message is from a subagent spawned by Task tool
   */
  readonly agentToolUseId?: string;

  /**
   * Agent type from Task tool args.subagent_type
   * Helps identify which specialist agent generated this message
   * Example: 'backend-developer', 'frontend-developer', 'senior-tester'
   */
  readonly agentType?: string;

  /**
   * Message role (user, assistant, system)
   */
  readonly role: 'user' | 'assistant' | 'system';

  /**
   * Message content as ExecutionNode hierarchy
   * Recursive structure supports:
   * - Text nodes
   * - Thinking nodes
   * - Tool execution nodes
   * - Nested agent nodes (via Task tool)
   */
  readonly content: ExecutionNode[];

  /**
   * Message timestamp (for display, NOT for correlation)
   */
  readonly timestamp: number;

  /**
   * Model used for this message
   * Example: 'claude-sonnet-4.5-20250929'
   */
  readonly model: string;

  /**
   * Token usage for this message
   */
  readonly tokens?: {
    input: number;
    output: number;
  };

  /**
   * Cost for this message in USD
   */
  readonly cost?: number;
}

/**
 * Stored session with all messages and metadata
 */
export interface StoredSession {
  /**
   * Session identifier
   */
  readonly id: SessionId;

  /**
   * Workspace identifier (VS Code workspace folder path)
   */
  readonly workspaceId: string;

  /**
   * Session name (user-friendly label)
   */
  readonly name: string;

  /**
   * Session creation timestamp
   */
  readonly createdAt: number;

  /**
   * Last activity timestamp
   */
  readonly lastActiveAt: number;

  /**
   * All messages in this session
   * Includes explicit parent-child relationships via parentId field
   */
  readonly messages: StoredSessionMessage[];

  /**
   * Total token usage across all messages
   */
  readonly totalTokens: {
    input: number;
    output: number;
  };

  /**
   * Total cost across all messages in USD
   */
  readonly totalCost: number;
}
