/**
 * `AnthropicProxyService` — Anthropic-compatible HTTP proxy that bridges
 * Anthropic Messages API requests onto Ptah's `chat:start | chat:continue`
 * RPC + `chat:chunk | chat:complete | chat:error` push surface.
 *
 * TASK_2026_104 P2 (Anthropic-compatible HTTP proxy).
 *
 * Routes:
 *   - `POST /v1/messages`       — Messages API. Streams via SSE when
 *                                  `stream: true`, otherwise returns a
 *                                  single JSON body. Bearer-auth required.
 *   - `GET  /v1/models`         — Static list of advertised models.
 *   - `GET  /healthz`           — Liveness probe (no auth).
 *
 * Request flow per `/v1/messages`:
 *
 *   1. Auth: extract bearer (`x-api-key` / `authorization`), constant-time
 *      compare against the minted token. 401 on miss / mismatch.
 *   2. Parse the JSON body. 400 + `proxy_invalid_request` on malformed.
 *   3. Mint a `request_id`; emit `proxy.request { phase: 'start' }`.
 *   4. Collect workspace tools (10s TTL cache) + merge with caller's
 *      `tools[]`. Emit `proxy.warning` on collisions; `proxy.tool_invoked`
 *      per included tool.
 *   5. Map caller messages onto a synthetic prompt + invoke `chat:start`
 *      via `ChatBridge.runTurn`.
 *   6. Translate the resulting `chat:chunk` events:
 *        - `stream: true`  → `AnthropicSseTranslator` → SSE response.
 *        - `stream: false` → `AnthropicNonStreamingAccumulator` → JSON body.
 *   7. On request abort (caller closed connection) — fire the abort
 *      controller; `chat:abort` is best-effort.
 *   8. Emit `proxy.request { phase: 'complete', duration_ms }`.
 *
 * Concurrency model: each request gets its own `ChatBridge` instance, its
 * own `AbortController`, and its own translator/accumulator. Multiple
 * concurrent requests can share the same `pushAdapter` because the bridge's
 * `tabId` filter ensures exclusive event routing per request.
 *
 * Permission gate: the proxy fails fast at startup if neither
 * `--auto-approve` nor an active `ptah interact` host is detected (the
 * embedded host installs the approval round-trip via `ApprovalBridge`).
 *
 * No new npm deps — only `node:crypto` for `randomUUID`. Everything else is
 * platform-injected.
 */

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';

import type {
  IHttpServerHandle,
  IHttpServerProvider,
} from '@ptah-extension/platform-core';
import type { McpHttpServerOverride } from '@ptah-extension/shared';

import type { CliMessageTransport } from '../../transport/cli-message-transport.js';
import type { CliWebviewManagerAdapter } from '../../transport/cli-webview-manager-adapter.js';
import type { JsonRpcServer } from '../../cli/jsonrpc/server.js';
import { ChatBridge } from '../../cli/session/chat-bridge.js';
import {
  AnthropicSseTranslator,
  encodeSseFrame,
  type ChatChunkEventLike,
} from './anthropic-sse-translator.js';
import {
  AnthropicNonStreamingAccumulator,
  type AnthropicMessageResponse,
} from './anthropic-non-streaming.js';
import {
  mergeAnthropicTools,
  type AnthropicToolDefinition,
} from './anthropic-tool-merger.js';
import { WorkspaceMcpCollector } from './workspace-mcp-collector.js';
import {
  deleteProxyTokenFile,
  extractProxyToken,
  mintProxyToken,
  verifyProxyToken,
  writeProxyTokenFile,
} from './proxy-auth.js';
import { emitFatalError } from '../../cli/output/stderr-json.js';

