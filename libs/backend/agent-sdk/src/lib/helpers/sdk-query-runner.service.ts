/**
 * SdkQueryRunner â€” unified SDK query invocation primitive.
 *
 * Reconciles the previously-forked one-shot (InternalQueryService) and
 * interactive (SessionLifecycleManager â†’ SessionQueryExecutor) paths under a
 * single `run({ mode })` discriminator.
 *
 * Modes:
 *   - `oneShot`   â€” single-string prompt, bypassPermissions, no canUseTool,
 *                   maxTurns explicit, persistSession=false, subagent +
 *                   compaction hooks wired, identity prompt + PTAH_CORE
 *                   appended for premium. Used by `InternalQueryService`.
 *   - `interactive` â€” caller pre-builds `Options` via `SdkQueryOptionsBuilder`
 *                   and hands them in along with the iterable/string prompt
 *                   plus the optional `warmQuery` handle. The runner only owns
 *                   `moduleLoader.getQueryFunction()` + `queryFn(...)` +
 *                   warm-query short-circuit. Session-registry / streamInput /
 *                   slash-command orchestration stays on `SessionQueryExecutor`.
 *
 * "Enhanced prompts never resolve here" invariant preserved: `enhancedPromptsContent`
 * is INPUT-ONLY on the interactive branch and IS NOT ACCEPTED on the oneShot
 * branch â€” the runner never imports `EnhancedPromptsService`.
 *
 * Compaction hook conditionality: oneShot wires compaction hooks (preserves the
 * pre-refactor InternalQueryService behaviour). Interactive option construction
 * happens INSIDE `SdkQueryOptionsBuilder` (not here) and is unaffected.
 */

import { injectable, inject } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import type { AuthEnv } from '@ptah-extension/shared';
import { SDK_TOKENS } from '../di/tokens';
import { AUTH_PROVIDERS_TOKENS } from '@ptah-extension/auth-providers-tokens';
import { SdkError } from '../errors';
import { SdkModuleLoader } from './sdk-module-loader';
import { SdkModelService, buildTierEnvDefaults } from './sdk-model-service';
import { SdkRuntimeStateService } from './sdk-runtime-state.service';
import { SubagentHookHandler } from './subagent-hook-handler';
import { CompactionConfigProvider } from './compaction-config-provider';
import { CompactionHookHandler } from './compaction-hook-handler';
import { PostToolUseHookHandler } from './post-tool-use-hook-handler';
import { UserPromptSubmitHookHandler } from './user-prompt-submit-hook-handler';
import {
  getAnthropicProvider,
  ANTHROPIC_PROVIDERS,
} from '@ptah-extension/shared';
import { PTAH_CORE_SYSTEM_PROMPT } from '../prompt-harness';
import {
  Options as SdkQueryOptions,
  HookEvent,
  HookCallbackMatcher,
  McpHttpServerConfig,
  OutputFormat,
  SDKMessage,
  SDKUserMessage,
  QueryFunction,
} from '../types/sdk-types/claude-sdk.types';
import type { Query } from './session-lifecycle-manager';
import { PTAH_MCP_PORT } from '../constants';

const SERVICE_TAG = '[SdkQueryRunner]';
const DEFAULT_ONE_SHOT_MAX_TURNS = 25;

export interface OneShotAuthOverride {
  readonly env: AuthEnv;
  readonly baseUrl?: string;
}

export interface OneShotRunInput {
  mode: 'oneShot';
  cwd: string;
  model: string;
  prompt: string;
  systemPromptAppend?: string;
  isPremium: boolean;
  mcpServerRunning: boolean;
  mcpPort?: number;
  maxTurns?: number;
  outputFormat?: OutputFormat;
  abortController?: AbortController;
  pluginPaths?: string[];
  auth?: OneShotAuthOverride;
}

export interface OneShotRunResult {
  stream: AsyncIterable<SDKMessage>;
  abort(): void;
  close(): void;
}

export interface InteractiveRunInput {
  mode: 'interactive';
  prompt: string | AsyncIterable<SDKUserMessage>;
  options: SdkQueryOptions;
  warmQuery?: { close: () => void; query?: unknown } | null;
}

export interface InteractiveRunResult {
  sdkQuery: Query;
  usedWarmQuery: boolean;
}

