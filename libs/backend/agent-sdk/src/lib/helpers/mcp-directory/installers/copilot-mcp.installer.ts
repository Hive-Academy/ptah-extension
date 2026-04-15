/**
 * GitHub Copilot CLI MCP Server Installer
 *
 * Config: ~/.copilot/mcp-config.json (user-global)
 * Root key: "mcpServers"
 * Type field: not included
 */

import * as os from 'os';
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

export class CopilotMcpInstaller implements IMcpServerInstaller {
  readonly target = 'copilot' as const;

  private static readonly ROOT_KEY = 'mcpServers';
  private static readonly INCLUDE_TYPE = false;

  install(
    serverKey: string,
    config: McpServerConfig,
    _workspaceRoot?: string,
  ): Promise<McpInstallResult> {
    const configPath = this.getConfigPath();
    return Promise.resolve(
      installServer(
        this.target,
        configPath,
        CopilotMcpInstaller.ROOT_KEY,
        serverKey,
        config,
        CopilotMcpInstaller.INCLUDE_TYPE,
      ),
    );
  }

  uninstall(
    serverKey: string,
    _workspaceRoot?: string,
  ): Promise<McpInstallResult> {
    const configPath = this.getConfigPath();
    return Promise.resolve(
      uninstallServer(
        this.target,
        configPath,
        CopilotMcpInstaller.ROOT_KEY,
        serverKey,
      ),
    );
  }

  listInstalled(_workspaceRoot?: string): Promise<InstalledMcpServer[]> {
    const configPath = this.getConfigPath();
    return Promise.resolve(
      listInstalledServers(
        this.target,
        configPath,
        CopilotMcpInstaller.ROOT_KEY,
      ),
    );
  }

  getConfigPath(_workspaceRoot?: string): string {
    return path.join(os.homedir(), '.copilot', 'mcp-config.json');
  }
}
