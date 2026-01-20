/**
 * SDK Agent Adapter - IAIProvider implementation using official Claude Agent SDK
 *
 * This adapter provides direct in-process SDK communication with 10x performance
 * improvements over CLI-based integration. All dependencies are injected via DI:
 * - AuthManager: Authentication setup and validation
 * - SessionLifecycleManager: Session tracking, cleanup, query orchestration, and messaging
 * - ConfigWatcher: Config change detection and re-initialization
 * - StreamTransformer: SDK message to ExecutionNode transformation
 * - SessionMetadataStore: UI metadata storage (names, timestamps, costs)
 * - SdkModuleLoader: Loads and caches SDK query function (for preload)
 * - SdkModelService: Fetches and caches supported models
 *
 * TASK_2025_102: Query orchestration and messaging moved to SessionLifecycleManager
 * Architecture: Thin orchestration layer that delegates to focused helper services.
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
  SubagentRecord,
} from '@ptah-extension/shared';
import { Logger, ConfigManager, TOKENS } from '@ptah-extension/vscode-core';
import { SDK_TOKENS } from './di/tokens';
import { SessionMetadataStore } from './session-metadata-store';
import { ModelInfo } from './types/sdk-types/claude-sdk.types';
import {
  AuthManager,
  SessionLifecycleManager,
  ConfigWatcher,
  StreamTransformer,
  SdkModuleLoader,
  SdkModelService,
  type SessionIdResolvedCallback,
  type ResultStatsCallback,
  type CompactionStartCallback,
} from './helpers';
import {
  ClaudeCliDetector,
  ClaudeInstallation,
} from './detector/claude-cli-detector';

// Re-export for external consumers
export type {
  SessionIdResolvedCallback,
  ResultStatsCallback,
  CompactionStartCallback,
} from './helpers';

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
   * Callback to notify when compaction starts (TASK_2025_098)
   * Set by RpcMethodRegistrationService to send session:compacting events
   */
  private compactionStartCallback: CompactionStartCallback | null = null;

  /**
   * Create SDK Agent Adapter with all dependencies injected
   * TASK_2025_102: Reduced dependencies - query orchestration moved to SessionLifecycleManager
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
    @inject(SDK_TOKENS.SDK_MODULE_LOADER)
    private readonly moduleLoader: SdkModuleLoader,
    @inject(SDK_TOKENS.SDK_MODEL_SERVICE)
    private readonly modelService: SdkModelService
  ) {}

  /**
   * Pre-load the SDK during extension activation (non-blocking).
   * Delegates to SdkModuleLoader for the actual loading.
   */
  public async preloadSdk(): Promise<void> {
    return this.moduleLoader.preload();
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
   * Delegates to SdkModelService for fetching and caching.
   *
   * @returns Array of ModelInfo with value (API ID), displayName, and description
   */
  async getSupportedModels(): Promise<ModelInfo[]> {
    return this.modelService.getSupportedModels();
  }

  /**
   * Get default model - first from supported models
   * Delegates to SdkModelService.
   */
  async getDefaultModel(): Promise<string> {
    return this.modelService.getDefaultModel();
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
   * Start a NEW chat session with streaming support
   *
   * TASK_2025_093: Uses tabId as the primary tracking key for session lifecycle.
   * TASK_2025_102: Refactored to use SessionLifecycleManager.executeQuery()
   *
   * @param config - Session configuration with REQUIRED tabId
   */
  async startChatSession(
    config: AISessionConfig & {
      /** REQUIRED: Frontend tab identifier for routing and multi-tab isolation */
      tabId: string;
      name?: string;
      prompt?: string;
      files?: string[];
      /**
       * Premium user flag - enables MCP server and Ptah system prompt (TASK_2025_108)
       * When true, enables Ptah MCP server and appends PTAH_SYSTEM_PROMPT
       * Defaults to false (free tier behavior)
       */
      isPremium?: boolean;
    }
  ): Promise<AsyncIterable<FlatStreamEventUnion>> {
    if (!this.initialized) {
      throw new Error(
        'SdkAgentAdapter not initialized. Call initialize() first.'
      );
    }

    const { tabId, isPremium = false } = config;
    const trackingId = tabId as SessionId;

    this.logger.info(
      `[SdkAgentAdapter] Starting NEW chat session for tab: ${tabId}`,
      { isPremium }
    );

    // TASK_2025_102: Delegate query execution to SessionLifecycleManager
    // TASK_2025_098: Pass compactionStartCallback for compaction notifications
    // TASK_2025_108: Pass isPremium for premium feature gating (MCP + system prompt)
    const { sdkQuery, initialModel } = await this.sessionLifecycle.executeQuery(
      {
        sessionId: trackingId,
        sessionConfig: config,
        initialPrompt: config.prompt
          ? { content: config.prompt, files: config.files }
          : undefined,
        onCompactionStart: this.compactionStartCallback || undefined,
        isPremium,
      }
    );

    // Create callback that saves metadata AND notifies webview
    const sessionIdCallback = this.createSessionIdCallback(
      config?.projectPath || process.cwd(),
      config?.name || `Session ${new Date().toLocaleDateString()}`,
      config?.tabId
    );

    // Return transformed stream
    return this.streamTransformer.transform({
      sdkQuery,
      sessionId: trackingId,
      initialModel,
      onSessionIdResolved: sessionIdCallback,
      onResultStats: this.resultStatsCallback || undefined,
      tabId: config?.tabId,
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
   * TASK_2025_102: Refactored to use SessionLifecycleManager.executeQuery()
   * TASK_2025_108: Added isPremium support for resumed sessions
   *
   * When resuming a session, the SDK creates a new query with fresh options.
   * MCP server configuration and system prompt are part of query options,
   * not stored session state, so isPremium must be passed to maintain
   * premium features (MCP server, Ptah system prompt) in resumed sessions.
   *
   * @param sessionId - The SDK session ID to resume
   * @param config - Optional session configuration overrides, including isPremium flag
   * @returns AsyncIterable<FlatStreamEventUnion> for streaming responses
   */
  async resumeSession(
    sessionId: SessionId,
    config?: AISessionConfig & {
      /**
       * Premium user flag - enables MCP server and Ptah system prompt (TASK_2025_108)
       * When true, enables Ptah MCP server and appends PTAH_SYSTEM_PROMPT
       * Defaults to false (free tier behavior)
       */
      isPremium?: boolean;
    }
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

    // Extract isPremium from config (TASK_2025_108)
    const isPremium = config?.isPremium ?? false;

    this.logger.info(`[SdkAgentAdapter] Resuming session: ${sessionId}`, {
      isPremium,
    });

    // TASK_2025_102: Delegate query execution to SessionLifecycleManager
    // TASK_2025_098: Pass compactionStartCallback for compaction notifications
    // TASK_2025_108: Pass isPremium for premium feature gating (MCP + system prompt)
    const { sdkQuery, initialModel } = await this.sessionLifecycle.executeQuery(
      {
        sessionId,
        sessionConfig: config,
        resumeSessionId: sessionId as string,
        onCompactionStart: this.compactionStartCallback || undefined,
        isPremium,
      }
    );

    // For resumed sessions, just update lastActiveAt (metadata already exists)
    const resumeCallback = async (
      tabId: string | undefined,
      realSessionId: string
    ) => {
      await this.metadataStore.touch(realSessionId);
      if (this.sessionIdResolvedCallback) {
        this.sessionIdResolvedCallback(tabId, realSessionId);
      }
    };

    // Return transformed stream
    return this.streamTransformer.transform({
      sdkQuery,
      sessionId,
      initialModel,
      onSessionIdResolved: resumeCallback,
      onResultStats: this.resultStatsCallback || undefined,
    });
  }

  /**
   * Resume an interrupted subagent using SDK's native resume option.
   *
   * TASK_2025_103: Subagent Resumption Feature
   *
   * This method resumes a specific subagent that was interrupted (e.g., due to
   * session abort). It uses the subagent's sessionId with SDK's resume parameter
   * to continue execution from where it left off.
   *
   * Note: The subagent's sessionId is different from the parent session ID.
   * The subagent has its own session context that is resumed.
   *
   * @param record - SubagentRecord containing the subagent's session info
   * @returns AsyncIterable<FlatStreamEventUnion> for streaming responses
   */
  async resumeSubagent(
    record: SubagentRecord
  ): Promise<AsyncIterable<FlatStreamEventUnion>> {
    if (!this.initialized) {
      throw new Error(
        'SdkAgentAdapter not initialized. Call initialize() first.'
      );
    }

    const { sessionId, toolCallId, agentType, parentSessionId, agentId } =
      record;

    this.logger.info('[SdkAgentAdapter] Resuming interrupted subagent', {
      toolCallId,
      sessionId,
      agentType,
      agentId,
      parentSessionId,
    });

    // Use the subagent's sessionId for resume, NOT the parent session ID
    // The subagent has its own session context that we're resuming
    const subagentSessionId = sessionId as SessionId;

    // Delegate query execution to SessionLifecycleManager with resume option
    // TASK_2025_098: Pass compactionStartCallback for compaction notifications
    const { sdkQuery, initialModel } = await this.sessionLifecycle.executeQuery(
      {
        sessionId: subagentSessionId,
        resumeSessionId: sessionId, // Resume the subagent's session
        onCompactionStart: this.compactionStartCallback || undefined,
      }
    );

    this.logger.info('[SdkAgentAdapter] Subagent resume query started', {
      toolCallId,
      sessionId,
      initialModel,
    });

    // Callback to update metadata when session ID is confirmed
    const resumeCallback = async (
      tabId: string | undefined,
      realSessionId: string
    ) => {
      await this.metadataStore.touch(realSessionId);
      if (this.sessionIdResolvedCallback) {
        this.sessionIdResolvedCallback(tabId, realSessionId);
      }
    };

    // Return transformed stream
    return this.streamTransformer.transform({
      sdkQuery,
      sessionId: subagentSessionId,
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
   * Set callback for when compaction starts (TASK_2025_098)
   * Called by RpcMethodRegistrationService to send session:compacting events to webview
   */
  setCompactionStartCallback(callback: CompactionStartCallback): void {
    this.compactionStartCallback = callback;
  }

  /**
   * Send a message to an active session.
   * Delegates to SessionLifecycleManager.sendMessage()
   */
  async sendMessageToSession(
    sessionId: SessionId,
    content: string,
    options?: AIMessageOptions
  ): Promise<void> {
    return this.sessionLifecycle.sendMessage(
      sessionId,
      content,
      options?.files
    );
  }

  /**
   * Interrupt active session
   * Delegates to SessionLifecycleManager.endSession() which handles abort and cleanup
   */
  async interruptSession(sessionId: SessionId): Promise<void> {
    this.logger.info(`[SdkAgentAdapter] Interrupting session: ${sessionId}`);
    this.sessionLifecycle.endSession(sessionId);
  }

  /**
   * Set session permission level
   * Delegates to SessionLifecycleManager
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
    return this.sessionLifecycle.setSessionPermissionLevel(sessionId, level);
  }

  /**
   * Set session model
   * Delegates to SessionLifecycleManager
   */
  async setSessionModel(sessionId: SessionId, model: string): Promise<void> {
    return this.sessionLifecycle.setSessionModel(sessionId, model);
  }
}