/** Configuration for the proxy lifecycle. */
export interface AnthropicProxyConfig {
  readonly host: string;
  readonly port: number;
  /** When true, surface workspace MCP tools through `tools[]`. */
  readonly exposeWorkspaceTools: boolean;
  /** Auto-approve every permission request (no `ptah interact` host needed). */
  readonly autoApprove: boolean;
  /** Workspace path forwarded to `chat:start`. */
  readonly workspacePath: string;
  /** Override the user-data path for token file placement. */
  readonly userDataPath?: string;
  /** Idle timeout in seconds — 0 disables. Reserved for future P3. */
  readonly idleTimeoutSeconds?: number;
}

/** Lightweight notification surface — production wires `JsonRpcServer.notify`. */
export interface ProxyNotifier {
  notify<T = unknown>(method: string, params?: T): Promise<void> | void;
}

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: unknown;
}

interface AnthropicMessagesRequestBody {
  model?: string;
  messages?: AnthropicMessage[];
  system?: string | Array<{ type: string; text?: string }>;
  tools?: AnthropicToolDefinition[];
  stream?: boolean;
  max_tokens?: number;
  temperature?: number;
}

/** Best-effort no-op notifier for headless `ptah proxy` invocations. */
const NOOP_NOTIFIER: ProxyNotifier = {
  notify: () => Promise.resolve(),
};

/** Active models surfaced via `GET /v1/models`. Static for the MVP. */
const ADVERTISED_MODELS = [
  {
    id: 'claude-3-5-sonnet-20241022',
    type: 'model',
    display_name: 'Ptah Proxy (proxied to Ptah backend)',
    created_at: new Date(0).toISOString(),
  },
  {
    id: 'ptah-default',
    type: 'model',
    display_name: 'Ptah default model (delegated to workspace config)',
    created_at: new Date(0).toISOString(),
  },
];

export class AnthropicProxyService {
  private handle: IHttpServerHandle | null = null;
  private token: string | null = null;
  private tokenPath: string | null = null;
  private readonly collector: WorkspaceMcpCollector;
  /** Active bridge per in-flight request, keyed by request_id. */
  private readonly inFlight = new Map<string, AbortController>();
  /** True after `stop()` resolves; second `stop()` is a no-op. */
  private stopped = false;

  constructor(
    private readonly config: AnthropicProxyConfig,
    private readonly httpProvider: IHttpServerProvider,
    private readonly transport: CliMessageTransport,
    private readonly pushAdapter: CliWebviewManagerAdapter,
    private readonly notifier: ProxyNotifier = NOOP_NOTIFIER,
  ) {
    this.collector = new WorkspaceMcpCollector(
      <TParams = unknown, TResult = unknown>(method: string, params: TParams) =>
        this.transport.call<TParams, TResult>(method, params),
    );
  }

  /**
   * Bind the HTTP listener, mint the bearer token, write the token file,
   * and emit `proxy.started` + `proxy.token.issued`. Throws on bind failure
   * (caller maps to `proxy_bind_failed`).
   */
  async start(): Promise<{ port: number; host: string; tokenPath: string }> {
    this.token = mintProxyToken();
    this.handle = await this.httpProvider.listen(
      this.config.host,
      this.config.port,
      (req, res) => {
        this.dispatch(req as IncomingMessage, res as ServerResponse).catch(
          (err) => {
            // Top-level dispatch failure — write a 500 if we still can.
            this.write500(
              res as ServerResponse,
              err instanceof Error ? err.message : String(err),
            );
          },
        );
      },
    );

    this.tokenPath = await writeProxyTokenFile(
      this.token,
      this.handle.port,
      this.config.userDataPath,
    );

    await this.notifier.notify('proxy.started', {
      host: this.handle.host,
      port: this.handle.port,
      token_path: this.tokenPath,
      expose_workspace_tools: this.config.exposeWorkspaceTools,
    });
    await this.notifier.notify('proxy.token.issued', {
      token: this.token,
      port: this.handle.port,
    });

    return {
      port: this.handle.port,
      host: this.handle.host,
      tokenPath: this.tokenPath,
    };
  }

