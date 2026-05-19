/**
 * Ptah CLI Spawn Options Service
 *
 * Injectable singleton that assembles premium feature options for spawnAgent().
 * Handles MCP server detection, enhanced prompts, plugin resolution,
 * hooks, and compaction configuration.
 *
 */

import { injectable, inject } from 'tsyringe';
import type { AuthEnv } from '@ptah-extension/shared';
import {
  Logger,
  TOKENS,
  isPremiumTier,
  type LicenseService,
} from '@ptah-extension/vscode-core';
import {
  PLATFORM_TOKENS,
  type IMcpServerStatus,
} from '@ptah-extension/platform-core';
import {
  SDK_TOKENS,
  SubagentHookHandler,
  CompactionHookHandler,
  CompactionConfigProvider,
  PluginLoaderService,
  assembleSystemPrompt,
  getActiveProviderId,
  PTAH_MCP_PORT,
  type HookEvent,
  type HookCallbackMatcher,
  type McpHttpServerConfig,
  type SdkPluginConfig,
} from '@ptah-extension/agent-sdk';
import { AGENT_GENERATION_TOKENS } from '@ptah-extension/agent-generation';
import type { EnhancedPromptsService } from '@ptah-extension/agent-generation';

/**
 * Assembled spawn options returned by assembleSpawnOptions()
 */
export interface PtahSpawnAssembly {
  readonly isPremium: boolean;
  /** System prompt mode: 'preset-append' uses claude_code base, 'standalone' uses Ptah harness */
  readonly systemPromptMode: 'preset-append' | 'standalone';
  readonly systemPromptContent: string | undefined;
  readonly mcpServers: Record<string, McpHttpServerConfig>;
  readonly plugins: SdkPluginConfig[] | undefined;
  readonly hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>> | undefined;
  readonly compactionControl:
    | { enabled: boolean; contextTokenThreshold: number }
    | undefined;
}

@injectable()
export class PtahCliSpawnOptions {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.LICENSE_SERVICE)
    private readonly licenseService: LicenseService,
    @inject(SDK_TOKENS.SDK_SUBAGENT_HOOK_HANDLER)
    private readonly subagentHookHandler: SubagentHookHandler,
    @inject(SDK_TOKENS.SDK_COMPACTION_HOOK_HANDLER)
    private readonly compactionHookHandler: CompactionHookHandler,
    @inject(SDK_TOKENS.SDK_COMPACTION_CONFIG_PROVIDER)
    private readonly compactionConfigProvider: CompactionConfigProvider,
    @inject(AGENT_GENERATION_TOKENS.ENHANCED_PROMPTS_SERVICE)
    private readonly enhancedPromptsService: EnhancedPromptsService,
    @inject(SDK_TOKENS.SDK_PLUGIN_LOADER)
    private readonly pluginLoader: PluginLoaderService,
    @inject(PLATFORM_TOKENS.MCP_SERVER_STATUS, { isOptional: true })
    private readonly mcpServerStatus: IMcpServerStatus | undefined,
  ) {}

  /**
   * Assemble all premium spawn options for a headless agent.
   *
   * @param authEnv - Isolated auth environment for the agent
   * @param cwd - Working directory
   * @param projectGuidance - Optional project guidance text
   * @returns Assembled spawn options
   */
  async assembleSpawnOptions(
    authEnv: AuthEnv,
    cwd: string,
    projectGuidance?: string,
  ): Promise<PtahSpawnAssembly> {
    let isPremium = false;
    try {
      const licenseStatus = await this.licenseService.verifyLicense();
      isPremium = isPremiumTier(licenseStatus);
    } catch (error) {
      this.logger.warn(
        `[PtahCliSpawnOptions] License verification failed, defaulting to non-premium: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const mcpServerRunning = this.isMcpServerRunning();
    const enhancedPromptsContent = await this.resolveEnhancedPromptsContent(
      cwd,
      isPremium,
    );
    const activeProviderId = getActiveProviderId(authEnv);
    const promptResult = assembleSystemPrompt({
      providerId: activeProviderId,
      authEnv,
      isPremium,
      mcpServerRunning,
      enhancedPromptsContent,
    });
    const fullSystemPromptContent =
      [
        promptResult.content,
        projectGuidance
          ? `\n\n## Project Guidance\n${projectGuidance}`
          : undefined,
      ]
        .filter(Boolean)
        .join('\n\n') || undefined;
    const mcpServers: Record<string, McpHttpServerConfig> =
      isPremium && mcpServerRunning
        ? {
            ptah: {
              type: 'http' as const,
              url: `http://localhost:${PTAH_MCP_PORT}`,
            },
          }
        : {};
    let hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>> | undefined;
    if (this.subagentHookHandler || this.compactionHookHandler) {
      hooks = {};
      if (this.subagentHookHandler) {
        const subagentHooks = this.subagentHookHandler.createHooks(cwd);
        Object.assign(hooks, subagentHooks);
      }
      if (this.compactionHookHandler) {
        const compactionHooks = this.compactionHookHandler.createHooks('', cwd);
        Object.assign(hooks, compactionHooks);
      }
    }
    const compactionConfig = this.compactionConfigProvider?.getConfig();
    const compactionControl = compactionConfig?.enabled
      ? {
          enabled: true,
          contextTokenThreshold: compactionConfig.contextTokenThreshold,
        }
      : undefined;

    this.logger.info('[PtahCliSpawnOptions] Assembled spawn options', {
      cwd,
      isPremium,
      mcpServerRunning,
      mcpEnabled: Object.keys(mcpServers).length > 0,
      hasEnhancedPrompts: !!enhancedPromptsContent,
      hasHooks: !!hooks,
      compactionEnabled: compactionConfig?.enabled ?? false,
      hasIdentityPrompt: !!activeProviderId,
    });

    return {
      isPremium,
      systemPromptMode: promptResult.mode,
      systemPromptContent: fullSystemPromptContent,
      mcpServers,
      plugins: undefined,
      hooks,
      compactionControl,
    };
  }

  private isMcpServerRunning(): boolean {
    try {
      return this.mcpServerStatus?.getPort() != null;
    } catch (error) {
      this.logger.warn(
        `[PtahCliSpawnOptions] MCP server check failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }
  }

  /**
   * Resolve project-specific guidance content for premium users.
   */
  private async resolveEnhancedPromptsContent(
    workspacePath: string | undefined,
    isPremium: boolean,
  ): Promise<string | undefined> {
    if (!isPremium || !workspacePath) {
      return undefined;
    }
    try {
      const content =
        await this.enhancedPromptsService.getProjectGuidanceContent(
          workspacePath,
        );
      return content ?? undefined;
    } catch (error) {
      this.logger.warn(
        `[PtahCliSpawnOptions] Failed to resolve project guidance: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return undefined;
    }
  }

  /**
   * Resolve plugin paths for premium users.
   */
  private resolvePluginPaths(isPremium: boolean): string[] | undefined {
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
      return paths.length > 0 ? paths : undefined;
    } catch (error) {
      this.logger.warn(
        `[PtahCliSpawnOptions] Failed to resolve plugin paths: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return undefined;
    }
  }
}
