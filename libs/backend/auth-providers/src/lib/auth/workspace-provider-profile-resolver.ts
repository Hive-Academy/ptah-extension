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
  createEmptyAuthEnv,
  getAnthropicProvider,
  getProviderBaseUrl,
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
   * Cloud, Moonshot, Z.AI. Fully isolatable.
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
          snapshot.ANTHROPIC_BASE_URL = getProviderBaseUrl(providerId);
          snapshot.ANTHROPIC_AUTH_TOKEN = OLLAMA_AUTH_TOKEN_PLACEHOLDER;
        }
      } else {
        snapshot.ANTHROPIC_BASE_URL =
          customUrl || getProviderBaseUrl(providerId);
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
    const baseUrl = customUrl || getProviderBaseUrl(providerId);
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
   * Apply the provider's persisted main-agent tier mappings (falling back to the
   * registry defaults) to the snapshot's `ANTHROPIC_DEFAULT_*_MODEL` vars —
   * without touching the global AuthEnv or `process.env`.
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
    const sonnet = persisted.sonnet ?? defaults?.sonnet;
    const opus = persisted.opus ?? defaults?.opus;
    const haiku = persisted.haiku ?? defaults?.haiku;
    if (sonnet) snapshot.ANTHROPIC_DEFAULT_SONNET_MODEL = sonnet;
    if (opus) snapshot.ANTHROPIC_DEFAULT_OPUS_MODEL = opus;
    if (haiku) snapshot.ANTHROPIC_DEFAULT_HAIKU_MODEL = haiku;
  }

  /**
   * Resolve the requested model against the SNAPSHOT env (not the global one) so
   * a tier alias / 'default' maps to the workspace provider's model, then fall
   * back to a concrete tier/static id if the alias survives (direct-Anthropic
   * keeps 'default', which is a valid SDK sentinel).
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
        provider?.defaultTiers?.opus ||
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
