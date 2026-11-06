/**
 * HTTP Server Handler
 *
 * Manages the HTTP server for MCP protocol communication.
 * Rejects non-loopback Host and any Origin, then authenticates before the body.
 * Uses platform-core interfaces for all configuration access.
 */

import * as http from 'http';
import { z } from 'zod';
import { mcpAttachmentObserver } from './mcp-attachment-observer';
import type { Logger } from '@ptah-extension/vscode-core';
import type {
  IStateStorage,
  IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import type { MCPRequest, MCPResponse } from '../types';
import {
  authenticateWithoutRegistry,
  isAllowedHost,
  isJsonContentType,
  isRejectedOrigin,
  splitCredential,
} from './mcp-http-gate';
import {
  MCP_AUTH_REQUIRED_CODE,
  MCP_AUTH_REQUIRED_MESSAGE,
  MCP_CALLER_FORBIDDEN_CODE,
  MCP_CONTENT_TYPE_MESSAGE,
  MCP_TOOL_DENIED_MESSAGE,
  type McpHttpAuthInput,
  type McpRequestAuth,
} from '../mcp-core/mcp-caller-auth.types';

const jsonRpcEnvelopeSchema = z
  .object({
    jsonrpc: z.literal('2.0'),
    id: z.union([z.string(), z.number()]).optional(),
    method: z.string(),
    params: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

/**
 * Configuration for the HTTP server
 */
export interface HttpServerConfig {
  port: number;
  logger: Logger;
  workspaceState: IStateStorage;
  onMCPRequest: (request: MCPRequest) => Promise<MCPResponse>;
  /**
   * Credential check. Production passes the token registry. When omitted, a
   * presented token is rejected and a missing token follows the grace switch,
   * so parser tests keep exercising the URL grammar.
   */
  authenticate?: (input: McpHttpAuthInput) => McpRequestAuth;
}

/**
 * Result of starting the HTTP server
 */
export interface HttpServerResult {
  server: http.Server;
  port: number;
}

/**
 * Get MCP server port from platform configuration.
 * Default: 51820 (chosen to avoid common port conflicts)
 *
 * @param workspaceProvider - Platform-agnostic configuration access
 * @returns Configured port number, defaulting to 51820
 */
export function getConfiguredPort(
  workspaceProvider: IWorkspaceProvider,
): number {
  return (
    workspaceProvider.getConfiguration<number>('ptah', 'mcpPort', 51820) ??
    51820
  );
}

/**
 * Try to listen on a specific port. Returns a promise that resolves with
 * the server+port on success, or rejects on error.
 *
 * **Both listeners are removed on either outcome, and that is load-bearing.**
 * Every candidate port is attempted against the SAME `http.Server` instance, so
 * anything this function leaves attached survives into the next attempt. The
 * success callback used to be passed as `server.listen(port, host, cb)`, which
 * Node registers as a one-time `'listening'` listener — but "one-time" only
 * consumes it when it FIRES. A candidate that fails with `EADDRINUSE` never
 * fires it, so it stayed on the shared server and the next candidate's single
 * `'listening'` event was delivered to it as well: the started line was logged,
 * and `ptah.mcp.port` written, once per ATTEMPTED port rather than once per
 * server (TASK_2026_354). Two attempts produced the duplicate pair at
 * `tmp/logs/log.log:551-552`; three would have produced three.
 */
function tryListen(
  server: http.Server,
  port: number,
  logger: Logger,
  workspaceState: IStateStorage,
): Promise<HttpServerResult> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      server.removeListener('error', onError);
      server.removeListener('listening', onListening);
    };

    const onError = (error: NodeJS.ErrnoException) => {
      cleanup();
      reject(error);
    };

    const onListening = () => {
      cleanup();
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to get server address'));
        return;
      }

      const actualPort = address.port;
      workspaceState.update('ptah.mcp.port', actualPort);
      logger.info(
        `CodeExecutionMCP server started on http://localhost:${actualPort}`,
        'CodeExecutionMCP',
      );
      resolve({ server, port: actualPort });
    };

    server.on('error', onError);
    server.on('listening', onListening);
    server.listen(port, 'localhost');
  });
}

