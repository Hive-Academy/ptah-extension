/**
 * Workspace Provider Profile Resolver
 *
 * Resolves a per-workspace {@link ProviderProfile} for the INTERACTIVE chat path
 * so concurrent workspaces can run against different AI providers without the
 * process-global auth env (which reflects only the last-configured provider)
 * cross-contaminating sessions.
 *
 * Auth is already PERSISTED per-workspace (path-hashed settings); the defect this
 * fixes is that the RUNTIME application of that auth is global. Rather than
 * rewrite the AuthEnv singleton into a keyed map (Phase 3), this builds an
 * ISOLATED `authEnv` snapshot for the workspace's provider and hands it to
 * `SdkAgentAdapter.startChatSession({ providerProfile })` — mirroring how
 * `PtahCliRegistry.getProfile()` isolates per-agent auth for the CLI path.
 *
 * Correctness scope:
 * - Non-proxy providers (direct Anthropic, Ollama / Ollama Cloud, Moonshot,
 *   Z.AI, and other api-key passthroughs) get a fully isolated snapshot — these
 *   work concurrently across workspaces after this change.
 * - Proxy-based providers (Copilot/Codex OAuth proxies, OpenRouter/Sakana/LM
 *   Studio translation proxies) require a running local proxy. Phase 3: this
 *   resolver now acquires a per-workspace ISOLATED proxy from
 *   {@link ProviderProxyPool} (a dedicated instance on its own ephemeral port),
 *   so concurrent workspaces run different proxy providers with zero
 *   cross-workspace interference. It still returns `undefined` (global-auth
 *   fallback) when no isolated proxy can be acquired (missing credentials,
 *   unknown provider, or start failure) rather than emit a broken proxy env.
 */

import { injectable, inject } from 'tsyringe';
import {
  Logger,
  TOKENS,
  ConfigManager,
  type IAuthSecretsService,
} from '@ptah-extension/vscode-core';
import {
  type AuthEnv,
  type ProviderProfile,
  type AnthropicProvider,
  type ProviderModelTier,
  createEmptyAuthEnv,
  getAnthropicProvider,
  getProviderAuthEnvVar,
  OLLAMA_CLOUD_DIRECT_BASE_URL,
  ANTHROPIC_DIRECT_PROVIDER_ID,
} from '@ptah-extension/shared';
import {
  SETTINGS_TOKENS,
  type WorkspaceScopeResolver,
} from '@ptah-extension/settings-core';
import { AUTH_PROVIDERS_TOKENS } from '../di/tokens';
import type { ProviderModelsService } from '../provider-models.service';
import type { DerivedTierMap } from '../model-tier-derivation';
import { ActiveProviderResolver } from './active-provider-resolver';
import type { ModelResolver } from './model-resolver';
import type { ProviderProxyPool } from './provider-proxy-pool';
import { OLLAMA_AUTH_TOKEN_PLACEHOLDER } from '../providers/local';

