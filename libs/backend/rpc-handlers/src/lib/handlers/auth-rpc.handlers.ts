/**
 * Auth RPC Handlers
 *
 * Handles authentication-related RPC methods: auth:getHealth, auth:saveSettings,
 * auth:testConnection, auth:getAuthStatus.
 */

import { injectable, inject } from 'tsyringe';
import {
  Logger,
  RpcHandler,
  TOKENS,
  ConfigManager,
  IAuthSecretsService,
} from '@ptah-extension/vscode-core';
import type {
  SentryService,
  WebviewManager,
} from '@ptah-extension/vscode-core';
import type {
  IPlatformCommands,
  IPlatformAuthProvider,
} from '@ptah-extension/platform-core';
import {
  SdkAgentAdapter,
  SDK_TOKENS,
  getAllAnthropicProviders,
  DEFAULT_PROVIDER_ID,
  getAnthropicProvider,
  TIER_ENV_VAR_MAP,
  ClaudeCliDetector,
} from '@ptah-extension/agent-sdk';
import type { SdkAdapterEvents } from '@ptah-extension/agent-sdk';
import {
  ProviderModelsService,
  ActiveProviderResolver,
  AUTH_PROVIDERS_TOKENS,
} from '@ptah-extension/auth-providers';
import type {
  CopilotAuthService,
  CopilotDeviceLoginInfo,
  ICodexAuthService,
} from '@ptah-extension/auth-providers';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import type { AuthDeviceCodePayload } from '@ptah-extension/shared';
import { asAuthCommandRunner } from './auth-command-runner';
import {
  SETTINGS_TOKENS,
  WorkspaceScopeResolver,
} from '@ptah-extension/settings-core';
import { resolveAuthProviderKey } from '@ptah-extension/platform-core';
import {
  AuthGetAuthStatusParams,
  AuthGetAuthStatusResponse,
} from '@ptah-extension/shared';
import type {
  AuthGetScopeResult,
  AuthClearWorkspaceOverrideResult,
} from '@ptah-extension/shared';
import { AuthSettingsSchema } from './auth-rpc.schema';
import type { RpcMethodName } from '@ptah-extension/shared';

/** Provider registry ids used to tag interactive-login push events. */
const COPILOT_PROVIDER_ID = 'github-copilot';
const CODEX_PROVIDER_ID = 'openai-codex';

/**
 * How long one `auth:getAuthStatus` answer stays servable.
 *
 * Short on purpose: the cache exists to absorb the BURST (boot fans three
 * independent callers at the method, and every `workspace:switch` fans more),
 * not to hold a long-lived view of auth state. Anything that MUTATES auth
 * calls `invalidateAuthStatusCache()`, so the TTL only ever covers changes
 * made outside this process — and the `authFileChanged` subscription covers
 * the one of those that matters (`codex login` in a terminal).
 */
const AUTH_STATUS_CACHE_TTL_MS = 15_000;

/**
 * How long a Claude-CLI health verdict stays servable, independently of the
 * status entry above.
 *
 * `ClaudeCliDetector.performHealthCheck` SPAWNS `claude --version`, which is a
 * ~2s `CreateProcessW` on a 253 MB executable and was the bulk of the measured
 * 2-5.3s handler durations. The detector now coalesces that spawn for 30s, but
 * that window is deliberately short and is not a health cache — this is.
 * Installing or removing a CLI is a rare, out-of-band event, so it gets a far
 * longer window than the rest of the payload.
 */
const CLAUDE_CLI_HEALTH_TTL_MS = 5 * 60_000;

/**
 * Hard ceiling on any ONE external probe.
 *
 * The probes already run under a single `Promise.all`, so the handler costs
 * whatever the SLOWEST of them costs — which means one wedged source holds the
 * entire status payload, and with it the first render. Measured on the
 * 2026-08-29 smoke boot: `auth:getAuthStatus` reported 22736 ms and 19911 ms
 * for two coalesced callers, all of it inside the Claude-CLI probe, while the
 * secret reads beside it finished in milliseconds.
 *
 * 5s is far above every probe's measured cost (copilot and codex are file
 * reads; a healthy `claude --version` is ~2s) so this fires only in pathology.
 * A probe that trips it is NOT cancelled — it keeps running and populates the
 * memo for the next caller. See {@link probeClaudeCli}.
 */
const AUTH_PROBE_TIMEOUT_MS = 5_000;

/**
 * Race marker for {@link AuthRpcHandlers.withProbeTimeout}.
 *
 * A unique symbol rather than `undefined` or `null`, because a probe is allowed
 * to resolve to either of those and a sentinel a probe can produce is not a
 * sentinel.
 */
const TIMED_OUT = Symbol('auth-probe-timeout');

/** Copilot half of the status payload. */
interface CopilotProbeResult {
  copilotAuthenticated: boolean;
  copilotUsername?: string;
}

/** Codex half of the status payload. */
interface CodexProbeResult {
  codexAuthenticated: boolean;
  codexTokenStale: boolean;
}

/** Secret-store half of the status payload. */
interface SecretProbeResult {
  hasApiKey: boolean;
  hasOpenRouterKey: boolean;
  hasAnyProviderKey: boolean;
}

function resolveScopeFromKey(
  effectiveKey: string,
  globalKey: string,
): { scope: 'global' | 'app' | 'workspace'; runtime?: string } {
  if (effectiveKey === globalKey) {
    return { scope: 'global' };
  }
  const appMatch = /^app\.([^.]+)\.(.*)$/.exec(effectiveKey);
  if (appMatch) {
    const runtime = appMatch[1];
    const rest = appMatch[2];
    if (rest.startsWith('workspace.')) {
      return { scope: 'workspace', runtime };
    }
    return { scope: 'app', runtime };
  }
  if (effectiveKey.startsWith('workspace.')) {
    return { scope: 'workspace' };
  }
  return { scope: 'global' };
}

