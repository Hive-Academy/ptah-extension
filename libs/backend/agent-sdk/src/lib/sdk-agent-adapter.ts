/**
 * SDK Agent Adapter - IAIProvider implementation using official Claude Agent SDK
 *
 * This adapter provides direct in-process SDK communication with 10x performance
 * improvements over CLI-based integration. All dependencies are injected via DI:
 * - AuthManager: Authentication setup and validation
 * - SessionLifecycleManager: Session tracking and cleanup
 * - ConfigWatcher: Config change detection and re-initialization
 * - SdkQueryBuilder: SDK query options construction
 * - UserMessageStreamFactory: Async message stream creation
 * - StreamTransformer: SDK message to ExecutionNode transformation
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
  ExecutionNode,
  MessageId,
} from '@ptah-extension/shared';
import { Logger, ConfigManager, TOKENS } from '@ptah-extension/vscode-core';
import { SdkSessionStorage } from './sdk-session-storage';
import { StoredSessionMessage } from './types/sdk-session.types';
import { SDK_TOKENS } from './di/tokens';
import {
  AuthManager,
  SessionLifecycleManager,
  ConfigWatcher,
  SdkQueryBuilder,
  UserMessageStreamFactory,
  StreamTransformer,
  AttachmentProcessorService,
  type SDKUserMessage,
  type SessionIdResolvedCallback,
  type ResultStatsCallback,
  type ContentBlock,
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
   *
   * @param logger - Logger instance
   * @param config - Configuration manager
   * @param storage - Session storage service
   * @param authManager - Authentication manager
   * @param sessionLifecycle - Session lifecycle manager
   * @param configWatcher - Configuration change watcher
   * @param cliDetector - Claude CLI detector
   * @param queryBuilder - SDK query options builder
   * @param messageStreamFactory - User message stream factory
   * @param streamTransformer - SDK to ExecutionNode transformer
   */
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.CONFIG_MANAGER) private readonly config: ConfigManager,
    @inject(SDK_TOKENS.SDK_SESSION_STORAGE)
    private readonly storage: SdkSessionStorage,
    @inject(SDK_TOKENS.SDK_AUTH_MANAGER)
    private readonly authManager: AuthManager,
    @inject(SDK_TOKENS.SDK_SESSION_LIFECYCLE_MANAGER)
    private readonly sessionLifecycle: SessionLifecycleManager,
    @inject(SDK_TOKENS.SDK_CONFIG_WATCHER)
    private readonly configWatcher: ConfigWatcher,
    @inject(SDK_TOKENS.SDK_CLI_DETECTOR)
    private readonly cliDetector: ClaudeCliDetector,
    @inject(SDK_TOKENS.SDK_QUERY_BUILDER)
    private readonly queryBuilder: SdkQueryBuilder,
    @inject(SDK_TOKENS.SDK_USER_MESSAGE_STREAM_FACTORY)
    private readonly messageStreamFactory: UserMessageStreamFactory,
    @inject(SDK_TOKENS.SDK_STREAM_TRANSFORMER)
    private readonly streamTransformer: StreamTransformer,
    @inject(SDK_TOKENS.SDK_ATTACHMENT_PROCESSOR)
    private readonly attachmentProcessor: AttachmentProcessorService
  ) {}

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
  ): Promise<AsyncIterable<ExecutionNode>> {
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

    // Create session record in storage (for persistence)
    await this.sessionLifecycle.createSessionRecord(sessionId, config?.name);

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
    const userMessageStream = this.messageStreamFactory.create(
      sessionId,
      abortController
    );

    // Log that we're using SDK's built-in CLI
    this.logger.info('[SdkAgentAdapter] Using SDK built-in Claude Code CLI', {
      sdkDetectedCli: this.cliInstallation?.path,
      usingBuiltIn: true,
    });

    const queryOptions = await this.queryBuilder.build({
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
    const sdkQuery = query(queryOptions);
    const initialModel = queryOptions.options.model;

    // Set the SDK query on the pre-registered session
    this.sessionLifecycle.setSessionQuery(sessionId, sdkQuery);

    // Return transformed stream
    return this.streamTransformer.transform({
      sdkQuery,
      sessionId,
      initialModel,
      onSessionIdResolved: this.sessionIdResolvedCallback || undefined,
      onResultStats: this.resultStatsCallback || undefined,
    });
  }

  /**
   * End a chat session
   */
  endSession(sessionId: SessionId): void {
    this.sessionLifecycle.endSession(sessionId);
  }

  /**
   * Resume a previously persisted session using SDK's resume option.
   * This reconnects to Claude's conversation context without replaying history.
   *
   * @param sessionId - The session ID to resume (must exist in storage)
   * @param config - Optional session configuration overrides
   * @returns AsyncIterable<ExecutionNode> for streaming new responses
   */
  async resumeSession(
    sessionId: SessionId,
    config?: AISessionConfig
  ): Promise<AsyncIterable<ExecutionNode>> {
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

    // Verify session exists in storage
    const storedSession = await this.storage.getSession(sessionId);
    if (!storedSession) {
      throw new Error(
        `Cannot resume session ${sessionId}: not found in storage`
      );
    }

    this.logger.info(`[SdkAgentAdapter] Resuming session: ${sessionId}`, {
      config,
      storedMessages: storedSession.messages?.length || 0,
    });

    // CRITICAL: Use real Claude session ID for resumption
    const resumeId = storedSession.claudeSessionId;

    // Create abort controller FIRST
    const abortController = new AbortController();

    // PRE-REGISTER session BEFORE creating message stream
    // This fixes race condition where UserMessageStreamFactory couldn't find session
    this.sessionLifecycle.preRegisterActiveSession(
      sessionId,
      config || {},
      abortController
    );

    // Import SDK dynamically
    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    this.logger.info('[SdkAgentAdapter] SDK imported for session resume');

    // Create user message stream (session is now pre-registered, so it can be found)
    const userMessageStream = this.messageStreamFactory.create(
      sessionId,
      abortController
    );

    // If no claudeSessionId, start fresh but keep session record (preserves UI history)
    if (!resumeId) {
      this.logger.warn(
        `[SdkAgentAdapter] Session ${sessionId} has no claudeSessionId - starting fresh SDK conversation (UI history preserved)`
      );
    }

    const queryOptions = await this.queryBuilder.build({
      userMessageStream,
      abortController,
      sessionConfig: config,
      // Only pass resumeSessionId if we have the real Claude ID
      resumeSessionId: resumeId || undefined,
    });

    this.logger.debug('[SdkAgentAdapter] SDK query options', {
      usingBuiltInCli: true,
      cwd: config?.projectPath || process.cwd(),
      model: queryOptions.options.model,
      internalSessionId: sessionId,
      realClaudeSessionId: resumeId || 'N/A (fresh start)',
      isResume: !!resumeId,
    });

    // Start SDK query
    const sdkQuery = query(queryOptions);
    const initialModel = queryOptions.options.model;

    // Set the SDK query on the pre-registered session
    this.sessionLifecycle.setSessionQuery(sessionId, sdkQuery);

    this.logger.info(
      `[SdkAgentAdapter] Session ${
        resumeId ? 'resumed' : 'started fresh'
      }: ${sessionId}`
    );

    // Return transformed stream
    return this.streamTransformer.transform({
      sdkQuery,
      sessionId,
      initialModel,
      onSessionIdResolved: this.sessionIdResolvedCallback || undefined,
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
   * If session exists in storage but not active, caller should resume first.
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
    let messageContent: string | ContentBlock[] = content;

    if (files.length > 0) {
      this.logger.debug(
        `[SdkAgentAdapter] Processing ${files.length} attachments`
      );

      const attachmentBlocks =
        await this.attachmentProcessor.processAttachments(files);

      if (attachmentBlocks.length > 0) {
        messageContent = [{ type: 'text', text: content }, ...attachmentBlocks];
      }
    }

    // Generate message ID for UI storage
    const messageId = MessageId.create();
    const messageIdStr = messageId.toString();

    // Create SDK user message (matches official SDK type from sdk.d.ts)
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

    // Store for UI history
    const storedMessage: StoredSessionMessage = {
      id: messageId,
      parentId: null,
      role: 'user',
      content: [
        {
          id: messageIdStr,
          type: 'text',
          status: 'complete',
          content,
          children: [],
          isCollapsed: false,
        },
      ],
      timestamp: Date.now(),
      model: session.currentModel,
    };

    await this.storage.addMessage(sessionId, storedMessage);

    // Queue for SDK
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
