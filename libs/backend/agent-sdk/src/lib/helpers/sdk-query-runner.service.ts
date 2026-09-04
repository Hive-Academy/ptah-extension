/**
 * SdkQueryRunner — unified SDK query invocation primitive.
 *
 * Reconciles the previously-forked one-shot (InternalQueryService) and
 * interactive (SessionLifecycleManager → SessionQueryExecutor) paths under a
 * single `run({ mode })` discriminator.
 *
 * Modes:
 *   - `oneShot`   — single-string prompt, bypassPermissions, no canUseTool,
 *                   maxTurns explicit, persistSession=false, subagent hooks
 *                   wired, identity prompt + PTAH_CORE appended. Used by
 *                   `InternalQueryService`.
 *   - `interactive` — caller pre-builds `Options` via `SdkQueryOptionsBuilder`
 *                   and hands them in along with the iterable/string prompt.
 *                   The runner only owns `moduleLoader.getQueryFunction()` +
 *                   `queryFn(...)`. Session-registry / streamInput /
 *                   slash-command orchestration stays on `SessionQueryExecutor`.
 *
 * "Enhanced prompts never resolve here" invariant preserved: `enhancedPromptsContent`
 * is INPUT-ONLY on the interactive branch and IS NOT ACCEPTED on the oneShot
 * branch — the runner never imports `EnhancedPromptsService`.
 *
 * Compaction hooks: oneShot does NOT wire them (TASK_2026_376 finding 4).
 * `buildOneShotHooks`'s synthetic session id never names a real Ptah session,
 * so the registry fan-out this hook would otherwise trigger can never resolve
 * a transcript for any one-shot caller — see that method's doc comment.
 * Interactive option construction happens INSIDE `SdkQueryOptionsBuilder` (not
 * here) and is unaffected; it wires the same `CompactionHookHandler` against a
 * real session id.
 */

import * as os from 'os';
import { injectable, inject } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import type { AuthEnv } from '@ptah-extension/shared';
import {
  PLATFORM_TOKENS,
  isUnsafeWorkspacePath,
  type IPlatformInfo,
} from '@ptah-extension/platform-core';
import { SDK_TOKENS } from '../di/tokens';
import { AUTH_PROVIDERS_TOKENS } from '@ptah-extension/auth-providers-tokens';
import { SdkError } from '../errors';
import { SdkModuleLoader } from './sdk-module-loader';
import { SdkModelService, buildTierEnvDefaults } from './sdk-model-service';
import { SdkRuntimeStateService } from './sdk-runtime-state.service';
import { SubagentHookHandler } from './subagent-hook-handler';
import { CompactionConfigProvider } from './compaction-config-provider';
import { OffThreadProcessSpawner } from './off-thread-process-spawner';
import {
  buildModelIdentityPrompt,
  getActiveProviderId,
} from './sdk-query-options-builder';
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
import { PTAH_MCP_PORT, PTAH_DISABLE_SDK_AUTO_MEMORY } from '../constants';

const SERVICE_TAG = '[SdkQueryRunner]';
const DEFAULT_ONE_SHOT_MAX_TURNS = 25;

/**
 * Above this, the synchronous part of `query()` is a main-thread stall worth
 * reporting, not a launch.
 *
 * `query()` is synchronous all the way down to `child_process.spawn`, and on
 * Windows that spawn blocks the calling thread for as long as the OS takes to
 * scan the image — ~1.6 s for the 253 MB `claude.exe`. Ten boot-time one-shot
 * queries each produced an `[event-loop] lag` line matching their own launch
 * duration to within ~10 ms (TASK_2026_341). `OffThreadProcessSpawner` moves
 * the spawn onto a worker; this guard is what tells us if anything ever puts it
 * back — a regression here is invisible in a unit test and expensive in Electron.
 */
const QUERY_LAUNCH_BLOCK_WARN_MS = 100;

/**
 * Env keys that together name ONE provider. They are mutually exclusive: a
 * bearer token and an API key belong to different backends, and inheriting one
 * while the other is overridden points the run at neither cleanly.
 */
const PROVIDER_IDENTITY_ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
] as const;

/**
 * Blank out ambient provider credentials a one-shot override does not itself
 * set.
 *
 * `options.env` starts from `process.env`, and the interactive chat session
 * writes its own credentials there — `OAuthProxyStrategy` assigns
 * `process.env.ANTHROPIC_AUTH_TOKEN` when Codex or Copilot is active. Without
 * this, a one-shot that overrides to an API-key provider still receives the
 * chat session's proxy token and can be routed to the wrong backend entirely.
 *
 * Only keys the ambient env actually carries are emitted, so the resulting key
 * SET is unchanged — the override path stays byte-comparable with the
 * no-override path, which `sdk-query-runner.service.spec.ts` pins.
 */
