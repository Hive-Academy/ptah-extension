/**
 * Ptah CLI Adapter - IAIProvider for Anthropic-compatible providers
 *
 * Implements IAIProvider for user-configured Ptah CLI instances that connect
 * to third-party Anthropic-compatible providers (OpenRouter, Moonshot, Z.AI)
 * via the Claude Agent SDK's query() function.
 *
 * Key architecture decisions:
 * - NOT DI-injectable: Instances are created by PtahCliRegistry, not the DI container
 * - Fully independent from SdkAgentAdapter: Own AuthEnv, session tracking, stream transformation
 * - Shares STATELESS services: SdkModuleLoader, SdkMessageTransformer, SdkPermissionHandler
 *
 * @see TASK_2025_167 Batch 2 - Ptah CLI Adapter + Registry
 */

import {
  IAIProvider,
  ProviderId,
  ProviderInfo,
  ProviderHealth,
  ProviderStatus,
  ProviderCapabilities,
  AISessionConfig,
  AIMessageOptions,
  SessionId,
  FlatStreamEventUnion,
  AuthEnv,
  createEmptyAuthEnv,
  calculateMessageCost,
  ThinkingConfig,
  EffortLevel,
} from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import type { SdkModuleLoader } from '../helpers/sdk-module-loader';
import type { SdkMessageTransformer } from '../sdk-message-transformer';
import type { SdkPermissionHandler } from '../sdk-permission-handler';
import type { PtahCliConfig } from '@ptah-extension/shared';
import {
  getAnthropicProvider,
  getProviderAuthEnvVar,
  seedStaticModelPricing,
  resolveActualModelForPricing,
} from '../helpers/anthropic-provider-registry';
import {
  assembleSystemPromptAppend,
  getActiveProviderId,
  type SdkQueryOptions,
} from '../helpers/sdk-query-options-builder';
import { buildSafeEnv } from '../helpers/build-safe-env';
import type { SubagentHookHandler } from '../helpers/subagent-hook-handler';
import type { CompactionHookHandler } from '../helpers/compaction-hook-handler';
import type { CompactionConfigProvider } from '../helpers/compaction-config-provider';
import type { CompactionStartCallback } from '../helpers/compaction-hook-handler';
import type {
  SDKMessage,
  SDKUserMessage,
  Options,
  Query,
  UserMessageContent,
  McpHttpServerConfig,
  SdkPluginConfig,
  HookEvent,
  HookCallbackMatcher,
} from '../types/sdk-types/claude-sdk.types';
import {
  isResultMessage,
  isSystemInit,
  isCompactBoundary,
} from '../types/sdk-types/claude-sdk.types';

import { PTAH_MCP_PORT } from '../constants';

/**
 * Premium capabilities passed from the RPC handler layer.
 * These are resolved at chat:start / chat:continue time and passed
 * into startChatSession() / resumeSession() so the adapter can
 * configure the SDK query with full Ptah enhancements.
 */
export interface PtahCliPremiumConfig {
  /** Whether the user has a premium (Pro) license */
  isPremium?: boolean;
  /** Whether the MCP server is currently running */
  mcpServerRunning?: boolean;
  /** AI-generated enhanced prompts content */
  enhancedPromptsContent?: string;
  /** Resolved plugin directory paths */
  pluginPaths?: string[];
}

/**
 * Tracks an active session within the Ptah CLI adapter
 */
interface PtahCliActiveSession {
  readonly sessionId: SessionId;
  readonly abortController: AbortController;
  query: Query | null;
  messageQueue: SDKUserMessage[];
  resolveNext: (() => void) | null;
  currentModel: string;
}

/**
 * Provider capabilities for Ptah CLI adapter
 */
const PTAH_CLI_CAPABILITIES: ProviderCapabilities = {
  streaming: true,
  fileAttachments: true,
  contextManagement: true,
  sessionPersistence: true,
  multiTurn: true,
  codeGeneration: true,
  imageAnalysis: false,
  functionCalling: true,
};

