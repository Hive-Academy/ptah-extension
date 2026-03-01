/**
 * Shared constants for the Agent SDK library
 *
 * Centralizes magic values used across multiple modules to prevent
 * duplication and ensure consistent behavior.
 */

/**
 * Default port for Ptah HTTP MCP server.
 * Used by SdkQueryOptionsBuilder, PtahCliAdapter, and InternalQueryService.
 * Matches the port configured in vscode-lm-tools/CodeExecutionMCP.
 */
export const PTAH_MCP_PORT = 51820;