/**
 * RPC handlers for authentication operations
 */
@injectable()
export class AuthRpcHandlers {
  static readonly METHODS = [
    'auth:getHealth',
    'auth:getAuthStatus',
    'auth:getStatus',
    'auth:saveSettings',
    'auth:setApiKey',
    'auth:testConnection',
    'auth:copilotLogin',
    'auth:copilotLogout',
    'auth:copilotStatus',
    'auth:codexLogin',
    'auth:getApiKeyStatus',
    'auth:getScope',
    'auth:clearWorkspaceOverride',
  ] as const satisfies readonly RpcMethodName[];

  /**
   * Completed `auth:getAuthStatus` payloads, keyed by
   * `${activePath}|${providerId}` — the two inputs the answer actually varies
   * with. Keying by active path is what makes a workspace switch correct
   * without an explicit invalidation on every switch, AND what makes switching
   * BACK to an already-visited folder free.
   */
  private readonly statusCache = new Map<
    string,
    { value: AuthGetAuthStatusResponse; expiresAt: number }
  >();

  /**
   * In-flight computations, same key. Boot fans three independent frontend
   * callers at this method within milliseconds; without this they each ran the
   * full probe set concurrently (three handlers in flight, 3.5s / 5.3s / 3.7s
   * for one identical payload).
   */
  private readonly statusInFlight = new Map<
    string,
    Promise<AuthGetAuthStatusResponse>
  >();

  /** Memoised Claude-CLI health — see {@link CLAUDE_CLI_HEALTH_TTL_MS}. */
  private claudeCliHealth: { available: boolean; expiresAt: number } | null =
    null;

  /**
   * The Claude-CLI health check currently running, if any.
   *
   * Separate from {@link statusInFlight} because it OUTLIVES the caller that
   * started it: when a probe trips {@link AUTH_PROBE_TIMEOUT_MS} the status is
   * answered from the last known verdict and this promise keeps running, so the
   * memo it eventually writes is what makes the next caller fast rather than
   * making it pay the same timeout again.
   */
  private claudeCliProbe: Promise<boolean> | null = null;

