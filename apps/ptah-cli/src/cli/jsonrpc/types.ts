/**
 * JSON-RPC 2.0 protocol types + Ptah-specific notification / error / exit
 * code enums.
 *
 * TASK_2026_104 Batch 3.
 *
 * Strict conformance with https://www.jsonrpc.org/specification — `jsonrpc`
 * is always `'2.0'`, notifications omit `id`, requests carry a string or
 * number `id`, responses match by `id` and contain exactly one of `result`
 * or `error`.
 *
 * No DI, no IO. Pure types only — safe to import from any layer.
 */

/** JSON-RPC version literal. */
export const JSON_RPC_VERSION = '2.0' as const;

/** A JSON value that can appear inside `params`, `result`, or `error.data`. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/** Request id — JSON-RPC 2.0 allows string, number, or null. */
export type RequestId = string | number;

/** A JSON-RPC 2.0 notification (no `id`, no response expected). */
export interface JsonRpcNotification<TParams = unknown> {
  jsonrpc: typeof JSON_RPC_VERSION;
  method: string;
  params?: TParams;
}

/** A JSON-RPC 2.0 request (carries `id`, response REQUIRED). */
export interface JsonRpcRequest<TParams = unknown> {
  jsonrpc: typeof JSON_RPC_VERSION;
  id: RequestId;
  method: string;
  params?: TParams;
}

/** A JSON-RPC 2.0 success response. */
export interface JsonRpcSuccessResponse<TResult = unknown> {
  jsonrpc: typeof JSON_RPC_VERSION;
  id: RequestId | null;
  result: TResult;
}

/** A JSON-RPC 2.0 error object embedded inside an error response. */
export interface JsonRpcError<TData = unknown> {
  code: number;
  message: string;
  data?: TData;
}

/** A JSON-RPC 2.0 error response. */
export interface JsonRpcErrorResponse<TData = unknown> {
  jsonrpc: typeof JSON_RPC_VERSION;
  id: RequestId | null;
  error: JsonRpcError<TData>;
}

/** Either flavor of response. */
export type JsonRpcResponse<TResult = unknown, TData = unknown> =
  | JsonRpcSuccessResponse<TResult>
  | JsonRpcErrorResponse<TData>;

/** Discriminated union of every inbound message kind. */
export type JsonRpcMessage<
  TParams = unknown,
  TResult = unknown,
  TData = unknown,
> =
  | JsonRpcNotification<TParams>
  | JsonRpcRequest<TParams>
  | JsonRpcResponse<TResult, TData>;

// ---------------------------------------------------------------------------
// Standard JSON-RPC 2.0 error codes (per spec §5.1)
// ---------------------------------------------------------------------------

/** Standard JSON-RPC 2.0 error codes. */
export const JsonRpcErrorCode = {
  /** Malformed JSON received. */
  ParseError: -32700,
  /** The JSON sent is not a valid Request object. */
  InvalidRequest: -32600,
  /** The method does not exist or is not available. */
  MethodNotFound: -32601,
  /** Invalid method parameter(s). */
  InvalidParams: -32602,
  /** Internal JSON-RPC error. */
  InternalError: -32603,
} as const;

export type JsonRpcErrorCodeValue =
  (typeof JsonRpcErrorCode)[keyof typeof JsonRpcErrorCode];

// ---------------------------------------------------------------------------
// Ptah notification method names — task-description.md §4.1
// ---------------------------------------------------------------------------

/**
 * String-literal union of every Ptah notification method emitted on stdout.
 * Schema for the `params` of each method lives in task-description.md §4.1.
 */
