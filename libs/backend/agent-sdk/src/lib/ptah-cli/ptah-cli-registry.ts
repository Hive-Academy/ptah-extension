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
 * @see TASK_2025_167 Batch 2 - Ptah CLI Adapter + Registry
 */

import { randomUUID } from 'node:crypto';
import { injectable, inject } from 'tsyringe';
import {
  type AuthEnv,
  type PtahCliConfig,
  type PtahCliSummary,
  type PtahCliState,
  createEmptyAuthEnv,
} from '@ptah-extension/shared';
import {
  Logger,
  TOKENS,
  type ConfigManager,
  type IAuthSecretsService,
} from '@ptah-extension/vscode-core';
import type { SdkHandle } from '@ptah-extension/llm-abstraction';
import { SDK_TOKENS } from '../di/tokens';
import type { SdkModuleLoader } from '../helpers/sdk-module-loader';
import type { SdkMessageTransformer } from '../sdk-message-transformer';
import type { SdkPermissionHandler } from '../sdk-permission-handler';
import type { SubagentHookHandler } from '../helpers/subagent-hook-handler';
import type { CompactionHookHandler } from '../helpers/compaction-hook-handler';
import type { CompactionConfigProvider } from '../helpers/compaction-config-provider';
import {
  ANTHROPIC_PROVIDERS,
  getAnthropicProvider,
  getProviderAuthEnvVar,
  seedStaticModelPricing,
  type AnthropicProvider,
} from '../helpers/anthropic-provider-registry';
import type { Options } from '../types/sdk-types/claude-sdk.types';
import { buildSafeEnv } from '../helpers/build-safe-env';
import { PtahCliAdapter } from './ptah-cli-adapter';

/**
 * Secret key prefix for Ptah CLI API keys
 * Full key format: `ptahCli.{agentId}`
 */
const PTAH_CLI_KEY_PREFIX = 'ptahCli';

/**
 * Config key for Ptah CLI configurations in ConfigManager
 */
const PTAH_CLI_AGENTS_CONFIG_KEY = 'ptahCliAgents';

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
 * Generate a cryptographically random ID for new Ptah CLI instances.
 * Uses crypto.randomUUID() for unpredictable identifiers with `pc-` prefix
 * for visual identification as a Ptah CLI ID.
 */
