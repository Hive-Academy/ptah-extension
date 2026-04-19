/**
 * Claude Code / Codex / Ptah CLI MCP Server Installer
 *
 * Config: .mcp.json (workspace-scoped, shared by Claude Code, Codex, and Ptah CLI)
 * Root key: "mcpServers"
 * Type field: not included (Claude infers from presence of "command" vs "url")
 */

import * as path from 'path';
import type {
  McpServerConfig,
  McpInstallResult,
  InstalledMcpServer,
} from '@ptah-extension/shared';
import type { IMcpServerInstaller } from '../mcp-installer.interface';
import {
  installServer,
  uninstallServer,
  listInstalledServers,
} from '../mcp-config-io.utils';

export class ClaudeMcpInstaller implements IMcpServerInstaller {
  readonly target = 'claude' as const;

  private static readonly ROOT_KEY = 'mcpServers';
  private static readonly INCLUDE_TYPE = false;

  install(
    serverKey: string,
    config: McpServerConfig,
    workspaceRoot?: string,
  ): Promise<McpInstallResult> {
    const configPath = this.getConfigPath(workspaceRoot);
    return Promise.resolve(
      installServer(
        this.target,
        configPath,
        ClaudeMcpInstaller.ROOT_KEY,
        serverKey,
        config,
        ClaudeMcpInstaller.INCLUDE_TYPE,
      ),
    );
  }

  uninstall(
    serverKey: string,
    workspaceRoot?: string,
  ): Promise<McpInstallResult> {
    const configPath = this.getConfigPath(workspaceRoot);
    return Promise.resolve(
      uninstallServer(
        this.target,
        configPath,
        ClaudeMcpInstaller.ROOT_KEY,
        serverKey,
      ),
    );
  }

  listInstalled(workspaceRoot?: string): Promise<InstalledMcpServer[]> {
    const configPath = this.getConfigPath(workspaceRoot);
    return Promise.resolve(
      listInstalledServers(
        this.target,
        configPath,
        ClaudeMcpInstaller.ROOT_KEY,
      ),
    );
  }

  getConfigPath(workspaceRoot?: string): string {
    if (!workspaceRoot)
      throw new Error('Claude MCP installer requires a workspace root');
    return path.join(workspaceRoot, '.mcp.json');
  }
}
