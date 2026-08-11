import { inject, injectable } from 'tsyringe';
import {
  Logger,
  ConfigManager,
  TOKENS,
  type IAuthSecretsService,
} from '@ptah-extension/vscode-core';
import { ALL_TIER_ENV_KEYS } from '@ptah-extension/agent-sdk';
import type { OneShotAuthOverride } from '@ptah-extension/agent-sdk';
import type { ICuratorAuthResolver } from '@ptah-extension/agent-sdk';
import type { AuthEnv } from '@ptah-extension/shared';
import {
  ANTHROPIC_DIRECT_PROVIDER_ID,
  getAnthropicProvider,
  getProviderAuthEnvVar,
  getProviderBaseUrl,
  resolveStrategy,
} from '@ptah-extension/shared';
import { AUTH_PROVIDERS_TOKENS } from '../di/tokens';
import type { ProviderModelsService } from '../provider-models.service';
import { CuratorProxyManager } from './curator-proxy-manager';
import { CuratorAuthError } from './curator-auth.error';
import type { ICopilotAuthService } from '../providers/copilot/copilot-provider.types';
import type { ICodexAuthService } from '../providers/codex/codex-provider.types';
import type { IOpenRouterAuthService } from '../providers/openrouter/openrouter-provider.types';

/**
 * Ambient env the curator must NOT inherit when it runs on its own provider.
 *
 * The tier keys belong on this list for the same reason the credential keys do:
 * they are the *chat* provider's mapping. Leaving them in place aims the
 * curator's `haiku` tier at a model only the chat provider can serve — a
 * curator pinned to LM Studio would inherit Ollama Cloud's `ministral-3:cloud`.
 * Every key is cleared unconditionally and then re-populated by
 * {@link CuratorAuthResolver.buildTierValues} from the curator provider's own
 * mapping, so absence here is a real "this provider has no haiku tier" signal
 * rather than a leftover.
 *
 * ## Why the tier half is SPREAD from `ALL_TIER_ENV_KEYS`, not restated
 *
 * TASK_2026_159 hand-listed the three `_MODEL` vars and stopped there, which
 * left the nine `_NAME` / `_DESCRIPTION` / `_SUPPORTED_CAPABILITIES` vars
 * `ProviderModelsService.applyTierMetadata` writes for the CHAT provider
 * crossing into the curator subprocess. Those are not credentials, but
 * `_SUPPORTED_CAPABILITIES` is documented at its own definition as an SDK
 * ALLOWLIST — the SDK reports anything absent from it as unsupported — so the
 * chat provider's capability list was silently gating the curator provider's
 * features, and `_NAME` / `_DESCRIPTION` were labelling the curator's tiers
 * with the chat provider's model names.
 *
 * Spreading the ONE definition rather than adding nine more literals is the
 * point: `ALL_TIER_ENV_KEYS` is what `clearAllTierEnvVars` and
 * `buildTierEnvDefaults` already run on, so a fourth tier or a fourth
 * per-tier var is stripped here the moment it exists. A hand-maintained copy
 * is how this list fell nine keys behind in the first place.
 */
const CHAT_AUTH_KEYS: ReadonlyArray<keyof AuthEnv> = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  ...ALL_TIER_ENV_KEYS,
];