export type PtahNotification =
  // Session lifecycle
  | 'session.ready'
  // Agent stream
  | 'agent.thought'
  | 'agent.message'
  | 'agent.tool_use'
  | 'agent.tool_result'
  // Session metering
  | 'session.cost'
  | 'session.token_usage'
  // Task lifecycle
  | 'task.start'
  | 'task.complete'
  | 'task.error'
  // Config commands (file-backed reads/writes + RPC sub-subcommands)
  | 'config.value'
  | 'config.updated'
  | 'config.list'
  | 'config.model'
  | 'config.models'
  | 'config.autopilot'
  | 'config.effort'
  // Harness commands
  | 'harness.initialized'
  | 'skill.installed'
  | 'skill.list'
  // Skill commands (TASK_2026_104 B6b) — task-description.md §4.1.5
  | 'skill.search'
  | 'skill.removed'
  | 'skill.popular'
  | 'skill.recommended'
  | 'skill.created'
  // MCP commands (TASK_2026_104 B6b) — task-description.md §4.1.5
  | 'mcp.search'
  | 'mcp.details'
  | 'mcp.installed'
  | 'mcp.uninstalled'
  | 'mcp.list'
  | 'mcp.popular'
  // Plugin commands (TASK_2026_104 B6c) — task-description.md §3.1 `plugin *`
  | 'plugin.list'
  | 'plugin.config.value'
  | 'plugin.config.updated'
  | 'plugin.skills.list'
  // Prompts commands (TASK_2026_104 B6c) — task-description.md §3.1 `prompts *`
  | 'prompts.status'
  | 'prompts.enabled'
  | 'prompts.disabled'
  | 'prompts.regenerate.start'
  | 'prompts.regenerate.complete'
  | 'prompts.content'
  | 'prompts.download.complete'
  // Harness commands (TASK_2026_104 B6c) — task-description.md §3.1 `harness *`.
  // NOTE: `harness.chat.*` is intentionally OMITTED — the `harness chat`
  // sub-subcommand is a deferred-to-Batch-10 alias for `session start
  // --scope harness-skill` and emits `task.error` synchronously without
  // any new notifications. See `harness.ts#runChatAlias`.
  | 'harness.status'
  | 'harness.workspace_context'
  | 'harness.available_agents'
  | 'harness.available_skills'
  | 'harness.existing_presets'
  | 'harness.applied'
  | 'harness.preset.saved'
  | 'harness.preset.list'
  | 'harness.intent.analysis'
  | 'harness.agent_design.start'
  | 'harness.agent_design.complete'
  | 'harness.document.start'
  | 'harness.document.stream'
  | 'harness.document.complete'
  // Profile commands
  | 'profile.applied'
  | 'profile.list'
  // Workspace commands (TASK_2026_104 B5d)
  | 'workspace.info'
  | 'workspace.added'
  | 'workspace.removed'
  | 'workspace.switched'
  // Git commands (TASK_2026_104 B5d)
  | 'git.info'
  | 'git.worktrees'
  | 'git.worktree.added'
  | 'git.worktree.removed'
  | 'git.staged'
  | 'git.unstaged'
  | 'git.discarded'
  | 'git.committed'
  | 'git.file'
  // License commands (TASK_2026_104 B5d)
  | 'license.status'
  | 'license.updated'
  | 'license.cleared'
  // Web search commands (TASK_2026_104 B5d)
  | 'websearch.status'
  | 'websearch.config'
  | 'websearch.test'
  | 'websearch.updated'
  // Settings export/import (TASK_2026_104 B5d)
  | 'settings.exported'
  | 'settings.imported'
  // Workspace deep-analysis (TASK_2026_104 B5d)
  | 'analyze.start'
  | 'analyze.framework_detected'
  | 'analyze.dependency_detected'
  | 'analyze.recommendation'
  | 'analyze.complete'
  // Auth commands (TASK_2026_104 B8d) — task-description.md §4.1.6
  | 'auth.status'
  | 'auth.health'
  | 'auth.api_key.status'
  | 'auth.login.start'
  | 'auth.login.url'
  | 'auth.login.complete'
  | 'auth.logout.complete'
  | 'auth.test.result'
  // Provider commands (TASK_2026_104 B8d) — task-description.md §4.1.6
  | 'provider.status'
  | 'provider.default'
  | 'provider.models'
  | 'provider.tiers'
  | 'provider.key.set'
  | 'provider.key.removed'
  | 'provider.default.updated'
  | 'provider.tier.updated'
  | 'provider.tier.cleared'
  // Agent surface (TASK_2026_104 B7) — task-description.md §4.1.2
  | 'agent.packs.list'
  | 'agent.pack.install.start'
  | 'agent.pack.install.progress'
  | 'agent.pack.install.complete'
  | 'agent.list'
  | 'agent.applied'
  // Agent CLI surface (TASK_2026_104 B7) — task-description.md §4.1.2
  | 'agent_cli.detection'
  | 'agent_cli.config'
  | 'agent_cli.config.updated'
  | 'agent_cli.models'
  | 'agent_cli.stopped'
  | 'agent_cli.resumed'
  // Diagnostics (verbose)
  | 'debug.di.phase';