/**
 * PtahCliAdapter - IAIProvider for Anthropic-compatible providers
 *
 * Created by PtahCliRegistry (NOT DI-injectable).
 * Each instance connects to a specific provider using its own AuthEnv,
 * session map, and stream transformation logic.
 */
export class PtahCliAdapter implements IAIProvider {
  readonly providerId: ProviderId = 'ptah-cli';
  readonly info: ProviderInfo;

  /** Isolated AuthEnv for this adapter instance */
  private authEnv: AuthEnv;

  /** Active sessions managed by this adapter */
  private activeSessions = new Map<string, PtahCliActiveSession>();

  /** Health status */
  private health: ProviderHealth = {
    status: 'initializing' as ProviderStatus,
    lastCheck: Date.now(),
  };

  /** Whether the adapter has been initialized */
  private initialized = false;

  /** The user's Ptah CLI configuration */
  private readonly config: PtahCliConfig;

  /** API key for this provider */
  private readonly apiKey: string;

  /** Shared stateless services */
  private readonly logger: Logger;
  private readonly moduleLoader: SdkModuleLoader;
  private readonly messageTransformer: SdkMessageTransformer;
  private readonly permissionHandler: SdkPermissionHandler;

  /** Optional hook handlers for subagent and compaction lifecycle */
  private readonly subagentHookHandler?: SubagentHookHandler;
  private readonly compactionHookHandler?: CompactionHookHandler;
  private readonly compactionConfigProvider?: CompactionConfigProvider;

  /**
   * Create a PtahCliAdapter for a specific provider configuration.
   *
   * @param config - User's Ptah CLI configuration
   * @param apiKey - The provider API key
   * @param logger - Logger instance (shared)
   * @param moduleLoader - SDK module loader (shared, stateless)
   * @param messageTransformer - Message-to-event converter (shared, stateless)
   * @param permissionHandler - Permission handler (shared, stateless)
   * @param subagentHookHandler - Optional subagent hook handler for lifecycle tracking
   * @param compactionHookHandler - Optional compaction hook handler for UI notification
   * @param compactionConfigProvider - Optional compaction config provider
   */
  constructor(
    config: PtahCliConfig,
    apiKey: string,
    logger: Logger,
    moduleLoader: SdkModuleLoader,
    messageTransformer: SdkMessageTransformer,
    permissionHandler: SdkPermissionHandler,
    subagentHookHandler?: SubagentHookHandler,
    compactionHookHandler?: CompactionHookHandler,
    compactionConfigProvider?: CompactionConfigProvider
  ) {
    this.config = config;
    this.apiKey = apiKey;
    this.logger = logger;
    this.moduleLoader = moduleLoader;
    this.messageTransformer = messageTransformer;
    this.permissionHandler = permissionHandler;
    this.subagentHookHandler = subagentHookHandler;
    this.compactionHookHandler = compactionHookHandler;
    this.compactionConfigProvider = compactionConfigProvider;

    // Create isolated AuthEnv (NOT the DI singleton)
    this.authEnv = createEmptyAuthEnv();

    // Build provider info from config
    const provider = getAnthropicProvider(config.providerId);
    this.info = {
      id: 'ptah-cli' as ProviderId,
      name: config.name,
      version: '1.0.0',
      description: provider
        ? `${provider.name} - ${provider.description}`
        : `Ptah CLI: ${config.name}`,
      vendor: provider?.name ?? 'Unknown',
      capabilities: PTAH_CLI_CAPABILITIES,
      maxContextTokens: 200000,
      supportedModels: [],
    };
  }

  /**
   * Get the Ptah CLI config ID
   */
  get agentId(): string {
    return this.config.id;
  }

