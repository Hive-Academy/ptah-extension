/**
 * Provider Proxy Pool (Phase 3 — per-session isolated proxy providers)
 *
 * Owns one running translation/OAuth proxy instance PER effective provider
 * configuration (provider id + credential fingerprint), shared by every
 * workspace that resolves to that same configuration. Concurrent workspaces
 * that select DIFFERENT proxy-based providers (Copilot, Codex, OpenRouter,
 * Sakana, LM Studio, or any user-defined `lane: 'openai'` entry) run on
 * distinct ephemeral ports; two workspaces on the SAME provider configuration
 * share one proxy instead of each starting its own.
 *
 * This pool is ADDITIVE and INDEPENDENT of `AuthManager` / the auth strategies:
 * a strategy re-configuring the process-wide auth env (and tearing down ITS
 * proxy) never stops a pooled proxy, so a chat session pinned to a pooled
 * proxy survives a workspace switch. Every chat session reaches the pool
 * through `WorkspaceProviderProfileResolver` when its provider needs a proxy.
 *
 * Isolation model:
 * - The PORT is per configuration: everything baked into a proxy at
 *   construction is part of the pool key, so sharing one instance between
 *   workspaces can never serve a workspace from a configuration it did not
 *   resolve to. Credentials and endpoint overrides are machine-wide (secret
 *   storage, `provider.<id>.baseUrl`), so workspaces on one provider resolve
 *   to the same configuration.
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
 * Lifetime: a proxy lives as long as at least one workspace HOLDS it, either
 * bound (its sessions resolve to it) or retired (see below). There is NO idle
 * TTL — an aggressive TTL could stop a proxy mid-stream. The proxy stops when
 * its last holder is released by {@link disposeForScope} (workspace removed),
 * or on {@link disposeAll} (shutdown).
 *
 * Credential rotation: when a workspace acquires a newer fingerprint of a
 * provider, its previous entry is RETIRED for that workspace instead of being
 * stopped, because a session started before the rotation may still be
 * streaming through the old proxy URL. A retired entry is never handed to a
 * new acquire. The pool has no per-session hook, so the trade-off is bounded
 * rather than exact: each (workspace, provider) keeps at most ONE retired
 * generation — a further rotation releases the older one (stopping it once no
 * workspace holds it), so a session older than two rotations can still lose
 * its proxy, and a retired proxy outlives its last session until the
 * workspace is disposed.
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
import {
  isCustomProviderId,
  isOpenCodeProviderId,
} from '@ptah-extension/shared';
import {
  createOpenCodeProxyForKey,
  OPENCODE_PROXY_TOKEN_PLACEHOLDER,
} from '../providers/opencode';
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
import type { ICodexOwnerKeySource } from '../providers/codex/codex-provider.types';
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

/** A live per-(provider, credential fingerprint) proxy entry. */
interface ProxyPoolEntry {
  /** Pool key (`${providerId}::${credentialKey}`) the entry was started under. */
  key: string;
  providerId: string;
  /** Workspaces whose sessions currently resolve to this proxy. */
  scopes: Set<string>;
  /**
   * Workspaces that moved to a newer fingerprint of this provider but may still
   * have a session streaming through this proxy. Keeps the proxy alive; never
   * makes it reusable.
   */
  retiredFor: Set<string>;
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

/** What {@link ProviderProxyPool} needs to build and start one entry. */
interface EntrySpec {
  /** The workspace whose acquire started the entry (logging only). */
  workspacePath: string;
  providerId: string;
  provider: AnthropicProvider;
  keyBoundApiKey: string | undefined;
  customBaseUrl: string | undefined;
  credentialKey: string;
}

/** Credential fingerprint for providers whose auth is not key-bound at build. */
const CONSTANT_CREDENTIAL_KEY = '__shared_singleton__';

@injectable()
export class ProviderProxyPool {
  /** key = `${providerId}::${credentialKey}` */
  private readonly entries = new Map<string, ProxyPoolEntry>();