@injectable()
export class WorkspaceProviderProfileResolver {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.CONFIG_MANAGER) private readonly config: ConfigManager,
    @inject(TOKENS.AUTH_SECRETS_SERVICE)
    private readonly authSecrets: IAuthSecretsService,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_PROVIDER_MODELS)
    private readonly providerModels: ProviderModelsService,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_MODEL_RESOLVER)
    private readonly modelResolver: ModelResolver,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_ACTIVE_PROVIDER_RESOLVER)
    private readonly activeProviderResolver: ActiveProviderResolver,
    @inject(SETTINGS_TOKENS.WORKSPACE_SCOPE_RESOLVER)
    private readonly scope: WorkspaceScopeResolver,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_PROVIDER_PROXY_POOL)
    private readonly proxyPool: ProviderProxyPool,
  ) {}

  /**
   * Resolve the isolated provider profile for a workspace's interactive chat.
   *
   * Returns `undefined` (→ caller keeps the process-global auth behavior, no
   * regression for single-provider users) when:
   * - `workspacePath` is empty, or
   * - the workspace has NO explicit per-workspace provider override, or
   * - the resolved provider is unknown, its credentials are missing, or it is a
   *   proxy provider that does not match the global active provider.
   */
  async resolveProviderProfileForWorkspace(
    workspacePath: string,
    requestedModel: string,
  ): Promise<ProviderProfile | undefined> {
    if (!workspacePath || workspacePath.trim() === '') {
      return undefined;
    }

    // Only take over the auth env when the workspace has EXPLICITLY chosen a
    // provider/auth method (workspace- or app-scoped override). Otherwise the
    // workspace uses the global default and must keep today's behavior.
    const hasExplicit =
      this.scope.hasOverrideForPath(
        'anthropicProviderId',
        workspacePath,
        true,
      ) || this.scope.hasOverrideForPath('authMethod', workspacePath, true);
    if (!hasExplicit) {
      return undefined;
    }

    const { authMethod, providerId } =
      this.activeProviderResolver.resolveActiveAuthForPath(workspacePath);

    try {
      if (authMethod === 'claudeCli') {
        return this.buildNativeAnthropicProfile(requestedModel);
      }
      if (authMethod === 'apiKey') {
        return await this.buildDirectApiKeyProfile(requestedModel);
      }

      const provider = getAnthropicProvider(providerId);
      if (!provider) {
        this.logger.warn(
          '[WorkspaceProviderProfileResolver] Unknown per-workspace provider — falling back to global auth',
          { providerId, workspacePath },
        );
        return undefined;
      }

      if (provider.requiresProxy === true) {
        return await this.buildProxyProviderProfile(
          providerId,
          provider,
          requestedModel,
          workspacePath,
        );
      }

      return await this.buildDirectThirdPartyProfile(
        providerId,
        provider,
        requestedModel,
      );
    } catch (error: unknown) {
      this.logger.warn(
        '[WorkspaceProviderProfileResolver] Failed to resolve per-workspace provider profile — falling back to global auth',
        {
          providerId,
          workspacePath,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      return undefined;
    }
  }

  /**
   * Direct Anthropic via the local Claude CLI login (`~/.claude`). The snapshot
   * explicitly EMPTIES base URL + tokens so it overrides any global proxy env
   * when merged over `process.env`, letting the SDK resolve the native login.
   */
  private buildNativeAnthropicProfile(requestedModel: string): ProviderProfile {
    const snapshot = createEmptyAuthEnv();
    snapshot.ANTHROPIC_API_KEY = '';
    snapshot.ANTHROPIC_AUTH_TOKEN = '';
    snapshot.ANTHROPIC_BASE_URL = '';
    const model = this.resolveModel(requestedModel, snapshot, undefined);
    return {
      providerId: ANTHROPIC_DIRECT_PROVIDER_ID,
      authEnv: snapshot,
      model,
    };
  }

  /** Direct Anthropic via a stored API key (pay-per-token). */
  private async buildDirectApiKeyProfile(
    requestedModel: string,
  ): Promise<ProviderProfile | undefined> {
    const apiKey = (await this.authSecrets.getCredential('apiKey'))?.trim();
    if (!apiKey) {
      this.logger.warn(
        '[WorkspaceProviderProfileResolver] Workspace requests direct Anthropic API key but none is stored — falling back to global auth',
      );
      return undefined;
    }
    const snapshot = createEmptyAuthEnv();
    snapshot.ANTHROPIC_API_KEY = apiKey;
    snapshot.ANTHROPIC_AUTH_TOKEN = '';
    snapshot.ANTHROPIC_BASE_URL = '';
    const model = this.resolveModel(requestedModel, snapshot, undefined);
    return {
      providerId: ANTHROPIC_DIRECT_PROVIDER_ID,
      authEnv: snapshot,
      model,
    };
  }

  /**
   * Anthropic-native and api-key-passthrough third-party providers that speak
   * the Anthropic protocol directly (no local translation proxy): Ollama, Ollama
   * Cloud, Moonshot, Z.AI, and user-defined `lane: 'anthropic'` entries. Fully
   * isolatable — these need no proxy at all, which is why they never reach
   * {@link ProviderProxyPool}.
   *
   * The registry default comes off the ALREADY-RESOLVED `provider` rather than
   * from `getProviderBaseUrl(providerId)`. For built-ins the two are the same
   * value, but `getProviderBaseUrl` falls back to the DEFAULT provider's URL
   * (OpenRouter's) for an id it cannot resolve — for a user-defined entry that
   * would forward the user's API key to a vendor they never chose. Reading
   * `provider.baseUrl` cannot mis-resolve.
   */
  private async buildDirectThirdPartyProfile(
    providerId: string,
    provider: AnthropicProvider,
    requestedModel: string,
  ): Promise<ProviderProfile | undefined> {
    const snapshot = createEmptyAuthEnv();
    const customUrl = this.config
      .get<string>(`provider.${providerId}.baseUrl`)
      ?.trim();

    if (provider.authType === 'none') {
      // Ollama / Ollama Cloud (local-native). Cloud with a stored key goes
      // direct to ollama.com; otherwise the local daemon (placeholder token).
      if (providerId === 'ollama-cloud' && !customUrl) {
        const cloudKey = (
          await this.authSecrets.getProviderKey('ollama-cloud')
        )?.trim();
        if (cloudKey) {
          snapshot.ANTHROPIC_BASE_URL = OLLAMA_CLOUD_DIRECT_BASE_URL;
          snapshot.ANTHROPIC_AUTH_TOKEN = cloudKey;
        } else {
          snapshot.ANTHROPIC_BASE_URL = provider.baseUrl;
          snapshot.ANTHROPIC_AUTH_TOKEN = OLLAMA_AUTH_TOKEN_PLACEHOLDER;
        }
      } else {
        snapshot.ANTHROPIC_BASE_URL = customUrl || provider.baseUrl;
        snapshot.ANTHROPIC_AUTH_TOKEN = OLLAMA_AUTH_TOKEN_PLACEHOLDER;
      }
      snapshot.ANTHROPIC_API_KEY = '';
      this.applyProviderTiers(snapshot, providerId, provider);
      const model = this.resolveModel(requestedModel, snapshot, provider);
      return {
        providerId,
        authEnv: snapshot,
        model,
        baseUrl: snapshot.ANTHROPIC_BASE_URL,
      };
    }

    // api-key passthrough (Moonshot, Z.AI): direct base URL + per-provider key.
    const providerKey = (
      await this.authSecrets.getProviderKey(providerId)
    )?.trim();
    if (!providerKey) {
      this.logger.warn(
        '[WorkspaceProviderProfileResolver] No API key stored for per-workspace provider — falling back to global auth',
        { providerId },
      );
      return undefined;
    }
    const baseUrl = customUrl || provider.baseUrl;
    const authEnvVar = getProviderAuthEnvVar(providerId);
    snapshot.ANTHROPIC_API_KEY = '';
    snapshot.ANTHROPIC_BASE_URL = baseUrl;
    snapshot[authEnvVar as keyof AuthEnv] = providerKey;
    this.applyProviderTiers(snapshot, providerId, provider);
    const model = this.resolveModel(requestedModel, snapshot, provider);
    return { providerId, authEnv: snapshot, model, baseUrl };
  }

  /**
   * Proxy-based providers (Copilot/Codex OAuth proxies; OpenRouter/Sakana/LM
   * Studio translation proxies). Phase 3: acquire a per-workspace ISOLATED proxy
   * from {@link ProviderProxyPool} — a dedicated instance on its own ephemeral
   * port, so workspace A and workspace B can run different proxy providers (or
   * the same provider with different keys) concurrently without interference.
   *
   * The pool shares the OAuth/OpenRouter auth-service singletons (isolating the
   * PORT, not the machine-global credential state) and key-binds Sakana to the
   * workspace-resolved key. On `undefined` (non-proxy, unknown proxy provider,
   * missing credentials, or start failure) we keep the prior fallback: return
   * `undefined` so the workspace rides the process-global auth path (no
   * regression, no broken proxy env).
   */
  private async buildProxyProviderProfile(
    providerId: string,
    provider: AnthropicProvider,
    requestedModel: string,
    workspacePath: string,
  ): Promise<ProviderProfile | undefined> {
    const acquired = await this.proxyPool.acquire(
      workspacePath,
      providerId,
      provider,
    );
    if (!acquired) {
      this.logger.warn(
        '[WorkspaceProviderProfileResolver] No isolated proxy acquired for proxy provider — falling back to global auth for this workspace.',
        { providerId, workspacePath },
      );
      return undefined;
    }

    // Build an ISOLATED auth env snapshot pinned to this workspace's proxy —
    // never touching the global AuthEnv or process.env.
    const snapshot: AuthEnv = createEmptyAuthEnv();
    snapshot.ANTHROPIC_BASE_URL = acquired.baseUrl;
    snapshot.ANTHROPIC_AUTH_TOKEN = acquired.authToken;
    snapshot.ANTHROPIC_API_KEY = '';
    this.applyProviderTiers(snapshot, providerId, provider);
    const model = this.resolveModel(requestedModel, snapshot, provider);

    this.logger.info(
      '[WorkspaceProviderProfileResolver] Pinned workspace session to isolated proxy',
      { providerId, workspacePath, baseUrl: acquired.baseUrl },
    );
    return {
      providerId,
      authEnv: snapshot,
      model,
      baseUrl: acquired.baseUrl,
    };
  }

  /**
   * Apply the provider's tier mapping to the snapshot's
   * `ANTHROPIC_DEFAULT_*_MODEL` vars — without touching the global AuthEnv or
   * `process.env`.
   *
   * ## Precedence: user tier → registry `defaultTiers` → live catalogue
   *
   * Exactly the chain `ProviderModelsService.applyPersistedTiers` applies to
   * the global env, and deliberately the same ORDER: a tier the user picked and
   * a tier map the registry actually verified both outrank a heuristic over a
   * live model list, which is consulted only for a hole the two of them left.
   *
   * The third link is TASK_2026_262. This method had its own copy of the first
   * two links, so the fix that closed the foreground chat path did not reach
   * here: a workspace pinned to `openrouter`, `lm-studio` or `requesty` wrote
   * nothing into its snapshot, `resolveModel` then found nothing to resolve
   * `'default'` through, and the bare word `'opus'` went to an endpoint that
   * cannot serve it. The derivation is REUSED rather than re-implemented
   * ({@link ProviderModelsService.getLiveDerivedTiers}); a second copy of the
   * rule would be a second thing to get wrong, and the three sites that write
   * these three env var names must agree on what a tier means.
   *
   * ## No out-of-band refresh here, on purpose
   *
   * `applyPersistedTiers` ends by firing an async catalogue fetch when a tier
   * is still unresolved. This method deliberately does not, for three reasons
   * that compound:
   *
   *  1. **That refresh re-applies tiers into the GLOBAL env.** Calling it from
   *     here would let a per-workspace profile repoint the process-global
   *     `authEnv` — for a provider that is very likely NOT the globally active
   *     one — which is the exact cross-workspace contamination this class was
   *     written to prevent.
   *  2. **It could not help this session anyway.** The snapshot is built
   *     synchronously and handed straight to `startChatSession`; a catalogue
   *     that lands a round trip later cannot retro-fill an object already
   *     passed on.
   *  3. **The warm is inherited.** Reaching any of the three call sites
   *     requires stored credentials for that provider, and storing them ran a
   *     strategy `configure` → `switchActiveProvider` → `applyPersistedTiers`,
   *     which already fired the refresh and persisted the catalogue to
   *     `provider.<id>.modelCatalog`. So by the time a workspace can pin a
   *     provider, the synchronous read below normally finds a catalogue.
   *
   * The residual is the same one Batch 1 measured, not a new one: if that
   * earlier fetch failed (offline at configure time), this snapshot derives
   * nothing and `resolveModel`'s backstop takes over. Retried on the next
   * activation, never on a timer.
   */
  private applyProviderTiers(
    snapshot: AuthEnv,
    providerId: string,
    provider: AnthropicProvider,
  ): void {
    const persisted = this.providerModels.getModelTiers(
      providerId,
      'mainAgent',
    );
    const defaults = provider.defaultTiers;

    // Lazy: a provider whose static data covers all three tiers never reads a
    // catalogue at all.
    let derived: DerivedTierMap | undefined;
    const derivedFor = (tier: ProviderModelTier): string | undefined => {
      derived ??= this.providerModels.getLiveDerivedTiers(providerId);
      return derived[tier];
    };

    const sonnet = persisted.sonnet ?? defaults?.sonnet ?? derivedFor('sonnet');
    const opus = persisted.opus ?? defaults?.opus ?? derivedFor('opus');
    const haiku = persisted.haiku ?? defaults?.haiku ?? derivedFor('haiku');
    if (sonnet) snapshot.ANTHROPIC_DEFAULT_SONNET_MODEL = sonnet;
    if (opus) snapshot.ANTHROPIC_DEFAULT_OPUS_MODEL = opus;
    if (haiku) snapshot.ANTHROPIC_DEFAULT_HAIKU_MODEL = haiku;
  }

  /**
   * Resolve the requested model against the SNAPSHOT env (not the global one) so
   * a tier alias / 'default' maps to the workspace provider's model, then fall
   * back to a concrete static id if the alias survives (direct-Anthropic keeps
   * 'default', which is a valid SDK sentinel).
   *
   * ## The post-fallback ladder NARROWS; it does not go away
   *
   * TASK_2026_262 gave {@link applyProviderTiers} a third link, so the snapshot
   * now carries tier values for the providers that previously left it empty and
   * `modelResolver.resolve` maps the alias itself. This ladder is therefore
   * reached far less often — but it is reached, so it stays. What it does NOT
   * keep is a rung that can never decide:
   *
   *  - `provider?.defaultTiers?.opus` is **removed**. It was already
   *    unreachable, before this change and after it. Every call site that
   *    passes a defined `provider` runs `applyProviderTiers` with that same
   *    `provider` first, and that method writes
   *    `persisted ?? defaults ?? derived` into the snapshot — so the three
   *    snapshot rungs above are falsy only when `defaults.opus` is falsy too.
   *    A rung that fires exactly when its own value is empty is noise, and
   *    worse, it implies the snapshot might NOT already include `defaultTiers`,
   *    which is the one thing a reader must not conclude here. The subsumption
   *    is pinned by a spec rather than left to this paragraph.
   *  - `provider?.staticModels?.[0]?.id` **stays**, and is now the only real
   *    backstop. It is not subsumed: the tier derivation reads the provider's
   *    LIVE catalogue and deliberately refuses `staticModels` (a repo literal
   *    frozen at release time), so an entry carrying static models but no
   *    `defaultTiers` and no fetched catalogue reaches this rung with nothing
   *    above it having fired. No registry entry is shaped that way TODAY — the
   *    only two with `staticModels` also declare `defaultTiers` — but that is a
   *    fact about the data, which the next entry can change, whereas the rung
   *    removed above is dead by construction whatever the registry contains.
   *    Delete only what cannot fire; keep what merely does not.
   *  - `model` stays as the terminal. Sending the tier word verbatim is the
   *    residual TASK_2026_262 Q2 decided NOT to convert into a failure channel:
   *    this method has no error route, and a profile that refused to build
   *    would take the workspace's chat down rather than let the endpoint say
   *    what is wrong.
   */
  private resolveModel(
    requestedModel: string,
    snapshot: AuthEnv,
    provider: AnthropicProvider | undefined,
  ): string {
    const requested = requestedModel?.trim() || 'default';
    let model = this.modelResolver.resolve(requested, snapshot);
    if (this.isTierAliasOrDefault(model)) {
      model =
        snapshot.ANTHROPIC_DEFAULT_OPUS_MODEL ||
        snapshot.ANTHROPIC_DEFAULT_SONNET_MODEL ||
        snapshot.ANTHROPIC_DEFAULT_HAIKU_MODEL ||
        provider?.staticModels?.[0]?.id ||
        model;
    }
    return model;
  }

  private isTierAliasOrDefault(model: string): boolean {
    const lower = model.toLowerCase();
    return (
      lower === 'default' ||
      lower === 'opus' ||
      lower === 'sonnet' ||
      lower === 'haiku'
    );
  }
}
