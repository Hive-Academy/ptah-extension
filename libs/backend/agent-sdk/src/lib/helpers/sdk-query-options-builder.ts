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
import { MemoryPromptInjector } from './memory-prompt-injector';
import {
  AISessionConfig,
  AuthEnv,
  ThinkingConfig,
  EffortLevel,
  type McpHttpServerOverride,
} from '@ptah-extension/shared';
import { SDK_TOKENS } from '../di/tokens';
import { SdkError, ModelNotAvailableError } from '../errors';
import { SdkPermissionHandler } from '../sdk-permission-handler';
import { SubagentHookHandler } from './subagent-hook-handler';
import { CompactionConfigProvider } from './compaction-config-provider';
import {
  CompactionHookHandler,
  type CompactionStartCallback,
} from './compaction-hook-handler';
import {
  WorktreeHookHandler,
  type WorktreeCreatedCallback,
  type WorktreeRemovedCallback,
} from './worktree-hook-handler';
import {
  CanUseTool,
  HookEvent,
  HookCallbackMatcher,
  McpHttpServerConfig,
  type ModelInfo,
  type SdkBeta,
  type Options,
} from '../types/sdk-types/claude-sdk.types';
import type { SDKUserMessage } from './session-lifecycle-manager';
import {
  getAnthropicProvider,
  ANTHROPIC_PROVIDERS,
} from '../providers/_shared/provider-registry';
import { SdkModelService, buildTierEnvDefaults } from './sdk-model-service';
import { COPILOT_PROXY_TOKEN_PLACEHOLDER } from '../providers/copilot/copilot-provider.types';
import { CODEX_PROXY_TOKEN_PLACEHOLDER } from '../providers/codex/codex-provider.types';
import { OPENROUTER_PROXY_TOKEN_PLACEHOLDER } from '../providers/openrouter/openrouter-provider.types';
import { OLLAMA_AUTH_TOKEN_PLACEHOLDER } from '../providers/local/local-provider.types';
import { PTAH_CORE_SYSTEM_PROMPT } from '../prompt-harness';
import { PTAH_MCP_PORT } from '../constants';

/**
 * Detect obvious upstream provider error signatures in a stderr chunk.
 *
 * The SDK sometimes logs HTTP / API errors to stderr without forwarding them
 * through the message stream, which causes the UI to hang. These patterns
 * cover the common cases we've seen from Anthropic-compatible providers
 * (Moonshot, Z.AI, OpenRouter) — HTTP status codes, Anthropic error type
 * strings, and common auth/model keywords.
 */
