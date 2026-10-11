/**
 * Minimal MCP client for Ptah's code-execution HTTP server.
 *
 * The server (`vscode-lm-tools/.../mcp-http/http-server.handler.ts`) speaks
 * plain JSON-RPC 2.0 over one `POST` per request and answers with one
 * `application/json` body: no session header, no SSE stream, protocol
 * `2024-11-05`. The `@modelcontextprotocol/sdk` HTTP transports target the
 * streamable-HTTP protocol and hide the socket, so this client posts the
 * envelope itself: wall time is measured here, around the whole exchange
 * including serialisation, and connection reuse is a switch the transport
 * scenario can flip.
 *
 * Every method that talks to the server resolves with an outcome and never
 * rejects, except {@link McpHttpClient.listTools}, whose caller (the launcher's
 * cold-start probe) needs a hard failure.
 */

import * as http from 'node:http';

/** One tool as `tools/list` advertises it. */
export interface McpToolInfo {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: unknown;
}

/** The outcome of one JSON-RPC exchange. `wallMs` is client-side wall time. */
export type RpcOutcome =
  | {
      readonly kind: 'result';
      readonly result: unknown;
      readonly wallMs: number;
    }
  | {
      readonly kind: 'rpc-error';
      readonly code: number;
      readonly message: string;
      readonly wallMs: number;
    }
  | {
      readonly kind: 'transport-error';
      /** Node's errno code (`ECONNRESET`, `ECONNREFUSED`, ...) or `TIMEOUT`, `HTTP_<status>`, `BAD_BODY`. */
      readonly code: string;
      readonly detail: string;
      readonly wallMs: number;
    };

/** The text and error flag of one `tools/call` result. */
export interface ToolCallPayload {
  readonly text: string;
  readonly isError: boolean;
}

/** One `tools/call` exchange, before any classification of its text. */
export type ToolCallOutcome =
  | ({ readonly kind: 'result'; readonly wallMs: number } & ToolCallPayload)
  | Exclude<RpcOutcome, { kind: 'result' }>;

/** The slice of the client the call recorder drives. */
export interface McpToolCaller {
  callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<ToolCallOutcome>;
}

export interface McpHttpClientOptions {
  /**
   * Server URL including the caller path, e.g.
   * `http://localhost:51820/workspace/D%3A%5Cx`. The `/workspace/{root}`
   * segment is how the server attributes the call to a workspace.
   */
  readonly baseUrl: string;
  /** Reuse one TCP connection across calls. Default `true`. */
  readonly keepAlive?: boolean;
  /** Per-request deadline; the socket is destroyed when it passes. Default 120 s. */
  readonly requestTimeoutMs?: number;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;
const CLIENT_INFO = { name: 'ptah-mcp-bench', version: '1.0.0' } as const;
const PROTOCOL_VERSION = '2024-11-05';

/** `{root}` for the `/workspace/{root}` URL segment the server parses. */
export function workspaceBaseUrl(port: number, workspaceRoot: string): string {
  return `http://localhost:${port}/workspace/${encodeURIComponent(workspaceRoot)}`;
}

export class McpHttpClient implements McpToolCaller {
  private readonly url: URL;
  private readonly agent: http.Agent;
  private readonly requestTimeoutMs: number;
  private nextId = 1;

  constructor(options: McpHttpClientOptions) {
    this.url = new URL(options.baseUrl);
    if (this.url.protocol !== 'http:') {
      throw new Error(
        `McpHttpClient supports http: only, got ${this.url.protocol}`,
      );
    }
    this.agent = new http.Agent({
      keepAlive: options.keepAlive ?? true,
      maxSockets: 1,
    });
    this.requestTimeoutMs =
      options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  /** MCP handshake. Resolves with the outcome; the server keeps no session. */
  initialize(): Promise<RpcOutcome> {
    return this.request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: CLIENT_INFO,
    });
  }

  /** `tools/list`. Rejects on any failure: callers use it as a liveness probe. */
  async listTools(): Promise<McpToolInfo[]> {
    const outcome = await this.request('tools/list', {});
    if (outcome.kind === 'transport-error') {
      throw new Error(
        `tools/list transport error ${outcome.code}: ${outcome.detail}`,
      );
    }
    if (outcome.kind === 'rpc-error') {
      throw new Error(`tools/list error ${outcome.code}: ${outcome.message}`);
    }
    const tools = (outcome.result as { tools?: unknown } | null)?.tools;
    if (!Array.isArray(tools)) {
      throw new Error('tools/list result carries no tools array');
    }
    return tools.filter(isToolInfo);
  }

