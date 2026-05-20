/**
 * IMcpServerStatus — read-only status port for the in-process MCP server.
 *
 * Exists to break the construction-time cycle between vscode-lm-tools'
 * `CodeExecutionMCP` (which builds the `ptah.*` API used by spawned children)
 * and cli-agent-runtime's `PtahCliSpawnOptions` (which needs to know whether
 * the MCP server is running so spawned children can be wired to it).
 *
 * Consumers depend on this port, not on the concrete `CodeExecutionMCP`
 * class, keeping the module graph acyclic.
 */
export interface IMcpServerStatus {
  /** HTTP port the MCP server is listening on, or null if not started. */
  getPort(): number | null;
}