  /**
   * Initialize the adapter by configuring its AuthEnv
   *
   * Steps:
   * 1. Look up provider from registry
   * 2. Set ANTHROPIC_BASE_URL to provider's API endpoint
   * 3. Set the auth env var (ANTHROPIC_AUTH_TOKEN or ANTHROPIC_API_KEY)
   * 4. Apply tier mappings from config
   * 5. Seed static model pricing
   * 6. Mark as healthy
   */
  async initialize(): Promise<boolean> {
    try {
      this.logger.info(
        `[PtahCliAdapter] Initializing adapter for "${this.config.name}" (provider: ${this.config.providerId})`
      );

      // Step 1: Look up provider definition
      const provider = getAnthropicProvider(this.config.providerId);
      if (!provider) {
        const errorMessage = `Unknown provider: ${this.config.providerId}`;
        this.logger.error(`[PtahCliAdapter] ${errorMessage}`);
        this.health = {
          status: 'error' as ProviderStatus,
          lastCheck: Date.now(),
          errorMessage,
        };
        return false;
      }

      // Step 2: Set base URL
      this.authEnv.ANTHROPIC_BASE_URL = provider.baseUrl;

      // Step 3: Set auth env var using the provider's configured key type
      const authEnvVar = getProviderAuthEnvVar(this.config.providerId);
      this.authEnv[authEnvVar] = this.apiKey;

      // Step 4: Apply tier mappings from config
      if (this.config.tierMappings) {
        if (this.config.tierMappings.sonnet) {
          this.authEnv.ANTHROPIC_DEFAULT_SONNET_MODEL =
            this.config.tierMappings.sonnet;
        }
        if (this.config.tierMappings.opus) {
          this.authEnv.ANTHROPIC_DEFAULT_OPUS_MODEL =
            this.config.tierMappings.opus;
        }
        if (this.config.tierMappings.haiku) {
          this.authEnv.ANTHROPIC_DEFAULT_HAIKU_MODEL =
            this.config.tierMappings.haiku;
        }
      }

      // Step 5: Seed static model pricing for the provider
      seedStaticModelPricing(this.config.providerId);

      // Step 6: Mark as healthy
      this.initialized = true;
      this.health = {
        status: 'available' as ProviderStatus,
        lastCheck: Date.now(),
        responseTime: 0,
        uptime: Date.now(),
      };

      this.logger.info(
        `[PtahCliAdapter] Initialized successfully for "${this.config.name}"`,
        {
          baseUrl: provider.baseUrl,
          authEnvVar,
          hasTierMappings: !!this.config.tierMappings,
          sonnetModel: this.authEnv.ANTHROPIC_DEFAULT_SONNET_MODEL ?? 'default',
          opusModel: this.authEnv.ANTHROPIC_DEFAULT_OPUS_MODEL ?? 'default',
          haikuModel: this.authEnv.ANTHROPIC_DEFAULT_HAIKU_MODEL ?? 'default',
        }
      );

      return true;
    } catch (error) {
      const errorObj =
        error instanceof Error ? error : new Error(String(error));
      this.logger.error(
        `[PtahCliAdapter] Initialization failed for "${this.config.name}"`,
        errorObj
      );
      this.health = {
        status: 'error' as ProviderStatus,
        lastCheck: Date.now(),
        errorMessage: errorObj.message,
      };
      return false;
    }
  }

