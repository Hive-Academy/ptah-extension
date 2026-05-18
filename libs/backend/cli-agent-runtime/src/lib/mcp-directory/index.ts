/**
 * MCP Server Directory Module
 *
 * Provides MCP server discovery (via Official MCP Registry) and
 * installation to multiple CLI/IDE targets.
 */

// Registry API client
export { McpRegistryProvider } from './mcp-registry.provider';

// Install service facade
export { McpInstallService } from './mcp-install.service';

// Manifest tracker (for direct access if needed)
export { McpInstallManifestTracker } from './mcp-install-manifest';

// Strategy interface (for extension/custom installers)
export type { IMcpServerInstaller } from './mcp-installer.interface';

// Individual installers (normally accessed via McpInstallService)
export { VscodeMcpInstaller } from './installers/vscode-mcp.installer';
export { ClaudeMcpInstaller } from './installers/claude-mcp.installer';
export { CursorMcpInstaller } from './installers/cursor-mcp.installer';
export { GeminiMcpInstaller } from './installers/gemini-mcp.installer';
export { CopilotMcpInstaller } from './installers/copilot-mcp.installer';