@injectable()
export class CuratorAuthResolver implements ICuratorAuthResolver {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.CONFIG_MANAGER) private readonly config: ConfigManager,
    @inject(TOKENS.AUTH_SECRETS_SERVICE)
    private readonly authSecrets: IAuthSecretsService,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_PROVIDER_MODELS)
    private readonly providerModels: ProviderModelsService,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_CURATOR_PROXY_MANAGER)
    private readonly curatorProxyManager: CuratorProxyManager,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_COPILOT_AUTH)
    private readonly copilotAuth: ICopilotAuthService,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_CODEX_AUTH)
    private readonly codexAuth: ICodexAuthService,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_OPENROUTER_AUTH)
    private readonly openRouterAuth: IOpenRouterAuthService,
  ) {}

  async resolve(
    curatorProviderId: string,
  ): Promise<OneShotAuthOverride | null> {
    const providerId = (curatorProviderId ?? '').trim();
    if (providerId.length === 0) {
      return null;
    }
    if (providerId === this.providerModels.resolveActiveProviderId()) {
      return null;
    }

    const provider = getAnthropicProvider(providerId);
    const isDirectAnthropic =
      providerId === ANTHROPIC_DIRECT_PROVIDER_ID || providerId === 'apiKey';
    if (isDirectAnthropic) {
      return this.resolveDirectAnthropic();
    }
    if (providerId === 'claudeCli') {
      return this.resolveCli();
    }

    const strategy = resolveStrategy('thirdParty', provider);
    if (strategy === 'cli') {
      return this.resolveCli();
    }
    if (strategy === 'oauth-proxy' || strategy === 'local-proxy') {
      return this.resolveProxyProvider(providerId);
    }
    if (providerId === 'openrouter') {
      return this.resolveProxyProvider(providerId);
    }
    if (strategy === 'local-native') {
      return this.resolveLocalNative(providerId);
    }
    return this.resolveThirdPartyApiKey(providerId);
  }

  private async resolveDirectAnthropic(): Promise<OneShotAuthOverride> {
    const apiKey = await this.authSecrets.getCredential('apiKey');
    if (!apiKey?.trim()) {
      throw new CuratorAuthError(
        ANTHROPIC_DIRECT_PROVIDER_ID,
        'Anthropic API key is not configured for the curator provider.',
      );
    }
    const env = this.buildCuratorEnv({ ANTHROPIC_API_KEY: apiKey.trim() });
    return { env };
  }

  private resolveCli(): OneShotAuthOverride {
    return { env: this.buildCuratorEnv({}) };
  }

  private async resolveThirdPartyApiKey(
    providerId: string,
  ): Promise<OneShotAuthOverride> {
    const providerKey = await this.authSecrets.getProviderKey(providerId);
    if (!providerKey?.trim()) {
      throw new CuratorAuthError(
        providerId,
        `API key is not configured for curator provider: ${providerId}`,
      );
    }
    const baseUrl = this.resolveProviderBaseUrl(providerId);
    const authEnvVar = getProviderAuthEnvVar(providerId);
    const curatorValues: AuthEnv = {
      ANTHROPIC_BASE_URL: baseUrl,
      [authEnvVar]: providerKey.trim(),
      ...this.buildTierValues(providerId),
    };
    return { env: this.buildCuratorEnv(curatorValues), baseUrl };
  }

  private resolveLocalNative(providerId: string): OneShotAuthOverride {
    const baseUrl = this.resolveProviderBaseUrl(providerId);
    const curatorValues: AuthEnv = {
      ANTHROPIC_BASE_URL: baseUrl,
      ...this.buildTierValues(providerId),
    };
    return { env: this.buildCuratorEnv(curatorValues), baseUrl };
  }

  private async resolveProxyProvider(
    providerId: string,
  ): Promise<OneShotAuthOverride> {
    await this.assertProxyAuthenticated(providerId);
    let handle: { url: string; token: string };
    try {
      handle = await this.curatorProxyManager.ensureProxy(providerId);
    } catch (error: unknown) {
      throw new CuratorAuthError(
        providerId,
        `Failed to start curator proxy for ${providerId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    const curatorValues: AuthEnv = {
      ANTHROPIC_BASE_URL: handle.url,
      ANTHROPIC_AUTH_TOKEN: handle.token,
      ...this.buildTierValues(providerId),
    };
    return { env: this.buildCuratorEnv(curatorValues), baseUrl: handle.url };
  }

  private async assertProxyAuthenticated(providerId: string): Promise<void> {
    if (providerId === 'github-copilot') {
      const ok =
        (await this.copilotAuth.isAuthenticated()) ||
        (await this.copilotAuth.tryRestoreAuth());
      if (!ok) {
        throw new CuratorAuthError(
          providerId,
          'GitHub Copilot is not authenticated for the curator provider.',
        );
      }
      return;
    }
    if (providerId === 'openai-codex') {
      const authed = await this.codexAuth.isAuthenticated();
      const fresh = authed ? await this.codexAuth.ensureTokensFresh() : false;
      if (!authed || !fresh) {
        throw new CuratorAuthError(
          providerId,
          'OpenAI Codex is not authenticated for the curator provider.',
        );
      }
      return;
    }
    if (providerId === 'openrouter') {
      if (!(await this.openRouterAuth.isAuthenticated())) {
        throw new CuratorAuthError(
          providerId,
          'OpenRouter is not authenticated for the curator provider.',
        );
      }
      return;
    }
  }

  /**
   * The curator provider's tier mapping, resolved the same way the main agent
   * resolves its own (`ProviderModelsService.applyPersistedTiers`): the user's
   * persisted `mainAgent` override wins, the provider entry's `defaultTiers`
   * back it, and an unmapped tier stays absent.
   *
   * Reading the override matters because it is the only place a provider
   * without `defaultTiers` can get a haiku tier at all, and because a user who
   * remapped haiku expects the curator to follow that remap rather than the
   * snapshot frozen into the provider entry at release time.
   *
   * ## The tier-less case is NOT benign — the warning says so explicitly
   *
   * The earlier wording ("the curator will send the bare tier alias") is false
   * and was actively misleading to debug against. Traced downstream: an absent
   * `ANTHROPIC_DEFAULT_HAIKU_MODEL` means `ModelResolver.resolve('haiku')`
   * falls to `getDefaultTiers(env)` → `getActiveProviderId(env)`
   * (`agent-sdk/.../sdk-query-options-builder.ts`), which matches provider
   * entries by hostname SUBSTRING of `ANTHROPIC_BASE_URL`, ignoring port. For a
   * local-proxy curator that base url is `http://127.0.0.1:<ephemeral>`, and
   * the first registry entry whose hostname is contained in it is the
   * `127.0.0.1:11434` (Ollama) entry — so a curator pinned to LM Studio with no
   * haiku override is asked for Ollama's default haiku model. Only where NO
   * hostname matches (e.g. an OpenRouter curator) does the literal string
   * `haiku` reach the provider, which then 400s.
   *
   * Left as a warning rather than a throw here on purpose: which of the two
   * (hard-fail vs. a curator-scoped default) is right is a product decision
   * about the tier-less provider, and the substitution itself is a defect in
   * `getActiveProviderId`'s port-blind hostname match, not in this mapping.
   * The message must at least not claim the benign outcome.
   */
  private buildTierValues(providerId: string): AuthEnv {
    const defaults = getAnthropicProvider(providerId)?.defaultTiers;
    const overrides = this.providerModels.getModelTiers(
      providerId,
      'mainAgent',
    );

    const tiers: AuthEnv = {};
    const sonnet = overrides.sonnet ?? defaults?.sonnet;
    const opus = overrides.opus ?? defaults?.opus;
    const haiku = overrides.haiku ?? defaults?.haiku;
    if (sonnet) tiers.ANTHROPIC_DEFAULT_SONNET_MODEL = sonnet;
    if (opus) tiers.ANTHROPIC_DEFAULT_OPUS_MODEL = opus;
    if (haiku) tiers.ANTHROPIC_DEFAULT_HAIKU_MODEL = haiku;

    if (!haiku) {
      this.logger.warn(
        '[memory-curator] curator provider has no haiku tier; downstream tier ' +
          'resolution will substitute ANOTHER provider default or send the bare ' +
          'alias — map a haiku model for this provider',
        { providerId },
      );
    }
    return tiers;
  }

  private resolveProviderBaseUrl(providerId: string): string {
    const override = this.config.get<string>(`provider.${providerId}.baseUrl`);
    if (typeof override === 'string' && override.trim().length > 0) {
      return override.trim();
    }
    return getProviderBaseUrl(providerId);
  }

  /**
   * The curator's process env: ambient `process.env` with every
   * {@link CHAT_AUTH_KEYS} entry neutralised, then the curator's own values on
   * top.
   *
   * ## The strip is carried by PRESENT keys whose value is `undefined`
   *
   * `base[key] = undefined` ASSIGNS rather than `delete`s, so each stripped key
   * is still an own enumerable property of the returned object. That is
   * load-bearing, not incidental. The consumer at
   * `agent-sdk/.../sdk-query-runner.service.ts` builds the subprocess env as
   * `{ ...process.env, ...buildTierEnvDefaults(authEnv), ...authEnv, ... }` —
   * it re-spreads the FULL ambient `process.env` and this return value lands
   * after it. A present-but-`undefined` key wins that last spread and blanks
   * the ambient value. A key that has been `delete`d does not appear in the
   * spread at all, so the chat provider's `process.env` value survives
   * untouched and the strip silently becomes a no-op.
   *
   * Anything that drops undefined-valued keys from this return breaks the
   * strip with no type error and no observable failure until a curation runs
   * on the chat provider's credentials: a JSON round-trip,
   * `Object.fromEntries(Object.entries(env).filter(([, v]) => v))`, a Zod
   * `.parse()` with a `Record<string, string>` shape, or a `structuredClone`
   * through an IPC boundary all do it. `buildCuratorEnv` pins this in
   * `curator-auth-resolver.spec.ts` with an explicit
   * `Object.prototype.hasOwnProperty` assertion rather than only
   * `toBeUndefined()`, because `toBeUndefined()` passes either way.
   */
  buildCuratorEnv(curatorValues: AuthEnv): AuthEnv {
    const base: Record<string, string | undefined> = { ...process.env };
    for (const key of CHAT_AUTH_KEYS) {
      base[key] = undefined;
    }
    return { ...base, ...curatorValues } as AuthEnv;
  }
}