  /**
   * Stop the HTTP listener, abort in-flight requests, delete the token
   * file, and emit `proxy.stopped`. Idempotent.
   */
  async stop(
    reason: 'shutdown' | 'sigint' | 'rpc' = 'shutdown',
  ): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    // Abort in-flight requests so their bridges detach + responses end.
    for (const ctrl of this.inFlight.values()) {
      try {
        ctrl.abort();
      } catch {
        /* ignore */
      }
    }
    this.inFlight.clear();

    const port = this.handle?.port;
    if (this.handle) {
      try {
        await this.handle.close();
      } catch {
        /* swallow — caller is shutting down */
      }
      this.handle = null;
    }

    if (port !== undefined) {
      await deleteProxyTokenFile(port, this.config.userDataPath);
      await this.notifier.notify('proxy.stopped', { port, reason });
    }
    this.token = null;
    this.tokenPath = null;
  }

  /**
   * Register the `proxy.shutdown` inbound RPC on a JsonRpcServer.
   *
   * Only useful when the proxy is launched embedded inside `ptah interact`
   * — `ptah proxy start` invoked standalone has no JsonRpcServer to attach
   * to. The handler is idempotent and matches the schema documented in
   * `jsonrpc-schema.md` § 3.
   *
   * Returns an unregister function the caller invokes during teardown so
   * the embedded server doesn't leak the handler past proxy stop.
   */
  registerShutdownRpc(
    server: Pick<JsonRpcServer, 'register' | 'unregister'>,
  ): () => void {
    server.register('proxy.shutdown', async () => {
      if (this.stopped) {
        return { stopped: false, reason: 'already stopped' };
      }
      const port = this.handle?.port;
      // Schedule the actual stop async so the response can flush before
      // the listener tears down.
      setImmediate(() => {
        void this.stop('rpc');
      });
      return { stopped: true, port, reason: 'rpc' };
    });
    return () => server.unregister('proxy.shutdown');
  }

  // -------------------------------------------------------------------------
  // Request dispatch
  // -------------------------------------------------------------------------

  private async dispatch(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const url = req.url ?? '/';
    const method = (req.method ?? 'GET').toUpperCase();

    // Strip query string for path matching.
    const queryStart = url.indexOf('?');
    const path = queryStart >= 0 ? url.slice(0, queryStart) : url;
    const query = queryStart >= 0 ? url.slice(queryStart + 1) : '';

    if (method === 'GET' && path === '/healthz') {
      this.writeJson(res, 200, { ok: true });
      return;
    }

    if (method === 'GET' && path === '/v1/models') {
      if (!this.authorize(req, res)) return;
      this.writeJson(res, 200, { data: ADVERTISED_MODELS, has_more: false });
      return;
    }

    if (method === 'POST' && path === '/v1/messages') {
      if (!this.authorize(req, res)) return;
      await this.handleMessages(req, res, query);
      return;
    }

    this.writeJson(res, 404, {
      type: 'error',
      error: {
        type: 'not_found',
        message: `route ${method} ${path} not found`,
      },
    });
  }

  /**
   * Authorize a request via bearer token. Returns false (and writes a 401)
   * on miss/mismatch.
   */
  private authorize(req: IncomingMessage, res: ServerResponse): boolean {
    if (this.token === null) {
      this.writeJson(res, 503, {
        type: 'error',
        error: {
          type: 'service_unavailable',
          message: 'proxy not started',
        },
      });
      return false;
    }
    const presented = extractProxyToken(req.headers);
    if (presented === null || !verifyProxyToken(presented, this.token)) {
      this.writeJson(res, 401, {
        type: 'error',
        error: {
          type: 'authentication_error',
          message: 'invalid x-api-key',
        },
      });
      return false;
    }
    return true;
  }

  /** Core handler for `POST /v1/messages`. */
  private async handleMessages(
    req: IncomingMessage,
    res: ServerResponse,
    query: string,
  ): Promise<void> {
    const startedAt = Date.now();
    const requestId = `req-${randomUUID().slice(0, 12)}`;
    const exposeOverride = !/(^|&)expose_workspace_tools=false(&|$)/.test(
      query,
    );
    const expose = this.config.exposeWorkspaceTools && exposeOverride;

    let body: AnthropicMessagesRequestBody;
    try {
      const raw = await readBody(req);
      body = parseJsonBody(raw);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      void this.notifier.notify('proxy.error', {
        request_id: requestId,
        code: 'proxy_invalid_request',
        message,
      });
      this.writeJson(res, 400, {
        type: 'error',
        error: { type: 'invalid_request_error', message },
      });
      return;
    }

    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      const msg = "missing 'messages' (non-empty array required)";
      void this.notifier.notify('proxy.error', {
        request_id: requestId,
        code: 'proxy_invalid_request',
        message: msg,
      });
      this.writeJson(res, 400, {
        type: 'error',
        error: { type: 'invalid_request_error', message: msg },
      });
      return;
    }

    const stream = body.stream === true;
    const callerTools = Array.isArray(body.tools) ? body.tools : [];

    // -- Tool merging ------------------------------------------------------
    const workspaceTools: AnthropicToolDefinition[] = expose
      ? await this.collector.collect(this.config.workspacePath).catch(() => [])
      : [];
    const merged = mergeAnthropicTools(callerTools, workspaceTools);
    if (merged.collisions.length > 0) {
      void this.notifier.notify('proxy.warning', {
        request_id: requestId,
        kind: 'tool_collision',
        message: `${merged.collisions.length} caller tool name(s) collided with workspace tools — caller tools win`,
        details: { collisions: merged.collisions },
      });
    }
    for (const tool of merged.tools) {
      const source = callerTools.some((c) => c.name === tool.name)
        ? 'caller'
        : 'workspace';
      void this.notifier.notify('proxy.tool_invoked', {
        request_id: requestId,
        tool_name: tool.name,
        source,
      });
    }

    void this.notifier.notify('proxy.request', {
      request_id: requestId,
      model: body.model ?? 'ptah-default',
      tool_count: merged.tools.length,
      stream,
      phase: 'start',
    });

    // -- TASK_2026_108 T2: parse X-Ptah-Mcp-Servers header ---------------
    // Q2=A locked: header is the ONLY signal. Malformed headers DO NOT
    // produce 400; we degrade to `undefined` + emit `proxy.warning` so
    // the chat path proceeds with the registry-built MCP map intact.
    const mcpHeaderParse = parseMcpOverrideHeader(
      req.headers['x-ptah-mcp-servers'],
    );
    if (mcpHeaderParse.warning !== null) {
      void this.notifier.notify('proxy.warning', {
        request_id: requestId,
        kind: 'mcp_override_invalid',
        message: mcpHeaderParse.warning,
      });
    }
    const mcpServersOverride = mcpHeaderParse.override;

    // -- Build chat:start params ------------------------------------------
    // Caller `model` is intentionally IGNORED in the MVP — the workspace
    // config drives the actual model. Caller `system` is APPENDED to the
    // prompt as a system-prefix block. Caller `messages[]` are flattened
    // into a single prompt by concatenating role+content text.
    const prompt = flattenMessagesForChat(body.messages, body.system);
    const tabId = `proxy-${requestId}`;

    const abortController = new AbortController();
    this.inFlight.set(requestId, abortController);
    req.on('close', () => {
      // Caller disconnected — abort in-flight chat. NOT a terminal error
      // (the model may have already streamed everything we needed).
      abortController.abort();
    });

    // Per-request bridge — one ChatBridge instance per request so the
    // listener filter is exclusive on tabId.
    const bridge = new ChatBridge(
      this.pushAdapter as unknown as EventEmitter,
      { notify: () => Promise.resolve() }, // proxy doesn't forward agent.* notifications
    );

    // Wire a chunk listener directly so we can translate alongside the
    // bridge's lifecycle. The bridge demuxes `chat:chunk` events for its
    // own purposes (which we ignore via the no-op notify shim above).
    let translator: AnthropicSseTranslator | null = null;
    let accumulator: AnthropicNonStreamingAccumulator | null = null;
    if (stream) {
      translator = new AnthropicSseTranslator(body.model ?? 'ptah-default');
    } else {
      accumulator = new AnthropicNonStreamingAccumulator(
        body.model ?? 'ptah-default',
      );
    }

    let streamingHeadersWritten = false;
    const writeStreamingHeaders = (): void => {
      if (streamingHeadersWritten) return;
      streamingHeadersWritten = true;
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      // Emit message_start immediately so the caller sees lifecycle.
      if (translator !== null) {
        for (const frame of translator.start()) {
          res.write(encodeSseFrame(frame));
        }
      }
    };

    const onChunk = (payload: unknown): void => {
      if (!isObject(payload)) return;
      if (payload['tabId'] !== tabId) return;
      const event = payload['event'];
      if (!isObject(event) || typeof event['eventType'] !== 'string') return;
      const eventLike = event as unknown as ChatChunkEventLike;
      if (translator !== null) {
        writeStreamingHeaders();
        for (const frame of translator.onChunk(eventLike)) {
          res.write(encodeSseFrame(frame));
        }
      } else if (accumulator !== null) {
        accumulator.onChunk(eventLike);
      }
    };
    this.pushAdapter.on('chat:chunk', onChunk);

    try {
      const result = await bridge.runTurn({
        tabId,
        rpcCall: async () => {
          // TASK_2026_108 T2: mcpServersOverride is forwarded through the
          // `chat:start` payload. When the header is absent / empty / invalid
          // it stays `undefined`, which is identity-preserved at every layer
          // of the SDK chain (see SdkQueryOptionsBuilder.mergeMcpOverride).
          // Workspace MCP tools are also surfaced via the merged `tools[]`
          // array on the response side for callers that don't speak MCP.
          const chatStartParams: Record<string, unknown> = {
            tabId,
            prompt,
            workspacePath: this.config.workspacePath,
            options: {},
          };
          if (mcpServersOverride !== undefined) {
            chatStartParams['mcpServersOverride'] = mcpServersOverride;
          }
          const resp = await this.transport.call<unknown, unknown>(
            'chat:start',
            chatStartParams,
          );
          return { success: resp.success === true };
        },
        abortSignal: abortController.signal,
      });

      // Translate terminal state.
      if (result.success === false) {
        const errMessage = result.error ?? 'unknown chat error';
        if (translator !== null) {
          writeStreamingHeaders();
          for (const frame of translator.onError(errMessage)) {
            res.write(encodeSseFrame(frame));
          }
          if (!res.writableEnded) res.end();
        } else if (accumulator !== null) {
          accumulator.onError(errMessage);
          this.writeJson(res, 502, {
            type: 'error',
            error: { type: 'api_error', message: errMessage },
          });
        }
        void this.notifier.notify('proxy.error', {
          request_id: requestId,
          code: 'internal_failure',
          message: errMessage,
        });
      } else {
        // Success — translator/accumulator already received message_complete
        // through the chunk listener. For non-streaming, build the JSON now.
        if (translator !== null) {
          if (!streamingHeadersWritten) writeStreamingHeaders();
          if (!res.writableEnded) res.end();
        } else if (accumulator !== null) {
          const built = accumulator.build();
          if (built === null) {
            this.writeJson(res, 502, {
              type: 'error',
              error: {
                type: 'api_error',
                message: 'backend produced no message_complete',
              },
            });
          } else {
            this.writeJson(
              res,
              200,
              built as unknown as Record<string, unknown>,
            );
          }
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      void this.notifier.notify('proxy.error', {
        request_id: requestId,
        code: 'internal_failure',
        message,
      });
      if (translator !== null && streamingHeadersWritten) {
        for (const frame of translator.onError(message)) {
          res.write(encodeSseFrame(frame));
        }
        if (!res.writableEnded) res.end();
      } else {
        this.writeJson(res, 500, {
          type: 'error',
          error: { type: 'api_error', message },
        });
      }
    } finally {
      this.pushAdapter.off('chat:chunk', onChunk);
      this.inFlight.delete(requestId);
      void this.notifier.notify('proxy.request', {
        request_id: requestId,
        model: body.model ?? 'ptah-default',
        tool_count: merged.tools.length,
        stream,
        phase: 'complete',
        duration_ms: Date.now() - startedAt,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Response helpers
  // -------------------------------------------------------------------------

  private writeJson(
    res: ServerResponse,
    status: number,
    body: Record<string, unknown> | AnthropicMessageResponse,
  ): void {
    if (res.headersSent) return;
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  private write500(res: ServerResponse, message: string): void {
    if (res.headersSent) {
      try {
        if (!res.writableEnded) res.end();
      } catch {
        /* ignore */
      }
      return;
    }
    try {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          type: 'error',
          error: { type: 'api_error', message },
        }),
      );
    } catch {
      /* swallow — response already destroyed */
    }
    emitFatalError('internal_failure', message, {
      command: 'proxy.dispatch',
    });
  }
}

// ---------------------------------------------------------------------------
// Free helpers
// ---------------------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Read the request body into a string with a 1MB cap. */
async function readBody(req: IncomingMessage): Promise<string> {
  const MAX_BYTES = 1024 * 1024;
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let aborted = false;
    req.on('data', (chunk: Buffer) => {
      if (aborted) return;
      total += chunk.length;
      if (total > MAX_BYTES) {
        aborted = true;
        reject(new Error(`request body exceeds ${MAX_BYTES} bytes`));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (aborted) return;
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', (err) => {
      if (aborted) return;
      aborted = true;
      reject(err);
    });
  });
}

function parseJsonBody(raw: string): AnthropicMessagesRequestBody {
  if (raw.length === 0) {
    throw new Error('empty request body');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!isObject(parsed)) {
    throw new Error('request body must be a JSON object');
  }
  return parsed as AnthropicMessagesRequestBody;
}

/**
 * Flatten Anthropic-shaped messages onto a single Ptah prompt string.
 *
 * Caller `system` is appended (as agreed). Each message contributes a line
 * prefixed with the role. Multimodal content (images / tool results) is
 * stringified best-effort.
 */
function flattenMessagesForChat(
  messages: AnthropicMessage[],
  system: AnthropicMessagesRequestBody['system'],
): string {
  const lines: string[] = [];
  if (typeof system === 'string' && system.length > 0) {
    lines.push(`<system>\n${system}\n</system>`);
  } else if (Array.isArray(system)) {
    for (const block of system) {
      if (
        block &&
        typeof block === 'object' &&
        typeof block.text === 'string'
      ) {
        lines.push(`<system>\n${block.text}\n</system>`);
      }
    }
  }
  for (const message of messages) {
    const role = message.role === 'assistant' ? 'assistant' : 'user';
    const content = stringifyContent(message.content);
    if (content.length === 0) continue;
    lines.push(`<${role}>\n${content}\n</${role}>`);
  }
  return lines.join('\n\n');
}

function stringifyContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const out: string[] = [];
    for (const block of content) {
      if (typeof block === 'string') {
        out.push(block);
      } else if (
        block &&
        typeof block === 'object' &&
        typeof (block as { text?: unknown }).text === 'string'
      ) {
        out.push((block as { text: string }).text);
      }
    }
    return out.join('\n');
  }
  return '';
}

