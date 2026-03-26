/**
 * Shared constants for the Agent SDK library
 *
 * Centralizes magic values used across multiple modules to prevent
 * duplication and ensure consistent behavior.
 */

/**
 * Default port for Ptah HTTP MCP server.
 * Used by SdkQueryOptionsBuilder, PtahCliAdapter, and InternalQueryService.
 * Matches the default port configured in vscode-lm-tools/CodeExecutionMCP.
 */
export const PTAH_MCP_DEFAULT_PORT = 51820;

/**
 * Actual runtime port for the Ptah HTTP MCP server.
 *
 * Starts as the default (51820). Updated by main.ts after the MCP server
 * starts — it may differ from the default when the configured port is
 * unavailable (EACCES on Windows Hyper-V, EADDRINUSE) and the server
 * falls back to an OS-assigned port.
 *
 * All consumers (SdkQueryOptionsBuilder, PtahCliAdapter, InternalQueryService)
 * read this at query time, so they always get the actual running port.
 */
export let PTAH_MCP_PORT = PTAH_MCP_DEFAULT_PORT;

/**
 * Update the runtime MCP port. Called once from main.ts after the MCP
 * server successfully starts.
 */
export function setPtahMcpPort(port: number): void {
  PTAH_MCP_PORT = port;
}
