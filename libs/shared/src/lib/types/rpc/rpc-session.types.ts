/**
 * Session RPC Type Definitions
 *
 * Types for session:list, session:load, session:delete, session:validate,
 * session:cli-sessions, session:stats-batch
 */

import type { SessionId } from '../branded.types';
import type { ChatSessionSummary } from '../execution';
import type {
  SdkCompactionCompletePayload,
  SdkSubagentEndedPayload,
  SdkTurnEndedPayload,
  SdkTurnFailedPayload,
} from '../sdk-hook.types';

/**
 * Notification params for `MESSAGE_TYPES.SESSION_COMPACTION_COMPLETE`
 * (`'session:compactionComplete'`).
 *
 * Backend → webview push, not an inbound RPC method — alias kept here so
 * frontend session-lifecycle consumers import a single named type instead
 * of reaching into `sdk-hook.types.ts` directly.
 */
export type SessionCompactionCompleteParams = SdkCompactionCompletePayload;

/**
 * Notification params for `MESSAGE_TYPES.SESSION_TURN_ENDED`
 * (`'session:turnEnded'`).
 *
 * Backend → webview push, not an inbound RPC method — alias kept here so
 * frontend session-lifecycle consumers import a single named type instead
 * of reaching into `sdk-hook.types.ts` directly.
 */
export type SessionTurnEndedParams = SdkTurnEndedPayload;

/**
 * Notification params for `MESSAGE_TYPES.SESSION_TURN_FAILED`
 * (`'session:turnFailed'`).
 *
 * Backend → webview push, not an inbound RPC method — alias kept here so
 * frontend session-lifecycle consumers import a single named type instead
 * of reaching into `sdk-hook.types.ts` directly.
 */
export type SessionTurnFailedParams = SdkTurnFailedPayload;

/**
 * Notification params for `MESSAGE_TYPES.SESSION_SUBAGENT_ENDED`
 * (`'session:subagentEnded'`).
 *
 * Backend → webview push, not an inbound RPC method — alias kept here so
 * frontend session-lifecycle consumers import a single named type instead
 * of reaching into `sdk-hook.types.ts` directly.
 */
export type SessionSubagentEndedParams = SdkSubagentEndedPayload;

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
 * The empty messages array is intentional.
 */
export interface SessionLoadResult {
  sessionId: SessionId;
  /** Always empty - messages come from chat:resume RPC call */
  messages: [];
  /** Always empty - SDK handles all session data */
  agentSessions: [];
}

/** Parameters for session:delete RPC method */
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

/** Per-session stats returned from JSONL reading */
export interface SessionStatsEntry {
  /** Session ID */
  readonly sessionId: string;
  /** Detected model from JSONL init message */
  readonly model: string | null;
  /** Total cost in USD (calculated with model-aware pricing) */
  readonly totalCost: number | null;
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
    readonly costUSD: number | null;
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

/**
 * Resolution hint for mapping a frontend message id to the transcript line
 * UUID that the SDK's `forkSession`/`rewindFiles` require.
 *
 * A live user bubble carries an optimistic, client-only id
 * (`msg_<timestamp>_<random>`) that is never written to the session
 * transcript. When the anchor id is not itself a transcript line UUID, the
 * backend uses this hint to locate the owning user-prompt line by its verbatim
 * text and recover the real UUID. History-loaded messages already carry the
 * real UUID, so the hint is unused for them.
 */
export interface MessageAnchorHint {
  /** Verbatim text of the user prompt the anchor refers to. */
  text: string;
  /**
   * Zero-based index among user prompts sharing the identical `text`,
   * disambiguating duplicates (e.g. two separate "commit" messages).
   * Defaults to `0`.
   */
  occurrence?: number;
}

/** Parameters for session:forkSession RPC method */
export interface SessionForkParams {
  /** Source session UUID to fork from */
  sessionId: SessionId;
  /** Optional message UUID to slice the transcript at (inclusive) */
  upToMessageId?: string;
  /**
   * Optional fallback hint used when `upToMessageId` is a client-only
   * optimistic id rather than a transcript line UUID. See {@link MessageAnchorHint}.
   */
  anchorHint?: MessageAnchorHint;
  /** Optional title for the new fork (defaults to "<original> (fork)") */
  title?: string;
  /**
   * Optional semantic hint for the kind of fork being requested.
   *
   * When set to `'rewind'`, the backend derives the new session title as
   * `"<original> (rewind)"` instead of the default `"<original> (fork)"`.
   * When set to `'branch'` or left `undefined`, the existing "(fork)"
   * naming is preserved. This is cosmetic only — the underlying SDK
   * `forkSession` call is identical in both cases.
   *
   * An explicit `title` always wins over the `kind`-derived default.
   */
  kind?: 'rewind' | 'branch';
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
   * Optional fallback hint used when `userMessageId` is a client-only
   * optimistic id rather than a transcript line UUID. See {@link MessageAnchorHint}.
   */
  anchorHint?: MessageAnchorHint;
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

/** Parameters for the `session:status` RPC method. */
export interface SessionStatusParams {
  /** Restored session UUID whose liveness the webview is probing. */
  sessionId: string;
}

/**
 * Response from the `session:status` RPC method.
 *
 * Lets a cold-loaded webview (panel hide→reshow, HMR/devtools reload)
 * recover both whether the session process is alive and whether a turn is
 * actively streaming right now — state that is otherwise lost across the
 * webview recreation.
 */
export interface SessionStatusResponse {
  /** Session is in the SDK lifecycle registry (process alive + known). */
  isActive: boolean;
  /** A turn is currently mid-stream to the webview for this session. */
  isStreaming: boolean;
}

/** Catalog entry for an MCP-style tool advertised by `session.describe`. */
export interface SessionDescribeToolEntry {
  /** Wire name as it appears in `tools/call` (e.g. `agent_spawn`). */
  readonly name: string;
  /** Human-readable description shown to the host. */
  readonly description: string;
}

/**
 * Response payload for the inbound `session.describe` request.
 *
 * Returned by `ptah interact` and `ptah mcp-serve` so any host can discover
 * the wire-protocol surface without compile-time access to the CLI's
 * TypeScript types. Additive-only — older clients ignore unknown fields per
 * JSON-RPC 2.0.
 */
export interface SessionDescribeResult {
  /** Always `'ptah'` — identifies the CLI to mixed-server hosts. */
  readonly serverName: 'ptah';
  /** CLI version (matches `apps/ptah-cli/package.json` `version`). */
  readonly version: string;
  /** Ptah JSON-RPC schema version (matches `JSONRPC_SCHEMA_VERSION`). */
  readonly schemaVersion: string;
  /** Active subcommand mode. */
  readonly mode: 'interact' | 'mcp-serve';
  /** Tool + method catalog. */
  readonly catalog: {
    /** Wire method names this server accepts (e.g. `task.submit`, `tools/call`). */
    readonly methods: readonly string[];
    /** MCP-style tool catalog (populated in `mcp-serve`, empty in `interact`). */
    readonly tools: readonly SessionDescribeToolEntry[];
  };
  /** `PtahErrorCode` values the server may surface in `error.data.ptah_code`. */
  readonly errorCodes: readonly string[];
  /** Capabilities advertised at `session.ready` time. */
  readonly capabilities: readonly string[];
}

/**
 * Response payload for the inbound `session.methods` request.
 *
 * Lightweight introspection — returns the method names without the
 * surrounding catalog metadata.
 */
export interface SessionMethodsResult {
  /** Wire method names this server accepts. */
  readonly methods: readonly string[];
}