  /**
   * Starts in flight, by entry key, so two workspaces acquiring the same
   * configuration at once share one start instead of each binding a port.
   */
  private readonly starting = new Map<
    string,
    Promise<ProxyPoolEntry | undefined>
  >();

  /**
   * Entries no workspace is bound to any more but at least one still holds as
   * its retired generation. Out of {@link entries}, so never reused.
   */
  private readonly retired = new Set<ProxyPoolEntry>();

  /**
   * Disposal counters an in-flight {@link acquire} captures before its awaits
   * and compares after them, so a workspace (or the pool) disposed meanwhile is
   * never bound. One counter per disposed workspace path, plus one pool-wide.
   */
  private readonly scopeEpochs = new Map<string, number>();
  private poolEpoch = 0;

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
    @inject(AUTH_PROVIDERS_TOKENS.SDK_CODEX_ACCOUNT_USAGE)
    private readonly codexOwnerKeys: ICodexOwnerKeySource,
  ) {}

  private key(providerId: string, credentialKey: string): string {
    return `${providerId}::${credentialKey}`;
  }

  /**
   * Acquire a running proxy for `providerId` on behalf of `workspacePath`.
   *
   * Returns `{ baseUrl, authToken }` on success, or `undefined` when no proxy
   * can be provided (non-proxy provider, unknown proxy provider, required
   * credentials missing, a custom entry with no usable base URL, or a start
   * failure). Reuses the live entry for the same provider + credential
   * fingerprint — whichever workspace started it — and binds the workspace to
   * it; otherwise creates one and starts it on a fresh ephemeral port. A
   * workspace bound to an older fingerprint of the same provider is moved to
   * the new entry and the old one is retired for it (see the class doc).
   *
   * Also returns `undefined` when the workspace — or the whole pool — was
   * disposed while this call awaited a key lookup or a proxy start: the closed
   * workspace is not bound, and a proxy nobody holds is stopped.
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

    const scopeEpoch = this.scopeEpochs.get(workspacePath) ?? 0;
    const poolEpoch = this.poolEpoch;

    // Resolve the credential fingerprint up front so a changed Sakana key or a
    // re-pointed custom entry invalidates the cached entry BEFORE we decide to
    // reuse it.
    let keyBoundApiKey: string | undefined;
    let customBaseUrl: string | undefined;
    let credentialKey = CONSTANT_CREDENTIAL_KEY;
    if (providerId === 'sakana' || isOpenCodeProviderId(providerId)) {
      keyBoundApiKey = (
        await this.authSecrets.getProviderKey(providerId)
      )?.trim();
      if (!keyBoundApiKey) {
        this.logger.warn(
          `[ProviderProxyPool] ${provider.name} selected for workspace but no API key is stored - declining isolated proxy (workspace falls back to global auth).`,
          { workspacePath },
        );
        return undefined;
      }
      credentialKey = `${providerId}:${keyBoundApiKey}`;
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

    const entryKey = this.key(providerId, credentialKey);
    let entry = this.entries.get(entryKey);
    if (entry && !entry.proxy.isRunning()) {
      // Dead (proxy stopped) — drop it and start a fresh one.
      await this.stopEntry(entry);
      entry = undefined;
    }
    entry ??= await this.startEntry(entryKey, {
      workspacePath,
      providerId,
      provider,
      keyBoundApiKey,
      customBaseUrl,
      credentialKey,
    });
    if (!entry) {
      return undefined;
    }

    if (this.disposedSince(workspacePath, scopeEpoch, poolEpoch)) {
      // Binding now would resurrect a closed workspace and leak the proxy.
      this.logger.info(
        '[ProviderProxyPool] Workspace disposed while acquiring — isolated proxy not bound.',
        { workspacePath, providerId },
      );
      await this.stopIfUnheld(entry);
      return undefined;
    }
    if (this.entries.get(entryKey) !== entry) {
      // Another workspace sharing this start was disposed during it and
      // stopped the entry before we could bind — start a fresh one.
      return this.acquire(workspacePath, providerId, provider);
    }

    await this.bindScope(workspacePath, entry);
    if (
      this.disposedSince(workspacePath, scopeEpoch, poolEpoch) ||
      !entry.scopes.has(workspacePath)
    ) {
      // Disposed while bindScope released an older retired generation: the
      // dispose already unbound and stopped this entry.
      return undefined;
    }
    return { baseUrl: entry.baseUrl, authToken: entry.authToken };
  }

  /** Whether `workspacePath` or the whole pool was disposed since the epochs were read. */
  private disposedSince(
    workspacePath: string,
    scopeEpoch: number,
    poolEpoch: number,
  ): boolean {
    return (
      this.poolEpoch !== poolEpoch ||
      (this.scopeEpochs.get(workspacePath) ?? 0) !== scopeEpoch
    );
  }

