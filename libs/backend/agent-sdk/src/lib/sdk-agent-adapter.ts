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
 * Architecture: Thin orchestration layer that delegates to focused helper services.
 */

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
  SessionId,
  FlatStreamEventUnion,
  type McpHttpServerOverride,
} from '@ptah-extension/shared';
import { Logger, ConfigManager, TOKENS } from '@ptah-extension/vscode-core';
import type { SentryService } from '@ptah-extension/vscode-core';
import { SDK_TOKENS } from './di/tokens';
import { SdkError, SessionNotActiveError } from './errors';
import { SessionMetadataStore } from './session-metadata-store';
import type { SessionHistoryReaderService } from './session-history-reader.service';
import {
  ModelInfo,
  type ForkSessionResult,
  type RewindFilesResult,
} from './types/sdk-types/claude-sdk.types';
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
 * Minimal shape of the SDK's `WarmQuery` returned by `startup()`. We type
 * `query` as `unknown` because callers must invoke it via the type-narrow
 * helper {@link tryUseWarmQuery} which discriminates at the call site —
 * keeping a tight, dynamic-import-friendly surface here.
 */
export interface WarmQueryHandle {
  close: () => void;
  query?: unknown;
}

/**
 * Description of the options baked into a warm handle at `startup()` time.
 *
 * `WarmQuery.query(prompt)` accepts ONLY a prompt — model, cwd,
 * permissionMode, hooks, canUseTool, agents, systemPrompt, plugins,
 * file-checkpointing, partial-messages, resume, fork, and per-call MCP
 * overrides are ALL inherited from `startup()`'s options. So this fingerprint
 * is the complete description of what the held warm handle can serve.
 *
 * `consumeWarmQuery(requirements)` matches the requirements against this
 * fingerprint; any mismatch (extra hook, non-default permission mode, custom
 * cwd, MCP override, etc.) discards the handle.
 */
