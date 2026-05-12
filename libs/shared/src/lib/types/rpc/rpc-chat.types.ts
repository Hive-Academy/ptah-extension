/**
 * Chat RPC Type Definitions
 *
 * Types for chat:start, chat:continue, chat:abort, chat:running-agents, chat:resume
 */

import type { SessionId } from '../branded.types';
import type { ThinkingConfig, EffortLevel } from '../ai-provider.types';
import type { FlatStreamEventUnion } from '../execution';

/**
 * Minimal HTTP-flavored MCP server descriptor used by the
 * `ChatStartParams.mcpServersOverride` escape hatch (TASK_2026_104 P2 — proxy).
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

// ============================================================
// Chat RPC Types
// ============================================================

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
  /** Ptah CLI agent instance ID (TASK_2025_170: routes to Ptah CLI agent adapter) */
  ptahCliId?: string;
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
    /** TASK_2025_184: Thinking/reasoning configuration */
    thinking?: ThinkingConfig;
    /** TASK_2025_184: Effort level for reasoning depth */
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
   *
   * TASK_2026_104 P2 — proxy.
   */
  mcpServersOverride?: Record<string, McpHttpServerOverride>;
}

/** Response from chat:start RPC method */
export interface ChatStartResult {
  success: boolean;
  sessionId?: SessionId;
  error?: string;
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
  /** TASK_2025_184: Thinking/reasoning configuration */
  thinking?: ThinkingConfig;
  /** TASK_2025_184: Effort level for reasoning depth */
  effort?: EffortLevel;
}

/** Response from chat:continue RPC method */
export interface ChatContinueResult {
  success: boolean;
  sessionId?: SessionId;
  error?: string;
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
}

/** Parameters for chat:running-agents RPC method (TASK_2025_185) */
export interface ChatRunningAgentsParams {
  /** Session ID to query running agents for */
  sessionId: SessionId;
}

/** Response from chat:running-agents RPC method (TASK_2025_185) */
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
   * TASK_2025_092: Added for consistent event routing.
   */
  tabId: string;
  /** Workspace path (needed for session context) */
  workspacePath?: string;
  /** Model to use (if different from session's original model) */
  model?: string;
  /** Ptah CLI agent instance ID (TASK_2025_170: routes to Ptah CLI agent adapter) */
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
   * Complete history messages (for session resume/replay)
   * TASK_2025_092: Returns complete messages directly instead of streaming events
   * @deprecated Use `events` instead - messages only contain text, not tool calls
   */
  messages?: {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
  }[];
  /**
   * Full streaming events for session history replay
   * TASK_2025_092 FIX: Includes tool_start, tool_result, thinking, agent_start events
   * Frontend processes these through StreamingHandler to build ExecutionNode tree
   */
  events?: FlatStreamEventUnion[];
  /**
   * Aggregated usage stats from session history
   * Extracted from JSONL message.usage fields for old session cost display
   */
  stats?: {
    totalCost: number;
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
      costUSD: number;
    }>;
  } | null;
  /**
   * Resumable subagents for this session (TASK_2025_103 FIX)
   * Frontend uses this to mark agent nodes as resumable when loading from history.
   * Populated from SubagentRegistryService.getResumableBySession().
   */
  resumableSubagents?: import('../subagent-registry.types').SubagentRecord[];
  /**
   * CLI agent sessions linked to this parent session (TASK_2025_161/168)
   * Enables displaying and resuming CLI sessions (e.g., Gemini) when loading saved sessions.
   * Populated from SessionMetadataStore.cliSessions[].
   */
  cliSessions?: import('../agent-process.types').CliSessionReference[];
  /**
   * `true` when a live SDK Query was started during this resume call.
   * Only populated when the request included `activate: true`.
   */
  activated?: boolean;
  error?: string;
}