function isUpstreamProviderError(stderrChunk: string): boolean {
  const lower = stderrChunk.toLowerCase();
  return (
    /\b(401|403|404|429|5\d\d)\b/.test(stderrChunk) ||
    lower.includes('model_not_found') ||
    lower.includes('invalid_request_error') ||
    lower.includes('authentication_error') ||
    lower.includes('permission_error') ||
    lower.includes('not_found_error') ||
    lower.includes('rate_limit_error') ||
    lower.includes('overloaded_error') ||
    lower.includes('api_error')
  );
}

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
  authEnv: AuthEnv,
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
  if (authEnv.ANTHROPIC_AUTH_TOKEN === OPENROUTER_PROXY_TOKEN_PLACEHOLDER) {
    return 'openrouter';
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
  input: AssembleSystemPromptInput,
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
  /** Callback when SDK creates a worktree (TASK_2025_236) */
  onWorktreeCreated?: WorktreeCreatedCallback;
  /** Callback when SDK removes a worktree (TASK_2025_236) */
  onWorktreeRemoved?: WorktreeRemovedCallback;
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
   * the CI runner path at bundle time.
   */
  pathToClaudeCodeExecutable?: string;
  /**
   * Optional callback invoked when the SDK's stderr stream contains an
   * obvious upstream provider error (HTTP 4xx, model_not_found,
   * invalid_request_error, authentication failures). The callee is
   * responsible for surfacing the error to the UI — typically by aborting
   * the query's AbortController with a descriptive Error, which then
   * causes the stream iterator to throw. Without this hook, stderr-only
   * errors (e.g., Moonshot returning model_not_found for an unsupported
   * tier mapping) can leave the UI hanging with no response.
   */
  onProviderError?: (message: string) => void;
  /**
   * When true, resume + forkSession together create a NEW session ID instead
   * of mutating the resumed transcript. Used by the fork-session RPC path.
   * Has no effect unless `resumeSessionId` is also set.
   */
  forkSession?: boolean;
  /**
   * When resuming, only replay messages up to (and including) the message with
   * this UUID. Maps directly to SDK Options.resumeSessionAt.
   */
  resumeSessionAt?: string;
  /**
   * Toggle SDK file checkpointing for this session. Defaults to ON when
   * unspecified — file checkpointing is required by `Query.rewindFiles()`,
   * which is the underlying mechanism for the rewind feature. Pass `false`
   * explicitly to opt out (e.g., performance-sensitive contexts).
   */
  enableFileCheckpointing?: boolean;
  /**
   * When true, the SDK emits `SDKPartialAssistantMessage` events
   * (`subtype: 'stream_event'`) for finer-grained streaming deltas. Mirrors
   * `Options.includePartialMessages` from the Claude Agent SDK. Defaults to
   * ON when unspecified to preserve historical Ptah behavior — the existing
   * stream consumers (StreamTransformer, SdkMessageTransformer) already
   * handle these events. Pass `false` to opt out (reduces event volume on
   * bandwidth-sensitive paths).
   */
  includePartialMessages?: boolean;
  /**
   * Caller-supplied MCP HTTP server overrides — merged OVER the registry-
   * built map by `mergeMcpOverride` (caller wins on key collision). Reserved
   * for the Anthropic-compatible HTTP proxy in P3 (TASK_2026_108 T2). When
   * `undefined` or an empty object, the builder's `mcpServers` output is
   * byte-identical to the pre-T2 behavior.
   */
  mcpServersOverride?: Record<string, McpHttpServerOverride>;
  /**
   * The user's initial message text for this turn.
   * Used to drive a memory recall search so the top-K hits can be prepended to
   * the system prompt. Only used when `isPremium === true` and the string is
   * non-empty. Multi-turn sessions should pass the most recent user message.
   */
  initialUserQuery?: string;
}

/**
 * SDK query options structure — directly aliased from the SDK's canonical
 * `Options` type. Phase 0 fix: the hand-rolled `SdkQueryOptions` interface
 * masked phantom fields like `forwardSubagentText` that the SDK silently
 * ignored. Using `Options` directly surfaces compile errors when we attempt
 * to set properties that do not exist in the SDK.
 *
 * Subagent visibility now flows via `agentProgressSummaries: true` Option
 * + task_* system messages handled by SdkMessageTransformer.
 */
export type SdkQueryOptions = Options;

/**
 * Complete query configuration returned by builder
 */