  /** Single-flight wrapper around {@link createAndStartEntry}. */
  private startEntry(
    entryKey: string,
    spec: EntrySpec,
  ): Promise<ProxyPoolEntry | undefined> {
    const pending = this.starting.get(entryKey);
    if (pending !== undefined) {
      return pending;
    }
    const started = this.createAndStartEntry(entryKey, spec).finally(() => {
      this.starting.delete(entryKey);
    });
    this.starting.set(entryKey, started);
    return started;
  }

  private async createAndStartEntry(
    entryKey: string,
    spec: EntrySpec,
  ): Promise<ProxyPoolEntry | undefined> {
    const { workspacePath, providerId, provider, credentialKey } = spec;
    const created = await this.createProxy(
      providerId,
      provider,
      spec.keyBoundApiKey,
      spec.customBaseUrl,
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
        '[ProviderProxyPool] Failed to start isolated proxy — no pooled proxy for this provider.',
        {
          workspacePath,
          providerId,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      // A start can fail after binding its port; release whatever it holds.
      try {
        await proxy.stop();
      } catch (stopError: unknown) {
        this.logger.warn(
          '[ProviderProxyPool] Failed to clean up isolated proxy after a failed start (ignored).',
          {
            workspacePath,
            providerId,
            error:
              stopError instanceof Error
                ? stopError.message
                : String(stopError),
          },
        );
      }
      return undefined;
    }

    const entry: ProxyPoolEntry = {
      key: entryKey,
      providerId,
      scopes: new Set<string>(),
      retiredFor: new Set<string>(),
      proxy,
      baseUrl,
      authToken,
      credentialKey,
    };
    this.entries.set(entryKey, entry);
    this.logger.info('[ProviderProxyPool] Started isolated proxy', {
      workspacePath,
      providerId,
      baseUrl,
    });
    return entry;
  }

  /**
   * Bind `workspacePath` to `entry`. The entry it was bound to for the same
   * provider (an older credential fingerprint) is retired for it rather than
   * stopped, so a session still streaming through that proxy survives; the
   * generation retired before that is released, keeping at most one retired
   * entry per (workspace, provider). A released entry nobody holds is stopped.
   */
  private async bindScope(
    workspacePath: string,
    entry: ProxyPoolEntry,
  ): Promise<void> {
    entry.scopes.add(workspacePath);
    entry.retiredFor.delete(workspacePath);
    const sameProvider = this.liveEntries().filter(
      (other) => other !== entry && other.providerId === entry.providerId,
    );
    // At most one: a workspace is bound to a single entry per provider.
    const superseded = sameProvider.filter((other) =>
      other.scopes.has(workspacePath),
    );
    if (superseded.length === 0) {
      return;
    }

    const olderRetired = sameProvider.filter((other) =>
      other.retiredFor.has(workspacePath),
    );
    for (const other of olderRetired) {
      other.retiredFor.delete(workspacePath);
      await this.stopIfUnheld(other);
    }
    for (const other of superseded) {
      other.scopes.delete(workspacePath);
      other.retiredFor.add(workspacePath);
      this.retireIfUnbound(other);
    }
  }

  /** Every running entry: reusable ones plus retired ones. */
  private liveEntries(): ProxyPoolEntry[] {
    return [...this.entries.values(), ...this.retired];
  }

  /**
   * Move an entry no workspace is bound to (but some still hold as retired)
   * out of {@link entries}, so no new acquire reuses it.
   */
  private retireIfUnbound(entry: ProxyPoolEntry): void {
    if (entry.scopes.size > 0 || entry.retiredFor.size === 0) {
      return;
    }
    if (this.entries.get(entry.key) === entry) {
      this.entries.delete(entry.key);
    }
    this.retired.add(entry);
  }

  /** Stop `entry` when no workspace holds it, bound or retired. */
  private async stopIfUnheld(entry: ProxyPoolEntry): Promise<void> {
    if (entry.scopes.size === 0 && entry.retiredFor.size === 0) {
      await this.stopEntry(entry);
    }
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
    keyBoundApiKey: string | undefined,
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
          proxy: new CodexTranslationProxy(
            this.logger,
            this.codexAuth,
            this.codexOwnerKeys,
          ),
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
      case 'opencode-zen':
      case 'opencode-go': {
        if (!keyBoundApiKey) return undefined;
        return {
          proxy: createOpenCodeProxyForKey(
            providerId,
            keyBoundApiKey,
            this.logger,
          ),
          authToken: OPENCODE_PROXY_TOKEN_PLACEHOLDER,
        };
      }
      case 'sakana': {
        if (!keyBoundApiKey) {
          // Guarded in acquire(); defensive only.
          return undefined;
        }
        return {
          proxy: createSakanaProxyForKey(keyBoundApiKey, this.logger),
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
   * Release `workspacePath` from every proxy (all providers), bound or
   * retired, and stop each proxy no other workspace holds. Called when a
   * workspace folder is removed/closed; an acquire for it still in flight will
   * not bind it. Per-entry errors are swallowed — teardown never throws.
   */
  async disposeForScope(workspacePath: string): Promise<void> {
    this.scopeEpochs.set(
      workspacePath,
      (this.scopeEpochs.get(workspacePath) ?? 0) + 1,
    );
    const held = this.liveEntries().filter(
      (entry) =>
        entry.scopes.has(workspacePath) || entry.retiredFor.has(workspacePath),
    );
    let stopped = 0;
    for (const entry of held) {
      entry.scopes.delete(workspacePath);
      entry.retiredFor.delete(workspacePath);
      if (entry.scopes.size === 0 && entry.retiredFor.size === 0) {
        await this.stopEntry(entry);
        stopped += 1;
      } else {
        this.retireIfUnbound(entry);
      }
    }
    if (held.length > 0) {
      this.logger.info(
        '[ProviderProxyPool] Released isolated proxies for workspace',
        { workspacePath, released: held.length, stopped },
      );
    }
  }

  /**
   * Stop and drop ALL proxies, retired ones included. Called on adapter/app
   * teardown so no proxy servers leak on reload/exit; an acquire still in
   * flight will not bind. Never throws.
   */
  async disposeAll(): Promise<void> {
    this.poolEpoch += 1;
    const all = this.liveEntries();
    for (const entry of all) {
      await this.stopEntry(entry);
    }
    if (all.length > 0) {
      this.logger.info('[ProviderProxyPool] Disposed all isolated proxies', {
        count: all.length,
      });
    }
  }

  /**
   * Drop the entry from the pool BEFORE stopping so a concurrent
   * {@link acquire} never reuses a proxy that is shutting down, then stop it
   * (best-effort). The key is only cleared while it still maps to THIS entry —
   * a retired entry shares its key with any newer entry for the same
   * configuration.
   */
  private async stopEntry(entry: ProxyPoolEntry): Promise<void> {
    const entryKey = entry.key;
    if (this.entries.get(entryKey) === entry) {
      this.entries.delete(entryKey);
    }
    this.retired.delete(entry);
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
