/**
 * Stdio MCP server service.
 *
 * Owns the MCP protocol surface advertised over the stdio transport for
 * `ptah mcp-serve`. Mirrors {@link CodeExecutionMCP}'s relationship to the
 * HTTP transport: this service answers `initialize`, `tools/list`, and
 * `tools/call` against the {@link IMcpServer} port and delegates
 * notification emission to the {@link StdioTransport} adapter.
 *
 * Phase 3 scope (this file):
 *   - `initialize` returns a stable `serverInfo` so the MCP handshake can
 *     complete BEFORE `withEngine` finishes bootstrapping the agent SDK
 *     (Risk Register item #4).
 *   - `tools/list` returns the 7 MVP tool definitions with their MCP-wire
 *     names (no `ptah_` prefix).
 *   - `tools/call` routes to the {@link AgentToolDispatcher} for the six
 *     `agent_*` wrapper tools and to an injected {@link ISessionSubmitHandler}
 *     for the composite `session_submit` tool. The CLI command supplies the
 *     handler via {@link setSessionSubmitHandler} after `withEngine`
 *     resolves; the dispatcher is constructed once on first
 *     `tools/call` (lazy `PtahAPIBuilder.build()` to keep handshake cheap).
 */

import { injectable, inject } from 'tsyringe';
import { TOKENS, Logger } from '@ptah-extension/vscode-core';
import type {
  MCPRequest,
  MCPResponse,
  MCPToolDefinition,
} from '../mcp-core/types/mcp-protocol.types';
import type { IMcpServer } from '../mcp-core/types/mcp-transport.types';
import type { PtahAPI } from '../types';
import { PtahAPIBuilder } from '../ptah-api-builder.service';
import { AgentToolDispatcher } from './agent-tool.dispatcher';
import type {
  ISessionSubmitHandler,
  SessionSubmitCancellation,
} from './session-submit.port';
import { buildMcpMvpTools, MCP_MVP_TOOL_NAMES } from './tool-builders';

/**
 * MCP protocol version advertised to external hosts. Matches the version
 * the in-process HTTP server reports in
 * `mcp-core/protocol-dispatcher.ts:182`.
 */
export const MCP_PROTOCOL_VERSION = '2024-11-05';

export interface StdioMcpServerInfo {
  name: string;
  version: string;
}

/**
 * Construction-time configuration. `mcp-serve.ts` populates this from the
 * resolved CLI version + the host transport adapter; tests inject fakes.
 */
export interface StdioMcpServerConfig {
  transport: IMcpServer;
  serverInfo: StdioMcpServerInfo;
  /**
   * Optional override of the tool catalog. Defaults to the full 7-tool MVP
   * list — the `--allow-tools` flag narrows this in `mcp-serve.ts`.
   */
  allowedTools?: readonly string[];
}

@injectable()
export class StdioMcpServerService {
  private agentDispatcher: AgentToolDispatcher | null = null;
  private sessionSubmitHandler: ISessionSubmitHandler | null = null;
  /**
   * Cached SDK-init failure. Set the first time
   * {@link getAgentDispatcher} catches a throw from
   * `PtahAPIBuilder.build()` so subsequent `tools/call` invocations short
   * circuit to the same MCP envelope without re-invoking the failing
   * builder. `null` means no failure has been observed yet.
   */
  private sdkInitError: Error | null = null;

  constructor(
    @inject(TOKENS.LOGGER)
    private readonly logger: Logger,
    @inject(TOKENS.PTAH_API_BUILDER)
    private readonly apiBuilder: PtahAPIBuilder,
  ) {}

  /**
   * Register the CLI-supplied composite-tool handler. Called once by
   * `mcp-serve.ts` after `withEngine` resolves. Idempotent; the latest
   * registration wins.
   */
  setSessionSubmitHandler(handler: ISessionSubmitHandler): void {
    this.sessionSubmitHandler = handler;
  }

