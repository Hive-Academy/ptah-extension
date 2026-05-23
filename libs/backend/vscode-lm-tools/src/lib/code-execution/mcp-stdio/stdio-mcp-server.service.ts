/**
 * Stdio MCP server service.
 *
 * Owns the MCP protocol surface advertised over the stdio transport for
 * `ptah mcp-serve`. Mirrors {@link CodeExecutionMCP}'s relationship to the
 * HTTP transport: this service answers `initialize`, `tools/list`, and
 * `tools/call` against the {@link IMcpServer} port and delegates
 * notification emission to the {@link StdioTransport} adapter.
 *
 * Phase 2 scope (this file):
 *   - `initialize` returns a stable `serverInfo` so the MCP handshake can
 *     complete BEFORE `withEngine` finishes bootstrapping the agent SDK
 *     (Risk Register item #4).
 *   - `tools/list` returns the 7 MVP tool definitions with their MCP-wire
 *     names (no `ptah_` prefix).
 *   - `tools/call` returns a placeholder `isError: true` payload with
 *     `ptah_code: 'not_implemented'`. Phase 3 replaces the dispatch body
 *     with real routing to the `PtahAPI.agent.*` namespace + Team Leader
 *     harness.
 *
 * Phase 3 will inject `PtahAPIBuilder`, `LicenseService`, etc. and replace
 * the placeholder dispatcher.
 */

import { injectable, inject } from 'tsyringe';
import { TOKENS, Logger } from '@ptah-extension/vscode-core';
import type {
  MCPRequest,
  MCPResponse,
  MCPToolDefinition,
} from '../mcp-core/types/mcp-protocol.types';
import type { IMcpServer } from '../mcp-core/types/mcp-transport.types';
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
  constructor(
    @inject(TOKENS.LOGGER)
    private readonly logger: Logger,
  ) {}

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
   * Phase 2 placeholder dispatcher. Validates that the requested tool name
   * exists in the MVP catalog and returns an `isError: true` payload with
   * `ptah_code: 'not_implemented'` so external hosts can distinguish "tool
   * not yet wired" from "tool unknown".
   *
   * Phase 3 replaces this body with the real dispatcher.
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
        error: {
          code: -32601,
          message: `Unknown tool: ${name}`,
          data: { ptah_code: 'mcp_tool_not_found', tool: name },
        },
      };
    }

    this.logger.info('[StdioMcpServer] tools/call (placeholder)', {
      tool: name,
    });

    return {
      jsonrpc: '2.0',
      id: request.id,
      result: {
        content: [
          {
            type: 'text',
            text: 'Tool dispatch not yet implemented — Phase 3.',
          },
        ],
        isError: true,
        structuredContent: {
          ptah_code: 'not_implemented',
          tool: name,
          phase: 2,
        },
      },
    };
  }

  /**
   * Handle MCP `notifications/cancelled` from the peer. Phase 2 has no
   * in-flight work to cancel; the method is registered so the wire stays
   * spec-compliant and so Phase 3 can add real cancellation without
   * touching `mcp-serve.ts`.
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
  }
}

/**
 * Configuration helper used by `mcp-serve.ts` after `withEngine` resolves.
 * Phase 2 keeps construction explicit so the upcoming Phase 3 wiring can
 * extend it without breaking the call site.
 */
export function createStdioMcpServer(deps: {
  logger: Logger;
}): StdioMcpServerService {
  return new StdioMcpServerService(deps.logger);
}