  /**
   * Start a new chat session with streaming support
   *
   * Creates an SDK query with isolated AuthEnv and returns an async iterable
   * of FlatStreamEventUnion events for UI rendering.
   */
  async startChatSession(
    config: AISessionConfig & {
      tabId: string;
      name?: string;
      prompt?: string;
      files?: string[];
    } & PtahCliPremiumConfig
  ): Promise<AsyncIterable<FlatStreamEventUnion>> {
    if (!this.initialized) {
      throw new Error(
        `PtahCliAdapter "${this.config.name}" not initialized. Call initialize() first.`
      );
    }

    const { tabId } = config;
    const trackingId = tabId as SessionId;

    this.logger.info(
      `[PtahCliAdapter] Starting chat session for tab: ${tabId}`,
      { agentName: this.config.name, providerId: this.config.providerId }
    );

    // Determine the model to use
    const model = this.resolveModel(config.model);

    // Create abort controller for this session
    const abortController = new AbortController();

    // Create and register session
    const session: PtahCliActiveSession = {
      sessionId: trackingId,
      abortController,
      query: null,
      messageQueue: [],
      resolveNext: null,
      currentModel: model,
    };
    this.activeSessions.set(trackingId as string, session);

    // Queue initial prompt if provided
    if (config.prompt && config.prompt.trim()) {
      const userMessage = this.createSdkUserMessage(config.prompt);
      session.messageQueue.push(userMessage);
    }

    // Get SDK query function
    const queryFn = await this.moduleLoader.getQueryFunction();

    // Create user message stream
    const userMessageStream = this.createUserMessageStream(
      trackingId,
      abortController
    );

    // Build query options with isolated AuthEnv + premium capabilities
    const queryOptions = this.buildQueryOptions({
      userMessageStream,
      abortController,
      model,
      projectPath: config.projectPath,
      sessionId: trackingId as string,
      isPremium: config.isPremium,
      mcpServerRunning: config.mcpServerRunning,
      enhancedPromptsContent: config.enhancedPromptsContent,
      pluginPaths: config.pluginPaths,
      systemPrompt: config.systemPrompt,
      preset: config.preset,
      thinking: config.thinking,
      effort: config.effort,
    });

    // Start SDK query
    const sdkQuery = queryFn({
      prompt: queryOptions.prompt,
      options: queryOptions.options as Options,
    });

    // Set query on session
    session.query = sdkQuery;

    this.logger.info(
      `[PtahCliAdapter] Query started for session: ${trackingId}`,
      { model }
    );

    // Return transformed stream
    return this.createTransformedStream(sdkQuery, trackingId, model);
  }

  /**
   * Resume an existing session
   */
  async resumeSession(
    sessionId: SessionId,
    config?: AISessionConfig & { tabId?: string } & PtahCliPremiumConfig
  ): Promise<AsyncIterable<FlatStreamEventUnion>> {
    if (!this.initialized) {
      throw new Error(
        `PtahCliAdapter "${this.config.name}" not initialized. Call initialize() first.`
      );
    }

    // Check if session already active
    const existingSession = this.activeSessions.get(sessionId as string);
    if (existingSession && existingSession.query) {
      this.logger.info(
        `[PtahCliAdapter] Session ${sessionId} already active, returning existing stream`
      );
      return this.createTransformedStream(
        existingSession.query,
        sessionId,
        existingSession.currentModel
      );
    }

    const model = this.resolveModel(config?.model);

    this.logger.info(`[PtahCliAdapter] Resuming session: ${sessionId}`, {
      agentName: this.config.name,
    });

    // Create abort controller for resumed session
    const abortController = new AbortController();

    // Register session
    const session: PtahCliActiveSession = {
      sessionId,
      abortController,
      query: null,
      messageQueue: [],
      resolveNext: null,
      currentModel: model,
    };
    this.activeSessions.set(sessionId as string, session);

    // Get SDK query function
    const queryFn = await this.moduleLoader.getQueryFunction();

    // Create user message stream
    const userMessageStream = this.createUserMessageStream(
      sessionId,
      abortController
    );

    // Build query options with resume + premium capabilities
    const queryOptions = this.buildQueryOptions({
      userMessageStream,
      abortController,
      model,
      projectPath: config?.projectPath,
      resumeSessionId: sessionId as string,
      sessionId: sessionId as string,
      isPremium: config?.isPremium,
      mcpServerRunning: config?.mcpServerRunning,
      enhancedPromptsContent: config?.enhancedPromptsContent,
      pluginPaths: config?.pluginPaths,
      systemPrompt: config?.systemPrompt,
      preset: config?.preset,
      thinking: config?.thinking,
      effort: config?.effort,
    });

    // Start SDK query with resume
    const sdkQuery = queryFn({
      prompt: queryOptions.prompt,
      options: queryOptions.options as Options,
    });

    // Set query on session
    session.query = sdkQuery;

    return this.createTransformedStream(sdkQuery, sessionId, model);
  }

