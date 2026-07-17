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
 */

import { injectable, inject } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import { MemoryPromptInjector } from './memory-prompt-injector';
import { CodeSymbolPromptInjector } from './code-symbol-prompt-injector';
import { redactMcpUrl, redactMcpOverrideMap } from './redact-mcp-url';
import {
  AISessionConfig,
  AuthEnv,
  SessionId,
  TabId,
  type McpHttpServerOverride,
  type PermissionLevel,
} from '@ptah-extension/shared';
import { SDK_TOKENS } from '../di/tokens';
import { AUTH_PROVIDERS_TOKENS } from '@ptah-extension/auth-providers-tokens';
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
import { PostToolUseHookHandler } from './post-tool-use-hook-handler';
import { PreToolUseHookHandler } from './pre-tool-use-hook-handler';
import { SessionStartHookHandler } from './session-start-hook-handler';
import { UserPromptSubmitHookHandler } from './user-prompt-submit-hook-handler';
import { UserPromptExpansionHookHandler } from './user-prompt-expansion-hook-handler';
import { StopHookHandler } from './stop-hook-handler';
import { StopFailureHookHandler } from './stop-failure-hook-handler';
import { SubagentStopHookHandler } from './subagent-stop-hook-handler';
import { SessionEndHookHandler } from './session-end-hook-handler';
import { ToolFailureHookHandler } from './tool-failure-hook-handler';
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
  getModelContextWindow,
} from '@ptah-extension/shared';
import { SdkModelService, buildTierEnvDefaults } from './sdk-model-service';
import { experimentalBetaEnv } from './build-safe-env';
import {
  COPILOT_PROXY_TOKEN_PLACEHOLDER,
  CODEX_PROXY_TOKEN_PLACEHOLDER,
  OPENROUTER_PROXY_TOKEN_PLACEHOLDER,
  OLLAMA_AUTH_TOKEN_PLACEHOLDER,
} from '@ptah-extension/shared';
import { PTAH_CORE_SYSTEM_PROMPT } from '../prompt-harness';
import { PTAH_MCP_PORT, PTAH_DISABLE_SDK_AUTO_MEMORY } from '../constants';