export interface QueryConfig {
  /** Prompt for SDK: async iterable of user messages */
  prompt: AsyncIterable<SDKUserMessage>;
  /** SDK query options (typed directly as SDK's Options) */
  options: Options;
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
    @inject(SDK_TOKENS.SDK_WORKTREE_HOOK_HANDLER)
    private readonly worktreeHookHandler: WorktreeHookHandler,
    @inject(SDK_TOKENS.SDK_AUTH_ENV) private readonly authEnv: AuthEnv,
    @inject(SDK_TOKENS.SDK_MODEL_SERVICE)
    private readonly modelService: SdkModelService,
    @inject(SDK_TOKENS.SDK_MEMORY_PROMPT_INJECTOR)
    private readonly memoryPromptInjector: MemoryPromptInjector,
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
      onWorktreeCreated,
      onWorktreeRemoved,
      isPremium = false,
      mcpServerRunning = true,
      enhancedPromptsContent,
      pluginPaths,
      permissionMode = 'default',
      pathToClaudeCodeExecutable,
      onProviderError,
      forkSession,
      resumeSessionAt,
      enableFileCheckpointing,
      includePartialMessages,
      mcpServersOverride,
      initialUserQuery,
    } = input;

    // Model is required - SDK sets default in config at startup
    if (!sessionConfig?.model) {
      throw new SdkError('Model not provided - ensure SDK is initialized');
    }

    // Observability: log when fork/resume-at are requested without a resume id
    // (these get silently dropped to `undefined` further down — see end of build()).
    this.warnIfForkOptionsDroppedSilently(input);

    // Resolve bare tier names ('opus', 'sonnet', 'haiku') to full model IDs.
    // The SDK's query() requires full model IDs like 'claude-opus-4-6' —
    // bare tier names cause "can't access model named opus" errors.
    const model = this.modelService.resolveModelId(sessionConfig.model);
    if (!sessionConfig?.projectPath) {
      throw new SdkError(
        'projectPath is required — cannot start an SDK session without a workspace folder. ' +
          'Callers must resolve workspace path from IWorkspaceProvider before reaching here.',
      );
    }
    const cwd = sessionConfig.projectPath;

    // Log resolved model and tier env vars for debugging (TASK_2025_132, TASK_2025_164: reads from AuthEnv)
    const envSonnet = this.authEnv.ANTHROPIC_DEFAULT_SONNET_MODEL || 'default';
    const envOpus = this.authEnv.ANTHROPIC_DEFAULT_OPUS_MODEL || 'default';
    const envHaiku = this.authEnv.ANTHROPIC_DEFAULT_HAIKU_MODEL || 'default';
    this.logger.info(`[SdkQueryOptionsBuilder] SDK call with model: ${model}`, {
      model,
      envSonnet,
      envOpus,
      envHaiku,
      baseUrl: this.authEnv.ANTHROPIC_BASE_URL || 'default',
    });

    // Validate that non-Anthropic providers have ANTHROPIC_BASE_URL configured.
    // Without this check, empty/missing base URL causes the SDK to silently fall
    // back to api.anthropic.com while the auth token is a provider-specific
    // placeholder (e.g., OLLAMA_AUTH_TOKEN_PLACEHOLDER), which Anthropic's API
    // drops without responding — causing the UI to hang forever. Surface the
    // misconfiguration immediately so the user sees a clear, actionable error.
    this.validateBaseUrlForProvider();

    // Pre-flight model existence check (cache-only, never blocks the query path
    // with a fresh fetch). Only runs when models are already cached from a
    // previous getSupportedModels() call — avoids adding latency on first query.
    // Catches provider-reported "model not found" failures (e.g. kimi-k2.6 /
    // devstral on Moonshot) before the SDK starts the subprocess, so the UI
    // gets a typed ModelNotAvailableError rather than a raw SDK error result.
    await this.validateModelAvailability(model);

    // Warn when main model is non-Claude but tier env vars still point to Claude.
    // This means subagents will silently use Claude models at higher premium rates.
    if (!model.startsWith('claude-')) {
      const claudeTiers = [envSonnet, envOpus, envHaiku].filter(
        (t) => t !== 'default' && t.startsWith('claude-'),
      );
      if (claudeTiers.length > 0) {
        this.logger.warn(
          `[SdkQueryOptionsBuilder] Model mismatch: main model is '${model}' but ${claudeTiers.length} tier(s) still point to Claude models (${claudeTiers.join(', ')}). ` +
            'Subagents spawned by the SDK will use these Claude models, potentially consuming premium requests at a higher rate. ' +
            'Update tier mappings in the model selector to match your preferred provider.',
        );
      }
    }

    // Build system prompt configuration
    const systemPrompt = await this.buildSystemPrompt(
      sessionConfig,
      isPremium,
      enhancedPromptsContent,
      mcpServerRunning,
      initialUserQuery,
      cwd,
    );

    // Create permission callback with tabId for UI routing (TASK_2025_187).
    // For new sessions sessionId == tabId (trackingId = tabId from startChatSession).
    // For RESUMED sessions sessionId is the real SDK UUID while sessionConfig.tabId
    // is still the frontend tab ID — use tabId so AskUserQuestion/permission cards
    // route to the correct tab instead of being silently filtered out.
    const routingId = sessionConfig?.tabId ?? sessionId;
    const canUseToolCallback: CanUseTool =
      this.permissionHandler.createCallback(routingId);

    // Create merged hooks (subagent + compaction + worktree)
    // TASK_2025_098: Pass sessionId and callback for compaction hooks
    // TASK_2025_236: Pass worktree callbacks for worktree hooks
    const hooks = this.createHooks(
      cwd,
      sessionId,
      onCompactionStart,
      onWorktreeCreated,
      onWorktreeRemoved,
    );

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
        mcpServers: this.mergeMcpOverride(
          this.buildMcpServers(isPremium, mcpServerRunning, sessionId),
          mcpServersOverride,
        ),
        // Set SDK permission mode based on current autopilot config.
        // SDK evaluation order: Hooks → Rules → Permission Mode → canUseTool.
        // When 'default': all tools fall through to canUseTool callback.
        // When 'bypassPermissions'/'acceptEdits'/'plan': SDK resolves at step 3.
        permissionMode,
        canUseTool: canUseToolCallback,
        // Default ON preserves historical behavior — partial stream events
        // are already consumed by StreamTransformer/SdkMessageTransformer.
        // Callers can opt out via QueryOptionsInput.includePartialMessages.
        includePartialMessages: includePartialMessages ?? true,
        // Load settings from project and local directories.
        // IMPORTANT: Exclude 'user' when using a translation proxy OR local provider
        // (Ollama uses localhost, not 127.0.0.1) because ~/.claude/settings.json may
        // contain auth from a previous `claude login` that overrides ANTHROPIC_BASE_URL
        // and routes requests to api.anthropic.com instead of our local endpoint.
        settingSources: /^https?:\/\/(127\.0\.0\.1|localhost)/i.test(
          this.authEnv.ANTHROPIC_BASE_URL?.trim() ?? '',
        )
          ? ['project', 'local']
          : ['user', 'project', 'local'],
        // Merge AuthEnv with process.env — AuthEnv values override process.env (TASK_2025_164)
        // Guarantee tier env vars (ANTHROPIC_DEFAULT_*_MODEL) are always present so the
        // SDK can resolve bare tier names ('haiku', 'sonnet', 'opus') in subagent
        // subprocesses. Without these, direct Anthropic users get "model not found" errors
        // when subagents specify a tier name instead of a full model ID.
        // Set NO_PROXY to prevent corporate proxy interception of localhost requests
        // Disable experimental betas for any non-Anthropic base URL — the SDK
        // enables context-management-2025-06-27 for "firstParty" providers, which
        // third-party endpoints (OpenRouter, Moonshot, unknown proxies, etc.)
        // don't support, causing 400 errors. Check the URL directly instead of
        // relying on provider registry detection, which misses unknown providers.
        env: {
          ...process.env,
          ...buildTierEnvDefaults(this.authEnv),
          ...this.authEnv,
          NO_PROXY: '127.0.0.1,localhost',
          ...(() => {
            const baseUrl = this.authEnv.ANTHROPIC_BASE_URL?.trim();
            return baseUrl &&
              !/^https?:\/\/api\.anthropic\.com\/?$/i.test(baseUrl)
              ? { CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: '1' }
              : {};
          })(),
        } as Record<string, string | undefined>,
        // Capture stderr — the SDK writes debug/info/warn/error to stderr;
        // parse the level and route to the appropriate logger method.
        // When stderr carries an upstream provider error (HTTP 4xx,
        // model_not_found, invalid_request_error, etc.) the SDK sometimes
        // fails to forward it through the message stream, leaving the UI
        // spinning. Detect those signatures and notify the caller via
        // onProviderError so it can abort the query with a clear message.
        stderr: (data: string) => {
          if (data.includes('[ERROR]')) {
            this.logger.error(`[SdkQueryOptionsBuilder] CLI stderr: ${data}`);
          } else if (data.includes('[WARN]')) {
            this.logger.warn(`[SdkQueryOptionsBuilder] CLI stderr: ${data}`);
          } else {
            this.logger.debug(`[SdkQueryOptionsBuilder] CLI stderr: ${data}`);
          }

          if (onProviderError && isUpstreamProviderError(data)) {
            try {
              onProviderError(data);
            } catch (hookErr) {
              this.logger.warn(
                '[SdkQueryOptionsBuilder] onProviderError hook threw',
                hookErr instanceof Error ? hookErr : new Error(String(hookErr)),
              );
            }
          }
        },
        hooks,
        // Plugins disabled here — skills are loaded via .claude/skills/ junctions
        // created by SkillJunctionService. Passing plugins via SDK option caused
        // duplication in slash command autocomplete.
        // NOTE: compactionControl was a phantom field not present in the SDK's
        // Options type. It was silently ignored by the SDK. The compaction
        // threshold is handled by SDK-internal heuristics; our hook-based
        // approach (PreCompact hook in CompactionHookHandler) remains intact.
        // TASK_2025_184: Reasoning configuration passthrough
        // undefined values are omitted by SDK, preserving default behavior
        thinking: sessionConfig?.thinking,
        effort: sessionConfig?.effort,
        // TASK_2025_194: Override baked-in import.meta.url path with runtime-resolved cli.js
        pathToClaudeCodeExecutable,
        // Enable 1M context window for direct Anthropic connections.
        // The SDK doesn't auto-enable this beta like the CLI does — we must
        // pass it explicitly. Only for first-party (api.anthropic.com);
        // third-party providers don't support this beta header.
        betas: this.buildBetas(),
        // File checkpointing — defaults ON so Query.rewindFiles() works.
        // Callers can opt out by passing enableFileCheckpointing: false.
        enableFileCheckpointing: enableFileCheckpointing ?? true,
        // Pair file checkpointing with --replay-user-messages so the SDK
        // emits `checkpointUuid` on user-message stream events. Without
        // this CLI flag, `Query.rewindFiles()` has no UUID to rewind to
        // and the rewind feature silently no-ops.
        ...((enableFileCheckpointing ?? true)
          ? { extraArgs: { 'replay-user-messages': null } }
          : {}),
        // Request AI-generated progress summaries for subagents. Subagent
        // visibility now flows via this Option + task_* system messages
        // (task_started, task_progress, task_updated, task_notification)
        // handled by SdkMessageTransformer. Set unconditionally — cheap,
        // prompt-cache-reusing, harmless when no subagents run.
        agentProgressSummaries: true,
        // Fork-on-resume — only meaningful when resumeSessionId is also set.
        // The SDK creates a brand-new session UUID seeded from the resumed
        // transcript instead of mutating the original session.
        forkSession: resumeSessionId ? forkSession : undefined,
        // Resume from a specific message UUID (branching point).
        resumeSessionAt: resumeSessionId ? resumeSessionAt : undefined,
      },
    };
  }

  /**
   * Emit a structured warning when fork/resume-at are requested without a
   * resumeSessionId. Behavior is intentionally preserved (silent drop into
   * `undefined`) — but observability is added so misconfigured callers
   * surface in logs instead of silently producing fresh sessions.
   *
   * Called inline below; extracted for readability and to keep the main
   * `build()` flow uncluttered.
   */
  private warnIfForkOptionsDroppedSilently(input: QueryOptionsInput): void {
    const { resumeSessionId, forkSession, resumeSessionAt, sessionId } = input;
    if (resumeSessionId) return;
    if (forkSession === undefined && resumeSessionAt === undefined) return;
    this.logger.warn(
      '[SdkQueryOptionsBuilder] forkSession/resumeSessionAt were set without a resumeSessionId — both options will be dropped because they only apply to resumed sessions.',
      {
        sessionId: sessionId ? `${sessionId.slice(0, 8)}...` : undefined,
        hasForkSession: forkSession !== undefined,
        hasResumeSessionAt: resumeSessionAt !== undefined,
        forkSession,
        // Truncate the message UUID like the rest of the file does
        resumeSessionAt: resumeSessionAt
          ? `${resumeSessionAt.slice(0, 8)}...`
          : undefined,
      },
    );
  }

  /**
   * Validate that ANTHROPIC_BASE_URL is present when the active auth token is
   * a non-Anthropic provider placeholder.
   *
   * Background: providers like Ollama, Copilot, Codex, and OpenRouter write a
   * known placeholder string into `ANTHROPIC_AUTH_TOKEN` (e.g. 'ollama',
   * 'copilot-proxy-managed') and point `ANTHROPIC_BASE_URL` at their local
   * endpoint. If the strategy's `configure()` never ran — typically because the
   * user hasn't selected the provider yet — `ANTHROPIC_BASE_URL` stays empty
   * while the placeholder token remains, and the SDK silently falls back to
   * api.anthropic.com. Anthropic rejects/drops the request and the UI hangs.
   *
   * Throw here so the error surfaces to the UI with clear remediation.
   */
  private validateBaseUrlForProvider(): void {
    const baseUrl = this.authEnv.ANTHROPIC_BASE_URL?.trim();
    const authToken = this.authEnv.ANTHROPIC_AUTH_TOKEN;

    if (baseUrl) {
      // Base URL is set — SDK will route there, no hang risk.
      return;
    }

    // Map of placeholder token → human-readable provider name.
    // If the auth token matches any of these, the user has selected a
    // non-Anthropic provider but its base URL isn't configured yet.
    const placeholderToProvider: Record<string, string> = {
      [OLLAMA_AUTH_TOKEN_PLACEHOLDER]: 'Ollama',
      [COPILOT_PROXY_TOKEN_PLACEHOLDER]: 'GitHub Copilot',
      [CODEX_PROXY_TOKEN_PLACEHOLDER]: 'OpenAI Codex',
      [OPENROUTER_PROXY_TOKEN_PLACEHOLDER]: 'OpenRouter',
    };

    const providerName = authToken
      ? placeholderToProvider[authToken]
      : undefined;

    if (providerName) {
      const message =
        `Provider '${providerName}' is not configured — ANTHROPIC_BASE_URL is missing. ` +
        `Select the provider in settings to configure it, or switch to Anthropic direct.`;
      this.logger.error(`[SdkQueryOptionsBuilder] ${message}`, {
        providerName,
        hasBaseUrl: false,
        hasAuthToken: !!authToken,
      });
      throw new SdkError(message);
    }
  }

  /**
   * Cache-only pre-flight check that the resolved model ID is in the
   * third-party provider's advertised list. No-op for direct Anthropic connections.
   *
   * @throws ModelNotAvailableError when the model is absent from the cached list
   */
  private async validateModelAvailability(
    resolvedModel: string,
  ): Promise<void> {
    // Only validate for third-party providers — Anthropic's list is authoritative
    // and may include models added after the cache was last populated.
    const baseUrl = this.authEnv.ANTHROPIC_BASE_URL?.trim();
    const isDirectAnthropic =
      !baseUrl || /^https?:\/\/api\.anthropic\.com\/?$/i.test(baseUrl);
    if (isDirectAnthropic) {
      return;
    }

    // Cache-only: don't trigger a fresh model fetch on the query hot path.
    if (!this.modelService.hasCachedModels()) {
      this.logger.debug(
        '[SdkQueryOptionsBuilder] Skipping model pre-flight: no cached models yet',
        { resolvedModel },
      );
      return;
    }

    let supportedModels: ModelInfo[];
    try {
      supportedModels = await this.modelService.getSupportedModels();
    } catch {
      // If the model service throws, don't block the query — fall through
      // and let the SDK surface any real error.
      this.logger.warn(
        '[SdkQueryOptionsBuilder] Model pre-flight: getSupportedModels() threw — skipping check',
        { resolvedModel },
      );
      return;
    }

    if (supportedModels.length === 0) {
      return;
    }

    const modelIds = supportedModels.map((m) => m.value);
    if (modelIds.includes(resolvedModel)) {
      return;
    }

    // Model not found in cached list — throw a typed error the UI can handle.
    this.logger.error(
      `[SdkQueryOptionsBuilder] Model pre-flight failed: '${resolvedModel}' not in cached model list`,
      {
        resolvedModel,
        available: modelIds.slice(0, 10),
        baseUrl,
      },
    );
    throw new ModelNotAvailableError(resolvedModel, modelIds);
  }

  /**
   * Build beta headers for SDK query.
   *
   * The Claude CLI automatically enables the `context-1m-2025-08-07` beta for
   * first-party (api.anthropic.com) connections, unlocking 1M token context for
   * Opus and Sonnet 4.6 models. The SDK module does NOT auto-enable this — we
   * must pass it explicitly via the `betas` query option.
   *
   * Skipped for third-party providers (OpenRouter, Moonshot, Z.AI, proxies) as
   * they don't support Anthropic beta headers and would return 400 errors.
   *
   * @returns Array of beta strings, or undefined if no betas should be sent
   */
  private buildBetas(): SdkBeta[] | undefined {
    const baseUrl = this.authEnv.ANTHROPIC_BASE_URL?.trim();

    // Only enable for direct Anthropic connections (no base URL, or explicitly api.anthropic.com)
    const isFirstParty =
      !baseUrl || /^https?:\/\/api\.anthropic\.com\/?$/i.test(baseUrl);

    if (!isFirstParty) {
      this.logger.debug(
        '[SdkQueryOptionsBuilder] Skipping 1M context beta for third-party provider',
        { baseUrl },
      );
      return undefined;
    }

    this.logger.info(
      '[SdkQueryOptionsBuilder] Enabling 1M context beta for Anthropic direct',
    );
    return ['context-1m-2025-08-07'];
  }

  /**
   * Build system prompt configuration.
   *
   * Always uses the SDK's `claude_code` preset as base. For premium users,
   * appends PTAH_CORE_SYSTEM_PROMPT, optional enhanced prompts content, and
   * a memory recall block derived from the first user message.
   */
  private async buildSystemPrompt(
    sessionConfig?: AISessionConfig,
    isPremium = false,
    enhancedPromptsContent?: string,
    mcpServerRunning = true,
    initialUserQuery?: string,
    cwd?: string,
  ): Promise<SdkQueryOptions['systemPrompt']> {
    const activeProviderId = getActiveProviderId(this.authEnv);

    if (activeProviderId) {
      this.logger.info(
        `[SdkQueryOptionsBuilder] Third-party provider detected (${activeProviderId}) - adding identity clarification`,
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

    // Memory recall — premium only, requires user query.
    let memoryBlock = '';
    if (isPremium && initialUserQuery?.trim()) {
      memoryBlock = await this.memoryPromptInjector.buildBlock(
        initialUserQuery,
        cwd,
      );
    }

    // Combine base content with memory block (memory first for highest visibility)
    const finalContent = memoryBlock
      ? memoryBlock + (result.content ? '\n\n' + result.content : '')
      : result.content;

    this.logger.info('[SdkQueryOptionsBuilder] System prompt assembled', {
      isPremium,
      mcpServerRunning,
      mode: 'preset-append',
      hasEnhancedPrompts: !!enhancedPromptsContent,
      enhancedPromptsLength: enhancedPromptsContent?.length ?? 0,
      hasPtahCorePrompt: isPremium,
      hasIdentityPrompt: !!activeProviderId,
      hasUserSystemPrompt: !!sessionConfig?.systemPrompt,
      hasMemoryBlock: !!memoryBlock,
      memoryBlockLength: memoryBlock.length,
      totalAppendLength: finalContent?.length ?? 0,
    });

    // Always use claude_code preset as base — it provides critical MCP handling,
    // tool routing, and environment context. Our content is appended on top.
    return {
      type: 'preset' as const,
      preset: 'claude_code' as const,
      append: finalContent,
    };
  }

  /**
   * Build MCP servers configuration.
   *
   * For premium users, enables the Ptah HTTP MCP server (execute_code + 11 namespaces).
   * Returns an empty object for free-tier users or when the server is not running.
   */
  private buildMcpServers(
    isPremium: boolean,
    mcpServerRunning = true,
    sessionId?: string,
  ): Record<string, McpHttpServerConfig> {
    // Free tier - disable MCP servers
    if (!isPremium) {
      this.logger.info(
        '[SdkQueryOptionsBuilder] MCP servers disabled (not premium)',
        { isPremium, mcpServerRunning },
      );
      return {};
    }

    if (!mcpServerRunning) {
      this.logger.info(
        '[SdkQueryOptionsBuilder] MCP servers disabled (server not running)',
        { isPremium, mcpServerRunning },
      );
      return {};
    }

    // Premium user - enable Ptah HTTP MCP server
    // Uses HTTP MCP server from vscode-lm-tools/CodeExecutionMCP
    // Provides execute_code tool with 11 Ptah API namespaces
    const mcpConfig = {
      ptah: {
        type: 'http' as const,
        url: sessionId
          ? `http://localhost:${PTAH_MCP_PORT}/session/${encodeURIComponent(sessionId)}`
          : `http://localhost:${PTAH_MCP_PORT}`,
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
   * Merge caller-supplied MCP HTTP overrides over the registry-built map.
   * Caller wins on key collision (matches the proxy tool-merger contract).
   *
   * Returns the original `base` reference unchanged when `override` is
   * `undefined` or empty — preserves identity for the existing chat path so
   * the merge is a no-op on every non-proxy call site.
   *
   * @see TASK_2026_108 T2 — threading mcpServersOverride through the SDK chain
   */
  private mergeMcpOverride(
    base: Record<string, McpHttpServerConfig>,
    override: Record<string, McpHttpServerOverride> | undefined,
  ): Record<string, McpHttpServerConfig> {
    if (!override || Object.keys(override).length === 0) {
      return base;
    }
    // McpHttpServerOverride is structurally a subset of McpHttpServerConfig —
    // both share { type: 'http', url, headers? }. The widening cast lets the
    // SDK consume the override entries without a runtime conversion. This is
    // the SINGLE documented widening cast for TASK_2026_108 T2; do NOT add
    // additional `as` casts elsewhere in the threading path.
    return { ...base, ...(override as Record<string, McpHttpServerConfig>) };
  }

  /**
   * Calculate max turns from session config.
   *
   * Safety limit: returns a default cap when no explicit maxTokens is set.
   * Without this, the SDK runs unlimited agentic turns — each turn is an
   * API round-trip that consumes provider quota. On metered providers like
   * Copilot (premium requests) or pay-per-token APIs, runaway sessions can
   * exhaust budgets quickly.
   *
   * Default: 200 turns — generous enough for complex multi-step tasks,
   * but prevents infinite loops from burning through quota.
   */
  private calculateMaxTurns(
    sessionConfig?: AISessionConfig,
  ): number | undefined {
    if (sessionConfig?.maxTokens) {
      return Math.floor(sessionConfig.maxTokens / 1000);
    }
    // Safety cap: prevent unlimited agentic turns on metered providers
    return 200;
  }

  /** Create merged lifecycle hooks (subagent + compaction + worktree) for SDK query options. */
  private createHooks(
    cwd: string,
    sessionId?: string,
    onCompactionStart?: CompactionStartCallback,
    onWorktreeCreated?: WorktreeCreatedCallback,
    onWorktreeRemoved?: WorktreeRemovedCallback,
  ): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
    // Pass sessionId so SubagentStart hook registers subagents in the registry.
    // Without this, markAllInterrupted() and markParentSubagentsAsCliAgent() cannot
    // find subagent records.
    const subagentHooks = this.subagentHookHandler.createHooks(cwd, sessionId);

    // Even without sessionId, create hooks with empty string — SDK provides session_id
    // in hook input.
    const compactionHooks = this.compactionHookHandler.createHooks(
      sessionId ?? '',
      onCompactionStart,
    );

    const worktreeHooks = this.worktreeHookHandler.createHooks(
      onWorktreeCreated,
      onWorktreeRemoved,
    );

    // Merge hooks safely — concatenate arrays for same event key to prevent overwrites
    const mergedHooks: Partial<Record<HookEvent, HookCallbackMatcher[]>> = {};
    for (const hooks of [subagentHooks, compactionHooks, worktreeHooks]) {
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
      hasWorktreeCreate: !!mergedHooks.WorktreeCreate,
      hasWorktreeRemove: !!mergedHooks.WorktreeRemove,
      subagentStartHooksCount: mergedHooks.SubagentStart?.length ?? 0,
      subagentStopHooksCount: mergedHooks.SubagentStop?.length ?? 0,
      preCompactHooksCount: mergedHooks.PreCompact?.length ?? 0,
      worktreeCreateHooksCount: mergedHooks.WorktreeCreate?.length ?? 0,
      worktreeRemoveHooksCount: mergedHooks.WorktreeRemove?.length ?? 0,
      hasCompactionCallback: !!onCompactionStart,
    });

    return mergedHooks;
  }
}
