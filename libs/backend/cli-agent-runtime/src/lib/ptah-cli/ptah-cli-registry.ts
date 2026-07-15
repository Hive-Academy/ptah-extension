import { injectable, inject } from 'tsyringe';
import {
  type AuthEnv,
  type PtahCliConfig,
  type PtahCliSummary,
  type PtahCliState,
  type CliOutputSegment,
  type FlatStreamEventUnion,
  type ProviderProfile,
  createEmptyAuthEnv,
  SessionId,
  OLLAMA_CLOUD_DIRECT_BASE_URL,
} from '@ptah-extension/shared';
import {
  Logger,
  TOKENS,
  ConfigManager,
  type IAuthSecretsService,
} from '@ptah-extension/vscode-core';
import type { SdkHandle } from '../cli-agents/cli-adapters';
import {
  SDK_TOKENS,
  SdkError,
  SdkModuleLoader,
  SdkMessageTransformer,
  SdkPermissionHandler,
  SubagentHookHandler,
  CompactionHookHandler,
  CompactionConfigProvider,
  ANTHROPIC_PROVIDERS,
  getAnthropicProvider,
  getProviderAuthEnvVar,
  seedStaticModelPricing,
  buildSafeEnv,
  type AnthropicProvider,
  type ModelTier,
  type Options,
} from '@ptah-extension/agent-sdk';
import {
  AUTH_PROVIDERS_TOKENS,
  ProviderModelsService,
  ModelResolver,
  OLLAMA_AUTH_TOKEN_PLACEHOLDER,
  SAKANA_PROXY_TOKEN_PLACEHOLDER,
  LOCAL_PROXY_TOKEN_PLACEHOLDER,
  createSakanaProxyForKey,
  LmStudioTranslationProxy,
  type ITranslationProxy,
} from '@ptah-extension/auth-providers';
import type { PtahCliConfigPersistence } from './helpers/ptah-cli-config-persistence.service';
import type { PtahCliSpawnOptions } from './helpers/ptah-cli-spawn-options.service';
import { PtahCliStreamLoop } from './helpers/ptah-cli-stream-loop.service';
import { createPromptMailbox } from './helpers/ptah-cli-prompt-mailbox';
import { CLI_AGENT_RUNTIME_TOKENS } from '../di/tokens';
import {
  PTAH_CLI_KEY_PREFIX,
  generateAgentId,
  sanitizeErrorMessage,
} from './helpers/ptah-cli-registry.utils';

/**
 * Discriminated union result for spawnAgent() failure cases.
 * Callers can inspect `status` to determine the specific failure reason
 * instead of receiving an opaque `undefined`.
 */
export type SpawnAgentFailure = {
  status: 'not_found' | 'disabled' | 'no_api_key' | 'unknown_provider';
  message: string;
};

