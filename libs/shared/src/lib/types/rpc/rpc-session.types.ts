/**
 * Session RPC Type Definitions
 *
 * Types for session:list, session:load, session:delete, session:validate,
 * session:cli-sessions, session:stats-batch
 */

import type { SessionId } from '../branded.types';
import type { ChatSessionSummary } from '../execution';

// ============================================================
// Session RPC Types
// ============================================================

/** Parameters for session:list RPC method */
export interface SessionListParams {
  /** Workspace path to list sessions for */
  workspacePath: string;
  /** Maximum number of sessions to return */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

/** Response from session:list RPC method */
export interface SessionListResult {
  sessions: ChatSessionSummary[];
  total: number;
  hasMore: boolean;
}

/** Parameters for session:load RPC method */
export interface SessionLoadParams {
  /** Session ID to load */
  sessionId: SessionId;
}

/**
 * Response from session:load RPC method
 *
 * NOTE: This is metadata-only validation. Actual conversation messages
 * are loaded via chat:resume, which triggers SDK to replay history.
 * The empty messages array is intentional - see TASK_2025_088.
 */
export interface SessionLoadResult {
  sessionId: SessionId;
  /** Always empty - messages come from chat:resume RPC call */
  messages: [];
  /** Always empty - SDK handles all session data */
  agentSessions: [];
}

/** Parameters for session:delete RPC method (TASK_2025_086) */
export interface SessionDeleteParams {
  /** Session ID to delete */
  sessionId: SessionId;
}

/** Response from session:delete RPC method */
export interface SessionDeleteResult {
  success: boolean;
  error?: string;
}

/** Parameters for session:rename RPC method */
export interface SessionRenameParams {
  /** Session ID to rename */
  sessionId: SessionId;
  /** New session name */
  name: string;
}

/** Response from session:rename RPC method */
export interface SessionRenameResult {
  success: boolean;
  error?: string;
}

/** Parameters for session:validate RPC method */
export interface SessionValidateParams {
  /** Session ID to validate */
  sessionId: SessionId;
  /** Workspace path to find the sessions directory */
  workspacePath: string;
}

/** Response from session:validate RPC method */
export interface SessionValidateResult {
  /** Whether the session file exists on disk */
  exists: boolean;
  /** Full path to the session file (if it exists) */
  filePath?: string;
}

/** Parameters for session:cli-sessions RPC method */
export interface SessionCliSessionsParams {
  /** Parent session ID to get CLI sessions for */
  sessionId: string;
}

/** Response from session:cli-sessions RPC method */
export interface SessionCliSessionsResult {
  /** CLI session references from session metadata */
  cliSessions: import('../agent-process.types').CliSessionReference[];
}

// ============================================================
// Session Stats Batch RPC Types (TASK_2025_206 v2)
// ============================================================

/** Per-session stats returned from JSONL reading */
export interface SessionStatsEntry {
  /** Session ID */
  readonly sessionId: string;
  /** Detected model from JSONL init message */
  readonly model: string | null;
  /** Total cost in USD (calculated with model-aware pricing) */
  readonly totalCost: number;
  /** Token breakdown */
  readonly tokens: {
    readonly input: number;
    readonly output: number;
    readonly cacheRead: number;
    readonly cacheCreation: number;
  };
  /** Number of assistant messages */
  readonly messageCount: number;
  /** Number of agent/subagent JSONL files found for this session */
  readonly agentSessionCount?: number;
  /** CLI agent types used in this session (e.g., ['gemini', 'copilot']) */
  readonly cliAgents?: readonly string[];
  /** Per-model usage breakdown (model, input/output tokens, cost) */
  readonly modelUsageList?: ReadonlyArray<{
    readonly model: string;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly costUSD: number;
  }>;
  /** Whether stats were successfully read from JSONL */
  readonly status: 'ok' | 'error' | 'empty';
}

/** Parameters for session:stats-batch RPC method */
export interface SessionStatsBatchParams {
  /** Session IDs to fetch stats for */
  readonly sessionIds: string[];
  /** Workspace path (for locating JSONL files) */
  readonly workspacePath: string;
}

/** Response from session:stats-batch RPC method */
export interface SessionStatsBatchResult {
  /** Stats for each requested session (order matches sessionIds) */
  readonly sessionStats: SessionStatsEntry[];
}

// ============================================================
// Session Fork / Rewind RPC Types
// ============================================================
//
// `shared` is Layer 0 — it cannot import from `@ptah-extension/agent-sdk`
// or from the upstream `@anthropic-ai/claude-agent-sdk` package. Instead,
// `SessionRewindResult` is a structurally equivalent redeclaration of the
// SDK's `RewindFilesResult` shape (see
// libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts —
// `Query.rewindFiles()` return type). Backend code that adapts from the
// SDK's type to this one relies on structural assignability.

/** Parameters for session:forkSession RPC method */
export interface SessionForkParams {
  /** Source session UUID to fork from */
  sessionId: SessionId;
  /** Optional message UUID to slice the transcript at (inclusive) */
  upToMessageId?: string;
  /** Optional title for the new fork (defaults to "<original> (fork)") */
  title?: string;
}

/** Response from session:forkSession RPC method */
export interface SessionForkResult {
  /** UUID of the newly created forked session */
  newSessionId: SessionId;
}

/** Parameters for session:rewindFiles RPC method */
export interface SessionRewindParams {
  /** Active session whose tracked files should be rewound */
  sessionId: SessionId;
  /** UUID of the user message to rewind file state to */
  userMessageId: string;
  /**
   * When true, returns the planned changes without modifying files on disk.
   * Useful for previewing the rewind diff before committing.
   */
  dryRun?: boolean;
}

/**
 * Response from session:rewindFiles RPC method.
 *
 * Mirrors the structural shape of the SDK's `RewindFilesResult` so backend
 * code can return SDK results directly without conversion. The SDK reports
 * `canRewind: false` plus an `error` string when checkpointing is disabled
 * or no checkpoint exists for the requested message.
 */
export interface SessionRewindResult {
  /** Whether the rewind can/did proceed (false when checkpointing is disabled). */
  canRewind: boolean;
  /** Human-readable error message when `canRewind` is false. */
  error?: string;
  /** Absolute paths of files that were (or would be) modified. */
  filesChanged?: string[];
  /** Total lines inserted across all files in the rewind diff. */
  insertions?: number;
  /** Total lines deleted across all files in the rewind diff. */
  deletions?: number;
}
