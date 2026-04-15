/**
 * MCP Install Service (Facade)
 *
 * Orchestrates MCP server installation/uninstallation across all CLI targets.
 * Mirrors the pattern of CliPluginSyncService from cli-skill-sync.
 *
 * Responsibilities:
 * - Delegates to target-specific IMcpServerInstaller implementations
 * - Tracks installs via McpInstallManifestTracker
 * - Aggregates installed servers from all targets
 */

import type {
  McpInstallTarget,
  McpServerConfig,
  McpInstallResult,
  InstalledMcpServer,
} from '@ptah-extension/shared';
import type { IMcpServerInstaller } from './mcp-installer.interface';
import { McpInstallManifestTracker } from './mcp-install-manifest';
import { VscodeMcpInstaller } from './installers/vscode-mcp.installer';
import { ClaudeMcpInstaller } from './installers/claude-mcp.installer';
import { CursorMcpInstaller } from './installers/cursor-mcp.installer';
import { GeminiMcpInstaller } from './installers/gemini-mcp.installer';
import { CopilotMcpInstaller } from './installers/copilot-mcp.installer';

export class McpInstallService {
  private readonly installers: Map<McpInstallTarget, IMcpServerInstaller>;
  private readonly manifestTracker: McpInstallManifestTracker;

  constructor() {
    this.installers = new Map<McpInstallTarget, IMcpServerInstaller>([
      ['vscode', new VscodeMcpInstaller()],
      ['claude', new ClaudeMcpInstaller()],
      ['cursor', new CursorMcpInstaller()],
      ['gemini', new GeminiMcpInstaller()],
      ['copilot', new CopilotMcpInstaller()],
    ]);
    this.manifestTracker = new McpInstallManifestTracker();
  }

  /**
   * Install an MCP server to one or more targets.
   *
   * @param serverName - Registry name for tracking (e.g., "io.github.user/server")
   * @param serverKey - Config key (e.g., "github", "filesystem")
   * @param config - Transport configuration
   * @param targets - Which targets to install to
   * @param workspaceRoot - Workspace root for workspace-scoped targets
   */
  async install(
    serverName: string,
    serverKey: string,
    config: McpServerConfig,
    targets: McpInstallTarget[],
    workspaceRoot?: string,
  ): Promise<McpInstallResult[]> {
    const results: McpInstallResult[] = [];
    const successfulTargets: McpInstallTarget[] = [];

    for (const target of targets) {
      const installer = this.installers.get(target);
      if (!installer) {
        results.push({
          target,
          success: false,
          configPath: '',
          error: `Unknown install target: ${target}`,
        });
        continue;
      }

      const result = await installer.install(serverKey, config, workspaceRoot);
      results.push(result);

      if (result.success) {
        successfulTargets.push(target);
      }
    }

    // Track successful installs in manifest
    if (successfulTargets.length > 0) {
      this.manifestTracker.recordInstall(
        serverKey,
        serverName,
        successfulTargets,
        config,
      );
    }

    return results;
  }

  /**
   * Uninstall an MCP server from one or more targets.
   * If no targets specified, uninstalls from all targets the server was installed to.
   */
  async uninstall(
    serverKey: string,
    targets?: McpInstallTarget[],
    workspaceRoot?: string,
  ): Promise<McpInstallResult[]> {
    // If no targets specified, use the manifest to find where it was installed
    const resolvedTargets =
      targets && targets.length > 0
        ? targets
        : this.manifestTracker.getTargetsForServer(serverKey);

    // If still empty, try all targets
    const finalTargets =
      resolvedTargets.length > 0
        ? resolvedTargets
        : ([...this.installers.keys()] as McpInstallTarget[]);

    const results: McpInstallResult[] = [];

    for (const target of finalTargets) {
      const installer = this.installers.get(target);
      if (!installer) continue;

      const result = await installer.uninstall(serverKey, workspaceRoot);
      results.push(result);
    }

    // Update manifest
    this.manifestTracker.recordUninstall(serverKey, targets);

    return results;
  }

  /**
   * List all installed MCP servers across all targets.
   * Enriches results with Ptah management status from the manifest.
   */
  async listInstalled(workspaceRoot?: string): Promise<InstalledMcpServer[]> {
    const allServers: InstalledMcpServer[] = [];

    for (const installer of this.installers.values()) {
      try {
        const servers = await installer.listInstalled(workspaceRoot);

        // Enrich with manifest tracking
        for (const server of servers) {
          server.managedByPtah = this.manifestTracker.isManagedByPtah(
            server.serverKey,
          );
        }

        allServers.push(...servers);
      } catch {
        // Non-fatal: skip targets whose config files don't exist
      }
    }

    return allServers;
  }

  /**
   * Get the config path for a specific target.
   */
  getConfigPath(
    target: McpInstallTarget,
    workspaceRoot?: string,
  ): string | null {
    const installer = this.installers.get(target);
    if (!installer) return null;
    try {
      return installer.getConfigPath(workspaceRoot);
    } catch {
      return null;
    }
  }
}
