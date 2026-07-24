/**
 * Workspace-root resolution for path-resolving MCP tools.
 *
 * A tool call must resolve a relative path against the workspace of the session
 * that issued it. Precedence, most specific first:
 *
 *   1. Caller session — the exact session that made THIS MCP call, identified by
 *      the request-scoped caller id. Concurrency-safe: two sessions calling
 *      tools at the same time each resolve against their own workspace.
 *   2. Active session — the most-recently-active session's workspace. Used off
 *      the MCP request path (stdio/CLI, internal calls) where there is no caller
 *      id, and as a fallback when the caller session carries no projectPath.
 *   3. Platform provider — the global active workspace folder.
 *
 * Returns `undefined` when none resolve, so callers surface a clear "no
 * workspace" error rather than silently resolving under an unintended root.
 */

export interface WorkspaceRootResolverDeps {
  /** Request-scoped caller session id, or undefined off the MCP call path. */
  getCallerSessionId: () => string | undefined;
  /** Workspace root for a specific session id, or undefined if unknown. */
  getSessionWorkspace: (idOrTabId: string) => string | undefined;
  /** Workspace root of the most-recently-active session, or undefined. */
  getActiveSessionWorkspace: () => string | undefined;
  /** Global active workspace folder from the platform provider, or undefined. */
  getProviderRoot: () => string | undefined;
}

/**
 * Resolve the workspace root using caller → active → provider precedence.
 * Any throw from a dependency degrades to the provider root rather than
 * propagating — resolution must never crash a tool call.
 */
export function resolveSessionWorkspaceRoot(
  deps: WorkspaceRootResolverDeps,
): string | undefined {
  try {
    const callerSessionId = deps.getCallerSessionId();
    if (callerSessionId) {
      const callerWorkspace = deps.getSessionWorkspace(callerSessionId);
      if (callerWorkspace) {
        return callerWorkspace;
      }
    }
    const activeWorkspace = deps.getActiveSessionWorkspace();
    if (activeWorkspace) {
      return activeWorkspace;
    }
  } catch {
    // fall through to the platform provider
  }
  return deps.getProviderRoot() || undefined;
}