  /**
   * End a chat session - abort and clean up
   */
  endSession(sessionId: SessionId): void {
    const session = this.activeSessions.get(sessionId as string);
    if (!session) {
      this.logger.warn(
        `[PtahCliAdapter] Cannot end session - not found: ${sessionId}`
      );
      return;
    }

    this.logger.info(`[PtahCliAdapter] Ending session: ${sessionId}`);

    // Interrupt the query before aborting
    if (session.query) {
      session.query.interrupt().catch((err) => {
        this.logger.debug(
          `[PtahCliAdapter] Interrupt cleanup for session ${sessionId}`,
          err
        );
      });
    }

    // Abort the session
    session.abortController.abort();

    // Remove from active sessions
    this.activeSessions.delete(sessionId as string);

    this.logger.info(`[PtahCliAdapter] Session ended: ${sessionId}`);
  }

  /**
   * Send a message to an active session
   */
  async sendMessageToSession(
    sessionId: SessionId,
    content: string,
    options?: AIMessageOptions
  ): Promise<void> {
    const session = this.activeSessions.get(sessionId as string);
    if (!session) {
      throw new Error(`[PtahCliAdapter] Session not found: ${sessionId}`);
    }

    this.logger.info(`[PtahCliAdapter] Sending message to ${sessionId}`, {
      contentLength: content.length,
    });

    // Create SDK user message
    const userMessage = this.createSdkUserMessage(content, options?.files);

    // Queue message
    session.messageQueue.push(userMessage);

    // Wake the iterator if it's waiting
    if (session.resolveNext) {
      session.resolveNext();
      session.resolveNext = null;
    }

    this.logger.info(`[PtahCliAdapter] Message queued for ${sessionId}`);
  }

  /**
   * Get current health status
   */
  getHealth(): ProviderHealth {
    return { ...this.health };
  }

  /**
   * Verify installation - SDK is bundled, always available
   */
  async verifyInstallation(): Promise<boolean> {
    return true;
  }

  /**
   * Reset adapter state
   */
  async reset(): Promise<void> {
    this.logger.info(
      `[PtahCliAdapter] Resetting adapter "${this.config.name}"...`
    );
    this.dispose();
    await this.initialize();
  }

