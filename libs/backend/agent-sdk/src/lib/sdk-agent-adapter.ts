/**
 * SDK Agent Adapter - IAIProvider implementation using official Claude Agent SDK
 *
 * This adapter provides direct in-process SDK communication with 10x performance
 * improvements over CLI-based integration. All dependencies are injected via DI:
 * - AuthManager: Authentication setup and validation
 * - SessionLifecycleManager: Session tracking and cleanup
 * - ConfigWatcher: Config change detection and re-initialization
 * - StreamTransformer: SDK message to ExecutionNode transformation
 * - SessionMetadataStore: UI metadata storage (names, timestamps, costs)
 *
 * Note: Query building and user message stream creation are inlined as private
 * methods rather than injected services (TASK_2025_088 simplification).
 */

import { injectable, inject } from 'tsyringe';
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
  MessageId,
} from '@ptah-extension/shared';
import { Logger, ConfigManager, TOKENS } from '@ptah-extension/vscode-core';
import { SDK_TOKENS } from './di/tokens';
import { SessionMetadataStore } from './session-metadata-store';
import { SdkPermissionHandler } from './sdk-permission-handler';
import {
  SDKMessage,
  UserMessageContent,
  TextBlock,
  CanUseTool,
} from './types/sdk-types/claude-sdk.types';
import {
  AuthManager,
  SessionLifecycleManager,
  ConfigWatcher,
  StreamTransformer,
  AttachmentProcessorService,
  type SDKUserMessage,
  type SessionIdResolvedCallback,
  type ResultStatsCallback,
  type ContentBlock,
  type Query,
} from './helpers';
import {
  ClaudeCliDetector,
  ClaudeInstallation,
} from './detector/claude-cli-detector';

// Re-export for external consumers
export type { SessionIdResolvedCallback, ResultStatsCallback } from './helpers';

/**
 * Provider capabilities for SDK-based integration
 */
const SDK_CAPABILITIES: ProviderCapabilities = {
  streaming: true,
  fileAttachments: true,
  contextManagement: true,
  sessionPersistence: true,
  multiTurn: true,
  codeGeneration: true,
  imageAnalysis: true,
  functionCalling: true,
};

/**
 * Provider information for SDK adapter
 */
const SDK_PROVIDER_INFO: ProviderInfo = {
  id: 'claude-cli' as ProviderId,
  name: 'Claude Agent SDK',
  version: '1.0.0',
  description: 'Official Claude Agent SDK integration (in-process)',
  vendor: 'Anthropic',
  capabilities: SDK_CAPABILITIES,
  maxContextTokens: 200000,
  supportedModels: [], // Dynamically populated via getSupportedModels()
};

/**
 * SdkAgentAdapter - Core SDK wrapper implementing IAIProvider
 *
 * Architecture: Thin orchestration layer that delegates to injected helper services.
 * All dependencies are provided via constructor injection from the DI container.
 * Main responsibilities: API surface, session coordination, SDK invocation.
 */
@injectable()
export class SdkAgentAdapter implements IAIProvider {
  readonly providerId: ProviderId = 'claude-cli' as ProviderId;
  readonly info: ProviderInfo = SDK_PROVIDER_INFO;

  private initialized = false;
  private health: ProviderHealth = {
    status: 'initializing' as ProviderStatus,
    lastCheck: Date.now(),
  };

  /**
   * Cached CLI installation info - resolved during initialization
   */
  private cliInstallation: ClaudeInstallation | null = null;

  /**
   * Callback to notify when real Claude session ID is resolved
   * Set by RpcMethodRegistrationService to send session:id-resolved events
   */
  private sessionIdResolvedCallback: SessionIdResolvedCallback | null = null;

  /**
   * Callback to notify when result message with stats is received
   * Set by RpcMethodRegistrationService to send session:stats events
   */
  private resultStatsCallback: ResultStatsCallback | null = null;

  /**
   * Cached models from SDK's supportedModels() API
   * Populated on first call to getSupportedModels()
   */
  private cachedSupportedModels: Array<{
    value: string;
    displayName: string;
    description: string;
  }> = [];

