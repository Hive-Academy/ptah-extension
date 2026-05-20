/**
 * Agent event / tool execution / CLI wire payloads.
 */

import type { SessionId } from '../branded.types';
import type {
  ClaudeAgentStartEvent,
  ClaudeAgentActivityEvent,
  ClaudeAgentCompleteEvent,
} from '../claude-domain.types';

/**
 * Agent Event Payloads - For agent lifecycle tracking
 * Used for chat:agentStarted, chat:agentActivity, chat:agentCompleted message types
 */
export interface ChatAgentStartedPayload {
  readonly sessionId: SessionId;
  readonly agent: ClaudeAgentStartEvent;
}

export interface ChatAgentActivityPayload {
  readonly sessionId: SessionId;
  readonly agent: ClaudeAgentActivityEvent;
}

export interface ChatAgentCompletedPayload {
  readonly sessionId: SessionId;
  readonly agent: ClaudeAgentCompleteEvent;
}

/**
 * Thinking event payload (Claude's reasoning process)
 */
export interface ChatThinkingPayload {
  readonly sessionId: SessionId;
  readonly content: string;
  readonly timestamp: number;
}

/**
 * Tool execution start payload
 */
export interface ChatToolStartPayload {
  readonly sessionId: SessionId;
  readonly toolCallId: string;
  readonly tool: string;
  readonly args: Record<string, unknown>;
  readonly timestamp: number;
}

/**
 * Tool execution progress payload
 */
export interface ChatToolProgressPayload {
  readonly sessionId: SessionId;
  readonly toolCallId: string;
  readonly message: string;
  readonly timestamp: number;
}

/**
 * Tool execution result payload
 */
export interface ChatToolResultPayload {
  readonly sessionId: SessionId;
  readonly toolCallId: string;
  readonly output: unknown;
  readonly duration: number;
  readonly timestamp: number;
}

/**
 * Tool execution error payload
 */
export interface ChatToolErrorPayload {
  readonly sessionId: SessionId;
  readonly toolCallId: string;
  readonly error: string;
  readonly timestamp: number;
}

/**
 * CLI session initialization payload
 */
export interface ChatSessionInitPayload {
  readonly sessionId: SessionId;
  readonly claudeSessionId: string;
  readonly model?: string;
  readonly timestamp: number;
}

/**
 * CLI health update payload
 */
export interface ChatHealthUpdatePayload {
  readonly available: boolean;
  readonly version?: string;
  readonly responseTime?: number;
  readonly error?: string;
  readonly timestamp: number;
}

/**
 * CLI error payload
 */
export interface ChatCliErrorPayload {
  readonly sessionId?: SessionId;
  readonly error: string;
  readonly context?: Record<string, unknown>;
  readonly timestamp: number;
}
