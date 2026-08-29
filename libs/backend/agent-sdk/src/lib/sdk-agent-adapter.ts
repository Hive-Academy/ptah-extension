import * as path from 'path';
import * as os from 'os';
import { existsSync } from 'fs';
import { injectable, inject } from 'tsyringe';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
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
  type PermissionLevel,
  blankToUndefined,
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
  SessionForkService,
  SdkAdapterCallbackRegistry,
  SessionIdResolvedCallbackRegistry,
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

export type {
  SessionIdResolvedCallback,
  ResultStatsCallback,
  CompactionStartCallback,
  WorktreeCreatedCallback,
  WorktreeRemovedCallback,
} from './helpers';

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
 * A user activity reported before the session's SDK id was known. Held only
 * between `startChatSession` and the system `init` message — see
 * `SdkAgentAdapter.recordPendingUserActivity`.
 */
interface PendingUserActivity {
  readonly workspaceRoot: string;
  readonly timestamp: number;
}

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

  /**
   * The in-flight `initialize()` pass, or `null` when none is running.
   *
   * `initialized` is a LATCH, not a flight marker: it is only assigned after
   * `configureAuthentication` and `findExecutable()` have both returned, so
   * the whole expensive window used to be re-entrant. Four call sites can
   * re-enter it — the config-change and auth-file watchers, `reset()`, and
   * host activation — and the boot OAuth token refresh writes `~/.codex/auth.json`
   * while the first pass is still running, so the adapter raced itself on
   * every cold start with an expired token.
   *
   * Same shape as `AuthManager.configureAuthentication`: hold the promise,
   * hand it to the second caller, clear it in a `finally` so a FAILED init
   * does not latch permanently.
   *
   * The `finally` clears the slot ONLY when it still holds its own pass
   * (TASK_2026_308 F3-2). Without that identity check the invariant "a pass
   * only ever clears itself" is not local to `initialize` — it holds only
   * because promise reactions run FIFO, so no later writer can have replaced
   * the slot before this pass's `finally` runs. That is a true statement about
   * the JS scheduler, not about this class, and it stops being load-bearing
   * the moment any other code path writes the slot. Checking identity costs
   * one comparison and makes the invariant provable from this method alone.
   */
  private initInFlight: Promise<boolean> | null = null;

  /**
   * The tail of the reset chain, or `null` when no reset is running.
   *
   * Resets are SERIALISED rather than de-duplicated (TASK_2026_308 F3-3).
   * `doReset` promises every caller a genuinely fresh pass — one that starts
   * after that caller asked for it — so handing a second caller the reset
   * already in flight would break the same contract by a different route.
   * Each `reset()` therefore queues behind the previous one and then runs its
   * own dispose + initialize pair.
   */
  private resetChain: Promise<void> | null = null;

  private cliInstallation: ClaudeInstallation | null = null;

  private lastConfiguredAuth: {
    authMethod: string;
    providerId: string;
  } | null = null;

  private readonly callbacks: SdkAdapterCallbackRegistry;

  /**
   * First-turn user activity awaiting a canonical session id, keyed by tabId
   * (the adapter's `trackingId`). Empty except during the window between a new
   * session's first prompt and its system `init` message.
   */
  private readonly pendingUserActivity = new Map<string, PendingUserActivity>();

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
    /**
     * Fan-out fired ALONGSIDE `this.callbacks.emitSessionIdResolved(...)`,
     * never instead of it. The single-slot setter is part of the shared
     * `IAgentAdapter` port and stays exactly as it was; this registry lets the
     * memory / skill trigger services reconcile state that a residual
     * tabId-bearing path armed before the UUID existed (TASK_2026_296).
     */
    @inject(SDK_TOKENS.SDK_SESSION_ID_RESOLVED_CALLBACK_REGISTRY)
    private readonly sessionIdResolvedRegistry: SessionIdResolvedCallbackRegistry,
  ) {
    this.callbacks = new SdkAdapterCallbackRegistry();
    this.workspaceProvider.onDidChangeWorkspaceFolders(() => {
      this.handleWorkspaceChanged();
    });
    this.events.onConfigChanged(async () => {
      this.logger.info(
        '[SdkAgentAdapter] Config change detected, re-initializing...',
      );
      this.flushAllPendingUserActivity();
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

  /**
   * On workspace switch, re-resolve authentication if the active provider /
   * auth method changed so the next session uses the correct credentials.
   */
  private handleWorkspaceChanged(): void {
    if (!this.initialized) {
      return;
    }

    // TASK_2026_315 (A1) — ZERO FOLDERS OPEN IS NOT A PROVIDER CHANGE.
    //
    // `resolveActiveAuth()` reads the workspace scope. With no folder open
    // there is no scope to read, so it falls through to the GLOBAL default
    // provider — a value nobody chose for this moment. That fallback differs
    // from the workspace-scoped provider that was active, which defeats the
    // equality early-return in `reconfigureAuthIfChanged`, runs a full
    // reconfigure, burns an OAuth token refresh, and binds a translation proxy
    // on 127.0.0.1 that no session can ever reach. What binds it is the
    // process-global `OAuthProxyStrategy` singleton, which is a DIFFERENT
    // registry from `ProviderProxyPool` — so the `disposeForScope(path)` that
    // `workspace:removeFolder` runs alongside this was never wired to reach it
    // under any key, and the socket outlives the workspace for the session.
    //
    // CHOSEN: freeze. Skip the reconfigure and leave `lastConfiguredAuth`
    // exactly where it is. That field records WHICH PROVIDER THE AUTH ENV IS
    // CURRENTLY CONFIGURED FOR, not which workspace is open — and freezing is
    // what keeps that invariant true, because closing a folder changes nothing
    // about the env. Consequences, deliberately:
    //   (a) Re-adding a folder fires this handler again with a real scope. Same
    //       provider → the equality early-return is CORRECT, the env already
    //       holds those credentials. Different provider → a reconfigure runs,
    //       identical to any other switch. Nothing is deferred or lost.
    //   (b) The `cliDetector` / `modelService` caches are deliberately NOT
    //       cleared here. They are keyed to the provider the env still holds,
    //       so on the way to zero folders they are still accurate; the re-add
    //       path clears them itself, below, whenever the provider actually
    //       changes.
    //   (c) Same rule in shape as the sibling subscriber in the Electron host's
    //       `wire-runtime.ts` (`const active = ...; if (active) { ... }`):
    //       workspace-derived work is skipped when there is no workspace. It
    //       asks for a ROOT because it needs a path to boot services for; this
    //       asks for a COUNT because it only needs "is there any scope at all".
    //
    // REJECTED: tear the previous auth down (`clearAuthentication()` plus
    // `lastConfiguredAuth = null`). It buys nothing and costs three things.
    // It makes `lastConfiguredAuth` lie in the other direction — null while the
    // env still holds live credentials — so re-adding the SAME folder would
    // force a pointless reconfigure and the very OAuth refresh this guard
    // exists to avoid, merely deferred. It leaves the adapter unauthenticated
    // while sessions started under the closed folder are still resumable, which
    // is exactly the unhealthy state the `onAuthFileChanged` recovery above
    // exists to climb out of. And it would be a HALF teardown: the leaked
    // socket belongs to the `OAuthProxyStrategy` singleton behind the
    // `IAuthEnvProvider` port, which exposes no proxy-teardown call and must
    // not grow one for this lib's benefit (hexagonal — `agent-sdk` gets ports
    // only). The fix is to never start one here, not to chase it afterwards.
    if (this.workspaceProvider.getWorkspaceFolders().length === 0) {
      this.logger.debug(
        '[SdkAgentAdapter] Workspace change with no folders open — keeping the current auth configuration',
      );
      return;
    }

    this.reconfigureAuthIfChanged().catch((err) => {
      this.logger.warn(
        '[SdkAgentAdapter] Auth reconfigure after workspace change failed',
        err instanceof Error ? err : new Error(String(err)),
      );
    });
  }

  private async reconfigureAuthIfChanged(): Promise<void> {
    const active = this.authManager.resolveActiveAuth();
    if (
      this.lastConfiguredAuth &&
      this.lastConfiguredAuth.authMethod === active.authMethod &&
      this.lastConfiguredAuth.providerId === active.providerId
    ) {
      return;
    }
    this.logger.info(
      `[SdkAgentAdapter] Active auth changed on workspace switch → ${active.authMethod}/${active.providerId}, reconfiguring`,
    );
    // CLI detection is provider-specific and cached under nothing, so it is
    // dropped wholesale.
    //
    // The model service is NOT. Its catalogs are keyed per auth identity
    // (`authMethod` + `providerId` + the AuthEnv keys that change the answer),
    // which is a strictly stronger guarantee than clearing: the new provider
    // cannot read the old one's list because it cannot reach that key. Calling
    // the blanket `clearCache()` here bought nothing and cost a full
    // multi-second SDK-bridge spawn on every switch BACK to a provider whose
    // catalog was still cached — alternating A/B/A paid three spawns for two
    // providers (judge round 1, TASK_2026_353). `invalidateForAuthChange()`
    // drops only the genuinely auth-scoped part, the unkeyed `/v1/models`
    // response.
    this.cliDetector.clearCache();
    this.modelService.invalidateForAuthChange();
    const result = await this.authManager.configureAuthentication(
      active.authMethod,
    );
    if (result.configured) {
      this.lastConfiguredAuth = {
        authMethod: active.authMethod,
        providerId: active.providerId,
      };
    }
  }

  async initialize(): Promise<boolean> {
    if (this.initInFlight) {
      this.logger.debug(
        '[SdkAgentAdapter] initialize already in progress, awaiting existing call',
      );
      return this.initInFlight;
    }

    const pass = (this.initInFlight = this.doInitialize());
    try {
      return await pass;
    } finally {
      // Clear only OUR pass. See the field's note: without this the "a pass
      // only clears itself" invariant is a property of microtask ordering
      // rather than of this method.
      if (this.initInFlight === pass) {
        this.initInFlight = null;
      }
    }
  }

  /**
   * The real initialization pass, guarded by the in-flight mutex above.
   *
   * The guard de-duplicates CONCURRENT callers only; it never memoizes a
   * result, so every sequential call runs a real pass. `reset()` additionally
   * drains any in-flight pass before disposing, so it can never be answered by
   * the guard.
   */
  private async doInitialize(): Promise<boolean> {
    try {
      this.logger.info('[SdkAgentAdapter] Initializing SDK adapter...');

      const active = this.authManager.resolveActiveAuth();
      this.lastConfiguredAuth = {
        authMethod: active.authMethod,
        providerId: active.providerId,
      };
      const authResult = await this.authManager.configureAuthentication(
        active.authMethod,
      );

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
    this.flushAllPendingUserActivity();
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

  /**
   * Models available under the host's ambient Claude login, regardless of which
   * provider is currently active. Used by `nativeAuth` providers whose agents
   * always spawn against that login.
   */
  async getNativeClaudeModels(): Promise<ModelInfo[]> {
    return this.modelService.getNativeClaudeModels();
  }

  async getDefaultModel(): Promise<string> {
    return this.modelService.getDefaultModel();
  }

  async getApiModels(): Promise<ModelInfo[]> {
    return this.modelService.getApiModelsNormalized();
  }

  /**
   * Tear the adapter down and bring it back up.
   *
   * SERIALISED, not de-duplicated (TASK_2026_308 F3-3). `doReset` waits out any
   * in-flight init so a reset can never be ANSWERED by the `initialize` guard,
   * but that is only half the contract when resets themselves overlap: two
   * concurrent resets used to await the SAME settled pass, both call
   * `dispose()`, and the second's `initialize()` was then answered by the guard
   * still holding the FIRST reset's fresh pass — the exact outcome the contract
   * forbids, reached from the other side. Joining the in-flight reset would not
   * fix it either: a caller that arrives after the running reset has already
   * disposed would be answered with a pass that predates its own call.
   *
   * So each call queues behind the previous one and runs its own dispose +
   * initialize pair. Every caller gets a pass that started after it asked, and
   * the double `dispose()` is gone because the two are now ordered rather than
   * concurrent.
   */
  async reset(): Promise<void> {
    const previous = this.resetChain;
    const pass = (this.resetChain = (async () => {
      // A failed reset must not wedge the chain shut for the ones behind it.
      if (previous) {
        await previous.catch(() => undefined);
      }
      await this.doReset();
    })());
    try {
      await pass;
    } finally {
      // Clear only when we are still the tail — a reset queued behind us owns
      // the slot now, and nulling it would let a third caller start a reset
      // concurrent with the one still running.
      if (this.resetChain === pass) {
        this.resetChain = null;
      }
    }
  }

  private async doReset(): Promise<void> {
    this.logger.info('[SdkAgentAdapter] Resetting adapter...');
    // A reset must produce a genuinely fresh pass, so it must never be
    // ANSWERED by the in-flight guard. Let a running pass settle first (its
    // result is discarded), then dispose and initialize from a clean slate.
    const running = this.initInFlight;
    if (running) {
      await running.catch(() => false);
    }
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
      mcpServerRunning?: boolean;
      enhancedPromptsContent?: string;
      permissionLevel?: PermissionLevel;
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
      mcpServerRunning = true,
      enhancedPromptsContent,
      permissionLevel,
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
      { mcpServerRunning, providerId: providerProfile?.providerId },
    );

    const { sdkQuery, initialModel, activityWatchdog } =
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
        mcpServerRunning,
        enhancedPromptsContent,
        permissionLevel,
        pathToClaudeCodeExecutable: effectiveCliJsPath || undefined,
        includePartialMessages,
        mcpServersOverride,
        authEnvOverride: effectiveAuthEnv,
      });

    const resolvedProjectPath = config?.projectPath || os.homedir();
    const sessionIdCallback = this.createSessionIdCallback(
      resolvedProjectPath,
      config?.name || `Session ${new Date().toLocaleDateString()}`,
      config?.tabId,
    );

    if (config.prompt) {
      this.recordPendingUserActivity(trackingId, resolvedProjectPath);
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
      onTurnEnd: this.releaseTurnOnResult(trackingId),
      tabId: config?.tabId,
      activityWatchdog,
    });
  }

  endSession(sessionId: SessionId): void {
    this.flushPendingUserActivityFor(sessionId);
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
      mcpServerRunning?: boolean;
      enhancedPromptsContent?: string;
      tabId?: string;
      permissionLevel?: PermissionLevel;
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
        onTurnEnd: this.releaseTurnOnResult(sessionId),
        tabId: config?.tabId,
      });
    }

    const mcpServerRunning = config?.mcpServerRunning ?? true;
    const enhancedPromptsContent = config?.enhancedPromptsContent;
    const permissionLevel = config?.permissionLevel;
    const includePartialMessages = config?.includePartialMessages;
    const providerProfile = config?.providerProfile;
    const effectiveCliJsPath =
      providerProfile?.cliJsPath ?? this.runtimeState.getCliJsPath();
    const effectiveAuthEnv = providerProfile?.authEnv;
    const sessionConfigWithProfileModel = providerProfile
      ? { ...config, model: providerProfile.model }
      : config;

    this.logger.info(`[SdkAgentAdapter] Resuming session: ${sessionId}`, {
      mcpServerRunning,
      providerId: providerProfile?.providerId,
    });

    const { sdkQuery, initialModel, activityWatchdog } =
      await this.sessionLifecycle.executeQuery({
        sessionId,
        sessionConfig: sessionConfigWithProfileModel,
        resumeSessionId: sessionId as string,
        onCompactionStart: this.callbacks.getCompactionStart(),
        onWorktreeCreated: this.callbacks.getWorktreeCreated(),
        onWorktreeRemoved: this.callbacks.getWorktreeRemoved(),
        mcpServerRunning,
        enhancedPromptsContent,
        permissionLevel,
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
      // ALONGSIDE the single-slot setter above, never instead of it. Fired on
      // the resume path too: a resume registers under `registerKey = tabId`,
      // so a residual tabId-keyed consumer here needs the same reconciliation
      // signal the new-session path gets (TASK_2026_296).
      this.sessionIdResolvedRegistry.notifyAll({
        tabId,
        realSessionId,
        timestamp: Date.now(),
      });
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
      onTurnEnd: this.releaseTurnOnResult(sessionId),
      tabId: config?.tabId,
      activityWatchdog,
    });
  }

  isSessionActive(sessionId: SessionId): boolean {
    return this.sessionLifecycle.find(sessionId as string) !== undefined;
  }

  /**
   * Opaque identity of the record currently registered under this id, or null.
   * A re-registration under the same id (slash-command re-query) mints a new
   * token, which is what lets a holder of the old one detect the swap.
   */
  getSessionToken(sessionId: SessionId): string | null {
    return this.sessionLifecycle.getSessionToken(sessionId);
  }

  /**
   * End the session only if `token` still identifies the registered record.
   * Atomic inside the lifecycle layer — see
   * `SessionControl.endSessionIfTokenMatches`.
   */
  async endSessionIfTokenMatches(
    sessionId: SessionId,
    token: string,
  ): Promise<boolean> {
    // Same pre-teardown flush `endSession` does, gated on the same token so a
    // losing caller does not publish activity for a session that stays alive.
    // This read is NOT the compare that matters — the decision to tear down is
    // re-made atomically inside SessionControl, so a token that flips in
    // between costs at most one early activity flush and never a teardown.
    if (this.sessionLifecycle.getSessionToken(sessionId) === token) {
      this.flushPendingUserActivityFor(sessionId);
    }
    return this.sessionLifecycle.endSessionIfTokenMatches(sessionId, token);
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
      // StreamTransformer forwards `sdkMessage.session_id` from the system
      // 'init' message verbatim. A blank one must stop here: it is not a
      // session id, and letting it through would poison the metadata store,
      // be rejected by bindRealSessionId anyway, and tell the webview that a
      // session resolved to '' (TASK_2026_295). This callback is invoked
      // un-awaited, so a rejection here would surface as an unhandled one.
      if (blankToUndefined(realSessionId) === undefined) {
        this.logger.warn(
          `[SdkAgentAdapter] SDK init reported an empty session id — skipping metadata create, bind and resolve notification (tabId: ${tabId})`,
        );
        return;
      }

      this.logger.info(
        `[SdkAgentAdapter] Saving session metadata for ${realSessionId} (tabId: ${tabId})`,
      );

      await this.metadataStore.create(realSessionId, workspaceId, sessionName);

      if (tabId) {
        this.sessionLifecycle.bindRealSessionId(tabId, realSessionId);
        // The bind above is what makes `resolveActivityIds` answer with the
        // SDK UUID, so the first turn's buffered activity is published here —
        // after the bind, under the canonical id.
        this.flushPendingUserActivity(tabId);
      }

      this.callbacks.emitSessionIdResolved(tabId, realSessionId);
      // ALONGSIDE the single-slot setter above, never instead of it. Placed
      // after the flush so the buffered first turn is already published under
      // the canonical id; what this signal reconciles is the RESIDUAL — state
      // armed by a hook payload that genuinely lacked `session_id` and fell
      // back to the tabId-bearing closure (TASK_2026_296).
      this.sessionIdResolvedRegistry.notifyAll({
        tabId,
        realSessionId,
        timestamp: Date.now(),
      });
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

    const { sdkQuery, initialModel, activityWatchdog } =
      await this.sessionLifecycle.executeSlashCommandQuery(sessionId, command, {
        sessionConfig: config.sessionConfig,
        mcpServerRunning: config.mcpServerRunning,
        enhancedPromptsContent: config.enhancedPromptsContent,
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
      onTurnEnd: this.releaseTurnOnResult(sessionId),
      tabId: config.tabId,
      activityWatchdog,
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
    this.flushPendingUserActivityFor(sessionId);
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

  /**
   * Active session IDs, most-recently-active first. Used by the autopilot
   * toggle to target the session the user is interacting with when the
   * frontend does not supply an explicit sessionId.
   */
  getActiveSessionIds(): SessionId[] {
    return this.sessionLifecycle.getActiveSessionIds();
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
    timestamp: number = Date.now(),
  ): void {
    try {
      const ids = this.resolveActivityIds(sessionId);
      this.activityRegistry.notifyAll({
        sessionId: ids.sessionId,
        workspaceRoot: workspaceRootOverride ?? ids.workspaceRoot,
        role,
        timestamp,
      });
    } catch (err: unknown) {
      this.logger.warn(
        '[SdkAgentAdapter] activity notify failed',
        err instanceof Error ? err : new Error(String(err)),
      );
    }
  }

  /**
   * Hold a NEW session's first user activity instead of publishing it.
   *
   * `startChatSession` reports that activity before the SDK's system `init`
   * message has arrived, so no real session id is bound yet and
   * `resolveActivityIds` can only answer with the tabId. Publishing it there
   * armed consumer state — memory/skill trigger timers and their SQLite work
   * queues — under the tabId, while teardown always resolves
   * `realSessionId ?? tabId` (`SessionControlService.endSession`) and so cleared
   * under the SDK UUID. State was armed under one key and torn down under
   * another, on the first turn only, which is why it presented as intermittent
   * (TASK_2026_296).
   *
   * Note the two ids are shape-indistinguishable — a tabId is a UUID v4
   * (`TabId.create()`), so `SessionId.validate(tabId)` is true and no consumer
   * can detect the wrong id by inspection. Prevention at the emitter is the
   * only fix available.
   *
   * Buffering changes ONLY the id: the role, the workspace root and the
   * original timestamp are preserved, and the activity is published exactly
   * once — by `flushPendingUserActivity` when the id resolves, or by the
   * teardown flush under the tabId if it never does, which keeps both ends of
   * the lifecycle on the same key.
   */
  private recordPendingUserActivity(
    trackingId: SessionId,
    workspaceRoot: string,
  ): void {
    // A second start on the same tab without an intervening teardown would
    // otherwise drop the earlier turn's activity; publish it before the slot
    // is replaced. Nothing is buffered in the common case, so this is a no-op.
    this.flushPendingUserActivity(trackingId as string);
    this.pendingUserActivity.set(trackingId as string, {
      workspaceRoot,
      timestamp: Date.now(),
    });
  }

  /**
   * Publish the activity buffered for `tabId`, if any, under whichever id is
   * canonical now. The entry is removed BEFORE the notification so a
   * re-entrant subscriber cannot trigger a second emission — this is the
   * exactly-once guarantee the buffer exists to provide.
   */
  private flushPendingUserActivity(tabId: string): void {
    const pending = this.pendingUserActivity.get(tabId);
    if (!pending) {
      return;
    }
    this.pendingUserActivity.delete(tabId);
    this.notifyActivity(
      tabId as SessionId,
      'user',
      pending.workspaceRoot,
      pending.timestamp,
    );
  }

  /**
   * Teardown-side flush for a single session. Callers hold whichever id they
   * were given — tabId or SDK UUID — so resolve the record back to its tabId,
   * which is the key the buffer uses.
   */
  private flushPendingUserActivityFor(sessionId: SessionId): void {
    if (this.pendingUserActivity.size === 0) {
      return;
    }
    const rec = this.sessionLifecycle.find(sessionId as string);
    this.flushPendingUserActivity(rec?.tabId ?? (sessionId as string));
  }

  /**
   * Teardown-side flush for the bulk paths, which end every live session at
   * once. Runs BEFORE `disposeAllSessions` so each record is still present to
   * canonicalise against.
   */
  private flushAllPendingUserActivity(): void {
    for (const tabId of Array.from(this.pendingUserActivity.keys())) {
      this.flushPendingUserActivity(tabId);
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

  /**
   * Release the streaming pump's turn claim on the SDK `result` message, so a
   * follow-up that arrived mid-turn — and was therefore HELD rather than handed
   * to the SDK, where it would have been dropped — is sent now (TASK_2026_294).
   */
  private releaseTurnOnResult(sessionId: SessionId): () => void {
    return () => {
      this.sessionLifecycle.markTurnEnded(sessionId);
    };
  }
}
