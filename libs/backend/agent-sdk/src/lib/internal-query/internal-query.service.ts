/**
 * InternalQueryService - One-shot SDK query execution for internal use
 *
 * Provides a clean interface for running autonomous Claude Agent SDK queries
 * WITHOUT going through the interactive chat path (SdkAgentAdapter → SessionLifecycleManager
 * → SdkQueryOptionsBuilder). This is intentionally a separate code path.
 *
 * WHY SEPARATE:
 * The interactive chat path uses streaming input mode (AsyncIterable<SDKUserMessage>),
 * permission callbacks (canUseTool), session persistence, and real-time webview streaming.
 * Internal queries use single-shot mode (string prompt + maxTurns), bypass permissions,
 * don't persist sessions, and return results directly. Mixing these concerns would
 * create coupling that risks breaking the working chat flow.
 *
 * FEATURES INTEGRATED:
 * - PTAH_CORE_SYSTEM_PROMPT for premium users (NOT enhanced prompts - this is the GENERATION workflow)
 * - MCP server configuration (premium + running check)
 * - Model identity clarification for third-party providers (OpenRouter, Moonshot, etc.)
 * - Subagent hooks (for proper lifecycle tracking)
 * - Compaction hooks (for compaction event handling)
 * - Environment variables (includes API keys from AuthManager)
 * - Setting sources (user, project, local — for CLAUDE.md files)
 *
 * FEATURES INTENTIONALLY DIFFERENT:
 * - permissionMode: 'bypassPermissions' (no user to approve)
 * - prompt: string (not AsyncIterable — single-shot, not multi-turn)
 * - persistSession: false (internal, ephemeral)
 * - maxTurns: explicit (not calculated from maxTokens)
 * - No canUseTool callback (bypassed)
 * - No session metadata tracking
 *
 * IMPORTANT: InternalQueryService is used to GENERATE enhanced prompts (via setup wizard),
 * so it should NOT try to USE enhanced prompts (that would create circular dependency).
 * Enhanced prompts are only used in the chat workflow via ChatRpcHandlers.
 *
 * @module @ptah-extension/agent-sdk
 */

import { injectable, inject } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import type { AuthEnv } from '@ptah-extension/shared';
import { SDK_TOKENS } from '../di/tokens';
import { SdkModuleLoader } from '../helpers/sdk-module-loader';
import { SdkAgentAdapter } from '../sdk-agent-adapter';
import { SubagentHookHandler } from '../helpers/subagent-hook-handler';
import { CompactionConfigProvider } from '../helpers/compaction-config-provider';
import { CompactionHookHandler } from '../helpers/compaction-hook-handler';
import {
  getAnthropicProvider,
  ANTHROPIC_PROVIDERS,
} from '../helpers/anthropic-provider-registry';
import { PTAH_CORE_SYSTEM_PROMPT } from '../prompt-harness';
import type {
  Options as SdkQueryOptions,
  HookEvent,
  HookCallbackMatcher,
  McpHttpServerConfig,
  SdkPluginConfig,
} from '../types/sdk-types/claude-sdk.types';
import type {
  InternalQueryConfig,
  InternalQueryHandle,
} from './internal-query.types';

// ============================================================================
// Constants
// ============================================================================

import { PTAH_MCP_PORT } from '../constants';

const SERVICE_TAG = '[InternalQuery]';
/** Default max turns for internal queries */
const DEFAULT_MAX_TURNS = 25;

// ============================================================================
// Service
// ============================================================================

/**
 * InternalQueryService
 *
 * Executes one-shot SDK queries for internal use (e.g., workspace analysis).
 * Completely separate from the interactive chat path.
 *
 * Usage:
 * ```typescript
 * const handle = await internalQueryService.execute({
 *   cwd: '/workspace',
 *   model: 'claude-sonnet-4-5-20250929',
 *   prompt: 'Analyze this workspace...',
 *   systemPromptAppend: '...analysis instructions...',
 *   isPremium: true,
 *   mcpServerRunning: true,
 *   maxTurns: 25,
 * });
 *
 * for await (const message of handle.stream) {
 *   // Process SDK messages (stream_event, assistant, result)
 * }
 * ```
 */
