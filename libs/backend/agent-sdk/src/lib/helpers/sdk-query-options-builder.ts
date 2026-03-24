/**
 * SDK Query Options Builder - Constructs SDK query configuration
 *
 * Extracted from SdkAgentAdapter to separate concerns.
 * Handles the complex configuration building for SDK queries including:
 * - System prompt configuration
 * - MCP server setup
 * - Permission callbacks
 * - Subagent hooks
 * - Environment variables
 *
 * Single Responsibility: Build SDK query options from session config
 *
 * @see TASK_2025_102 - Extracted to reduce SdkAgentAdapter complexity
 * @see TASK_2025_137 - Updated to use PTAH_CORE_SYSTEM_PROMPT directly
 */

import { injectable, inject } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import {
  AISessionConfig,
  AuthEnv,
  ThinkingConfig,
  EffortLevel,
} from '@ptah-extension/shared';
import { SDK_TOKENS } from '../di/tokens';
import { SdkPermissionHandler } from '../sdk-permission-handler';
import { SubagentHookHandler } from './subagent-hook-handler';
import { CompactionConfigProvider } from './compaction-config-provider';
import {
  CompactionHookHandler,
  type CompactionStartCallback,
} from './compaction-hook-handler';
import {
  CanUseTool,
  HookEvent,
  HookCallbackMatcher,
  McpHttpServerConfig,
  SdkPluginConfig,
} from '../types/sdk-types/claude-sdk.types';
import type { SDKUserMessage } from './session-lifecycle-manager';
import {
  getAnthropicProvider,
  ANTHROPIC_PROVIDERS,
} from './anthropic-provider-registry';
import { COPILOT_PROXY_TOKEN_PLACEHOLDER } from '../copilot-provider/copilot-provider.types';
import { CODEX_PROXY_TOKEN_PLACEHOLDER } from '../codex-provider/codex-provider.types';
import { PTAH_CORE_SYSTEM_PROMPT } from '../prompt-harness';
import { PTAH_MCP_PORT } from '../constants';

/**
 * Build model identity clarification prompt for third-party providers
 *
 * When using Anthropic-compatible providers (Moonshot, Z.AI, etc.), the Claude SDK's
 * 'claude_code' preset injects "You are Claude" into the system prompt. This causes
 * third-party models like Kimi K2 to incorrectly identify themselves as Claude.
 *
 * This function generates a clarification prompt that overrides the identity
 * when a third-party provider is active.
 *
 * @param providerId - The active provider ID (e.g., 'moonshot', 'zhipu')
 * @returns Identity clarification prompt, or undefined if using Anthropic directly
 */
export function buildModelIdentityPrompt(
  providerId: string | null,
  authEnv: AuthEnv
): string | undefined {
  if (!providerId) {
    return undefined;
  }

  const provider = getAnthropicProvider(providerId);
  if (!provider) {
    return undefined;
  }

  // Get the actual model being used from AuthEnv (TASK_2025_164)
  // The SDK uses ANTHROPIC_DEFAULT_*_MODEL to map tiers to actual model IDs
  const actualModel =
    authEnv.ANTHROPIC_DEFAULT_OPUS_MODEL ||
    authEnv.ANTHROPIC_DEFAULT_SONNET_MODEL ||
    authEnv.ANTHROPIC_DEFAULT_HAIKU_MODEL;

  if (!actualModel) {
    // No tier mapping set - likely using Anthropic directly
    return undefined;
  }

  // Build a clear identity prompt
  return `# Model Identity Clarification

IMPORTANT: You are running as **${actualModel}** provided by **${provider.name}**, NOT Claude by Anthropic.

When asked about your identity, model, or capabilities:
- State that you are ${actualModel} from ${provider.name}
- Do NOT claim to be Claude, Claude Opus, Claude Sonnet, or any Anthropic model
- You may mention you are running through an Anthropic-compatible API interface

This clarification takes precedence over any other identity instructions in the system prompt.`;
}

/**
 * Get the active provider ID from environment
 * Returns the provider ID if using a third-party provider, null if using Anthropic directly
 */
