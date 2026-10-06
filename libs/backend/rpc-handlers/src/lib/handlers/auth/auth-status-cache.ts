import type { Logger } from '@ptah-extension/vscode-core';
import { getAllAnthropicProviders } from '@ptah-extension/agent-sdk';
import type { ClaudeCliDetector } from '@ptah-extension/agent-sdk';
import type { ActiveProviderResolver } from '@ptah-extension/auth-providers';
import type { WorkspaceScopeResolver } from '@ptah-extension/settings-core';
import type {
  AuthGetAuthStatusParams,
  AuthGetAuthStatusResponse,
} from '@ptah-extension/shared';
import type { AuthStatusProbes } from './auth-status-probes';
import { ClaudeCliHealthProbe } from './claude-cli-health-probe';
import type { ClaudeCliHealth } from './claude-cli-health-probe';

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

export interface AuthStatusCacheDeps {
  readonly logger: Logger;
  readonly scopeResolver: WorkspaceScopeResolver;
  readonly activeProviderResolver: ActiveProviderResolver;
  readonly cliDetector: ClaudeCliDetector;
  readonly probes: AuthStatusProbes;
}

/**
 * Single owner of every piece of `auth:getAuthStatus` state: the TTL cache,
 * the in-flight map, the cache generation and the memoised Claude-CLI health.
 * Served from a short TTL cache with in-flight coalescing (TASK_2026_342).
 */
export class AuthStatusCache {
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

  /**
   * Monotonic cache generation, bumped by every {@link invalidate} call.
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

  private readonly claudeCli: ClaudeCliHealthProbe;

  constructor(private readonly deps: AuthStatusCacheDeps) {
    this.claudeCli = new ClaudeCliHealthProbe(
      deps.cliDetector,
      deps.logger,
      () => this.cacheGeneration,
    );
  }

  /** The current cache generation; see {@link cacheGeneration}. */
  get generation(): number {
    return this.cacheGeneration;
  }

  /** The memoised Claude-CLI verdict, expired or not; `null` when unknown. */
  get claudeCliHealth(): ClaudeCliHealth | null {
    return this.claudeCli.health;
  }

  /**
   * The two inputs the status payload varies with: the active workspace (auth
   * and provider settings are workspace-scopable) and the caller's explicit
   * `providerId` override.
   */
  cacheKey(params: AuthGetAuthStatusParams): string {
    return `${this.deps.scopeResolver.getActivePath() ?? ''}|${
      params.providerId ?? ''
    }`;
  }

  /** The cached payload for `key` while its TTL lasts. */
  getFresh(key: string): AuthGetAuthStatusResponse | undefined {
    const cached = this.statusCache.get(key);
    return cached && cached.expiresAt > Date.now() ? cached.value : undefined;
  }

  /** The computation already running for `key`, if any. */
  getInFlight(key: string): Promise<AuthGetAuthStatusResponse> | undefined {
    return this.statusInFlight.get(key);
  }

  /**
   * Start a computation for `key` and register it as in flight. The result is
   * cached only if no invalidation landed while it was probing.
   */
  compute(
    key: string,
    safeParams: AuthGetAuthStatusParams,
  ): Promise<AuthGetAuthStatusResponse> {
    // Captured BEFORE the first await. Everything this computation writes
    // back is conditional on it still being current when the write happens.
    const generation = this.cacheGeneration;
    const pending: Promise<AuthGetAuthStatusResponse> = this.computeAuthStatus(
      safeParams,
      generation,
    )
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
    return pending;
  }

  /**
   * Drop every cached auth answer. MUST be called by any method that mutates
   * auth state — otherwise the UI keeps reading the pre-change payload for up
   * to {@link AUTH_STATUS_CACHE_TTL_MS} after a login, logout or key write.
   *
   * Bumping {@link cacheGeneration} is the half that makes this hold under
   * concurrency: clearing alone is undone by any probe still in flight.
   */
  invalidate(): void {
    this.cacheGeneration++;
    this.statusCache.clear();
    this.statusInFlight.clear();
    this.claudeCli.forget();
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
    const { probes } = this.deps;
    const active = this.deps.activeProviderResolver.resolveActiveAuth();
    const authMethod = active.authMethod;
    const anthropicProviderId = active.providerId;
    const checkProviderId = safeParams.providerId || anthropicProviderId;
    // Merged list — built-ins plus user-defined entries. A custom provider
    // holding the only configured key must still flip `hasAnyProviderKey`.
    const allProviders = getAllAnthropicProviders();

    const [secrets, copilot, codex, claudeCliInstalled] = await Promise.all([
      probes.probeSecrets(checkProviderId, allProviders),
      probes.probeCopilot(),
      probes.probeCodex(),
      this.claudeCli.probe(generation),
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

    this.deps.logger.debug('RPC: auth:getAuthStatus result', {
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
      ...(secrets.apiKeyHint ? { apiKeyHint: secrets.apiKeyHint } : {}),
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
}