@injectable()
export class SdkQueryRunner {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SDK_TOKENS.SDK_RUNTIME_STATE)
    private readonly runtimeState: SdkRuntimeStateService,
    @inject(SDK_TOKENS.SDK_MODULE_LOADER)
    private readonly moduleLoader: SdkModuleLoader,
    @inject(SDK_TOKENS.SDK_SUBAGENT_HOOK_HANDLER)
    private readonly subagentHookHandler: SubagentHookHandler,
    @inject(SDK_TOKENS.SDK_COMPACTION_CONFIG_PROVIDER)
    private readonly compactionConfigProvider: CompactionConfigProvider,
    @inject(SDK_TOKENS.SDK_COMPACTION_HOOK_HANDLER)
    private readonly compactionHookHandler: CompactionHookHandler,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_AUTH_ENV)
    private readonly authEnv: AuthEnv,
    @inject(SDK_TOKENS.SDK_MODEL_SERVICE)
    private readonly modelService: SdkModelService,
    @inject(SDK_TOKENS.SDK_POST_TOOL_USE_HOOK_HANDLER)
    private readonly postToolUseHookHandler: PostToolUseHookHandler,
    @inject(SDK_TOKENS.SDK_USER_PROMPT_SUBMIT_HOOK_HANDLER)
    private readonly userPromptSubmitHookHandler: UserPromptSubmitHookHandler,
  ) {}

  async runOneShot(input: OneShotRunInput): Promise<OneShotRunResult> {
    const cliJsPath =
      this.runtimeState.getCliJsPath() ??
      (await this.moduleLoader.getCliJsPath());

    this.logger.info(`${SERVICE_TAG} Starting internal query`, {
      cwd: input.cwd,
      model: input.model,
      isPremium: input.isPremium,
      mcpServerRunning: input.mcpServerRunning,
      mcpPort: input.mcpPort,
      maxTurns: input.maxTurns ?? DEFAULT_ONE_SHOT_MAX_TURNS,
      hasSystemPromptAppend: !!input.systemPromptAppend,
      hasPlugins: (input.pluginPaths?.length ?? 0) > 0,
      pluginCount: input.pluginPaths?.length ?? 0,
      cliJsPath: cliJsPath ?? 'NOT_RESOLVED',
    });

    this.verifyHealth();

    const queryFn = await this.moduleLoader.getQueryFunction();
    const abortController = input.abortController ?? new AbortController();
    const options = this.buildOneShotOptions(input, abortController, cliJsPath);

    const systemPromptObj =
      typeof options.systemPrompt === 'object' &&
      !Array.isArray(options.systemPrompt)
        ? options.systemPrompt
        : undefined;

    this.logger.info(`${SERVICE_TAG} SDK options built â€” launching query`, {
      model: input.model,
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
      promptLength: input.prompt.length,
    });

    const queryStartMs = Date.now();
    const conversation = queryFn({
      prompt: input.prompt,
      options,
    });

    this.logger.info(
      `${SERVICE_TAG} SDK query() returned conversation handle in ${Date.now() - queryStartMs}ms`,
    );

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

  async runInteractive(
    input: InteractiveRunInput,
  ): Promise<InteractiveRunResult> {
    const queryFn = await this.moduleLoader.getQueryFunction();
    return this.invokeQueryWithWarmFallback(
      queryFn,
      input.prompt,
      input.options,
      input.warmQuery ?? null,
    );
  }

  invokeWithLoadedQuery(
    queryFn: QueryFunction,
    prompt: string | AsyncIterable<SDKUserMessage>,
    options: SdkQueryOptions,
    warmQuery: { close: () => void; query?: unknown } | null,
  ): InteractiveRunResult {
    return this.invokeQueryWithWarmFallback(
      queryFn,
      prompt,
      options,
      warmQuery,
    );
  }

  private invokeQueryWithWarmFallback(
    queryFn: QueryFunction,
    prompt: string | AsyncIterable<SDKUserMessage>,
    options: SdkQueryOptions,
    warmQuery: { close: () => void; query?: unknown } | null,
  ): InteractiveRunResult {
    let sdkQuery: Query;
    let usedWarmQuery = false;

    if (
      warmQuery &&
      typeof (warmQuery as { query?: unknown }).query === 'function'
    ) {
      try {
        const warmQueryFn = (
          warmQuery as unknown as {
            query: (prompt: string | AsyncIterable<SDKUserMessage>) => Query;
          }
        ).query;
        sdkQuery = warmQueryFn(prompt);
        usedWarmQuery = true;
      } catch (warmErr) {
        this.logger.warn(
          `${SERVICE_TAG} warmQuery.query() threw â€” falling back to fresh query`,
          warmErr instanceof Error ? warmErr : new Error(String(warmErr)),
        );

        warmQuery.close();
        sdkQuery = queryFn({
          prompt,
          options,
        });
      }
    } else {
      sdkQuery = queryFn({
        prompt,
        options,
      });
    }

    return { sdkQuery, usedWarmQuery };
  }

  private verifyHealth(): void {
    const health = this.runtimeState.getHealth();
    if (health.status !== 'available') {
      throw new SdkError(
        `SDK not available (status: ${health.status}). ${
          health.errorMessage || ''
        }`,
      );
    }
  }

  private buildOneShotOptions(
    input: OneShotRunInput,
    abortController: AbortController,
    cliJsPath: string | null,
  ): SdkQueryOptions {
    const authEnv = input.auth?.env ?? this.authEnv;
    const effectiveBaseUrl =
      input.auth?.baseUrl ??
      input.auth?.env.ANTHROPIC_BASE_URL ??
      authEnv.ANTHROPIC_BASE_URL;

    const systemPrompt = this.buildOneShotSystemPrompt(input, authEnv);

    const mcpServers = this.buildOneShotMcpServers(
      input.isPremium,
      input.mcpServerRunning,
      input.mcpPort,
    );

    const hooks = this.buildOneShotHooks(input.cwd);

    const compactionConfig = this.compactionConfigProvider.getConfig();
    this.logger.debug(
      `${SERVICE_TAG} Compaction config: enabled=${compactionConfig.enabled}, threshold=${compactionConfig.contextTokenThreshold} (managed via hooks)`,
    );

    const resolvedModel = this.modelService.resolveModelId(input.model);

    const options: SdkQueryOptions = {
      abortController,
      cwd: input.cwd,
      model: resolvedModel,
      systemPrompt,
      tools: {
        type: 'preset',
        preset: 'claude_code',
      },
      mcpServers,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      maxTurns: input.maxTurns ?? DEFAULT_ONE_SHOT_MAX_TURNS,
      includePartialMessages: true,
      persistSession: false,
      pathToClaudeCodeExecutable: cliJsPath || undefined,
      env: {
        ...process.env,
        ...buildTierEnvDefaults(authEnv),
        ...authEnv,
        NO_PROXY: '127.0.0.1,localhost',
        ...(() => {
          const baseUrl = effectiveBaseUrl?.trim();
          return baseUrl &&
            !/^https?:\/\/api\.anthropic\.com\/?$/i.test(baseUrl)
            ? { CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: '1' }
            : {};
        })(),
      } as Record<string, string | undefined>,
      settingSources: effectiveBaseUrl?.includes('127.0.0.1')
        ? ['project', 'local']
        : ['user', 'project', 'local'],
      stderr: (data: string) => {
        if (data.includes('[ERROR]')) {
          this.logger.error(`${SERVICE_TAG} SDK stderr: ${data}`);
        } else if (data.includes('[WARN]')) {
          this.logger.warn(`${SERVICE_TAG} SDK stderr: ${data}`);
        } else {
          this.logger.info(`${SERVICE_TAG} SDK stderr: ${data}`);
        }
      },
      hooks,
    };

    if (input.outputFormat) {
      options.outputFormat = input.outputFormat;
    }

    return options;
  }

  private buildOneShotSystemPrompt(
    input: OneShotRunInput,
    authEnv: AuthEnv = this.authEnv,
  ): {
    type: 'preset';
    preset: 'claude_code';
    append?: string;
  } {
    const appendParts: string[] = [];

    const identityPrompt = this.buildOneShotIdentityPrompt(authEnv);
    if (identityPrompt) {
      appendParts.push(identityPrompt);
      this.logger.debug(
        `${SERVICE_TAG} Added identity prompt for third-party provider`,
      );
    }

    if (input.isPremium) {
      appendParts.push(PTAH_CORE_SYSTEM_PROMPT);
      this.logger.debug(
        `${SERVICE_TAG} Using PTAH_CORE_SYSTEM_PROMPT for internal query`,
      );
    }

    if (input.systemPromptAppend) {
      appendParts.push(input.systemPromptAppend);
    }

    return {
      type: 'preset',
      preset: 'claude_code',
      append: appendParts.length > 0 ? appendParts.join('\n\n') : undefined,
    };
  }

  private buildOneShotIdentityPrompt(
    authEnv: AuthEnv = this.authEnv,
  ): string | undefined {
    const baseUrl = authEnv.ANTHROPIC_BASE_URL;
    if (!baseUrl || baseUrl.includes('api.anthropic.com')) {
      return undefined;
    }

    for (const id of ANTHROPIC_PROVIDERS.map((p) => p.id)) {
      const provider = getAnthropicProvider(id);
      if (!provider || !provider.baseUrl) continue;
      try {
        if (baseUrl.includes(new URL(provider.baseUrl).hostname)) {
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
      } catch {
        continue;
      }
    }

    return undefined;
  }

  private buildOneShotMcpServers(
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

  private buildOneShotHooks(
    cwd: string,
  ): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
    const subagentHooks = this.subagentHookHandler.createHooks(cwd);
    const oneShotSessionId = `internal-query-${Date.now()}`;
    const compactionHooks = this.compactionHookHandler.createHooks(
      oneShotSessionId,
      cwd,
    );
    const postToolUseHooks = this.postToolUseHookHandler.createHooks(
      oneShotSessionId,
      cwd,
    );
    const userPromptSubmitHooks = this.userPromptSubmitHookHandler.createHooks(
      oneShotSessionId,
      cwd,
    );

    const mergedHooks: Partial<Record<HookEvent, HookCallbackMatcher[]>> = {};
    for (const hooks of [
      subagentHooks,
      compactionHooks,
      postToolUseHooks,
      userPromptSubmitHooks,
    ]) {
      for (const [event, matchers] of Object.entries(hooks)) {
        const key = event as HookEvent;
        mergedHooks[key] = [...(mergedHooks[key] || []), ...matchers];
      }
    }

    return mergedHooks;
  }
}