export function getActiveProviderId(authEnv: AuthEnv): string | null {
  const baseUrl = authEnv.ANTHROPIC_BASE_URL;
  if (!baseUrl || baseUrl.includes('api.anthropic.com')) {
    return null;
  }

  // Detect proxy providers via their token placeholders (baseUrl is dynamic localhost)
  if (authEnv.ANTHROPIC_AUTH_TOKEN === COPILOT_PROXY_TOKEN_PLACEHOLDER) {
    return 'github-copilot';
  }
  if (authEnv.ANTHROPIC_AUTH_TOKEN === CODEX_PROXY_TOKEN_PLACEHOLDER) {
    return 'openai-codex';
  }

  // Check which provider matches this base URL (derived from registry to prevent ID mismatches)
  for (const id of ANTHROPIC_PROVIDERS.map((p) => p.id)) {
    const provider = getAnthropicProvider(id);
    if (provider && provider.baseUrl) {
      try {
        if (baseUrl.includes(new URL(provider.baseUrl).hostname)) {
          return id;
        }
      } catch {
        // Skip providers with invalid/empty baseUrl
      }
    }
  }

  return null;
}

/**
 * Input for assembleSystemPrompt() pure function.
 * Encapsulates all parameters needed to build the system prompt
 * for both SdkQueryOptionsBuilder and PtahCliAdapter.
 */
export interface AssembleSystemPromptInput {
  /** Active provider ID (from getActiveProviderId) - for model identity clarification */
  providerId: string | null;
  /** AuthEnv for the session - used by buildModelIdentityPrompt */
  authEnv: AuthEnv;
  /** User's custom system prompt (from sessionConfig or UI) */
  userSystemPrompt?: string;
  /** Whether the user has premium features */
  isPremium: boolean;
  /** Whether the MCP server is currently running */
  mcpServerRunning: boolean;
  /** Enhanced prompts content (AI-generated guidance) */
  enhancedPromptsContent?: string;
  /** Selected preset: 'claude_code', 'enhanced', or undefined for auto-select */
  preset?: string;
}

/**
 * Result of system prompt assembly.
 *
 * Always uses 'preset-append' mode — the SDK's claude_code preset is the base,
 * and our content is appended on top. This preserves the SDK's critical MCP
 * handling, tool routing, and environment context instructions.
 */
export interface SystemPromptAssemblyResult {
  mode: 'preset-append';
  content: string | undefined;
}

/**
 * Assemble the system prompt from its constituent parts.
 *
 * Always uses the SDK's `claude_code` preset as the base — this provides critical
 * built-in behavioral guidance, MCP server handling, tool routing, and environment
 * context that the agent needs to function correctly.
 *
 * **Premium users**: PTAH_CORE_SYSTEM_PROMPT is appended to the preset, providing
 * Ptah-specific MCP mandates, formatting rules, AskUserQuestion enforcement,
 * orchestration workflows, CLI agent hierarchy, and git/PR safety. Enhanced prompts
 * (project-specific guidance from the setup wizard) are also appended when available.
 * Some behavioral sections overlap with the preset — this is intentional as it
 * reinforces the instructions without contradicting them.
 *
 * **Free tier**: Only basic top-ups appended (identity, user prompt). No Ptah-specific
 * behavioral guidance.
 *
 * Shared function used by SdkQueryOptionsBuilder and PtahCliAdapter.
 *
 * @param input - All parameters needed for prompt assembly
 * @returns Assembly result with mode and content (always preset-append)
 */
