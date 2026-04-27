/**
 * VS Code MCP Server Installer
 *
 * Config: .vscode/mcp.json (workspace-scoped)
 * Root key: "servers"
 * Type field: included (VS Code uses "type" to distinguish stdio/http/sse)
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
import { SdkError } from '../../../errors';

export class VscodeMcpInstaller implements IMcpServerInstaller {
  readonly target = 'vscode' as const;

  private static readonly ROOT_KEY = 'servers';
  private static readonly INCLUDE_TYPE = true;

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
        VscodeMcpInstaller.ROOT_KEY,
        serverKey,
        config,
        VscodeMcpInstaller.INCLUDE_TYPE,
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
        VscodeMcpInstaller.ROOT_KEY,
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
        VscodeMcpInstaller.ROOT_KEY,
      ),
    );
  }

  getConfigPath(workspaceRoot?: string): string {
    if (!workspaceRoot)
      throw new SdkError('VS Code MCP installer requires a workspace root');
    return path.join(workspaceRoot, '.vscode', 'mcp.json');
  }
}
