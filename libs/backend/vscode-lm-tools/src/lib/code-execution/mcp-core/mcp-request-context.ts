/**
 * MCP request-scoped context.
 *
 * An MCP tool call carries the identity of the session that made it via the
 * URL path (`/session/{id}`, decoded to `request._callerSessionId` by the HTTP
 * handler). Path-resolving tools must resolve a relative path against THAT
 * session's workspace — not the process-global active folder — otherwise a call
 * from one workspace silently reads another when several are open.
 *
 * The MCP server and PtahAPI are process-wide singletons with no per-call
 * parameters, so we thread the caller session through an AsyncLocalStorage.
 * Each `tools/call` runs inside `runWithMcpRequestContext`, and the workspace
 * resolver reads the caller session back via `getCallerSessionId`. Because
 * AsyncLocalStorage is per-async-context, concurrent tool calls from different
 * sessions never clobber each other's context.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

/** Data carried for the lifetime of a single MCP tool call. */
export interface McpRequestContext {
  /** tabId or realSessionId of the session that issued this tool call. */
  readonly callerSessionId?: string;
}

const storage = new AsyncLocalStorage<McpRequestContext>();

/**
 * Run `fn` with `context` bound as the current MCP request context. The context
 * is visible to every async operation started within `fn` (across awaits) and
 * is torn down automatically when `fn` settles.
 */
export function runWithMcpRequestContext<T>(
  context: McpRequestContext,
  fn: () => T,
): T {
  return storage.run(context, fn);
}

/**
 * The caller session id of the in-flight MCP tool call, or `undefined` when not
 * running inside `runWithMcpRequestContext` (e.g. the stdio/CLI path or an
 * internal call).
 */
export function getCallerSessionId(): string | undefined {
  return storage.getStore()?.callerSessionId;
}