  /**
   * Monotonic cache generation, bumped by every
   * {@link invalidateAuthStatusCache} call.
   *
   * Without it, clearing the maps is not enough: a `computeAuthStatus` that was
   * already in flight when the invalidation happened still resolves afterwards,
   * and its `.then` would write the PRE-change payload into the freshly-cleared
   * cache with a full-length TTL — re-poisoning it with exactly the state the
   * invalidation existed to drop. Boot fans 2-3 concurrent callers at this
   * method, so "a probe outlives a login" is the normal case, not a corner one.
   *
   * Same idiom as `WorkspaceCoordinatorService.refreshWorkspaceProviderState`'s
   * `switchGeneration` guard: capture before the await, re-check after it, and
   * write nothing if the world moved on.
   */
  private cacheGeneration = 0;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(TOKENS.CONFIG_MANAGER)
    private readonly configManager: ConfigManager,
    @inject(TOKENS.AUTH_SECRETS_SERVICE)
    private readonly authSecretsService: IAuthSecretsService,
    @inject(SDK_TOKENS.SDK_AGENT_ADAPTER)
    private readonly sdkAdapter: SdkAgentAdapter,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_PROVIDER_MODELS)
    private readonly providerModels: ProviderModelsService,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_ACTIVE_PROVIDER_RESOLVER)
    private readonly activeProviderResolver: ActiveProviderResolver,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_COPILOT_AUTH)
    private readonly copilotAuth: CopilotAuthService,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_CODEX_AUTH)
    private readonly codexAuth: ICodexAuthService,
    @inject(TOKENS.PLATFORM_COMMANDS)
    private readonly platformCommands: IPlatformCommands,
    @inject(TOKENS.PLATFORM_AUTH_PROVIDER)
    private readonly platformAuth: IPlatformAuthProvider,
    @inject(SDK_TOKENS.SDK_CLI_DETECTOR)
    private readonly cliDetector: ClaudeCliDetector,
    @inject(TOKENS.SENTRY_SERVICE)
    private readonly sentryService: SentryService,
    @inject(SETTINGS_TOKENS.WORKSPACE_SCOPE_RESOLVER)
    private readonly scopeResolver: WorkspaceScopeResolver,
    /**
     * Optional: absent in unit harnesses and in any host that has not wired a
     * webview manager. Used only to broadcast interactive-login progress
     * (`auth:deviceCode`, `auth:loginOutput`) — never load-bearing for the RPC
     * result itself.
     */
    @inject(TOKENS.WEBVIEW_MANAGER, { isOptional: true })
    private readonly webviewManager?: WebviewManager,
    /**
     * Optional: absent in unit harnesses. Used only to learn that
     * `~/.codex/auth.json` changed under us (an external `codex login`) so the
     * status cache can be dropped immediately instead of waiting out its TTL.
     */
    @inject(SDK_TOKENS.SDK_ADAPTER_EVENTS, { isOptional: true })
    private readonly adapterEvents?: SdkAdapterEvents,
  ) {}

  /**
   * Register all auth RPC methods
   */
  register(): void {
    this.registerGetHealth();
    this.registerGetAuthStatus();
    this.registerGetStatus();
    this.registerSaveSettings();
    this.registerSetApiKey();
    this.registerTestConnection();
    this.registerCopilotLogin();
    this.registerCopilotLogout();
    this.registerCopilotStatus();
    this.registerCodexLogin();
    this.registerGetApiKeyStatus();
    this.registerGetScope();
    this.registerClearWorkspaceOverride();

    // An external `codex login` changes the answer without going through any
    // method here, so the TTL is the only thing that would eventually notice.
    this.adapterEvents?.onAuthFileChanged(() =>
      this.invalidateAuthStatusCache(),
    );

    this.logger.debug('Auth RPC handlers registered', {
      methods: [
        'auth:getHealth',
        'auth:getAuthStatus',
        'auth:getStatus',
        'auth:saveSettings',
        'auth:setApiKey',
        'auth:testConnection',
        'auth:copilotLogin',
        'auth:copilotLogout',
        'auth:copilotStatus',
        'auth:codexLogin',
        'auth:getApiKeyStatus',
        'auth:getScope',
        'auth:clearWorkspaceOverride',
      ],
    });
  }

  /**
   * auth:getHealth - Get SDK authentication health status
   */
  private registerGetHealth(): void {
    this.rpcHandler.registerMethod<void, { success: boolean; health: unknown }>(
      'auth:getHealth',
      async () => {
        try {
          this.logger.debug('RPC: auth:getHealth called');
          const health = this.sdkAdapter.getHealth();
          return { success: true, health };
        } catch (error) {
          this.logger.error(
            'RPC: auth:getHealth failed',
            error instanceof Error ? error : new Error(String(error)),
          );
          this.sentryService.captureException(
            error instanceof Error ? error : new Error(String(error)),
            { errorSource: 'AuthRpcHandlers.registerGetHealth' },
          );
          throw error;
        }
      },
    );
  }

  /**
   * auth:getAuthStatus - Get auth configuration status
   * SECURITY: Never returns actual credential values - only boolean existence flags
   *
   * Served from a short TTL cache with in-flight coalescing (TASK_2026_342).
   * Measured before: 14 calls in one boot-plus-two-workspace-switches session,
   * 2.0-5.3s each, identical payload every time, up to three concurrent.
   */
  private registerGetAuthStatus(): void {
    this.rpcHandler.registerMethod<
      AuthGetAuthStatusParams,
      AuthGetAuthStatusResponse
    >('auth:getAuthStatus', async (params: AuthGetAuthStatusParams) => {
      try {
        const safeParams: AuthGetAuthStatusParams = params ?? {};
        const key = this.authStatusCacheKey(safeParams);

        const cached = this.statusCache.get(key);
        if (cached && cached.expiresAt > Date.now()) {
          this.logger.debug('RPC: auth:getAuthStatus called', {
            cacheHit: true,
          });
          return cached.value;
        }

        const inFlight = this.statusInFlight.get(key);
        if (inFlight) {
          this.logger.debug('RPC: auth:getAuthStatus called', {
            coalesced: true,
          });
          return await inFlight;
        }

        this.logger.debug('RPC: auth:getAuthStatus called', {
          cacheHit: false,
        });
        // Captured BEFORE the first await. Everything this computation writes
        // back is conditional on it still being current when the write happens.
        const generation = this.cacheGeneration;
        const pending: Promise<AuthGetAuthStatusResponse> =
          this.computeAuthStatus(safeParams, generation)
            .then((value) => {
              // An invalidation landed while we were probing: this payload is a
              // snapshot of the PRE-change world. The caller that asked for it
              // still gets it (it is the honest answer to a question asked
              // before the change), but it must not become the cached answer for
              // everyone else.
              if (generation === this.cacheGeneration) {
                this.statusCache.set(key, {
                  value,
                  expiresAt: Date.now() + AUTH_STATUS_CACHE_TTL_MS,
                });
              }
              return value;
            })
            .finally(() => {
              // Delete by IDENTITY, not by key: an invalidation already cleared
              // the map and a newer computation may have claimed this key, and
              // evicting that one would un-coalesce the very burst this exists
              // to absorb.
              if (this.statusInFlight.get(key) === pending) {
                this.statusInFlight.delete(key);
              }
            });
        this.statusInFlight.set(key, pending);
        return await pending;
      } catch (error) {
        this.logger.error(
          'RPC: auth:getAuthStatus failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        this.sentryService.captureException(
          error instanceof Error ? error : new Error(String(error)),
          { errorSource: 'AuthRpcHandlers.registerGetAuthStatus' },
        );
        throw error;
      }
    });
  }

  /**
   * The two inputs the status payload varies with: the active workspace (auth
   * and provider settings are workspace-scopable) and the caller's explicit
   * `providerId` override.
   */
  private authStatusCacheKey(params: AuthGetAuthStatusParams): string {
    return `${this.scopeResolver.getActivePath() ?? ''}|${
      params.providerId ?? ''
    }`;
  }

  /**
   * Drop every cached auth answer. MUST be called by any method that mutates
   * auth state — otherwise the UI keeps reading the pre-change payload for up
   * to {@link AUTH_STATUS_CACHE_TTL_MS} after a login, logout or key write.
   *
   * Bumping {@link cacheGeneration} is the half that makes this hold under
   * concurrency: clearing alone is undone by any probe still in flight.
   */
  private invalidateAuthStatusCache(): void {
    this.cacheGeneration++;
    this.statusCache.clear();
    this.statusInFlight.clear();
    this.claudeCliHealth = null;
    // Dropped for the same reason as `statusInFlight`: a verdict computed
    // before the change must not be handed to a caller that arrives after it.
    // Coalescing the underlying SPAWN is `ClaudeCliDetector`'s job, not this
    // one's, so releasing the reference here costs nothing.
    this.claudeCliProbe = null;
  }

  /**
   * Build one `auth:getAuthStatus` payload. The three independent probes
   * (Copilot, Codex, Claude CLI) run in PARALLEL and each swallows its own
   * failure, so one broken source degrades a single field instead of the whole
   * response or the whole latency budget.
   */
  private async computeAuthStatus(
    safeParams: AuthGetAuthStatusParams,
    generation: number,
  ): Promise<AuthGetAuthStatusResponse> {
    const active = this.activeProviderResolver.resolveActiveAuth();
    const authMethod = active.authMethod;
    const anthropicProviderId = active.providerId;
    const checkProviderId = safeParams.providerId || anthropicProviderId;
    // Merged list — built-ins plus user-defined entries. A custom provider
    // holding the only configured key must still flip `hasAnyProviderKey`.
    const allProviders = getAllAnthropicProviders();

    const [secrets, copilot, codex, claudeCliInstalled] = await Promise.all([
      this.probeSecrets(checkProviderId, allProviders),
      this.probeCopilot(),
      this.probeCodex(),
      this.probeClaudeCli(generation),
    ]);

    // The read model behind BOTH the webview tile grid and the TUI tile
    // list. Sourcing it from the static array is what made user-defined
    // entries invisible everywhere at once.
    const availableProviders = allProviders.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      helpUrl: p.helpUrl,
      keyPrefix: p.keyPrefix,
      keyPlaceholder: p.keyPlaceholder,
      maskedKeyDisplay: p.maskedKeyDisplay,
      hasDynamicModels: !!('modelsEndpoint' in p && p.modelsEndpoint),
      authType: 'authType' in p ? p.authType : undefined,
      isLocal: 'isLocal' in p ? p.isLocal : undefined,
      baseUrl: p.baseUrl,
      supportsOptionalApiKey:
        'supportsOptionalApiKey' in p ? p.supportsOptionalApiKey : undefined,
      // Ambient-credential providers (claude-cli). Without this the tile
      // is indistinguishable from a local server in this payload, which is
      // how the TUI came to render it with a fabricated localhost endpoint.
      nativeAuth: 'nativeAuth' in p ? p.nativeAuth : undefined,
    }));

    this.logger.debug('RPC: auth:getAuthStatus result', {
      hasApiKey: secrets.hasApiKey,
      hasOpenRouterKey: secrets.hasOpenRouterKey,
      hasAnyProviderKey: secrets.hasAnyProviderKey,
      authMethod,
      anthropicProviderId,
      copilotAuthenticated: copilot.copilotAuthenticated,
      codexAuthenticated: codex.codexAuthenticated,
      codexTokenStale: codex.codexTokenStale,
      claudeCliInstalled,
    });

    return {
      hasApiKey: secrets.hasApiKey,
      hasOpenRouterKey: secrets.hasOpenRouterKey,
      hasAnyProviderKey: secrets.hasAnyProviderKey,
      authMethod,
      anthropicProviderId,
      availableProviders,
      copilotAuthenticated: copilot.copilotAuthenticated,
      copilotUsername: copilot.copilotUsername,
      codexAuthenticated: codex.codexAuthenticated,
      codexTokenStale: codex.codexTokenStale,
      claudeCliInstalled,
    };
  }

  /**
   * Secret-store presence flags. The per-provider sweep keeps its early break:
   * one hit answers the question, and the whole set is only walked when NO
   * provider key exists at all.
   */
  private async probeSecrets(
    checkProviderId: string,
    allProviders: ReadonlyArray<{ id: string }>,
  ): Promise<SecretProbeResult> {
    const [hasApiKey, hasOpenRouterKey] = await Promise.all([
      this.authSecretsService.hasCredential('apiKey'),
      this.authSecretsService.hasProviderKey(checkProviderId),
    ]);

    let hasAnyProviderKey = hasOpenRouterKey;
    if (!hasAnyProviderKey) {
      for (const p of allProviders) {
        if (await this.authSecretsService.hasProviderKey(p.id)) {
          hasAnyProviderKey = true;
          break;
        }
      }
    }

    return { hasApiKey, hasOpenRouterKey, hasAnyProviderKey };
  }

  /**
   * Resolve to `fallback` if `probe` has not settled within `AUTH_PROBE_TIMEOUT_MS`.
   *
   * The probe is deliberately NOT cancelled. There is nothing to cancel — a
   * spawn is already running — and letting it finish is what lets it populate
   * whatever memo it owns, so the next caller is fast instead of paying the
   * same timeout again.
   */
  private async withProbeTimeout<T>(
    label: string,
    probe: Promise<T>,
    fallback: () => T,
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expiry = new Promise<typeof TIMED_OUT>((resolve) => {
      timer = setTimeout(() => resolve(TIMED_OUT), AUTH_PROBE_TIMEOUT_MS);
      timer.unref?.();
    });

    try {
      const outcome = await Promise.race([probe, expiry]);
      if (outcome !== TIMED_OUT) return outcome as T;
      this.logger.warn(
        `${label} auth probe exceeded ${AUTH_PROBE_TIMEOUT_MS}ms — answering from the last known value`,
      );
      return fallback();
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Copilot probe. Non-fatal: a failure yields "not authenticated". */
  private async probeCopilot(): Promise<CopilotProbeResult> {
    return this.withProbeTimeout('Copilot', this.runCopilotProbe(), () => ({
      copilotAuthenticated: false,
    }));
  }

  private async runCopilotProbe(): Promise<CopilotProbeResult> {
    try {
      const copilotAuthenticated = await this.copilotAuth.isAuthenticated();
      if (!copilotAuthenticated) return { copilotAuthenticated: false };
      return {
        copilotAuthenticated: true,
        copilotUsername: await this.getGitHubUsername(),
      };
    } catch (copilotError: unknown) {
      this.logger.warn(
        'Copilot auth status check failed (non-fatal)',
        copilotError instanceof Error
          ? copilotError
          : new Error(String(copilotError)),
      );
      return { copilotAuthenticated: false };
    }
  }

  /** Codex probe. Non-fatal: a failure yields "not authenticated, not stale". */
  private async probeCodex(): Promise<CodexProbeResult> {
    return this.withProbeTimeout('Codex', this.runCodexProbe(), () => ({
      codexAuthenticated: false,
      codexTokenStale: false,
    }));
  }

  private async runCodexProbe(): Promise<CodexProbeResult> {
    try {
      const codexStatus = await this.codexAuth.getTokenStatus();
      return {
        codexAuthenticated: codexStatus.authenticated,
        codexTokenStale: codexStatus.stale,
      };
    } catch (codexError: unknown) {
      this.logger.warn(
        'Codex auth status check failed (non-fatal)',
        codexError instanceof Error
          ? codexError
          : new Error(String(codexError)),
      );
      return { codexAuthenticated: false, codexTokenStale: false };
    }
  }

  /**
   * Claude CLI probe, memoised for {@link CLAUDE_CLI_HEALTH_TTL_MS}.
   *
   * A FAILURE is deliberately not memoised — a detector that threw is not
   * evidence the CLI is absent, and retrying costs one spawn.
   *
   * `generation` guards the memo write for the same reason the status cache is
   * guarded, and it matters MORE here: this entry lives five minutes, so a
   * verdict written back after an invalidation would outlast a status entry by
   * twenty times.
   */
  private async probeClaudeCli(generation: number): Promise<boolean> {
    const memo = this.claudeCliHealth;
    if (memo && memo.expiresAt > Date.now()) {
      return memo.available;
    }

    return this.withProbeTimeout(
      'Claude CLI',
      this.startClaudeCliProbe(generation),
      // An EXPIRED memo is still the best answer available. Reporting `false`
      // instead would tell the UI the CLI vanished — which flips the auth badge
      // and can bounce the user to a setup screen — on the evidence of a slow
      // spawn. `false` is only correct when nothing was ever known.
      () => memo?.available ?? false,
    );
  }

  /**
   * The health check itself, single-flighted so a caller arriving while one is
   * running (including one that already timed out) joins it instead of adding
   * a second `claude --version` spawn to a loop that is evidently busy.
   *
   * Never rejects: every failure mode resolves to `false`.
   */
  private startClaudeCliProbe(generation: number): Promise<boolean> {
    const running = this.claudeCliProbe;
    if (running) return running;

    const pending: Promise<boolean> = this.cliDetector
      .performHealthCheck()
      .then((cliHealth) => {
        if (generation === this.cacheGeneration) {
          this.claudeCliHealth = {
            available: cliHealth.available,
            expiresAt: Date.now() + CLAUDE_CLI_HEALTH_TTL_MS,
          };
        }
        return cliHealth.available;
      })
      .catch((cliError: unknown) => {
        this.logger.warn(
          'Claude CLI detection failed (non-fatal)',
          cliError instanceof Error ? cliError : new Error(String(cliError)),
        );
        return false;
      })
      .finally(() => {
        if (this.claudeCliProbe === pending) {
          this.claudeCliProbe = null;
        }
      });
    this.claudeCliProbe = pending;
    return pending;
  }

  /**
   * auth:saveSettings - Save authentication settings
   */
  private registerSaveSettings(): void {
    this.rpcHandler.registerMethod<
      unknown,
      { success: boolean; error?: string }
    >('auth:saveSettings', async (params: unknown) => {
      try {
        const sanitizedParams =
          typeof params === 'object' && params !== null
            ? {
                ...params,
                anthropicApiKey:
                  'anthropicApiKey' in params &&
                  typeof params.anthropicApiKey === 'string' &&
                  params.anthropicApiKey
                    ? `***${params.anthropicApiKey.slice(-4)}`
                    : undefined,
                providerApiKey:
                  'providerApiKey' in params &&
                  typeof params.providerApiKey === 'string' &&
                  params.providerApiKey
                    ? `***${params.providerApiKey.slice(-4)}`
                    : undefined,
              }
            : params;
        this.logger.debug('RPC: auth:saveSettings called', {
          params: sanitizedParams,
        });
        const validated = AuthSettingsSchema.parse(params);
        const applyTo: 'global' | 'app' | 'workspace' =
          validated.applyTo ?? 'global';
        await this.scopeResolver.write(
          'authMethod',
          validated.authMethod,
          applyTo,
          true,
        );
        await this.scopeResolver.clearMoreSpecific('authMethod', applyTo, true);
        if (validated.anthropicApiKey !== undefined) {
          if (validated.anthropicApiKey.trim()) {
            await this.authSecretsService.setCredential(
              'apiKey',
              validated.anthropicApiKey,
            );
          } else {
            await this.authSecretsService.deleteCredential('apiKey');
          }
        }
        if (validated.providerApiKey !== undefined) {
          const targetProviderId =
            validated.anthropicProviderId ??
            this.scopeResolver.read<string>('anthropicProviderId', true) ??
            DEFAULT_PROVIDER_ID;

          if (validated.providerApiKey.trim()) {
            await this.authSecretsService.setProviderKey(
              targetProviderId,
              validated.providerApiKey,
            );
          } else {
            await this.authSecretsService.deleteProviderKey(targetProviderId);
          }
          this.providerModels.clearCache(targetProviderId);
        }
        if (validated.anthropicProviderId !== undefined) {
          await this.scopeResolver.write(
            'anthropicProviderId',
            validated.anthropicProviderId,
            applyTo,
            true,
          );
          await this.scopeResolver.clearMoreSpecific(
            'anthropicProviderId',
            applyTo,
            true,
          );
          await this.autoMapProviderTiers(validated.anthropicProviderId);
        }
        this.logger.info('RPC: auth:saveSettings triggering adapter reset...');
        await this.sdkAdapter.reset();
        this.logger.info('RPC: auth:saveSettings adapter reset completed');

        this.invalidateAuthStatusCache();
        this.logger.info('RPC: auth:saveSettings completed successfully');
        return { success: true };
      } catch (error) {
        this.logger.error(
          'RPC: auth:saveSettings failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        this.sentryService.captureException(
          error instanceof Error ? error : new Error(String(error)),
          { errorSource: 'AuthRpcHandlers.registerSaveSettings' },
        );
        throw error;
      }
    });
  }

  /**
   * auth:testConnection - Test connection after settings save
   *
   * Uses retry-poll with exponential backoff instead of a fixed delay.
   * Delays: 200ms, 400ms, 800ms, 1600ms, 3200ms = ~6.2s total max.
   * Returns as soon as the SDK reports 'available', avoiding unnecessary waits.
   */
  private registerTestConnection(): void {
    this.rpcHandler.registerMethod<
      void,
      { success: boolean; health: unknown; errorMessage?: string }
    >('auth:testConnection', async () => {
      try {
        this.logger.debug('RPC: auth:testConnection called');
        const MAX_RETRIES = 5;
        const BASE_DELAY_MS = 200;

        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
          const delay = BASE_DELAY_MS * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, delay));

          const health = this.sdkAdapter.getHealth();
          if (health.status === 'available') {
            const result = {
              success: true,
              health,
              errorMessage: undefined,
            };
            this.logger.info('RPC: auth:testConnection completed', {
              result,
              attempt: attempt + 1,
            });
            return result;
          }

          this.logger.debug(
            `RPC: auth:testConnection attempt ${attempt + 1}/${MAX_RETRIES}`,
            { status: health.status, delay },
          );
        }
        const finalHealth = this.sdkAdapter.getHealth();
        const result = {
          success: finalHealth.status === 'available',
          health: finalHealth,
          errorMessage: finalHealth.errorMessage || 'Connection test timed out',
        };

        this.logger.info(
          'RPC: auth:testConnection completed (exhausted retries)',
          { result },
        );
        return result;
      } catch (error) {
        this.logger.error(
          'RPC: auth:testConnection failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        this.sentryService.captureException(
          error instanceof Error ? error : new Error(String(error)),
          { errorSource: 'AuthRpcHandlers.registerTestConnection' },
        );
        throw error;
      }
    });
  }

  /**
   * auth:copilotLogin - Trigger GitHub OAuth login for Copilot provider.
   *
   * Initiates the VS Code GitHub authentication flow,
   * exchanges the token for a Copilot bearer token, and returns the
   * connected username.
   */
  private registerCopilotLogin(): void {
    this.rpcHandler.registerMethod<
      Record<string, never>,
      { success: boolean; username?: string; error?: string }
    >('auth:copilotLogin', async () => {
      try {
        this.logger.debug('RPC: auth:copilotLogin called');

        // The device-code flow blocks inside `login()` for up to five minutes.
        // Broadcasting the code the moment it exists is the only way a surface
        // without a message dialog (the TUI) can show the user what to do —
        // `showInformationMessage` still fires for VS Code / Electron.
        const loginSuccess = await this.copilotAuth.login({
          onDeviceCode: (info) => this.broadcastDeviceCode(info),
        });

        if (!loginSuccess) {
          return {
            success: false,
            error:
              'GitHub login failed. Ensure you have an active GitHub Copilot subscription.',
          };
        }
        const username = await this.getGitHubUsername();
        await this.autoMapProviderTiers('github-copilot');
        await this.sdkAdapter.reset();
        this.invalidateAuthStatusCache();

        this.logger.info('RPC: auth:copilotLogin succeeded', { username });
        return { success: true, username };
      } catch (error) {
        this.logger.error(
          'RPC: auth:copilotLogin failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        this.sentryService.captureException(
          error instanceof Error ? error : new Error(String(error)),
          { errorSource: 'AuthRpcHandlers.registerCopilotLogin' },
        );
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Login failed',
        };
      }
    });
  }

  /**
   * auth:copilotLogout - Disconnect GitHub Copilot in Ptah.
   *
   * Clears the in-memory Copilot auth state AND persists a Ptah-side logout
   * tombstone so the next `configure()` does not silently re-authenticate from
   * the shared `~/.config/github-copilot/hosts.json`. That file is left alone
   * on purpose — it belongs to the user's editor Copilot integrations too.
   */
  private registerCopilotLogout(): void {
    this.rpcHandler.registerMethod<Record<string, never>, { success: boolean }>(
      'auth:copilotLogout',
      async () => {
        try {
          this.logger.debug('RPC: auth:copilotLogout called');
          // MUST be awaited: logout() persists a logout tombstone to the
          // settings store (TASK_2026_172 Issue 2). Fire-and-forget would
          // report success before the write landed and could lose it entirely
          // if the host exited right after.
          await this.copilotAuth.logout();
          this.invalidateAuthStatusCache();
          this.logger.info('RPC: auth:copilotLogout succeeded');
          return { success: true };
        } catch (error) {
          this.logger.error(
            'RPC: auth:copilotLogout failed',
            error instanceof Error ? error : new Error(String(error)),
          );
          this.sentryService.captureException(
            error instanceof Error ? error : new Error(String(error)),
            { errorSource: 'AuthRpcHandlers.registerCopilotLogout' },
          );
          return { success: false };
        }
      },
    );
  }

  /**
   * auth:copilotStatus - Check if Copilot is already authenticated
   *
   * Returns current authentication state without
   * triggering a login flow.
   */
  private registerCopilotStatus(): void {
    this.rpcHandler.registerMethod<
      Record<string, never>,
      { authenticated: boolean; username?: string }
    >('auth:copilotStatus', async () => {
      try {
        this.logger.debug('RPC: auth:copilotStatus called');

        const authenticated = await this.copilotAuth.isAuthenticated();

        if (!authenticated) {
          return { authenticated: false };
        }

        const username = await this.getGitHubUsername();

        this.logger.debug('RPC: auth:copilotStatus result', {
          authenticated,
          username,
        });
        return { authenticated: true, username };
      } catch (error) {
        this.logger.error(
          'RPC: auth:copilotStatus failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        this.sentryService.captureException(
          error instanceof Error ? error : new Error(String(error)),
          { errorSource: 'AuthRpcHandlers.registerCopilotStatus' },
        );
        return { authenticated: false };
      }
    });
  }

  /**
   * auth:setApiKey - Store or clear an API key for a provider.
   *
   * Lifted from
   * `apps/ptah-electron/src/services/rpc/handlers/config-extended-rpc.handlers.ts`
   * so all three apps (VS Code, Electron, CLI) consume it via
   * `registerAllRpcHandlers()`. Empty/whitespace `apiKey` deletes the slot
   * — mirrors how `auth:saveSettings` treats empty strings.
   */
  private registerSetApiKey(): void {
    this.rpcHandler.registerMethod<
      { provider: string; apiKey: string },
      { success: boolean; error?: string }
    >('auth:setApiKey', async (params) => {
      try {
        if (!params?.provider) {
          return {
            success: false,
            error: 'provider is required',
          };
        }
        if (params.apiKey?.trim()) {
          await this.authSecretsService.setProviderKey(
            params.provider,
            params.apiKey,
          );
        } else {
          await this.authSecretsService.deleteProviderKey(params.provider);
        }
        this.providerModels.clearCache(params.provider);
        this.invalidateAuthStatusCache();
        return { success: true };
      } catch (error) {
        this.logger.error(
          'RPC: auth:setApiKey failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        this.sentryService.captureException(
          error instanceof Error ? error : new Error(String(error)),
          { errorSource: 'AuthRpcHandlers.registerSetApiKey' },
        );
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });
  }

  /**
   * auth:getStatus - Compact auth status for the active Anthropic provider.
   *
   * Lifted from
   * `apps/ptah-electron/src/services/rpc/handlers/config-extended-rpc.handlers.ts`.
   * Distinct from `auth:getAuthStatus` (which returns full provider list +
   * Copilot/Codex/Claude CLI flags); this method is the lightweight check
   * the Electron renderer uses on startup.
   */
  private registerGetStatus(): void {
    this.rpcHandler.registerMethod<
      Record<string, never>,
      { isAuthenticated: boolean; provider: string; hasApiKey: boolean }
    >('auth:getStatus', async () => {
      try {
        const provider = this.configManager.getWithDefault<string>(
          'anthropicProviderId',
          DEFAULT_PROVIDER_ID,
        );
        const hasApiKey =
          await this.authSecretsService.hasProviderKey(provider);
        return { isAuthenticated: hasApiKey, provider, hasApiKey };
      } catch (error) {
        this.logger.error(
          'RPC: auth:getStatus failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        this.sentryService.captureException(
          error instanceof Error ? error : new Error(String(error)),
          { errorSource: 'AuthRpcHandlers.registerGetStatus' },
        );
        return {
          isAuthenticated: false,
          provider: DEFAULT_PROVIDER_ID,
          hasApiKey: false,
        };
      }
    });
  }

  /**
   * auth:getApiKeyStatus - List all providers with their key presence
   *
   * Lifted from
   * `apps/ptah-electron/src/services/rpc/handlers/config-extended-rpc.handlers.ts`
   * so all three apps (VS Code, Electron, CLI) consume it via
   * `registerAllRpcHandlers()`. Body is a verbatim port; the only mechanical
   * change is `container.resolve<...>(...)` → `this.<field>` (constructor-injected).
   */
  private registerGetApiKeyStatus(): void {
    this.rpcHandler.registerMethod<
      Record<string, never>,
      {
        providers: Array<{
          provider: string;
          displayName: string;
          hasApiKey: boolean;
          isDefault: boolean;
        }>;
      }
    >('auth:getApiKeyStatus', async () => {
      try {
        const activeProvider = this.configManager.getWithDefault<string>(
          'anthropicProviderId',
          DEFAULT_PROVIDER_ID,
        );
        const providers = await Promise.all(
          getAllAnthropicProviders().map(async (p) => ({
            provider: p.id,
            displayName: p.name,
            hasApiKey: await this.authSecretsService.hasProviderKey(p.id),
            isDefault: p.id === activeProvider,
          })),
        );
        return { providers };
      } catch (error) {
        this.logger.error(
          'RPC: auth:getApiKeyStatus failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        this.sentryService.captureException(
          error instanceof Error ? error : new Error(String(error)),
          { errorSource: 'AuthRpcHandlers.registerGetApiKeyStatus' },
        );
        return { providers: [] };
      }
    });
  }

  /**
   * auth:codexLogin - Start the external `codex login --device-auth` flow.
   *
   * Two paths, selected by platform capability (see `auth-command-runner.ts`):
   *
   * 1. The platform can run the command itself (`IAuthCommandRunner`, i.e. the
   *    CLI/TUI runtime). The command is spawned, its output is streamed to the
   *    UI as `auth:loginOutput` / `auth:deviceCode` push events, and `success`
   *    reflects the real exit code.
   * 2. The platform has a terminal (VS Code). Unchanged historical behaviour:
   *    hand the command to `openTerminal` and report success — the user drives
   *    it from there and the outcome is not observable here.
   */
  private registerCodexLogin(): void {
    this.rpcHandler.registerMethod<void, { success: boolean; error?: string }>(
      'auth:codexLogin',
      async () => {
        const command = 'codex login --device-auth';
        const runner = asAuthCommandRunner(this.platformCommands);

        if (!runner) {
          this.logger.info('RPC: auth:codexLogin - opening terminal');
          this.platformCommands.openTerminal('Codex Login', command);
          return { success: true };
        }

        this.logger.info('RPC: auth:codexLogin - running command in-process');
        try {
          const result = await runner.runAuthCommand({
            provider: CODEX_PROVIDER_ID,
            name: 'Codex Login',
            command,
          });
          if (!result.success) {
            this.logger.warn(
              `RPC: auth:codexLogin failed (exit ${String(result.exitCode)})`,
            );
            return {
              success: false,
              error: result.error ?? 'codex login did not complete.',
            };
          }
          this.codexAuth.clearCache();
          await this.sdkAdapter.reset();
          this.invalidateAuthStatusCache();
          return { success: true };
        } catch (error) {
          this.logger.error(
            'RPC: auth:codexLogin failed',
            error instanceof Error ? error : new Error(String(error)),
          );
          this.sentryService.captureException(
            error instanceof Error ? error : new Error(String(error)),
            { errorSource: 'AuthRpcHandlers.registerCodexLogin' },
          );
          return { success: false, error: 'Failed to start Codex login.' };
        }
      },
    );
  }

  /**
   * Broadcast a provider device code to every attached surface. Best-effort:
   * a missing webview manager or a rejected send must never fail the login.
   */
  private broadcastDeviceCode(info: CopilotDeviceLoginInfo): void {
    const payload: AuthDeviceCodePayload = {
      provider: COPILOT_PROVIDER_ID,
      userCode: info.userCode,
      verificationUri: info.verificationUri,
      expiresInSeconds: info.expiresIn,
    };
    void this.webviewManager
      ?.broadcastMessage(MESSAGE_TYPES.AUTH_DEVICE_CODE, payload)
      .catch((error: unknown) => {
        this.logger.warn(
          `Failed to broadcast ${MESSAGE_TYPES.AUTH_DEVICE_CODE}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
  }

  /**
   * auth:getScope - Report whether the active workspace overrides auth/provider
   * settings or inherits the global defaults.
   */
  private registerGetScope(): void {
    this.rpcHandler.registerMethod<Record<string, never>, AuthGetScopeResult>(
      'auth:getScope',
      async () => {
        try {
          const activePath = this.scopeResolver.getActivePath() ?? null;
          const authMethodKey = this.scopeResolver.effectiveKey(
            'authMethod',
            true,
          );
          const providerKey = this.scopeResolver.effectiveKey(
            'anthropicProviderId',
            true,
          );
          const authMethodResolved = resolveScopeFromKey(
            authMethodKey,
            'authMethod',
          );
          const providerResolved = resolveScopeFromKey(
            providerKey,
            'anthropicProviderId',
          );
          const runtime =
            authMethodResolved.runtime ?? providerResolved.runtime;
          return {
            authMethodScope: authMethodResolved.scope,
            providerScope: providerResolved.scope,
            activePath,
            ...(runtime !== undefined ? { runtime } : {}),
          };
        } catch (error) {
          this.logger.error(
            'RPC: auth:getScope failed',
            error instanceof Error ? error : new Error(String(error)),
          );
          this.sentryService.captureException(
            error instanceof Error ? error : new Error(String(error)),
            { errorSource: 'AuthRpcHandlers.registerGetScope' },
          );
          throw error;
        }
      },
    );
  }

  /**
   * auth:clearWorkspaceOverride - Drop the active workspace's overrides for
   * authMethod, anthropicProviderId, and the active provider's model + effort
   * keys, reverting them to the global defaults.
   */
  private registerClearWorkspaceOverride(): void {
    this.rpcHandler.registerMethod<
      Record<string, never>,
      AuthClearWorkspaceOverrideResult
    >('auth:clearWorkspaceOverride', async () => {
      try {
        const authMethod =
          this.scopeResolver.read<string>('authMethod', true) ?? 'apiKey';
        const providerId =
          this.scopeResolver.read<string>('anthropicProviderId', true) ?? '';
        const authKey = resolveAuthProviderKey(authMethod, providerId);

        await this.scopeResolver.clearOverride('authMethod', true);
        await this.scopeResolver.clearOverride('anthropicProviderId', true);
        await this.scopeResolver.clearOverride(
          `provider.${authKey}.selectedModel`,
          true,
        );
        await this.scopeResolver.clearOverride(
          `provider.${authKey}.reasoningEffort`,
          true,
        );

        await this.sdkAdapter.reset();
        this.invalidateAuthStatusCache();

        return { success: true };
      } catch (error) {
        this.logger.error(
          'RPC: auth:clearWorkspaceOverride failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        this.sentryService.captureException(
          error instanceof Error ? error : new Error(String(error)),
          { errorSource: 'AuthRpcHandlers.registerClearWorkspaceOverride' },
        );
        throw error;
      }
    });
  }

  /**
   * Auto-map a provider's default tier models on first selection or login.
   * Only sets tiers that haven't been explicitly configured by the user.
   *
   * Reads `defaultTiers` from the provider registry entry. Providers without
   * defaultTiers (e.g., OpenRouter, local providers) are silently skipped.
   */
  private async autoMapProviderTiers(providerId: string): Promise<void> {
    const provider = getAnthropicProvider(providerId);
    if (!provider?.defaultTiers) return;

    try {
      const currentTiers = this.providerModels.getModelTiers(
        providerId,
        'mainAgent',
      );
      const { defaultTiers } = provider;

      const tierNames = Object.keys(TIER_ENV_VAR_MAP) as Array<
        keyof typeof TIER_ENV_VAR_MAP
      >;
      const promises: Promise<void>[] = [];
      for (const tier of tierNames) {
        if (!currentTiers[tier] && defaultTiers[tier]) {
          promises.push(
            this.providerModels.setModelTier(
              providerId,
              tier,
              defaultTiers[tier],
              'mainAgent',
            ),
          );
        }
      }

      if (promises.length > 0) {
        await Promise.all(promises);
        this.logger.info(`Auto-mapped ${provider.name} default tier models`, {
          mapped: promises.length,
        });
      }
    } catch (error) {
      this.logger.warn(
        `Failed to auto-map ${provider?.name ?? providerId} tier models (non-fatal)`,
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  /**
   * Retrieve the GitHub username from the platform auth provider.
   * Returns undefined if no active session is found.
   * Delegates to IPlatformAuthProvider instead of vscode.authentication.
   */
  private async getGitHubUsername(): Promise<string | undefined> {
    return this.platformAuth.getGitHubUsername();
  }
}
