/**
 * Chat RPC Type Definitions
 *
 * Types for chat:start, chat:continue, chat:abort, chat:running-agents, chat:resume
 */

import type { SessionId } from '../branded.types';
import type { ThinkingConfig, EffortLevel } from '../ai-provider.types';
import type { FlatStreamEventUnion } from '../execution';
import type { RpcUserErrorCode } from './rpc-error-codes.types';

/**
 * Minimal HTTP-flavored MCP server descriptor used by the
 * `ChatStartParams.mcpServersOverride` escape hatch (proxy).
 *
 * Mirrors the load-bearing subset of `McpHttpServerConfig` from
 * `@anthropic-ai/claude-agent-sdk` so the shared layer doesn't need to import
 * the SDK directly. The agent-sdk consumer (`SdkQueryOptionsBuilder`) widens
 * each entry back to `McpHttpServerConfig` before passing to the SDK.
 */
export interface McpHttpServerOverride {
  readonly type: 'http';
  readonly url: string;
  readonly headers?: Record<string, string>;
}

/** Inline image attachment (pasted or dropped into chat) */
export interface InlineImageAttachment {
  /** Base64-encoded image data (no data URI prefix) */
  data: string;
  /** MIME type (e.g., 'image/png', 'image/jpeg') */
  mediaType: string;
}

export interface ChatStartParams {
  /** Initial prompt to send (optional) */
  prompt?: string;
  /**
   * Tab ID for frontend correlation (REQUIRED for new conversations)
   * Backend uses this to route streaming events back to the correct tab.
   * This replaces the previous placeholder sessionId pattern.
   */
  tabId: string;
  /** User-provided session name (optional) */
  name?: string;
  /** Workspace path for context */
  workspacePath?: string;
  /** Ptah CLI agent instance ID (routes to Ptah CLI agent adapter) */
  ptahCliId?: string;
  /**
   * When `true`, this session drives an in-surface workflow (setup wizard /
   * harness builder) rather than the standard chat surface. Threaded through
   * streaming payloads so the consuming surface can route events to its own UI.
   */
  surfaceMode?: boolean;
  /** Additional options */
  options?: {
    model?: string;
    systemPrompt?: string;
    files?: string[];
    /** Inline images (pasted/dropped) to include with the message */
    images?: InlineImageAttachment[];
    /**
     * System prompt preset selection.
     * - 'claude_code': Default preset with minimal customization
     * - 'enhanced': AI-generated project-specific guidance (requires enhanced prompts generated)
     *
     * If not specified, defaults to 'enhanced' if enhanced prompts are available,
     * otherwise falls back to 'claude_code'.
     */
    preset?: 'claude_code' | 'enhanced';
    /** Thinking/reasoning configuration */
    thinking?: ThinkingConfig;
    /** Effort level for reasoning depth */
    effort?: EffortLevel;
    /**
     * Opt-in to SDK `SDKPartialAssistantMessage` (`stream_event`) emissions
     * for finer-grained streaming deltas. Forwarded to the Claude Agent SDK
     * as `Options.includePartialMessages`. Defaults to ON at the SDK
     * plumbing layer when omitted, preserving historical Ptah behavior.
     * Pass `false` to opt out (lower event volume).
     */
    includePartialMessages?: boolean;
  };
  /**
   * Caller-supplied MCP server map. When present, merged OVER the registry-
   * resolved MCP server map by `SdkQueryOptionsBuilder.buildMcpServers` —
   * caller wins on key collision so the Anthropic-compatible HTTP proxy can
   * inject workspace MCP tools per-request without disturbing the shared
   * registry.
   *
   * Currently scoped to HTTP transports only — stdio and SSE overrides are
   * out of scope for the P2 proxy MVP (the proxy itself talks HTTP).
   *
   * Symmetric with the `includePartialMessages` opt-in above — both are
   * surfaced via the same `ChatStartParams` envelope so the proxy and other
   * advanced callers get a uniform extension surface without per-feature RPCs.
   */
  mcpServersOverride?: Record<string, McpHttpServerOverride>;
}

/** Response from chat:start RPC method */
export interface ChatStartResult {
  success: boolean;
  sessionId?: SessionId;
  error?: string;
  /** Structured error code for recoverable failures (e.g. 'AUTH_REQUIRED'). */
  errorCode?: RpcUserErrorCode;
  /** Provider whose auth is required, when errorCode is 'AUTH_REQUIRED'. */
  providerId?: string;
}

export interface ChatContinueParams {
  /** Message content to send */
  prompt: string;
  /** Session ID to continue (REQUIRED - must be real SDK UUID for resume) */
  sessionId: SessionId;
  /**
   * Tab ID for frontend correlation (REQUIRED)
   * Backend uses this to route streaming events back to the correct tab.
   */
  tabId: string;
  /** User-provided session name (optional - for late naming) */
  name?: string;
  /** Workspace path (needed for session resumption if session is not active) */
  workspacePath?: string;
  /** Model to use (if different from current session model) */
  model?: string;
  /** File paths to include with the message */
  files?: string[];
  /** Inline images (pasted/dropped) to include with the message */
  images?: InlineImageAttachment[];
  /** Thinking/reasoning configuration */
  thinking?: ThinkingConfig;
  /** Effort level for reasoning depth */
  effort?: EffortLevel;
  /**
   * When `true`, this session drives an in-surface workflow (setup wizard /
   * harness builder) rather than the standard chat surface. Threaded through
   * streaming payloads so the consuming surface can route events to its own UI.
   */
  surfaceMode?: boolean;
}

