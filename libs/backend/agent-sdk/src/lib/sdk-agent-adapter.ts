import * as path from 'path';
import * as os from 'os';
import { existsSync } from 'fs';
import { injectable, inject } from 'tsyringe';
import {
  PLATFORM_TOKENS,
  isUnsafeWorkspacePath,
} from '@ptah-extension/platform-core';
import type {
  IPlatformInfo,
  IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import {
  IAgentAdapter,
  ProviderId,
  ProviderInfo,
  ProviderHealth,
  ProviderStatus,
  ProviderCapabilities,
  AISessionConfig,
  AIMessageOptions,
  EffortLevel,
  SessionId,
  FlatStreamEventUnion,
  type McpHttpServerOverride,
  type ProviderProfile,
  type MessageAnchorHint,
} from '@ptah-extension/shared';
import type { SdkRuntimeStateService } from './helpers/sdk-runtime-state.service';
import type { SdkAdapterEvents } from './helpers/sdk-adapter-events.service';
import type { SessionActivityRegistry } from './helpers/session-activity-registry';
import { Logger, ConfigManager, TOKENS } from '@ptah-extension/vscode-core';
import type { SentryService } from '@ptah-extension/vscode-core';
import { SDK_TOKENS } from './di/tokens';
import { AUTH_PROVIDERS_TOKENS } from '@ptah-extension/auth-providers-tokens';
import { AuthRequiredError } from './errors';
import { getActiveProviderId } from './helpers';
import { SessionMetadataStore } from './session-metadata-store';
import {
  ModelInfo,
  type ForkSessionResult,
  type RewindFilesResult,
} from './types/sdk-types/claude-sdk.types';
import type { IAuthEnvProvider } from './auth-env.port';
import {
  SessionLifecycleManager,
  StreamTransformer,
  SdkModuleLoader,
  SdkModelService,
  SdkWarmQueryManager,
  SessionForkService,
  SdkAdapterCallbackRegistry,
  type SessionIdResolvedCallback,
  type ResultStatsCallback,
  type CompactionStartCallback,
  type WorktreeCreatedCallback,
  type WorktreeRemovedCallback,
  type SlashCommandConfig,
  type WarmPrewarmFingerprint,
  type WarmQueryHandle,
} from './helpers';
import {
  ClaudeCliDetector,
  ClaudeInstallation,
} from './detector/claude-cli-detector';

export type {
  SessionIdResolvedCallback,
  ResultStatsCallback,
  CompactionStartCallback,
  WorktreeCreatedCallback,
  WorktreeRemovedCallback,
} from './helpers';

export type { WarmQueryHandle, WarmPrewarmFingerprint } from './helpers';

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

const SDK_PROVIDER_INFO: ProviderInfo = {
  id: 'claude-cli' as ProviderId,
  name: 'Claude Agent SDK',
  version: '1.0.0',
  description: 'Official Claude Agent SDK integration (in-process)',
  vendor: 'Anthropic',
  capabilities: SDK_CAPABILITIES,
  maxContextTokens: 1_000_000,
  supportedModels: [],
};

@injectable()
export class SdkAgentAdapter implements IAgentAdapter {
  readonly providerId: ProviderId = 'claude-cli' as ProviderId;
  readonly info: ProviderInfo = SDK_PROVIDER_INFO;

  private initialized = false;

  private cliInstallation: ClaudeInstallation | null = null;

  private readonly callbacks: SdkAdapterCallbackRegistry;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.CONFIG_MANAGER) private readonly config: ConfigManager,
    @inject(SDK_TOKENS.SDK_RUNTIME_STATE)
    private readonly runtimeState: SdkRuntimeStateService,
    @inject(SDK_TOKENS.SDK_SESSION_METADATA_STORE)
    private readonly metadataStore: SessionMetadataStore,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_AUTH_MANAGER)
    private readonly authManager: IAuthEnvProvider,
    @inject(SDK_TOKENS.SDK_SESSION_LIFECYCLE_MANAGER)
    private readonly sessionLifecycle: SessionLifecycleManager,
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
    @inject(SDK_TOKENS.SDK_WARM_QUERY_MANAGER)
    private readonly warmQueryManager: SdkWarmQueryManager,
    @inject(SDK_TOKENS.SDK_SESSION_FORK_SERVICE)
    private readonly forkService: SessionForkService,
    @inject(TOKENS.SENTRY_SERVICE)
    private readonly sentryService: SentryService,
    @inject(SDK_TOKENS.SDK_ADAPTER_EVENTS)
    private readonly events: SdkAdapterEvents,
    @inject(SDK_TOKENS.SDK_SESSION_ACTIVITY_REGISTRY)
    private readonly activityRegistry: SessionActivityRegistry,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspaceProvider: IWorkspaceProvider,
  ) {
    this.callbacks = new SdkAdapterCallbackRegistry();
    this.workspaceProvider.onDidChangeWorkspaceFolders(() => {
      this.handleWorkspaceChanged();
    });
    this.events.onConfigChanged(async () => {
      this.logger.info(
        '[SdkAgentAdapter] Config change detected, re-initializing...',
      );
      await this.sessionLifecycle.disposeAllSessions();
      this.cliDetector.clearCache();
      this.modelService.clearCache();
      this.cliInstallation = null;
      await this.initialize();
    });
    this.events.onAuthFileChanged(async (event) => {
      // Only recover when the adapter is unusable. A healthy adapter reads
      // refreshed OAuth tokens per-request through the translation proxy, so a
      // token refresh needs no reset — re-initializing here would loop.
      const health = this.runtimeState.getHealth();
      if (this.initialized && health.status !== 'error') {
        return;
      }
      this.logger.info(
        `[SdkAgentAdapter] Auth file changed for ${event.providerId} while adapter unhealthy — re-initializing...`,
      );
      await this.initialize();
    });
  }

  /**
   * Build the auth-required error thrown when an operation runs before the
   * adapter is usable. Surfaces the active provider and the last health
   * `errorMessage` so the UI can render an actionable re-auth banner.
   */
  private notInitializedError(): AuthRequiredError {
    let providerId: string | null = null;
    try {
      providerId = getActiveProviderId(this.authManager.getAuthEnv());
    } catch {
      providerId = null;
    }
    const recoveryHint = this.runtimeState.getHealth().errorMessage ?? null;
    return new AuthRequiredError(
      recoveryHint ??
        'Provider is not ready. Check authentication in Settings.',
      { providerId, recoveryHint },
    );
  }

  public async preloadSdk(): Promise<void> {
    return this.moduleLoader.preload();
  }

  public async prewarm(
    activeMcpServers?: Record<string, unknown>,
  ): Promise<void> {
    const cwd = this.resolveSafeCwd();
    return this.warmQueryManager.prewarm(
      this.runtimeState.getCliJsPath(),
      cwd,
      activeMcpServers,
    );
  }

  public consumeWarmQuery(
    requirements?: WarmPrewarmFingerprint,
  ): WarmQueryHandle | null {
    return this.warmQueryManager.consumeWarmQuery(requirements);
  }

  /**
   * Returns the active workspace root only when it passes the safety guard
   * (not the install dir, not a filesystem root, not app storage). Used to
   * decide whether prewarm is allowed at all.
   */
  private resolveSafeCwd(): string | null {
    const root = this.workspaceProvider.getWorkspaceRoot();
    if (!root) return null;
    const safety = isUnsafeWorkspacePath(root, this.platformInfo);
    if (!safety.ok) {
      this.logger.warn(
        `[SdkAgentAdapter] Active workspace root is unsafe — ${safety.reason}`,
      );
      return null;
    }
    return root;
  }

  /**
   * On workspace switch the pre-warmed SDK subprocess (spawned with the
   * previous cwd) is no longer valid — `WarmQuery.query(prompt)` cannot
   * rebind cwd, so reusing it would leak the old workspace into the next
   * new session. Discard the warm handle and respawn against the new cwd
   * so the next `chat:start` still hits the fast path.
   */
  private handleWorkspaceChanged(): void {
    this.warmQueryManager.discardWarmHandle();
    if (!this.initialized) {
      return;
    }
    this.prewarm().catch((err) => {
      this.logger.warn(
        '[SdkAgentAdapter] Re-prewarm after workspace change failed',
        err instanceof Error ? err : new Error(String(err)),
      );
    });
  }

  async initialize(): Promise<boolean> {
    try {
      this.logger.info('[SdkAgentAdapter] Initializing SDK adapter...');

      const authMethod = this.config.get<string>('authMethod') || 'apiKey';
      const authResult =
        await this.authManager.configureAuthentication(authMethod);

      if (!authResult.configured) {
        this.runtimeState.setHealth({
          status: 'error' as ProviderStatus,
          lastCheck: Date.now(),
          errorMessage: authResult.errorMessage,
        });
        this.events.emitInitialized({
          success: false,
          timestamp: Date.now(),
        });
        return false;
      }

      this.logger.info(
        '[SdkAgentAdapter] Detecting Claude CLI installation...',
      );
      const configuredPath = this.config.get<string>('claudeCliPath');
      if (configuredPath) {
        this.cliDetector.configure({ configuredPath });
      }

      this.cliInstallation = await this.cliDetector.findExecutable();

      if (this.cliInstallation) {
        this.runtimeState.setCliJsPath(this.cliInstallation.cliJsPath ?? null);
        this.logger.info('[SdkAgentAdapter] Claude CLI found', {
          path: this.cliInstallation.path,
          source: this.cliInstallation.source,
          cliJsPath: this.cliInstallation.cliJsPath,
          useDirectExecution: this.cliInstallation.useDirectExecution,
        });
      } else {
        const bundledCliPath = path.join(
          this.platformInfo.extensionPath,
          'cli.js',
        );
        if (existsSync(bundledCliPath)) {
          this.runtimeState.setCliJsPath(bundledCliPath);
          this.logger.info(
            '[SdkAgentAdapter] Claude CLI not found - using bundled cli.js fallback',
            { bundledCliPath },
          );
        } else {
          this.runtimeState.setCliJsPath(null);
          this.logger.error(
            '[SdkAgentAdapter] Bundled cli.js not found at expected path',
            new Error(`cli.js missing at ${bundledCliPath}`),
          );
        }
      }

      this.initialized = true;
      this.runtimeState.setHealth({
        status: 'available' as ProviderStatus,
        lastCheck: Date.now(),
        responseTime: 0,
        uptime: Date.now(),
      });

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
      this.events.emitInitialized({ success: true, timestamp: Date.now() });
      return true;
    } catch (error) {
      const errorObj =
        error instanceof Error ? error : new Error(String(error));
      this.sentryService.captureException(errorObj, {
        errorSource: 'SdkAgentAdapter.initialize',
      });
      this.logger.error('[SdkAgentAdapter] Initialization failed', errorObj);
      this.runtimeState.setHealth({
        status: 'error' as ProviderStatus,
        lastCheck: Date.now(),
        errorMessage: errorObj.message,
      });
      this.events.emitInitialized({ success: false, timestamp: Date.now() });
      return false;
    }
  }

  dispose(): void {
    this.logger.info('[SdkAgentAdapter] Disposing adapter...');
    this.events.emitDisposed({ timestamp: Date.now() });
    this.sessionLifecycle
      .disposeAllSessions()
      .catch((err) => {
        this.logger.warn(
          '[SdkAgentAdapter] Error during session disposal',
          err instanceof Error ? err : new Error(String(err)),
        );
      })
      .finally(() => {
        this.sessionLifecycle.dispose();
      });
    this.authManager.clearAuthentication();
    this.modelService.clearCache();
    this.warmQueryManager.dispose();
    this.initialized = false;
    this.runtimeState.reset();
    this.logger.info('[SdkAgentAdapter] Disposed successfully');
  }

  clearModelCache(): void {
    this.modelService.clearCache();
  }

  async verifyInstallation(): Promise<boolean> {
    return true;
  }

  getHealth(): ProviderHealth {
    return this.runtimeState.getHealth();
  }

  getCliJsPath(): string | null {
    return this.runtimeState.getCliJsPath();
  }

  async getSupportedModels(): Promise<ModelInfo[]> {
    return this.modelService.getSupportedModels();
  }

  async getDefaultModel(): Promise<string> {
    return this.modelService.getDefaultModel();
  }

  async getApiModels(): Promise<ModelInfo[]> {
    return this.modelService.getApiModelsNormalized();
  }

  async reset(): Promise<void> {
    this.logger.info('[SdkAgentAdapter] Resetting adapter...');
    this.dispose();
    await this.initialize();
  }

  async startChatSession(
    config: AISessionConfig & {
      tabId: string;
      name?: string;
      prompt?: string;
      files?: string[];
      images?: { data: string; mediaType: string }[];
      isPremium?: boolean;
      mcpServerRunning?: boolean;
      enhancedPromptsContent?: string;
      pluginPaths?: string[];
      includePartialMessages?: boolean;
      mcpServersOverride?: Record<string, McpHttpServerOverride>;
      providerProfile?: ProviderProfile;
    },
  ): Promise<AsyncIterable<FlatStreamEventUnion>> {
    if (!this.initialized) {
      throw this.notInitializedError();
    }

    const {
      tabId,
      isPremium = false,
      mcpServerRunning = true,
      enhancedPromptsContent,
      pluginPaths,
      includePartialMessages,
      mcpServersOverride,
      providerProfile,
    } = config;
    const trackingId = tabId as SessionId;
    const currentCliJsPath = this.runtimeState.getCliJsPath();
    const effectiveCliJsPath = providerProfile?.cliJsPath ?? currentCliJsPath;
    const effectiveAuthEnv = providerProfile?.authEnv;
    const sessionConfigWithProfileModel: typeof config = providerProfile
      ? { ...config, model: providerProfile.model }
      : config;

    this.logger.info(
      `[SdkAgentAdapter] Starting NEW chat session for tab: ${tabId}`,
      { isPremium, mcpServerRunning, providerId: providerProfile?.providerId },
    );

    const requestedCwd = config?.projectPath
      ? path.resolve(config.projectPath)
      : null;
    const warmHandle =
      mcpServersOverride || providerProfile || !requestedCwd
        ? null
        : this.warmQueryManager.consumeWarmQuery({
            pathToClaudeCodeExecutable: currentCliJsPath,
            mcpServers: null,
            baseUrl: null,
            authEnvHash: null,
            cwd: requestedCwd,
          });

    const { sdkQuery, initialModel, abortController } =
      await this.sessionLifecycle.executeQuery({
        sessionId: trackingId,
        sessionConfig: sessionConfigWithProfileModel,
        initialPrompt: config.prompt
          ? {
              content: config.prompt,
              files: config.files,
              images: config.images as
                | { data: string; mediaType: string }[]
                | undefined,
            }
          : undefined,
        onCompactionStart: this.callbacks.getCompactionStart(),
        onWorktreeCreated: this.callbacks.getWorktreeCreated(),
        onWorktreeRemoved: this.callbacks.getWorktreeRemoved(),
        isPremium,
        mcpServerRunning,
        enhancedPromptsContent,
        pluginPaths,
        pathToClaudeCodeExecutable: effectiveCliJsPath || undefined,
        includePartialMessages,
        mcpServersOverride,
        authEnvOverride: effectiveAuthEnv,
        warmQuery: warmHandle ?? undefined,
      });

    const resolvedProjectPath = config?.projectPath || os.homedir();
    const sessionIdCallback = this.createSessionIdCallback(
      resolvedProjectPath,
      config?.name || `Session ${new Date().toLocaleDateString()}`,
      config?.tabId,
    );

    if (config.prompt) {
      this.notifyActivity(trackingId, 'user', resolvedProjectPath);
    }

    return this.streamTransformer.transform({
      sdkQuery,
      sessionId: trackingId,
      initialModel,
      onSessionIdResolved: sessionIdCallback,
      onResultStats: this.wrapResultStatsForActivity(
        trackingId,
        this.callbacks.getResultStats(),
      ),
      tabId: config?.tabId,
      abortController,
    });
  }

  endSession(sessionId: SessionId): void {
    this.sessionLifecycle.endSession(sessionId).catch((err) => {
      this.logger.warn(
        '[SdkAgentAdapter] Error ending session',
        err instanceof Error ? err : new Error(String(err)),
      );
    });
  }

  async resumeSession(
    sessionId: SessionId,
    config?: AISessionConfig & {
      isPremium?: boolean;
      mcpServerRunning?: boolean;
      enhancedPromptsContent?: string;
      pluginPaths?: string[];
      tabId?: string;
      includePartialMessages?: boolean;
      providerProfile?: ProviderProfile;
    },
  ): Promise<AsyncIterable<FlatStreamEventUnion>> {
    if (!this.initialized) {
      throw this.notInitializedError();
    }

    const existingSession = this.sessionLifecycle.find(sessionId as string);
    if (existingSession && existingSession.query) {
      this.logger.info(
        `[SdkAgentAdapter] Session ${sessionId} already active, returning existing stream`,
      );
      return this.streamTransformer.transform({
        sdkQuery: existingSession.query,
        sessionId,
        initialModel: existingSession.currentModel,
        onSessionIdResolved: this.callbacks.getSessionIdResolved(),
        onResultStats: this.wrapResultStatsForActivity(
          sessionId,
          this.callbacks.getResultStats(),
        ),
        tabId: config?.tabId,
      });
    }

    const isPremium = config?.isPremium ?? false;
    const mcpServerRunning = config?.mcpServerRunning ?? true;
    const enhancedPromptsContent = config?.enhancedPromptsContent;
    const pluginPaths = config?.pluginPaths;
    const includePartialMessages = config?.includePartialMessages;
    const providerProfile = config?.providerProfile;
    const effectiveCliJsPath =
      providerProfile?.cliJsPath ?? this.runtimeState.getCliJsPath();
    const effectiveAuthEnv = providerProfile?.authEnv;
    const sessionConfigWithProfileModel = providerProfile
      ? { ...config, model: providerProfile.model }
      : config;

    this.logger.info(`[SdkAgentAdapter] Resuming session: ${sessionId}`, {
      isPremium,
      mcpServerRunning,
      providerId: providerProfile?.providerId,
    });

    const { sdkQuery, initialModel, abortController } =
      await this.sessionLifecycle.executeQuery({
        sessionId,
        sessionConfig: sessionConfigWithProfileModel,
        resumeSessionId: sessionId as string,
        onCompactionStart: this.callbacks.getCompactionStart(),
        onWorktreeCreated: this.callbacks.getWorktreeCreated(),
        onWorktreeRemoved: this.callbacks.getWorktreeRemoved(),
        isPremium,
        mcpServerRunning,
        enhancedPromptsContent,
        pluginPaths,
        pathToClaudeCodeExecutable: effectiveCliJsPath || undefined,
        includePartialMessages,
        authEnvOverride: effectiveAuthEnv,
      });

    const resumeCallback = async (
      tabId: string | undefined,
      realSessionId: string,
    ) => {
      await this.metadataStore.touch(realSessionId);

      if (tabId) {
        this.sessionLifecycle.bindRealSessionId(tabId, realSessionId);
      }

      this.callbacks.emitSessionIdResolved(tabId, realSessionId);
    };

    return this.streamTransformer.transform({
      sdkQuery,
      sessionId,
      initialModel,
      onSessionIdResolved: resumeCallback,
      onResultStats: this.wrapResultStatsForActivity(
        sessionId,
        this.callbacks.getResultStats(),
      ),
      tabId: config?.tabId,
      abortController,
    });
  }

  isSessionActive(sessionId: SessionId): boolean {
    return this.sessionLifecycle.find(sessionId as string) !== undefined;
  }

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

      await this.metadataStore.create(realSessionId, workspaceId, sessionName);

      if (tabId) {
        this.sessionLifecycle.bindRealSessionId(tabId, realSessionId);
      }

      this.callbacks.emitSessionIdResolved(tabId, realSessionId);
    };
  }

  setSessionIdResolvedCallback(callback: SessionIdResolvedCallback): void {
    this.callbacks.setSessionIdResolved(callback);
  }

  setResultStatsCallback(callback: ResultStatsCallback): void {
    this.callbacks.setResultStats(callback);
  }

  setCompactionStartCallback(callback: CompactionStartCallback): void {
    this.callbacks.setCompactionStart(callback);
  }

  setWorktreeCreatedCallback(callback: WorktreeCreatedCallback): void {
    this.callbacks.setWorktreeCreated(callback);
  }

  setWorktreeRemovedCallback(callback: WorktreeRemovedCallback): void {
    this.callbacks.setWorktreeRemoved(callback);
  }

  async sendMessageToSession(
    sessionId: SessionId,
    content: string,
    options?: AIMessageOptions,
  ): Promise<void> {
    this.notifyActivity(sessionId, 'user');
    return this.sessionLifecycle.sendMessage(
      sessionId,
      content,
      options?.files,
      options?.images as { data: string; mediaType: string }[] | undefined,
    );
  }

  async executeSlashCommand(
    sessionId: SessionId,
    command: string,
    config: SlashCommandConfig & { tabId?: string },
  ): Promise<AsyncIterable<FlatStreamEventUnion>> {
    if (!this.initialized) {
      throw this.notInitializedError();
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
        onCompactionStart: this.callbacks.getCompactionStart(),
        onWorktreeCreated: this.callbacks.getWorktreeCreated(),
        onWorktreeRemoved: this.callbacks.getWorktreeRemoved(),
        pathToClaudeCodeExecutable:
          this.runtimeState.getCliJsPath() || undefined,
      });

    this.notifyActivity(sessionId, 'user');

    return this.streamTransformer.transform({
      sdkQuery,
      sessionId,
      initialModel,
      onSessionIdResolved: this.callbacks.getSessionIdResolved(),
      onResultStats: this.wrapResultStatsForActivity(
        sessionId,
        this.callbacks.getResultStats(),
      ),
      tabId: config.tabId,
      abortController,
    });
  }

  async interruptCurrentTurn(sessionId: SessionId): Promise<boolean> {
    this.logger.info(
      `[SdkAgentAdapter] Interrupting current turn: ${sessionId}`,
    );
    return this.sessionLifecycle.interruptCurrentTurn(sessionId);
  }

  async interruptSession(sessionId: SessionId): Promise<void> {
    this.logger.info(`[SdkAgentAdapter] Interrupting session: ${sessionId}`);
    await this.sessionLifecycle.endSession(sessionId);
  }

  async forkSession(
    sessionId: SessionId,
    upToMessageId?: string,
    title?: string,
    kind?: 'rewind' | 'branch',
    anchorHint?: MessageAnchorHint,
  ): Promise<ForkSessionResult> {
    if (!this.initialized) {
      throw this.notInitializedError();
    }
    return this.forkService.forkSession({
      sessionId,
      upToMessageId,
      anchorHint,
      title,
      kind,
    });
  }

  async rewindFiles(
    sessionId: SessionId,
    userMessageId: string,
    dryRun?: boolean,
    anchorHint?: MessageAnchorHint,
  ): Promise<RewindFilesResult> {
    if (!this.initialized) {
      throw this.notInitializedError();
    }
    return this.forkService.rewindFiles({
      sessionId,
      userMessageId,
      anchorHint,
      dryRun,
    });
  }

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

  async setSessionModel(sessionId: SessionId, model: string): Promise<void> {
    return this.sessionLifecycle.setSessionModel(sessionId, model);
  }

  async setSessionEffort(
    sessionId: SessionId,
    effort: EffortLevel | undefined,
  ): Promise<void> {
    return this.sessionLifecycle.setSessionEffort(sessionId, effort);
  }

  private resolveActivityIds(sessionId: SessionId): {
    sessionId: string;
    workspaceRoot: string;
  } {
    const rec = this.sessionLifecycle.find(sessionId as string);
    const resolvedSessionId = rec?.realSessionId ?? (sessionId as string);
    const workspaceRoot = rec?.config?.projectPath ?? '';
    return { sessionId: resolvedSessionId, workspaceRoot };
  }

  private notifyActivity(
    sessionId: SessionId,
    role: 'user' | 'assistant',
    workspaceRootOverride?: string,
  ): void {
    try {
      const ids = this.resolveActivityIds(sessionId);
      this.activityRegistry.notifyAll({
        sessionId: ids.sessionId,
        workspaceRoot: workspaceRootOverride ?? ids.workspaceRoot,
        role,
        timestamp: Date.now(),
      });
    } catch (err: unknown) {
      this.logger.warn(
        '[SdkAgentAdapter] activity notify failed',
        err instanceof Error ? err : new Error(String(err)),
      );
    }
  }

  private wrapResultStatsForActivity(
    sessionId: SessionId,
    inner: ResultStatsCallback | undefined,
  ): ResultStatsCallback {
    return (stats) => {
      this.notifyActivity(sessionId, 'assistant');
      if (inner) {
        inner(stats);
      }
    };
  }
}
