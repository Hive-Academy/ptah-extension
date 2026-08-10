/**
 * Claude Domain Types - Shared types for Claude CLI integration
 * Used across extension and webview for tool events and streaming
 */

import { SessionId } from './branded.types';
import { ContentBlock } from './messages';

/**
 * Tool Event Types - For event bus communication
 */
export type ClaudeToolEventType = 'start' | 'progress' | 'result' | 'error';

export interface ClaudeToolEventStart {
  readonly type: 'start';
  readonly toolCallId: string;
  readonly tool: string;
  readonly args: Record<string, unknown>;
  readonly timestamp: number;
}

export interface ClaudeToolEventProgress {
  readonly type: 'progress';
  readonly toolCallId: string;
  readonly message: string;
  readonly timestamp: number;
}

export interface ClaudeToolEventResult {
  readonly type: 'result';
  readonly toolCallId: string;
  readonly output: unknown;
  readonly duration: number;
  readonly timestamp: number;
}

export interface ClaudeToolEventError {
  readonly type: 'error';
  readonly toolCallId: string;
  readonly error: string;
  readonly timestamp: number;
}

export type ClaudeToolEvent =
  | ClaudeToolEventStart
  | ClaudeToolEventProgress
  | ClaudeToolEventResult
  | ClaudeToolEventError;

/**
 * Content Chunk - Streaming content from Claude
 */
export interface ClaudeContentChunk {
  readonly type: 'content';
  readonly blocks: readonly ContentBlock[];
  readonly index?: number;
  readonly timestamp: number;
}

/**
 * Thinking Event - Claude's reasoning/thinking content
 */
export interface ClaudeThinkingEvent {
  readonly type: 'thinking';
  readonly content: string;
  readonly timestamp: number;
}

/**
 * Session Resume Info - For continuing conversations
 */
export interface ClaudeSessionResume {
  readonly sessionId: SessionId;
  readonly claudeSessionId: string; // Claude CLI's internal session ID
  readonly createdAt: number;
  readonly lastActivityAt: number;
}

/**
 * CLI Health Check Result
 */
export interface ClaudeCliHealth {
  readonly available: boolean;
  readonly path?: string;
  readonly version?: string;
  readonly responseTime?: number; // ms
  readonly error?: string;
  readonly platform: string; // Platform name (win32, darwin, linux, etc.)
  readonly isWSL: boolean;
}

/**
 * Model Selection Option
 */
export type ClaudeModel = 'opus' | 'sonnet' | 'haiku' | 'default';

/**
 * CLI Launch Options
 */
export interface ClaudeCliLaunchOptions {
  readonly sessionId: SessionId;
  readonly model?: ClaudeModel;
  readonly resumeSessionId?: string;
  readonly workspaceRoot?: string;
  readonly verbose?: boolean;
}

/**
 * Agent Event Types - For agent lifecycle tracking
 * Pattern: Follows ClaudeToolEvent discriminated union pattern (lines 77-151)
 *
 * These events track the lifecycle of agents spawned via the Task tool:
 * - agent_start: Agent initialization with prompt and configuration
 * - agent_activity: Tool execution activity within an agent
 * - agent_complete: Agent task completion with result
 */
export type ClaudeAgentEventType =
  | 'agent_start'
  | 'agent_activity'
  | 'agent_complete';

/**
 * Agent Start Event - Emitted when a new agent is spawned via Task tool
 */
export interface ClaudeAgentStartEvent {
  readonly type: 'agent_start';
  readonly agentId: string; // toolCallId from Task tool
  readonly subagentType: string; // args.subagent_type
  readonly description: string; // args.description
  readonly prompt: string; // args.prompt
  readonly model?: string; // args.model (optional)
  readonly timestamp: number;
}

/**
 * Agent Activity Event - Emitted when an agent executes a tool
 */
export interface ClaudeAgentActivityEvent {
  readonly type: 'agent_activity';
  readonly agentId: string; // parent_tool_use_id
  readonly toolName: string; // tool executed by agent
  readonly toolInput: Record<string, unknown>; // tool arguments
  readonly timestamp: number;
}

/**
 * Agent Complete Event - Emitted when an agent completes its task
 */
export interface ClaudeAgentCompleteEvent {
  readonly type: 'agent_complete';
  readonly agentId: string; // toolCallId from Task tool
  readonly duration: number; // milliseconds
  readonly result?: string; // tool_result output
  readonly timestamp: number;
}

/**
 * Agent Event Union - Discriminated union of all agent event types
 */
export type ClaudeAgentEvent =
  | ClaudeAgentStartEvent
  | ClaudeAgentActivityEvent
  | ClaudeAgentCompleteEvent;

/**
 * Session UI Data - Complete session metadata for UI display
 * Source: SessionManager.getSessionsUIData()
 * Purpose: Display session list with full metadata (token usage, active state, workspace)
 * Pattern: Single source of truth for session metadata across frontend and backend
 */
export interface SessionUIData {
  /** Unique session identifier */
  readonly id: string;
  /** Session name (user-provided or auto-generated) */
  readonly name: string;
  /** Workspace identifier (if applicable) */
  readonly workspaceId?: string;
  /** Total messages in session */
  readonly messageCount: number;
  /** Token usage statistics */
  readonly tokenUsage: {
    readonly input: number;
    readonly output: number;
    readonly total: number;
  };
  /** Session creation timestamp (Unix epoch milliseconds) */
  readonly createdAt: number;
  /** Last activity timestamp (Unix epoch milliseconds) */
  readonly lastActiveAt: number;
  /** Whether this session is currently active */
  readonly isActive: boolean;
}