@injectable()
export class PtahCliRegistry {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.AUTH_SECRETS_SERVICE)
    private readonly authSecrets: IAuthSecretsService,
    @inject(SDK_TOKENS.SDK_MODULE_LOADER)
    private readonly moduleLoader: SdkModuleLoader,
    @inject(SDK_TOKENS.SDK_MESSAGE_TRANSFORMER)
    private readonly messageTransformer: SdkMessageTransformer,
    @inject(SDK_TOKENS.SDK_PERMISSION_HANDLER)
    private readonly permissionHandler: SdkPermissionHandler,
    @inject(SDK_TOKENS.SDK_SUBAGENT_HOOK_HANDLER)
    private readonly subagentHookHandler: SubagentHookHandler,
    @inject(SDK_TOKENS.SDK_COMPACTION_HOOK_HANDLER)
    private readonly compactionHookHandler: CompactionHookHandler,
    @inject(SDK_TOKENS.SDK_COMPACTION_CONFIG_PROVIDER)
    private readonly compactionConfigProvider: CompactionConfigProvider,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_PROVIDER_MODELS)
    private readonly providerModels: ProviderModelsService,
    @inject(CLI_AGENT_RUNTIME_TOKENS.SDK_PTAH_CLI_CONFIG_PERSISTENCE)
    private readonly configPersistence: PtahCliConfigPersistence,
    @inject(CLI_AGENT_RUNTIME_TOKENS.SDK_PTAH_CLI_SPAWN_OPTIONS)
    private readonly spawnOptionsService: PtahCliSpawnOptions,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_MODEL_RESOLVER)
    private readonly modelResolver: ModelResolver,
    @inject(TOKENS.CONFIG_MANAGER)
    private readonly configManager: ConfigManager,
  ) {
    this.logger.info('[PtahCliRegistry] Registry initialized');
  }

  /**
   * Long-lived per-agent translation proxies owned by interactive chat
   * sessions started via `getProfile()`. The ProviderProfile value type carries
   * no teardown hook, so the proxy must outlive the call. We keep at most ONE
   * proxy per agent: a fresh `getProfile()` for the same agent stops the prior
   * instance first. All are stopped on `disposeAll()`.
   */
  private readonly profileProxies = new Map<string, () => Promise<void>>();

  /**
   * Truly-local providers (local Ollama, LM Studio) never need a key.
   * `ollama-cloud` is authType:'none' but supports an OPTIONAL key, so it is
   * NOT truly-local — a saved key must be honored at runtime.
   */
  private isTrulyLocal(provider: AnthropicProvider | undefined): boolean {
    return (
      provider?.authType === 'none' && provider?.supportsOptionalApiKey !== true
    );
  }

  /**
   * Resolve the API key for a run: truly-local → placeholder; optional-key
   * (ollama-cloud) → saved key when present else placeholder (signin still
   * works); key-required → saved key (undefined when unset).
   */
  private async resolveAgentApiKey(
    id: string,
    provider: AnthropicProvider | undefined,
  ): Promise<string | undefined> {
    if (this.isTrulyLocal(provider)) {
      return OLLAMA_AUTH_TOKEN_PLACEHOLDER;
    }
    const saved = await this.authSecrets.getProviderKey(
      `${PTAH_CLI_KEY_PREFIX}.${id}`,
    );
    if (saved && saved.trim().length > 0) return saved;
    if (provider?.supportsOptionalApiKey === true) {
      return OLLAMA_AUTH_TOKEN_PLACEHOLDER;
    }
    return saved ?? undefined;
  }

  /**
   * List all configured Ptah CLI agents with their status
   */
  async listAgents(): Promise<PtahCliSummary[]> {
    await this.configPersistence.ensureMigrated();
    const configs = this.configPersistence.loadConfigs();
    const summaries: PtahCliSummary[] = [];

    for (const agentConfig of configs) {
      const provider = getAnthropicProvider(agentConfig.providerId);
      const trulyLocal = this.isTrulyLocal(provider);
      const hasStoredKey = await this.authSecrets.hasProviderKey(
        `${PTAH_CLI_KEY_PREFIX}.${agentConfig.id}`,
      );
      // Runnable: truly-local, key stored, or signin-capable (authType none).
      const hasKey =
        trulyLocal || hasStoredKey || provider?.authType === 'none';

      const modelCount = provider?.staticModels?.length ?? 0;

      let status: PtahCliState['status'] = 'unconfigured';
      if (hasKey) {
        status = 'available';
      }

      summaries.push({
        id: agentConfig.id,
        name: agentConfig.name,
        providerName: provider?.name ?? 'Unknown',
        providerId: agentConfig.providerId,
        hasApiKey: hasKey,
        hasStoredKey,
        status,
        enabled: agentConfig.enabled,
        modelCount,
      });
    }

    this.logger.info(`[PtahCliRegistry] Listed ${summaries.length} agents`);
    return summaries;
  }

  /**
   * Create a new Ptah CLI configuration
   */
  async createAgent(
    name: string,
    providerId: string,
    apiKey: string,
  ): Promise<PtahCliSummary> {
    await this.configPersistence.ensureMigrated();
    const provider = getAnthropicProvider(providerId);
    if (!provider) {
      throw new SdkError(`Unknown provider: ${providerId}`);
    }

    const id = generateAgentId();
    const tierMappings = this.buildDefaultTierMappings(provider);

    const newConfig: PtahCliConfig = {
      id,
      name,
      providerId,
      enabled: true,
      tierMappings,
      updatedAt: Date.now(),
    };

    await this.authSecrets.setProviderKey(
      `${PTAH_CLI_KEY_PREFIX}.${id}`,
      apiKey,
    );

    try {
      const configs = this.configPersistence.loadConfigs();
      configs.push(newConfig);
      await this.configPersistence.saveConfigs(configs);
    } catch (err) {
      await this.authSecrets
        .deleteProviderKey(`${PTAH_CLI_KEY_PREFIX}.${id}`)
        .catch(() => {
          /* rollback best-effort */
        });
      throw err;
    }

    this.logger.info(
      `[PtahCliRegistry] Created agent "${name}" (${id}) for provider "${provider.name}"`,
    );

    const modelCount = provider.staticModels?.length ?? 0;

    return {
      id,
      name,
      providerName: provider.name,
      providerId,
      hasApiKey: true,
      hasStoredKey: !this.isTrulyLocal(provider) && apiKey.trim().length > 0,
      status: 'available',
      enabled: true,
      modelCount,
    };
  }

  /**
   * Update an existing Ptah CLI configuration
   */
  async updateAgent(
    id: string,
    updates: Partial<
      Pick<PtahCliConfig, 'name' | 'enabled' | 'tierMappings' | 'selectedModel'>
    >,
    apiKey?: string,
  ): Promise<void> {
    const configs = this.configPersistence.loadConfigs();
    const index = configs.findIndex((c) => c.id === id);
    if (index === -1) {
      throw new SdkError(`Agent not found: ${id}`);
    }

    const existing = configs[index];
    const updated: PtahCliConfig = {
      ...existing,
      ...updates,
      updatedAt: Date.now(),
    };
    configs[index] = updated;

    await this.configPersistence.saveConfigs(configs);

    if (apiKey !== undefined) {
      await this.authSecrets.setProviderKey(
        `${PTAH_CLI_KEY_PREFIX}.${id}`,
        apiKey,
      );
    }

    this.logger.info(
      `[PtahCliRegistry] Updated agent "${updated.name}" (${id})`,
    );
  }

  /**
   * Delete a Ptah CLI configuration
   */
  async deleteAgent(id: string): Promise<void> {
    const configs = this.configPersistence.loadConfigs();
    const filtered = configs.filter((c) => c.id !== id);
    if (filtered.length === configs.length) {
      this.logger.warn(`[PtahCliRegistry] Agent not found for deletion: ${id}`);
      return;
    }
    await this.configPersistence.saveConfigs(filtered);

    await this.authSecrets.deleteProviderKey(`${PTAH_CLI_KEY_PREFIX}.${id}`);

    this.logger.info(`[PtahCliRegistry] Deleted agent: ${id}`);
  }

  /**
   * Resolve a ProviderProfile for a Ptah CLI agent.
   *
   * Returns the value-type description of the agent's auth env, model, base
   * URL, and cli.js path â€” consumed by `SdkAgentAdapter.startChatSession()`
   * via the `providerProfile` parameter so third-party providers reuse the
   * unified interactive-chat code path instead of a parallel adapter.
   */
  async getProfile(id: string): Promise<ProviderProfile | undefined> {
    await this.configPersistence.ensureMigrated();
    const configs = this.configPersistence.loadConfigs();
    const agentConfig = configs.find((c) => c.id === id);
    if (!agentConfig) {
      this.logger.warn(`[PtahCliRegistry] getProfile: config not found: ${id}`);
      return undefined;
    }

    const provider = getAnthropicProvider(agentConfig.providerId);
    if (!provider) {
      this.logger.warn(
        `[PtahCliRegistry] getProfile: unknown provider: ${agentConfig.providerId}`,
      );
      return undefined;
    }

    const apiKey = await this.resolveAgentApiKey(id, provider);
    if (!apiKey) {
      this.logger.warn(`[PtahCliRegistry] getProfile: no API key for: ${id}`);
      return undefined;
    }

    seedStaticModelPricing(agentConfig.providerId);

    // Stop a previously-started proxy for this agent before starting a fresh
    // one (the prior chat session, if any, is being replaced).
    await this.stopProfileProxy(id);
    const { authEnv, stopProxy } = await this.buildProxyAuthEnv(
      agentConfig,
      provider,
      apiKey,
    );
    if (provider.requiresProxy === true && provider.authType !== 'none') {
      this.profileProxies.set(id, stopProxy);
    }
    const tier: ModelTier = 'sonnet';
    const effectiveTiers = this.resolveEffectiveTiers(agentConfig, provider);
    const resolvedFromTiers = effectiveTiers?.[tier];
    const resolvedModel =
      agentConfig.selectedModel?.trim() || resolvedFromTiers || '';
    if (!resolvedModel) {
      this.logger.warn(
        `[PtahCliRegistry] getProfile: no model resolved for provider '${provider.id}' (tier '${tier}') — provider has no defaultTiers and no selectedModel configured`,
      );
    }
    const cliJsPath = (await this.moduleLoader.getCliJsPath()) ?? undefined;

    return {
      providerId: agentConfig.providerId,
      authEnv,
      model: resolvedModel,
      baseUrl: provider.baseUrl,
      cliJsPath,
    };
  }

  /**
   * Test connection to a Ptah CLI agent's provider
   */
  async testConnection(
    id: string,
  ): Promise<{ success: boolean; latencyMs?: number; error?: string }> {
    const startTime = Date.now();

    try {
      const queryFn = await this.moduleLoader.getQueryFunction();

      const configs = this.configPersistence.loadConfigs();
      const agentConfig = configs.find((c) => c.id === id);
      if (!agentConfig) {
        return { success: false, error: 'Agent configuration not found' };
      }

      const testProvider = getAnthropicProvider(agentConfig.providerId);
      if (!testProvider) {
        return {
          success: false,
          error: `Unknown provider: ${agentConfig.providerId}`,
        };
      }
      const apiKey = await this.resolveAgentApiKey(id, testProvider);
      if (!apiKey) {
        return { success: false, error: 'API key not configured' };
      }

      seedStaticModelPricing(agentConfig.providerId);
      const { authEnv: testAuthEnv, stopProxy } = await this.buildProxyAuthEnv(
        agentConfig,
        testProvider,
        apiKey,
      );

      const abortController = new AbortController();
      const timeout = setTimeout(() => abortController.abort(), 30000);

      try {
        const testQuery = queryFn({
          prompt: 'Say "ok" and nothing else.',
          options: {
            abortController,
            model: 'claude-sonnet-4-20250514',
            maxTurns: 1,
            systemPrompt: {
              type: 'preset' as const,
              preset: 'claude_code' as const,
            },
            tools: [],
            permissionMode: 'bypassPermissions' as const,
            allowDangerouslySkipPermissions: true,
            includePartialMessages: false,
            env: buildSafeEnv(testAuthEnv),
            pathToClaudeCodeExecutable:
              (await this.moduleLoader.getCliJsPath()) ?? undefined,
          } as Options,
        });

        let receivedResponse = false;
        for await (const _msg of testQuery) {
          receivedResponse = true;
          break;
        }

        const latencyMs = Date.now() - startTime;

        if (receivedResponse) {
          this.logger.info(
            `[PtahCliRegistry] Connection test PASSED for agent ${id} (${latencyMs}ms)`,
          );
          return { success: true, latencyMs };
        } else {
          return {
            success: false,
            error: 'No response received from provider',
          };
        }
      } finally {
        clearTimeout(timeout);
        await stopProxy();
      }
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      const errorMsg = error instanceof Error ? error.message : String(error);

      this.logger.error(
        `[PtahCliRegistry] Connection test FAILED for agent ${id} (${latencyMs}ms): ${errorMsg}`,
      );

      return {
        success: false,
        latencyMs,
        error: sanitizeErrorMessage(errorMsg),
      };
    }
  }

  /**
   * Get list of available Anthropic-compatible providers from the registry
   */
  getAvailableProviders(): AnthropicProvider[] {
    return [...ANTHROPIC_PROVIDERS];
  }

  /**
   * Spawn a headless Ptah CLI agent as a background worker.
   * Returns an SdkHandle compatible with AgentProcessManager.spawnFromSdkHandle().
   */
  async spawnAgent(
    id: string,
    task: string,
    options?: {
      projectGuidance?: string;
      workingDirectory?: string;
      resumeSessionId?: string;
      /** Parent session ID for permission routing. Permissions from this agent
       *  will be scoped to this session for cleanup purposes. */
      parentSessionId?: string;
      /** Model capability tier: 'opus' (most capable), 'sonnet' (balanced, default), 'haiku' (fastest).
       *  Resolves to the SDK model ID used for the query. When omitted, defaults to 'sonnet'. */
      modelTier?: 'opus' | 'sonnet' | 'haiku';
      /** Raw provider model id override (spawn-scoped). Wins over selectedModel and tier.
       *  Does NOT mutate the persisted agent config. */
      model?: string;
    },
  ): Promise<
    | { handle: SdkHandle; agentName: string; setAgentId: (id: string) => void }
    | SpawnAgentFailure
  > {
    const configs = this.configPersistence.loadConfigs();
    const agentConfig = configs.find((c) => c.id === id);
    if (!agentConfig) {
      this.logger.warn(`[PtahCliRegistry] spawnAgent: config not found: ${id}`);
      return {
        status: 'not_found',
        message: `Ptah CLI agent "${id}" not found in configuration`,
      };
    }

    if (!agentConfig.enabled) {
      this.logger.warn(`[PtahCliRegistry] spawnAgent: agent disabled: ${id}`);
      return {
        status: 'disabled',
        message: `Ptah CLI agent "${id}" is disabled`,
      };
    }
    const provider = getAnthropicProvider(agentConfig.providerId);
    const apiKey = await this.resolveAgentApiKey(id, provider);
    if (!apiKey) {
      this.logger.warn(
        `[PtahCliRegistry] spawnAgent: no API key for agent: ${id}`,
      );
      return {
        status: 'no_api_key',
        message: `No API key configured for Ptah CLI agent "${id}"`,
      };
    }
    if (!provider) {
      this.logger.error(
        `[PtahCliRegistry] spawnAgent: unknown provider: ${agentConfig.providerId}`,
      );
      return {
        status: 'unknown_provider',
        message: `Unknown provider "${agentConfig.providerId}" for Ptah CLI agent "${id}"`,
      };
    }
    const agentIdHolder: { value?: string } = {};
    const { authEnv, stopProxy } = await this.buildProxyAuthEnv(
      agentConfig,
      provider,
      apiKey,
    );
    seedStaticModelPricing(agentConfig.providerId);
    const tier: ModelTier = options?.modelTier ?? 'sonnet';
    const spawnTiers = this.resolveEffectiveTiers(agentConfig, provider);
    const spawnFromTiers = spawnTiers?.[tier];
    const modelOverride = options?.model?.trim();
    const model =
      modelOverride ||
      agentConfig.selectedModel?.trim() ||
      spawnFromTiers ||
      '';
    if (modelOverride) {
      this.logger.info(
        `[PtahCliRegistry] spawn: using raw model override '${modelOverride}' for agent '${id}' (selectedModel='${agentConfig.selectedModel ?? ''}', tier='${tier}')`,
      );
    }
    if (!model) {
      this.logger.warn(
        `[PtahCliRegistry] spawn: no model resolved for provider '${provider.id}' (tier '${tier}') — provider has no defaultTiers and no selectedModel configured`,
      );
    }
    const cwd = options?.workingDirectory || require('os').homedir();
    const assembly = await this.spawnOptionsService.assembleSpawnOptions(
      authEnv,
      cwd,
      options?.projectGuidance,
    );
    const {
      outputCallbacks,
      segmentBuffer: _segmentBuffer,
      segmentCallbacks: _segmentCallbacks,
      streamEventBuffer: _streamEventBuffer,
      streamEventCallbacks: _streamEventCallbacks,
      onSegment,
      emitSegment,
      emitOutput,
      onStreamEvent,
      emitStreamEvent,
      dispose: disposeCallbacks,
    } = this.createCallbackInfrastructure();

    this.logger.info(
      `[PtahCliRegistry] Building spawn options for "${agentConfig.name}"`,
      {
        cwd,
        modelTier: tier,
        sdkModel: model,
        resumeSessionId: options?.resumeSessionId ?? null,
        isPremium: assembly.isPremium,
        pluginCount: assembly.plugins?.length ?? 0,
        mcpEnabled: Object.keys(assembly.mcpServers).length > 0,
        hasSystemPrompt: !!assembly.systemPromptContent,
      },
    );
    const isResume = !!options?.resumeSessionId;
    const effectivePrompt = isResume
      ? 'Continue working on the previous task. Pick up where you left off.'
      : task;
    const queryFn = await this.moduleLoader.getQueryFunction();
    const abortController = new AbortController();
    const mailbox = createPromptMailbox(effectivePrompt);
    abortController.signal.addEventListener('abort', () => {
      mailbox.close();
    });

    const sdkQuery = queryFn({
      prompt: mailbox.prompt,
      options: {
        abortController,
        model,
        cwd,
        systemPrompt:
          assembly.systemPromptMode === 'standalone' &&
          assembly.systemPromptContent
            ? assembly.systemPromptContent
            : {
                type: 'preset' as const,
                preset: 'claude_code' as const,
                append: assembly.systemPromptContent,
              },
        tools: {
          type: 'preset' as const,
          preset: 'claude_code' as const,
        },
        mcpServers: assembly.mcpServers,
        ...this.resolvePermissionOptions(
          options?.resumeSessionId ??
            options?.parentSessionId ??
            `ptah-cli:${id}`,
          () => agentIdHolder.value,
        ),
        settingSources: ['user', 'project', 'local'] as const,
        includePartialMessages: true,
        persistSession: true,
        ...(options?.resumeSessionId && { resume: options.resumeSessionId }),
        env: buildSafeEnv(authEnv),
        stderr: (data: string) => {
          this.logger.error(
            `[PtahCliRegistry] Agent "${agentConfig.name}" stderr: ${data}`,
          );
        },
        hooks: assembly.hooks,
        plugins: assembly.plugins,
        compactionControl: assembly.compactionControl,
        pathToClaudeCodeExecutable:
          (await this.moduleLoader.getCliJsPath()) ?? undefined,
      } as Options,
    });
    let resolvedSessionId: string | null = null;
    const sessionResolvedCallbacks: Array<(sessionId: string) => void> = [];
    const pendingTurns: Array<(exitCode: number) => void> = [];
    const enqueueTurn = (): Promise<number> =>
      new Promise<number>((resolve) => {
        pendingTurns.push(resolve);
      });
    const turn1Done = enqueueTurn();
    const streamLoop = new PtahCliStreamLoop({
      logger: this.logger,
      messageTransformer: this.messageTransformer,
      emitOutput,
      emitSegment,
      emitStreamEvent,
      agentName: agentConfig.name,
      onSessionResolved: (sessionId: string) => {
        resolvedSessionId = sessionId;
        for (const cb of sessionResolvedCallbacks) {
          cb(sessionId);
        }
      },
      onTurnComplete: (exitCode: number) => {
        const resolve = pendingTurns.shift();
        if (resolve) {
          resolve(exitCode);
        }
      },
    });
    streamLoop.run(sdkQuery).then((exitCode) => {
      disposeCallbacks();
      void stopProxy();
      sessionResolvedCallbacks.length = 0;
      while (pendingTurns.length > 0) {
        const resolve = pendingTurns.shift();
        resolve?.(exitCode);
      }
    });

    const handle: SdkHandle = {
      abort: abortController,
      done: turn1Done,
      onOutput: (callback) => {
        outputCallbacks.push(callback);
      },
      onSegment,
      onStreamEvent,
      onSessionResolved: (callback) => {
        sessionResolvedCallbacks.push(callback);
        if (resolvedSessionId) {
          callback(resolvedSessionId);
        }
      },
      supportsContinuation: () => true,
      continue: (message: string) => {
        const done = enqueueTurn();
        this.logger.info(
          `[PtahCliRegistry] continue() pushing follow-up turn for "${agentConfig.name}"`,
          { sessionId: resolvedSessionId, messageLength: message.length },
        );
        mailbox.push(message, resolvedSessionId ?? undefined);
        return Promise.resolve({ done });
      },
    };

    const effectiveTiers = this.resolveEffectiveTiers(agentConfig, provider);
    const providerModel =
      effectiveTiers?.sonnet ?? provider.staticModels?.[0]?.id ?? 'default';
    this.logger.info(
      `[PtahCliRegistry] Spawned headless agent "${agentConfig.name}" (${id}) with model ${providerModel} (SDK model: ${model})`,
    );

    return {
      handle,
      agentName: agentConfig.name,
      /** Call this AFTER spawnFromSdkHandle() returns with the agentId.
       *  Populates the lazy resolver used by SdkPermissionHandler to route
       *  CLI agent permissions to the agent monitor panel. */
      setAgentId: (agentId: string) => {
        agentIdHolder.value = agentId;
      },
    };
  }

  /**
   * Dispose all active adapters. Chat sessions are owned by SdkAgentAdapter,
   * but any long-lived per-agent translation proxies started by `getProfile()`
   * are owned here and must be torn down.
   */
  disposeAll(): void {
    this.logger.info('[PtahCliRegistry] disposeAll()');
    for (const id of [...this.profileProxies.keys()]) {
      void this.stopProfileProxy(id);
    }
  }

  /**
   * Stop and forget a long-lived per-agent profile proxy, if one exists.
   */
  private async stopProfileProxy(id: string): Promise<void> {
    const stop = this.profileProxies.get(id);
    if (!stop) {
      return;
    }
    this.profileProxies.delete(id);
    await stop();
  }

  /**
   * Resolve SDK permission options based on user's current autopilot level.
   *
   * When the user is in YOLO mode, we use `bypassPermissions` so the SDK
   * auto-approves ALL tools without calling canUseTool. This eliminates
   * permission-handling overhead and prevents potential deadlocks where a
   * subagent's Bash permission request blocks while the parent session waits.
   *
   * For other modes ('ask', 'auto-edit'), we keep `default` and provide
   * the canUseTool callback so the user sees permission prompts.
   */
  private resolvePermissionOptions(
    sessionId?: string,
    cliAgentResolver?: () => string | undefined,
  ): {
    permissionMode: string;
    canUseTool?: ReturnType<SdkPermissionHandler['createCallback']>;
    allowDangerouslySkipPermissions?: boolean;
  } {
    const level = this.permissionHandler.getPermissionLevel();
    const LEVEL_TO_SDK_MODE: Record<string, string> = {
      yolo: 'bypassPermissions',
      'auto-edit': 'acceptEdits',
      ask: 'default',
      plan: 'plan',
    };

    const sdkMode = LEVEL_TO_SDK_MODE[level] ?? 'default';

    if (sdkMode === 'bypassPermissions') {
      this.logger.info(
        '[PtahCliRegistry] YOLO mode: using bypassPermissions for subagent',
      );
      return {
        permissionMode: sdkMode,
        allowDangerouslySkipPermissions: true,
      };
    }

    this.logger.info(
      `[PtahCliRegistry] Permission mode for subagent: ${sdkMode} (level: ${level})`,
      { sessionId, hasCanUseTool: true },
    );
    return {
      permissionMode: sdkMode,
      canUseTool: this.permissionHandler.createCallback(
        sessionId ? SessionId.from(sessionId) : undefined,
        cliAgentResolver,
      ),
    };
  }

  /**
   * Resolve the agent's AuthEnv plus a teardown handle.
   *
   * For providers that require a local translation proxy (Sakana, LM Studio), a
   * FRESH per-agent proxy is started here and the auth env points at the proxy
   * URL with the placeholder token. Remote apiKey providers (Sakana) bind the
   * proxy to THIS agent's stored Bearer key; local providers (LM Studio,
   * authType 'none') need no key. Per-agent (not singleton) because concurrent
   * ptah-cli agents carry distinct keys/endpoints. Callers MUST invoke the
   * returned `stopProxy()` when the work that uses this auth env completes
   * (stream loop resolves / test finally).
   *
   * For every other provider this falls back to the direct-baseUrl
   * `buildAuthEnv` path (unchanged) and returns a no-op `stopProxy`.
   */
  private async buildProxyAuthEnv(
    agentConfig: PtahCliConfig,
    provider: AnthropicProvider,
    apiKey: string,
  ): Promise<{ authEnv: AuthEnv; stopProxy: () => Promise<void> }> {
    const noopStop = async (): Promise<void> => {
      /* nothing to tear down for the direct-baseUrl path */
    };

    // Every provider that speaks OpenAI and needs a translation proxy takes the
    // proxy path — remote apiKey (Sakana) AND local (LM Studio). Anthropic-native
    // providers (Ollama, requiresProxy:false) keep the direct base-URL path.
    if (provider.requiresProxy !== true) {
      return {
        authEnv: this.buildAuthEnv(agentConfig, provider, apiKey),
        stopProxy: noopStop,
      };
    }

    const created = this.createProxyForProvider(provider, apiKey);
    if (!created) {
      this.logger.warn(
        `[PtahCliRegistry] No proxy factory for proxy-requiring provider '${provider.id}'; falling back to direct base URL`,
      );
      return {
        authEnv: this.buildAuthEnv(agentConfig, provider, apiKey),
        stopProxy: noopStop,
      };
    }

    const { proxy, placeholder } = created;
    const { url: proxyUrl } = await proxy.start();
    this.logger.info(
      `[PtahCliRegistry] Started ${provider.name} translation proxy at ${proxyUrl} for agent "${agentConfig.name}"`,
    );

    const authEnv = createEmptyAuthEnv();
    authEnv.ANTHROPIC_BASE_URL = proxyUrl;
    authEnv.ANTHROPIC_AUTH_TOKEN = placeholder;
    this.applyTierEnv(authEnv, agentConfig, provider);

    const stopProxy = async (): Promise<void> => {
      if (!proxy.isRunning()) {
        return;
      }
      try {
        await proxy.stop();
        this.logger.info(
          `[PtahCliRegistry] Stopped ${provider.name} translation proxy for agent "${agentConfig.name}"`,
        );
      } catch (error) {
        this.logger.warn(
          `[PtahCliRegistry] Failed to stop ${provider.name} proxy: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    };

    return { authEnv, stopProxy };
  }

  /**
   * Create a fresh, per-agent translation proxy (plus its SDK-facing placeholder
   * token) for a proxy-requiring provider. Sakana binds the proxy to the agent's
   * Bearer key; LM Studio is keyless and resolves its endpoint from config /
   * registry default. Returns undefined for providers without a known proxy.
   */
  private createProxyForProvider(
    provider: AnthropicProvider,
    apiKey: string,
  ): { proxy: ITranslationProxy; placeholder: string } | undefined {
    if (provider.id === 'sakana') {
      return {
        proxy: createSakanaProxyForKey(apiKey, this.logger),
        placeholder: SAKANA_PROXY_TOKEN_PLACEHOLDER,
      };
    }
    if (provider.id === 'lm-studio') {
      return {
        proxy: new LmStudioTranslationProxy(this.logger, this.configManager),
        placeholder: LOCAL_PROXY_TOKEN_PLACEHOLDER,
      };
    }
    return undefined;
  }

  /**
   * Apply per-agent tier env vars to an AuthEnv (shared by the direct and proxy
   * auth-env paths).
   */
  private applyTierEnv(
    authEnv: AuthEnv,
    agentConfig: PtahCliConfig,
    provider: AnthropicProvider,
  ): void {
    const effectiveTiers = this.resolveEffectiveTiers(agentConfig, provider);
    if (effectiveTiers) {
      if (effectiveTiers.sonnet) {
        authEnv.ANTHROPIC_DEFAULT_SONNET_MODEL = effectiveTiers.sonnet;
      }
      if (effectiveTiers.opus) {
        authEnv.ANTHROPIC_DEFAULT_OPUS_MODEL = effectiveTiers.opus;
      }
      if (effectiveTiers.haiku) {
        authEnv.ANTHROPIC_DEFAULT_HAIKU_MODEL = effectiveTiers.haiku;
      }
    }
  }

  /**
   * Build isolated AuthEnv for a Ptah CLI agent with tier mappings applied.
   */
  private buildAuthEnv(
    agentConfig: PtahCliConfig,
    provider: AnthropicProvider,
    apiKey: string,
  ): AuthEnv {
    const authEnv = createEmptyAuthEnv();

    // Native Claude provider: inherit the host's local Claude CLI login /
    // subscription. Return an EMPTY auth env — no base url, no auth token, no
    // tier overrides — so the SDK resolves the ambient `~/.claude` credentials
    // (buildSafeEnv forwards HOME/USERPROFILE/XDG_CONFIG_HOME). Setting
    // ANTHROPIC_BASE_URL or an auth token here would override that login and
    // break authentication.
    if (provider.nativeAuth) {
      return authEnv;
    }

    // Ollama Cloud with a real stored key goes straight to ollama.com's
    // Anthropic-compatible endpoint — no dependency on a local daemon owning
    // port 11434. Placeholder key (signin-only setup) keeps the daemon path.
    authEnv.ANTHROPIC_BASE_URL =
      provider.id === 'ollama-cloud' && apiKey !== OLLAMA_AUTH_TOKEN_PLACEHOLDER
        ? OLLAMA_CLOUD_DIRECT_BASE_URL
        : provider.baseUrl;
    const authEnvVar = getProviderAuthEnvVar(agentConfig.providerId);
    authEnv[authEnvVar] = apiKey;

    this.applyTierEnv(authEnv, agentConfig, provider);

    return authEnv;
  }

  /**
   * Create the buffer-and-replay callback infrastructure for output, segments,
   * and stream events.
   */
  private createCallbackInfrastructure() {
    const MAX_STREAM_EVENT_BUFFER = 5000;
    const outputCallbacks: ((data: string) => void)[] = [];
    const segmentBuffer: CliOutputSegment[] = [];
    const segmentCallbacks: Array<(segment: CliOutputSegment) => void> = [];

    const onSegment = (callback: (segment: CliOutputSegment) => void): void => {
      segmentCallbacks.push(callback);
      if (segmentBuffer.length > 0) {
        for (const buffered of segmentBuffer) {
          callback(buffered);
        }
        segmentBuffer.length = 0;
      }
    };

    const emitSegment = (segment: CliOutputSegment): void => {
      if (segmentCallbacks.length === 0) {
        segmentBuffer.push(segment);
      } else {
        for (const cb of segmentCallbacks) {
          cb(segment);
        }
      }
    };

    const emitOutput = (data: string): void => {
      for (const cb of outputCallbacks) {
        cb(data);
      }
    };
    const streamEventBuffer: FlatStreamEventUnion[] = [];
    const streamEventCallbacks: Array<(event: FlatStreamEventUnion) => void> =
      [];

    const onStreamEvent = (
      callback: (event: FlatStreamEventUnion) => void,
    ): void => {
      streamEventCallbacks.push(callback);
      if (streamEventBuffer.length > 0) {
        for (const buffered of streamEventBuffer) {
          callback(buffered);
        }
        streamEventBuffer.length = 0;
      }
    };

    const emitStreamEvent = (event: FlatStreamEventUnion): void => {
      if (streamEventCallbacks.length === 0) {
        if (streamEventBuffer.length >= MAX_STREAM_EVENT_BUFFER) {
          streamEventBuffer.shift();
        }
        streamEventBuffer.push(event);
      } else {
        for (const cb of streamEventCallbacks) {
          cb(event);
        }
      }
    };

    /**
     * Dispose all callback arrays and buffers.
     * Idempotent â€” safe to call multiple times.
     * Called after the stream loop exits to release references held by closures.
     */
    const dispose = (): void => {
      outputCallbacks.length = 0;
      segmentBuffer.length = 0;
      segmentCallbacks.length = 0;
      streamEventBuffer.length = 0;
      streamEventCallbacks.length = 0;
    };

    return {
      outputCallbacks,
      segmentBuffer,
      segmentCallbacks,
      streamEventBuffer,
      streamEventCallbacks,
      onSegment,
      emitSegment,
      emitOutput,
      onStreamEvent,
      emitStreamEvent,
      dispose,
    };
  }

  /**
   * Resolve effective tier mappings for a Ptah CLI agent.
   *
   * Priority (highest wins):
   * 1. Per-agent tierMappings stored in PtahCliConfig
   * 2. Main agent settings from ProviderModelsService
   * 3. Provider's first static model as sonnet fallback
   */
  private resolveEffectiveTiers(
    agentConfig: PtahCliConfig,
    provider: AnthropicProvider,
  ): PtahCliConfig['tierMappings'] {
    const mainTiers = this.providerModels.getModelTiers(
      agentConfig.providerId,
      'cliAgent',
    );
    const agentTiers = agentConfig.tierMappings;
    const providerDefaults = provider.defaultTiers;
    const defaultSonnet = provider.staticModels?.[0]?.id ?? undefined;

    const sonnet =
      agentTiers?.sonnet ||
      mainTiers.sonnet ||
      providerDefaults?.sonnet ||
      defaultSonnet ||
      undefined;
    const opus =
      agentTiers?.opus || mainTiers.opus || providerDefaults?.opus || undefined;
    const haiku =
      agentTiers?.haiku ||
      mainTiers.haiku ||
      providerDefaults?.haiku ||
      undefined;

    if (!sonnet && !opus && !haiku) {
      return undefined;
    }

    this.logger.debug(
      `[PtahCliRegistry] Resolved effective tiers for "${agentConfig.name}"`,
      {
        agentTiers,
        mainTiers,
        resolved: { sonnet, opus, haiku },
      },
    );

    return {
      ...(sonnet ? { sonnet } : {}),
      ...(opus ? { opus } : {}),
      ...(haiku ? { haiku } : {}),
    };
  }

  /**
   * Build default tier mappings for a new agent.
   *
   * Returns undefined so the runtime cascade in resolveEffectiveTiers can
   * resolve tiers in the right order: agentTiers â†’ mainTiers â†’ provider.defaultTiers
   * â†’ staticModels[0]. Pre-filling a partial mapping here would shadow the
   * user's globally-configured tier choices (e.g. Ollama defaults to
   * staticModels[0]='llama3.1:8b' even when the user has selected
   * 'qwen3:8b'/'devstral'/'qwen3:32b' via the model mapping modal).
   */
  private buildDefaultTierMappings(
    _provider: AnthropicProvider,
  ): PtahCliConfig['tierMappings'] {
    return undefined;
  }
}
