/**
 * Chat SDK-context resolution helpers.
 *
 * Owns the three SDK-config helpers that ChatSessionService and
 * ChatPtahCliService share: MCP-server availability check, enhanced
 * prompt resolution, and plugin-path resolution.
 */

import { injectable, inject } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import { SDK_TOKENS, PluginLoaderService } from '@ptah-extension/agent-sdk';
import {
  AGENT_GENERATION_TOKENS,
  type EnhancedPromptsService,
} from '@ptah-extension/agent-generation';
import { CodeExecutionMCP } from '@ptah-extension/vscode-lm-tools';

@injectable()
export class ChatSdkContextService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.CODE_EXECUTION_MCP)
    private readonly codeExecutionMcp: CodeExecutionMCP,
    @inject(AGENT_GENERATION_TOKENS.ENHANCED_PROMPTS_SERVICE)
    private readonly enhancedPromptsService: EnhancedPromptsService,
    @inject(SDK_TOKENS.SDK_PLUGIN_LOADER)
    private readonly pluginLoader: PluginLoaderService,
  ) {}

  /**
   * Checks if the MCP server is currently running.
   * Uses CodeExecutionMCP.getPort() - non-null means server is running.
   *
   * @returns true if MCP server is available
   */
  isMcpServerRunning(): boolean {
    return this.codeExecutionMcp.getPort() !== null;
  }

  /**
   * Resolve enhanced prompt content for the session.
   *
   * Returns the AI-generated enhanced prompt content if available and enabled,
   * or undefined to fall back to default behavior.
   *
   * @param workspacePath - Workspace path to resolve prompt for
   * @returns Enhanced prompt content string, or undefined on error/disabled
   */
  async resolveEnhancedPromptsContent(
    workspacePath: string | undefined,
  ): Promise<string | undefined> {
    if (!workspacePath) {
      return undefined;
    }

    try {
      const content =
        await this.enhancedPromptsService.getEnhancedPromptContent(
          workspacePath,
        );
      return content ?? undefined;
    } catch (error) {
      this.logger.debug(
        'Failed to resolve enhanced prompts content, using fallback',
        {
          error: error instanceof Error ? error.message : String(error),
        },
      );
      return undefined;
    }
  }

  /**
   * Resolve plugin paths for the session.
   *
   * Reads workspace plugin configuration and resolves to absolute paths.
   *
   * @returns Resolved plugin directory paths, or undefined if none
   */
  resolvePluginPaths(): string[] | undefined {
    try {
      const config = this.pluginLoader.getWorkspacePluginConfig();
      if (!config.enabledPluginIds || config.enabledPluginIds.length === 0) {
        return undefined;
      }
      const paths = this.pluginLoader.resolvePluginPaths(
        config.enabledPluginIds,
      );
      if (paths.length === 0) {
        return undefined;
      }
      this.logger.debug('Resolved plugin paths for session', {
        enabledCount: config.enabledPluginIds.length,
        resolvedCount: paths.length,
      });
      return paths;
    } catch (error) {
      this.logger.debug('Failed to resolve plugin paths', {
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }
}
