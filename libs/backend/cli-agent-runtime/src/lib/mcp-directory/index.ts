/**
 * MCP Server Directory Module
 *
 * Provides MCP server discovery (via Official MCP Registry) and
 * installation to multiple CLI/IDE targets.
 */
export { McpRegistryProvider } from './mcp-registry.provider';
export { McpRegistrySourceRegistry } from './mcp-registry-source.registry';
export type {
  IMcpRegistrySource,
  McpRegistrySourceId,
} from './mcp-registry-source.interface';
export { SmitheryRegistrySource } from './smithery-registry.source';
export type {
  SmitheryLogger,
  SmitheryRegistrySourceOptions,
} from './smithery-registry.source';
export { SmitheryConnectionResolver } from './smithery-connection-resolver';
export type {
  SmitheryResolveInput,
  SmitheryConnectionResolverOptions,
} from './smithery-connection-resolver';
export {
  SmitheryKeyMissingError,
  SmitheryConfigInvalidError,
} from './smithery-errors';
export {
  buildSmitheryUrl,
  SMITHERY_DEFAULT_REGISTRY_BASE,
  SMITHERY_DEFAULT_CONNECTION_HOST,
} from './smithery-wire.constants';
export type {
  BuildSmitheryUrlInput,
  BuiltSmitheryUrl,
} from './smithery-wire.constants';
export { McpInstallService } from './mcp-install.service';
export { McpInstallManifestTracker } from './mcp-install-manifest';
export type { IMcpServerInstaller } from './mcp-installer.interface';
export { VscodeMcpInstaller } from './installers/vscode-mcp.installer';
export { ClaudeMcpInstaller } from './installers/claude-mcp.installer';
export { CursorMcpInstaller } from './installers/cursor-mcp.installer';
export { GeminiMcpInstaller } from './installers/gemini-mcp.installer';
export { CopilotMcpInstaller } from './installers/copilot-mcp.installer';
