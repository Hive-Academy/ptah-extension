/**
 * Provider Proxy Pool (Phase 3 — per-workspace isolated proxy providers)
 *
 * Owns one running translation/OAuth proxy instance PER (workspace, provider)
 * so concurrent workspaces that each select a different proxy-based provider
 * (Copilot, Codex, OpenRouter, Sakana, LM Studio, or any user-defined
 * `lane: 'openai'` entry) run fully isolated proxies on distinct ephemeral
 * ports with zero cross-workspace interference.
 *
 * This pool is ADDITIVE and INDEPENDENT of `AuthManager` / the auth strategies.
 * Workspaces WITHOUT an explicit provider override never reach the pool — they
 * keep riding the process-global singleton proxies configured by the strategies
 * (unchanged, no regression). The pool only creates isolated instances for the
 * per-workspace resolver path (`WorkspaceProviderProfileResolver`).
 *
 * Isolation model:
 * - The PORT is isolated (one proxy instance per workspace) so each workspace's
 *   SDK session targets its own `127.0.0.1:<port>`.
 * - The AUTH STATE is SHARED: Copilot/Codex/OpenRouter proxies receive the SAME
 *   injected auth-service singletons the strategies use, so machine-global OAuth
 *   token state (single-flight refresh, file watcher) is never cloned. Sakana is
 *   key-bound at construction (per the workspace-resolved key) via the existing
 *   `createSakanaProxyForKey` factory. LM Studio is keyless. A custom
 *   `lane: 'openai'` entry is ENDPOINT-bound at construction (its base URL is
 *   baked into the proxy) but not key-bound — it reads its Bearer key from
 *   SecretStorage per request, so rotating the key needs no rebuild.
 *
 * Custom entries declared `lane: 'anthropic'` (`requiresProxy: false`) never
 * need a proxy at all: they speak the Anthropic protocol directly, so the
 * resolver builds a direct snapshot for them and never reaches this pool.
 *
 * Lifetime: a proxy lives as long as its workspace is present. There is NO idle
 * TTL — an aggressive TTL could stop a proxy mid-stream. Teardown is driven by
 * {@link disposeForScope} (workspace removed) and {@link disposeAll} (shutdown).
 * A long (>=30 min) request-activity-rearmed safety-net TTL is a deliberate
 * future enhancement, intentionally omitted in this pass.
 */

import { injectable, inject } from 'tsyringe';
import {
  Logger,
  TOKENS,
  ConfigManager,
  type IAuthSecretsService,
} from '@ptah-extension/vscode-core';
import type { AnthropicProvider } from '@ptah-extension/shared';
import { isCustomProviderId } from '@ptah-extension/shared';
import { AUTH_PROVIDERS_TOKENS } from '../di/tokens';
import type { ITranslationProxy } from '../translation';
import {
  CopilotTranslationProxy,
  COPILOT_PROXY_TOKEN_PLACEHOLDER,
  type ICopilotAuthService,
} from '../providers/copilot';
import {
  CodexTranslationProxy,
  CODEX_PROXY_TOKEN_PLACEHOLDER,
  type ICodexAuthService,
} from '../providers/codex';
import {
  OpenRouterTranslationProxy,
  OPENROUTER_PROXY_TOKEN_PLACEHOLDER,
  type IOpenRouterAuthService,
} from '../providers/openrouter';
import {
  createSakanaProxyForKey,
  SAKANA_PROXY_TOKEN_PLACEHOLDER,
} from '../providers/sakana';
import {
  LmStudioTranslationProxy,
  LOCAL_PROXY_TOKEN_PLACEHOLDER,
} from '../providers/local';
import {
  createCustomOpenAiProxy,
  CUSTOM_PROXY_TOKEN_PLACEHOLDER,
} from '../providers/custom';

/** A live per-(workspace, provider) proxy entry. */
interface ProxyPoolEntry {
  /** The running translation/OAuth proxy instance (holds no auth state itself). */
  proxy: ITranslationProxy;
  /** `http://127.0.0.1:<port>` the SDK points `ANTHROPIC_BASE_URL` at. */
  baseUrl: string;
  /** Placeholder token the SDK sends as `ANTHROPIC_AUTH_TOKEN` (proxy-managed). */
  authToken: string;
  /**
   * Credential fingerprint — everything baked into the proxy at CONSTRUCTION,
   * so a change to any of it invalidates and re-creates the instance instead of
   * silently serving the workspace from the previous configuration.
   *
   * - Key-bound providers (Sakana): embeds the resolved key.
   * - Endpoint-bound providers (custom `lane: 'openai'` entries): embeds the
   *   resolved base URL. Without it, re-pointing an entry (editing the entry or
   *   setting/clearing a `provider.<id>.baseUrl` override) would match the
   *   cached fingerprint and keep forwarding this workspace's traffic — and its
   *   API key — to the OLD host.
   * - OAuth/local providers (auth resolved fresh per request from the shared
   *   singleton, endpoint hardcoded): a constant.
   */
  credentialKey: string;
}