export function assembleSystemPrompt(
  input: AssembleSystemPromptInput
): SystemPromptAssemblyResult {
  const {
    providerId,
    authEnv,
    userSystemPrompt,
    isPremium,
    enhancedPromptsContent,
  } = input;

  // Build append parts layered on top of the SDK's claude_code preset.
  // The preset provides foundational behavioral guidance and MCP handling —
  // we NEVER replace it, only append to it.
  const appendParts: string[] = [];

  // 1. Model identity clarification for third-party providers
  const identityPrompt = buildModelIdentityPrompt(providerId, authEnv);
  if (identityPrompt) {
    appendParts.push(identityPrompt);
  }

  // 2. PTAH_CORE_SYSTEM_PROMPT for all premium users — MCP mandates, orchestration,
  // formatting, AskUserQuestion, CLI agent hierarchy, git/PR workflows.
  // Appended to (not replacing) the SDK's claude_code preset so the agent gets BOTH
  // the SDK's built-in MCP handling instructions AND our Ptah-specific directives.
  if (isPremium) {
    appendParts.push(PTAH_CORE_SYSTEM_PROMPT);
  }

  // 3. User's custom system prompt
  if (userSystemPrompt) {
    appendParts.push(userSystemPrompt);
  }

  // 4. Enhanced prompts — project-specific guidance (from setup wizard)
  if (isPremium && enhancedPromptsContent?.trim()) {
    appendParts.push(enhancedPromptsContent);
  }

  return {
    mode: 'preset-append',
    content: appendParts.length > 0 ? appendParts.join('\n\n') : undefined,
  };
}

/**
 * Input parameters for building query options
 */
export interface QueryOptionsInput {
  /** Async iterable stream of user messages */
  userMessageStream: AsyncIterable<SDKUserMessage>;
  /** Controller to abort the query */
  abortController: AbortController;
  /** Session configuration (model, workspace, system prompt) */
  sessionConfig?: AISessionConfig;
  /** Session ID to resume (undefined for new sessions) */
  resumeSessionId?: string;
  /**
   * Session ID for hook tracking (TASK_2025_098)
   * Used by compaction hooks to identify which session triggered compaction
   */
  sessionId?: string;
  /**
   * Callback for compaction start events (TASK_2025_098)
   * Called when SDK begins compacting (summarizing) conversation history
   */
  onCompactionStart?: CompactionStartCallback;
  /**
   * Premium user flag - enables MCP server and Ptah system prompt
   * When true, enables Ptah MCP server and appends PTAH_CORE_SYSTEM_PROMPT
   * Defaults to false (free tier behavior)
   */
  isPremium?: boolean;
  /**
   * Whether the MCP server is currently running (TASK_2025_108)
   * When false, MCP config will not be included even for premium users.
   * This prevents configuring Claude with a dead MCP endpoint.
   * Defaults to true for backward compatibility.
   */
  mcpServerRunning?: boolean;
  /**
   * Enhanced prompts content (TASK_2025_137)
   * AI-generated project-specific guidance appended as a premium top-up
   * alongside the base prompt (either claude_code preset or PTAH_CORE_SYSTEM_PROMPT).
   * Also triggers auto-selection of the Ptah harness path when no explicit preset is set.
   */
  enhancedPromptsContent?: string;
  /**
   * Plugin paths to load for this session (TASK_2025_153)
   * Absolute paths to plugin directories resolved by PluginLoaderService.
   * Only populated for premium users with configured plugins.
   */
  pluginPaths?: string[];
  /**
   * Initial SDK permission mode based on current autopilot config.
   * When autopilot is enabled, this should be the mapped SDK mode
   * (e.g. 'bypassPermissions', 'acceptEdits', 'plan').
   * Defaults to 'default' (canUseTool callback handles everything).
   */
  permissionMode?: SdkQueryOptions['permissionMode'];
  /**
   * Explicit path to Claude Code CLI executable (cli.js).
   * TASK_2025_194: Passed through to SDK SessionOptions to override
   * the default import.meta.url-based resolution which bakes in
   * the CI runner path at webpack bundle time.
   */
  pathToClaudeCodeExecutable?: string;
}

/**
 * SDK query options structure
 * Matches the options parameter expected by SDK's query() function
 */
