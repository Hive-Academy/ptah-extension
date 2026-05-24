/**
 * Transport-agnostic MCP server contracts.
 *
 * Defined as part of TASK_2026_128 Phase 0 — splits the hand-rolled MCP
 * implementation into a protocol core (`mcp-core/`) and per-transport
 * adapters (`mcp-http/`, `mcp-stdio/`). The HTTP server in `mcp-http/`
 * adapts these contracts to Node's `http.Server`; a future stdio adapter
 * in `mcp-stdio/` (Phase 2) will adapt them to NDJSON stdin/stdout framing.
 */

import type { MCPRequest, MCPResponse } from './mcp-protocol.types';

/**
 * Receive a request from a peer, dispatch, return a response.
 * Pure function signature — transport implementations call this for every
 * inbound JSON-RPC frame after framing is removed.
 */
export type McpRequestHandler = (request: MCPRequest) => Promise<MCPResponse>;

/**
 * Push a server → client notification (MCP `notifications/progress` etc.).
 * Implementations MUST be safe to call from inside a tools/call handler.
 * HTTP transports may queue the notification for the next response window;
 * stdio transports typically write the frame to stdout immediately.
 */
export type McpNotificationEmitter = (
  method: string,
  params: Record<string, unknown>,
) => Promise<void>;

/**
 * Transport-agnostic MCP server contract.
 *
 * The protocol dispatcher in `mcp-core/protocol-dispatcher.ts` does not
 * depend on this interface — it operates on raw `MCPRequest`/`MCPResponse`
 * objects. The interface exists so that `mcp-http/` and `mcp-stdio/`
 * (Phase 2) expose a uniform lifecycle to their hosting apps.
 */
export interface IMcpServer {
  /** Start listening for incoming MCP requests. */
  start(): Promise<void>;

  /** Stop listening and release transport resources. */
  stop(): Promise<void>;

  /**
   * Best-effort notification emitter. Some transports may no-op until a
   * peer attaches (e.g. HTTP without an active long-poll); stdio writes
   * immediately. Implementations must never throw on emit — log + drop.
   */
  notify: McpNotificationEmitter;
}
