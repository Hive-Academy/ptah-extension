/**
 * Strict chat message / session state types.
 *
 * Extracted from message.types.ts (TASK_2025_291 Wave C2) — zero behavior change.
 */

import type { SessionId, MessageId } from '../branded.types';
import type { ContentBlock } from '../content-block.types';

/**
 * Strict Chat Message (replaces loose ChatMessage from common.types.ts)
 */
export interface StrictChatMessage {
  readonly id: MessageId;
  readonly sessionId: SessionId;
  readonly type: 'user' | 'assistant' | 'system';
  readonly contentBlocks: readonly ContentBlock[];
  readonly timestamp: number;
  readonly streaming?: boolean;
  readonly files?: readonly string[];
  readonly isError?: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
  // For assistant messages
  readonly isComplete?: boolean;
  // For system messages
  readonly level?: 'info' | 'warning' | 'error';

  // NEW: Missing fields for full message lifecycle (TASK_2025_008 - Batch 2)
  readonly cost?: number; // Message cost in USD
  readonly tokens?: {
    // Token breakdown
    readonly input: number;
    readonly output: number;
    readonly cacheHit?: number;
  };
  readonly duration?: number; // Processing time in ms
}

/**
 * MCP Server Information
 * Used in SessionCapabilities to track connected MCP servers
 */
export interface MCPServerInfo {
  readonly name: string;
  readonly status: 'connected' | 'disabled' | 'failed';
  readonly tools?: readonly string[];
}

/**
 * Session Capabilities
 * Tracks AI agent capabilities available in a session
 */
export interface SessionCapabilities {
  readonly cwd: string;
  readonly model: string;
  readonly tools: readonly string[];
  readonly agents: readonly string[];
  readonly slash_commands: readonly string[];
  readonly mcp_servers: readonly MCPServerInfo[];
  readonly claude_code_version: string;
}

/**
 * Strict Chat Session (replaces loose ChatSession from common.types.ts)
 */
export interface StrictChatSession {
  readonly id: SessionId;
  readonly name: string;
  readonly workspaceId?: string;
  readonly messages: readonly StrictChatMessage[];
  readonly createdAt: number;
  readonly lastActiveAt: number;
  readonly updatedAt: number; // Alias for lastActiveAt for UI compatibility
  readonly messageCount: number; // Derived field for UI
  readonly tokenUsage: Readonly<{
    input: number;
    output: number;
    total: number;
    percentage: number;
    maxTokens?: number;
  }>;

  // NEW: Missing fields for IMPLEMENTATION_PLAN compatibility (TASK_2025_008 - Batch 2)
  readonly capabilities?: SessionCapabilities; // AI agent capabilities
  readonly model?: string; // Active model (e.g., "claude-sonnet-4")
  readonly totalCost?: number; // Cumulative cost in USD
  readonly totalTokensInput?: number; // Cumulative input tokens
  readonly totalTokensOutput?: number; // Cumulative output tokens
}