/**
 * The most likely reason a bind failed, phrased for someone reading a boot log.
 *
 * `EADDRINUSE` on the Ptah default port is almost always a second Ptah instance
 * — the Electron app and the VS Code extension running together, or two
 * Electron windows. `EACCES` on Windows is a different animal: the Hyper-V /
 * WinNAT dynamic-port exclusion ranges make whole blocks unbindable with no
 * process holding them, so blaming a peer there would send the reader hunting
 * for something that does not exist.
 */
function likelyHolderOf(code: string | undefined): string {
  if (code === 'EACCES') {
    return 'the OS has reserved it (on Windows, a Hyper-V/WinNAT excluded port range)';
  }
  return 'another running Ptah instance is most likely already listening there';
}

/**
 * Returns the configured port followed by its next two valid TCP ports.
 *
 * Port 0 remains supported when explicitly requested (notably by isolated
 * lifecycle tests), but is never selected as a collision fallback: callers
 * need a stable port that can be propagated to spawned agents.
 */
export function getMcpPortCandidates(configuredPort: number): number[] {
  if (!Number.isInteger(configuredPort) || configuredPort < 1) {
    return [configuredPort];
  }

  return Array.from(
    { length: 3 },
    (_, offset) => configuredPort + offset,
  ).filter((port) => port <= 65_535);
}

/** A candidate port that could not be bound, with the errno that said so. */
interface UnavailablePort {
  port: number;
  code: string | undefined;
}

/** `51820 (EADDRINUSE), 51821 (EACCES)` — the ports we could not have. */
function describeUnavailable(failures: UnavailablePort[]): string {
  const label = failures.length === 1 ? 'port' : 'ports';
  const listed = failures
    .map(({ port, code }) => (code ? `${port} (${code})` : `${port}`))
    .join(', ');
  return `MCP ${label} ${listed} unavailable`;
}

/**
 * Start the HTTP MCP server.
 *
 * Tries the configured port first, then its next two valid ports when a port
 * is unavailable. This keeps fallback selection deterministic so the actual
 * listening port can be propagated to every MCP consumer. Port 0 is never
 * used as a collision fallback.
 *
 * A fallback produces exactly ONE warning, and it is emitted after the outcome
 * is known so it can state the port actually chosen rather than the port about
 * to be attempted. The previous per-attempt "retrying with N" line told a
 * reader neither whether N worked nor who was holding the port they asked for
 * (TASK_2026_354).
 */
export async function startHttpServer(
  config: HttpServerConfig,
): Promise<HttpServerResult> {
  const { port: configuredPort, logger, workspaceState, onMCPRequest } = config;

  const server = http.createServer((req, res) => {
    handleHttpRequest(req, res, onMCPRequest, config.authenticate);
  });

  const candidates = getMcpPortCandidates(configuredPort);
  const failures: UnavailablePort[] = [];
  let lastUnavailableError: NodeJS.ErrnoException | undefined;

  for (const port of candidates) {
    try {
      const result = await tryListen(server, port, logger, workspaceState);
      if (failures.length > 0) {
        logger.warn(
          `${describeUnavailable(failures)}; ` +
            `${likelyHolderOf(failures[failures.length - 1].code)}. ` +
            `Started on port ${result.port} instead.`,
        );
      }
      return result;
    } catch (error: unknown) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== 'EACCES' && err.code !== 'EADDRINUSE') {
        throw error;
      }

      lastUnavailableError = err;
      failures.push({ port, code: err.code });
    }
  }

  if (failures.length > 0) {
    logger.warn(
      `${describeUnavailable(failures)}; ` +
        `${likelyHolderOf(failures[failures.length - 1].code)}. ` +
        `No fallback port left - the MCP server did not start.`,
    );
  }

  throw lastUnavailableError ?? new Error('No valid MCP server port available');
}