  /**
   * Dispose all sessions and cleanup
   */
  dispose(): void {
    this.logger.info(
      `[PtahCliAdapter] Disposing adapter "${this.config.name}"...`
    );

    for (const [sessionId, session] of this.activeSessions.entries()) {
      this.logger.debug(`[PtahCliAdapter] Ending session: ${sessionId}`);
      session.abortController.abort();
      if (session.query) {
        session.query.interrupt().catch((err) => {
          this.logger.debug(
            `[PtahCliAdapter] Interrupt cleanup for session ${sessionId}`,
            err
          );
        });
      }
    }

    this.activeSessions.clear();
    this.initialized = false;
    this.health = {
      status: 'initializing' as ProviderStatus,
      lastCheck: Date.now(),
    };

    this.logger.info(`[PtahCliAdapter] Disposed adapter "${this.config.name}"`);
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  /**
   * Resolve which model to use for a session.
   *
   * Always returns a valid Anthropic model name. Custom provider models
   * (e.g., "kimi-k2", "glm-5") are routed via ANTHROPIC_DEFAULT_*_MODEL
   * env vars set in initializeAuth(), not through this model param.
   * The SDK validates model names against Anthropic's list before
   * consulting env vars, so passing custom model names directly fails.
   */
  private resolveModel(_explicitModel?: string): string {
    return 'claude-sonnet-4-20250514';
  }

  /**
   * Create a minimal SDK user message
   */
  private createSdkUserMessage(
    content: string,
    files?: readonly string[] | string[]
  ): SDKUserMessage {
    const textContent: UserMessageContent = [{ type: 'text', text: content }];

    // Add file references as text blocks if provided
    if (files && files.length > 0) {
      for (const file of files) {
        textContent.push({ type: 'text', text: `[File: ${file}]` });
      }
    }

    return {
      type: 'user',
      uuid: `user-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      message: {
        role: 'user',
        content: textContent,
      },
    } as SDKUserMessage;
  }

  /**
   * Create an async iterable user message stream for SDK consumption.
   * Yields messages from the session's message queue, waiting when empty.
   */
  private createUserMessageStream(
    sessionId: SessionId,
    abortController: AbortController
  ): AsyncIterable<SDKUserMessage> {
    const activeSessions = this.activeSessions;
    const logger = this.logger;

    return {
      async *[Symbol.asyncIterator]() {
        while (!abortController.signal.aborted) {
          const session = activeSessions.get(sessionId as string);
          if (!session) {
            logger.warn(
              `[PtahCliAdapter] Session ${sessionId} not found - ending stream`
            );
            return;
          }

          // Drain all queued messages
          while (session.messageQueue.length > 0) {
            const message = session.messageQueue.shift();
            if (message) {
              logger.debug(
                `[PtahCliAdapter] Yielding message (${session.messageQueue.length} remaining)`
              );
              yield message;
            }
            if (abortController.signal.aborted) return;
          }

          // Wait for next message
          const waitResult = await new Promise<'message' | 'aborted'>(
            (resolve) => {
              const abortHandler = () => resolve('aborted');
              abortController.signal.addEventListener('abort', abortHandler);

              const currentSession = activeSessions.get(sessionId as string);
              if (!currentSession) {
                abortController.signal.removeEventListener(
                  'abort',
                  abortHandler
                );
                resolve('aborted');
                return;
              }

              // Check queue again before waiting (race condition guard)
              if (currentSession.messageQueue.length > 0) {
                abortController.signal.removeEventListener(
                  'abort',
                  abortHandler
                );
                resolve('message');
                return;
              }

              // Set wake callback
              currentSession.resolveNext = () => {
                abortController.signal.removeEventListener(
                  'abort',
                  abortHandler
                );
                resolve('message');
              };
            }
          );

          if (waitResult === 'aborted') {
            logger.debug(
              `[PtahCliAdapter] Stream ended for ${sessionId}: aborted`
            );
            return;
          }
        }
      },
    };
  }

  /**
   * Build SDK query options with isolated AuthEnv and premium capabilities
   */
  private buildQueryOptions(input: {
    userMessageStream: AsyncIterable<SDKUserMessage>;
    abortController: AbortController;
    model: string;
    projectPath?: string;
    resumeSessionId?: string;
    sessionId?: string;
    isPremium?: boolean;
    mcpServerRunning?: boolean;
    enhancedPromptsContent?: string;
    pluginPaths?: string[];
    systemPrompt?: string;
    preset?: string;
    onCompactionStart?: CompactionStartCallback;
    /** TASK_2025_184: Thinking/reasoning configuration */
    thinking?: ThinkingConfig;
    /** TASK_2025_184: Effort level for reasoning depth */
    effort?: EffortLevel;
  }): {
    prompt: AsyncIterable<SDKUserMessage>;
    options: SdkQueryOptions;
  } {
    const {
      userMessageStream,
      abortController,
      model,
      projectPath,
      resumeSessionId,
      sessionId,
      isPremium = false,
      mcpServerRunning = true,
      enhancedPromptsContent,
      pluginPaths,
      systemPrompt: userSystemPrompt,
      preset,
      onCompactionStart,
      thinking,
      effort,
    } = input;

    const cwd = projectPath || process.cwd();

    // Resolve permission mode based on user's autopilot setting.
    // Propagate the same permission policy to interactive sessions.
    const permLevel = this.permissionHandler.getPermissionLevel();
    const sdkPermMode =
      permLevel === 'yolo'
        ? 'bypassPermissions'
        : permLevel === 'auto-edit'
        ? 'acceptEdits'
        : 'default';
    const useBypass = sdkPermMode === 'bypassPermissions';
    const canUseTool = useBypass
      ? undefined
      : this.permissionHandler.createCallback(sessionId);

    // Build system prompt with full premium capabilities
    const activeProviderId = getActiveProviderId(this.authEnv);
    const systemPromptAppend = assembleSystemPromptAppend({
      providerId: activeProviderId,
      authEnv: this.authEnv,
      userSystemPrompt,
      isPremium,
      mcpServerRunning,
      enhancedPromptsContent,
      preset,
    });

    // Build MCP servers config
    const mcpServers: Record<string, McpHttpServerConfig> =
      isPremium && mcpServerRunning
        ? {
            ptah: {
              type: 'http' as const,
              url: `http://localhost:${PTAH_MCP_PORT}`,
            },
          }
        : {};

    // Build plugins config
    const plugins: SdkPluginConfig[] | undefined =
      pluginPaths && pluginPaths.length > 0
        ? pluginPaths.map((p) => ({ type: 'local' as const, path: p }))
        : undefined;

    // Build hooks (subagent + compaction) if handlers are available
    let hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>> | undefined;
    if (this.subagentHookHandler || this.compactionHookHandler) {
      hooks = {};
      if (this.subagentHookHandler) {
        const subagentHooks = this.subagentHookHandler.createHooks(
          cwd,
          sessionId
        );
        Object.assign(hooks, subagentHooks);
      }
      if (this.compactionHookHandler) {
        const compactionHooks = this.compactionHookHandler.createHooks(
          sessionId ?? '',
          onCompactionStart
        );
        Object.assign(hooks, compactionHooks);
      }
    }

    // Get compaction configuration if provider is available
    const compactionConfig = this.compactionConfigProvider?.getConfig();
    const compactionControl = compactionConfig?.enabled
      ? {
          enabled: true,
          contextTokenThreshold: compactionConfig.contextTokenThreshold,
        }
      : undefined;

    this.logger.info('[PtahCliAdapter] Building query options', {
      model,
      cwd,
      isResume: !!resumeSessionId,
      baseUrl: this.authEnv.ANTHROPIC_BASE_URL,
      isPremium,
      mcpServerRunning,
      mcpEnabled: Object.keys(mcpServers).length > 0,
      hasEnhancedPrompts: !!enhancedPromptsContent,
      pluginCount: pluginPaths?.length ?? 0,
      hasHooks: !!hooks,
      compactionEnabled: compactionConfig?.enabled ?? false,
      hasIdentityPrompt: !!activeProviderId,
    });

    return {
      prompt: userMessageStream,
      options: {
        abortController,
        cwd,
        model,
        resume: resumeSessionId,
        systemPrompt: {
          type: 'preset' as const,
          preset: 'claude_code' as const,
          append: systemPromptAppend,
        },
        tools: {
          type: 'preset' as const,
          preset: 'claude_code' as const,
        },
        mcpServers,
        permissionMode: sdkPermMode,
        ...(useBypass
          ? { allowDangerouslySkipPermissions: true }
          : { canUseTool }),
        includePartialMessages: true,
        settingSources: ['user', 'project', 'local'] as const,
        // Safe env: platform essentials + provider auth only (no host secret leaks)
        env: buildSafeEnv(this.authEnv),
        stderr: (data: string) => {
          this.logger.error(
            `[PtahCliAdapter] CLI stderr (${this.config.name}): ${data}`
          );
        },
        hooks,
        plugins,
        compactionControl,
        // TASK_2025_184: Reasoning configuration passthrough
        thinking,
        effort,
      },
    };
  }