/** Result returned to the resolver for a successfully acquired proxy. */
export interface AcquiredProxy {
  baseUrl: string;
  authToken: string;
}

/** Credential fingerprint for providers whose auth is not key-bound at build. */
const CONSTANT_CREDENTIAL_KEY = '__shared_singleton__';

@injectable()
export class ProviderProxyPool {
  /** key = `${workspacePath}::${providerId}` */
  private readonly entries = new Map<string, ProxyPoolEntry>();

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.CONFIG_MANAGER)
    private readonly configManager: ConfigManager,
    @inject(TOKENS.AUTH_SECRETS_SERVICE)
    private readonly authSecrets: IAuthSecretsService,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_COPILOT_AUTH)
    private readonly copilotAuth: ICopilotAuthService,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_CODEX_AUTH)
    private readonly codexAuth: ICodexAuthService,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_OPENROUTER_AUTH)
    private readonly openRouterAuth: IOpenRouterAuthService,
  ) {}

  private key(workspacePath: string, providerId: string): string {
    return `${workspacePath}::${providerId}`;
  }

  /**
   * Acquire a running isolated proxy for `(workspacePath, providerId)`.
   *
   * Returns `{ baseUrl, authToken }` on success, or `undefined` when the caller
   * must fall back to the global auth path (non-proxy provider, unknown proxy
   * provider, required credentials missing, or a custom entry with no usable
   * base URL). Reuses a live entry when the credential fingerprint matches and
   * the proxy is still listening; otherwise (re)creates one and starts it on a
   * fresh ephemeral port.
   */
  async acquire(
    workspacePath: string,
    providerId: string,
    provider: AnthropicProvider,
  ): Promise<AcquiredProxy | undefined> {
    if (provider.requiresProxy !== true) {
      // Not an error and not "unsupported": this provider speaks the Anthropic
      // protocol directly (built-in passthroughs AND custom `lane: 'anthropic'`
      // entries), so there is nothing to isolate here. The resolver only calls
      // us for `requiresProxy: true` and builds a direct snapshot otherwise —
      // silence is deliberate, a warning here would be noise.
      return undefined;
    }

    // Resolve the credential fingerprint up front so a changed Sakana key or a
    // re-pointed custom entry invalidates the cached entry BEFORE we decide to
    // reuse it.
    let sakanaKey: string | undefined;
    let customBaseUrl: string | undefined;
    let credentialKey = CONSTANT_CREDENTIAL_KEY;
    if (providerId === 'sakana') {
      sakanaKey = (await this.authSecrets.getProviderKey('sakana'))?.trim();
      if (!sakanaKey) {
        this.logger.warn(
          '[ProviderProxyPool] Sakana selected for workspace but no API key is stored — declining isolated proxy (workspace falls back to global auth).',
          { workspacePath },
        );
        return undefined;
      }
      credentialKey = `sakana:${sakanaKey}`;
    } else if (isCustomProviderId(providerId)) {
      customBaseUrl = this.resolveCustomProviderBaseUrl(providerId, provider);
      if (!customBaseUrl) {
        this.logger.warn(
          '[ProviderProxyPool] Custom provider selected for workspace but its entry has no base URL — declining isolated proxy (workspace falls back to global auth).',
          { workspacePath, providerId },
        );
        return undefined;
      }
      credentialKey = `custom:${customBaseUrl}`;
    }

    const entryKey = this.key(workspacePath, providerId);
    const existing = this.entries.get(entryKey);
    if (
      existing &&
      existing.credentialKey === credentialKey &&
      existing.proxy.isRunning()
    ) {
      return { baseUrl: existing.baseUrl, authToken: existing.authToken };
    }

    // Stale (credential changed) or dead (proxy stopped) — tear it down first.
    if (existing) {
      await this.stopEntry(entryKey, existing);
    }

    const created = await this.createProxy(
      providerId,
      provider,
      sakanaKey,
      customBaseUrl,
    );
    if (!created) {
      return undefined;
    }

    const { proxy, authToken } = created;
    let baseUrl: string;
    try {
      const started = await proxy.start();
      baseUrl = started.url;
    } catch (error: unknown) {
      this.logger.warn(
        '[ProviderProxyPool] Failed to start isolated proxy — workspace falls back to global auth.',
        {
          workspacePath,
          providerId,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      return undefined;
    }

    this.entries.set(entryKey, { proxy, baseUrl, authToken, credentialKey });
    this.logger.info('[ProviderProxyPool] Started isolated proxy', {
      workspacePath,
      providerId,
      baseUrl,
    });
    return { baseUrl, authToken };
  }

  /**
   * Build (but do not start) a fresh proxy for the provider, reusing the shared
   * auth-service singletons for OAuth/OpenRouter, binding Sakana to the
   * supplied per-workspace key, and binding a custom entry to its resolved base
   * URL. Returns `undefined` for unknown proxy providers.
   */
  private async createProxy(
    providerId: string,
    provider: AnthropicProvider,
    sakanaKey: string | undefined,
    customBaseUrl: string | undefined,
  ): Promise<{ proxy: ITranslationProxy; authToken: string } | undefined> {
    switch (providerId) {
      case 'github-copilot': {
        await this.ensureCopilotReady();
        return {
          proxy: new CopilotTranslationProxy(this.logger, this.copilotAuth),
          authToken: COPILOT_PROXY_TOKEN_PLACEHOLDER,
        };
      }
      case 'openai-codex': {
        await this.ensureCodexReady();
        return {
          proxy: new CodexTranslationProxy(this.logger, this.codexAuth),
          authToken: CODEX_PROXY_TOKEN_PLACEHOLDER,
        };
      }
      case 'openrouter': {
        return {
          proxy: new OpenRouterTranslationProxy(
            this.logger,
            this.openRouterAuth,
          ),
          authToken: OPENROUTER_PROXY_TOKEN_PLACEHOLDER,
        };
      }
      case 'sakana': {
        if (!sakanaKey) {
          // Guarded in acquire(); defensive only.
          return undefined;
        }
        return {
          proxy: createSakanaProxyForKey(sakanaKey, this.logger),
          authToken: SAKANA_PROXY_TOKEN_PLACEHOLDER,
        };
      }
      case 'lm-studio': {
        return {
          proxy: new LmStudioTranslationProxy(this.logger, this.configManager),
          authToken: LOCAL_PROXY_TOKEN_PLACEHOLDER,
        };
      }
      default: {
        // A user-defined `lane: 'openai'` entry — the only proxy-requiring
        // provider without a case above. `isCustomProviderId` is what keeps
        // this branch from ever claiming a built-in id: every built-in with a
        // proxy is matched by an explicit case, and this guard makes that a
        // property of the code rather than of the case list staying complete.
        if (isCustomProviderId(providerId) && customBaseUrl) {
          return this.createCustomProxy(providerId, provider, customBaseUrl);
        }
        this.logger.warn(
          '[ProviderProxyPool] No proxy factory for proxy-requiring provider — declining isolated proxy.',
          { providerId },
        );
        return undefined;
      }
    }
  }

  /**
   * Build an isolated translation proxy for a user-defined OpenAI-lane entry,
   * reusing the same `createCustomOpenAiProxy` factory the global auth path
   * (`ApiKeyStrategy`) uses — one construction site for one proxy shape.
   *
   * No stored-key check here, deliberately, and unlike Sakana: the custom proxy
   * reads its Bearer key from SecretStorage on EVERY request, so a key added or
   * rotated after the proxy starts takes effect without a rebuild, and a
   * missing key surfaces as an actionable `SdkError` naming the entry. Gating
   * on the key instead would decline the proxy and drop the workspace onto the
   * GLOBAL provider — i.e. quietly answer from a different vendor than the one
   * the user picked for this workspace.
   *
   * Construction can still throw (an unparseable or non-http base URL — see
   * `normalizeOpenAiApiRoot`); that is caught here so a malformed entry cannot
   * take down the resolve path.
   */
  private createCustomProxy(
    providerId: string,
    provider: AnthropicProvider,
    baseUrl: string,
  ): { proxy: ITranslationProxy; authToken: string } | undefined {
    try {
      const proxy = createCustomOpenAiProxy({
        provider,
        baseUrl,
        logger: this.logger,
        authSecrets: this.authSecrets,
      });
      return { proxy, authToken: CUSTOM_PROXY_TOKEN_PLACEHOLDER };
    } catch (error: unknown) {
      this.logger.warn(
        '[ProviderProxyPool] Cannot build an isolated translation proxy for custom provider — declining (workspace falls back to global auth).',
        {
          providerId,
          baseUrl,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      return undefined;
    }
  }

  /**
   * The upstream base URL a custom entry's isolated proxy forwards to.
   *
   * Precedence mirrors `ApiKeyStrategy.resolveCustomProviderBaseUrl` exactly: a
   * `provider.<id>.baseUrl` settings override wins, otherwise the entry's OWN
   * `baseUrl`. The fallback is read off the resolved entry and NOT through
   * `getProviderBaseUrl()`, which returns the DEFAULT provider's URL
   * (OpenRouter's) for an id it cannot resolve — for a custom entry that would
   * mean forwarding the user's API key to a vendor they never chose. Reading
   * `provider.baseUrl` cannot mis-resolve; an entry with no usable URL returns
   * `undefined` and declines instead.
   */
  private resolveCustomProviderBaseUrl(
    providerId: string,
    provider: AnthropicProvider,
  ): string | undefined {
    const override = this.configManager.get<string>(
      `provider.${providerId}.baseUrl`,
    );
    if (typeof override === 'string' && override.trim().length > 0) {
      return override.trim();
    }
    const own = provider.baseUrl.trim();
    return own.length > 0 ? own : undefined;
  }

  /**
   * Best-effort Copilot readiness — mirrors the minimum the OAuthProxyStrategy
   * does before use (silent restore of persisted GitHub token) WITHOUT touching
   * the global AuthEnv / `process.env`. Never throws: an unauthenticated proxy
   * simply surfaces a 401 to the SDK until the user connects, at which point the
   * SAME shared singleton is authenticated for every isolated proxy at once.
   */
  private async ensureCopilotReady(): Promise<void> {
    try {
      if (!(await this.copilotAuth.isAuthenticated())) {
        await this.copilotAuth.tryRestoreAuth();
      }
    } catch (error: unknown) {
      this.logger.warn(
        '[ProviderProxyPool] Copilot readiness check failed (proxy will 401 until authenticated).',
        { error: error instanceof Error ? error.message : String(error) },
      );
    }
  }

  /**
   * Best-effort Codex readiness — starts the shared auth-file watcher (so a
   * later `codex login` is detected) and refreshes tokens if possible. Mirrors
   * the minimum `configureCodexOAuth` does WITHOUT writing the global AuthEnv.
   */
  private async ensureCodexReady(): Promise<void> {
    try {
      this.codexAuth.startWatchingAuthFile();
      await this.codexAuth.ensureTokensFresh();
    } catch (error: unknown) {
      this.logger.warn(
        '[ProviderProxyPool] Codex readiness check failed (proxy will 401 until authenticated).',
        { error: error instanceof Error ? error.message : String(error) },
      );
    }
  }

  /**
   * Stop and drop every proxy owned by `workspacePath` (all providers). Called
   * when a workspace folder is removed/closed. Per-entry errors are swallowed —
   * teardown never throws.
   */
  async disposeForScope(workspacePath: string): Promise<void> {
    const prefix = `${workspacePath}::`;
    const keys = [...this.entries.keys()].filter((k) => k.startsWith(prefix));
    for (const entryKey of keys) {
      const entry = this.entries.get(entryKey);
      if (entry) {
        await this.stopEntry(entryKey, entry);
      }
    }
    if (keys.length > 0) {
      this.logger.info(
        '[ProviderProxyPool] Disposed isolated proxies for workspace',
        { workspacePath, count: keys.length },
      );
    }
  }

  /**
   * Stop and drop ALL proxies. Called on adapter/app teardown so no proxy
   * servers leak on reload/exit. Never throws.
   */
  async disposeAll(): Promise<void> {
    const keys = [...this.entries.keys()];
    for (const entryKey of keys) {
      const entry = this.entries.get(entryKey);
      if (entry) {
        await this.stopEntry(entryKey, entry);
      }
    }
    if (keys.length > 0) {
      this.logger.info('[ProviderProxyPool] Disposed all isolated proxies', {
        count: keys.length,
      });
    }
  }

  /**
   * Drop the entry from the map BEFORE stopping so a concurrent {@link acquire}
   * never reuses a proxy that is shutting down, then stop it (best-effort).
   */
  private async stopEntry(
    entryKey: string,
    entry: ProxyPoolEntry,
  ): Promise<void> {
    this.entries.delete(entryKey);
    try {
      if (entry.proxy.isRunning()) {
        await entry.proxy.stop();
      }
    } catch (error: unknown) {
      this.logger.warn(
        '[ProviderProxyPool] Failed to stop isolated proxy (ignored).',
        {
          entryKey,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }
}