/**
 * Stop the HTTP server and cleanup resources
 */
export async function stopHttpServer(
  server: http.Server | null,
  workspaceState: IStateStorage,
  logger: Logger,
): Promise<void> {
  if (!server) {
    return;
  }
  const address = server.address();
  if (address && typeof address !== 'string')
    mcpAttachmentObserver.clearPort(address.port);

  return new Promise((resolve) => {
    server.close(() => {
      logger.info('CodeExecutionMCP server stopped', 'CodeExecutionMCP');
      workspaceState.update('ptah.mcp.port', undefined);
      resolve();
    });
  });
}

/** Maximum request body size (1MB) to prevent resource exhaustion */
const MAX_BODY_SIZE = 1024 * 1024;

/**
 * Extract caller session ID from MCP URL path.
 * URL format: /session/{tabId} — encoded by SdkQueryOptionsBuilder.buildMcpServers()
 */
function extractCallerSessionId(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const match = url.match(/^\/session\/([^/?]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

/**
 * Extract the caller's spawned-agent id from the MCP URL path.
 *
 * URL format: /agent/{agentId} — encoded by `ptahMcpServerUrl`
 * (`cli-agent-runtime/.../ptah-mcp-url.ts`) at spawn time (TASK_2026_402).
 *
 * This is the ONLY source of a spawned agent's identity. `ptah_agent_report`
 * takes no `agentId` argument, because an id passed as a tool argument is an id
 * an agent picks per call — a confused or misinstructed child would then post a
 * report into another agent's session by accident, and every caller would have
 * to be trusted to get it right. Ptah builds this URL itself and hands it to
 * the child at spawn, so the honest path carries the right id by construction.
 *
 * **This is attribution.** Trust is the credential binding the HTTP gate
 * stamps onto the request after Host, Origin, and token checks. The URL
 * segment still closes the confused-deputy case for a child that presents
 * its own token on another child's path: that mismatch is rejected before
 * the tool runs. Do not treat the path alone as a credential.
 */
function extractCallerAgentId(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const match = url.match(/^\/agent\/([^/?]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

/**
 * Extract the caller's declared workspace root from the MCP URL path.
 *
 * Accepted URL grammar (CLOSED — pinned by http-server.handler.spec.ts):
 *   /                                  → anonymous
 *   /session/{id}                      → session only
 *   /agent/{id}                        → agent only
 *   /workspace/{root}                  → workspace only
 *   /session/{id}/workspace/{root}     → session + workspace, session first
 *   /agent/{id}/workspace/{root}       → agent + workspace, agent first
 *
 * Optional terminal /profile/{name} follows any shape above, or stands alone.
 * Writer: SdkQueryOptionsBuilder.buildMcpServers (agent-sdk).
 *
 * A leading segment and a workspace segment is the ONLY combined
 * order, and the two leading kinds are mutually exclusive: a spawned agent
 * carries no session id and a chat session carries no agent id.
 *
 * The workspace segment must be followed only by an optional /profile/{name},
 * a trailing slash or a query string, so `/workspace/{root}/session/{id}` and
 * `/workspace/{root}/agent/{id}` are fully rejected rather than half-parsed.
 * `{root}` is `encodeURIComponent`-encoded by the writer, so a Windows root
 * (`D:\projects\x` → `D%3A%5Cprojects%5Cx`) contains no `/` or `?` and
 * round-trips exactly through decodeURIComponent.
 */
function extractCallerWorkspaceRoot(
  url: string | undefined,
): string | undefined {
  if (!url) return undefined;
  const match = url.match(
    /^(?:\/session\/[^/?]+|\/agent\/[^/?]+)?\/workspace\/([^/?]+)(?:\/profile\/[^/?]+)?\/?(?:\?.*)?$/,
  );
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

/** Read the terminal profile within the closed grammar above (not caller identity). */
function extractCallerToolProfile(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const match = url.match(
    /^(?:\/session\/[^/?]+|\/agent\/[^/?]+)?(?:\/workspace\/[^/?]+)?\/profile\/([^/?]+)\/?(?:\?.*)?$/,
  );
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

/**
 * A signal aborted when the response closes before its reply finished — the
 * caller dropped the connection (a client-side timeout, a cancelled tool call,
 * a killed agent). A normal reply finishes the response first, so it never
 * aborts. The `close` listener fires once and goes with the response.
 */
function abortOnEarlyClose(res: http.ServerResponse): AbortSignal {
  const controller = new AbortController();
  res.once('close', () => {
    if (!res.writableFinished) controller.abort();
  });
  return controller.signal;
}

/**
 * Handle one HTTP request. Host, Origin, method, Content-Type, and the
 * credential are decided before the body is parsed. No CORS headers are set.
 */
async function handleHttpRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  onMCPRequest: (request: MCPRequest) => Promise<MCPResponse>,
  authenticate?: (input: McpHttpAuthInput) => McpRequestAuth,
): Promise<void> {
  const port = req.socket.localPort ?? 0;
  if (!isAllowedHost(req.headers.host, port)) {
    discardBody(req);
    res.writeHead(403);
    res.end();
    return;
  }
  if (isRejectedOrigin(req.headers.origin)) {
    discardBody(req);
    res.writeHead(403);
    res.end();
    return;
  }
  if (req.method === 'OPTIONS') {
    discardBody(req);
    res.writeHead(403);
    res.end();
    return;
  }
  if (req.method === 'GET' && (req.url === '/health' || req.url === '/')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }
  if (!isJsonContentType(req.headers['content-type'])) {
    discardBody(req);
    endAuthFailure(res, 415, MCP_AUTH_REQUIRED_CODE, MCP_CONTENT_TYPE_MESSAGE);
    return;
  }
  const presented = splitCredential(req.headers.authorization, req.url);
  if (!presented.ok) {
    discardBody(req);
    endAuthFailure(res, 401, MCP_AUTH_REQUIRED_CODE, MCP_AUTH_REQUIRED_MESSAGE);
    return;
  }
  const identityUrl = presented.identityUrl;
  let authInput: McpHttpAuthInput;
  try {
    authInput = {
      ...(presented.token === undefined ? {} : { token: presented.token }),
      agentId: extractCallerAgentId(identityUrl),
      sessionId: extractCallerSessionId(identityUrl),
      workspaceRoot: extractCallerWorkspaceRoot(identityUrl),
      toolProfile: extractCallerToolProfile(identityUrl),
    };
  } catch (error) {
    // degradation-audit: reported - the handler returns a JSON-RPC parse error
    // for a malformed caller identity URL.
    discardBody(req);
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 0,
        error: { code: -32700, message: 'Parse error', data: errorMessage },
      }),
    );
    return;
  }
  let decision: McpRequestAuth;
  try {
    decision =
      authenticate === undefined
        ? authenticateWithoutRegistry(authInput)
        : authenticate(authInput);
  } catch {
    // degradation-audit: reported - the fixed 401 response avoids disclosure
    // of credential details when authentication throws.
    discardBody(req);
    endAuthFailure(res, 401, MCP_AUTH_REQUIRED_CODE, MCP_AUTH_REQUIRED_MESSAGE);
    return;
  }
  if (!decision.ok) {
    discardBody(req);
    endAuthFailure(
      res,
      decision.failure.httpStatus,
      decision.failure.jsonRpcCode,
      decision.failure.message,
    );
    return;
  }
  const accepted = decision;

  let body = '';
  let bodySize = 0;

  req.on('data', (chunk) => {
    bodySize += chunk.length;
    if (bodySize > MAX_BODY_SIZE) {
      req.destroy();
      const errorResponse: MCPResponse = {
        jsonrpc: '2.0',
        id: 0,
        error: {
          code: -32600,
          message: `Request body exceeds maximum size of ${MAX_BODY_SIZE} bytes`,
        },
      };
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(errorResponse));
      return;
    }
    body += chunk.toString();
  });

  req.on('end', async () => {
    if (bodySize > MAX_BODY_SIZE) return; // Already handled above

    try {
      const json: unknown = JSON.parse(body);
      const parsed = jsonRpcEnvelopeSchema.safeParse(json);
      if (!parsed.success) {
        endInvalidRequest(res);
        return;
      }
      const id = parsed.data.id;
      if (id === undefined) {
        res.writeHead(204);
        res.end();
        return;
      }

      // Caller identity is transport-owned (TASK_2026_538 review F1): the
      // reserved `_caller*` fields are dropped from the body and set ONLY from
      // the URL, unconditionally — `undefined` when the URL carries none — so
      // a body can never forge a session, agent, workspace scope or tool profile.
      const {
        _callerSessionId: _ignoredBodySession,
        _callerAgentId: _ignoredBodyAgent,
        _callerWorkspaceRoot: _ignoredBodyWorkspace,
        _callerToolProfile: _ignoredBodyProfile,
        _callerCapability: _ignoredBodyCapability,
        _callerBinding: _ignoredBodyBinding,
        _abortSignal: _ignoredBodySignal,
        ...envelope
      } = parsed.data;
      const mcpRequest: MCPRequest = {
        ...envelope,
        id,
        _callerSessionId: extractCallerSessionId(identityUrl),
        _callerAgentId: extractCallerAgentId(identityUrl),
        _callerWorkspaceRoot: extractCallerWorkspaceRoot(identityUrl),
        _callerToolProfile: extractCallerToolProfile(identityUrl),
        _callerCapability: accepted.binding.capability,
        _callerBinding: accepted.binding,
        _abortSignal: abortOnEarlyClose(res),
      };

      const mcpResponse = await onMCPRequest(mcpRequest);
      if (
        mcpRequest._callerAgentId &&
        /^[A-Za-z0-9-]{1,128}$/.test(mcpRequest._callerAgentId) &&
        (mcpRequest.method === 'initialize' ||
          mcpRequest.method === 'tools/list') &&
        !('error' in mcpResponse) &&
        req.socket.localPort
      ) {
        mcpAttachmentObserver.record({
          agentId: mcpRequest._callerAgentId,
          method: mcpRequest.method,
          port: req.socket.localPort,
          time: Date.now(),
        });
      }
      // The caller is gone: there is no one to write the reply to.
      if (res.destroyed) return;

      const status = isToolDenial(mcpResponse) ? 403 : 200;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(mcpResponse));
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      const errorResponse: MCPResponse = {
        jsonrpc: '2.0',
        id: 0,
        error: {
          code: -32700,
          message: 'Parse error',
          data: errorMessage,
        },
      };

      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(errorResponse));
    }
  });
}

function discardBody(req: http.IncomingMessage): void {
  req.resume();
}

function endInvalidRequest(res: http.ServerResponse): void {
  res.writeHead(400, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32600, message: 'Invalid Request' },
    }),
  );
}

/** Auth failures carry no `data` and no token. The id was not parsed. */
function endAuthFailure(
  res: http.ServerResponse,
  status: number,
  code: number,
  message: string,
): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      jsonrpc: '2.0',
      id: null,
      error: { code, message },
    }),
  );
}

function isToolDenial(response: MCPResponse): boolean {
  return (
    response.error?.code === MCP_CALLER_FORBIDDEN_CODE &&
    response.error.message === MCP_TOOL_DENIED_MESSAGE
  );
}
