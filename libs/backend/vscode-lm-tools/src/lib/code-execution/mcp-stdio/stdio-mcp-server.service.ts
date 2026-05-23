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
 *
 * Phase 4 will add the per-tool premium gate around the dispatcher.
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

    const dispatcher = this.getAgentDispatcher();
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
   */
  private getAgentDispatcher(): AgentToolDispatcher {
    if (this.agentDispatcher === null) {
      const ptahAPI: PtahAPI = this.apiBuilder.build();
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
}

/**
 * Configuration helper used by `mcp-serve.ts` after `withEngine` resolves.
 * Phase 3 keeps construction explicit so tests can inject a fake builder.
 */
export function createStdioMcpServer(deps: {
  logger: Logger;
  apiBuilder: PtahAPIBuilder;
}): StdioMcpServerService {
  return new StdioMcpServerService(deps.logger, deps.apiBuilder);
}
