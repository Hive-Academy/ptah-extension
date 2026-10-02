/**
 * IMcpSubagentRootRegistrar — keeps a Ptah MCP entry in a folder's
 * `.mcp.json` for as long as an agent session runs there.
 *
 * Claude Code subagents (the `Task` tool) do not inherit the parent session's
 * programmatic MCP servers; they read `<cwd>/.mcp.json`. The in-process MCP
 * server writes that entry for every OPEN workspace folder only, so a session
 * started in a folder that is not open — a child session's git worktree — would
 * have Ptah tools in its main thread and none in its subagents.
 *
 * A port rather than the concrete server for the same reason as
 * `IMcpServerStatus`: the consumer (cli-agent-runtime) must not depend on
 * vscode-lm-tools, which builds the API the consumer's children call.
 *
 * Hosts that never start an MCP server do not register this token; consumers
 * inject it as optional and treat its absence like `registered: false`.
 */
export interface IMcpSubagentRootRegistrar {
  /**
   * Add `root` to the folders whose `.mcp.json` carries the Ptah entry, and
   * write it before resolving.
   *
   * Never rejects. `registered: false` (with a `reason`) means no entry is on
   * disk for `root` and nothing was retained: the session may still start, but
   * its subagents have no Ptah tools. Retaining a root that is already retained
   * is not counted; one {@link releaseRoot} gives it back.
   */
  retainRoot(root: string): Promise<McpSubagentRootRetention>;

  /**
   * Give `root` back. Its entry is removed unless the folder is also an open
   * workspace folder (which keeps its own entry).
   *
   * Idempotent: releasing a root that is not retained does nothing. Never
   * rejects; a failed removal is logged and retried by the server's next
   * reconcile or stop.
   */
  releaseRoot(root: string): Promise<void>;
}

/** The outcome of {@link IMcpSubagentRootRegistrar.retainRoot}. */
export interface McpSubagentRootRetention {
  /** True only when a Ptah entry is on disk in `<root>/.mcp.json`. */
  readonly registered: boolean;
  /** Present exactly when `registered` is false. */
  readonly reason?: string;
}