/** Response from chat:continue RPC method */
export interface ChatContinueResult {
  success: boolean;
  sessionId?: SessionId;
  error?: string;
  /** Structured error code for recoverable failures (e.g. 'AUTH_REQUIRED'). */
  errorCode?: RpcUserErrorCode;
  /** Provider whose auth is required, when errorCode is 'AUTH_REQUIRED'. */
  providerId?: string;
}

/** Parameters for chat:abort RPC method */
export interface ChatAbortParams {
  /** Session ID to abort */
  sessionId: SessionId;
}

/** Response from chat:abort RPC method */
export interface ChatAbortResult {
  success: boolean;
  error?: string;
  /**
   * Subagents that were interrupted by this abort and can be resumed.
   * Populated from SubagentRegistryService.getResumableBySession() so the
   * frontend can surface the resume banner without reloading the session.
   */
  resumableSubagents?: import('../subagent-registry.types').SubagentRecord[];
}

/** Parameters for chat:running-agents RPC method */
export interface ChatRunningAgentsParams {
  /** Session ID to query running agents for */
  sessionId: SessionId;
}

/** Response from chat:running-agents RPC method */
export interface ChatRunningAgentsResult {
  /** List of currently running (non-background) agents */
  agents: { agentId: string; agentType: string }[];
}

/** Parameters for chat:resume RPC method */
export interface ChatResumeParams {
  /** Session ID to resume */
  sessionId: SessionId;
  /**
   * Tab ID for frontend correlation (REQUIRED)
   * Backend uses this to route streaming events back to the correct tab.
   */
  tabId: string;
  /** Workspace path (needed for session context) */
  workspacePath?: string;
  /** Model to use (if different from session's original model) */
  model?: string;
  /** Ptah CLI agent instance ID (routes to Ptah CLI agent adapter) */
  ptahCliId?: string;
  /**
   * When `true`, backend also activates a live SDK Query alongside loading history.
   * Without this flag, chat:resume is history-load only and does NOT start an SDK Query.
   * Required for the resume-and-retry rewind path.
   */
  activate?: boolean;
}

/** Response from chat:resume RPC method */
export interface ChatResumeResult {
  success: boolean;
  sessionId?: SessionId;
  /**
   * Complete history messages (for session resume/replay).
   * Returns complete messages directly instead of streaming events.
   * @deprecated Use `events` instead - messages only contain text, not tool calls
   */
  messages?: {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
  }[];
  /**
   * Full streaming events for session history replay.
   * Includes tool_start, tool_result, thinking, agent_start events.
   * Frontend processes these through StreamingHandler to build ExecutionNode tree.
   */
  events?: FlatStreamEventUnion[];
  /**
   * Aggregated usage stats from session history
   * Extracted from JSONL message.usage fields for old session cost display
   */
  stats?: {
    totalCost: number | null;
    tokens: {
      input: number;
      output: number;
      cacheRead: number;
      cacheCreation: number;
    };
    messageCount: number;
    model?: string;
    /** Number of agent/subagent JSONL files found for this session */
    agentSessionCount?: number;
    /** Per-model token and cost breakdown for multi-model sessions */
    modelUsageList?: Array<{
      model: string;
      inputTokens: number;
      outputTokens: number;
      costUSD: number | null;
    }>;
  } | null;
  /**
   * Resumable subagents for this session.
   * Frontend uses this to mark agent nodes as resumable when loading from history.
   * Populated from SubagentRegistryService.getResumableBySession().
   */
  resumableSubagents?: import('../subagent-registry.types').SubagentRecord[];
  /**
   * CLI agent sessions linked to this parent session.
   * Enables displaying and resuming CLI sessions (e.g., Gemini) when loading saved sessions.
   * Populated from SessionMetadataStore.cliSessions[].
   */
  cliSessions?: import('../agent-process.types').CliSessionReference[];
  /**
   * `true` when a live SDK Query was started during this resume call.
   * Only populated when the request included `activate: true`.
   */
  activated?: boolean;
  /**
   * Human-readable activation failure message, populated when the request
   * included `activate: true` AND the backend `autoResumeIfInactive` helper
   * returned `{ error }`. The outer `success` field stays `true` because the
   * history load succeeded; callers branch on `activated === false &&
   * activationError` to surface the resume-and-retry failure without losing
   * the loaded transcript.
   */
  activationError?: string;
  /**
   * Structured activation failure code mirroring `errorCode`, populated under
   * the same conditions as `activationError`.
   */
  activationErrorCode?: RpcUserErrorCode;
  error?: string;
  /** Structured error code for recoverable failures (e.g. 'AUTH_REQUIRED'). */
  errorCode?: RpcUserErrorCode;
  /** Provider whose auth is required, when errorCode is 'AUTH_REQUIRED'. */
  providerId?: string;
}
