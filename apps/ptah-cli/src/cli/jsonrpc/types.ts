/**
 * JSON-RPC 2.0 protocol types + Ptah-specific notification / error / exit
 * code enums.
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

/**
 * Ptah JSON-RPC schema version (independent of the JSON-RPC 2.0 wire version).
 *
 * This advertises the shape of Ptah-specific notifications, request/response
 * params, and error data fields. It is bumped whenever an incompatible change
 * lands in `PtahNotification`, `PtahOutboundRequest`, `PtahInboundRequest`, or
 * any of their payload schemas.
 *
 * The CLI emits a `system.schema.version` notification at the top of every
 * `ptah interact` session and validates `process.env.PTAH_HOST_SCHEMA_VERSION`
 * (set by the host that spawned the CLI) at startup — a mismatch is logged
 * to stderr but does NOT abort the process; callers can opt out of the
 * stderr warning with the global `--quiet` flag.
 */
export const JSONRPC_SCHEMA_VERSION = '0.1' as const;

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

/**
 * String-literal union of every Ptah notification method emitted on stdout.
 * Schema for the `params` of each method lives in task-description.md §4.1.
 */
export type PtahNotification =
  | 'session.ready'
  | 'session.created'
  | 'session.list'
  | 'session.history'
  | 'session.stats'
  | 'session.valid'
  | 'session.stopped'
  | 'session.deleted'
  | 'session.renamed'
  | 'session.id_resolved'
  | 'agent.thought'
  | 'agent.message'
  | 'agent.tool_use'
  | 'agent.tool_result'
  | 'permission.request'
  | 'question.ask'
  | 'session.cost'
  | 'session.token_usage'
  | 'task.start'
  | 'task.complete'
  | 'task.error'
  | 'config.value'
  | 'config.updated'
  | 'config.list'
  | 'config.model'
  | 'config.models'
  | 'config.autopilot'
  | 'config.effort'
  | 'harness.initialized'
  | 'skill.installed'
  | 'skill.list'
  | 'skill.search'
  | 'skill.removed'
  | 'skill.popular'
  | 'skill.recommended'
  | 'skill.created'
  | 'mcp.search'
  | 'mcp.details'
  | 'mcp.installed'
  | 'mcp.uninstalled'
  | 'mcp.list'
  | 'mcp.popular'
  | 'plugin.list'
  | 'plugin.config.value'
  | 'plugin.config.updated'
  | 'plugin.skills.list'
  | 'prompts.status'
  | 'prompts.enabled'
  | 'prompts.disabled'
  | 'prompts.regenerate.start'
  | 'prompts.regenerate.complete'
  | 'prompts.content'
  | 'prompts.download.complete'
  | 'wizard.generation.progress'
  | 'wizard.generation.stream'
  | 'wizard.generation.complete'
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
  | 'profile.applied'
  | 'profile.list'
  | 'workspace.info'
  | 'workspace.added'
  | 'workspace.removed'
  | 'workspace.switched'
  | 'git.info'
  | 'git.worktrees'
  | 'git.worktree.added'
  | 'git.worktree.removed'
  | 'git.staged'
  | 'git.unstaged'
  | 'git.discarded'
  | 'git.committed'
  | 'git.file'
  | 'license.status'
  | 'license.updated'
  | 'license.cleared'
  | 'websearch.status'
  | 'websearch.config'
  | 'websearch.test'
  | 'websearch.updated'
  | 'settings.exported'
  | 'settings.imported'
  | 'analyze.start'
  | 'analyze.framework_detected'
  | 'analyze.dependency_detected'
  | 'analyze.recommendation'
  | 'analyze.complete'
  | 'auth.status'
  | 'auth.health'
  | 'auth.api_key.status'
  | 'auth.login.start'
  | 'auth.login.url'
  | 'auth.login.complete'
  | 'auth.logout.complete'
  | 'auth.test.result'
  | 'auth.use.applied'
  | 'provider.status'
  | 'provider.default'
  | 'provider.models'
  | 'provider.tiers'
  | 'provider.key.set'
  | 'provider.key.removed'
  | 'provider.default.updated'
  | 'provider.tier.updated'
  | 'provider.tier.cleared'
  | 'proxy.started'
  | 'proxy.token.issued'
  | 'proxy.request'
  | 'proxy.tool_invoked'
  | 'proxy.warning'
  | 'proxy.error'
  | 'proxy.stopped'
  | 'agent.packs.list'
  | 'agent.pack.install.start'
  | 'agent.pack.install.progress'
  | 'agent.pack.install.complete'
  | 'agent.list'
  | 'agent.applied'
  | 'agent_cli.detection'
  | 'agent_cli.config'
  | 'agent_cli.config.updated'
  | 'agent_cli.models'
  | 'agent_cli.stopped'
  | 'agent_cli.resumed'
  | 'debug.di.phase'
  | 'doctor.report'
  | 'system.schema.version';

/**
 * Outbound CLI → client requests (require a response on stdin).
 * task-description.md §4.2.
 */
export type PtahOutboundRequest =
  | 'permission.request'
  | 'question.ask'
  | 'oauth.url.open';

/**
 * String-literal alias for every outbound CLI → client request method, matching
 * the naming used by `JsonRpcServer.request<T>(method, params)`. Keeps the
 * type-safety surface symmetrical with `PtahNotification` for callers that
 * want to constrain the `method` argument at compile time.
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
  | 'session.history'
  | 'proxy.shutdown';

/** Ptah-specific error codes (carried in `error.data.ptah_code`). */
export type PtahErrorCode =
  | 'db_lock'
  | 'provider_unavailable'
  | 'auth_required'
  | 'rate_limited'
  | 'license_required'
  | 'unknown'
  | 'internal_failure'
  | 'cli_agent_unavailable'
  | 'sdk_init_failed'
  | 'workspace_missing'
  | 'proxy_bind_failed'
  | 'proxy_invalid_request'
  | 'permission_gate_unavailable'
  | 'claude_cli_not_found'
  | 'mcp_handshake_failed'
  | 'mcp_tool_not_found'
  | 'mcp_invalid_tool_args';

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
