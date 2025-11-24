import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * MCP server information
 */
export interface MCPServerInfo {
  readonly name: string;
  readonly command: string;
  readonly args: string[];
  readonly env: Record<string, string>;
  readonly type: 'stdio' | 'http' | 'sse';
  readonly url?: string;
  status: 'running' | 'stopped' | 'error' | 'unknown';
  error?: string;
}

/**
 * MCP resource information
 */
export interface MCPResourceInfo {
  readonly serverName: string;
  readonly uri: string;
  readonly fullUri: string;
  readonly name: string;
  readonly description?: string;
}

/**
 * MCP discovery result
 */
export interface MCPDiscoveryResult {
  success: boolean;
  servers?: MCPServerInfo[];
  error?: string;
}

/**
 * MCP search request
 */
export interface MCPSearchRequest {
  query: string;
  maxResults?: number;
  includeOffline?: boolean;
}

/**
 * Discovers and manages MCP servers from .mcp.json configuration
 *
 * ARCHITECTURE:
 * - Reads .mcp.json from project + user directories
 * - Merges configurations with priority (project > user)
 * - Checks server health via `claude mcp list`
 * - Polls health every 30 seconds
 * - Watches config files for changes
 */
@injectable()
export class MCPDiscoveryService {
  private cache: MCPServerInfo[] = [];
  private healthCheckInterval?: NodeJS.Timeout;
  private watchers: vscode.FileSystemWatcher[] = [];

  constructor(
    @inject(TOKENS.CONTEXT) private context: vscode.ExtensionContext
  ) {}

  /**
   * Discover all MCP servers
   */
  async discoverMCPServers(): Promise<MCPDiscoveryResult> {
    try {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) {
        return { success: false, error: 'No workspace folder open' };
      }

      // Read all config files
      const configs = await this.readAllConfigs(workspaceRoot);

      // Merge configs (higher priority overrides)
      const merged = this.mergeConfigs(configs);

      // Parse server definitions
      const servers: MCPServerInfo[] = Object.entries(merged.mcpServers || {}).map(([name, config]: [string, any]) => ({
        name,
        command: config.command,
        args: config.args || [],
        env: this.expandEnvVars(config.env || {}),
        type: config.type || 'stdio',
        url: config.url,
        status: 'unknown' as const,
        error: undefined
      }));

      // Update cache
      this.cache = servers;

      // Check server health (async, don't block)
      this.checkServerHealth();

      return { success: true, servers };
    } catch (error) {
      return {
        success: false,
        error: `Failed to discover MCP servers: ${error.message}`
      };
    }
  }

  /**
   * Search MCP servers by query
   */
  async searchMCPServers(request: MCPSearchRequest): Promise<MCPDiscoveryResult> {
    try {
      // Ensure cache is populated
      if (this.cache.length === 0) {
        await this.discoverMCPServers();
      }

      const { query, maxResults = 20, includeOffline = false } = request;

      // Filter by online status
      let filtered = includeOffline
        ? this.cache
        : this.cache.filter(s => s.status === 'running');

      // Filter by query
      if (query && query.trim() !== '') {
        const lowerQuery = query.toLowerCase();
        filtered = filtered.filter(server =>
          server.name.toLowerCase().includes(lowerQuery)
        );
      }

      return { success: true, servers: filtered.slice(0, maxResults) };
    } catch (error) {
      return {
        success: false,
        error: `Failed to search MCP servers: ${error.message}`
      };
    }
  }

  /**
   * Initialize file watchers and health polling
   */
  initializeWatchers(): void {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) return;

    // Watch .mcp.json
    const mcpWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(workspaceRoot, '.mcp.json')
    );

    const refreshCache = () => {
      this.discoverMCPServers().catch(error => {
        console.error('[MCPDiscovery] Failed to refresh cache:', error);
      });
    };

    mcpWatcher.onDidChange(refreshCache);
    mcpWatcher.onDidCreate(refreshCache);
    mcpWatcher.onDidDelete(refreshCache);

    this.watchers.push(mcpWatcher);
    this.context.subscriptions.push(mcpWatcher);

    // Health check polling (every 30s)
    this.healthCheckInterval = setInterval(() => {
      this.checkServerHealth();
    }, 30000);

    // Initial health check
    this.checkServerHealth();
  }

  /**
   * Read all MCP config files
   */
  private async readAllConfigs(workspaceRoot: string): Promise<any[]> {
    const configPaths = [
      path.join(workspaceRoot, '.mcp.json'),
      path.join(workspaceRoot, '.claude/settings.local.json'),
      path.join(os.homedir(), '.claude/settings.local.json')
    ];

    const configs = await Promise.all(
      configPaths.map(async (p) => {
        try {
          const content = await fs.readFile(p, 'utf-8');
          return JSON.parse(content);
        } catch {
          return null;
        }
      })
    );

    return configs.filter(Boolean);
  }

  /**
   * Merge multiple configs (later configs override earlier)
   */
  private mergeConfigs(configs: any[]): any {
    return configs.reduce((merged, config) => {
      return {
        ...merged,
        mcpServers: {
          ...merged.mcpServers,
          ...config.mcpServers
        }
      };
    }, { mcpServers: {} });
  }

  /**
   * Expand environment variables in config
   */
  private expandEnvVars(env: Record<string, string>): Record<string, string> {
    const expanded: Record<string, string> = {};

    for (const [key, value] of Object.entries(env)) {
      expanded[key] = value.replace(/\$\{([^}:]+)(?::- ([^}]+))?\}/g, (_, varName, defaultValue) => {
        return process.env[varName] || defaultValue || '';
      });
    }

    return expanded;
  }

  /**
   * Check health of all MCP servers via CLI
   */
  private async checkServerHealth(): Promise<void> {
    try {
      const result = await execAsync('claude mcp list --output-format json', {
        timeout: 5000
      });

      const status = JSON.parse(result.stdout);

      for (const server of this.cache) {
        if (status[server.name]) {
          server.status = status[server.name].status || 'unknown';
          server.error = status[server.name].error;
        } else {
          server.status = 'unknown';
        }
      }
    } catch (error) {
      console.warn('[MCPDiscovery] Failed to check server health:', error.message);
      // Don't update status if health check fails
    }
  }

  /**
   * Cleanup on disposal
   */
  dispose(): void {
    this.watchers.forEach(w => w.dispose());
    this.watchers = [];

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
    }
  }
}