export interface WarmPrewarmFingerprint {
  /** cli.js path baked into startup() — must match the consuming session. */
  pathToClaudeCodeExecutable: string | null;
  /** MCP servers map baked at startup — `null` when none were passed. */
  mcpServers: Record<string, unknown> | null;
}

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
   * Resolved path to cli.js - either from detected CLI or bundled fallback.
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
   * Callback to notify when compaction starts.
   * Set by RpcMethodRegistrationService to send session:compacting events
   */
  private compactionStartCallback: CompactionStartCallback | null = null;

  /**
   * Callback to notify when SDK creates a worktree.
   * Set by RpcMethodRegistrationService to send git:worktreeChanged events
   */
  private worktreeCreatedCallback: WorktreeCreatedCallback | null = null;

  /**
   * Callback to notify when SDK removes a worktree.
   * Set by RpcMethodRegistrationService to send git:worktreeChanged events
   */
  private worktreeRemovedCallback: WorktreeRemovedCallback | null = null;

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
    @inject(SDK_TOKENS.SDK_MODULE_LOADER)
    private readonly moduleLoader: SdkModuleLoader,
    @inject(SDK_TOKENS.SDK_MODEL_SERVICE)
    private readonly modelService: SdkModelService,
    @inject(PLATFORM_TOKENS.PLATFORM_INFO)
    private readonly platformInfo: IPlatformInfo,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspaceProvider: IWorkspaceProvider,
    @inject(TOKENS.SENTRY_SERVICE)
    private readonly sentryService: SentryService,
    @inject(SDK_TOKENS.SDK_SESSION_HISTORY_READER)
    private readonly historyReader: SessionHistoryReaderService,
  ) {}

  /**
   * Pre-load the SDK during extension activation (non-blocking).
   * Delegates to SdkModuleLoader for the actual loading.
   */
  public async preloadSdk(): Promise<void> {
    return this.moduleLoader.preload();
  }

  /** Idempotency guard for prewarm() — see method docs. */
  private _prewarmed = false;

  /**
   * Held WarmQuery handle from `startup()`. When non-null, the next call to
   * {@link consumeWarmQuery} MAY return this handle (and null the slot) so
   * a single subsequent `query(prompt)` can amortize the spawn+handshake
   * cost. After consumption, the slot is empty until a new prewarm runs.
   */
  private _warmQuery: WarmQueryHandle | null = null;

  /**
   * Snapshot of the option fingerprint baked into `_warmQuery` at the time
   * `prewarm()` ran. Compared by {@link consumeWarmQuery} against the
   * caller-supplied requirement set so we never hand out a warm handle
   * whose underlying subprocess was started with options that diverge from
   * what the upcoming session needs.
   *
   * The SDK's `WarmQuery.query(prompt)` accepts ONLY a prompt — every other
   * Option (model, cwd, permissionMode, hooks, canUseTool, mcpServers,
   * agents, systemPrompt, plugins, file checkpointing, partial messages,
   * resume/fork) was frozen when `startup()` was called. So this snapshot
   * is the authoritative description of "what this warm handle can do".
   */
  private _warmQueryFingerprint: WarmPrewarmFingerprint | null = null;

  /**
   * Wall-clock timestamp (ms) of the most recent successful prewarm. Used by
   * {@link consumeWarmQuery} to evict warm handles older than 5 minutes —
   * the underlying CLI subprocess gets stale, and consuming a stale warm
   * handle risks dead-pipe errors at first send.
   */
  private _warmQueryCreatedAt = 0;

  /** Maximum age (ms) a held WarmQuery may remain unconsumed before discard. */
  private static readonly WARM_QUERY_TTL_MS = 5 * 60 * 1000;

  /**
   * Consume the held WarmQuery, if any, returning it to the caller and
   * clearing the slot.
   *
   * Returns null when ANY of the following is true:
   *  - no warm handle is held, or
   *  - the held handle is older than {@link WARM_QUERY_TTL_MS} (the handle
   *    is discarded — closed and nulled — before returning), or
   *  - `requirements` is provided AND fails to match the fingerprint baked
   *    into the warm handle at `prewarm()` time. On mismatch the handle is
   *    discarded so a fresh `prewarm()` can pick up the new fingerprint.
   *
   * **Why a requirements check is mandatory for the wiring path**: the SDK's
   * `WarmQuery.query(prompt)` accepts ONLY a prompt — every other Option
   * (model, cwd, permissionMode, hooks, canUseTool, mcpServers, agents,
   * systemPrompt, plugins, fork/resume, file-checkpointing, partial-messages)
   * was frozen at `startup()`. Handing out a warm handle to a session whose
   * options diverge from the fingerprint would produce a session running
   * with the WRONG cwd / WRONG permissions / NO hooks. Caller-supplied
   * requirements let `executeQuery` reject the handle defensively.
   *
   * Backwards compat: when `requirements` is `undefined` the fingerprint
   * check is skipped (legacy single-arg behavior preserved for existing
   * tests and ad-hoc callers).
   */
  public consumeWarmQuery(
    requirements?: WarmPrewarmFingerprint,
  ): WarmQueryHandle | null {
    if (!this._warmQuery) {
      return null;
    }
    const age = Date.now() - this._warmQueryCreatedAt;
    if (age > SdkAgentAdapter.WARM_QUERY_TTL_MS) {
      this.logger.info(
        `[SdkAgentAdapter] Discarding stale warm query (age=${age}ms > ttl=${SdkAgentAdapter.WARM_QUERY_TTL_MS}ms)`,
      );
      this.discardWarmHandle();
      // Allow re-prewarm next time.
      this._prewarmed = false;
      return null;
    }

    // Fingerprint guard. Skip when the caller doesn't supply requirements
    // (preserves the legacy single-arg test/usage).
    if (requirements && this._warmQueryFingerprint) {
      const reason = SdkAgentAdapter.fingerprintMismatchReason(
        this._warmQueryFingerprint,
        requirements,
      );
      if (reason) {
        this.logger.info(
          `[SdkAgentAdapter] Discarding warm query — fingerprint mismatch: ${reason}`,
        );
        this.discardWarmHandle();
        // Allow re-prewarm with the new desired fingerprint.
        this._prewarmed = false;
        return null;
      }
    }

    const handle = this._warmQuery;
    this._warmQuery = null;
    this._warmQueryFingerprint = null;
    this._warmQueryCreatedAt = 0;
    return handle;
  }

  /**
   * Close the currently-held warm handle (if any) and null both the handle
   * slot and its fingerprint. Swallows errors from `close()` because the
   * SDK has thrown from this path before (e.g. when the underlying socket
   * is already half-shut by the OS) and we never want a discard to fail
   * loudly — the caller is already on a fallback path.
   */
  private discardWarmHandle(): void {
    if (!this._warmQuery) {
      return;
    }
    try {
      this._warmQuery.close();
    } catch (closeErr) {
      this.logger.warn(
        '[SdkAgentAdapter] Stale WarmQuery.close() threw',
        closeErr instanceof Error ? closeErr : new Error(String(closeErr)),
      );
    }
    this._warmQuery = null;
    this._warmQueryFingerprint = null;
    this._warmQueryCreatedAt = 0;
  }

  /**
   * Compare a warm-handle's baked fingerprint against the requirements of
   * an upcoming session. Returns null when the handle satisfies the
   * requirements (safe to consume), or a short human-readable string
   * describing the first mismatch (for log lines).
   *
   * Equality rules:
   *  - `pathToClaudeCodeExecutable` must match exactly. A null on either
   *    side that doesn't match the other is a mismatch — the SDK resolves
   *    a different cli.js when this is omitted, so a mismatch here means
   *    the warm subprocess literally is a different binary than the new
   *    session would have spawned.
   *  - `mcpServers` must deep-match by JSON serialization. The SDK
   *    completes the MCP initialize handshake during `startup()`, so a
   *    different server map means the handshake state on the warm
   *    subprocess doesn't match what the session needs.
   *
   * Anything mutable mid-session (model, permissionMode) is NOT compared
   * here — those are settable on the live `Query` after consumption (via
   * `setModel`, `setPermissionMode`).
   */
  private static fingerprintMismatchReason(
    baked: WarmPrewarmFingerprint,
    required: WarmPrewarmFingerprint,
  ): string | null {
    if (
      baked.pathToClaudeCodeExecutable !== required.pathToClaudeCodeExecutable
    ) {
      return (
        `pathToClaudeCodeExecutable differs ` +
        `(warm=${baked.pathToClaudeCodeExecutable ?? 'null'}, ` +
        `required=${required.pathToClaudeCodeExecutable ?? 'null'})`
      );
    }
    const bakedMcp = baked.mcpServers ? JSON.stringify(baked.mcpServers) : '';
    const requiredMcp = required.mcpServers
      ? JSON.stringify(required.mcpServers)
      : '';
    if (bakedMcp !== requiredMcp) {
      return 'mcpServers map differs';
    }
    return null;
  }

  /**
   * Pre-warm the Claude Agent SDK subprocess via the SDK's `startup()` export.
   *
   * `startup()` (Claude Agent SDK ≥ 0.2.111) spawns the CLI subprocess and
   * completes the initialize handshake ahead of time, so the first `query()`
   * resolves immediately instead of paying the spawn+handshake latency.
   *
   * Idempotent: subsequent calls are no-ops (tracked via `_prewarmed`).
   *
   * The returned `WarmQuery` is retained on the adapter (see {@link _warmQuery})
   * so the first real chat send can consume it via {@link consumeWarmQuery} and
   * skip the spawn+handshake entirely. The handle has a 5-minute TTL — older
   * handles are discarded so subsequent sessions don't pick up a stale
   * subprocess. MCP server config and the authoritative tier env vars are
   * passed into `startup()` so the MCP handshake also amortizes during prewarm.
   *
   * Failures are swallowed with `logger.warn` — a failed pre-warm must NOT
   * block normal flow. The first real `query()` call will retry naturally.
   */
  public async prewarm(
    activeMcpServers?: Record<string, unknown>,
  ): Promise<void> {
    if (this._prewarmed) {
      return;
    }

    const startTime = performance.now();
    try {
      const sdkModule = (await import('@anthropic-ai/claude-agent-sdk')) as {
        startup?: (params?: {
          options?: unknown;
          initializeTimeoutMs?: number;
        }) => Promise<{ close: () => void; query?: unknown }>;
      };
      const startupFn = sdkModule.startup;
      if (typeof startupFn !== 'function') {
        this.logger.warn(
          '[SdkAgentAdapter] SDK startup() export not found - skipping prewarm',
          new Error(`startup is ${typeof startupFn}`),
        );
        return;
      }

      // Pass pathToClaudeCodeExecutable so startup() resolves the same cli.js
      // the real query() will use. Without this, startup() falls back to the
      // SDK's import.meta.url-based resolution.
      // Also pass mcpServers so the MCP initialize handshake amortizes here
      // instead of slowing the first chat send.
      const startupOptions: Record<string, unknown> = {};
      if (this.cliJsPath) {
        startupOptions['pathToClaudeCodeExecutable'] = this.cliJsPath;
      }
      if (activeMcpServers && Object.keys(activeMcpServers).length > 0) {
        startupOptions['mcpServers'] = activeMcpServers;
      }
      const warm = await startupFn({
        options:
          Object.keys(startupOptions).length > 0 ? startupOptions : undefined,
      });

      // Retain the warm handle for the first real chat send to consume.
      // Discard any prior unconsumed handle defensively (should not happen
      // because we early-return on `_prewarmed`, but TTL eviction may flip
      // `_prewarmed` back to false).
      if (this._warmQuery) {
        try {
          this._warmQuery.close();
        } catch {
          // Ignore — we're replacing it anyway.
        }
      }
      this._warmQuery = warm;
      this._warmQueryCreatedAt = Date.now();
      // Record the fingerprint of options baked into THIS warm handle so
      // `consumeWarmQuery(requirements)` can later validate that the
      // session about to use it was started with matching options. Any
      // mismatch (e.g. a session that uses an MCP override the warm handle
      // doesn't have, or runs against a different cli.js) discards the
      // handle and falls through to a normal `query()`.
      this._warmQueryFingerprint = {
        pathToClaudeCodeExecutable: this.cliJsPath,
        mcpServers:
          activeMcpServers && Object.keys(activeMcpServers).length > 0
            ? activeMcpServers
            : null,
      };

      const elapsed = (performance.now() - startTime).toFixed(2);
      this.logger.info(
        `[SdkAgentAdapter] SDK subprocess pre-warmed and retained (${elapsed}ms)`,
      );
      // Set the idempotency flag ONLY after successful startup. Setting it
      // before the await would silently swallow retry opportunities — a
      // failed prewarm would mark itself "done" and the next call would
      // become a no-op even though the subprocess never warmed up.
      this._prewarmed = true;
    } catch (err) {
      const elapsed = (performance.now() - startTime).toFixed(2);
      // Redact API key fragments before logging. SDK errors sometimes embed
      // bearer tokens / sk-ant-* keys in stack traces or messages from
      // upstream HTTP clients. Log only the error name + redacted message —
      // never the full Error object (which carries `.stack`).
      const rawMessage = err instanceof Error ? err.message : String(err);
      const errorName = err instanceof Error ? err.name : 'UnknownError';
      const redactedMessage = rawMessage.replace(
        /sk-ant-[A-Za-z0-9_-]+/g,
        'sk-ant-***REDACTED***',
      );
      this.logger.warn(
        `[SdkAgentAdapter] SDK prewarm failed after ${elapsed}ms (will resolve on first query): ${errorName}: ${redactedMessage}`,
      );
      // Do NOT set _prewarmed in the catch — leave it false so a subsequent
      // call retries the warmup naturally. Do NOT capture in Sentry — prewarm
      // is best-effort and benign on failure.
    }
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
        await this.sessionLifecycle.disposeAllSessions();
        this.cliDetector.clearCache();
        // Clear model cache so re-init fetches fresh models with new auth
        this.modelService.clearCache();
        this.cliInstallation = null;
        await this.initialize();
      });

      // Step 1: Configure authentication FIRST (not dependent on CLI)
      // Auth runs before CLI detection so third-party providers
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
      // CLI detection does not gate initialization.
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
    // disposeAllSessions is async; fire and log errors
    this.sessionLifecycle.disposeAllSessions().catch((err) => {
      this.logger.warn(
        '[SdkAgentAdapter] Error during session disposal',
        err instanceof Error ? err : new Error(String(err)),
      );
    });
    this.authManager.clearAuthentication();
    // Clear model cache so next getSupportedModels() re-fetches with fresh auth/tier env vars.
    // This covers all reset paths: auth switches, provider changes, and tier mapping changes.
    this.modelService.clearCache();
    this.initialized = false;
    this.cliJsPath = null;
    this.logger.info('[SdkAgentAdapter] Disposed successfully');
  }

  /**
   * Clear the SDK model cache so the next getSupportedModels() call re-fetches.
   * Call this whenever tier mappings or auth env vars change without a full reset.
   */
  clearModelCache(): void {
    this.modelService.clearCache();
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
   * The SDK's default import.meta.url-based resolution bakes in the
   * CI/build-time path which doesn't exist in production. This getter exposes
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
   * Start a NEW chat session with streaming support.
   * Uses tabId as the primary tracking key for session lifecycle.
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
       * Premium user flag - enables MCP server and Ptah system prompt.
       * When true, enables Ptah MCP server and appends PTAH_SYSTEM_PROMPT.
       * Defaults to false (free tier behavior).
       */
      isPremium?: boolean;
      /**
       * Whether the MCP server is currently running.
       * When false, MCP config will not be included even for premium users.
       * This prevents configuring Claude with a dead MCP endpoint.
       * Defaults to true for backward compatibility.
       */
      mcpServerRunning?: boolean;
      /**
       * Enhanced prompt content for system prompt.
       * AI-generated guidance resolved from EnhancedPromptsService.
       * When provided, appended to system prompt instead of PTAH_CORE_SYSTEM_PROMPT.
       */
      enhancedPromptsContent?: string;
      /**
       * Plugin directory paths for this session.
       * Resolved by PluginLoaderService for premium users.
       */
      pluginPaths?: string[];
      /**
       * Opt-in to SDK `SDKPartialAssistantMessage` (`stream_event`) emissions
       * for finer streaming deltas. When omitted, the SDK plumbing layer
       * defaults to ON (preserves historical Ptah behavior). Pass `false`
       * explicitly to disable partial events on this session.
       */
      includePartialMessages?: boolean;
      /**
       * Caller-supplied MCP HTTP server overrides.
       * Keyed by MCP server name; entries are merged OVER the registry-built
       * map by `SdkQueryOptionsBuilder.mergeMcpOverride` (caller wins on key
       * collision). Reserved for the Anthropic-compatible HTTP proxy —
       * non-proxy callers leave this `undefined` and the merge is a no-op.
       */
      mcpServersOverride?: Record<string, McpHttpServerOverride>;
    },
  ): Promise<AsyncIterable<FlatStreamEventUnion>> {
    if (!this.initialized) {
      throw new SdkError(
        'SdkAgentAdapter not initialized. Call initialize() first.',
      );
    }

    const {
      tabId,
      isPremium = false,
      mcpServerRunning = true,
      enhancedPromptsContent,
      pluginPaths,
      includePartialMessages,
      mcpServersOverride,
    } = config;
    const trackingId = tabId as SessionId;

    this.logger.info(
      `[SdkAgentAdapter] Starting NEW chat session for tab: ${tabId}`,
      { isPremium, mcpServerRunning },
    );

    // Try to consume the warm subprocess held by
    // `prewarm()`. We only ask for the handle when this session has
    // requirements that match what was baked in at startup() time:
    //   - same cli.js path (always true for this adapter — `cliJsPath` is
    //     set once in initialize() and used by both prewarm and queries),
    //   - no caller-supplied MCP override (the warm handle's MCP map was
    //     fixed at prewarm). When `mcpServersOverride` is supplied, the
    //     fingerprint guard discards the handle so we don't end up with a
    //     subprocess whose MCP set differs from what the session needs.
    // The executor (SessionQueryExecutor) further restricts to non-resume,
    // non-fork, non-slash-command sessions before actually using the
    // handle, and falls back to a normal `query()` (closing the handle)
    // for any session shape it can't safely serve.
    const warmHandle = mcpServersOverride
      ? null // Caller-side MCP override means baked MCP fingerprint can't match.
      : this.consumeWarmQuery({
          pathToClaudeCodeExecutable: this.cliJsPath,
          mcpServers: null,
        });

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
        includePartialMessages,
        // Forward caller-supplied MCP HTTP overrides
        mcpServersOverride,
        // Hand the warm subprocess (if usable) to the executor for the very
        // first SDK call of this session.
        warmQuery: warmHandle ?? undefined,
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
    // endSession() is async but this interface method is void.
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
       * Premium user flag - enables MCP server and Ptah system prompt.
       * When true, enables Ptah MCP server and appends PTAH_SYSTEM_PROMPT.
       * Defaults to false (free tier behavior).
       */
      isPremium?: boolean;
      /**
       * Whether the MCP server is currently running.
       * When false, MCP config will not be included even for premium users.
       * This prevents configuring Claude with a dead MCP endpoint.
       * Defaults to true for backward compatibility.
       */
      mcpServerRunning?: boolean;
      /**
       * Enhanced prompt content for system prompt.
       * AI-generated guidance resolved from EnhancedPromptsService.
       * When provided, appended to system prompt instead of PTAH_CORE_SYSTEM_PROMPT.
       */
      enhancedPromptsContent?: string;
      /**
       * Plugin directory paths for this session.
       * Resolved by PluginLoaderService for premium users.
       */
      pluginPaths?: string[];
      /**
       * Frontend tab ID for event routing
       * Passed through to StreamTransformer so SESSION_ID_RESOLVED and
       * SESSION_STATS can be routed to the correct frontend tab.
       */
      tabId?: string;
      /**
       * Opt-in to SDK partial-message stream events. See
       * `startChatSession.config.includePartialMessages` for semantics.
       */
      includePartialMessages?: boolean;
    },
  ): Promise<AsyncIterable<FlatStreamEventUnion>> {
    if (!this.initialized) {
      throw new SdkError(
        'SdkAgentAdapter not initialized. Call initialize() first.',
      );
    }

    // Check if session already active AND fully initialized (has query)
    const existingSession = this.sessionLifecycle.find(sessionId as string);
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

    // Extract isPremium, mcpServerRunning, enhancedPromptsContent, and pluginPaths from config
    const isPremium = config?.isPremium ?? false;
    const mcpServerRunning = config?.mcpServerRunning ?? true;
    const enhancedPromptsContent = config?.enhancedPromptsContent;
    const pluginPaths = config?.pluginPaths;
    const includePartialMessages = config?.includePartialMessages;

    this.logger.info(`[SdkAgentAdapter] Resuming session: ${sessionId}`, {
      isPremium,
      mcpServerRunning,
    });

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
        includePartialMessages,
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
        this.sessionLifecycle.bindRealSessionId(tabId, realSessionId);
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

  /**
   * Check if a session is currently active in memory
   */
  isSessionActive(sessionId: SessionId): boolean {
    return this.sessionLifecycle.find(sessionId as string) !== undefined;
  }

  /**
   * Create a session ID callback that saves metadata and notifies webview.
   * Uses tabId for direct routing.
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
        this.sessionLifecycle.bindRealSessionId(tabId, realSessionId);
      }

      // Notify webview of the resolved session ID; pass tabId so frontend can find tab directly
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
   * Set callback for when compaction starts.
   * Called by RpcMethodRegistrationService to send session:compacting events to webview
   */
  setCompactionStartCallback(callback: CompactionStartCallback): void {
    this.compactionStartCallback = callback;
  }

  /**
   * Set callback for when SDK creates a worktree.
   * Called by RpcMethodRegistrationService to send git:worktreeChanged events to webview
   */
  setWorktreeCreatedCallback(callback: WorktreeCreatedCallback): void {
    this.worktreeCreatedCallback = callback;
  }

  /**
   * Set callback for when SDK removes a worktree.
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
   */
  async executeSlashCommand(
    sessionId: SessionId,
    command: string,
    config: SlashCommandConfig & { tabId?: string },
  ): Promise<AsyncIterable<FlatStreamEventUnion>> {
    if (!this.initialized) {
      throw new SdkError(
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
   * Fork an existing session into a new branch.
   *
   * Calls the SDK's standalone `forkSession()` export, which copies the
   * source session's transcript into a brand-new session file (with remapped
   * UUIDs) and returns the new session ID. Optionally slices the transcript
   * up to a specific message UUID via `upToMessageId` so the user can branch
   * mid-conversation.
   *
   * The returned session ID can be passed to `resumeSession()` to continue
   * the forked branch. The original session is left untouched. Forked sessions
   * do NOT carry file-history snapshots — the SDK only copies transcript data.
   *
   * @param sessionId - UUID of the source session to fork from
   * @param upToMessageId - Optional message UUID to slice the transcript at (inclusive)
   * @param title - Optional title for the new fork (defaults to "<original> (fork)")
   * @returns The new forked session ID
   * @throws SdkError if the SDK module fails to load or fork fails
   */
  async forkSession(
    sessionId: SessionId,
    upToMessageId?: string,
    title?: string,
  ): Promise<ForkSessionResult> {
    if (!this.initialized) {
      throw new SdkError(
        'SdkAgentAdapter not initialized. Call initialize() first.',
      );
    }

    this.logger.info(`[SdkAgentAdapter] Forking session: ${sessionId}`, {
      upToMessageId,
      title,
    });

    try {
      // The SDK's forkSession is a standalone export, not on the Query handle.
      // Use the same dynamic-import path as SdkModuleLoader so the bundled
      // SDK is reused (no re-download / re-resolution cost).
      const sdkModule = (await import('@anthropic-ai/claude-agent-sdk')) as {
        forkSession?: (
          sessionId: string,
          options?: { upToMessageId?: string; title?: string },
        ) => Promise<ForkSessionResult>;
      };
      const fork = sdkModule.forkSession;
      if (typeof fork !== 'function') {
        throw new SdkError(
          `SDK module loaded but 'forkSession' export is ${typeof fork}, expected function`,
        );
      }

      // Fetch source metadata once — used both for workspace path resolution
      // (needed during message ID resolution) and for naming the fork.
      const sourceMetadata = await this.metadataStore.get(sessionId);

      // Resolve the message ID: the frontend may send a Ptah-generated ID
      // (msg_<timestamp>_<random>) obtained from a history-loaded session
      // replay. The SDK only accepts native Anthropic UUIDs (msg_01...).
      // We resolve the ID before calling fork() so the SDK never sees an
      // invalid ID — instead a clear, actionable SdkError is thrown here.
      let resolvedUpToMessageId: string | undefined = upToMessageId;
      if (upToMessageId !== undefined) {
        const workspaceRoot = this.workspaceProvider.getWorkspaceRoot();
        const forkWorkspacePath = sourceMetadata?.workspaceId ?? workspaceRoot;
        if (forkWorkspacePath) {
          resolvedUpToMessageId =
            await this.historyReader.resolveNativeMessageId(
              sessionId,
              forkWorkspacePath,
              upToMessageId,
            );
          if (resolvedUpToMessageId !== upToMessageId) {
            this.logger.info(
              '[SdkAgentAdapter] Resolved Ptah message ID to native SDK UUID for fork',
              {
                sessionId,
                originalUpToMessageId: upToMessageId,
                resolvedUpToMessageId,
              },
            );
          }
        }
      }

      const result = await fork(sessionId, {
        upToMessageId: resolvedUpToMessageId,
        title,
      });

      // Create metadata for the new forked session so session:load and
      // chat:resume can find it. The SDK's standalone forkSession() only
      // writes the JSONL file — it does not touch our metadata store, so
      // without this the new session would 404 on session:load.
      const forkName =
        title ??
        (sourceMetadata ? `${sourceMetadata.name} (fork)` : 'Forked session');

      // Workspace ID resolution chain: source metadata → active workspace.
      // An empty workspaceId would poison the new record:
      //   - SessionRpcHandlers.authorizeSessionAccess rejects empty/unknown
      //     workspaces with `unauthorized-workspace`.
      //   - SessionMetadataStore.getForWorkspace filters by exact path, so
      //     '' would never match and the fork would not appear in the sidebar.
      const workspaceId =
        sourceMetadata?.workspaceId ??
        this.workspaceProvider.getWorkspaceRoot();
      if (!workspaceId) {
        throw new SdkError(
          `Cannot fork session ${sessionId}: source metadata has no workspaceId and no active workspace folder is open. Forking would create a poisoned metadata record that the sidebar and authorization layer would reject.`,
        );
      }
      // Pass kind='forked' so the metadata-changed broadcast distinguishes
      // forked sessions from brand-new ones — the webview can highlight or
      // scroll-to-fork in the sidebar based on this signal.
      await this.metadataStore.create(
        result.sessionId,
        workspaceId,
        forkName,
        'forked',
      );

      this.logger.info('[SdkAgentAdapter] Session forked successfully', {
        sourceSessionId: sessionId,
        newSessionId: result.sessionId,
        upToMessageId,
        resolvedUpToMessageId,
        workspaceId,
        forkName,
      });
      return result;
    } catch (error) {
      const errorObj =
        error instanceof Error ? error : new Error(String(error));
      this.sentryService.captureException(errorObj, {
        errorSource: 'SdkAgentAdapter.forkSession',
      });
      this.logger.error('[SdkAgentAdapter] Failed to fork session', errorObj);
      throw new SdkError(
        `Failed to fork session ${sessionId}: ${errorObj.message}`,
      );
    }
  }

  /**
   * Rewind tracked files to their state at a specific user message.
   *
   * Delegates to `Query.rewindFiles()` on the active SDK query handle for
   * this session. Requires that the session was started with file
   * checkpointing enabled (the default — see SdkQueryOptionsBuilder).
   *
   * **CONSTRAINT**: This requires a LIVE `Query` handle. The session must
   * be currently active in `SessionLifecycleManager` (i.e. there's an
   * in-flight or paused query). If the session has been disposed/ended,
   * the SDK has no checkpoint state to rewind from and this method will
   * throw. RPC callers should ensure the session is active (or resume it
   * first) before invoking rewind.
   *
   * @param sessionId - The active session whose files should be rewound
   * @param userMessageId - UUID of the user message to rewind file state to
   * @param dryRun - When true, returns the planned changes without modifying files
   * @returns `RewindFilesResult` with `canRewind`, optional `error`, and change stats
   * @throws SdkError if the session is not active or has no live Query handle
   */
  async rewindFiles(
    sessionId: SessionId,
    userMessageId: string,
    dryRun?: boolean,
  ): Promise<RewindFilesResult> {
    if (!this.initialized) {
      throw new SdkError(
        'SdkAgentAdapter not initialized. Call initialize() first.',
      );
    }

    this.logger.info(`[SdkAgentAdapter] Rewinding files for session`, {
      sessionId,
      userMessageId,
      dryRun: dryRun ?? false,
    });

    const rec = this.sessionLifecycle.find(sessionId as string);
    if (!rec || !rec.query) {
      // Stable error type so RPC handlers can `instanceof`-check rather than
      // brittle regex-match the message string. The message wording is kept
      // for the legacy regex fallback at the RPC boundary.
      throw new SessionNotActiveError(
        `Cannot rewind files: session ${sessionId} is not active or has no live Query handle. ` +
          `rewindFiles requires the session to be currently active in SessionLifecycleManager — ` +
          `resume the session before invoking rewind.`,
      );
    }

    // NOTE: the SessionNotActiveError thrown above is intentionally outside
    // this try/catch — wrapping it would lose the `instanceof` discriminator
    // the RPC layer relies on.
    try {
      const result = await rec.query.rewindFiles(userMessageId, {
        dryRun,
      });
      this.logger.info('[SdkAgentAdapter] rewindFiles completed', {
        sessionId,
        userMessageId,
        canRewind: result.canRewind,
        filesChanged: result.filesChanged?.length ?? 0,
        insertions: result.insertions,
        deletions: result.deletions,
        error: result.error,
      });
      return result;
    } catch (error) {
      const errorObj =
        error instanceof Error ? error : new Error(String(error));
      this.sentryService.captureException(errorObj, {
        errorSource: 'SdkAgentAdapter.rewindFiles',
      });
      this.logger.error('[SdkAgentAdapter] rewindFiles failed', errorObj);
      throw new SdkError(
        `Failed to rewind files for session ${sessionId}: ${errorObj.message}`,
      );
    }
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