/**
 * Outbound CLI → client requests (require a response on stdin).
 * task-description.md §4.2.
 */
export type PtahOutboundRequest =
  | 'permission.request'
  | 'question.ask'
  // OAuth URL surfacing for headless device-code flows (TASK_2026_104 B8c/B8d).
  // The CLI sends this to the connected JSON-RPC peer when a Copilot login
  // begins so the peer can open the verification URL on the user's behalf.
  | 'oauth.url.open';

/**
 * String-literal alias for every outbound CLI → client request method, matching
 * the naming used by `JsonRpcServer.request<T>(method, params)`. Keeps the
 * type-safety surface symmetrical with `PtahNotification` for callers that
 * want to constrain the `method` argument at compile time.
 *
 * TASK_2026_104 B8d.
 */
export type PtahRequestMethod = PtahOutboundRequest;

/**
 * Inbound client → CLI requests (handled in `interact` mode).
 * task-description.md §4.3.
 */
export type PtahInboundRequest =
  | 'task.submit'
  | 'task.cancel'
  | 'session.shutdown'
  | 'session.history';

// ---------------------------------------------------------------------------
// Ptah-specific error codes — task-description.md §4.4
// ---------------------------------------------------------------------------

/** Ptah-specific error codes (carried in `error.data.ptah_code`). */
export type PtahErrorCode =
  | 'db_lock'
  | 'provider_unavailable'
  | 'auth_required'
  | 'rate_limited'
  | 'license_required'
  | 'unknown'
  | 'internal_failure'
  // CLI agent allowlist rejection (TASK_2026_104 B7).
  // Emitted by `ptah agent-cli {models|stop|resume} --cli <id>` when the
  // requested CLI is not in the locked allowlist (`glm` | `gemini`). NEVER
  // bypassable via env vars — the check lives at command entry-point and
  // ignores `process.env.PTAH_AGENT_CLI_OVERRIDE` entirely.
  | 'cli_agent_unavailable';

// ---------------------------------------------------------------------------
// Process exit codes — task-description.md §6
// ---------------------------------------------------------------------------

/** Process exit codes. */
export const ExitCode = {
  Success: 0,
  GeneralError: 1,
  UsageError: 2,
  AuthRequired: 3,
  LicenseRequired: 4,
  InternalFailure: 5,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

// ---------------------------------------------------------------------------
// Type guards (used by the server dispatcher and tests)
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Guard: value matches the JSON-RPC 2.0 envelope shape. */
export function isJsonRpcEnvelope(value: unknown): value is { jsonrpc: '2.0' } {
  return isPlainObject(value) && value['jsonrpc'] === JSON_RPC_VERSION;
}

/** Guard: a notification (envelope + method, no id). */
export function isJsonRpcNotification(
  value: unknown,
): value is JsonRpcNotification {
  return (
    isJsonRpcEnvelope(value) &&
    typeof (value as Record<string, unknown>)['method'] === 'string' &&
    !('id' in value)
  );
}

/** Guard: a request (envelope + method + id). */
export function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  if (!isJsonRpcEnvelope(value)) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['method'] === 'string' &&
    'id' in v &&
    (typeof v['id'] === 'string' || typeof v['id'] === 'number')
  );
}

/** Guard: a successful response (envelope + id + result). */
export function isJsonRpcSuccessResponse(
  value: unknown,
): value is JsonRpcSuccessResponse {
  if (!isJsonRpcEnvelope(value)) return false;
  const v = value as Record<string, unknown>;
  return 'id' in v && 'result' in v && !('error' in v);
}

/** Guard: an error response (envelope + id + error). */
export function isJsonRpcErrorResponse(
  value: unknown,
): value is JsonRpcErrorResponse {
  if (!isJsonRpcEnvelope(value)) return false;
  const v = value as Record<string, unknown>;
  return 'id' in v && 'error' in v && isPlainObject(v['error']);
}

/** Guard: any response (success or error). */
export function isJsonRpcResponse(value: unknown): value is JsonRpcResponse {
  return isJsonRpcSuccessResponse(value) || isJsonRpcErrorResponse(value);
}
