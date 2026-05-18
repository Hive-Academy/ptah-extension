/**
 * Gemini CLI MCP Server Installer
 *
 * Config: ~/.gemini/settings.json (user-global)
 * Root key: "mcpServers"
 * Type field: not included (Gemini infers from presence of "command" vs "httpUrl")
 *
 * Note: Gemini uses "httpUrl" instead of "url" for remote servers.
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
  readJsonConfig,
  writeJsonConfig,
  getServersObject,
  configToJson,
  jsonToConfig,
  uninstallServer,
} from '../mcp-config-io.utils';

export class GeminiMcpInstaller implements IMcpServerInstaller {
  readonly target = 'gemini' as const;

  private static readonly ROOT_KEY = 'mcpServers';

  install(
    serverKey: string,
    config: McpServerConfig,
    _workspaceRoot?: string,
  ): Promise<McpInstallResult> {
    const configPath = this.getConfigPath();
    try {
      const fileConfig = readJsonConfig(configPath);
      const servers = getServersObject(fileConfig, GeminiMcpInstaller.ROOT_KEY);

      // Gemini uses "httpUrl" instead of "url" for HTTP transports
      const json = configToJson(config, false);
      if (config.type === 'http' || config.type === 'sse') {
        json['httpUrl'] = json['url'];
        delete json['url'];
      }

      servers[serverKey] = json;
      fileConfig[GeminiMcpInstaller.ROOT_KEY] = servers;
      writeJsonConfig(configPath, fileConfig);

      return Promise.resolve({
        target: this.target,
        success: true,
        configPath,
      });
    } catch (error) {
      return Promise.resolve({
        target: this.target,
        success: false,
        configPath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
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
        GeminiMcpInstaller.ROOT_KEY,
        serverKey,
      ),
    );
  }

  listInstalled(_workspaceRoot?: string): Promise<InstalledMcpServer[]> {
    const configPath = this.getConfigPath();
    const fileConfig = readJsonConfig(configPath);
    const servers = getServersObject(fileConfig, GeminiMcpInstaller.ROOT_KEY);
    const result: InstalledMcpServer[] = [];

    for (const [key, value] of Object.entries(servers)) {
      if (typeof value !== 'object' || value === null) continue;

      const raw = value as Record<string, unknown>;

      // Normalize Gemini's "httpUrl" back to "url"
      if (typeof raw['httpUrl'] === 'string' && !raw['url']) {
        raw['url'] = raw['httpUrl'];
        delete raw['httpUrl'];
      }

      result.push({
        serverKey: key,
        target: this.target,
        configPath,
        config: jsonToConfig(raw),
        managedByPtah: false,
      });
    }

    return Promise.resolve(result);
  }

  getConfigPath(_workspaceRoot?: string): string {
    return path.join(os.homedir(), '.gemini', 'settings.json');
  }
}
