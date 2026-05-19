/**
 * MCP Server Installer Strategy Interface
 *
 * Each CLI/IDE target implements this interface to handle reading/writing
 * MCP server configurations in its own config file format and location.
 */

import type {
  McpInstallTarget,
  McpServerConfig,
  McpInstallResult,
  InstalledMcpServer,
} from '@ptah-extension/shared';

export interface IMcpServerInstaller {
  /** Which target this installer writes to */
  readonly target: McpInstallTarget;

  /**
   * Install an MCP server config into this target's config file.
   * Reads existing config, merges the new server entry, and writes atomically.
   *
   * @param serverKey - Key name in the config (e.g., "github", "filesystem")
   * @param config - Server transport configuration
   * @param workspaceRoot - Workspace root for workspace-scoped targets (optional for global targets)
   */
  install(
    serverKey: string,
    config: McpServerConfig,
    workspaceRoot?: string,
  ): Promise<McpInstallResult>;

  /**
   * Remove an MCP server entry from this target's config file.
   *
   * @param serverKey - Key name to remove
   * @param workspaceRoot - Workspace root for workspace-scoped targets
   */
  uninstall(
    serverKey: string,
    workspaceRoot?: string,
  ): Promise<McpInstallResult>;

  /**
   * List all MCP servers currently configured in this target's config file.
   *
   * @param workspaceRoot - Workspace root for workspace-scoped targets
   */
  listInstalled(workspaceRoot?: string): Promise<InstalledMcpServer[]>;

  /**
   * Resolve the absolute path of the config file for this target.
   *
   * @param workspaceRoot - Workspace root for workspace-scoped targets
   */
  getConfigPath(workspaceRoot?: string): string;
}