export interface SdkQueryOptions {
  abortController: AbortController;
  cwd: string;
  model: string;
  resume?: string;
  maxTurns?: number;
  systemPrompt:
    | string
    | {
        type: 'preset';
        preset: 'claude_code';
        append?: string;
      };
  tools: {
    type: 'preset';
    preset: 'claude_code';
  };
  /** Tools to exclude from the preset (e.g., server-side tools unsupported by third-party providers) */
  disallowedTools?: string[];
  mcpServers: Record<string, McpHttpServerConfig>;
  permissionMode: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';
  canUseTool?: CanUseTool;
  /** Skip permission checks entirely (use with caution — only for trusted auto-approved contexts) */
  allowDangerouslySkipPermissions?: boolean;
  includePartialMessages: boolean;
  settingSources?: Array<'user' | 'project' | 'local'>;
  env?: Record<string, string | undefined>;
  stderr?: (data: string) => void;
  hooks?: Partial<Record<HookEvent, HookCallbackMatcher[]>>;
  /** Plugins to load for this session (TASK_2025_153) */
  plugins?: SdkPluginConfig[];
  /** SDK compaction control configuration (TASK_2025_098) */
  compactionControl?: {
    enabled: boolean;
    contextTokenThreshold: number;
  };
  /** TASK_2025_184: Thinking/reasoning configuration for Claude SDK */
  thinking?: ThinkingConfig;
  /** TASK_2025_184: Effort level for Claude's reasoning depth */
  effort?: EffortLevel;
  /**
   * TASK_2025_194: Explicit path to cli.js executable.
   * Overrides import.meta.url-based resolution in bundled SDK.
   */
  pathToClaudeCodeExecutable?: string;
}

/**
 * Complete query configuration returned by builder
 */
export interface QueryConfig {
  /** Prompt for SDK: async iterable of user messages */
  prompt: AsyncIterable<SDKUserMessage>;
  /** SDK query options */
  options: SdkQueryOptions;
}

/**
 * Builds SDK query options from session configuration
 *
 * Responsibilities:
 * - System prompt construction (preset + optional append)
 * - MCP server configuration (Ptah HTTP server)
 * - Permission callback creation
 * - Subagent lifecycle hooks
 * - Environment variable passthrough
 * - stderr capture for debugging
 */