function generateAgentId(): string {
  return `pc-${randomUUID()}`;
}

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

  /** Cached migration promise to ensure one-time execution */
  private migrationPromise: Promise<void> | null = null;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.CONFIG_MANAGER) private readonly config: ConfigManager,
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
    private readonly compactionConfigProvider: CompactionConfigProvider
  ) {
    this.logger.info('[PtahCliRegistry] Registry initialized');
  }

  /**
   * List all configured Ptah CLI agents with their status
   *
   * Loads configs from ConfigManager and checks API key existence
   * for each agent to determine status.
   */
  async listAgents(): Promise<PtahCliSummary[]> {
    await this.ensureMigrated();
    const configs = this.loadConfigs();
    const summaries: PtahCliSummary[] = [];

    for (const agentConfig of configs) {
      const hasKey = await this.authSecrets.hasProviderKey(
        `${PTAH_CLI_KEY_PREFIX}.${agentConfig.id}`
      );

      const provider = getAnthropicProvider(agentConfig.providerId);
      const modelCount = provider?.staticModels?.length ?? 0;

      // Determine status based on adapter state
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
          // Key exists but adapter not yet initialized
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
   *
   * @param name - User-facing display name
   * @param providerId - Anthropic-compatible provider ID from registry
   * @param apiKey - API key for the provider
   * @returns Summary of the created agent
   */
  async createAgent(
    name: string,
    providerId: string,
    apiKey: string
  ): Promise<PtahCliSummary> {
    await this.ensureMigrated();
    // Validate provider exists
    const provider = getAnthropicProvider(providerId);
    if (!provider) {
      throw new Error(`Unknown provider: ${providerId}`);
    }

    // Generate unique ID
    const id = generateAgentId();

    // Build default tier mappings from provider's static models
    const tierMappings = this.buildDefaultTierMappings(provider);

    // Create config
    const newConfig: PtahCliConfig = {
      id,
      name,
      providerId,
      enabled: true,
      tierMappings,
      updatedAt: Date.now(),
    };

    // Save API key first (SecretStorage is more failure-prone)
    await this.authSecrets.setProviderKey(
      `${PTAH_CLI_KEY_PREFIX}.${id}`,
      apiKey
    );

    // Then save config; rollback key if config save fails
    try {
      const configs = this.loadConfigs();
      configs.push(newConfig);
      await this.saveConfigs(configs);
    } catch (err) {
      await this.authSecrets
        .deleteProviderKey(`${PTAH_CLI_KEY_PREFIX}.${id}`)
        .catch(() => {
          /* rollback best-effort */
        });
      throw err;
    }

    this.logger.info(
      `[PtahCliRegistry] Created agent "${name}" (${id}) for provider "${provider.name}"`
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
   *
   * @param id - Agent ID to update
   * @param updates - Partial config updates
   * @param apiKey - Optional new API key
   */
  async updateAgent(
    id: string,
    updates: Partial<
      Pick<PtahCliConfig, 'name' | 'enabled' | 'tierMappings' | 'selectedModel'>
    >,
    apiKey?: string
  ): Promise<void> {
    const configs = this.loadConfigs();
    const index = configs.findIndex((c) => c.id === id);
    if (index === -1) {
      throw new Error(`Agent not found: ${id}`);
    }

    // Apply updates
    const existing = configs[index];
    const updated: PtahCliConfig = {
      ...existing,
      ...updates,
      updatedAt: Date.now(),
    };
    configs[index] = updated;

    // Save updated configs
    await this.saveConfigs(configs);

    // Optionally update API key
    if (apiKey !== undefined) {
      await this.authSecrets.setProviderKey(
        `${PTAH_CLI_KEY_PREFIX}.${id}`,
        apiKey
      );
    }

    // Dispose cached adapter so it gets re-created with new config
    const adapter = this.adapters.get(id);
    if (adapter) {
      adapter.dispose();
      this.adapters.delete(id);
    }

    this.logger.info(
      `[PtahCliRegistry] Updated agent "${updated.name}" (${id})`
    );
  }

  /**
   * Delete a Ptah CLI configuration
   *
   * @param id - Agent ID to delete
   */
  async deleteAgent(id: string): Promise<void> {
    // Dispose adapter first
    const adapter = this.adapters.get(id);
    if (adapter) {
      adapter.dispose();
      this.adapters.delete(id);
    }

    // Remove config
    const configs = this.loadConfigs();
    const filtered = configs.filter((c) => c.id !== id);
    if (filtered.length === configs.length) {
      this.logger.warn(`[PtahCliRegistry] Agent not found for deletion: ${id}`);
      return;
    }
    await this.saveConfigs(filtered);

    // Delete API key
    await this.authSecrets.deleteProviderKey(`${PTAH_CLI_KEY_PREFIX}.${id}`);

    this.logger.info(`[PtahCliRegistry] Deleted agent: ${id}`);
  }

  /**
   * Get or create (lazy init) an adapter instance for a given agent ID
   *
   * @param id - Agent ID
   * @returns Initialized adapter, or undefined if config/key not found
   */
  async getAdapter(id: string): Promise<PtahCliAdapter | undefined> {
    await this.ensureMigrated();
    // Return cached adapter if available and initialized
    const existing = this.adapters.get(id);
    if (existing) {
      const health = existing.getHealth();
      if (health.status === 'available') {
        return existing;
      }
      // Adapter exists but unhealthy - dispose and re-create
      existing.dispose();
      this.adapters.delete(id);
    }

    // Find config
    const configs = this.loadConfigs();
    const agentConfig = configs.find((c) => c.id === id);
    if (!agentConfig) {
      this.logger.warn(`[PtahCliRegistry] Agent config not found: ${id}`);
      return undefined;
    }

    // Get API key
    const apiKey = await this.authSecrets.getProviderKey(
      `${PTAH_CLI_KEY_PREFIX}.${id}`
    );
    if (!apiKey) {
      this.logger.warn(`[PtahCliRegistry] No API key for agent: ${id}`);
      return undefined;
    }

    // Create and initialize adapter with hook/compaction services
    const adapter = new PtahCliAdapter(
      agentConfig,
      apiKey,
      this.logger,
      this.moduleLoader,
      this.messageTransformer,
      this.permissionHandler,
      this.subagentHookHandler,
      this.compactionHookHandler,
      this.compactionConfigProvider
    );

    const success = await adapter.initialize();
    if (!success) {
      this.logger.error(
        `[PtahCliRegistry] Failed to initialize adapter for agent: ${id}`
      );
      return undefined;
    }

    // Cache the initialized adapter
    this.adapters.set(id, adapter);

    this.logger.info(
      `[PtahCliRegistry] Created and initialized adapter for agent "${agentConfig.name}" (${id})`
    );

    return adapter;
  }

  /**
   * Test connection to a Ptah CLI agent's provider
   *
   * Performs a minimal query to validate the API key and provider connectivity.
   *
   * @param id - Agent ID to test
   * @returns Connection test result with latency or error
   */
  async testConnection(
    id: string
  ): Promise<{ success: boolean; latencyMs?: number; error?: string }> {
    const startTime = Date.now();

    try {
      const queryFn = await this.moduleLoader.getQueryFunction();

      const configs = this.loadConfigs();
      const agentConfig = configs.find((c) => c.id === id);
      if (!agentConfig) {
        return { success: false, error: 'Agent configuration not found' };
      }

      const apiKey = await this.authSecrets.getProviderKey(
        `${PTAH_CLI_KEY_PREFIX}.${id}`
      );
      if (!apiKey) {
        return { success: false, error: 'API key not configured' };
      }

      // Create a temporary adapter for the test (not cached)
      const testAdapter = new PtahCliAdapter(
        agentConfig,
        apiKey,
        this.logger,
        this.moduleLoader,
        this.messageTransformer,
        this.permissionHandler
      );
      const initSuccess = await testAdapter.initialize();
      if (!initSuccess) {
        return { success: false, error: 'Failed to initialize adapter' };
      }

      // Use a test query with abort timeout
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
            // Bypass acceptable here: one-shot test with maxTurns:1, no tools,
            // and a harmless "Say ok" prompt. No file/shell access possible.
            permissionMode: 'bypassPermissions' as const,
            allowDangerouslySkipPermissions: true,
            includePartialMessages: false,
            // Only pass platform-essential + auth vars; never spread process.env wholesale
            env: buildSafeEnv(testAdapter['authEnv']),
          } as Options,
        });

        // Consume at least one message to confirm connectivity
        let receivedResponse = false;
        for await (const msg of testQuery) {
          receivedResponse = true;
          // We only need one message to confirm the connection works
          break;
        }

        const latencyMs = Date.now() - startTime;

        if (receivedResponse) {
          this.logger.info(
            `[PtahCliRegistry] Connection test PASSED for agent ${id} (${latencyMs}ms)`
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
        `[PtahCliRegistry] Connection test FAILED for agent ${id} (${latencyMs}ms): ${errorMsg}`
      );

      return {
        success: false,
        latencyMs,
        error: this.sanitizeErrorMessage(errorMsg),
      };
    }
  }

  /**
   * Get list of available Anthropic-compatible providers from the registry
   *
   * @returns Array of provider definitions
   */
  getAvailableProviders(): AnthropicProvider[] {
    return [...ANTHROPIC_PROVIDERS];
  }

  /**
   * Spawn a headless Ptah CLI agent as a background worker.
   * Returns an SdkHandle compatible with AgentProcessManager.spawnFromSdkHandle().
   *
   * @param id - Ptah CLI agent ID
   * @param task - Task prompt for the agent
   * @param projectGuidance - Optional project-specific guidance to append to system prompt
   * @returns SdkHandle + agentName, or undefined if agent not found / no API key
   */
  async spawnAgent(
    id: string,
    task: string,
    projectGuidance?: string
  ): Promise<{ handle: SdkHandle; agentName: string } | SpawnAgentFailure> {
    // Find config
    const configs = this.loadConfigs();
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

    // Get API key
    const apiKey = await this.authSecrets.getProviderKey(
      `${PTAH_CLI_KEY_PREFIX}.${id}`
    );
    if (!apiKey) {
      this.logger.warn(
        `[PtahCliRegistry] spawnAgent: no API key for agent: ${id}`
      );
      return {
        status: 'no_api_key',
        message: `No API key configured for Ptah CLI agent "${id}"`,
      };
    }

    // Resolve provider
    const provider = getAnthropicProvider(agentConfig.providerId);
    if (!provider) {
      this.logger.error(
        `[PtahCliRegistry] spawnAgent: unknown provider: ${agentConfig.providerId}`
      );
      return {
        status: 'unknown_provider',
        message: `Unknown provider "${agentConfig.providerId}" for Ptah CLI agent "${id}"`,
      };
    }

    // Build isolated AuthEnv
    const authEnv = createEmptyAuthEnv();
    authEnv.ANTHROPIC_BASE_URL = provider.baseUrl;
    const authEnvVar = getProviderAuthEnvVar(agentConfig.providerId);
    authEnv[authEnvVar] = apiKey;

    // Apply tier mappings
    if (agentConfig.tierMappings) {
      if (agentConfig.tierMappings.sonnet) {
        authEnv.ANTHROPIC_DEFAULT_SONNET_MODEL =
          agentConfig.tierMappings.sonnet;
      }
      if (agentConfig.tierMappings.opus) {
        authEnv.ANTHROPIC_DEFAULT_OPUS_MODEL = agentConfig.tierMappings.opus;
      }
      if (agentConfig.tierMappings.haiku) {
        authEnv.ANTHROPIC_DEFAULT_HAIKU_MODEL = agentConfig.tierMappings.haiku;
      }
    }

    seedStaticModelPricing(agentConfig.providerId);

    // Resolve model
    const model =
      agentConfig.selectedModel ??
      agentConfig.tierMappings?.sonnet ??
      provider.staticModels?.[0]?.id ??
      'claude-sonnet-4-20250514';

    // Build system prompt append with optional project guidance
    let systemPromptAppend = '';
    if (projectGuidance) {
      systemPromptAppend = `\n\n## Project Guidance\n${projectGuidance}`;
    }

    // Get query function
    const queryFn = await this.moduleLoader.getQueryFunction();

    // Build abort controller
    const abortController = new AbortController();

    // Output callbacks
    const outputCallbacks: ((data: string) => void)[] = [];

    // Start SDK query
    const sdkQuery = queryFn({
      prompt: task,
      options: {
        abortController,
        model,
        maxTurns: 25,
        systemPrompt: {
          type: 'preset' as const,
          preset: 'claude_code' as const,
          ...(systemPromptAppend ? { append: systemPromptAppend } : {}),
        },
        tools: {
          type: 'preset' as const,
          preset: 'claude_code' as const,
        },
        permissionMode: 'default',
        includePartialMessages: false,
        persistSession: false,
        env: buildSafeEnv(authEnv),
      } as Options,
    });

    // Consume the async iterable in background, forwarding text to callbacks
    const done = new Promise<number>((resolve) => {
      (async () => {
        try {
          for await (const msg of sdkQuery) {
            // Extract text content from assistant messages
            if (msg.type === 'assistant' && msg.message?.content) {
              const content = msg.message.content;
              if (Array.isArray(content)) {
                for (const block of content) {
                  if (block.type === 'text' && typeof block.text === 'string') {
                    for (const cb of outputCallbacks) {
                      cb(block.text);
                    }
                  }
                }
              }
            }
            // Extract text deltas from stream events
            if (
              msg.type === 'stream_event' &&
              msg.event?.type === 'content_block_delta'
            ) {
              const eventRecord = msg.event as unknown as Record<
                string,
                unknown
              >;
              const delta = eventRecord['delta'] as
                | Record<string, unknown>
                | undefined;
              if (
                delta?.['type'] === 'text_delta' &&
                typeof delta['text'] === 'string'
              ) {
                for (const cb of outputCallbacks) {
                  cb(delta['text']);
                }
              }
            }
          }
          resolve(0);
        } catch (error) {
          const rawMessage =
            error instanceof Error ? error.message : String(error);
          const isAbort =
            rawMessage.includes('abort') || rawMessage.includes('cancel');
          if (!isAbort) {
            this.logger.error(
              `[PtahCliRegistry] spawnAgent query error: ${rawMessage}`
            );
            // Forward sanitized error message to output (strips API keys, tokens, stack traces)
            const sanitized = this.sanitizeErrorMessage(rawMessage);
            for (const cb of outputCallbacks) {
              cb(`\n[Error: ${sanitized}]\n`);
            }
          }
          resolve(1);
        }
      })();
    });

    const handle: SdkHandle = {
      abort: abortController,
      done,
      onOutput: (callback) => {
        outputCallbacks.push(callback);
      },
    };

    this.logger.info(
      `[PtahCliRegistry] Spawned headless agent "${agentConfig.name}" (${id}) with model ${model}`
    );

    return { handle, agentName: agentConfig.name };
  }

  /**
   * Dispose all active adapters
   */
  disposeAll(): void {
    this.logger.info(
      `[PtahCliRegistry] Disposing ${this.adapters.size} active adapters`
    );

    for (const [id, adapter] of this.adapters.entries()) {
      this.logger.debug(`[PtahCliRegistry] Disposing adapter: ${id}`);
      adapter.dispose();
    }

    this.adapters.clear();
    this.logger.info('[PtahCliRegistry] All adapters disposed');
  }

  // ============================================================================
  // Migration
  // ============================================================================

  /**
   * Ensure legacy config/secret migration has run exactly once.
   * Safe to call multiple times; the migration promise is cached.
   */
  private async ensureMigrated(): Promise<void> {
    if (!this.migrationPromise) {
      this.migrationPromise = this.migrateFromLegacyKeys();
    }
    return this.migrationPromise;
  }

  /**
   * One-time migration from legacy customAgents config key and secret prefix.
   * Reads from old key, writes to new key, migrates secret storage prefixes.
   */
  private async migrateFromLegacyKeys(): Promise<void> {
    const LEGACY_CONFIG_KEY = 'customAgents';
    const LEGACY_KEY_PREFIX = 'customAgent';

    const legacyConfigs = this.config.getWithDefault<PtahCliConfig[]>(
      LEGACY_CONFIG_KEY,
      []
    );
    if (legacyConfigs.length === 0) return;

    const currentConfigs = this.config.getWithDefault<PtahCliConfig[]>(
      PTAH_CLI_AGENTS_CONFIG_KEY,
      []
    );
    if (currentConfigs.length > 0) return;

    this.logger.info(
      '[PtahCliRegistry] Migrating legacy customAgents config...'
    );

    await this.config.set(PTAH_CLI_AGENTS_CONFIG_KEY, legacyConfigs);

    for (const agentConfig of legacyConfigs) {
      try {
        const legacyKey = await this.authSecrets.getProviderKey(
          `${LEGACY_KEY_PREFIX}.${agentConfig.id}`
        );
        if (legacyKey) {
          await this.authSecrets.setProviderKey(
            `${PTAH_CLI_KEY_PREFIX}.${agentConfig.id}`,
            legacyKey
          );
          await this.authSecrets.deleteProviderKey(
            `${LEGACY_KEY_PREFIX}.${agentConfig.id}`
          );
        }
      } catch {
        this.logger.warn(
          `[PtahCliRegistry] Failed to migrate secret for agent ${agentConfig.id}`
        );
      }
    }

    await this.config.set(LEGACY_CONFIG_KEY, undefined);

    this.logger.info(
      `[PtahCliRegistry] Migrated ${legacyConfigs.length} agents to new config key`
    );
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  /**
   * Sanitize error messages before forwarding to output callbacks or users.
   *
   * Third-party API error messages may contain sensitive information such as
   * API keys, account IDs, internal URLs, or stack traces. This method strips
   * those patterns while preserving the actionable error description.
   *
   * @param message - Raw error message from provider
   * @returns Sanitized message safe for user-facing output
   */
  private sanitizeErrorMessage(message: string): string {
    let sanitized = message;
    // Strip potential API key patterns (sk-*, key-*, token-* followed by 20+ alphanum chars)
    sanitized = sanitized.replace(
      /\b(sk-|key-|token-)[A-Za-z0-9_-]{20,}\b/g,
      '[REDACTED]'
    );
    // Strip long hex/base64 strings that look like secrets (40+ chars)
    sanitized = sanitized.replace(/\b[A-Za-z0-9+/=_-]{40,}\b/g, '[REDACTED]');
    // Strip URLs with auth credentials (user:pass@host or tokens in query strings)
    sanitized = sanitized.replace(
      /https?:\/\/[^\s]*[:@][^\s]*/g,
      '[REDACTED_URL]'
    );
    // Strip stack traces (lines starting with "at ")
    sanitized = sanitized
      .replace(/^\s*at\s+.+$/gm, '')
      .replace(/\n{2,}/g, '\n');
    // Truncate to max 500 chars to prevent log flooding
    if (sanitized.length > 500) {
      sanitized = sanitized.substring(0, 497) + '...';
    }
    return sanitized.trim();
  }

  /**
   * Load Ptah CLI configs from ConfigManager
   */
  private loadConfigs(): PtahCliConfig[] {
    return this.config.getWithDefault<PtahCliConfig[]>(
      PTAH_CLI_AGENTS_CONFIG_KEY,
      []
    );
  }

  /**
   * Save Ptah CLI configs to ConfigManager
   */
  private async saveConfigs(configs: PtahCliConfig[]): Promise<void> {
    await this.config.set(PTAH_CLI_AGENTS_CONFIG_KEY, configs);
  }

  /**
   * Build default tier mappings from a provider's static models
   *
   * Strategy:
   * - If provider has static models, use the first as sonnet tier
   * - Other tiers are left undefined (SDK falls back to sonnet)
   */
  private buildDefaultTierMappings(
    provider: AnthropicProvider
  ): PtahCliConfig['tierMappings'] {
    if (!provider.staticModels || provider.staticModels.length === 0) {
      return undefined;
    }

    // Use first model as the sonnet tier (most commonly used)
    return {
      sonnet: provider.staticModels[0].id,
    };
  }
}