  /** One `tools/call`, unclassified. Never rejects. */
  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<ToolCallOutcome> {
    const outcome = await this.request('tools/call', { name, arguments: args });
    if (outcome.kind !== 'result') return outcome;
    const payload = readToolPayload(outcome.result);
    if (payload === null) {
      return {
        kind: 'transport-error',
        code: 'BAD_BODY',
        detail: 'tools/call result has no content array',
        wallMs: outcome.wallMs,
      };
    }
    return { kind: 'result', wallMs: outcome.wallMs, ...payload };
  }

  /** Close pooled sockets. The client is unusable afterwards. */
  close(): void {
    this.agent.destroy();
  }

  /** One JSON-RPC exchange. Never rejects. */
  request(
    method: string,
    params: Record<string, unknown>,
  ): Promise<RpcOutcome> {
    const id = this.nextId++;
    const body = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    const started = performance.now();
    const elapsed = (): number => performance.now() - started;

    return new Promise<RpcOutcome>((resolve) => {
      let settled = false;
      const settle = (outcome: RpcOutcome): void => {
        if (settled) return;
        settled = true;
        resolve(outcome);
      };
      const transportError = (code: string, detail: string): void =>
        settle({ kind: 'transport-error', code, detail, wallMs: elapsed() });

      const req = http.request(
        {
          protocol: this.url.protocol,
          hostname: this.url.hostname,
          port: this.url.port,
          path: `${this.url.pathname}${this.url.search}`,
          method: 'POST',
          agent: this.agent,
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('error', (error: NodeJS.ErrnoException) =>
            transportError(error.code ?? 'RESPONSE_ERROR', error.message),
          );
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            const status = res.statusCode ?? 0;
            if (status !== 200) {
              transportError(`HTTP_${status}`, text.slice(0, 500));
              return;
            }
            settle(parseEnvelope(text, id, elapsed()));
          });
        },
      );
      req.setTimeout(this.requestTimeoutMs, () => {
        transportError(
          'TIMEOUT',
          `no reply within ${this.requestTimeoutMs} ms`,
        );
        req.destroy();
      });
      req.on('error', (error: NodeJS.ErrnoException) =>
        transportError(error.code ?? 'REQUEST_ERROR', error.message),
      );
      req.end(body);
    });
  }
}

function parseEnvelope(text: string, id: number, wallMs: number): RpcOutcome {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      kind: 'transport-error',
      code: 'BAD_BODY',
      detail: text.slice(0, 500),
      wallMs,
    };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return {
      kind: 'transport-error',
      code: 'BAD_BODY',
      detail: 'reply is not an object',
      wallMs,
    };
  }
  const envelope = parsed as {
    id?: unknown;
    result?: unknown;
    error?: unknown;
  };
  if (envelope.error !== undefined) {
    const error = envelope.error as { code?: unknown; message?: unknown };
    return {
      kind: 'rpc-error',
      code: typeof error.code === 'number' ? error.code : 0,
      message:
        typeof error.message === 'string' ? error.message : 'unknown error',
      wallMs,
    };
  }
  if (envelope.id !== id) {
    return {
      kind: 'transport-error',
      code: 'BAD_BODY',
      detail: `reply id ${String(envelope.id)} does not match request id ${id}`,
      wallMs,
    };
  }
  return { kind: 'result', result: envelope.result, wallMs };
}

function readToolPayload(result: unknown): ToolCallPayload | null {
  if (typeof result !== 'object' || result === null) return null;
  const { content, isError } = result as {
    content?: unknown;
    isError?: unknown;
  };
  if (!Array.isArray(content)) return null;
  const text = content
    .filter(
      (part): part is { type: 'text'; text: string } =>
        typeof part === 'object' &&
        part !== null &&
        (part as { type?: unknown }).type === 'text' &&
        typeof (part as { text?: unknown }).text === 'string',
    )
    .map((part) => part.text)
    .join('\n');
  return { text, isError: isError === true };
}

function isToolInfo(value: unknown): value is McpToolInfo {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { name?: unknown }).name === 'string'
  );
}
