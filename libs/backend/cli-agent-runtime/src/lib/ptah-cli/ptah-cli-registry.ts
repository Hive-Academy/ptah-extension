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
import { classifyCliStderr } from '../cli-agents/cli-adapters/cli-stderr-severity';
import {
  SDK_TOKENS,
  HARNESS_PREFLIGHT_TOKEN,
  SdkError,
  SdkModuleLoader,
  SdkMessageTransformer,
  SdkPermissionHandler,
  SubagentHookHandler,
  CompactionHookHandler,
  CompactionConfigProvider,
  getAllAnthropicProviders,
  getAnthropicProvider,
  getProviderAuthEnvVar,
  seedStaticModelPricing,
  buildSafeEnv,
  buildFlagSettings,
  type AnthropicProvider,
  type IHarnessPreflight,
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
import type { ISdkProcessSpawner } from '../spawn/sdk-process-spawner.port';
import { PtahCliStreamLoop } from './helpers/ptah-cli-stream-loop.service';
import { createPromptMailbox } from './helpers/ptah-cli-prompt-mailbox';
import { CLI_AGENT_RUNTIME_TOKENS } from '../di/tokens';
import {
  PTAH_CLI_KEY_PREFIX,
  blankToUndefined,
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

/**
 * A running translation proxy shared by every chat session on one ptah-cli
 * agent.
 *
 * `fingerprint` is what the proxy was built FROM — provider id, resolved API
 * key and resolved tier mapping. Two sessions may share a proxy only while
 * their fingerprints agree; once the user edits any of those, the running
 * proxy is answering with the wrong credentials for a new session and must be
 * superseded (see `PtahCliRegistry.profileProxies`).
 */
interface ProfileProxyLease {
  readonly fingerprint: string;
  readonly authEnv: AuthEnv;
  readonly stop: () => Promise<void>;
  refCount: number;
}

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
    @inject(SDK_TOKENS.SDK_PROCESS_SPAWNER)
    private readonly processSpawner: ISdkProcessSpawner,
    /**
     * A raw Ptah CLI reads its harness from disk at process startup. Keep this
     * optional so hosts that have not bound harness-sync keep their existing
     * spawn behavior.
     */
    @inject(HARNESS_PREFLIGHT_TOKEN, { isOptional: true })
    private readonly harnessPreflight: IHarnessPreflight | null = null,
  ) {
    this.logger.info('[PtahCliRegistry] Registry initialized');
  }

  /**
   * The CURRENT translation-proxy lease per agent id, owned by the interactive
   * chat sessions started via `getProfile()`. The ProviderProfile value type
   * carries no teardown hook, so the proxy must outlive the call.
   *
   * **Ref-counted, one proxy per agent, shared by every session on it.** The
   * previous rule was "at most ONE proxy per agent: a fresh `getProfile()` for
   * the same agent stops the prior instance first", and that was a bug, not a
   * simplification. `getProfile()` is called once per `chat:start`, so opening
   * a third session on the same ptah-cli agent stopped the proxy sessions 1
   * and 2 were already using: their `ANTHROPIC_BASE_URL` pointed at a closed
   * port and every request they made failed (TASK_2026_323).
   *
   * A lease is stopped only when its last holder releases it. A lease whose
   * fingerprint no longer matches the agent's configuration is RETIRED rather
   * than stopped — it leaves this map, and if anyone still holds it, it waits
   * in {@link retiringProxies} until they are done.
   */
  private readonly profileProxies = new Map<string, ProfileProxyLease>();

  /**
   * Superseded leases that are still held by live sessions.
   *
   * A lease lands here when the user changes the agent's key, provider or tier
   * mapping between sessions: new sessions get a fresh proxy, and the sessions
   * already streaming through the old one keep working until they release it.
   * Stopped on the last release, or on `disposeAll()`.
   */
  private readonly retiringProxies = new Set<ProfileProxyLease>();

  /**
   * Which lease a named caller currently holds, keyed by its `leaseKey`
   * (the chat tab id). This is what makes {@link releaseProfile} possible: the
   * caller does not have to remember which proxy instance it was given.
   */
  private readonly leaseHolders = new Map<string, ProfileProxyLease>();

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
   *
   * For a provider that needs a translation proxy this ACQUIRES a reference to
   * the agent's shared proxy — see {@link profileProxies}.
   *
   * @param leaseKey Identifies the caller holding the reference, so it can give
   *   it back later via {@link releaseProfile}. Callers should pass their chat
   *   tab id. It is optional only so existing call sites keep compiling: WITHOUT
   *   a key the reference is still counted (so a later session cannot kill the
   *   proxy out from under this one) but nothing can ever free it short of
   *   `disposeAll()`, and the proxy stays up for the life of the process.
   */
  async getProfile(
    id: string,
    leaseKey?: string,
  ): Promise<ProviderProfile | undefined> {
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

    const tier: ModelTier = 'sonnet';
    const effectiveTiers = this.resolveEffectiveTiers(agentConfig, provider);
    const authEnv = await this.acquireProfileAuthEnv(
      id,
      agentConfig,
      provider,
      apiKey,
      effectiveTiers,
      leaseKey,
    );
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
   * Get list of available Anthropic-compatible providers from the merged
   * registry — built-ins plus user-defined entries, so a custom provider can
   * back a spawned Ptah CLI agent.
   */
  getAvailableProviders(): AnthropicProvider[] {
    return getAllAnthropicProviders();
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
    await this.runHarnessPreflight(cwd);
    const assembly = await this.spawnOptionsService.assembleSpawnOptions(
      authEnv,
      cwd,
      options?.projectGuidance,
      // The tier is already resolved above — hand the identity clarification
      // the same model the spawn runs on rather than letting it guess a tier.
      model || undefined,
      {
        parentSessionId: options?.parentSessionId,
        // The agent's OWN session id, which only exists when resuming. NOT the
        // parent's — see `PtahSpawnSessionContext.ownSessionId`.
        ownSessionId: options?.resumeSessionId,
      },
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

    const handleChildStderr = (data: string) => {
      const isError = classifyCliStderr(data) === 'error';
      const message = `[PtahCliRegistry] Agent "${agentConfig.name}" stderr: ${data}`;
      if (isError) {
        this.logger.warn(message);
      } else {
        this.logger.debug(message);
      }
    };

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
        // Output-style FLAG tier (TASK_2026_197). `buildFlagSettings` is the
        // ONE builder of this object — hand-rolling `{ outputStyle: name }`
        // here would be a second flag-tier definition, and it omits the
        // `outputStyle`-key-absent rule that stops a spawn from clobbering a
        // style the user chose for their own CLI sessions (G4b).
        //
        // It also carries `PTAH_DISABLE_SDK_AUTO_MEMORY`, which spawns did not
        // send before. That is deliberate: Ptah runs its own memory curator,
        // and a spawned agent writing SDK auto-memory was an inconsistency
        // with every other session Ptah starts.
        settings: buildFlagSettings({
          outputStyleName: assembly.outputStyleName,
        }),
        ...this.resolvePermissionOptions(
          blankToUndefined(options?.resumeSessionId) ??
            blankToUndefined(options?.parentSessionId) ??
            `ptah-cli:${id}`,
          () => agentIdHolder.value,
        ),
        settingSources: ['user', 'project', 'local'] as const,
        includePartialMessages: true,
        persistSession: true,
        ...(options?.resumeSessionId && { resume: options.resumeSessionId }),
        env: buildSafeEnv(authEnv),
        stderr: handleChildStderr,
        spawnClaudeCodeProcess: (spawnOptions) =>
          this.processSpawner.spawn(spawnOptions, {
            onStderr: handleChildStderr,
          }),
        hooks: assembly.hooks,
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

    // No `getPid`, deliberately, and it is not an oversight the way it looks.
    // Every other adapter here spawns its own `child_process` and can hand the
    // manager a PID to tree-kill. This path does not spawn anything: `query()`
    // owns the `claude` child, exposes no handle to it anywhere in the SDK's
    // public surface, and reaps it itself when `abortController` fires — which
    // is also what closes the prompt mailbox above and ends the stream loop. So
    // for this handle the abort IS the kill, and `AgentProcessManager.killProcess`
    // waits on `done` rather than tree-killing a PID it cannot be given.
    // Inventing one (e.g. from a process scan) would be guessing at which
    // `claude.exe` on the machine is ours.
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

    this.logger.info(
      `[PtahCliRegistry] Spawned headless agent "${agentConfig.name}" (${id}) ` +
        `with model ${model || '(unresolved)'} (tier: ${tier})`,
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
   * Verifies the on-disk harness before a raw Ptah CLI query begins.
   *
   * The preflight port promises a bounded, non-throwing operation, but a
   * defensive boundary is necessary because a rejected implementation must not
   * prevent an otherwise valid agent spawn.
   */
  private async runHarnessPreflight(cwd: string): Promise<void> {
    if (this.harnessPreflight === null) return;
    try {
      await this.harnessPreflight.ensure(cwd);
    } catch (error: unknown) {
      this.logger.warn(
        `[PtahCliRegistry] Harness preflight failed (ignored): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Dispose all active adapters. Chat sessions are owned by SdkAgentAdapter,
   * but any long-lived per-agent translation proxies started by `getProfile()`
   * are owned here and must be torn down.
   *
   * Stops the CURRENT lease of every agent AND every superseded lease still
   * waiting on a holder — the retiring set is the one that would otherwise be
   * missed, and its proxies hold real listening sockets.
   */
  disposeAll(): void {
    this.logger.info('[PtahCliRegistry] disposeAll()');
    const leases = [...this.profileProxies.values(), ...this.retiringProxies];
    this.profileProxies.clear();
    this.retiringProxies.clear();
    this.leaseHolders.clear();
    for (const lease of leases) {
      lease.refCount = 0;
      void lease.stop();
    }
  }

  /**
   * Give back the translation-proxy reference taken by
   * `getProfile(id, leaseKey)`.
   *
   * Stops the proxy only when the LAST holder lets go. An unknown key is a
   * silent no-op: callers release on abort, on session delete and on dispose,
   * and those paths overlap — a double release must not be an error, and a
   * release for a non-proxy provider (which never took a lease) must not be
   * either.
   */
  async releaseProfile(leaseKey: string): Promise<void> {
    const lease = this.leaseHolders.get(leaseKey);
    if (!lease) {
      return;
    }
    this.leaseHolders.delete(leaseKey);
    lease.refCount--;
    if (lease.refCount > 0) {
      return;
    }
    this.retiringProxies.delete(lease);
    for (const [agentId, current] of this.profileProxies) {
      if (current === lease) {
        this.profileProxies.delete(agentId);
        break;
      }
    }
    await lease.stop();
  }

  /**
   * Resolve the auth env for an interactive chat session, sharing ONE
   * translation proxy across every session running on the same agent.
   *
   * The three cases, in the order they are decided:
   *
   * 1. **Not a pooled provider** — `requiresProxy !== true` or
   *    `authType === 'none'`. The auth env is a plain value aimed at the
   *    provider's own base URL, there is nothing to keep alive, so no lease is
   *    taken and no bookkeeping happens. Same predicate the old code used to
   *    decide whether to remember a `stopProxy`.
   * 2. **A matching lease exists** — reuse it and count one more holder. This
   *    is the case the old code got wrong: it stopped the running proxy first,
   *    breaking every session already streaming through it.
   * 3. **A lease exists with a different fingerprint** — the user changed the
   *    key, provider or tier mapping since it started, so it is answering with
   *    the wrong credentials for this session. It is RETIRED (removed as the
   *    agent's current lease) and, if anyone still holds it, parked in
   *    `retiringProxies` until they release. A held lease is never stopped.
   */
  private async acquireProfileAuthEnv(
    id: string,
    agentConfig: PtahCliConfig,
    provider: AnthropicProvider,
    apiKey: string,
    effectiveTiers: PtahCliConfig['tierMappings'],
    leaseKey: string | undefined,
  ): Promise<AuthEnv> {
    const isPooled =
      provider.requiresProxy === true && provider.authType !== 'none';
    if (!isPooled) {
      const { authEnv } = await this.buildProxyAuthEnv(
        agentConfig,
        provider,
        apiKey,
      );
      return authEnv;
    }

    const fingerprint = this.proxyFingerprint(
      agentConfig,
      apiKey,
      effectiveTiers,
    );
    const held =
      leaseKey === undefined ? undefined : this.leaseHolders.get(leaseKey);

    // A tab restarting on the same agent with unchanged credentials already
    // holds exactly the lease it is asking for. Re-counting it would strand a
    // reference the tab can never give back; releasing and re-taking it would
    // bounce a proxy that is already correct.
    if (
      held &&
      held === this.profileProxies.get(id) &&
      held.fingerprint === fingerprint
    ) {
      return held.authEnv;
    }

    // Any other restart on this key: the tab's previous lease is finished with.
    if (leaseKey !== undefined && held) {
      await this.releaseProfile(leaseKey);
    }

    const current = this.profileProxies.get(id);
    if (current && current.fingerprint === fingerprint) {
      current.refCount++;
      if (leaseKey !== undefined) {
        this.leaseHolders.set(leaseKey, current);
      }
      this.logger.info(
        `[PtahCliRegistry] Reusing translation proxy for agent "${agentConfig.name}" (${current.refCount} holders)`,
      );
      return current.authEnv;
    }

    if (current) {
      this.profileProxies.delete(id);
      if (current.refCount > 0) {
        this.retiringProxies.add(current);
        this.logger.info(
          `[PtahCliRegistry] Retired a superseded translation proxy for agent "${agentConfig.name}"; ${current.refCount} session(s) still using it`,
        );
      } else {
        await current.stop();
      }
    }

    const { authEnv, stopProxy } = await this.buildProxyAuthEnv(
      agentConfig,
      provider,
      apiKey,
    );
    const lease: ProfileProxyLease = {
      fingerprint,
      authEnv,
      stop: stopProxy,
      refCount: 1,
    };
    this.profileProxies.set(id, lease);
    if (leaseKey !== undefined) {
      this.leaseHolders.set(leaseKey, lease);
    }
    return authEnv;
  }

  /**
   * Everything a running translation proxy was built FROM.
   *
   * Two sessions may share a proxy only while these agree. `\u0000` separates
   * the parts so no combination of values can collide by concatenation.
   */
  private proxyFingerprint(
    agentConfig: PtahCliConfig,
    apiKey: string,
    effectiveTiers: PtahCliConfig['tierMappings'],
  ): string {
    return [
      agentConfig.providerId,
      apiKey,
      effectiveTiers?.sonnet ?? '',
      effectiveTiers?.opus ?? '',
      effectiveTiers?.haiku ?? '',
    ].join('\u0000');
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
   *
   * @param routingId - The caller's RAW routing id, which may not be a session
   *   at all: a spawn with neither a resume nor a parent falls back to
   *   `ptah-cli:${id}`. It is parsed here exactly once — see the body.
   */
  private resolvePermissionOptions(
    routingId: string,
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

    // Two wrong branches used to live here. A non-UUID routing id (`''` from a
    // caller that minted an empty parent session) collapsed to `undefined`,
    // which makes the request unroutable and auto-denies every tool prompt on
    // timeout; anything else non-UUID (the `ptah-cli:${id}` fallback) reached
    // `SessionId.from`, which THROWS — taking the whole spawn down. Parse once,
    // keep the raw id as the routing hint so out-of-band observers can still
    // match the prompt, and say out loud when there is no routable surface.
    const routableSessionId = SessionId.safeParse(routingId) ?? undefined;
    if (!routableSessionId) {
      this.logger.warn(
        `[PtahCliRegistry] Spawned agent has no routable session id — tool prompts reach the agent monitor panel only, and auto-deny on timeout if that panel is not listening`,
        { routingHint: routingId, sdkMode, level },
      );
    }
    this.logger.info(
      `[PtahCliRegistry] Permission mode for subagent: ${sdkMode} (level: ${level})`,
      { sessionId: routableSessionId ?? null, hasCanUseTool: true },
    );
    return {
      permissionMode: sdkMode,
      canUseTool: this.permissionHandler.createCallback(
        routableSessionId,
        cliAgentResolver,
        undefined,
        undefined,
        routingId,
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
