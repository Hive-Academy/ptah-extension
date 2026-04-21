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

import * as path from 'path';
import * as os from 'os';
import { existsSync } from 'fs';
import { injectable, inject } from 'tsyringe';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IPlatformInfo } from '@ptah-extension/platform-core';
import {
  IAgentAdapter,
  ProviderId,
  ProviderInfo,
  ProviderHealth,
  ProviderStatus,
  ProviderCapabilities,
  AISessionConfig,
  AIMessageOptions,
  SessionId,
  FlatStreamEventUnion,
} from '@ptah-extension/shared';
import { Logger, ConfigManager, TOKENS } from '@ptah-extension/vscode-core';
import type { SentryService } from '@ptah-extension/vscode-core';
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
  type WorktreeCreatedCallback,
  type WorktreeRemovedCallback,
  type SlashCommandConfig,
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
  WorktreeCreatedCallback,
  WorktreeRemovedCallback,
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
  maxContextTokens: 1_000_000,
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
export class SdkAgentAdapter implements IAgentAdapter {
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
   * TASK_2025_194: Resolved path to cli.js - either from detected CLI or bundled fallback.
   * Always set during successful initialization. Passed to SDK as pathToClaudeCodeExecutable.
   */
  private cliJsPath: string | null = null;

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
   * Callback to notify when SDK creates a worktree (TASK_2025_236)
   * Set by RpcMethodRegistrationService to send git:worktreeChanged events
   */
  private worktreeCreatedCallback: WorktreeCreatedCallback | null = null;

