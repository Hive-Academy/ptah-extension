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
  type CliOutputSegment,
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
import type { ProviderModelsService } from '../provider-models.service';
import {
  ANTHROPIC_PROVIDERS,
  getAnthropicProvider,
  getProviderAuthEnvVar,
  seedStaticModelPricing,
  type AnthropicProvider,
} from '../helpers/anthropic-provider-registry';
import type { Options } from '../types/sdk-types/claude-sdk.types';
import {
  isStreamEvent,
  isAssistantMessage,
  isResultMessage,
  isSuccessResult,
  isErrorResult,
  isSystemInit,
  isCompactBoundary,
  isUserMessage,
  isToolProgress,
  isToolUseSummary,
  isContentBlockStart,
  isContentBlockDelta,
  isTextBlock,
  isToolUseBlock,
  isThinkingBlock,
  isTextDelta,
  isInputJsonDelta,
  isThinkingDelta,
} from '../types/sdk-types/claude-sdk.types';
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
    private readonly compactionConfigProvider: CompactionConfigProvider,
    @inject(SDK_TOKENS.SDK_PROVIDER_MODELS)
    private readonly providerModels: ProviderModelsService
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

    // Resolve effective tiers (agent override > main settings > provider default)
    const provider = getAnthropicProvider(agentConfig.providerId);
    const effectiveTiers = provider
      ? this.resolveEffectiveTiers(agentConfig, provider)
      : agentConfig.tierMappings;
    const configWithTiers: PtahCliConfig = {
      ...agentConfig,
      tierMappings: effectiveTiers,
    };

    // Create and initialize adapter with hook/compaction services
    const adapter = new PtahCliAdapter(
      configWithTiers,
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

      // Resolve effective tiers for the test adapter
      const testProvider = getAnthropicProvider(agentConfig.providerId);
      const testTiers = testProvider
        ? this.resolveEffectiveTiers(agentConfig, testProvider)
        : agentConfig.tierMappings;
      const testConfig: PtahCliConfig = {
        ...agentConfig,
        tierMappings: testTiers,
      };

      // Create a temporary adapter for the test (not cached)
      const testAdapter = new PtahCliAdapter(
        testConfig,
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

    // Apply effective tier mappings (agent override > main settings > provider default)
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

    seedStaticModelPricing(agentConfig.providerId);

    // Resolve model for SDK: must use a valid Anthropic model name.
    // Custom provider models (e.g., "kimi-k2") are routed via
    // ANTHROPIC_DEFAULT_SONNET_MODEL env var, not the model param.
    // The SDK validates model names against Anthropic's list before
    // consulting env vars, so passing "kimi-k2" directly would fail.
    const model = 'claude-sonnet-4-20250514';

    // Build system prompt append with optional project guidance
    let systemPromptAppend = '';
    if (projectGuidance) {
      systemPromptAppend = `\n\n## Project Guidance\n${projectGuidance}`;
    }

    // Get query function
    const queryFn = await this.moduleLoader.getQueryFunction();

    // Build abort controller
    const abortController = new AbortController();

    // Output callbacks (raw text — backward compatible)
    const outputCallbacks: ((data: string) => void)[] = [];

    // Structured segment buffering (same pattern as Copilot/Gemini adapters)
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

    // Consume the async iterable in background, forwarding structured
    // segments and raw text to registered callbacks.
    //
    // Uses Claude Agent SDK type guards to handle each SDKMessage variant
    // natively rather than pattern-matching on raw field values.
    const done = new Promise<number>((resolve) => {
      (async () => {
        // Track streaming state to avoid duplicate emissions
        let receivedTextDeltas = false;
        let receivedThinkingDeltas = false;
        // Accumulate tool_use input_json_delta fragments per content block index
        const pendingToolArgs = new Map<
          number,
          { name: string; id: string; jsonFragments: string[] }
        >();

        try {
          for await (const msg of sdkQuery) {
            // ── system init ─────────────────────────────────
            if (isSystemInit(msg)) {
              const model = msg.model ?? 'unknown';
              emitOutput(`[PtahCli] Session started (model: ${model})\n`);
              emitSegment({
                type: 'info',
                content: `Session started: ${msg.session_id} (model: ${model})`,
              });
              continue;
            }

            // ── compact_boundary ────────────────────────────
            if (isCompactBoundary(msg)) {
              const tokens = msg.compact_metadata?.pre_tokens;
              const content = tokens
                ? `Context compaction (${tokens} tokens before)`
                : 'Context compaction';
              emitOutput(`\n[${content}]\n`);
              emitSegment({ type: 'info', content });
              continue;
            }

            // ── stream_event (streaming deltas) ─────────────
            if (isStreamEvent(msg)) {
              const event = msg.event;

              // content_block_start: detect tool_use / thinking / text block starts
              if (isContentBlockStart(event)) {
                const block = event.content_block;
                if (isToolUseBlock(block)) {
                  const argsStr = this.summarizeToolInput(block.input);
                  pendingToolArgs.set(event.index, {
                    name: block.name,
                    id: block.id,
                    jsonFragments: [],
                  });
                  emitOutput(
                    `\n**Tool:** \`${block.name}\`${
                      argsStr ? ` ${argsStr}` : ''
                    }\n`
                  );
                  emitSegment({
                    type: 'tool-call',
                    content: '',
                    toolName: block.name,
                    toolArgs: argsStr,
                  });
                }
                continue;
              }

              // content_block_delta: streaming content
              if (isContentBlockDelta(event)) {
                const delta = event.delta;

                if (isTextDelta(delta)) {
                  receivedTextDeltas = true;
                  emitOutput(delta.text);
                  emitSegment({ type: 'text', content: delta.text });
                } else if (isThinkingDelta(delta)) {
                  receivedThinkingDeltas = true;
                  emitSegment({ type: 'thinking', content: delta.thinking });
                } else if (isInputJsonDelta(delta)) {
                  // Accumulate tool input JSON fragments
                  const pending = pendingToolArgs.get(event.index);
                  if (pending) {
                    pending.jsonFragments.push(delta.partial_json);
                  }
                }
                continue;
              }

              // Other stream events (message_start, message_delta, etc.)
              // are structural — no user-visible segments needed
              continue;
            }

            // ── assistant (complete message — fallback if no streaming) ──
            if (isAssistantMessage(msg)) {
              const blocks = msg.message?.content;
              if (Array.isArray(blocks)) {
                for (const block of blocks) {
                  if (isTextBlock(block)) {
                    if (!receivedTextDeltas) {
                      emitOutput(block.text);
                      emitSegment({ type: 'text', content: block.text });
                    }
                  } else if (isToolUseBlock(block)) {
                    // Tool calls may already have been emitted via
                    // content_block_start; only emit if no streaming
                    if (!receivedTextDeltas) {
                      const argsStr = this.summarizeToolInput(block.input);
                      emitOutput(
                        `\n**Tool:** \`${block.name}\`${
                          argsStr ? ` ${argsStr}` : ''
                        }\n`
                      );
                      emitSegment({
                        type: 'tool-call',
                        content: '',
                        toolName: block.name,
                        toolArgs: argsStr,
                      });
                    }
                  } else if (isThinkingBlock(block)) {
                    if (!receivedThinkingDeltas) {
                      emitSegment({
                        type: 'thinking',
                        content: block.thinking,
                      });
                    }
                  }
                }
              }
              // Reset streaming flags for next turn
              receivedTextDeltas = false;
              receivedThinkingDeltas = false;
              pendingToolArgs.clear();
              continue;
            }

            // ── user message (contains tool results) ────────
            if (isUserMessage(msg)) {
              const content = msg.message?.content;
              if (Array.isArray(content)) {
                for (const block of content) {
                  if (block.type === 'tool_result') {
                    const resultText =
                      typeof block.content === 'string'
                        ? block.content
                        : Array.isArray(block.content)
                        ? block.content
                            .filter(
                              (b): b is { type: 'text'; text: string } =>
                                b.type === 'text'
                            )
                            .map((b) => b.text)
                            .join('\n')
                        : '';
                    const truncated =
                      resultText.length > 2000
                        ? resultText.substring(0, 2000) + '\n... [truncated]'
                        : resultText;

                    if (block.is_error) {
                      emitOutput(`\n**Tool Error:** ${truncated}\n`);
                      emitSegment({
                        type: 'tool-result-error',
                        content: truncated,
                      });
                    } else {
                      emitOutput(
                        `\n<details><summary>Tool result</summary>\n\n\`\`\`\n${truncated}\n\`\`\`\n</details>\n\n`
                      );
                      emitSegment({
                        type: 'tool-result',
                        content: truncated,
                      });
                    }
                  }
                }
              }
              continue;
            }

            // ── result (final message with usage) ───────────
            if (isResultMessage(msg)) {
              if (isSuccessResult(msg)) {
                const parts: string[] = [];
                if (msg.usage) {
                  parts.push(`${msg.usage.input_tokens} input`);
                  parts.push(`${msg.usage.output_tokens} output`);
                }
                if (msg.total_cost_usd !== undefined) {
                  parts.push(`$${msg.total_cost_usd.toFixed(4)}`);
                }
                if (msg.duration_ms !== undefined) {
                  parts.push(`${(msg.duration_ms / 1000).toFixed(1)}s`);
                }
                parts.push(`${msg.num_turns} turns`);
                const usageStr = `Completed: ${parts.join(', ')}`;
                emitOutput(`\n[${usageStr}]\n`);
                emitSegment({ type: 'info', content: usageStr });
              } else if (isErrorResult(msg)) {
                const errorMsg =
                  msg.errors?.join('; ') ?? `Error: ${msg.subtype}`;
                emitOutput(`\n[Error: ${errorMsg}]\n`);
                emitSegment({ type: 'error', content: errorMsg });
              }
              continue;
            }

            // ── tool_progress ───────────────────────────────
            if (isToolProgress(msg)) {
              emitSegment({
                type: 'info',
                content: `${
                  msg.tool_name
                } running (${msg.elapsed_time_seconds.toFixed(0)}s)`,
              });
              continue;
            }

            // ── tool_use_summary ────────────────────────────
            if (isToolUseSummary(msg)) {
              emitOutput(`\n${msg.summary}\n`);
              emitSegment({ type: 'info', content: msg.summary });
              continue;
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
            emitOutput(`\n[Error: ${sanitized}]\n`);
            emitSegment({ type: 'error', content: sanitized });
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
      onSegment,
    };

    const providerModel =
      effectiveTiers?.sonnet ?? provider.staticModels?.[0]?.id ?? 'default';
    this.logger.info(
      `[PtahCliRegistry] Spawned headless agent "${agentConfig.name}" (${id}) with model ${providerModel} (SDK model: ${model})`
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
   * Summarize tool input for display in structured segments.
   *
   * Extracts the most useful field from the tool input object
   * (e.g., file_path for file tools, command for shell tools)
   * and truncates to a readable length.
   *
   * @param input - Raw tool input from SDK ToolUseBlock
   * @returns Human-readable summary string, or undefined if empty
   */
  private summarizeToolInput(
    input: Record<string, unknown> | undefined
  ): string | undefined {
    if (!input || Object.keys(input).length === 0) return undefined;

    // Prioritize the most informative field
    const displayField =
      input['file_path'] ??
      input['command'] ??
      input['path'] ??
      input['query'] ??
      input['pattern'] ??
      input['url'];

    if (typeof displayField === 'string') {
      const truncated =
        displayField.length > 120
          ? displayField.substring(0, 117) + '...'
          : displayField;
      return truncated;
    }

    // Fallback: stringify first few keys
    try {
      const str = JSON.stringify(input);
      return str.length > 150 ? str.substring(0, 147) + '...' : str;
    } catch {
      return undefined;
    }
  }

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
   * Resolve effective tier mappings for a Ptah CLI agent.
   *
   * Priority (highest wins):
   * 1. Per-agent tierMappings stored in PtahCliConfig (agent-level override)
   * 2. Main agent settings from ProviderModelsService (global provider config)
   * 3. Provider's first static model as sonnet fallback
   *
   * This ensures Ptah CLI agents inherit model tiers configured in the main
   * settings UI unless the agent has its own explicit override.
   */
  private resolveEffectiveTiers(
    agentConfig: PtahCliConfig,
    provider: AnthropicProvider
  ): PtahCliConfig['tierMappings'] {
    // Read global tier mappings from main agent settings
    const mainTiers = this.providerModels.getModelTiers(agentConfig.providerId);

    // Per-agent overrides (if set)
    const agentTiers = agentConfig.tierMappings;

    // Merge: agent-level > main settings > provider default
    const defaultSonnet = provider.staticModels?.[0]?.id ?? undefined;

    const sonnet =
      agentTiers?.sonnet || mainTiers.sonnet || defaultSonnet || undefined;
    const opus = agentTiers?.opus || mainTiers.opus || undefined;
    const haiku = agentTiers?.haiku || mainTiers.haiku || undefined;

    if (!sonnet && !opus && !haiku) {
      return undefined;
    }

    this.logger.debug(
      `[PtahCliRegistry] Resolved effective tiers for "${agentConfig.name}"`,
      {
        agentTiers,
        mainTiers,
        resolved: { sonnet, opus, haiku },
      }
    );

    return {
      ...(sonnet ? { sonnet } : {}),
      ...(opus ? { opus } : {}),
      ...(haiku ? { haiku } : {}),
    };
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
