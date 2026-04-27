/**
 * Chat premium-context resolution helpers (Wave C7e).
 *
 * Owns the three premium-config helpers that ChatSessionService and
 * ChatPtahCliService share: MCP-server availability check, enhanced
 * prompt resolution (TASK_2025_151), and plugin-path resolution
 * (TASK_2025_153).
 *
 * Extracted byte-identically from `chat-rpc.handlers.ts`.
 */

import { injectable, inject } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import {
  SDK_TOKENS,
  PluginLoaderService,
  type EnhancedPromptsService,
} from '@ptah-extension/agent-sdk';
import { CodeExecutionMCP } from '@ptah-extension/vscode-lm-tools';

@injectable()
export class ChatPremiumContextService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.CODE_EXECUTION_MCP)
    private readonly codeExecutionMcp: CodeExecutionMCP,
    @inject(SDK_TOKENS.SDK_ENHANCED_PROMPTS_SERVICE)
    private readonly enhancedPromptsService: EnhancedPromptsService,
    @inject(SDK_TOKENS.SDK_PLUGIN_LOADER)
    private readonly pluginLoader: PluginLoaderService,
  ) {}

  /**
   * Checks if the MCP server is currently running (TASK_2025_108)
   * Uses CodeExecutionMCP.getPort() - non-null means server is running
   *
   * @returns true if MCP server is available
   */
  isMcpServerRunning(): boolean {
    return this.codeExecutionMcp.getPort() !== null;
  }

  /**
   * Resolve enhanced prompt content for premium users (TASK_2025_151)
   *
   * Returns the AI-generated enhanced prompt content if available and enabled,
   * or undefined to fall back to default behavior.
   *
   * @param workspacePath - Workspace path to resolve prompt for
   * @param isPremium - Whether the user has premium features
   * @returns Enhanced prompt content string, or undefined on error/disabled/non-premium
   */
  async resolveEnhancedPromptsContent(
    workspacePath: string | undefined,
    isPremium: boolean,
  ): Promise<string | undefined> {
    if (!isPremium || !workspacePath) {
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
   * Resolve plugin paths for premium users (TASK_2025_153)
   *
   * Reads workspace plugin configuration and resolves to absolute paths.
   * Only returns paths for premium users. Non-premium users get no plugins.
   *
   * @param isPremium - Whether the user has premium features
   * @returns Resolved plugin directory paths, or undefined if none
   */
  resolvePluginPaths(isPremium: boolean): string[] | undefined {
    if (!isPremium) {
      return undefined;
    }

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