/**
 * Detect obvious upstream provider error signatures in a stderr chunk.
 *
 * The SDK sometimes logs HTTP / API errors to stderr without forwarding them
 * through the message stream, which causes the UI to hang. These patterns
 * cover the common cases we've seen from Anthropic-compatible providers
 * (Moonshot, Z.AI, OpenRouter) â€” HTTP status codes, Anthropic error type
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
  const actualModel =
    authEnv.ANTHROPIC_DEFAULT_OPUS_MODEL ||
    authEnv.ANTHROPIC_DEFAULT_SONNET_MODEL ||
    authEnv.ANTHROPIC_DEFAULT_HAIKU_MODEL;

  if (!actualModel) {
    return undefined;
  }
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
  if (authEnv.ANTHROPIC_AUTH_TOKEN === COPILOT_PROXY_TOKEN_PLACEHOLDER) {
    return 'github-copilot';
  }
  if (authEnv.ANTHROPIC_AUTH_TOKEN === CODEX_PROXY_TOKEN_PLACEHOLDER) {
    return 'openai-codex';
  }
  if (authEnv.ANTHROPIC_AUTH_TOKEN === OPENROUTER_PROXY_TOKEN_PLACEHOLDER) {
    return 'openrouter';
  }
  for (const id of ANTHROPIC_PROVIDERS.map((p) => p.id)) {
    const provider = getAnthropicProvider(id);
    if (provider && provider.baseUrl) {
      if (baseUrl.includes(new URL(provider.baseUrl).hostname)) {
        return id;
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
 * Always uses 'preset-append' mode â€” the SDK's claude_code preset is the base,
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
 * Always uses the SDK's `claude_code` preset as the base â€” this provides critical
 * built-in behavioral guidance, MCP server handling, tool routing, and environment
 * context that the agent needs to function correctly.
 *
 * **Premium users**: PTAH_CORE_SYSTEM_PROMPT is appended to the preset, providing
 * Ptah-specific MCP mandates, formatting rules, AskUserQuestion enforcement,
 * orchestration workflows, CLI agent hierarchy, and git/PR safety. Enhanced prompts
 * (project-specific guidance from the setup wizard) are also appended when available.
 * Some behavioral sections overlap with the preset â€” this is intentional as it
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
  const appendParts: string[] = [];
  const identityPrompt = buildModelIdentityPrompt(providerId, authEnv);
  if (identityPrompt) {
    appendParts.push(identityPrompt);
  }
  if (isPremium) {
    appendParts.push(PTAH_CORE_SYSTEM_PROMPT);
  }
  if (userSystemPrompt) {
    appendParts.push(userSystemPrompt);
  }
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
   * Session ID for hook tracking.
   * Used by compaction hooks to identify which session triggered compaction.
   */
  sessionId?: string;
  /**
   * Callback for compaction start events.
   * Called when SDK begins compacting (summarizing) conversation history.
   */
  onCompactionStart?: CompactionStartCallback;
  /** Callback when SDK creates a worktree */
  onWorktreeCreated?: WorktreeCreatedCallback;
  /** Callback when SDK removes a worktree */
  onWorktreeRemoved?: WorktreeRemovedCallback;
  /**
   * Premium user flag - enables MCP server and Ptah system prompt
   * When true, enables Ptah MCP server and appends PTAH_CORE_SYSTEM_PROMPT
   * Defaults to false (free tier behavior)
   */
  isPremium?: boolean;
  /**
   * Whether the MCP server is currently running.
   * When false, MCP config will not be included even for premium users.
   * This prevents configuring Claude with a dead MCP endpoint.
   * Defaults to true for backward compatibility.
   */
  mcpServerRunning?: boolean;
  /**
   * Enhanced prompts content.
   * AI-generated project-specific guidance appended as a premium top-up
   * alongside the base prompt (either claude_code preset or PTAH_CORE_SYSTEM_PROMPT).
   * Also triggers auto-selection of the Ptah harness path when no explicit preset is set.
   */
  enhancedPromptsContent?: string;
  /**
   * Plugin paths to load for this session.
   * Absolute paths to plugin directories resolved by PluginLoaderService.
   * Only populated for premium users with configured plugins.
   */
  pluginPaths?: string[];
  /**
   * Initial SDK permission mode based on current autopilot config.
   * Mapped from the per-session level: 'auto-edit' → 'acceptEdits',
   * 'plan' → 'plan', and both 'ask' and 'yolo' → 'default'. YOLO uses
   * 'default' (NOT 'bypassPermissions') on purpose so the canUseTool callback
   * always runs — it auto-approves every tool for yolo while still routing
   * interactive tools (AskUserQuestion/ExitPlanMode) to the UI.
   * Defaults to 'default' (canUseTool callback handles everything).
   */
  permissionMode?: SdkQueryOptions['permissionMode'];
  /**
   * Explicit path to Claude Code CLI executable (cli.js).
   * Passed through to SDK SessionOptions to override the default
   * import.meta.url-based resolution which bakes in the CI runner path at
   * bundle time.
   */
  pathToClaudeCodeExecutable?: string;
  /**
   * Optional callback invoked when the SDK's stderr stream contains an
   * obvious upstream provider error (HTTP 4xx, model_not_found,
   * invalid_request_error, authentication failures). The callee is
   * responsible for surfacing the error to the UI â€” typically by aborting
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
   * Toggle SDK file checkpointing for this session. Defaults to ON when
   * unspecified â€” file checkpointing is required by `Query.rewindFiles()`,
   * which is the underlying mechanism for the rewind feature. Pass `false`
   * explicitly to opt out (e.g., performance-sensitive contexts).
   */
  enableFileCheckpointing?: boolean;
  /**
   * When true, the SDK emits `SDKPartialAssistantMessage` events
   * (`subtype: 'stream_event'`) for finer-grained streaming deltas. Mirrors
   * `Options.includePartialMessages` from the Claude Agent SDK. Defaults to
   * ON when unspecified to preserve historical Ptah behavior â€” the existing
   * stream consumers (StreamTransformer, SdkMessageTransformer) already
   * handle these events. Pass `false` to opt out (reduces event volume on
   * bandwidth-sensitive paths).
   */
  includePartialMessages?: boolean;
  /**
   * When true, the SDK forwards the full nested subagent conversation
   * (assistant/user text + thinking) through the message stream so live
   * subagent transcripts render in the execution tree. Mirrors
   * `Options.forwardSubagentText`. Defaults to ON when unspecified. This is a
   * deliberate killswitch: forwarded text shares the per-session capped event
   * buffer with the root conversation, so a caller can pass `false` to fall
   * back to the lighter task_* summary path if a chatty subagent is observed
   * evicting root/sibling events under load.
   */
  forwardSubagentText?: boolean;
  /**
   * Caller-supplied MCP HTTP server overrides â€” merged OVER the registry-
   * built map by `mergeMcpOverride` (caller wins on key collision). Reserved
   * for the Anthropic-compatible HTTP proxy. When `undefined` or an empty
   * object, the builder's `mcpServers` output is byte-identical to the prior
   * behavior.
   */
  mcpServersOverride?: Record<string, McpHttpServerOverride>;
  /**
   * The user's initial message text for this turn.
   * Used to drive a memory recall search so the top-K hits can be prepended to
   * the system prompt. Only used when `isPremium === true` and the string is
   * non-empty. Multi-turn sessions should pass the most recent user message.
   */
  initialUserQuery?: string;
  /**
   * Per-call AuthEnv override (sourced from a ProviderProfile). When provided,
   * the builder uses these values instead of the DI-singleton AuthEnv for
   * base URL, auth tokens, tier env vars, and provider-identity prompt
   * resolution. Reserved for the Ptah CLI unified-adapter path where the
   * profile carries third-party provider auth.
   */
  authEnvOverride?: AuthEnv;
  /**
   * Resolves the CURRENT per-session permission level, read live by the
   * canUseTool callback on every tool call. Supplied by SessionQueryExecutor
   * bound to the session's SessionRecord so tool gating is scoped per
   * session/workspace instead of read from the global handler field. Omitted
   * by non-interactive callers, which fall back to the global default.
   */
  permissionLevelResolver?: () => PermissionLevel;
}

