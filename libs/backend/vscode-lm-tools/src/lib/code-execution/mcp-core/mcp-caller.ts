/**
 * MCP caller identity — who issued an MCP request.
 *
 * The HTTP transport stamps three reserved fields onto every request from the
 * URL path, on every method (`initialize`, `tools/list`, `tools/call`), and
 * drops any copy the body carried (`http-server.handler.ts`):
 *
 *   `/agent/{id}`       → `_callerAgentId`       (a spawned CLI agent)
 *   `/session/{id}`     → `_callerSessionId`     (a Ptah chat session)
 *   `/workspace/{root}` → `_callerWorkspaceRoot` (an external client's `.mcp.json`)
 *
 * {@link resolveMcpCaller} folds those fields into one {@link McpCaller}, once
 * per request, so `tools/list`, `tools/call` and the telemetry line all agree
 * on the caller. A request that reaches the dispatcher with no URL identity (a
 * bare URL, or an in-process call) resolves to `anonymous`.
 *
 * This is attribution, not authentication: the server binds localhost and
 * checks no credential, so the kind must never gate a trust decision.
 */

import type { MCPRequest } from './types/mcp-protocol.types';

/**
 * The kind of caller, by precedence: a spawned `agent` is the most specific
 * identity, then a chat `session`, then a declared `workspace`, else
 * `anonymous`.
 */
export type McpCallerKind = 'agent' | 'session' | 'workspace' | 'anonymous';

/**
 * The resolved identity of one MCP request. Every field present is the
 * request's own URL-derived value; nothing is inferred, defaulted or carried
 * over from another request.
 */
export interface McpCaller {
  readonly kind: McpCallerKind;
  readonly sessionId?: string;
  readonly agentId?: string;
  readonly workspaceRoot?: string;
}

/**
 * Resolve the caller of `request` from its URL-derived `_caller*` fields.
 *
 * Pure: reads only those three fields (never `params`, which is caller-
 * supplied), performs no I/O and keeps no state, so a malformed or absent
 * field can only make the caller LESS specific — it can never pick up another
 * caller's identity. A field that is not a string, or is empty or whitespace
 * only, counts as absent. Present values are kept verbatim (not trimmed), so
 * the identity matches the one the transport decoded.
 */
export function resolveMcpCaller(
  request: Pick<
    MCPRequest,
    '_callerSessionId' | '_callerAgentId' | '_callerWorkspaceRoot'
  >,
): McpCaller {
  const agentId = presentIdentity(request._callerAgentId);
  const sessionId = presentIdentity(request._callerSessionId);
  const workspaceRoot = presentIdentity(request._callerWorkspaceRoot);

  return {
    kind: callerKindOf(agentId, sessionId, workspaceRoot),
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(agentId === undefined ? {} : { agentId }),
    ...(workspaceRoot === undefined ? {} : { workspaceRoot }),
  };
}

function callerKindOf(
  agentId: string | undefined,
  sessionId: string | undefined,
  workspaceRoot: string | undefined,
): McpCallerKind {
  if (agentId !== undefined) return 'agent';
  if (sessionId !== undefined) return 'session';
  if (workspaceRoot !== undefined) return 'workspace';
  return 'anonymous';
}

/** `value` when it is a string with a non-whitespace character, else `undefined`. */
function presentIdentity(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value
    : undefined;
}
