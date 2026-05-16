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
  | 'session.created'
  // Session command surface — task-description.md §3.1
  // `session *` table. Emitted by `ptah session {list|stop|delete|rename|
  // load|stats|validate}` for non-streaming sub-subcommands. Streaming
  // sub-subcommands (`start|resume|send`) emit `agent.*` via `ChatBridge`.
  | 'session.list'
  | 'session.history'
  | 'session.stats'
  | 'session.valid'
  | 'session.stopped'
  | 'session.deleted'
  | 'session.renamed'
  | 'session.id_resolved'
  // Agent stream
  | 'agent.thought'
  | 'agent.message'
  | 'agent.tool_use'
  | 'agent.tool_result'
  // Approval round-trip notifications (task-description.md §4.2).
  // These are fire-and-forget CLI → client notifications; the matching client
  // → CLI responses arrive as JSON-RPC requests on the inbound channel
  // (`permission.response` / `question.response`) and are dispatched through
  // `JsonRpcServer.register()` handlers wired by the `ApprovalBridge`.
  | 'permission.request'
  | 'question.ask'
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
  // Skill commands — task-description.md §4.1.5
  | 'skill.search'
  | 'skill.removed'
  | 'skill.popular'
  | 'skill.recommended'
  | 'skill.created'
  // MCP commands — task-description.md §4.1.5
  | 'mcp.search'
  | 'mcp.details'
  | 'mcp.installed'
  | 'mcp.uninstalled'
  | 'mcp.list'
  | 'mcp.popular'
  // Plugin commands — task-description.md §3.1 `plugin *`
  | 'plugin.list'
  | 'plugin.config.value'
  | 'plugin.config.updated'
  | 'plugin.skills.list'
  // Prompts commands — task-description.md §3.1 `prompts *`
  | 'prompts.status'
  | 'prompts.enabled'
  | 'prompts.disabled'
  | 'prompts.regenerate.start'
  | 'prompts.regenerate.complete'
  | 'prompts.content'
  | 'prompts.download.complete'
  // Setup-wizard generation surface — task-description.md §4.1.3.
  // Forwarded by the event-pipe when the backend `setup-wizard:generation-*`
  // push events fire during wizard prompt generation. Consumed by the
  // phase-runner async-broadcast mode and the setup orchestrator.
  | 'wizard.generation.progress'
  | 'wizard.generation.stream'
  | 'wizard.generation.complete'
  // Harness commands — task-description.md §3.1 `harness *`.
  // NOTE: `harness.chat.*` is intentionally OMITTED — the `harness chat`
  // sub-subcommand is an alias for `session start --scope harness-skill`
  // and emits `task.error` synchronously without any new notifications.
  // See `harness.ts#runChatAlias`.
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
  // Workspace commands
  | 'workspace.info'
  | 'workspace.added'
  | 'workspace.removed'
  | 'workspace.switched'
  // Git commands
  | 'git.info'
  | 'git.worktrees'
  | 'git.worktree.added'
  | 'git.worktree.removed'
  | 'git.staged'
  | 'git.unstaged'
  | 'git.discarded'
  | 'git.committed'
  | 'git.file'
  // License commands
  | 'license.status'
  | 'license.updated'
  | 'license.cleared'
  // Web search commands
  | 'websearch.status'
  | 'websearch.config'
  | 'websearch.test'
  | 'websearch.updated'
  // Settings export/import
  | 'settings.exported'
  | 'settings.imported'
  // Workspace deep-analysis
  | 'analyze.start'
  | 'analyze.framework_detected'
  | 'analyze.dependency_detected'
  | 'analyze.recommendation'
  | 'analyze.complete'
  // Auth commands — task-description.md §4.1.6
  | 'auth.status'
  | 'auth.health'
  | 'auth.api_key.status'
  | 'auth.login.start'
  | 'auth.login.url'
  | 'auth.login.complete'
  | 'auth.logout.complete'
  | 'auth.test.result'
  // Auth provider switch — `ptah auth use <providerId>`.
  // Emitted after the workspace provider config has been mutated to point
  // at the target provider. Payload shape:
  //   { providerId, authMethod, defaultProvider, anthropicProviderId }
  | 'auth.use.applied'
  // Provider commands — task-description.md §4.1.6
  | 'provider.status'
  | 'provider.default'
  | 'provider.models'
  | 'provider.tiers'
  | 'provider.key.set'
  | 'provider.key.removed'
  | 'provider.default.updated'
  | 'provider.tier.updated'
  | 'provider.tier.cleared'
  // Anthropic-compatible HTTP proxy (`ptah proxy *`).
  //
  // Emitted by `apps/ptah-cli/src/services/proxy/anthropic-proxy.service.ts`
  // when the proxy is launched embedded inside an active `ptah interact`
  // session. Outside of `interact`, these notifications are produced via the
  // structured stderr formatter only — there's no JSON-RPC peer to receive
  // them.
  //
  //   - `proxy.started`       — HTTP server bound + token issued.
  //                             `{ host, port, token_path, expose_workspace_tools }`
  //   - `proxy.token.issued`  — token mint event mirroring the disk write.
  //                             `{ token, port }` (token field is the literal
  //                             secret — the peer is responsible for not
  //                             logging it). Also written to
  //                             `~/.ptah/proxy/<port>.token` mode 0o600.
  //   - `proxy.request`       — per-request lifecycle (start + complete).
  //                             `{ request_id, model, tool_count, stream,
  //                                phase: 'start' | 'complete', duration_ms? }`
  //   - `proxy.tool_invoked`  — workspace MCP tool surfaced to caller.
  //                             `{ request_id, tool_name, source: 'caller' |
  //                                'workspace' }`
  //   - `proxy.warning`       — collision / soft-fail diagnostics.
  //                             `{ request_id?, kind, message, details? }`
  //   - `proxy.error`         — request-level fatal (non-fatal to the proxy).
  //                             `{ request_id?, code, message }`
  //   - `proxy.stopped`       — HTTP server closed (idempotent).
  //                             `{ port, reason }`
  | 'proxy.started'
  | 'proxy.token.issued'
  | 'proxy.request'
  | 'proxy.tool_invoked'
  | 'proxy.warning'
  | 'proxy.error'
  | 'proxy.stopped'
  // Agent surface — task-description.md §4.1.2
  | 'agent.packs.list'
  | 'agent.pack.install.start'
  | 'agent.pack.install.progress'
  | 'agent.pack.install.complete'
  | 'agent.list'
  | 'agent.applied'
  // Agent CLI surface — task-description.md §4.1.2
  | 'agent_cli.detection'
  | 'agent_cli.config'
  | 'agent_cli.config.updated'
  | 'agent_cli.models'
  | 'agent_cli.stopped'
  | 'agent_cli.resumed'
  // Diagnostics (verbose)
  | 'debug.di.phase'
  // System/diagnostics surface.
  //   - `doctor.report` — emitted by `ptah doctor` (alias `diagnose`) once
  //     the diagnostic walk completes. Payload:
  //       { license, auth, providers[], effective: { route, ready, blockers[] }, timestamp }
  //   - `system.schema.version` — emitted on `ptah interact` startup so the
  //     peer can detect protocol skew. Payload: `{ version, cliVersion }`.
  | 'doctor.report'
  | 'system.schema.version';

