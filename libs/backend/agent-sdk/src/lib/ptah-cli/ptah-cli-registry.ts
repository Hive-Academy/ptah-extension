/**
 * Ptah CLI Registry - Manages lifecycle of PtahCliAdapter instances
 *
 * DI-injectable singleton that handles CRUD operations for Ptah CLI
 * configurations and lazily creates/caches adapter instances.
 *
 * Storage:
 * - Config: ConfigManager (VS Code workspace settings) under `ptahCliAgents`
 * - API keys: AuthSecretsService (VS Code SecretStorage) under `ptahCli.{id}`
 *
 * Delegates to extracted helper services:
 * - PtahCliConfigPersistence: config load/save/migration
 * - PtahCliSpawnOptions: premium feature assembly
 * - PtahCliStreamLoop: per-stream message processing
 *
 */

import { injectable, inject } from 'tsyringe';
import {
  type AuthEnv,
  type PtahCliConfig,
  type PtahCliSummary,
  type PtahCliState,
  type CliOutputSegment,
  type FlatStreamEventUnion,
  createEmptyAuthEnv,
  SessionId,
} from '@ptah-extension/shared';
import {
  Logger,
  TOKENS,
  type IAuthSecretsService,
} from '@ptah-extension/vscode-core';
import type { SdkHandle } from '../cli-agents/cli-adapters';
import { SDK_TOKENS } from '../di/tokens';
import { SdkError } from '../errors';
import type { SdkModuleLoader } from '../helpers/sdk-module-loader';
import type { SdkMessageTransformer } from '../sdk-message-transformer';
import type { SdkPermissionHandler } from '../sdk-permission-handler';
import type { SubagentHookHandler } from '../helpers/subagent-hook-handler';
import type { CompactionHookHandler } from '../helpers/compaction-hook-handler';
import type { CompactionConfigProvider } from '../helpers/compaction-config-provider';
import type { ProviderModelsService } from '../provider-models.service';
import type { ModelResolver } from '../auth/model-resolver';
import {
  ANTHROPIC_PROVIDERS,
  getAnthropicProvider,
  getProviderAuthEnvVar,
  seedStaticModelPricing,
  type AnthropicProvider,
} from '../providers/_shared/provider-registry';
import { OLLAMA_AUTH_TOKEN_PLACEHOLDER } from '../providers/local';
import { buildSafeEnv } from '../helpers/build-safe-env';
import { TIER_TO_MODEL_ID, type ModelTier } from '../helpers/sdk-model-service';
import type { Options } from '../types/sdk-types/claude-sdk.types';
import { PtahCliAdapter } from './ptah-cli-adapter';
import type { PtahCliConfigPersistence } from './helpers/ptah-cli-config-persistence.service';
import type { PtahCliSpawnOptions } from './helpers/ptah-cli-spawn-options.service';
import { PtahCliStreamLoop } from './helpers/ptah-cli-stream-loop.service';
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

/**
 * PtahCliRegistry - Manages the lifecycle of PtahCliAdapter instances
 *
 * Responsibilities:
 * - CRUD operations for Ptah CLI configurations
 * - API key storage via AuthSecretsService
 * - Lazy initialization and caching of adapter instances
 * - Connection testing for validation
 * - Provider listing for UI
 */
