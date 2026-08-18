/**
 * Ptah CLI Spawn Options Service
 *
 * Injectable singleton that assembles spawn options for spawnAgent().
 * Handles MCP server detection, enhanced prompts, hooks and compaction
 * configuration.
 *
 * It deliberately assembles NO `plugins` entry. TASK_2026_278 Batch 3 measured
 * the SDK's `plugins: [{type:'local'}]` channel against the copies the harness
 * reconciler writes: passing both registers every skill twice, once bare and
 * once plugin-qualified (`orchestration` AND `ptah-core:orchestration`), which
 * doubles the skill budget and breaks the unqualified `/orchestrate` the
 * shipped content tells the model to use. The copies are the baseline because
 * they are the only mechanism a raw `claude` binary, a rival CLI or the TUI can
 * read. See `harness-sync/CLAUDE.md`.
 *
 */

import { injectable, inject } from 'tsyringe';
import type { AuthEnv } from '@ptah-extension/shared';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import {
  PLATFORM_TOKENS,
  type IMcpServerStatus,
} from '@ptah-extension/platform-core';
import {
  SDK_TOKENS,
  SubagentHookHandler,
  CompactionHookHandler,
  CompactionConfigProvider,
  assembleSystemPrompt,
  getActiveProviderId,
  PTAH_MCP_PORT,
  type HookEvent,
  type HookCallbackMatcher,
  type McpHttpServerConfig,
} from '@ptah-extension/agent-sdk';
import { AGENT_GENERATION_TOKENS } from '@ptah-extension/agent-generation';
import type { EnhancedPromptsService } from '@ptah-extension/agent-generation';
import {
  OUTPUT_STYLE_TOKENS,
  type OutputStyleSessionActivationService,
} from '@ptah-extension/output-styles';

/**
 * Assembled spawn options returned by assembleSpawnOptions()
 */
export interface PtahSpawnAssembly {
  /** System prompt mode: 'preset-append' uses claude_code base, 'standalone' uses Ptah harness */
  readonly systemPromptMode: 'preset-append' | 'standalone';
  readonly systemPromptContent: string | undefined;
  readonly mcpServers: Record<string, McpHttpServerConfig>;
  readonly hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>> | undefined;
  readonly compactionControl:
    | { enabled: boolean; contextTokenThreshold: number }
    | undefined;
  /**
   * Output-style name for the FLAG tier (TASK_2026_197), or `undefined` when
   * no style is active.
   *
   * The name rather than the body, because a spawn keeps `'user'` in
   * `settingSources` — see `assembleSpawnOptions`. The caller spreads it
   * through `buildFlagSettings` into `Options.settings`; the body path is
   * already folded into `systemPromptContent` and never reaches here.
   */
  readonly outputStyleName: string | undefined;
}

@injectable()
export class PtahCliSpawnOptions {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SDK_TOKENS.SDK_SUBAGENT_HOOK_HANDLER)
    private readonly subagentHookHandler: SubagentHookHandler,
    @inject(SDK_TOKENS.SDK_COMPACTION_HOOK_HANDLER)
    private readonly compactionHookHandler: CompactionHookHandler,
    @inject(SDK_TOKENS.SDK_COMPACTION_CONFIG_PROVIDER)
    private readonly compactionConfigProvider: CompactionConfigProvider,
    @inject(AGENT_GENERATION_TOKENS.ENHANCED_PROMPTS_SERVICE)
    private readonly enhancedPromptsService: EnhancedPromptsService,
    @inject(PLATFORM_TOKENS.MCP_SERVER_STATUS, { isOptional: true })
    private readonly mcpServerStatus: IMcpServerStatus | undefined,
    /**
     * Optional so a host that never called `registerOutputStyleServices` still
     * spawns agents — it just spawns them unstyled, which is the same
     * degradation the chat path takes when the selection cannot be read.
     */
    @inject(OUTPUT_STYLE_TOKENS.SESSION_ACTIVATION, { isOptional: true })
    private readonly outputStyleActivation:
      | OutputStyleSessionActivationService
      | undefined,
  ) {}

  /**
   * Assemble all spawn options for a headless agent.
   *
   * @param authEnv - Isolated auth environment for the agent
   * @param cwd - Working directory
   * @param projectGuidance - Optional project guidance text
   * @param resolvedModel - The concrete model this spawn runs on, already
   *   resolved from `modelTier` by `PtahCliRegistry.spawnAgent`. Feeds the
   *   model-identity clarification; passing the wrong value here is what made
   *   a `modelTier: 'sonnet'` agent announce the opus model.
   * @returns Assembled spawn options
   */
  async assembleSpawnOptions(
    authEnv: AuthEnv,
    cwd: string,
    projectGuidance?: string,
    resolvedModel?: string,
  ): Promise<PtahSpawnAssembly> {
    const mcpServerRunning = this.isMcpServerRunning();
    const enhancedPromptsContent =
      await this.resolveEnhancedPromptsContent(cwd);
    const activeProviderId = getActiveProviderId(authEnv);
    const outputStyle = await this.resolveOutputStyle(cwd);
    const promptResult = assembleSystemPrompt({
      providerId: activeProviderId,
      resolvedModel,
      mcpServerRunning,
      enhancedPromptsContent,
      // Empty in practice — see `resolveOutputStyle`. Forwarded anyway so the
      // day a spawn stops including the user setting source, the fallback is
      // already plumbed instead of silently dropping the style.
      outputStyleBody: outputStyle.outputStyleBody,
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
    const mcpServers: Record<string, McpHttpServerConfig> = mcpServerRunning
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
      mcpServerRunning,
      mcpEnabled: Object.keys(mcpServers).length > 0,
      hasEnhancedPrompts: !!enhancedPromptsContent,
      hasHooks: !!hooks,
      compactionEnabled: compactionConfig?.enabled ?? false,
      hasIdentityPrompt: !!activeProviderId,
      outputStyleName: outputStyle.outputStyleName ?? null,
    });

    return {
      systemPromptMode: promptResult.mode,
      systemPromptContent: fullSystemPromptContent,
      mcpServers,
      hooks,
      compactionControl,
      outputStyleName: outputStyle.outputStyleName,
    };
  }

  /**
   * The output-style activation for THIS spawn (TASK_2026_197).
   *
   * `userSettingSourceIncluded: true` is STATED rather than derived because
   * `PtahCliRegistry` hardcodes `settingSources: ['user', 'project', 'local']`
   * for every spawn, unlike the chat path which drops `'user'` on a local
   * proxy. A user-tier style file is therefore always visible to the binary
   * here, so the decision is always the flag tier. Deriving it from the
   * spawn's own proxied `authEnv` would take the inject branch and append the
   * body ON TOP of the file the SDK already reads — the style applied twice,
   * which is the exact failure R3 exists to prevent.
   *
   * If that `settingSources` literal ever changes, this must change with it.
   * They are three lines apart in the same subsystem, on purpose.
   */
  private async resolveOutputStyle(cwd: string): Promise<{
    outputStyleName?: string;
    outputStyleBody?: string;
  }> {
    if (!this.outputStyleActivation) return {};
    return this.outputStyleActivation.resolveSessionFields({
      workspaceRoot: cwd,
      userSettingSourceIncluded: true,
    });
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
   * Resolve project-specific guidance content.
   */
  private async resolveEnhancedPromptsContent(
    workspacePath: string | undefined,
  ): Promise<string | undefined> {
    if (!workspacePath) {
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
}