/**
 * Result of parsing the `X-Ptah-Mcp-Servers` request header.
 *
 * Q2=A locked decision (TASK_2026_108 § 2 plan): the header is the ONLY
 * signal that drives `mcpServersOverride` — there is NO inference from
 * `tools[]`. Malformed/empty/absent headers all degrade to `undefined`
 * with an optional `proxy.warning`, never a 400 response.
 */
export interface McpOverrideParseResult {
  /** `undefined` when header absent, empty, or invalid. */
  readonly override: Record<string, McpHttpServerOverride> | undefined;
  /** Human-readable reason for an emitted `proxy.warning`. `null` on success/absent. */
  readonly warning: string | null;
}

/**
 * Parse the `X-Ptah-Mcp-Servers` header into `mcpServersOverride`.
 *
 * Header format: a JSON object keyed by MCP server name, where each value
 * matches `McpHttpServerOverride` — `{ type: 'http', url: string,
 * headers?: Record<string,string> }`. Non-HTTP MCP transports (stdio) are
 * NOT supported by this surface.
 *
 * Edge cases (all non-throwing):
 *   - Header absent OR empty string → `{ override: undefined, warning: null }`.
 *   - Header non-string (multi-value) → first value used.
 *   - JSON parse failure → `{ override: undefined, warning: 'invalid JSON' }`.
 *   - Top-level not an object → `{ override: undefined, warning: 'not an object' }`.
 *   - Any entry shape mismatch → `{ override: undefined, warning: 'entry "<key>" invalid' }`.
 *   - Empty object `{}` → `{ override: undefined, warning: null }` (treated as absent).
 *
 * Caller must emit `proxy.warning { kind: 'mcp_override_invalid' }` when
 * `warning !== null`, then proceed with `override` (which is `undefined`).
 */