  /**
   * Create a transformed async iterable stream that converts SDK messages
   * to FlatStreamEventUnion events for UI rendering.
   *
   * This is the Ptah CLI adapter's own stream transformation, independent from
   * the DI-injected StreamTransformer used by SdkAgentAdapter.
   */
  private createTransformedStream(
    sdkQuery: AsyncIterable<SDKMessage>,
    sessionId: SessionId,
    initialModel: string
  ): AsyncIterable<FlatStreamEventUnion> {
    const logger = this.logger;
    const messageTransformer = this.messageTransformer;
    const authEnv = this.authEnv;

    return {
      async *[Symbol.asyncIterator]() {
        let sdkMessageCount = 0;
        let yieldedEventCount = 0;
        let effectiveSessionId = sessionId;

        try {
          for await (const sdkMessage of sdkQuery) {
            sdkMessageCount++;

            // Extract real session ID from system 'init' message
            if (isSystemInit(sdkMessage)) {
              const realSessionId = sdkMessage.session_id;
              effectiveSessionId = realSessionId as SessionId;
              logger.info(
                `[PtahCliAdapter] Real session ID resolved: ${realSessionId}`
              );
            }

            // Extract stats from result message (log for debugging, not emitted)
            if (isResultMessage(sdkMessage)) {
              const resolvedModel = resolveActualModelForPricing(
                initialModel,
                authEnv
              );
              const totalCost = calculateMessageCost(resolvedModel, {
                input: sdkMessage.usage.input_tokens,
                output: sdkMessage.usage.output_tokens,
                cacheHit: sdkMessage.usage.cache_read_input_tokens ?? 0,
                cacheCreation:
                  sdkMessage.usage.cache_creation_input_tokens ?? 0,
              });
              logger.info(
                `[PtahCliAdapter] Result stats: cost=$${totalCost.toFixed(
                  4
                )}, ` +
                  `tokens=${sdkMessage.usage.input_tokens}in/${sdkMessage.usage.output_tokens}out, ` +
                  `duration=${sdkMessage.duration_ms}ms`
              );
            }

            // Transform processable message types to flat events
            if (
              sdkMessage.type === 'stream_event' ||
              sdkMessage.type === 'assistant' ||
              sdkMessage.type === 'user' ||
              isCompactBoundary(sdkMessage)
            ) {
              const flatEvents = messageTransformer.transform(
                sdkMessage,
                effectiveSessionId
              );

              for (const event of flatEvents) {
                yieldedEventCount++;
                yield event;
              }
            }
          }

          logger.info(
            `[PtahCliAdapter] Stream ended for ${sessionId}: ${sdkMessageCount} SDK messages, ${yieldedEventCount} events yielded`
          );
        } catch (error) {
          const errorObj =
            error instanceof Error ? error : new Error(String(error));

          // Check if this is a user-initiated abort
          const lowerMessage = errorObj.message.toLowerCase();
          const isUserAbort =
            lowerMessage.includes('aborted by user') ||
            lowerMessage.includes('abort') ||
            lowerMessage.includes('cancelled') ||
            lowerMessage.includes('canceled');

          if (isUserAbort) {
            logger.info(
              `[PtahCliAdapter] Session ${sessionId} aborted by user`
            );
          } else {
            logger.error(
              `[PtahCliAdapter] Session ${sessionId} error: ${errorObj.message}`,
              errorObj
            );

            // Check for auth errors
            const isAuthError =
              errorObj.message.includes('401') ||
              lowerMessage.includes('unauthorized') ||
              lowerMessage.includes('authentication failed') ||
              lowerMessage.includes('invalid api key') ||
              lowerMessage.includes('invalid token') ||
              lowerMessage.includes('api_key');

            if (isAuthError) {
              logger.error(
                `[PtahCliAdapter] AUTHENTICATION ERROR for "${initialModel}" - check API key configuration`
              );
            }
          }

          throw error;
        } finally {
          logger.info(`[PtahCliAdapter] Session ${sessionId} stream ended`);
        }
      },
    };
  }
}