/**
 * SDK query options structure â€” directly aliased from the SDK's canonical
 * `Options` type. Aliasing `Options` directly surfaces compile errors when we
 * attempt to set properties that do not exist in the SDK.
 *
 * Subagent visibility flows via two complementary channels, both handled by
 * SdkMessageTransformer:
 *  - the built-in task_* system message stream (task_started / task_progress /
 *    task_updated / task_notification) for the collapsed task-node summary; and
 *  - `forwardSubagentText: true` (a real Option in SDK 0.3.150) which forwards
 *    the full nested subagent conversation (assistant/user text + thinking) as
 *    messages carrying `parent_tool_use_id` = the spawning Task tool_use id.
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
    @inject(AUTH_PROVIDERS_TOKENS.SDK_AUTH_ENV)
    private readonly authEnv: AuthEnv,
    @inject(SDK_TOKENS.SDK_MODEL_SERVICE)
    private readonly modelService: SdkModelService,
    @inject(SDK_TOKENS.SDK_MEMORY_PROMPT_INJECTOR)
    private readonly memoryPromptInjector: MemoryPromptInjector,
    @inject(SDK_TOKENS.SDK_POST_TOOL_USE_HOOK_HANDLER)
    private readonly postToolUseHookHandler: PostToolUseHookHandler,
    @inject(SDK_TOKENS.SDK_USER_PROMPT_SUBMIT_HOOK_HANDLER)
    private readonly userPromptSubmitHookHandler: UserPromptSubmitHookHandler,
    @inject(SDK_TOKENS.SDK_USER_PROMPT_EXPANSION_HOOK_HANDLER)
    private readonly userPromptExpansionHookHandler: UserPromptExpansionHookHandler,
    @inject(SDK_TOKENS.SDK_STOP_HOOK_HANDLER)
    private readonly stopHookHandler: StopHookHandler,
    @inject(SDK_TOKENS.SDK_STOP_FAILURE_HOOK_HANDLER)
    private readonly stopFailureHookHandler: StopFailureHookHandler,
    @inject(SDK_TOKENS.SDK_SESSION_END_HOOK_HANDLER)
    private readonly sessionEndHookHandler: SessionEndHookHandler,
    @inject(SDK_TOKENS.SDK_TOOL_FAILURE_HOOK_HANDLER)
    private readonly toolFailureHookHandler: ToolFailureHookHandler,
    @inject(SDK_TOKENS.SDK_PRE_TOOL_USE_HOOK_HANDLER)
    private readonly preToolUseHookHandler: PreToolUseHookHandler,
    @inject(SDK_TOKENS.SDK_SESSION_START_HOOK_HANDLER)
    private readonly sessionStartHookHandler: SessionStartHookHandler,
    @inject(SDK_TOKENS.SDK_SUBAGENT_STOP_HOOK_HANDLER)
    private readonly subagentStopHookHandler: SubagentStopHookHandler,
    @inject(SDK_TOKENS.SDK_CODE_SYMBOL_PROMPT_INJECTOR, { isOptional: true })
    private readonly codeSymbolPromptInjector?: CodeSymbolPromptInjector,
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
      enableFileCheckpointing,
      includePartialMessages,
      forwardSubagentText,
      mcpServersOverride,
      initialUserQuery,
      authEnvOverride,
      permissionLevelResolver,
    } = input;

    const effectiveAuthEnv: AuthEnv = authEnvOverride ?? this.authEnv;
    if (!sessionConfig?.model) {
      throw new SdkError('Model not provided - ensure SDK is initialized');
    }
    this.warnIfForkOptionsDroppedSilently(input);
    const model = this.modelService.resolveModelId(
      sessionConfig.model,
      authEnvOverride,
    );
    if (!sessionConfig?.projectPath) {
      throw new SdkError(
        'projectPath is required â€” cannot start an SDK session without a workspace folder. ' +
          'Callers must resolve workspace path from IWorkspaceProvider before reaching here.',
      );
    }
    const cwd = sessionConfig.projectPath;
    const envSonnet =
      effectiveAuthEnv.ANTHROPIC_DEFAULT_SONNET_MODEL || 'default';
    const envOpus = effectiveAuthEnv.ANTHROPIC_DEFAULT_OPUS_MODEL || 'default';
    const envHaiku =
      effectiveAuthEnv.ANTHROPIC_DEFAULT_HAIKU_MODEL || 'default';
    this.logger.info(`[SdkQueryOptionsBuilder] SDK call with model: ${model}`, {
      model,
      envSonnet,
      envOpus,
      envHaiku,
      baseUrl: effectiveAuthEnv.ANTHROPIC_BASE_URL || 'default',
    });
    this.validateBaseUrlForProvider(effectiveAuthEnv);
    await this.validateModelAvailability(
      model,
      effectiveAuthEnv,
      this.isProfiledCrossProvider(authEnvOverride),
    );
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
    const systemPrompt = await this.buildSystemPrompt(
      sessionConfig,
      isPremium,
      enhancedPromptsContent,
      mcpServerRunning,
      initialUserQuery,
      cwd,
      effectiveAuthEnv,
    );
    const routingId = sessionConfig?.tabId ?? sessionId;
    const routingSessionId = routingId ? SessionId.safeParse(routingId) : null;
    const routingTabId = sessionConfig?.tabId
      ? TabId.safeParse(sessionConfig.tabId)
      : null;
    if (routingId && routingSessionId === null) {
      this.logger.warn(
        '[SdkQueryOptionsBuilder] Permission routing id is not a UUID â€” falling back to broadcast',
        { routingId },
      );
    }
    if (sessionConfig?.tabId && routingTabId === null) {
      this.logger.warn(
        '[SdkQueryOptionsBuilder] Permission tabId is not a UUID â€” falling back to broadcast',
        { tabId: sessionConfig.tabId },
      );
    }
    const canUseToolCallback: CanUseTool =
      this.permissionHandler.createCallback(
        routingSessionId ?? undefined,
        undefined,
        routingTabId ?? undefined,
        permissionLevelResolver,
      );
    const hooks = this.createHooks(
      cwd,
      sessionId,
      onCompactionStart,
      onWorktreeCreated,
      onWorktreeRemoved,
    );
    const compactionConfig = this.compactionConfigProvider.getConfig();
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
      isPremium,
      mcpEnabled: isPremium,
      hasEnhancedPrompts: !!enhancedPromptsContent,
      pluginCount: pluginPaths?.length ?? 0,
      mcpOverrideKeys: mcpServersOverride
        ? Object.keys(mcpServersOverride)
        : [],
      mcpOverrides: redactMcpOverrideMap(mcpServersOverride),
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
        settings: PTAH_DISABLE_SDK_AUTO_MEMORY,
        tools: {
          type: 'preset' as const,
          preset: 'claude_code' as const,
        },
        mcpServers: this.mergeMcpOverride(
          this.buildMcpServers(isPremium, mcpServerRunning, sessionId),
          mcpServersOverride,
        ),
        permissionMode,
        allowDangerouslySkipPermissions: permissionMode === 'bypassPermissions',
        canUseTool: canUseToolCallback,
        includePartialMessages: includePartialMessages ?? true,
        // Forward the full nested subagent conversation (assistant/user text +
        // thinking) through the message stream. Forwarded messages carry
        // `parent_tool_use_id` = the spawning Task tool_use id, which the
        // message-transform pipeline already propagates onto every emitted event
        // (message_start / text_delta / thinking_delta / message_complete) via
        // `parentToolUseId`, and the streaming transformer keys its per-message
        // state by that same id — so forwarded text is attributed to the correct
        // subagent node without any transform change. Defaults ON (additive to
        // the task_* summary path; does not alter existing tool_use/tool_result
        // subagent handling), but plumbed so a caller can disable it — see the
        // QueryOptionsInput.forwardSubagentText killswitch note.
        forwardSubagentText: forwardSubagentText ?? true,
        settingSources: /^https?:\/\/(127\.0\.0\.1|localhost)/i.test(
          effectiveAuthEnv.ANTHROPIC_BASE_URL?.trim() ?? '',
        )
          ? ['project', 'local']
          : ['user', 'project', 'local'],
        env: {
          ...process.env,
          ...buildTierEnvDefaults(effectiveAuthEnv),
          ...effectiveAuthEnv,
          NO_PROXY: '127.0.0.1,localhost',
          ...experimentalBetaEnv(effectiveAuthEnv.ANTHROPIC_BASE_URL),
          ...this.resolveContextWindowOverride(
            model,
            effectiveAuthEnv.ANTHROPIC_BASE_URL,
          ),
        } as Record<string, string | undefined>,
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
        thinking: sessionConfig?.thinking,
        effort: sessionConfig?.effort,
        pathToClaudeCodeExecutable,
        betas: this.buildBetas(effectiveAuthEnv),
        enableFileCheckpointing: enableFileCheckpointing ?? true,
        ...((enableFileCheckpointing ?? true)
          ? { extraArgs: { 'replay-user-messages': null } }
          : {}),
        forkSession: resumeSessionId ? forkSession : undefined,
      },
    };
  }

  /**
   * Resolve a `CLAUDE_CODE_MAX_CONTEXT_TOKENS` override for proxied providers.
   *
   * The SDK only auto-detects a model's context window for first-party
   * Anthropic base URLs; behind a translation proxy it falls back to a
   * hardcoded 200k window, so auto-compaction triggers at the wrong point
   * (too late for smaller models, which then overflow). When the selected
   * model's real window is known, pin it explicitly so the SDK's
   * auto-compaction threshold tracks the actual model.
   *
   * Skipped for first-party Anthropic (native detection is correct), when the
   * window is unknown (window === 0 → leave the SDK default), and when the
   * value is already set upstream (respect an explicit override).
   */
  private resolveContextWindowOverride(
    model: string,
    baseUrl: string | undefined,
  ): Record<string, string> {
    if (process.env['CLAUDE_CODE_MAX_CONTEXT_TOKENS']) return {};
    const trimmed = baseUrl?.trim();
    const isFirstPartyAnthropic =
      !trimmed || /^https?:\/\/api\.anthropic\.com\/?$/i.test(trimmed);
    if (isFirstPartyAnthropic) return {};
    const window = getModelContextWindow(model);
    if (window <= 0) return {};
    return { CLAUDE_CODE_MAX_CONTEXT_TOKENS: String(window) };
  }

  /**
   * Emit a structured warning when forkSession is requested without a
   * resumeSessionId. Behavior is intentionally preserved (silent drop into
   * `undefined`) â€” but observability is added so misconfigured callers
   * surface in logs instead of silently producing fresh sessions.
   *
   * Called inline below; extracted for readability and to keep the main
   * `build()` flow uncluttered.
   */
  private warnIfForkOptionsDroppedSilently(input: QueryOptionsInput): void {
    const { resumeSessionId, forkSession, sessionId } = input;
    if (resumeSessionId) return;
    if (forkSession === undefined) return;
    this.logger.warn(
      '[SdkQueryOptionsBuilder] forkSession was set without a resumeSessionId â€” the option will be dropped because it only applies to resumed sessions.',
      {
        sessionId: sessionId ? `${sessionId.slice(0, 8)}...` : undefined,
        hasForkSession: forkSession !== undefined,
        forkSession,
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
   * endpoint. If the strategy's `configure()` never ran â€” typically because the
   * user hasn't selected the provider yet â€” `ANTHROPIC_BASE_URL` stays empty
   * while the placeholder token remains, and the SDK silently falls back to
   * api.anthropic.com. Anthropic rejects/drops the request and the UI hangs.
   *
   * Throw here so the error surfaces to the UI with clear remediation.
   */
  private validateBaseUrlForProvider(authEnvOverride?: AuthEnv): void {
    const env: AuthEnv = authEnvOverride ?? this.authEnv;
    const baseUrl = env.ANTHROPIC_BASE_URL?.trim();
    const authToken = env.ANTHROPIC_AUTH_TOKEN;

    if (baseUrl) {
      return;
    }
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
        `Provider '${providerName}' is not configured â€” ANTHROPIC_BASE_URL is missing. ` +
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
   * Whether a per-session `authEnvOverride` (from a `ProviderProfile`) points at
   * a DIFFERENT provider than the process-global active provider — detected by
   * comparing normalized `ANTHROPIC_BASE_URL`s. Base URL is the reliable signal
   * across all provider families (direct Anthropic, native third-party like
   * Ollama Cloud, and translation-proxy endpoints), whereas `getActiveProviderId`
   * returns null for some direct/local endpoints. When true, the global model
   * cache does not describe the session's provider and the pre-flight is skipped.
   */
  private isProfiledCrossProvider(authEnvOverride?: AuthEnv): boolean {
    if (!authEnvOverride) {
      return false;
    }
    const normalize = (url: string | undefined): string =>
      (url ?? '').trim().replace(/\/+$/, '').toLowerCase();
    return (
      normalize(authEnvOverride.ANTHROPIC_BASE_URL) !==
      normalize(this.authEnv.ANTHROPIC_BASE_URL)
    );
  }

  /**
   * Cache-only pre-flight check that the resolved model ID is in the
   * third-party provider's advertised list. No-op for direct Anthropic connections.
   *
   * @throws ModelNotAvailableError when the model is absent from the cached list
   */
  private async validateModelAvailability(
    resolvedModel: string,
    authEnvOverride?: AuthEnv,
    skipCrossProvider = false,
  ): Promise<void> {
    // A profiled session whose provider differs from the process-global active
    // provider must NOT be validated against the global provider's model cache
    // — that cache belongs to a different provider and would spuriously reject
    // a model that is valid for the session's own provider (the reported
    // ModelNotAvailableError). Trust the model resolved from the profile's
    // persisted tiers instead. The global (non-profiled) path keeps the
    // pre-flight so stale-selection detection still works there.
    if (skipCrossProvider) {
      this.logger.debug(
        '[SdkQueryOptionsBuilder] Skipping model pre-flight: profiled session targets a different provider than the global active provider',
        { resolvedModel },
      );
      return;
    }
    const env: AuthEnv = authEnvOverride ?? this.authEnv;
    const baseUrl = env.ANTHROPIC_BASE_URL?.trim();
    const isDirectAnthropic =
      !baseUrl || /^https?:\/\/api\.anthropic\.com\/?$/i.test(baseUrl);
    if (isDirectAnthropic) {
      return;
    }
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
      this.logger.warn(
        '[SdkQueryOptionsBuilder] Model pre-flight: getSupportedModels() threw â€” skipping check',
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
   * Opus and Sonnet 4.6 models. The SDK module does NOT auto-enable this â€” we
   * must pass it explicitly via the `betas` query option.
   *
   * Skipped for third-party providers (OpenRouter, Moonshot, Z.AI, proxies) as
   * they don't support Anthropic beta headers and would return 400 errors.
   *
   * @returns Array of beta strings, or undefined if no betas should be sent
   */
  private buildBetas(authEnvOverride?: AuthEnv): SdkBeta[] | undefined {
    const env: AuthEnv = authEnvOverride ?? this.authEnv;
    const baseUrl = env.ANTHROPIC_BASE_URL?.trim();
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
   * Always uses SDK's `claude_code` preset as base (provides MCP handling, tool routing,
   * environment context). For premium users, appends PTAH_CORE_SYSTEM_PROMPT with
   * Ptah-specific MCP mandates, orchestration, and formatting rules. Enhanced prompts
   * (project-specific guidance) are also appended when available.
   * Memory recall block injected for premium users with a non-empty initialUserQuery.
   *
   * @param sessionConfig - Session configuration with optional custom system prompt and preset selection
   * @param isPremium - Whether user has premium features enabled
   * @param enhancedPromptsContent - Optional AI-generated guidance from EnhancedPromptsService
   * @param mcpServerRunning - Whether MCP server is running
   * @param initialUserQuery - First user message text for memory recall
   * @param cwd - Workspace root for workspace-scoped memory recall
   * @returns System prompt configuration for SDK (always preset+append)
   */
  private async buildSystemPrompt(
    sessionConfig?: AISessionConfig,
    isPremium = false,
    enhancedPromptsContent?: string,
    mcpServerRunning = true,
    initialUserQuery?: string,
    cwd?: string,
    authEnvOverride?: AuthEnv,
  ): Promise<SdkQueryOptions['systemPrompt']> {
    const effectiveAuthEnv: AuthEnv = authEnvOverride ?? this.authEnv;
    const activeProviderId = getActiveProviderId(effectiveAuthEnv);

    if (activeProviderId) {
      this.logger.info(
        `[SdkQueryOptionsBuilder] Third-party provider detected (${activeProviderId}) - adding identity clarification`,
      );
    }

    const result = assembleSystemPrompt({
      providerId: activeProviderId,
      authEnv: effectiveAuthEnv,
      userSystemPrompt: sessionConfig?.systemPrompt,
      isPremium,
      mcpServerRunning,
      enhancedPromptsContent,
      preset: sessionConfig?.preset,
    });
    let sessionStartBlock = '';
    if (isPremium && cwd) {
      sessionStartBlock =
        await this.memoryPromptInjector.buildSessionStartBlock(cwd);
    }
    let corpusPrimeBlock = '';
    const corpusName = sessionConfig?.corpusName?.trim();
    if (isPremium && corpusName) {
      corpusPrimeBlock =
        await this.memoryPromptInjector.buildCorpusBlock(corpusName);
    }
    let memoryBlock = '';
    if (isPremium && initialUserQuery?.trim()) {
      memoryBlock = await this.memoryPromptInjector.buildBlock(
        initialUserQuery,
        cwd,
      );
    }
    let codeSymbolBlock = '';
    if (
      isPremium &&
      initialUserQuery?.trim() &&
      this.codeSymbolPromptInjector
    ) {
      codeSymbolBlock = await this.codeSymbolPromptInjector.buildBlock(
        initialUserQuery,
        cwd,
      );
    }
    const finalContentJoined = [
      sessionStartBlock,
      corpusPrimeBlock,
      memoryBlock,
      codeSymbolBlock,
      result.content ?? '',
    ]
      .filter((p) => p.length > 0)
      .join('\n\n');
    const finalContent =
      finalContentJoined.length > 0 ? finalContentJoined : undefined;

    this.logger.info('[SdkQueryOptionsBuilder] System prompt assembled', {
      isPremium,
      mcpServerRunning,
      mode: 'preset-append',
      hasEnhancedPrompts: !!enhancedPromptsContent,
      enhancedPromptsLength: enhancedPromptsContent?.length ?? 0,
      hasPtahCorePrompt: isPremium,
      hasIdentityPrompt: !!activeProviderId,
      hasUserSystemPrompt: !!sessionConfig?.systemPrompt,
      hasSessionStartBlock: !!sessionStartBlock,
      sessionStartBlockLength: sessionStartBlock.length,
      hasCorpusPrimeBlock: !!corpusPrimeBlock,
      corpusPrimeBlockLength: corpusPrimeBlock.length,
      hasMemoryBlock: !!memoryBlock,
      memoryBlockLength: memoryBlock.length,
      hasCodeSymbolBlock: !!codeSymbolBlock,
      codeSymbolBlockLength: codeSymbolBlock.length,
      totalAppendLength: finalContent?.length ?? 0,
    });
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
      mcpUrl: redactMcpUrl(mcpConfig.ptah.url),
    });
    return mcpConfig;
  }

  /**
   * Merge caller-supplied MCP HTTP overrides over the registry-built map.
   * Caller wins on key collision (matches the proxy tool-merger contract).
   *
   * Returns the original `base` reference unchanged when `override` is
   * `undefined` or empty â€” preserves identity for the existing chat path so
   * the merge is a no-op on every non-proxy call site.
   */
  private mergeMcpOverride(
    base: Record<string, McpHttpServerConfig>,
    override: Record<string, McpHttpServerOverride> | undefined,
  ): Record<string, McpHttpServerConfig> {
    if (!override || Object.keys(override).length === 0) {
      return base;
    }
    return { ...base, ...(override as Record<string, McpHttpServerConfig>) };
  }

  /**
   * Calculate max turns from session config.
   *
   * Safety limit: returns a default cap when no explicit maxTokens is set.
   * Without this, the SDK runs unlimited agentic turns â€” each turn is an
   * API round-trip that consumes provider quota. On metered providers like
   * Copilot (premium requests) or pay-per-token APIs, runaway sessions can
   * exhaust budgets quickly.
   *
   * Default: 200 turns â€” generous enough for complex multi-step tasks,
   * but prevents infinite loops from burning through quota.
   */
  private calculateMaxTurns(
    sessionConfig?: AISessionConfig,
  ): number | undefined {
    if (sessionConfig?.maxTokens) {
      return Math.floor(sessionConfig.maxTokens / 1000);
    }
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
    const subagentHooks = this.subagentHookHandler.createHooks(cwd, sessionId);
    const compactionHooks = this.compactionHookHandler.createHooks(
      sessionId ?? '',
      cwd,
      onCompactionStart,
    );

    const worktreeHooks = this.worktreeHookHandler.createHooks(
      onWorktreeCreated,
      onWorktreeRemoved,
    );
    const postToolUseHooks = this.postToolUseHookHandler.createHooks(
      sessionId ?? '',
      cwd,
    );
    const userPromptSubmitHooks = this.userPromptSubmitHookHandler.createHooks(
      sessionId ?? '',
      cwd,
    );
    const userPromptExpansionHooks =
      this.userPromptExpansionHookHandler.createHooks(sessionId ?? '', cwd);
    const stopHooks = this.stopHookHandler.createHooks(sessionId ?? '', cwd);
    const stopFailureHooks = this.stopFailureHookHandler.createHooks(
      sessionId ?? '',
      cwd,
    );
    const sessionEndHooks = this.sessionEndHookHandler.createHooks(
      sessionId ?? '',
      cwd,
    );
    const toolFailureHooks = this.toolFailureHookHandler.createHooks(
      sessionId ?? '',
      cwd,
    );
    const preToolUseHooks = this.preToolUseHookHandler.createHooks(
      sessionId ?? '',
      cwd,
    );
    const sessionStartHooks = this.sessionStartHookHandler.createHooks(
      sessionId ?? '',
      cwd,
    );
    const subagentStopHooks = this.subagentStopHookHandler.createHooks(
      sessionId ?? '',
      cwd,
    );
    const mergedHooks: Partial<Record<HookEvent, HookCallbackMatcher[]>> = {};
    for (const hooks of [
      subagentHooks,
      compactionHooks,
      worktreeHooks,
      postToolUseHooks,
      userPromptSubmitHooks,
      userPromptExpansionHooks,
      stopHooks,
      stopFailureHooks,
      sessionEndHooks,
      toolFailureHooks,
      preToolUseHooks,
      sessionStartHooks,
      subagentStopHooks,
    ]) {
      for (const [event, matchers] of Object.entries(hooks)) {
        const key = event as HookEvent;
        mergedHooks[key] = [...(mergedHooks[key] || []), ...matchers];
      }
    }
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