@injectable()
export class PtahCliRegistry {
  /** Cached adapter instances (lazy-initialized) */
  private adapters = new Map<string, PtahCliAdapter>();

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
    @inject(SDK_TOKENS.SDK_PROVIDER_MODELS)
    private readonly providerModels: ProviderModelsService,
    @inject(SDK_TOKENS.SDK_PTAH_CLI_CONFIG_PERSISTENCE)
    private readonly configPersistence: PtahCliConfigPersistence,
    @inject(SDK_TOKENS.SDK_PTAH_CLI_SPAWN_OPTIONS)
    private readonly spawnOptionsService: PtahCliSpawnOptions,
    @inject(SDK_TOKENS.SDK_MODEL_RESOLVER)
    private readonly modelResolver: ModelResolver,
  ) {
    this.logger.info('[PtahCliRegistry] Registry initialized');
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
      const isLocalProvider = provider?.authType === 'none';
      const hasKey =
        isLocalProvider ||
        (await this.authSecrets.hasProviderKey(
          `${PTAH_CLI_KEY_PREFIX}.${agentConfig.id}`,
        ));

      const modelCount = provider?.staticModels?.length ?? 0;

      let status: PtahCliState['status'] = 'unconfigured';
      if (hasKey) {
        const adapter = this.adapters.get(agentConfig.id);
        if (adapter) {
          const health = adapter.getHealth();
          status =
            health.status === 'available'
              ? 'available'
              : health.status === 'error'
                ? 'error'
                : 'initializing';
        } else {
          status = 'available';
        }
      }

      summaries.push({
        id: agentConfig.id,
        name: agentConfig.name,
        providerName: provider?.name ?? 'Unknown',
        providerId: agentConfig.providerId,
        hasApiKey: hasKey,
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

    const adapter = this.adapters.get(id);
    if (adapter) {
      adapter.dispose();
      this.adapters.delete(id);
    }

    this.logger.info(
      `[PtahCliRegistry] Updated agent "${updated.name}" (${id})`,
    );
  }

  /**
   * Delete a Ptah CLI configuration
   */
  async deleteAgent(id: string): Promise<void> {
    const adapter = this.adapters.get(id);
    if (adapter) {
      adapter.dispose();
      this.adapters.delete(id);
    }

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
   * Get or create (lazy init) an adapter instance for a given agent ID
   */
  async getAdapter(id: string): Promise<PtahCliAdapter | undefined> {
    await this.configPersistence.ensureMigrated();
    const existing = this.adapters.get(id);
    if (existing) {
      const health = existing.getHealth();
      if (health.status === 'available') {
        return existing;
      }
      existing.dispose();
      this.adapters.delete(id);
    }

    const configs = this.configPersistence.loadConfigs();
    const agentConfig = configs.find((c) => c.id === id);
    if (!agentConfig) {
      this.logger.warn(`[PtahCliRegistry] Agent config not found: ${id}`);
      return undefined;
    }

    const provider = getAnthropicProvider(agentConfig.providerId);
    const isLocalProvider = provider?.authType === 'none';

    const apiKey = isLocalProvider
      ? OLLAMA_AUTH_TOKEN_PLACEHOLDER
      : await this.authSecrets.getProviderKey(`${PTAH_CLI_KEY_PREFIX}.${id}`);
    if (!apiKey) {
      this.logger.warn(`[PtahCliRegistry] No API key for agent: ${id}`);
      return undefined;
    }

    const effectiveTiers = provider
      ? this.resolveEffectiveTiers(agentConfig, provider)
      : agentConfig.tierMappings;
    const configWithTiers: PtahCliConfig = {
      ...agentConfig,
      tierMappings: effectiveTiers,
    };

    // Create and initialize adapter with hook/compaction services for interactive chat
    const adapter = new PtahCliAdapter(
      configWithTiers,
      apiKey,
      this.logger,
      this.moduleLoader,
      this.messageTransformer,
      this.permissionHandler,
      this.subagentHookHandler,
      this.compactionHookHandler,
      this.compactionConfigProvider,
      this.modelResolver,
    );

    const success = await adapter.initialize();
    if (!success) {
      this.logger.error(
        `[PtahCliRegistry] Failed to initialize adapter for agent: ${id}`,
      );
      return undefined;
    }

    this.adapters.set(id, adapter);

    this.logger.info(
      `[PtahCliRegistry] Created and initialized adapter for agent "${agentConfig.name}" (${id})`,
    );

    return adapter;
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
      const isLocalProvider = testProvider?.authType === 'none';

      const apiKey = isLocalProvider
        ? OLLAMA_AUTH_TOKEN_PLACEHOLDER
        : await this.authSecrets.getProviderKey(`${PTAH_CLI_KEY_PREFIX}.${id}`);
      if (!apiKey) {
        return { success: false, error: 'API key not configured' };
      }
      const testTiers = testProvider
        ? this.resolveEffectiveTiers(agentConfig, testProvider)
        : agentConfig.tierMappings;
      const testConfig: PtahCliConfig = {
        ...agentConfig,
        tierMappings: testTiers,
      };

      const testAdapter = new PtahCliAdapter(
        testConfig,
        apiKey,
        this.logger,
        this.moduleLoader,
        this.messageTransformer,
        this.permissionHandler,
        undefined, // subagentHookHandler - not needed for test
        undefined, // compactionHookHandler - not needed for test
        undefined, // compactionConfigProvider - not needed for test
        this.modelResolver,
      );
      const initSuccess = await testAdapter.initialize();
      if (!initSuccess) {
        return { success: false, error: 'Failed to initialize adapter' };
      }

      const abortController = new AbortController();
      const timeout = setTimeout(() => abortController.abort(), 30000);

      try {
        const testQuery = queryFn({
          prompt: 'Say "ok" and nothing else.',
          options: {
            abortController,
            model: testAdapter['resolveModel'](),
            maxTurns: 1,
            systemPrompt: {
              type: 'preset' as const,
              preset: 'claude_code' as const,
            },
            tools: [],
            permissionMode: 'bypassPermissions' as const,
            allowDangerouslySkipPermissions: true,
            includePartialMessages: false,
            env: buildSafeEnv(testAdapter['authEnv']),
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
        testAdapter.dispose();
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
    },
  ): Promise<
    | { handle: SdkHandle; agentName: string; setAgentId: (id: string) => void }
    | SpawnAgentFailure
  > {
    // Find config
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

    // Resolve provider
    const provider = getAnthropicProvider(agentConfig.providerId);

    // Get API key (local providers use placeholder)
    const isLocalProvider = provider?.authType === 'none';
    const apiKey = isLocalProvider
      ? OLLAMA_AUTH_TOKEN_PLACEHOLDER
      : await this.authSecrets.getProviderKey(`${PTAH_CLI_KEY_PREFIX}.${id}`);
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

    // The agentId is not available until after spawnFromSdkHandle() returns,
    // but the permission callback (canUseTool) is created before that.
    // The resolver closure captures this holder; the caller populates it
    // via setAgentId() after spawn completes.
    const agentIdHolder: { value?: string } = {};

    // Build isolated AuthEnv
    const authEnv = this.buildAuthEnv(agentConfig, provider, apiKey);
    seedStaticModelPricing(agentConfig.providerId);

    // Resolve SDK model.
    // Priority: agent-level selectedModel (the user's explicit pick in the
    // CLI agent card) → per-tier mapping → hardcoded Anthropic fallback.
    // selectedModel must win so users see the model they configured (e.g.
    // kimi-k2.6:cloud) instead of the provider default (kimi-k2.5:cloud).
    const tier: ModelTier = options?.modelTier ?? 'sonnet';
    const spawnTiers = this.resolveEffectiveTiers(agentConfig, provider);
    const model =
      agentConfig.selectedModel?.trim() ||
      spawnTiers?.[tier] ||
      TIER_TO_MODEL_ID[tier];
    // workingDirectory should be resolved by the caller (agent-namespace.builder).
    // os.homedir() is a safer fallback than process.cwd() which returns the
    // app installation directory in VS Code extension host / Electron.
    const cwd = options?.workingDirectory || require('os').homedir();

    // Assemble premium spawn options via dedicated service
    const assembly = await this.spawnOptionsService.assembleSpawnOptions(
      authEnv,
      cwd,
      options?.projectGuidance,
    );

    // Build callback infrastructure
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

    // When resuming, use a continuation prompt
    const isResume = !!options?.resumeSessionId;
    const effectivePrompt = isResume
      ? 'Continue working on the previous task. Pick up where you left off.'
      : task;

    // Get query function and start SDK query
    const queryFn = await this.moduleLoader.getQueryFunction();
    const abortController = new AbortController();

    const sdkQuery = queryFn({
      prompt: effectivePrompt,
      options: {
        abortController,
        model,
        // No maxTurns cap — let the agent work freely until done
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

    // Session-resolved callback relay (buffer-and-replay pattern)
    let resolvedSessionId: string | null = null;
    const sessionResolvedCallbacks: Array<(sessionId: string) => void> = [];

    // Consume the async iterable in background via PtahCliStreamLoop
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
    });
    // Chain dispose after stream loop exits to release callback/buffer references.
    // The stream loop's run() returns the exit code; we preserve it after cleanup.
    const done = streamLoop.run(sdkQuery).then((exitCode) => {
      try {
        disposeCallbacks();
        sessionResolvedCallbacks.length = 0;
      } catch {
        // Cleanup errors must not break the promise chain or mask the exit code
      }
      return exitCode;
    });

    const handle: SdkHandle = {
      abort: abortController,
      done,
      onOutput: (callback) => {
        outputCallbacks.push(callback);
      },
      onSegment,
      onStreamEvent,
      onSessionResolved: (callback) => {
        sessionResolvedCallbacks.push(callback);
        // Replay if session ID was already resolved before listener registered
        if (resolvedSessionId) {
          callback(resolvedSessionId);
        }
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
   * Dispose all active adapters
   */
  disposeAll(): void {
    this.logger.info(
      `[PtahCliRegistry] Disposing ${this.adapters.size} active adapters`,
    );

    for (const [id, adapter] of this.adapters.entries()) {
      this.logger.debug(`[PtahCliRegistry] Disposing adapter: ${id}`);
      adapter.dispose();
    }

    this.adapters.clear();
    this.logger.info('[PtahCliRegistry] All adapters disposed');
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

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

    // Map user's autopilot level to SDK permission mode.
    // This ensures subagents honor the same permission policy as the parent session.
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
      // CLI path: no tabId arg — tabId stays undefined on the wire per the
      // CLI contract (UC3). The frontend router falls through to agent-monitor
      // routing when tabId is absent.
      canUseTool: this.permissionHandler.createCallback(
        sessionId ? SessionId.from(sessionId) : undefined,
        cliAgentResolver,
      ),
    };
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
    authEnv.ANTHROPIC_BASE_URL = provider.baseUrl;
    const authEnvVar = getProviderAuthEnvVar(agentConfig.providerId);
    authEnv[authEnvVar] = apiKey;

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

    return authEnv;
  }

  /**
   * Create the buffer-and-replay callback infrastructure for output, segments,
   * and stream events.
   */
  private createCallbackInfrastructure() {
    const MAX_STREAM_EVENT_BUFFER = 5000;

    // Raw text callbacks
    const outputCallbacks: ((data: string) => void)[] = [];

    // Structured segment buffering
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

    // FlatStreamEventUnion callbacks
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
     * Idempotent — safe to call multiple times.
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
    // Read CLI-agent scope first (the user's per-agent tier overrides set via
    // the CLI agent config UI). Fall back to the main-agent scope only as a
    // last resort — do not let mainTiers silently shadow cliAgent tiers.
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
   * resolve tiers in the right order: agentTiers → mainTiers → provider.defaultTiers
   * → staticModels[0]. Pre-filling a partial mapping here would shadow the
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