export function parseMcpOverrideHeader(
  rawHeader: string | string[] | undefined,
): McpOverrideParseResult {
  // Normalize: pick first value if array, treat empty/whitespace as absent.
  const raw = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  if (raw === undefined || raw === null) {
    return { override: undefined, warning: null };
  }
  const trimmed = String(raw).trim();
  if (trimmed.length === 0) {
    return { override: undefined, warning: null };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      override: undefined,
      warning: `X-Ptah-Mcp-Servers header is not valid JSON: ${detail}`,
    };
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      override: undefined,
      warning:
        'X-Ptah-Mcp-Servers header must be a JSON object keyed by MCP server name',
    };
  }

  const entries = parsed as Record<string, unknown>;
  const out: Record<string, McpHttpServerOverride> = {};
  for (const key of Object.keys(entries)) {
    if (!Object.prototype.hasOwnProperty.call(entries, key)) continue;
    const entry = entries[key];
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      return {
        override: undefined,
        warning: `X-Ptah-Mcp-Servers entry "${key}" must be an object`,
      };
    }
    const obj = entry as Record<string, unknown>;
    if (obj['type'] !== 'http') {
      return {
        override: undefined,
        warning: `X-Ptah-Mcp-Servers entry "${key}" must have type === 'http'`,
      };
    }
    if (typeof obj['url'] !== 'string' || obj['url'].length === 0) {
      return {
        override: undefined,
        warning: `X-Ptah-Mcp-Servers entry "${key}" must have a non-empty string "url"`,
      };
    }
    const headersRaw = obj['headers'];
    let headers: Record<string, string> | undefined;
    if (headersRaw !== undefined) {
      if (
        headersRaw === null ||
        typeof headersRaw !== 'object' ||
        Array.isArray(headersRaw)
      ) {
        return {
          override: undefined,
          warning: `X-Ptah-Mcp-Servers entry "${key}" "headers" must be a string→string object`,
        };
      }
      const headersObj = headersRaw as Record<string, unknown>;
      const safeHeaders: Record<string, string> = {};
      for (const hk of Object.keys(headersObj)) {
        if (!Object.prototype.hasOwnProperty.call(headersObj, hk)) continue;
        const hv = headersObj[hk];
        if (typeof hv !== 'string') {
          return {
            override: undefined,
            warning: `X-Ptah-Mcp-Servers entry "${key}" header "${hk}" must be a string`,
          };
        }
        safeHeaders[hk] = hv;
      }
      headers = safeHeaders;
    }

    out[key] = headers
      ? { type: 'http', url: obj['url'] as string, headers }
      : { type: 'http', url: obj['url'] as string };
  }

  // Treat `{}` as absent — keeps the merge a no-op, matches mergeMcpOverride.
  if (Object.keys(out).length === 0) {
    return { override: undefined, warning: null };
  }
  return { override: out, warning: null };
}