  /**
   * Build the MCP initialize response. Pure function — does not touch any
   * lazy SDK state. Safe to invoke mid-bootstrap so the host can answer
   * `initialize` before `withEngine` finishes.
   */
  handleInitialize(request: MCPRequest, info: StdioMcpServerInfo): MCPResponse {
    this.logger.info('[StdioMcpServer] initialize received', {
      id: request.id,
      clientInfo: request.params?.['clientInfo'],
    });

    return {
      jsonrpc: '2.0',
      id: request.id,
      result: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {
          tools: {},
        },
        serverInfo: info,
      },
    };
  }

  /**
   * Build the MCP tools/list response. Filters the MVP catalog through the
   * optional `allowedTools` override (`--allow-tools` flag in mcp-serve).
   */
  handleToolsList(
    request: MCPRequest,
    allowedTools?: readonly string[],
  ): MCPResponse {
    const allowSet =
      allowedTools && allowedTools.length > 0
        ? new Set(allowedTools)
        : undefined;
    const tools: MCPToolDefinition[] = buildMcpMvpTools().filter((tool) =>
      allowSet === undefined ? true : allowSet.has(tool.name),
    );

    return {
      jsonrpc: '2.0',
      id: request.id,
      result: { tools },
    };
  }

  /**
   * Dispatch a `tools/call` invocation through the agent-wrapper dispatcher
   * (six tools) or the session-submit handler (one tool). Falls back to an
   * `isError: true` envelope when the tool name is not in the MVP catalog or
   * when the session-submit handler has not yet been registered.
   */
  async handleToolsCall(request: MCPRequest): Promise<MCPResponse> {
    const params = request.params as
      | { name?: unknown; arguments?: Record<string, unknown> }
      | undefined;
    const name = params?.name;
    if (typeof name !== 'string' || name.length === 0) {
      return {
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: -32602,
          message:
            'Invalid params: tools/call requires a non-empty "name" string',
          data: { ptah_code: 'mcp_invalid_tool_args' },
        },
      };
    }

    const known = (MCP_MVP_TOOL_NAMES as readonly string[]).includes(name);
    if (!known) {
      return {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          content: [
            {
              type: 'text',
              text: `Unknown tool: ${name}. Call tools/list to see available tools.`,
            },
          ],
          isError: true,
          structuredContent: { ptah_code: 'mcp_tool_not_found', tool: name },
        },
      };
    }

    const args = params?.arguments;

    if (name === 'session_submit') {
      if (this.sessionSubmitHandler === null) {
        this.logger.warn(
          '[StdioMcpServer] session_submit called before handler registered',
        );
        return {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            content: [
              {
                type: 'text',
                text: 'session_submit handler not registered — `ptah mcp-serve` is still bootstrapping or the host runtime does not support composite dispatch.',
              },
            ],
            isError: true,
            structuredContent: {
              ptah_code: 'sdk_init_failed',
              tool: 'session_submit',
            },
          },
        };
      }
      return this.sessionSubmitHandler.dispatch(request, args);
    }

    let dispatcher: AgentToolDispatcher;
    try {
      dispatcher = this.getAgentDispatcher();
    } catch (err) {
      return this.buildSdkInitFailedResponse(request, name, err);
    }
    const resp = await dispatcher.dispatch(name, request, args);
    if (resp !== null) return resp;

    // Should never happen given the `known` check above + the MVP_TOOL_NAMES
    // table, but kept defensive in case the catalog and the dispatcher drift.
    this.logger.error('[StdioMcpServer] unrouted MVP tool', { tool: name });
    return {
      jsonrpc: '2.0',
      id: request.id,
      result: {
        content: [
          {
            type: 'text',
            text: `Tool ${name} is registered in the MVP catalog but has no dispatcher route.`,
          },
        ],
        isError: true,
        structuredContent: { ptah_code: 'internal_failure', tool: name },
      },
    };
  }

  /**
   * Handle MCP `notifications/cancelled` from the peer. The session-submit
   * handler tracks in-flight composite calls by their MCP `requestId`; the
   * six wrapper tools execute synchronously against the in-process agent
   * surface, so no cancellation surface is needed for them.
   */
  async handleCancelled(params: unknown): Promise<void> {
    const requestId =
      typeof params === 'object' &&
      params !== null &&
      'requestId' in params &&
      (typeof (params as { requestId: unknown }).requestId === 'string' ||
        typeof (params as { requestId: unknown }).requestId === 'number')
        ? (params as { requestId: string | number }).requestId
        : null;
    this.logger.info('[StdioMcpServer] notifications/cancelled', {
      requestId,
    });
    if (requestId === null) return;
    if (this.sessionSubmitHandler === null) return;
    const cancellation: SessionSubmitCancellation = { requestId };
    try {
      await this.sessionSubmitHandler.cancel(cancellation);
    } catch (err) {
      this.logger.error('[StdioMcpServer] session_submit cancel failed', {
        error: err instanceof Error ? err.message : String(err),
        requestId,
      });
    }
  }

  /**
   * Lazy access to the agent dispatcher. `PtahAPIBuilder.build()` walks 15
   * namespaces; deferring it until the first `tools/call` keeps the
   * handshake cheap and lets `tools/list` answer mid-bootstrap.
   *
   * A throw from `apiBuilder.build()` is cached on
   * {@link sdkInitError} — subsequent calls re-throw the same Error without
   * re-invoking the failing builder. The caller converts the throw into an
   * MCP `result.isError: true` envelope; see
   * {@link buildSdkInitFailedResponse}.
   */
  private getAgentDispatcher(): AgentToolDispatcher {
    if (this.sdkInitError !== null) {
      throw this.sdkInitError;
    }
    if (this.agentDispatcher === null) {
      // E2E-only break hook. Set `PTAH_TEST_BREAK_SDK_INIT=1` to force the
      // lazy `apiBuilder.build()` path to throw deterministically so the
      // `sdk_init_failed` envelope path can be exercised end-to-end without
      // having to corrupt the real SDK init surface. No-op outside tests.
      if (
        typeof process !== 'undefined' &&
        process.env?.['PTAH_TEST_BREAK_SDK_INIT'] === '1'
      ) {
        const error = new Error(
          'PTAH_TEST_BREAK_SDK_INIT=1 — simulated SDK init failure',
        );
        this.sdkInitError = error;
        throw error;
      }
      let ptahAPI: PtahAPI;
      try {
        ptahAPI = this.apiBuilder.build();
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        this.sdkInitError = error;
        throw error;
      }
      const callerSessionId =
        typeof process !== 'undefined'
          ? process.env?.['PTAH_MCP_HOST_SESSION_ID']
          : undefined;
      this.agentDispatcher = new AgentToolDispatcher(
        ptahAPI,
        this.logger,
        callerSessionId,
      );
    }
    return this.agentDispatcher;
  }

  /**
   * Build the MCP `result.isError: true` envelope used when
   * `PtahAPIBuilder.build()` throws on first `tools/call`. The envelope
   * carries `structuredContent.ptah_code === 'sdk_init_failed'` so external
   * hosts can route on the Ptah error taxonomy instead of receiving a raw
   * JSON-RPC -32603 InternalError (which `JsonRpcServer.dispatchRequest`
   * would otherwise collapse the throw into).
   */
  private buildSdkInitFailedResponse(
    request: MCPRequest,
    tool: string,
    err: unknown,
  ): MCPResponse {
    const message = err instanceof Error ? err.message : String(err);
    this.logger.error('[StdioMcpServer] SDK init failed on first tools/call', {
      tool,
      error: message,
    });
    return {
      jsonrpc: '2.0',
      id: request.id,
      result: {
        content: [
          {
            type: 'text',
            text: `Ptah SDK failed to initialize: ${message}. Run \`ptah doctor\` to diagnose.`,
          },
        ],
        isError: true,
        structuredContent: {
          ptah_code: 'sdk_init_failed',
          tool,
          error: message,
        },
      },
    };
  }
}

/**
 * Configuration helper used by `mcp-serve.ts` after `withEngine` resolves.
 * Construction stays explicit so tests can inject a fake builder.
 */
export function createStdioMcpServer(deps: {
  logger: Logger;
  apiBuilder: PtahAPIBuilder;
}): StdioMcpServerService {
  return new StdioMcpServerService(deps.logger, deps.apiBuilder);
}
