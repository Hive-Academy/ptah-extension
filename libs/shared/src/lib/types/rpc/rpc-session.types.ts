/**
 * Session RPC Type Definitions
 *
 * Types for session:list, session:load, session:delete, session:validate,
 * session:cli-sessions, session:stats-batch
 */

import type { SessionId } from '../branded.types';
import type { ChatSessionSummary } from '../execution-node.types';

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