  /**
   * Callback to notify when SDK removes a worktree (TASK_2025_236)
   * Set by RpcMethodRegistrationService to send git:worktreeChanged events
   */
  private worktreeRemovedCallback: WorktreeRemovedCallback | null = null;

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
    private readonly modelService: SdkModelService,
    @inject(PLATFORM_TOKENS.PLATFORM_INFO)
    private readonly platformInfo: IPlatformInfo,
    @inject(TOKENS.SENTRY_SERVICE)
    private readonly sentryService: SentryService,
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
          '[SdkAgentAdapter] Config change detected, re-initializing...',
        );
        // TASK_2025_175: disposeAllSessions is now async, await it
        await this.sessionLifecycle.disposeAllSessions();
        this.cliDetector.clearCache();
        // Clear model cache so re-init fetches fresh models with new auth
        this.modelService.clearCache();
        this.cliInstallation = null;
        await this.initialize();
      });

      // Step 1: Configure authentication FIRST (not dependent on CLI)
      // TASK_2025_194: Auth runs before CLI detection so third-party providers
      // (Z.AI, OpenRouter) work even without Claude CLI installed.
      const authMethod = this.config.get<string>('authMethod') || 'apiKey';
      const authResult =
        await this.authManager.configureAuthentication(authMethod);

      if (!authResult.configured) {
        this.health = {
          status: 'error' as ProviderStatus,
          lastCheck: Date.now(),
          errorMessage: authResult.errorMessage,
        };
        return false;
      }

      // Step 2: Detect Claude CLI installation (soft requirement)
      // TASK_2025_194: CLI detection no longer gates initialization.
      // If CLI is not found, we fall back to the bundled cli.js shipped with the extension.
      this.logger.info(
        '[SdkAgentAdapter] Detecting Claude CLI installation...',
      );
      const configuredPath = this.config.get<string>('claudeCliPath');
      if (configuredPath) {
        this.cliDetector.configure({ configuredPath });
      }

      this.cliInstallation = await this.cliDetector.findExecutable();

      if (this.cliInstallation) {
        this.cliJsPath = this.cliInstallation.cliJsPath ?? null;
        this.logger.info('[SdkAgentAdapter] Claude CLI found', {
          path: this.cliInstallation.path,
          source: this.cliInstallation.source,
          cliJsPath: this.cliInstallation.cliJsPath,
          useDirectExecution: this.cliInstallation.useDirectExecution,
        });
      } else {
        // Fall back to bundled cli.js shipped alongside the extension
        const bundledCliPath = path.join(
          this.platformInfo.extensionPath,
          'cli.js',
        );
        if (existsSync(bundledCliPath)) {
          this.cliJsPath = bundledCliPath;
          this.logger.info(
            '[SdkAgentAdapter] Claude CLI not found - using bundled cli.js fallback',
            { bundledCliPath },
          );
        } else {
          this.cliJsPath = null;
          this.logger.error(
            '[SdkAgentAdapter] Bundled cli.js not found at expected path',
            new Error(`cli.js missing at ${bundledCliPath}`),
          );
        }
      }

      // Step 3: Mark as initialized
      this.initialized = true;
      this.health = {
        status: 'available' as ProviderStatus,
        lastCheck: Date.now(),
        responseTime: 0,
        uptime: Date.now(),
      };

      // Step 4: Initialize default model from SDK
      // - If no saved model: fetch and set the default
      // - If saved model is a bare tier name (legacy): resolve to full model ID
      // - If saved model is already a full ID: leave as-is
      try {
        const savedModel = this.config.get<string>('model.selected');
        if (!savedModel) {
          const defaultModel = await this.getDefaultModel();
          await this.config.set('model.selected', defaultModel);
          this.logger.info('[SdkAgentAdapter] Set default model from SDK', {
            model: defaultModel,
          });
        } else if (
          !savedModel.startsWith('claude-') &&
          savedModel !== 'default'
        ) {
          // Migrate legacy bare tier names ('opus', 'sonnet', 'haiku') to full IDs.
          // 'default' is preserved — it means "let the SDK choose" and resolves at query time.
          // Older versions stored tier names that the SDK no longer resolves.
          const resolved = this.modelService.resolveModelId(savedModel);
          if (resolved !== savedModel) {
            await this.config.set('model.selected', resolved);
            this.logger.info(
              '[SdkAgentAdapter] Migrated legacy model name in config',
              { from: savedModel, to: resolved },
            );
          }
        }
      } catch (modelError) {
        // Non-fatal - continue initialization even if model setup fails
        this.sentryService.captureException(
          modelError instanceof Error
            ? modelError
            : new Error(String(modelError)),
          { errorSource: 'SdkAgentAdapter.initialize' },
        );
        this.logger.warn(
          '[SdkAgentAdapter] Failed to set default model',
          modelError instanceof Error
            ? modelError
            : new Error(String(modelError)),
        );
      }

      this.logger.info('[SdkAgentAdapter] Initialized successfully');
      return true;
    } catch (error) {
      const errorObj =
        error instanceof Error ? error : new Error(String(error));
      this.sentryService.captureException(errorObj, {
        errorSource: 'SdkAgentAdapter.initialize',
      });
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
    // TASK_2025_175: disposeAllSessions is now async, fire and log errors
    this.sessionLifecycle.disposeAllSessions().catch((err) => {
      this.logger.warn(
        '[SdkAgentAdapter] Error during session disposal',
        err instanceof Error ? err : new Error(String(err)),
      );
    });
    this.authManager.clearAuthentication();
    this.initialized = false;
    this.cliJsPath = null;
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
   * Get the resolved path to the Claude Code CLI executable (cli.js).
   *
   * TASK_2025_194: The SDK's default import.meta.url-based resolution bakes in
   * the CI/build-time path which doesn't exist in production. This getter exposes
   * the runtime-resolved path so InternalQueryService can pass it through.
   *
   * @returns Resolved cli.js path, or null if not yet initialized
   */
  getCliJsPath(): string | null {
    return this.cliJsPath;
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
   * Get all available models from the Anthropic /v1/models API.
   * Returns ModelInfo[] (same shape as getSupportedModels) for uniform handling.
   * API models already have full IDs (e.g., 'claude-sonnet-4-5-20250514').
   */
  async getApiModels(): Promise<ModelInfo[]> {
    return this.modelService.getApiModelsNormalized();
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
      /** Inline images (pasted/dropped) to include with the initial message */
      images?: { data: string; mediaType: string }[];
      /**
       * Premium user flag - enables MCP server and Ptah system prompt (TASK_2025_108)
       * When true, enables Ptah MCP server and appends PTAH_SYSTEM_PROMPT
       * Defaults to false (free tier behavior)
       */
      isPremium?: boolean;
      /**
       * Whether the MCP server is currently running (TASK_2025_108)
       * When false, MCP config will not be included even for premium users.
       * This prevents configuring Claude with a dead MCP endpoint.
       * Defaults to true for backward compatibility.
       */
      mcpServerRunning?: boolean;
      /**
       * Enhanced prompt content for system prompt (TASK_2025_151)
       * AI-generated guidance resolved from EnhancedPromptsService.
       * When provided, appended to system prompt instead of PTAH_CORE_SYSTEM_PROMPT.
       */
      enhancedPromptsContent?: string;
      /**
       * Plugin directory paths for this session (TASK_2025_153)
       * Resolved by PluginLoaderService for premium users.
       */
      pluginPaths?: string[];
    },
  ): Promise<AsyncIterable<FlatStreamEventUnion>> {
    if (!this.initialized) {
      throw new Error(
        'SdkAgentAdapter not initialized. Call initialize() first.',
      );
    }

    const {
      tabId,
      isPremium = false,
      mcpServerRunning = true,
      enhancedPromptsContent,
      pluginPaths,
    } = config;
    const trackingId = tabId as SessionId;

    this.logger.info(
      `[SdkAgentAdapter] Starting NEW chat session for tab: ${tabId}`,
      { isPremium, mcpServerRunning },
    );

    // TASK_2025_102: Delegate query execution to SessionLifecycleManager
    // TASK_2025_098: Pass compactionStartCallback for compaction notifications
    // TASK_2025_108: Pass isPremium and mcpServerRunning for premium feature gating (MCP + system prompt)
    // TASK_2025_194: Pass pathToClaudeCodeExecutable to override baked-in import.meta.url path
    // TASK_2025_236: Pass worktree callbacks for worktree change notifications
    const { sdkQuery, initialModel, abortController } =
      await this.sessionLifecycle.executeQuery({
        sessionId: trackingId,
        sessionConfig: config,
        initialPrompt: config.prompt
          ? {
              content: config.prompt,
              files: config.files,
              images: config.images as
                | { data: string; mediaType: string }[]
                | undefined,
            }
          : undefined,
        onCompactionStart: this.compactionStartCallback || undefined,
        onWorktreeCreated: this.worktreeCreatedCallback || undefined,
        onWorktreeRemoved: this.worktreeRemovedCallback || undefined,
        isPremium,
        mcpServerRunning,
        enhancedPromptsContent,
        pluginPaths,
        pathToClaudeCodeExecutable: this.cliJsPath || undefined,
      });

    // projectPath is guaranteed by ChatRpcHandlers (validated before reaching here).
    const resolvedProjectPath = config?.projectPath || os.homedir();
    const sessionIdCallback = this.createSessionIdCallback(
      resolvedProjectPath,
      config?.name || `Session ${new Date().toLocaleDateString()}`,
      config?.tabId,
    );

    // Return transformed stream
    return this.streamTransformer.transform({
      sdkQuery,
      sessionId: trackingId,
      initialModel,
      onSessionIdResolved: sessionIdCallback,
      onResultStats: this.resultStatsCallback || undefined,
      tabId: config?.tabId,
      abortController,
    });
  }

  /**
   * End a chat session
   */
  endSession(sessionId: SessionId): void {
    // TASK_2025_175: endSession() is now async but this interface method is void.
    // Use .catch() to prevent unhandled Promise rejections.
    this.sessionLifecycle.endSession(sessionId).catch((err) => {
      this.logger.warn(
        '[SdkAgentAdapter] Error ending session',
        err instanceof Error ? err : new Error(String(err)),
      );
    });
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
      /**
       * Whether the MCP server is currently running (TASK_2025_108)
       * When false, MCP config will not be included even for premium users.
       * This prevents configuring Claude with a dead MCP endpoint.
       * Defaults to true for backward compatibility.
       */
      mcpServerRunning?: boolean;
      /**
       * Enhanced prompt content for system prompt (TASK_2025_151)
       * AI-generated guidance resolved from EnhancedPromptsService.
       * When provided, appended to system prompt instead of PTAH_CORE_SYSTEM_PROMPT.
       */
      enhancedPromptsContent?: string;
      /**
       * Plugin directory paths for this session (TASK_2025_153)
       * Resolved by PluginLoaderService for premium users.
       */
      pluginPaths?: string[];
      /**
       * Frontend tab ID for event routing
       * Passed through to StreamTransformer so SESSION_ID_RESOLVED and
       * SESSION_STATS can be routed to the correct frontend tab.
       */
      tabId?: string;
    },
  ): Promise<AsyncIterable<FlatStreamEventUnion>> {
    if (!this.initialized) {
      throw new Error(
        'SdkAgentAdapter not initialized. Call initialize() first.',
      );
    }

    // Check if session already active AND fully initialized (has query)
    const existingSession = this.sessionLifecycle.getActiveSession(sessionId);
    if (existingSession && existingSession.query) {
      this.logger.info(
        `[SdkAgentAdapter] Session ${sessionId} already active, returning existing stream`,
      );
      return this.streamTransformer.transform({
        sdkQuery: existingSession.query,
        sessionId,
        initialModel: existingSession.currentModel,
        onSessionIdResolved: this.sessionIdResolvedCallback || undefined,
        onResultStats: this.resultStatsCallback || undefined,
        tabId: config?.tabId,
      });
    }

    // Extract isPremium, mcpServerRunning, enhancedPromptsContent, and pluginPaths from config (TASK_2025_108, TASK_2025_151, TASK_2025_153)
    const isPremium = config?.isPremium ?? false;
    const mcpServerRunning = config?.mcpServerRunning ?? true;
    const enhancedPromptsContent = config?.enhancedPromptsContent;
    const pluginPaths = config?.pluginPaths;

    this.logger.info(`[SdkAgentAdapter] Resuming session: ${sessionId}`, {
      isPremium,
      mcpServerRunning,
    });

    // TASK_2025_102: Delegate query execution to SessionLifecycleManager
    // TASK_2025_098: Pass compactionStartCallback for compaction notifications
    // TASK_2025_108: Pass isPremium and mcpServerRunning for premium feature gating (MCP + system prompt)
    // TASK_2025_151: Pass enhancedPromptsContent for AI-generated system prompt
    // TASK_2025_153: Pass pluginPaths for session plugin loading
    // TASK_2025_194: Pass pathToClaudeCodeExecutable to override baked-in import.meta.url path
    // TASK_2025_236: Pass worktree callbacks for worktree change notifications
    const { sdkQuery, initialModel, abortController } =
      await this.sessionLifecycle.executeQuery({
        sessionId,
        sessionConfig: config,
        resumeSessionId: sessionId as string,
        onCompactionStart: this.compactionStartCallback || undefined,
        onWorktreeCreated: this.worktreeCreatedCallback || undefined,
        onWorktreeRemoved: this.worktreeRemovedCallback || undefined,
        isPremium,
        mcpServerRunning,
        enhancedPromptsContent,
        pluginPaths,
        pathToClaudeCodeExecutable: this.cliJsPath || undefined,
      });

    // For resumed sessions, just update lastActiveAt (metadata already exists)
    const resumeCallback = async (
      tabId: string | undefined,
      realSessionId: string,
    ) => {
      await this.metadataStore.touch(realSessionId);

      // Update SessionLifecycleManager so getActiveSessionIds() returns
      // the real UUID (same as new-session path).
      if (tabId) {
        this.sessionLifecycle.resolveRealSessionId(tabId, realSessionId);
      }

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
      tabId: config?.tabId,
      abortController,
    });
  }

  // TASK_2025_109: resumeSubagent() method removed
  // Subagent resumption is now handled via context injection in chat:continue RPC.
  // When a parent session continues with interrupted subagents, context is injected
  // into the prompt, allowing Claude to naturally resume agents through conversation.
  // See chat-rpc.handlers.ts for the context injection implementation.

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
    tabId?: string,
  ): (tabId: string | undefined, realSessionId: string) => void {
    return async (
      _tabIdFromCallback: string | undefined,
      realSessionId: string,
    ) => {
      this.logger.info(
        `[SdkAgentAdapter] Saving session metadata for ${realSessionId} (tabId: ${tabId})`,
      );

      // Save session metadata to persistent storage
      await this.metadataStore.create(realSessionId, workspaceId, sessionName);

      // Update SessionLifecycleManager so getActiveSessionIds() returns
      // the real UUID. This ensures agents spawned after this point get
      // the correct parentSessionId for CLI session persistence.
      if (tabId) {
        this.sessionLifecycle.resolveRealSessionId(tabId, realSessionId);
      }

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
   * Set callback for when SDK creates a worktree (TASK_2025_236)
   * Called by RpcMethodRegistrationService to send git:worktreeChanged events to webview
   */
  setWorktreeCreatedCallback(callback: WorktreeCreatedCallback): void {
    this.worktreeCreatedCallback = callback;
  }

  /**
   * Set callback for when SDK removes a worktree (TASK_2025_236)
   * Called by RpcMethodRegistrationService to send git:worktreeChanged events to webview
   */
  setWorktreeRemovedCallback(callback: WorktreeRemovedCallback): void {
    this.worktreeRemovedCallback = callback;
  }

  /**
   * Send a message to an active session.
   * Delegates to SessionLifecycleManager.sendMessage()
   */
  async sendMessageToSession(
    sessionId: SessionId,
    content: string,
    options?: AIMessageOptions,
  ): Promise<void> {
    return this.sessionLifecycle.sendMessage(
      sessionId,
      content,
      options?.files,
      options?.images as { data: string; mediaType: string }[] | undefined,
    );
  }

  /**
   * Execute a slash command within an existing session.
   * Starts a new SDK query with the command as a string prompt,
   * resuming the existing session to maintain conversation context.
   *
   * @see TASK_2025_184 - Follow-up slash command support
   */
  async executeSlashCommand(
    sessionId: SessionId,
    command: string,
    config: SlashCommandConfig & { tabId?: string },
  ): Promise<AsyncIterable<FlatStreamEventUnion>> {
    if (!this.initialized) {
      throw new Error(
        'SdkAgentAdapter not initialized. Call initialize() first.',
      );
    }

    this.logger.info(
      `[SdkAgentAdapter] Executing slash command for session: ${sessionId}`,
      { command: command.substring(0, 50) },
    );

    const { sdkQuery, initialModel, abortController } =
      await this.sessionLifecycle.executeSlashCommandQuery(sessionId, command, {
        sessionConfig: config.sessionConfig,
        isPremium: config.isPremium,
        mcpServerRunning: config.mcpServerRunning,
        enhancedPromptsContent: config.enhancedPromptsContent,
        pluginPaths: config.pluginPaths,
        onCompactionStart: this.compactionStartCallback || undefined,
        onWorktreeCreated: this.worktreeCreatedCallback || undefined,
        onWorktreeRemoved: this.worktreeRemovedCallback || undefined,
        pathToClaudeCodeExecutable: this.cliJsPath || undefined,
      });

    // Reuse existing stream transformation logic
    return this.streamTransformer.transform({
      sdkQuery,
      sessionId,
      initialModel,
      onSessionIdResolved: this.sessionIdResolvedCallback || undefined,
      onResultStats: this.resultStatsCallback || undefined,
      tabId: config.tabId,
      abortController,
    });
  }

  /**
   * Interrupt the current assistant turn without ending the session.
   * The session remains active for continued use.
   * Used when the user sends a message during autopilot execution.
   */
  async interruptCurrentTurn(sessionId: SessionId): Promise<boolean> {
    this.logger.info(
      `[SdkAgentAdapter] Interrupting current turn: ${sessionId}`,
    );
    return this.sessionLifecycle.interruptCurrentTurn(sessionId);
  }

  /**
   * Interrupt active session
   * Delegates to SessionLifecycleManager.endSession() which handles abort and cleanup
   */
  async interruptSession(sessionId: SessionId): Promise<void> {
    this.logger.info(`[SdkAgentAdapter] Interrupting session: ${sessionId}`);
    await this.sessionLifecycle.endSession(sessionId);
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
      | 'plan'
      | 'default'
      | 'acceptEdits'
      | 'bypassPermissions',
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