/**
 * Outbound CLI → client requests (require a response on stdin).
 * task-description.md §4.2.
 */
export type PtahOutboundRequest =
  | 'permission.request'
  | 'question.ask'
  // OAuth URL surfacing for headless device-code flows.
  // The CLI sends this to the connected JSON-RPC peer when a Copilot login
  // begins so the peer can open the verification URL on the user's behalf.
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
  // Anthropic-compatible HTTP proxy shutdown — only registered when the proxy
  // is launched embedded inside `ptah interact`. Closes the HTTP listener,
  // detaches the proxy from the push adapter, and unlinks
  // `~/.ptah/proxy/<port>.token`. Idempotent — second call returns
  // `{ stopped: false, reason: 'already stopped' }`.
  | 'proxy.shutdown';

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
  // CLI agent allowlist rejection.
  // Emitted by `ptah agent-cli {models|stop|resume} --cli <id>` when the
  // requested CLI is not in the locked allowlist (`glm` | `gemini`). NEVER
  // bypassable via env vars — the check lives at command entry-point and
  // ignores `process.env.PTAH_AGENT_CLI_OVERRIDE` entirely.
  | 'cli_agent_unavailable'
  // SDK agent adapter failed to initialize during CLI bootstrap. Emitted from
  // `withEngine` when `mode === 'full'` and the AGENT_ADAPTER's `initialize()`
  // returns false or throws — without this surface, `chat:start` RPCs hang
  // because the adapter never spawns claude. Mirrors Electron's bootstrap.ts
  // initialization step.
  | 'sdk_init_failed'
  // Workspace root could not be resolved or does not exist. Reserved for
  // structured stderr emission via `emitFatalError`.
  | 'workspace_missing'
  // Anthropic-compatible HTTP proxy failed to bind the requested host/port
  // pair. `data.host` / `data.port` carry the requested values; `data.cause`
  // carries the underlying `EADDRINUSE` / `EACCES` reason from `node:http`.
  | 'proxy_bind_failed'
  // Caller body rejected by the proxy (e.g. malformed JSON, unsupported
  // `model` field, missing `messages`). Always paired with HTTP 400; the
  // peer-side notification is a `proxy.error` event.
  | 'proxy_invalid_request'
  // Proxy attempted to forward a tool that requires user permission, but the
  // active CLI session has no permission gate available (no `--auto-approve`
  // and not running embedded inside `ptah interact`). Treated as a fail-fast
  // at proxy-startup so the proxy never silently auto-allows.
  | 'permission_gate_unavailable'
  // `ptah auth login claude-cli` could not locate the Claude CLI on PATH or
  // in any of the known installation locations. Emitted alongside
  // ExitCode.UsageError so the operator can re-run after `npm install -g
  // @anthropic-ai/claude-code` (or equivalent).
  | 'claude_cli_not_found';

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