  /**
   * Create SDK Agent Adapter with all dependencies injected
   */
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.CONFIG_MANAGER) private readonly config: ConfigManager,
    @inject(SDK_TOKENS.SDK_SESSION_METADATA_STORE)
    private readonly metadataStore: SessionMetadataStore,
    @inject(SDK_TOKENS.SDK_AUTH_MANAGER)
    private readonly authManager: AuthManager,
    @inject(SDK_TOKENS.SDK_SESSION_LIFECYCLE_MANAGER)
    private readonly sessionLifecycle: SessionLifecycleManager,
    @inject(SDK_TOKENS.SDK_CONFIG_WATCHER)
    private readonly configWatcher: ConfigWatcher,
    @inject(SDK_TOKENS.SDK_CLI_DETECTOR)
    private readonly cliDetector: ClaudeCliDetector,
    @inject(SDK_TOKENS.SDK_STREAM_TRANSFORMER)
    private readonly streamTransformer: StreamTransformer,
    @inject(SDK_TOKENS.SDK_ATTACHMENT_PROCESSOR)
    private readonly attachmentProcessor: AttachmentProcessorService,
    @inject(SDK_TOKENS.SDK_PERMISSION_HANDLER)
    private readonly permissionHandler: SdkPermissionHandler
  ) {}

  /**
   * Build SDK query options for new or resumed session
   * Inlined from SdkQueryBuilder
   */
  private async buildQueryOptions(config: {
    userMessageStream: AsyncIterable<SDKUserMessage>;
    abortController: AbortController;
    sessionConfig?: AISessionConfig;
    resumeSessionId?: string;
  }): Promise<{
    prompt: AsyncIterable<SDKUserMessage>;
    options: {
      abortController: AbortController;
      cwd: string;
      model: string;
      resume?: string;
      maxTurns?: number;
      systemPrompt: {
        type: 'preset';
        preset: 'claude_code';
        append?: string;
      };
      tools: {
        type: 'preset';
        preset: 'claude_code';
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mcpServers: Record<string, any>;
      permissionMode: 'default' | 'acceptEdits' | 'bypassPermissions';
      canUseTool?: CanUseTool;
      includePartialMessages: boolean;
      settingSources?: Array<'user' | 'project' | 'local'>;
      env?: Record<string, string | undefined>;
      stderr?: (data: string) => void;
    };
  }> {
    const {
      userMessageStream,
      abortController,
      sessionConfig,
      resumeSessionId,
    } = config;

    // Model is required - SDK sets default in config at startup
    if (!sessionConfig?.model) {
      throw new Error('Model not provided - ensure SDK is initialized');
    }
    const model = sessionConfig.model;
    const cwd = sessionConfig?.projectPath || process.cwd();

    // Build system prompt configuration
    const systemPrompt = sessionConfig?.systemPrompt
      ? {
          type: 'preset' as const,
          preset: 'claude_code' as const,
          append: sessionConfig.systemPrompt,
        }
      : {
          type: 'preset' as const,
          preset: 'claude_code' as const,
        };

    // CRITICAL: Create canUseTool callback
    // Note: Our CanUseTool type is structurally identical to SDK's but TypeScript sees them as incompatible
    // Use type assertion (eslint-disable to allow any for SDK interop)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const canUseToolCallback = this.permissionHandler.createCallback() as any;

    // Default port for Ptah HTTP MCP server (from vscode-lm-tools/CodeExecutionMCP)
    const PTAH_MCP_PORT = 51820;

    // Log query options with permission details
    this.logger.info('[SdkAgentAdapter] Building SDK query options', {
      cwd,
      model,
      isResume: !!resumeSessionId,
      resumeSessionId: resumeSessionId
        ? `${resumeSessionId.slice(0, 8)}...`
        : undefined,
      permissionMode: 'default',
      hasCanUseToolCallback: !!canUseToolCallback,
    });

    return {
      prompt: userMessageStream,
      options: {
        abortController,
        cwd,
        model,
        resume: resumeSessionId,
        maxTurns: sessionConfig?.maxTokens
          ? Math.floor(sessionConfig.maxTokens / 1000)
          : undefined,
        systemPrompt,
        tools: {
          type: 'preset' as const,
          preset: 'claude_code' as const,
        },
        // Use HTTP MCP server from vscode-lm-tools/CodeExecutionMCP
        // Provides execute_code tool with 11 Ptah API namespaces
        mcpServers: {
          ptah: {
            type: 'http',
            url: `http://localhost:${PTAH_MCP_PORT}`,
          },
        },
        // CRITICAL: permissionMode must be 'default' for canUseTool to be invoked
        // If set to 'bypassPermissions', canUseTool is never called
        permissionMode: 'default',
        canUseTool: canUseToolCallback,
        includePartialMessages: true,
        // Load settings from user and project directories
        // Required for CLAUDE.md files and proper CLI initialization
        settingSources: ['user', 'project', 'local'],
        // Pass current environment variables (includes CLAUDE_CODE_OAUTH_TOKEN from AuthManager)
        env: process.env as Record<string, string | undefined>,
        // Capture stderr for debugging CLI failures
        stderr: (data: string) => {
          this.logger.error(`[SdkAgentAdapter] CLI stderr: ${data}`);
        },
      },
    };
  }

  /**
   * Create a user message stream for SDK consumption
   * Inlined from UserMessageStreamFactory
   *
   * @param sessionId - The session to create stream for
   * @param abortController - Controller to signal stream termination
   * @returns AsyncIterable that yields SDKUserMessage objects
   */
  private createUserMessageStream(
    sessionId: SessionId,
    abortController: AbortController
  ): AsyncIterable<SDKUserMessage> {
    const sessionLifecycle = this.sessionLifecycle;
    const logger = this.logger;
    const MESSAGE_TIMEOUT_MS = 5 * 60 * 1000;

    return {
      async *[Symbol.asyncIterator]() {
        while (!abortController.signal.aborted) {
          const session = sessionLifecycle.getActiveSession(sessionId);
          if (!session) {
            logger.warn(
              `[SdkAgentAdapter] Session ${sessionId} not found - ending stream`
            );
            return;
          }

          // Drain all queued messages
          while (session.messageQueue.length > 0) {
            const message = session.messageQueue.shift();
            if (message) {
              logger.debug(
                `[SdkAgentAdapter] Yielding message (${session.messageQueue.length} remaining)`
              );
              yield message;
            }
            if (abortController.signal.aborted) return;
          }

          // Wait for next message
          const waitResult = await new Promise<
            'message' | 'aborted' | 'timeout'
          >((resolve) => {
            const abortHandler = () => resolve('aborted');
            abortController.signal.addEventListener('abort', abortHandler);

            const currentSession = sessionLifecycle.getActiveSession(sessionId);
            if (!currentSession) {
              resolve('aborted');
              return;
            }

            // Check queue again before waiting
            if (currentSession.messageQueue.length > 0) {
              abortController.signal.removeEventListener('abort', abortHandler);
              resolve('message');
              return;
            }

            // Set timeout
            const timeoutId = setTimeout(() => {
              logger.warn(`[SdkAgentAdapter] Session ${sessionId} timeout`);
              abortController.signal.removeEventListener('abort', abortHandler);
              resolve('timeout');
            }, MESSAGE_TIMEOUT_MS);

            // Set wake callback
            currentSession.resolveNext = () => {
              clearTimeout(timeoutId);
              abortController.signal.removeEventListener('abort', abortHandler);
              resolve('message');
            };

            logger.debug(
              `[SdkAgentAdapter] Waiting for message (${sessionId})...`
            );
          });

          if (waitResult === 'aborted' || waitResult === 'timeout') {
            logger.debug(`[SdkAgentAdapter] Stream ended: ${waitResult}`);
            return;
          }
        }
      },
    };
  }

  /**
   * Initialize the SDK adapter
   */
  async initialize(): Promise<boolean> {
    try {
      this.logger.info('[SdkAgentAdapter] Initializing SDK adapter...');

      // Step 0: Register config watchers EARLY (before auth check)
      // This ensures token changes are detected even when initial auth fails
      this.configWatcher.registerWatchers(async () => {
        this.logger.info(
          '[SdkAgentAdapter] Config change detected, re-initializing...'
        );
        this.sessionLifecycle.disposeAllSessions();
        this.cliDetector.clearCache();
        this.cliInstallation = null;
        await this.initialize();
      });

      // Step 1: Detect Claude CLI installation
      this.logger.info(
        '[SdkAgentAdapter] Detecting Claude CLI installation...'
      );
      const configuredPath = this.config.get<string>('claudeCliPath');
      if (configuredPath) {
        this.cliDetector.configure({ configuredPath });
      }

      this.cliInstallation = await this.cliDetector.findExecutable();

      if (!this.cliInstallation) {
        const errorMessage =
          'Claude CLI not found. Please install it via: npm install -g @anthropic-ai/claude-code';
        this.logger.error(`[SdkAgentAdapter] ${errorMessage}`);
        this.health = {
          status: 'error' as ProviderStatus,
          lastCheck: Date.now(),
          errorMessage,
        };
        return false;
      }

      this.logger.info('[SdkAgentAdapter] Claude CLI found', {
        path: this.cliInstallation.path,
        source: this.cliInstallation.source,
        cliJsPath: this.cliInstallation.cliJsPath,
        useDirectExecution: this.cliInstallation.useDirectExecution,
      });

      // Step 2: Configure authentication
      const authMethod = this.config.get<string>('authMethod') || 'auto';
      const authResult = await this.authManager.configureAuthentication(
        authMethod
      );

      if (!authResult.configured) {
        this.health = {
          status: 'error' as ProviderStatus,
          lastCheck: Date.now(),
          errorMessage: authResult.errorMessage,
        };
        return false;
      }

      // Step 3: Mark as initialized
      this.initialized = true;
      this.health = {
        status: 'available' as ProviderStatus,
        lastCheck: Date.now(),
        responseTime: 0,
        uptime: Date.now(),
      };

      // Step 4: Initialize default model from SDK if not already configured
      try {
        const savedModel = this.config.get<string>('model.selected');
        if (!savedModel) {
          const defaultModel = await this.getDefaultModel();
          await this.config.set('model.selected', defaultModel);
          this.logger.info('[SdkAgentAdapter] Set default model from SDK', {
            model: defaultModel,
          });
        }
      } catch (modelError) {
        // Non-fatal - continue initialization even if model setup fails
        this.logger.warn(
          '[SdkAgentAdapter] Failed to set default model',
          modelError instanceof Error
            ? modelError
            : new Error(String(modelError))
        );
      }

      this.logger.info('[SdkAgentAdapter] Initialized successfully');
      return true;
    } catch (error) {
      const errorObj =
        error instanceof Error ? error : new Error(String(error));
      this.logger.error('[SdkAgentAdapter] Initialization failed', errorObj);
      this.health = {
        status: 'error' as ProviderStatus,
        lastCheck: Date.now(),
        errorMessage: errorObj.message,
      };
      return false;
    }
  }

  /**
   * Dispose all active sessions and cleanup
   */
  dispose(): void {
    this.logger.info('[SdkAgentAdapter] Disposing adapter...');
    this.configWatcher.dispose();
    this.sessionLifecycle.disposeAllSessions();
    this.authManager.clearAuthentication();
    this.initialized = false;
    this.logger.info('[SdkAgentAdapter] Disposed successfully');
  }

  /**
   * Verify installation - SDK is bundled, always available
   */
  async verifyInstallation(): Promise<boolean> {
    return true;
  }

  /**
   * Get current health status
   */
  getHealth(): ProviderHealth {
    return { ...this.health };
  }

  /**
   * Get supported models from SDK's native API
   * Fetches once and caches for subsequent calls
   *
   * @returns Array of model info with value (API ID), displayName, and description
   */
  async getSupportedModels(): Promise<
    Array<{ value: string; displayName: string; description: string }>
  > {
    // Return cached if available
    if (this.cachedSupportedModels.length > 0) {
      return this.cachedSupportedModels;
    }

    try {
      // Import SDK and create temporary query to fetch models
      const { query } = await import('@anthropic-ai/claude-agent-sdk');

      // Create a minimal query just to access supportedModels()
      // We use an async generator that yields nothing
      const emptyPrompt = (async function* () {
        // Don't yield anything - we just need to call supportedModels()
      })();

      const tempQuery = query({
        prompt: emptyPrompt,
        options: {
          cwd: process.cwd(),
        },
      });

      // Fetch supported models from SDK
      const models = await tempQuery.supportedModels();
      this.logger.info('[SdkAgentAdapter] Fetched supported models from SDK', {
        count: models.length,
        models: models.map((m) => m.value),
      });

      this.cachedSupportedModels = models;
      return models;
    } catch (error) {
      this.logger.error(
        '[SdkAgentAdapter] Failed to fetch supported models',
        error instanceof Error ? error : new Error(String(error))
      );

      // Fallback to safe defaults if SDK call fails
      const fallback = [
        {
          value: 'claude-sonnet-4-20250514',
          displayName: 'Claude Sonnet 4',
          description: 'Best for everyday tasks',
        },
        {
          value: 'claude-opus-4-20250514',
          displayName: 'Claude Opus 4',
          description: 'Most capable for complex work',
        },
        {
          value: 'claude-haiku-3-20240307',
          displayName: 'Claude Haiku 3',
          description: 'Fastest for quick answers',
        },
      ];
      this.cachedSupportedModels = fallback;
      return fallback;
    }
  }

  /**
   * Get default model - first from supported models
   */
  async getDefaultModel(): Promise<string> {
    const models = await this.getSupportedModels();
    return models[0]?.value || 'claude-sonnet-4-20250514';
  }

  /**
   * Reset adapter state
   */
  async reset(): Promise<void> {
    this.logger.info('[SdkAgentAdapter] Resetting adapter...');
    this.dispose();
    await this.initialize();
  }

  /**
   * Start a chat session with streaming support
   */
  async startChatSession(
    sessionId: SessionId,
    config?: AISessionConfig & { name?: string }
  ): Promise<AsyncIterable<FlatStreamEventUnion>> {
    if (!this.initialized) {
      throw new Error(
        'SdkAgentAdapter not initialized. Call initialize() first.'
      );
    }

    this.logger.info(`[SdkAgentAdapter] Starting chat session: ${sessionId}`, {
      config,
    });

    // Create abort controller FIRST
    const abortController = new AbortController();

    // PRE-REGISTER session BEFORE creating message stream
    // This fixes race condition where UserMessageStreamFactory couldn't find session
    this.sessionLifecycle.preRegisterActiveSession(
      sessionId,
      config || {},
      abortController
    );

    // NOTE: Session metadata will be created when SDK returns real session ID
    // via onSessionIdResolved callback. SDK handles message persistence natively.

    // Import SDK dynamically (ESM in CommonJS context)
    this.logger.info(
      `[SdkAgentAdapter] Importing Claude Agent SDK for session ${sessionId}...`
    );
    this.logger.debug(
      `[SdkAgentAdapter] Environment check: ANTHROPIC_API_KEY=${
        process.env['ANTHROPIC_API_KEY'] ? 'SET' : 'NOT SET'
      }, CLAUDE_CODE_OAUTH_TOKEN=${
        process.env['CLAUDE_CODE_OAUTH_TOKEN'] ? 'SET' : 'NOT SET'
      }`
    );

    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    this.logger.info('[SdkAgentAdapter] SDK imported successfully');

    // Create user message stream (session is now pre-registered, so it can be found)
    const userMessageStream = this.createUserMessageStream(
      sessionId,
      abortController
    );

    // Log that we're using SDK's built-in CLI
    this.logger.info('[SdkAgentAdapter] Using SDK built-in Claude Code CLI', {
      sdkDetectedCli: this.cliInstallation?.path,
      usingBuiltIn: true,
    });

    const queryOptions = await this.buildQueryOptions({
      userMessageStream,
      abortController,
      sessionConfig: config,
    });

    this.logger.info('[SdkAgentAdapter] Starting SDK query with options', {
      model: queryOptions.options.model,
      cwd: queryOptions.options.cwd,
      permissionMode: queryOptions.options.permissionMode,
    });

    // Start SDK query
    // Type assertion needed because SDK's query() expects SDK types, not our local types
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sdkQuery = query(queryOptions as any);
    const initialModel = queryOptions.options.model;

    // Set the SDK query on the pre-registered session
    // Type assertion needed because SDK types are structurally identical but seen as different
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.sessionLifecycle.setSessionQuery(sessionId, sdkQuery as any);

    // Return transformed stream
    // Note: sdkQuery yields SDK's SDKMessage (from @anthropic-ai/claude-agent-sdk)
    // We structurally match it with our SDKMessage type (from claude-sdk.types.ts)
    // Create callback that saves metadata AND notifies webview
    // TASK_2025_095: Pass tabId for direct routing of session:id-resolved
    const sessionIdCallback = this.createSessionIdCallback(
      config?.projectPath || process.cwd(),
      config?.name || `Session ${new Date().toLocaleDateString()}`,
      config?.tabId
    );

    return this.streamTransformer.transform({
      sdkQuery: sdkQuery as unknown as AsyncIterable<SDKMessage>,
      sessionId,
      initialModel,
      onSessionIdResolved: sessionIdCallback,
      onResultStats: this.resultStatsCallback || undefined,
      tabId: config?.tabId, // TASK_2025_095: For direct routing
    });
  }

  /**
   * End a chat session
   */
  endSession(sessionId: SessionId): void {
    this.sessionLifecycle.endSession(sessionId);
  }

  /**
   * Resume a session using SDK's native resume option.
   * SDK handles conversation history loading from ~/.claude/projects/{sessionId}.jsonl
   *
   * @param sessionId - The SDK session ID to resume
   * @param config - Optional session configuration overrides
   * @returns AsyncIterable<FlatStreamEventUnion> for streaming responses
   */
  async resumeSession(
    sessionId: SessionId,
    config?: AISessionConfig
  ): Promise<AsyncIterable<FlatStreamEventUnion>> {
    if (!this.initialized) {
      throw new Error(
        'SdkAgentAdapter not initialized. Call initialize() first.'
      );
    }

    // Check if session already active AND fully initialized (has query)
    const existingSession = this.sessionLifecycle.getActiveSession(sessionId);
    if (existingSession && existingSession.query) {
      this.logger.info(
        `[SdkAgentAdapter] Session ${sessionId} already active, returning existing stream`
      );
      return this.streamTransformer.transform({
        sdkQuery: existingSession.query,
        sessionId,
        initialModel: existingSession.currentModel,
        onSessionIdResolved: this.sessionIdResolvedCallback || undefined,
      });
    }

    this.logger.info(`[SdkAgentAdapter] Resuming session: ${sessionId}`, {
      config,
    });

    // Create abort controller FIRST
    const abortController = new AbortController();

    // PRE-REGISTER session BEFORE creating message stream
    this.sessionLifecycle.preRegisterActiveSession(
      sessionId,
      config || {},
      abortController
    );

    // Import SDK dynamically
    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    this.logger.info('[SdkAgentAdapter] SDK imported for session resume');

    // Create user message stream
    const userMessageStream = this.createUserMessageStream(
      sessionId,
      abortController
    );

    // Build query with resume option - SDK loads history from its native storage
    const queryOptions = await this.buildQueryOptions({
      userMessageStream,
      abortController,
      sessionConfig: config,
      resumeSessionId: sessionId as string, // SDK session ID - SDK handles everything
    });

    this.logger.debug('[SdkAgentAdapter] SDK query options for resume', {
      cwd: config?.projectPath || process.cwd(),
      model: queryOptions.options.model,
      sessionId,
      isResume: true,
    });

    // Start SDK query with resume
    // Type assertion needed because SDK's query() expects SDK types, not our local types
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sdkQuery = query(queryOptions as any);
    const initialModel = queryOptions.options.model;

    // Set the SDK query on the pre-registered session
    // Type assertion needed because SDK types are structurally identical but seen as different
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.sessionLifecycle.setSessionQuery(sessionId, sdkQuery as any);

    this.logger.info(`[SdkAgentAdapter] Session resumed: ${sessionId}`);

    // Return transformed stream - SDK will replay history messages
    // Note: sdkQuery yields SDK's SDKMessage (from @anthropic-ai/claude-agent-sdk)
    // We structurally match it with our SDKMessage type (from claude-sdk.types.ts)
    // For resumed sessions, just update lastActiveAt (metadata already exists)
    // TASK_2025_095: Updated callback signature with tabId for direct routing
    // Note: Resumed sessions don't have tabId from frontend, so pass undefined
    const resumeCallback = async (
      tabId: string | undefined,
      realSessionId: string
    ) => {
      await this.metadataStore.touch(realSessionId);
      if (this.sessionIdResolvedCallback) {
        this.sessionIdResolvedCallback(tabId, realSessionId);
      }
    };

    return this.streamTransformer.transform({
      sdkQuery: sdkQuery as unknown as AsyncIterable<SDKMessage>,
      sessionId,
      initialModel,
      onSessionIdResolved: resumeCallback,
      onResultStats: this.resultStatsCallback || undefined,
    });
  }

  /**
   * Check if a session is currently active in memory
   */
  isSessionActive(sessionId: SessionId): boolean {
    return this.sessionLifecycle.getActiveSession(sessionId) !== undefined;
  }

  /**
   * Create a session ID callback that saves metadata and notifies webview
   * TASK_2025_095: Now uses tabId for direct routing instead of temp ID lookup
   * @param workspaceId - Workspace path for this session
   * @param sessionName - User-friendly session name
   * @param tabId - Frontend tab ID for direct routing
   */
  private createSessionIdCallback(
    workspaceId: string,
    sessionName: string,
    tabId?: string
  ): (tabId: string | undefined, realSessionId: string) => void {
    return async (
      _tabIdFromCallback: string | undefined,
      realSessionId: string
    ) => {
      this.logger.info(
        `[SdkAgentAdapter] Saving session metadata for ${realSessionId} (tabId: ${tabId})`
      );

      // Save session metadata to persistent storage
      await this.metadataStore.create(realSessionId, workspaceId, sessionName);

      // Notify webview of the resolved session ID
      // TASK_2025_095: Pass tabId so frontend can find tab directly
      if (this.sessionIdResolvedCallback) {
        this.sessionIdResolvedCallback(tabId, realSessionId);
      }
    };
  }

  /**
   * Set callback for when real Claude session ID is resolved
   * Called by RpcMethodRegistrationService to send session:id-resolved events to webview
   */
  setSessionIdResolvedCallback(callback: SessionIdResolvedCallback): void {
    this.sessionIdResolvedCallback = callback;
  }

  /**
   * Set callback for when result message with stats is received
   * Called by RpcMethodRegistrationService to send session:stats events to webview
   */
  setResultStatsCallback(callback: ResultStatsCallback): void {
    this.resultStatsCallback = callback;
  }

  /**
   * Send a message to an active session.
   * SDK handles message persistence natively to ~/.claude/projects/{sessionId}.jsonl
   */
  async sendMessageToSession(
    sessionId: SessionId,
    content: string,
    options?: AIMessageOptions
  ): Promise<void> {
    const session = this.sessionLifecycle.getActiveSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    this.logger.info(`[SdkAgentAdapter] Sending message to ${sessionId}`, {
      contentLength: content.length,
      fileCount: options?.files?.length || 0,
    });

    // Check for attachments (files & images)
    const files = options?.files || [];
    let messageContent: UserMessageContent = content;

    if (files.length > 0) {
      this.logger.debug(
        `[SdkAgentAdapter] Processing ${files.length} attachments`
      );

      const attachmentBlocks =
        await this.attachmentProcessor.processAttachments(files);

      if (attachmentBlocks.length > 0) {
        const textBlock: TextBlock = { type: 'text', text: content };
        messageContent = [textBlock, ...attachmentBlocks];
      }
    }

    // Generate message ID for SDK
    const messageId = MessageId.create();
    const messageIdStr = messageId.toString();

    // Create SDK user message (matches official SDK type from sdk.d.ts)
    // SDK handles persistence natively - no manual storage needed
    const sdkUserMessage: SDKUserMessage = {
      type: 'user',
      uuid: messageIdStr as `${string}-${string}-${string}-${string}-${string}`,
      session_id: sessionId as string,
      message: {
        role: 'user',
        content: messageContent,
      },
      parent_tool_use_id: null,
    };

    // Queue for SDK - SDK will persist message to ~/.claude/projects/
    session.messageQueue.push(sdkUserMessage);

    // Wake iterator
    if (session.resolveNext) {
      session.resolveNext();
      session.resolveNext = null;
    }

    this.logger.info(`[SdkAgentAdapter] Message queued for ${sessionId}`);
  }

  /**
   * Interrupt active session
   */
  async interruptSession(sessionId: SessionId): Promise<void> {
    const session = this.sessionLifecycle.getActiveSession(sessionId);
    if (!session) {
      this.logger.warn(
        `[SdkAgentAdapter] Cannot interrupt - session not found: ${sessionId}`
      );
      return;
    }

    this.logger.info(`[SdkAgentAdapter] Interrupting session: ${sessionId}`);

    if (!session.query) {
      this.logger.warn(
        `[SdkAgentAdapter] Cannot interrupt - session query not initialized: ${sessionId}`
      );
      return;
    }

    try {
      await session.query.interrupt();
      this.logger.info(`[SdkAgentAdapter] Session interrupted: ${sessionId}`);
    } catch (error) {
      this.logger.error(
        `[SdkAgentAdapter] Failed to interrupt session ${sessionId}`,
        error instanceof Error ? error : new Error(String(error))
      );
      throw error;
    }
  }

  /**
   * Set session permission level
   */
  async setSessionPermissionLevel(
    sessionId: SessionId,
    level:
      | 'ask'
      | 'auto-edit'
      | 'yolo'
      | 'default'
      | 'acceptEdits'
      | 'bypassPermissions'
  ): Promise<void> {
    const session = this.sessionLifecycle.getActiveSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    if (!session.query) {
      throw new Error(`Session query not initialized: ${sessionId}`);
    }

    this.logger.info(
      `[SdkAgentAdapter] Setting permission level for ${sessionId}: ${level}`
    );

    // Support both frontend names and SDK mode names
    const modeMap: Record<string, string> = {
      ask: 'default',
      'auto-edit': 'acceptEdits',
      yolo: 'bypassPermissions',
      default: 'default',
      acceptEdits: 'acceptEdits',
      bypassPermissions: 'bypassPermissions',
    };

    const sdkMode = modeMap[level] || level;

    try {
      await session.query.setPermissionMode(sdkMode);
      this.logger.info(
        `[SdkAgentAdapter] Permission level set for ${sessionId}`
      );
    } catch (error) {
      this.logger.error(
        `[SdkAgentAdapter] Failed to set permission for ${sessionId}`,
        error instanceof Error ? error : new Error(String(error))
      );
      throw error;
    }
  }

  /**
   * Set session model
   */
  async setSessionModel(sessionId: SessionId, model: string): Promise<void> {
    const session = this.sessionLifecycle.getActiveSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    if (!session.query) {
      throw new Error(`Session query not initialized: ${sessionId}`);
    }

    this.logger.info(
      `[SdkAgentAdapter] Setting model for ${sessionId}: ${model}`
    );

    try {
      await session.query.setModel(model);
      session.currentModel = model;
      this.logger.info(`[SdkAgentAdapter] Model set for ${sessionId}`);
    } catch (error) {
      this.logger.error(
        `[SdkAgentAdapter] Failed to set model for ${sessionId}`,
        error instanceof Error ? error : new Error(String(error))
      );
      throw error;
    }
  }
}
