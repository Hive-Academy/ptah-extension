/**
 * Custom Agent Registry - Manages lifecycle of CustomAgentAdapter instances
 *
 * DI-injectable singleton that handles CRUD operations for custom agent
 * configurations and lazily creates/caches adapter instances.
 *
 * Storage:
 * - Config: ConfigManager (VS Code workspace settings) under `customAgents`
 * - API keys: AuthSecretsService (VS Code SecretStorage) under `customAgent.{id}`
 *
 * @see TASK_2025_167 Batch 2 - Custom Agent Adapter + Registry
 */

import { randomUUID } from 'node:crypto';
import { injectable, inject } from 'tsyringe';
import {
  type AuthEnv,
  type CustomAgentConfig,
  type CustomAgentSummary,
  type CustomAgentState,
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
import { CustomAgentAdapter } from './custom-agent-adapter';

/**
 * Secret key prefix for custom agent API keys
 * Full key format: `customAgent.{agentId}`
 */
const CUSTOM_AGENT_KEY_PREFIX = 'customAgent';

/**
 * Config key for custom agent configurations in ConfigManager
 */
const CUSTOM_AGENTS_CONFIG_KEY = 'customAgents';

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
 * Generate a cryptographically random ID for new custom agent instances.
 * Uses crypto.randomUUID() for unpredictable identifiers with `ca-` prefix
 * for visual identification as a custom agent ID.
 */
function generateAgentId(): string {
  return `ca-${randomUUID()}`;
}

/**
 * CustomAgentRegistry - Manages the lifecycle of CustomAgentAdapter instances
 *
 * Responsibilities:
 * - CRUD operations for custom agent configurations
 * - API key storage via AuthSecretsService
 * - Lazy initialization and caching of adapter instances
 * - Connection testing for validation
 * - Provider listing for UI
 */
@injectable()
export class CustomAgentRegistry {
  /** Cached adapter instances (lazy-initialized) */
  private adapters = new Map<string, CustomAgentAdapter>();

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
    this.logger.info('[CustomAgentRegistry] Registry initialized');
  }

  /**
   * List all configured custom agents with their status
   *
   * Loads configs from ConfigManager and checks API key existence
   * for each agent to determine status.
   */
  async listAgents(): Promise<CustomAgentSummary[]> {
    const configs = this.loadConfigs();
    const summaries: CustomAgentSummary[] = [];

    for (const agentConfig of configs) {
      const hasKey = await this.authSecrets.hasProviderKey(
        `${CUSTOM_AGENT_KEY_PREFIX}.${agentConfig.id}`
      );

      const provider = getAnthropicProvider(agentConfig.providerId);
      const modelCount = provider?.staticModels?.length ?? 0;

      // Determine status based on adapter state
      let status: CustomAgentState['status'] = 'unconfigured';
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

    this.logger.info(`[CustomAgentRegistry] Listed ${summaries.length} agents`);

    return summaries;
  }

  /**
   * Create a new custom agent configuration
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
  ): Promise<CustomAgentSummary> {
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
    const newConfig: CustomAgentConfig = {
      id,
      name,
      providerId,
      enabled: true,
      tierMappings,
      updatedAt: Date.now(),
    };

    // Save config to ConfigManager
    const configs = this.loadConfigs();
    configs.push(newConfig);
    await this.saveConfigs(configs);

    // Save API key to AuthSecretsService
    await this.authSecrets.setProviderKey(
      `${CUSTOM_AGENT_KEY_PREFIX}.${id}`,
      apiKey
    );

    this.logger.info(
      `[CustomAgentRegistry] Created agent "${name}" (${id}) for provider "${provider.name}"`
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
   * Update an existing custom agent configuration
   *
   * @param id - Agent ID to update
   * @param updates - Partial config updates
   * @param apiKey - Optional new API key
   */
  async updateAgent(
    id: string,
    updates: Partial<
      Pick<
        CustomAgentConfig,
        'name' | 'enabled' | 'tierMappings' | 'selectedModel'
      >
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
    const updated: CustomAgentConfig = {
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
        `${CUSTOM_AGENT_KEY_PREFIX}.${id}`,
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
      `[CustomAgentRegistry] Updated agent "${updated.name}" (${id})`
    );
  }

  /**
   * Delete a custom agent configuration
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
      this.logger.warn(
        `[CustomAgentRegistry] Agent not found for deletion: ${id}`
      );
      return;
    }
    await this.saveConfigs(filtered);

    // Delete API key
    await this.authSecrets.deleteProviderKey(
      `${CUSTOM_AGENT_KEY_PREFIX}.${id}`
    );

    this.logger.info(`[CustomAgentRegistry] Deleted agent: ${id}`);
  }

  /**
   * Get or create (lazy init) an adapter instance for a given agent ID
   *
   * @param id - Agent ID
   * @returns Initialized adapter, or undefined if config/key not found
   */
  async getAdapter(id: string): Promise<CustomAgentAdapter | undefined> {
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
      this.logger.warn(`[CustomAgentRegistry] Agent config not found: ${id}`);
      return undefined;
    }

    // Get API key
    const apiKey = await this.authSecrets.getProviderKey(
      `${CUSTOM_AGENT_KEY_PREFIX}.${id}`
    );
    if (!apiKey) {
      this.logger.warn(`[CustomAgentRegistry] No API key for agent: ${id}`);
      return undefined;
    }

    // Create and initialize adapter with hook/compaction services
    const adapter = new CustomAgentAdapter(
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
        `[CustomAgentRegistry] Failed to initialize adapter for agent: ${id}`
      );
      return undefined;
    }

    // Cache the initialized adapter
    this.adapters.set(id, adapter);

    this.logger.info(
      `[CustomAgentRegistry] Created and initialized adapter for agent "${agentConfig.name}" (${id})`
    );

    return adapter;
  }

  /**
   * Test connection to a custom agent's provider
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
      // Get or create the adapter
      const adapter = await this.getAdapter(id);
      if (!adapter) {
        return {
          success: false,
          error: 'Agent not found or API key not configured',
        };
      }

      // Attempt a minimal query to test connectivity
      // We create a one-shot query with a simple prompt
      const queryFn = await this.moduleLoader.getQueryFunction();

      // Build minimal test options
      const configs = this.loadConfigs();
      const agentConfig = configs.find((c) => c.id === id);
      if (!agentConfig) {
        return { success: false, error: 'Agent configuration not found' };
      }

      const apiKey = await this.authSecrets.getProviderKey(
        `${CUSTOM_AGENT_KEY_PREFIX}.${id}`
      );
      if (!apiKey) {
        return { success: false, error: 'API key not configured' };
      }

      // Create a temporary adapter just for the test if needed
      const testAdapter = new CustomAgentAdapter(
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
            model: adapter['resolveModel'](),
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
            env: this.buildSafeEnv(testAdapter['authEnv']),
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
            `[CustomAgentRegistry] Connection test PASSED for agent ${id} (${latencyMs}ms)`
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
        `[CustomAgentRegistry] Connection test FAILED for agent ${id} (${latencyMs}ms): ${errorMsg}`
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
   * Spawn a headless custom agent as a background worker.
   * Returns an SdkHandle compatible with AgentProcessManager.spawnFromSdkHandle().
   *
   * @param id - Custom agent ID
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
      this.logger.warn(
        `[CustomAgentRegistry] spawnAgent: config not found: ${id}`
      );
      return {
        status: 'not_found',
        message: `Custom agent "${id}" not found in configuration`,
      };
    }

    if (!agentConfig.enabled) {
      this.logger.warn(
        `[CustomAgentRegistry] spawnAgent: agent disabled: ${id}`
      );
      return {
        status: 'disabled',
        message: `Custom agent "${id}" is disabled`,
      };
    }

    // Get API key
    const apiKey = await this.authSecrets.getProviderKey(
      `${CUSTOM_AGENT_KEY_PREFIX}.${id}`
    );
    if (!apiKey) {
      this.logger.warn(
        `[CustomAgentRegistry] spawnAgent: no API key for agent: ${id}`
      );
      return {
        status: 'no_api_key',
        message: `No API key configured for custom agent "${id}"`,
      };
    }

    // Resolve provider
    const provider = getAnthropicProvider(agentConfig.providerId);
    if (!provider) {
      this.logger.error(
        `[CustomAgentRegistry] spawnAgent: unknown provider: ${agentConfig.providerId}`
      );
      return {
        status: 'unknown_provider',
        message: `Unknown provider "${agentConfig.providerId}" for custom agent "${id}"`,
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
        env: this.buildSafeEnv(authEnv),
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
              `[CustomAgentRegistry] spawnAgent query error: ${rawMessage}`
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
      `[CustomAgentRegistry] Spawned headless agent "${agentConfig.name}" (${id}) with model ${model}`
    );

    return { handle, agentName: agentConfig.name };
  }

  /**
   * Dispose all active adapters
   */
  disposeAll(): void {
    this.logger.info(
      `[CustomAgentRegistry] Disposing ${this.adapters.size} active adapters`
    );

    for (const [id, adapter] of this.adapters.entries()) {
      this.logger.debug(`[CustomAgentRegistry] Disposing adapter: ${id}`);
      adapter.dispose();
    }

    this.adapters.clear();
    this.logger.info('[CustomAgentRegistry] All adapters disposed');
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
   * Build a minimal environment for custom agent processes.
   *
   * Only passes platform-essential variables (PATH, HOME, TEMP, etc.)
   * plus the provider-specific auth variables (e.g., ANTHROPIC_API_KEY,
   * ANTHROPIC_BASE_URL, tier mappings). This prevents leaking sensitive
   * host environment variables to third-party API endpoints.
   *
   * @param authEnv - Provider-specific environment variables
   * @returns Minimal env safe for custom agent processes
   */
  private buildSafeEnv(authEnv: AuthEnv): Record<string, string | undefined> {
    return {
      // Platform essentials for process execution
      PATH: process.env['PATH'],
      HOME: process.env['HOME'],
      USERPROFILE: process.env['USERPROFILE'],
      // Temp directories (cross-platform)
      TMPDIR: process.env['TMPDIR'],
      TEMP: process.env['TEMP'],
      TMP: process.env['TMP'],
      // Windows system essentials
      APPDATA: process.env['APPDATA'],
      LOCALAPPDATA: process.env['LOCALAPPDATA'],
      SystemRoot: process.env['SystemRoot'],
      COMSPEC: process.env['COMSPEC'],
      // Locale
      LANG: process.env['LANG'],
      // Provider-specific auth and config (e.g., ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL)
      ...authEnv,
    };
  }

  /**
   * Load custom agent configs from ConfigManager
   */
  private loadConfigs(): CustomAgentConfig[] {
    return this.config.getWithDefault<CustomAgentConfig[]>(
      CUSTOM_AGENTS_CONFIG_KEY,
      []
    );
  }

  /**
   * Save custom agent configs to ConfigManager
   */
  private async saveConfigs(configs: CustomAgentConfig[]): Promise<void> {
    await this.config.set(CUSTOM_AGENTS_CONFIG_KEY, configs);
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
  ): CustomAgentConfig['tierMappings'] {
    if (!provider.staticModels || provider.staticModels.length === 0) {
      return undefined;
    }

    // Use first model as the sonnet tier (most commonly used)
    return {
      sonnet: provider.staticModels[0].id,
    };
  }
}