function clearLeakedProviderIdentity(
  ambient: NodeJS.ProcessEnv,
  override: AuthEnv,
): Record<string, undefined> {
  const cleared: Record<string, undefined> = {};
  for (const key of PROVIDER_IDENTITY_ENV_KEYS) {
    if (override[key] === undefined && ambient[key] !== undefined) {
      cleared[key] = undefined;
    }
  }
  return cleared;
}

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
  mcpServerRunning: boolean;
  mcpPort?: number;
  maxTurns?: number;
  outputFormat?: OutputFormat;
  abortController?: AbortController;
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
}

export interface InteractiveRunResult {
  sdkQuery: Query;
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
    @inject(AUTH_PROVIDERS_TOKENS.SDK_AUTH_ENV)
    private readonly authEnv: AuthEnv,
    @inject(SDK_TOKENS.SDK_MODEL_SERVICE)
    private readonly modelService: SdkModelService,
    @inject(PLATFORM_TOKENS.PLATFORM_INFO)
    private readonly platformInfo: IPlatformInfo,
    @inject(SDK_TOKENS.SDK_PROCESS_SPAWNER)
    private readonly processSpawner: OffThreadProcessSpawner,
  ) {}

  /**
   * Route the SDK's CLI spawn through {@link OffThreadProcessSpawner}.
   *
   * `spawnClaudeCodeProcess` is the SDK's only public seam for this, and it is
   * set here — on the ONE funnel both the one-shot and the interactive launch
   * pass through — rather than in `SdkQueryOptionsBuilder`, so a caller that
   * builds its own options still gets the fix.
   *
   * A caller-supplied spawner always wins: a host running the CLI in a VM or
   * container has already answered this question, and overriding it would
   * silently move its process back onto the local machine.
   *
   * `options.stderr` is handed down explicitly because the SDK only pipes and
   * forwards stderr inside its own `spawnLocalProcess`; supplying a custom
   * spawner skips that wiring entirely.
   */
  private useOffThreadSpawner(options: SdkQueryOptions): void {
    if (options.spawnClaudeCodeProcess) return;
    const onStderr = options.stderr;
    options.spawnClaudeCodeProcess = (spawnOptions) =>
      this.processSpawner.spawn(spawnOptions, onStderr ? { onStderr } : {});
  }

  /**
   * Run the synchronous half of a query launch and report it if it stalls.
   *
   * The whole point of this task: `queryFn(...)` is not awaited anywhere,
   * because there is nothing async about it — whatever it costs, it costs on
   * this thread.
   */
  private launch<T>(mode: 'oneShot' | 'interactive', invoke: () => T): T {
    const startedAt = Date.now();
    const result = invoke();
    const blockedMs = Date.now() - startedAt;
    if (blockedMs > QUERY_LAUNCH_BLOCK_WARN_MS) {
      this.logger.warn(`${SERVICE_TAG} query() blocked the event loop`, {
        blockedMs,
        mode,
      });
    }
    return result;
  }

  private resolveSafeCwd(requested: string): string {
    const safety = isUnsafeWorkspacePath(requested, this.platformInfo);
    if (safety.ok) return requested;
    const home = os.homedir();
    const fallback = isUnsafeWorkspacePath(home, this.platformInfo).ok
      ? home
      : os.tmpdir();
    this.logger.warn(
      `${SERVICE_TAG} Unsafe one-shot cwd rewritten to ${fallback} — ${safety.reason}`,
      { requested, fallback },
    );
    return fallback;
  }

  async runOneShot(rawInput: OneShotRunInput): Promise<OneShotRunResult> {
    const input: OneShotRunInput = {
      ...rawInput,
      cwd: this.resolveSafeCwd(rawInput.cwd),
    };
    const cliJsPath =
      this.runtimeState.getCliJsPath() ??
      (await this.moduleLoader.getCliJsPath());

    this.logger.info(`${SERVICE_TAG} Starting internal query`, {
      cwd: input.cwd,
      model: input.model,
      mcpServerRunning: input.mcpServerRunning,
      mcpPort: input.mcpPort,
      maxTurns: input.maxTurns ?? DEFAULT_ONE_SHOT_MAX_TURNS,
      hasSystemPromptAppend: !!input.systemPromptAppend,
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

    this.logger.info(`${SERVICE_TAG} SDK options built — launching query`, {
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
    const conversation = this.launch('oneShot', () =>
      queryFn({
        prompt: input.prompt,
        options,
      }),
    );

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
    return this.invokeWithLoadedQuery(queryFn, input.prompt, input.options);
  }

  invokeWithLoadedQuery(
    queryFn: QueryFunction,
    prompt: string | AsyncIterable<SDKUserMessage>,
    options: SdkQueryOptions,
  ): InteractiveRunResult {
    this.useOffThreadSpawner(options);
    const sdkQuery = this.launch('interactive', () =>
      queryFn({ prompt, options }),
    );
    return { sdkQuery };
  }

  /**
   * Whether a one-shot query can be ATTEMPTED in this process at all.
   *
   * `false` only on a host that never initialized the SDK — see
   * `SdkRuntimeStateService.hasInitialized`. It is the cheap pre-check for
   * {@link verifyHealth}'s hardest case: that guard throws an `SdkError` on
   * `status: 'initializing'`, and a caller that cannot import `SdkError`
   * (`skill-synthesis` keeps zero SDK imports) can only read that throw as a
   * transport fault and retry it forever against a host that will never have an
   * LLM. Asking first is what lets such a caller answer "not here" instead.
   */
  isInitialized(): boolean {
    return this.runtimeState.hasInitialized();
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

    // Resolved against the SAME authEnv the SDK will run with (the one-shot
    // override when present), so `options.model`, `options.env` and the
    // identity clarification all name one model.
    const resolvedModel = this.modelService.resolveModelId(
      input.model,
      input.auth?.env,
    );

    const systemPrompt = this.buildOneShotSystemPrompt(
      input,
      authEnv,
      resolvedModel,
    );

    const mcpServers = this.buildOneShotMcpServers(
      input.mcpServerRunning,
      input.mcpPort,
    );

    const hooks = this.buildOneShotHooks(input.cwd);

    const compactionConfig = this.compactionConfigProvider.getConfig();
    this.logger.debug(
      `${SERVICE_TAG} Compaction config: enabled=${compactionConfig.enabled}, threshold=${compactionConfig.contextTokenThreshold} (managed via hooks)`,
    );

    const options: SdkQueryOptions = {
      abortController,
      cwd: input.cwd,
      model: resolvedModel,
      systemPrompt,
      settings: PTAH_DISABLE_SDK_AUTO_MEMORY,
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
        ...(input.auth
          ? clearLeakedProviderIdentity(process.env, input.auth.env)
          : {}),
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

    this.useOffThreadSpawner(options);

    return options;
  }

  private buildOneShotSystemPrompt(
    input: OneShotRunInput,
    authEnv: AuthEnv = this.authEnv,
    resolvedModel?: string,
  ): {
    type: 'preset';
    preset: 'claude_code';
    append?: string;
  } {
    const appendParts: string[] = [];

    const identityPrompt = buildModelIdentityPrompt(
      getActiveProviderId(authEnv),
      resolvedModel,
    );
    if (identityPrompt) {
      appendParts.push(identityPrompt);
      this.logger.debug(
        `${SERVICE_TAG} Added identity prompt for third-party provider`,
      );
    }

    appendParts.push(PTAH_CORE_SYSTEM_PROMPT);
    this.logger.debug(
      `${SERVICE_TAG} Using PTAH_CORE_SYSTEM_PROMPT for internal query`,
    );

    if (input.systemPromptAppend) {
      appendParts.push(input.systemPromptAppend);
    }

    return {
      type: 'preset',
      preset: 'claude_code',
      append: appendParts.length > 0 ? appendParts.join('\n\n') : undefined,
    };
  }

  private buildOneShotMcpServers(
    mcpServerRunning: boolean,
    mcpPort?: number,
  ): Record<string, McpHttpServerConfig> {
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
    // One synthetic id for BOTH handlers. A one-shot query has no Ptah session
    // id at all, and passing none to the subagent handler left every subagent
    // it spawns unregistered — the SubagentStart gate needs a parent id, and
    // the payload one only arrives once the SDK has started (TASK_2026_295).
    const oneShotSessionId = `internal-query-${Date.now()}`;
    const subagentHooks = this.subagentHookHandler.createHooks(
      cwd,
      oneShotSessionId,
    );

    // Compaction hooks are deliberately NOT wired on this path. `maxTurns`
    // was the wrong axis (TASK_2026_376 finding 4): `oneShotSessionId` above
    // is synthetic BY CONSTRUCTION, for every one-shot caller, whatever its
    // turn budget. It never names a real Ptah session, so it can never be
    // resolved to a transcript. If `PreCompact` fires anyway on a multi-turn
    // one-shot query — and `CURATOR_MAX_TURNS = 6` made this reachable, not
    // theoretical — `CompactionHookHandler` fans that synthetic id to
    // `CompactionCallbackRegistry`, whose one subscriber
    // (`MemoryCuratorService.start()`) calls `transcriptReader.read` on an id
    // that names no session, fails, and falls back to a placeholder curation
    // keyed to a phantom session — the same class of defect TASK_2026_293
    // fixed for the unresolved-id case. No caller of this path (curator,
    // skill-synthesis, agent-generation wizards, harness-ai services) ever
    // has a real Ptah session id to give this hook, so there is no turn
    // budget at which wiring it helps a real subscriber.
    //
    // This costs nothing for the SDK's own compaction: `PreCompact` /
    // `PostCompact` are pure notification hooks (see
    // `compaction-hook-handler.ts`, always returns `{ continue: true }`) —
    // the SDK compacts on its own configured threshold whether or not
    // anything is subscribed to hear about it.
    const mergedHooks: Partial<Record<HookEvent, HookCallbackMatcher[]>> = {};
    for (const [event, matchers] of Object.entries(subagentHooks)) {
      mergedHooks[event as HookEvent] = matchers;
    }

    return mergedHooks;
  }
}