@injectable()
export class InternalQueryService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SDK_TOKENS.SDK_AGENT_ADAPTER)
    private readonly sdkAdapter: SdkAgentAdapter,
    @inject(SDK_TOKENS.SDK_MODULE_LOADER)
    private readonly moduleLoader: SdkModuleLoader,
    @inject(SDK_TOKENS.SDK_SUBAGENT_HOOK_HANDLER)
    private readonly subagentHookHandler: SubagentHookHandler,
    @inject(SDK_TOKENS.SDK_COMPACTION_CONFIG_PROVIDER)
    private readonly compactionConfigProvider: CompactionConfigProvider,
    @inject(SDK_TOKENS.SDK_COMPACTION_HOOK_HANDLER)
    private readonly compactionHookHandler: CompactionHookHandler,
    @inject(SDK_TOKENS.SDK_AUTH_ENV)
    private readonly authEnv: AuthEnv,
  ) {}

  /**
   * Execute a one-shot SDK query.
   *
   * Returns a handle with the message stream and control methods.
   * The caller iterates the stream to process messages and extract results.
   *
   * @param config - Query configuration (model, prompt, features)
   * @returns Handle with stream, abort, and close methods
   * @throws Error if SDK is not available or query function cannot be loaded
   */
  async execute(config: InternalQueryConfig): Promise<InternalQueryHandle> {
    // 1. Resolve pathToClaudeCodeExecutable (TASK_2025_194 parity)
    // The SDK's default import.meta.url-based resolution bakes in the build-time path.
    // Without this override, the subprocess resolves to a non-existent path in production
    // — causing immediate "process exited with code 1".
    // Try SdkAgentAdapter first (has bundled cli.js fallback), then moduleLoader.
    const cliJsPath =
      this.sdkAdapter.getCliJsPath() ??
      (await this.moduleLoader.getCliJsPath());

    this.logger.info(`${SERVICE_TAG} Starting internal query`, {
      cwd: config.cwd,
      model: config.model,
      isPremium: config.isPremium,
      mcpServerRunning: config.mcpServerRunning,
      mcpPort: config.mcpPort,
      maxTurns: config.maxTurns ?? DEFAULT_MAX_TURNS,
      hasSystemPromptAppend: !!config.systemPromptAppend,
      hasPlugins: (config.pluginPaths?.length ?? 0) > 0,
      pluginCount: config.pluginPaths?.length ?? 0,
      cliJsPath: cliJsPath ?? 'NOT_RESOLVED',
    });

    // 2. Verify SDK health
    this.verifyHealth();

    // 3. Get SDK query function
    const queryFn = await this.moduleLoader.getQueryFunction();

    // 4. Build query options (with all feature integrations)
    const abortController = config.abortController ?? new AbortController();
    const options = await this.buildOptions(config, abortController, cliJsPath);

    const systemPromptObj =
      typeof options.systemPrompt === 'object'
        ? options.systemPrompt
        : undefined;

    this.logger.info(`${SERVICE_TAG} SDK options built — launching query`, {
      model: config.model,
      permissionMode: 'bypassPermissions',
      maxTurns: options.maxTurns,
      hasMcpServers: Object.keys(options.mcpServers ?? {}).length > 0,
      mcpServerUrls: Object.entries(options.mcpServers ?? {}).map(
        ([name, cfg]) => `${name}=${(cfg as { url?: string }).url ?? 'N/A'}`,
      ),
      hasSystemPromptAppend: !!systemPromptObj?.append,
      systemPromptAppendLength: systemPromptObj?.append?.length ?? 0,
      hasPathToExecutable: !!options.pathToClaudeCodeExecutable,
      pathToExecutable: options.pathToClaudeCodeExecutable ?? 'SDK_DEFAULT',
      pluginCount: options.plugins?.length ?? 0,
      promptLength: config.prompt.length,
    });

    // 5. Start query with string prompt (single-shot mode)
    const queryStartMs = Date.now();
    const conversation = queryFn({
      prompt: config.prompt,
      options,
    });

    this.logger.info(
      `${SERVICE_TAG} SDK query() returned conversation handle in ${Date.now() - queryStartMs}ms`,
    );

    // 6. Return handle
    return {
      stream: conversation,
      abort: () => abortController.abort(),
      close: () => {
        try {
          conversation.close();
        } catch (e) {
          this.logger.debug(`${SERVICE_TAG} Failed to close conversation`, {
            error: e instanceof Error ? e.message : String(e),
          });
        }
      },
    };
  }

  // ==========================================================================
  // Private — Option Assembly
  // ==========================================================================

  /**
   * Verify SDK is available and initialized.
   */
  private verifyHealth(): void {
    const health = this.sdkAdapter.getHealth();
    if (health.status !== 'available') {
      throw new Error(
        `SDK not available (status: ${health.status}). ${
          health.errorMessage || ''
        }`,
      );
    }
  }

  /**
   * Build complete SDK query options for internal one-shot execution.
   *
   * Integrates all features:
   * - System prompt: identity prompt + custom append + enhanced prompts / PTAH_CORE
   * - MCP servers: configured when premium + running
   * - Hooks: subagent + compaction lifecycle hooks
   * - Environment: merges process.env with AuthEnv singleton (TASK_2025_164)
   * - Settings: loads user, project, local sources (CLAUDE.md)
   *
   * Note: Compaction behavior is managed through PreCompact hooks (see buildHooks()),
   * not through a direct SDK option. The compaction config provider is used for
   * logging/debugging purposes.
   */
  private async buildOptions(
    config: InternalQueryConfig,
    abortController: AbortController,
    cliJsPath: string | null,
  ): Promise<SdkQueryOptions> {
    // Assemble system prompt with all enhancements
    const systemPrompt = this.buildSystemPrompt(config);

    // Build MCP server configuration
    const mcpServers = this.buildMcpServers(
      config.isPremium,
      config.mcpServerRunning,
      config.mcpPort,
    );

    // Create lifecycle hooks (subagent + compaction)
    const hooks = this.buildHooks(config.cwd);

    // Log compaction configuration for debugging
    const compactionConfig = this.compactionConfigProvider.getConfig();
    this.logger.debug(
      `${SERVICE_TAG} Compaction config: enabled=${compactionConfig.enabled}, threshold=${compactionConfig.contextTokenThreshold} (managed via hooks)`,
    );

    const options: SdkQueryOptions = {
      abortController,
      cwd: config.cwd,
      model: config.model,

      // System prompt with all enhancements
      systemPrompt,

      // Tool preset (claude_code includes all standard tools)
      tools: {
        type: 'preset',
        preset: 'claude_code',
      },

      // MCP servers (Ptah API — premium only)
      mcpServers,

      // Internal query — bypass all permission prompts
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,

      // Bound execution with explicit turn limit
      maxTurns: config.maxTurns ?? DEFAULT_MAX_TURNS,

      // Enable streaming events for progress extraction
      includePartialMessages: true,

      // Don't persist internal sessions to disk
      persistSession: false,

      // TASK_2025_194 parity: Override the SDK's baked-in import.meta.url path
      // with the runtime-resolved cli.js path. Without this, the SDK subprocess
      // resolves to the build-time path — causing "process exited with code 1"
      // in production where that path doesn't exist.
      pathToClaudeCodeExecutable: cliJsPath || undefined,

      // Merge AuthEnv with process.env — AuthEnv values override process.env (TASK_2025_164)
      // Set NO_PROXY to prevent corporate proxy interception of localhost requests
      env: {
        ...process.env,
        ...this.authEnv,
        NO_PROXY: '127.0.0.1,localhost',
      } as Record<string, string | undefined>,

      // Load settings from project and local directories.
      // IMPORTANT: Exclude 'user' when using a translation proxy because
      // ~/.claude/settings.json may contain auth from a previous `claude login`
      // that overrides ANTHROPIC_BASE_URL and routes requests to api.anthropic.com
      // instead of our local proxy.
      settingSources: this.authEnv.ANTHROPIC_BASE_URL?.includes('127.0.0.1')
        ? ['project', 'local']
        : ['user', 'project', 'local'],

      // Capture stderr — parse log level and route appropriately.
      // Log ALL stderr at info level initially so we can diagnose production failures,
      // then demote to debug once the setup wizard is stable.
      stderr: (data: string) => {
        if (data.includes('[ERROR]')) {
          this.logger.error(`${SERVICE_TAG} SDK stderr: ${data}`);
        } else if (data.includes('[WARN]')) {
          this.logger.warn(`${SERVICE_TAG} SDK stderr: ${data}`);
        } else {
          // Log at info level (not debug) to ensure visibility in production output channels
          this.logger.info(`${SERVICE_TAG} SDK stderr: ${data}`);
        }
      },

      // Lifecycle hooks (subagent + compaction)
      hooks,

      // Plugins (loaded from workspace plugin directories)
      plugins: this.buildPlugins(config.pluginPaths),
    };

    // Structured output format (JSON Schema) — constrains the agent's final response
    if (config.outputFormat) {
      options.outputFormat = config.outputFormat;
    }

    return options;
  }

  /**
   * Build plugin configuration from resolved plugin paths.
   */
  private buildPlugins(pluginPaths?: string[]): SdkPluginConfig[] | undefined {
    if (!pluginPaths || pluginPaths.length === 0) return undefined;
    return pluginPaths.map((p) => ({ type: 'local' as const, path: p }));
  }

  /**
   * Build system prompt with all enhancements.
   *
   * Constructs system prompt by appending (in order):
   * 1. Model identity clarification (for third-party providers like OpenRouter)
   * 2. PTAH_CORE_SYSTEM_PROMPT for premium users (NOT enhanced prompts - this is the GENERATION workflow)
   * 3. Custom system prompt append (task-specific instructions)
   *
   * Uses preset 'claude_code' as base, then appends all parts.
   *
   * IMPORTANT: InternalQueryService is used to GENERATE enhanced prompts (via setup wizard),
   * so it should NOT try to USE enhanced prompts (that would be circular). Enhanced prompts
   * are only used in the chat workflow via ChatRpcHandlers → SdkAgentAdapter → SessionLifecycleManager.
   */
  private buildSystemPrompt(config: InternalQueryConfig): {
    type: 'preset';
    preset: 'claude_code';
    append?: string;
  } {
    const appendParts: string[] = [];

    // 1. Model identity clarification for third-party providers
    const identityPrompt = this.buildIdentityPrompt();
    if (identityPrompt) {
      appendParts.push(identityPrompt);
      this.logger.debug(
        `${SERVICE_TAG} Added identity prompt for third-party provider`,
      );
    }

    // 2. ALWAYS use PTAH_CORE_SYSTEM_PROMPT for internal queries (setup wizard, workspace analysis)
    // InternalQueryService is part of the GENERATION workflow, not the USAGE workflow.
    // Enhanced prompts are used in chat sessions via ChatRpcHandlers, not here.
    if (config.isPremium) {
      appendParts.push(PTAH_CORE_SYSTEM_PROMPT);
      this.logger.debug(
        `${SERVICE_TAG} Using PTAH_CORE_SYSTEM_PROMPT for internal query`,
      );
    }

    // 3. Task-specific system prompt instructions
    if (config.systemPromptAppend) {
      appendParts.push(config.systemPromptAppend);
    }

    return {
      type: 'preset',
      preset: 'claude_code',
      append: appendParts.length > 0 ? appendParts.join('\n\n') : undefined,
    };
  }

  /**
   * Build model identity clarification prompt for third-party providers.
   *
   * When using Anthropic-compatible providers (OpenRouter, Moonshot, Z.AI),
   * the claude_code preset injects "You are Claude" into the system prompt.
   * This clarification overrides that for models that aren't Claude.
   *
   * Uses the DI-injected AuthEnv singleton (TASK_2025_164) — matches
   * the pattern in SdkQueryOptionsBuilder.buildModelIdentityPrompt().
   */
  private buildIdentityPrompt(): string | undefined {
    const baseUrl = this.authEnv.ANTHROPIC_BASE_URL;
    if (!baseUrl || baseUrl.includes('api.anthropic.com')) {
      return undefined; // Using Anthropic directly — no clarification needed
    }

    // Detect which provider is active
    for (const id of ANTHROPIC_PROVIDERS.map((p) => p.id)) {
      const provider = getAnthropicProvider(id);
      if (!provider || !provider.baseUrl) continue;
      try {
        if (baseUrl.includes(new URL(provider.baseUrl).hostname)) {
          // Get actual model from AuthEnv tier vars
          const actualModel =
            this.authEnv.ANTHROPIC_DEFAULT_OPUS_MODEL ||
            this.authEnv.ANTHROPIC_DEFAULT_SONNET_MODEL ||
            this.authEnv.ANTHROPIC_DEFAULT_HAIKU_MODEL;

          if (!actualModel) {
            return undefined; // No tier mapping — likely using Anthropic directly
          }

          return `# Model Identity Clarification

IMPORTANT: You are running as **${actualModel}** provided by **${provider.name}**, NOT Claude by Anthropic.

When asked about your identity, model, or capabilities:
- State that you are ${actualModel} from ${provider.name}
- Do NOT claim to be Claude, Claude Opus, Claude Sonnet, or any Anthropic model
- You may mention you are running through an Anthropic-compatible API interface

This clarification takes precedence over any other identity instructions in the system prompt.`;
        }
      } catch {
        // Skip providers with invalid baseUrl (e.g., empty string for proxy-based providers)
        continue;
      }
    }

    return undefined;
  }

  /**
   * Build MCP servers configuration.
   *
   * Enables Ptah HTTP MCP server for premium users when the server is running.
   * This gives the agent access to execute_code tool with all ptah.* API namespaces.
   *
   * @param isPremium - Whether user has premium features
   * @param mcpServerRunning - Whether the MCP server is currently running
   * @param mcpPort - Port the MCP server is listening on (defaults to PTAH_MCP_PORT)
   */
  private buildMcpServers(
    isPremium: boolean,
    mcpServerRunning: boolean,
    mcpPort?: number,
  ): Record<string, McpHttpServerConfig> {
    if (!isPremium) {
      this.logger.debug(`${SERVICE_TAG} MCP disabled (not premium)`);
      return {};
    }

    if (!mcpServerRunning) {
      this.logger.warn(`${SERVICE_TAG} MCP disabled (server not running)`);
      return {};
    }

    const port = mcpPort ?? PTAH_MCP_PORT;
    return {
      ptah: {
        type: 'http',
        url: `http://localhost:${port}`,
      },
    };
  }

  /**
   * Build lifecycle hooks (subagent + compaction).
   *
   * Even for internal queries, hooks are useful for:
   * - Subagent tracking (if the agent spawns subagents)
   * - Compaction notification (for long-running analyses)
   */
  private buildHooks(
    cwd: string,
  ): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
    const subagentHooks = this.subagentHookHandler.createHooks(cwd);
    const compactionHooks = this.compactionHookHandler.createHooks(
      `internal-query-${Date.now()}`,
    );

    // Merge hooks safely — concatenate arrays for same event key to prevent overwrites
    const mergedHooks: Partial<Record<HookEvent, HookCallbackMatcher[]>> = {};
    for (const hooks of [subagentHooks, compactionHooks]) {
      for (const [event, matchers] of Object.entries(hooks)) {
        const key = event as HookEvent;
        mergedHooks[key] = [...(mergedHooks[key] || []), ...matchers];
      }
    }

    return mergedHooks;
  }
}
