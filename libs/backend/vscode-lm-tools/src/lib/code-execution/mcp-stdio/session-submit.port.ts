/**
 * `session_submit` dispatcher port — Phase 3 of TASK_2026_128.
 *
 * The lib defines the contract; the implementation lives in
 * `apps/ptah-cli/src/services/mcp/session-submit.service.ts` so the
 * lib stays free of `apps/ptah-cli/` imports per the hexagonal rule.
 *
 * The CLI command (`mcp-serve.ts`) constructs the implementation, then
 * calls `StdioMcpServerService.setSessionSubmitHandler(impl)` after
 * `withEngine` resolves. Without an implementation set, calls to
 * `session_submit` return an MCP `isError: true` envelope with
 * `ptah_code: 'sdk_init_failed'`.
 */

import type {
  MCPRequest,
  MCPResponse,
} from '../mcp-core/types/mcp-protocol.types';

/**
 * Inbound `notifications/cancelled` payload as forwarded from the
 * `JsonRpcServer` notification dispatch. The dispatcher tracks
 * in-flight calls by their MCP `requestId` (the same value passed to
 * `dispatch(...).request.id`) so a cancellation can be correlated.
 */
export interface SessionSubmitCancellation {
  requestId: string | number;
}

/**
 * Dispatcher contract for the composite `session_submit` MCP tool. One
 * implementation per `mcp-serve` process; cancellation tracking is
 * internal to the implementation.
 */
export interface ISessionSubmitHandler {
  /**
   * Handle a `tools/call session_submit` invocation. The implementation:
   *
   *   1. Validates `args` through its own Zod schema (returns
   *      `mcp_invalid_tool_args` on failure).
   *   2. Builds a Team Leader prompt from the supplied `task`.
   *   3. Issues `chat:start` over the in-process transport with a
   *      synthesized `tabId`.
   *   4. Listens on the push adapter for matching `chat:chunk` /
   *      `chat:complete` / `chat:error` events, forwarding each as an
   *      MCP `notifications/message` (and `notifications/progress` when
   *      the caller supplied a `_meta.progressToken`).
   *   5. Resolves the MCP `result` with the aggregated final assistant
   *      message + structured cost/session metadata.
   */
  dispatch(request: MCPRequest, args: unknown): Promise<MCPResponse>;

  /**
   * Handle an inbound `notifications/cancelled` from the peer. The
   * implementation aborts the in-flight `chat:start` session whose
   * MCP requestId matches the payload; returns silently when there is
   * no matching in-flight call.
   */
  cancel(payload: SessionSubmitCancellation): Promise<void>;
}
