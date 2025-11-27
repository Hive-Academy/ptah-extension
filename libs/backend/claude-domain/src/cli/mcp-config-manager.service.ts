import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { injectable, inject } from 'tsyringe';
import { TOKENS, Logger } from '@ptah-extension/vscode-core';

/**
 * MCP Server configuration entry
 */
interface MCPServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

/**
 * .mcp.json file structure
 */
interface MCPConfig {
  mcpServers: Record<string, MCPServerConfig>;
}

/**
 * Manages .mcp.json file for Ptah MCP server registration
 *
 * ARCHITECTURE:
 * - Creates/updates .mcp.json in workspace root
 * - Preserves existing MCP server entries (merge pattern)
 * - Writes actual port number (not environment variable)
 * - Handles file errors gracefully (non-blocking)
 *
 * PATTERN SOURCE:
 * - File handling: libs/backend/workspace-intelligence/src/autocomplete/mcp-discovery.service.ts
 * - Injectable service: libs/backend/vscode-lm-tools/src/lib/code-execution/code-execution-mcp.service.ts
 */
@injectable()
export class MCPConfigManagerService {
  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  /**
   * Ensure Ptah MCP server is registered in .mcp.json
   * Creates file if missing, merges if exists
   *
   * @param port - Actual port number (not placeholder)
   */
  async ensurePtahMCPConfig(port: number): Promise<void> {
    try {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) {
        this.logger.info(
          'No workspace folder open, skipping MCP config',
          'MCPConfigManager'
        );
        return;
      }

      const configPath = this.getConfigPath(workspaceRoot);

      // Read existing config or create empty
      let existingConfig: MCPConfig = { mcpServers: {} };
      try {
        const content = await fs.readFile(configPath, 'utf-8');
        existingConfig = JSON.parse(content);
      } catch (error) {
        // File doesn't exist or invalid JSON - will create new
        this.logger.info(
          'No existing .mcp.json found, creating new',
          'MCPConfigManager'
        );
      }

      // Merge Ptah server config (overwrite if exists)
      const updatedConfig: MCPConfig = {
        mcpServers: {
          ...existingConfig.mcpServers,
          ptah: {
            command: 'http',
            args: [`http://localhost:${port}`],
          },
        },
      };

      // Write updated config
      await fs.writeFile(
        configPath,
        JSON.stringify(updatedConfig, null, 2),
        'utf-8'
      );

      this.logger.info(
        `Ptah MCP server registered in .mcp.json (port ${port})`,
        'MCPConfigManager',
        { configPath, port }
      );
    } catch (error) {
      this.logger.error(
        'Failed to write .mcp.json',
        error instanceof Error ? error : new Error(String(error))
      );
      throw error;
    }
  }

  /**
   * Remove Ptah MCP server entry from .mcp.json (cleanup on deactivation)
   */
  async removePtahMCPConfig(): Promise<void> {
    try {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) {
        return;
      }

      const configPath = this.getConfigPath(workspaceRoot);

      // Read existing config
      try {
        const content = await fs.readFile(configPath, 'utf-8');
        const config: MCPConfig = JSON.parse(content);

        // Remove ptah entry
        if (config.mcpServers?.['ptah']) {
          delete config.mcpServers['ptah'];

          // Write updated config
          await fs.writeFile(
            configPath,
            JSON.stringify(config, null, 2),
            'utf-8'
          );

          this.logger.info(
            'Ptah MCP server removed from .mcp.json',
            'MCPConfigManager'
          );
        }
      } catch (error) {
        // File doesn't exist or invalid - nothing to remove
        this.logger.info('No .mcp.json to clean up', 'MCPConfigManager');
      }
    } catch (error) {
      // Non-blocking cleanup - log but don't throw
      this.logger.error(
        'Failed to remove Ptah MCP config (non-blocking)',
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * Get .mcp.json file path for workspace
   */
  private getConfigPath(workspaceRoot: string): string {
    return path.join(workspaceRoot, '.mcp.json');
  }
}