@injectable()
export class SdkQueryOptionsBuilder {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SDK_TOKENS.SDK_PERMISSION_HANDLER)
    private readonly permissionHandler: SdkPermissionHandler,
    @inject(SDK_TOKENS.SDK_SUBAGENT_HOOK_HANDLER)
    private readonly subagentHookHandler: SubagentHookHandler,
    @inject(SDK_TOKENS.SDK_COMPACTION_CONFIG_PROVIDER)
    private readonly compactionConfigProvider: CompactionConfigProvider,
    @inject(SDK_TOKENS.SDK_COMPACTION_HOOK_HANDLER)
    private readonly compactionHookHandler: CompactionHookHandler,
    @inject(SDK_TOKENS.SDK_AUTH_ENV) private readonly authEnv: AuthEnv
  ) {}

  /**
   * Build complete SDK query configuration
   *
   * @param input - Query input parameters
   * @returns Complete query configuration for SDK
   * @throws Error if model is not provided in session config
   *
   * @example
   * ```typescript
   * const config = await builder.build({
   *   userMessageStream,
   *   abortController,
   *   sessionConfig: { model: 'claude-sonnet-4', projectPath: '/workspace' }
   * });
   *
   * const sdkQuery = query({ prompt: config.prompt, options: config.options });
   * ```
   */
  async build(input: QueryOptionsInput): Promise<QueryConfig> {
    const {
      userMessageStream,
      abortController,
      sessionConfig,
      resumeSessionId,
      sessionId,
      onCompactionStart,
      isPremium = false,
      mcpServerRunning = true,
      enhancedPromptsContent,
      pluginPaths,
      permissionMode = 'default',
      pathToClaudeCodeExecutable,
    } = input;

    // Model is required - SDK sets default in config at startup
    if (!sessionConfig?.model) {
      throw new Error('Model not provided - ensure SDK is initialized');
    }

    const model = sessionConfig.model;
    const cwd = sessionConfig?.projectPath || process.cwd();

    // Log resolved model and tier env vars for debugging (TASK_2025_132, TASK_2025_164: reads from AuthEnv)
    this.logger.info(`[SdkQueryOptionsBuilder] SDK call with model: ${model}`, {
      model,
      envSonnet: this.authEnv.ANTHROPIC_DEFAULT_SONNET_MODEL || 'default',
      envOpus: this.authEnv.ANTHROPIC_DEFAULT_OPUS_MODEL || 'default',
      envHaiku: this.authEnv.ANTHROPIC_DEFAULT_HAIKU_MODEL || 'default',
      baseUrl: this.authEnv.ANTHROPIC_BASE_URL || 'default',
    });

    // Build system prompt configuration
    const systemPrompt = this.buildSystemPrompt(
      sessionConfig,
      isPremium,
      enhancedPromptsContent,
      mcpServerRunning
    );

    // Create permission callback with sessionId for UI routing (TASK_2025_187)
    const canUseToolCallback: CanUseTool =
      this.permissionHandler.createCallback(sessionId);

    // Create merged hooks (subagent + compaction)
    // TASK_2025_098: Pass sessionId and callback for compaction hooks
    const hooks = this.createHooks(cwd, sessionId, onCompactionStart);

    // Get compaction configuration (TASK_2025_098)
    const compactionConfig = this.compactionConfigProvider.getConfig();

    // Log query options
    this.logger.info('[SdkQueryOptionsBuilder] Building SDK query options', {
      cwd,
      model,
      isResume: !!resumeSessionId,
      resumeSessionId: resumeSessionId
        ? `${resumeSessionId.slice(0, 8)}...`
        : undefined,
      permissionMode,
      hasCanUseToolCallback: !!canUseToolCallback,
      compactionEnabled: compactionConfig.enabled,
      compactionThreshold: compactionConfig.contextTokenThreshold,
      // Premium feature status (TASK_2025_108)
      isPremium,
      mcpEnabled: isPremium,
      hasEnhancedPrompts: !!enhancedPromptsContent,
      pluginCount: pluginPaths?.length ?? 0,
    });

    return {
      prompt: userMessageStream,
      options: {
        abortController,
        cwd,
        model,
        resume: resumeSessionId,
        maxTurns: this.calculateMaxTurns(sessionConfig),
        systemPrompt,
        tools: {
          type: 'preset' as const,
          preset: 'claude_code' as const,
        },
        mcpServers: this.buildMcpServers(isPremium, mcpServerRunning),
        // Set SDK permission mode based on current autopilot config.
        // SDK evaluation order: Hooks → Rules → Permission Mode → canUseTool.
        // When 'default': all tools fall through to canUseTool callback.
        // When 'bypassPermissions'/'acceptEdits'/'plan': SDK resolves at step 3.
        permissionMode,
        canUseTool: canUseToolCallback,
        includePartialMessages: true,
        // Load settings from project and local directories.
        // IMPORTANT: Exclude 'user' when using a translation proxy because
        // ~/.claude/settings.json may contain auth from a previous `claude login`
        // that overrides ANTHROPIC_BASE_URL and routes requests to api.anthropic.com
        // instead of our local proxy.
        settingSources: this.authEnv.ANTHROPIC_BASE_URL?.includes('127.0.0.1')
          ? ['project', 'local']
          : ['user', 'project', 'local'],
        // Merge AuthEnv with process.env — AuthEnv values override process.env (TASK_2025_164)
        // Set NO_PROXY to prevent corporate proxy interception of localhost requests
        env: {
          ...process.env,
          ...this.authEnv,
          NO_PROXY: '127.0.0.1,localhost',
        } as Record<string, string | undefined>,
        // Capture stderr — the SDK writes debug/info/warn/error to stderr;
        // parse the level and route to the appropriate logger method
        stderr: (data: string) => {
          if (data.includes('[ERROR]')) {
            this.logger.error(`[SdkQueryOptionsBuilder] CLI stderr: ${data}`);
          } else if (data.includes('[WARN]')) {
            this.logger.warn(`[SdkQueryOptionsBuilder] CLI stderr: ${data}`);
          } else {
            this.logger.debug(`[SdkQueryOptionsBuilder] CLI stderr: ${data}`);
          }
        },
        hooks,
        // Plugins for this session (TASK_2025_153)
        plugins: this.buildPlugins(pluginPaths),
        // SDK compaction control (TASK_2025_098)
        // Only include when enabled to avoid sending unnecessary options
        compactionControl: compactionConfig.enabled
          ? {
              enabled: true,
              contextTokenThreshold: compactionConfig.contextTokenThreshold,
            }
          : undefined,
        // TASK_2025_184: Reasoning configuration passthrough
        // undefined values are omitted by SDK, preserving default behavior
        thinking: sessionConfig?.thinking,
        effort: sessionConfig?.effort,
        // TASK_2025_194: Override baked-in import.meta.url path with runtime-resolved cli.js
        pathToClaudeCodeExecutable,
      },
    };
  }

  /**
   * Build system prompt configuration
   *
   * Always uses SDK's `claude_code` preset as base (provides MCP handling, tool routing,
   * environment context). For premium users, appends PTAH_CORE_SYSTEM_PROMPT with
   * Ptah-specific MCP mandates, orchestration, and formatting rules. Enhanced prompts
   * (project-specific guidance) are also appended when available.
   *
   * @param sessionConfig - Session configuration with optional custom system prompt and preset selection
   * @param isPremium - Whether user has premium features enabled
   * @param enhancedPromptsContent - Optional AI-generated guidance from EnhancedPromptsService
   * @param mcpServerRunning - Whether MCP server is running
   * @returns System prompt configuration for SDK (always preset+append)
   */
  private buildSystemPrompt(
    sessionConfig?: AISessionConfig,
    isPremium = false,
    enhancedPromptsContent?: string,
    mcpServerRunning = true
  ): SdkQueryOptions['systemPrompt'] {
    const activeProviderId = getActiveProviderId(this.authEnv);

    if (activeProviderId) {
      this.logger.info(
        `[SdkQueryOptionsBuilder] Third-party provider detected (${activeProviderId}) - adding identity clarification`
      );
    }

    const result = assembleSystemPrompt({
      providerId: activeProviderId,
      authEnv: this.authEnv,
      userSystemPrompt: sessionConfig?.systemPrompt,
      isPremium,
      mcpServerRunning,
      enhancedPromptsContent,
      preset: sessionConfig?.preset,
    });

    this.logger.info('[SdkQueryOptionsBuilder] System prompt assembled', {
      isPremium,
      mcpServerRunning,
      mode: 'preset-append',
      hasEnhancedPrompts: !!enhancedPromptsContent,
      enhancedPromptsLength: enhancedPromptsContent?.length ?? 0,
      hasPtahCorePrompt: isPremium,
      hasIdentityPrompt: !!activeProviderId,
      hasUserSystemPrompt: !!sessionConfig?.systemPrompt,
      totalAppendLength: result.content?.length ?? 0,
    });

    // Always use claude_code preset as base — it provides critical MCP handling,
    // tool routing, and environment context. Our content is appended on top.
    return {
      type: 'preset' as const,
      preset: 'claude_code' as const,
      append: result.content,
    };
  }

  /**
   * Build MCP servers configuration
   *
   * For premium users, enables the Ptah HTTP MCP server which provides
   * execute_code tool with 11 Ptah API namespaces.
   * For free tier, returns empty object (no MCP servers).
   *
   * TASK_2025_108: Added mcpServerRunning check to prevent configuring
   * Claude with a dead MCP endpoint when the server isn't running.
   *
   * @param isPremium - Whether user has premium features enabled
   * @param mcpServerRunning - Whether the MCP server is currently running
   * @returns MCP servers configuration for SDK
   */
  private buildMcpServers(
    isPremium: boolean,
    mcpServerRunning = true
  ): Record<string, McpHttpServerConfig> {
    // Free tier - disable MCP servers (TASK_2025_108)
    if (!isPremium) {
      this.logger.info(
        '[SdkQueryOptionsBuilder] MCP servers disabled (not premium)',
        { isPremium, mcpServerRunning }
      );
      return {};
    }

    // TASK_2025_108: Check if MCP server is running before configuring
    // This prevents configuring Claude with a dead endpoint
    if (!mcpServerRunning) {
      this.logger.info(
        '[SdkQueryOptionsBuilder] MCP servers disabled (server not running)',
        { isPremium, mcpServerRunning }
      );
      return {};
    }

    // Premium user - enable Ptah HTTP MCP server
    // Uses HTTP MCP server from vscode-lm-tools/CodeExecutionMCP
    // Provides execute_code tool with 11 Ptah API namespaces
    const mcpConfig = {
      ptah: {
        type: 'http' as const,
        url: `http://localhost:${PTAH_MCP_PORT}`,
      },
    };
    this.logger.info('[SdkQueryOptionsBuilder] MCP servers ENABLED', {
      isPremium,
      mcpServerRunning,
      mcpUrl: mcpConfig.ptah.url,
    });
    return mcpConfig;
  }

  /**
   * Calculate max turns from session config
   */
  private calculateMaxTurns(
    sessionConfig?: AISessionConfig
  ): number | undefined {
    if (sessionConfig?.maxTokens) {
      return Math.floor(sessionConfig.maxTokens / 1000);
    }
    return undefined;
  }

  /**
   * Build SDK plugin configuration from resolved paths
   *
   * Converts absolute directory paths to SdkPluginConfig format expected by the SDK.
   * Returns undefined (not empty array) when no plugins are configured,
   * avoiding sending unnecessary empty arrays to the SDK.
   *
   * @param pluginPaths - Absolute paths to plugin directories (from PluginLoaderService)
   * @returns Array of SdkPluginConfig for SDK, or undefined if no plugins
   */
  private buildPlugins(pluginPaths?: string[]): SdkPluginConfig[] | undefined {
    if (!pluginPaths || pluginPaths.length === 0) {
      return undefined;
    }
    return pluginPaths.map((p) => ({ type: 'local' as const, path: p }));
  }

  /**
   * Create merged lifecycle hooks (subagent + compaction)
   *
   * TASK_2025_098: Now creates both subagent hooks and compaction hooks,
   * merging them into a single hooks object for SDK query options.
   *
   * @param cwd - Working directory for subagent hooks
   * @param sessionId - Session ID for compaction hooks (optional)
   * @param onCompactionStart - Callback for compaction start (optional)
   * @returns Merged hooks configuration for SDK query options
   */
  private createHooks(
    cwd: string,
    sessionId?: string,
    onCompactionStart?: CompactionStartCallback
  ): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
    // Create subagent hooks (existing functionality)
    // TASK_2025_186: Pass sessionId as parentSessionId so SubagentStart hook
    // registers subagents in the registry. Without this, markAllInterrupted()
    // and markParentSubagentsAsCliAgent() cannot find subagent records.
    const subagentHooks = this.subagentHookHandler.createHooks(cwd, sessionId);

    // Create compaction hooks if sessionId is provided (TASK_2025_098)
    // Even without sessionId, we create hooks with empty string - SDK will provide session_id in hook input
    const compactionHooks = this.compactionHookHandler.createHooks(
      sessionId ?? '',
      onCompactionStart
    );

    // Merge hooks safely — concatenate arrays for same event key to prevent overwrites
    const mergedHooks: Partial<Record<HookEvent, HookCallbackMatcher[]>> = {};
    for (const hooks of [subagentHooks, compactionHooks]) {
      for (const [event, matchers] of Object.entries(hooks)) {
        const key = event as HookEvent;
        mergedHooks[key] = [...(mergedHooks[key] || []), ...matchers];
      }
    }

    // Log hook registration for debugging
    this.logger.info('[SdkQueryOptionsBuilder] SDK hooks created for session', {
      cwd,
      sessionId: sessionId ? `${sessionId.slice(0, 8)}...` : 'not-provided',
      hookEvents: Object.keys(mergedHooks),
      hasSubagentStart: !!mergedHooks.SubagentStart,
      hasSubagentStop: !!mergedHooks.SubagentStop,
      hasPreCompact: !!mergedHooks.PreCompact,
      subagentStartHooksCount: mergedHooks.SubagentStart?.length ?? 0,
      subagentStopHooksCount: mergedHooks.SubagentStop?.length ?? 0,
      preCompactHooksCount: mergedHooks.PreCompact?.length ?? 0,
      hasCompactionCallback: !!onCompactionStart,
    });

    return mergedHooks;
  }
}
