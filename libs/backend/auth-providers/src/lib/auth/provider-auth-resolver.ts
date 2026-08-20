import { inject, injectable } from 'tsyringe';
import {
  Logger,
  ConfigManager,
  TOKENS,
  type IAuthSecretsService,
} from '@ptah-extension/vscode-core';
import { ALL_TIER_ENV_KEYS } from '@ptah-extension/agent-sdk';
import type { OneShotAuthOverride } from '@ptah-extension/agent-sdk';
import type { IProviderAuthResolver } from '@ptah-extension/agent-sdk';
import type {
  AuthEnv,
  ProviderModelTier,
  ProviderTierScope,
} from '@ptah-extension/shared';
import {
  ANTHROPIC_DIRECT_PROVIDER_ID,
  getAnthropicProvider,
  getProviderAuthEnvVar,
  getProviderBaseUrl,
  resolveStrategy,
} from '@ptah-extension/shared';
import { AUTH_PROVIDERS_TOKENS } from '../di/tokens';
import type { ProviderModelsService } from '../provider-models.service';
import type { DerivedTierMap } from '../model-tier-derivation';
import { CuratorProxyManager } from './curator-proxy-manager';
import { ProviderAuthError } from './provider-auth.error';
import type { ICopilotAuthService } from '../providers/copilot/copilot-provider.types';
import type { ICodexAuthService } from '../providers/codex/codex-provider.types';
import type { IOpenRouterAuthService } from '../providers/openrouter/openrouter-provider.types';

/**
 * Ambient env a resolved provider must NOT inherit when it runs somewhere
 * other than the active chat provider.
 *
 * The tier keys belong on this list for the same reason the credential keys do:
 * they are the *chat* provider's mapping. Leaving them in place aims the
 * resolved provider's `haiku` tier at a model only the chat provider can serve
 * — a curator pinned to LM Studio would inherit Ollama Cloud's
 * `ministral-3:cloud`. Every key is cleared unconditionally and then
 * re-populated by {@link ProviderAuthResolver.buildTierValues} from the
 * resolved provider's own mapping, so absence here is a real "this provider
 * has no haiku tier" signal rather than a leftover.
 *
 * ## Why the tier half is SPREAD from `ALL_TIER_ENV_KEYS`, not restated
 *
 * TASK_2026_159 hand-listed the three `_MODEL` vars and stopped there, which
 * left the nine `_NAME` / `_DESCRIPTION` / `_SUPPORTED_CAPABILITIES` vars
 * `ProviderModelsService.applyTierMetadata` writes for the CHAT provider
 * crossing into the resolved provider's subprocess. Those are not credentials,
 * but `_SUPPORTED_CAPABILITIES` is documented at its own definition as an SDK
 * ALLOWLIST — the SDK reports anything absent from it as unsupported — so the
 * chat provider's capability list was silently gating the resolved provider's
 * features, and `_NAME` / `_DESCRIPTION` were labelling its tiers with the
 * chat provider's model names.
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

/**
 * Builds the credential + tier snapshot for running one query on a provider
 * that is not the active chat provider.
 *
 * Serves every caller that needs an off-foreground provider: the memory
 * curator today, background skill-synthesis lanes next. Nothing here is
 * caller-specific — the only caller-visible knob is `scope`, which selects
 * WHICH persisted tier mapping is read. Provider behaviour is driven entirely
 * off `resolveStrategy` and the registry entry, never off a caller identity.
 */
@injectable()
export class ProviderAuthResolver implements IProviderAuthResolver {
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

  /**
   * @param scope defaults to `'mainAgent'` so the pre-existing curator call
   *   site, which passes nothing, reads exactly the mapping it always read.
   */
  async resolve(
    requestedProviderId: string,
    scope: ProviderTierScope = 'mainAgent',
  ): Promise<OneShotAuthOverride | null> {
    const providerId = (requestedProviderId ?? '').trim();
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
      return this.resolveProxyProvider(providerId, scope);
    }
    if (providerId === 'openrouter') {
      return this.resolveProxyProvider(providerId, scope);
    }
    if (strategy === 'local-native') {
      return this.resolveLocalNative(providerId, scope);
    }
    return this.resolveThirdPartyApiKey(providerId, scope);
  }

  private async resolveDirectAnthropic(): Promise<OneShotAuthOverride> {
    const apiKey = await this.authSecrets.getCredential('apiKey');
    if (!apiKey?.trim()) {
      throw new ProviderAuthError(
        ANTHROPIC_DIRECT_PROVIDER_ID,
        'Anthropic API key is not configured.',
      );
    }
    const env = this.buildLaneEnv({ ANTHROPIC_API_KEY: apiKey.trim() });
    return { env };
  }

  private resolveCli(): OneShotAuthOverride {
    return { env: this.buildLaneEnv({}) };
  }

  private async resolveThirdPartyApiKey(
    providerId: string,
    scope: ProviderTierScope,
  ): Promise<OneShotAuthOverride> {
    const providerKey = await this.authSecrets.getProviderKey(providerId);
    if (!providerKey?.trim()) {
      throw new ProviderAuthError(
        providerId,
        `API key is not configured for provider: ${providerId}`,
      );
    }
    const baseUrl = this.resolveProviderBaseUrl(providerId);
    const authEnvVar = getProviderAuthEnvVar(providerId);
    const values: AuthEnv = {
      ANTHROPIC_BASE_URL: baseUrl,
      [authEnvVar]: providerKey.trim(),
      ...this.buildTierValues(providerId, scope),
    };
    return { env: this.buildLaneEnv(values), baseUrl };
  }

  private resolveLocalNative(
    providerId: string,
    scope: ProviderTierScope,
  ): OneShotAuthOverride {
    const baseUrl = this.resolveProviderBaseUrl(providerId);
    const values: AuthEnv = {
      ANTHROPIC_BASE_URL: baseUrl,
      ...this.buildTierValues(providerId, scope),
    };
    return { env: this.buildLaneEnv(values), baseUrl };
  }

  private async resolveProxyProvider(
    providerId: string,
    scope: ProviderTierScope,
  ): Promise<OneShotAuthOverride> {
    await this.assertProxyAuthenticated(providerId);
    let handle: { url: string; token: string };
    try {
      handle = await this.curatorProxyManager.ensureProxy(providerId);
    } catch (error: unknown) {
      throw new ProviderAuthError(
        providerId,
        `Failed to start the local proxy for ${providerId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    const values: AuthEnv = {
      ANTHROPIC_BASE_URL: handle.url,
      ANTHROPIC_AUTH_TOKEN: handle.token,
      ...this.buildTierValues(providerId, scope),
    };
    return { env: this.buildLaneEnv(values), baseUrl: handle.url };
  }

  private async assertProxyAuthenticated(providerId: string): Promise<void> {
    if (providerId === 'github-copilot') {
      const ok =
        (await this.copilotAuth.isAuthenticated()) ||
        (await this.copilotAuth.tryRestoreAuth());
      if (!ok) {
        throw new ProviderAuthError(
          providerId,
          'GitHub Copilot is not authenticated.',
        );
      }
      return;
    }
    if (providerId === 'openai-codex') {
      const authed = await this.codexAuth.isAuthenticated();
      const fresh = authed ? await this.codexAuth.ensureTokensFresh() : false;
      if (!authed || !fresh) {
        throw new ProviderAuthError(
          providerId,
          'OpenAI Codex is not authenticated.',
        );
      }
      return;
    }
    if (providerId === 'openrouter') {
      if (!(await this.openRouterAuth.isAuthenticated())) {
        throw new ProviderAuthError(
          providerId,
          'OpenRouter is not authenticated.',
        );
      }
      return;
    }
  }

  /**
   * The resolved provider's tier mapping, read the same way the main agent
   * reads its own (`ProviderModelsService.applyPersistedTiers`): the user's
   * persisted override for `scope` wins, the provider entry's `defaultTiers`
   * back it, the provider's own live catalogue backs THAT, and a tier none of
   * the three can justify stays absent.
   *
   * Reading the override matters because a user who remapped haiku expects the
   * caller to follow that remap rather than the snapshot frozen into the
   * provider entry at release time.
   *
   * ## The live-catalogue link, and why this file needed its own (TASK_2026_262)
   *
   * That third link is NOT inherited from the chat path, and assuming it was is
   * the mistake this comment exists to stop. `applyPersistedTiers` writes the
   * global `authEnv` + `process.env`; {@link buildLaneEnv} then blanks every one
   * of `ALL_TIER_ENV_KEYS` out of the ambient env by design, precisely so a
   * background run cannot inherit the chat provider's mapping. So the chat
   * fix reaches this path only to be deleted by it, and the values here have to
   * be derived again from the RESOLVED provider's own catalogue.
   *
   * Without it, the case lanes exist for was the broken one: a user on direct
   * Anthropic who points the judge lane at `openrouter` to keep background work
   * off their paid quota. `resolveLaneModel` returns a bare tier alias for a
   * lane that names a provider (`lane-resolver.service.ts:110`), that alias is
   * resolved against THIS env by `SdkQueryRunner.buildOneShotOptions`
   * (`sdk-query-runner.service.ts:292-295`), and with no tier value here the
   * literal word `haiku` reached the endpoint. `openrouter`, `lm-studio` and
   * `requesty` declare no `defaultTiers`, which is exactly why the derivation
   * exists.
   *
   * `getLiveDerivedTiers` is a synchronous, global-inert read of the catalogue
   * the provider itself returned — the SAME function the chat path and the
   * per-workspace profile resolver use, so all three agree on what a tier
   * means. It writes nothing; only `setModelTier` on the `mainAgent` scope
   * does that, and this file never calls it.
   *
   * `scope` selects WHICH persisted mapping. `'lane'` reads
   * `provider.<id>.lane.modelTier.<tier>`; with nothing persisted every tier
   * comes back null and the `defaultTiers` fallback below supplies the values
   * — which is exactly "the haiku tier of the selected provider", with no
   * hardcoded model id anywhere. Reading a scope never writes globals; only
   * `ProviderModelsService.setModelTier` on the `mainAgent` scope does that.
   *
   * ## The tier-less case is NOT benign — the warning says so explicitly
   *
   * The earlier wording ("the caller will send the bare tier alias") is false
   * and was actively misleading to debug against. Traced downstream: an absent
   * `ANTHROPIC_DEFAULT_HAIKU_MODEL` means `ModelResolver.resolve('haiku')`
   * falls to `getDefaultTiers(env)` → `getActiveProviderId(env)`
   * (`agent-sdk/.../sdk-query-options-builder.ts`), which matches provider
   * entries by hostname SUBSTRING of `ANTHROPIC_BASE_URL`, ignoring port. For a
   * local-proxy provider that base url is `http://127.0.0.1:<ephemeral>`, and
   * the first registry entry whose hostname is contained in it is the
   * `127.0.0.1:11434` (Ollama) entry — so a caller pinned to LM Studio with no
   * haiku override is asked for Ollama's default haiku model. Only where NO
   * hostname matches (e.g. an OpenRouter provider) does the literal string
   * `haiku` reach the provider, which then 400s.
   *
   * This is TASK_2026_180 risk R7. The mitigation is structural rather than a
   * fix: every caller sets explicit `ANTHROPIC_DEFAULT_*_MODEL` values from
   * this method BEFORE any identification happens, so the substring match is
   * never consulted on the path that matters. Fixing
   * `getActiveProviderId`'s port-blind hostname match is a tracked follow-up
   * and deliberately out of scope here — which of hard-fail or a
   * caller-scoped default is right is a product decision about the tier-less
   * provider. The message must at least not claim the benign outcome.
   */
  private buildTierValues(
    providerId: string,
    scope: ProviderTierScope,
  ): AuthEnv {
    const defaults = getAnthropicProvider(providerId)?.defaultTiers;
    const overrides = this.providerModels.getModelTiers(providerId, scope);

    // Lazy: a provider whose static data covers all three tiers never reads a
    // catalogue at all.
    let derived: DerivedTierMap | undefined;
    const derivedFor = (tier: ProviderModelTier): string | undefined => {
      derived ??= this.providerModels.getLiveDerivedTiers(providerId);
      return derived[tier];
    };

    const tiers: AuthEnv = {};
    const sonnet = overrides.sonnet ?? defaults?.sonnet ?? derivedFor('sonnet');
    const opus = overrides.opus ?? defaults?.opus ?? derivedFor('opus');
    const haiku = overrides.haiku ?? defaults?.haiku ?? derivedFor('haiku');
    if (sonnet) tiers.ANTHROPIC_DEFAULT_SONNET_MODEL = sonnet;
    if (opus) tiers.ANTHROPIC_DEFAULT_OPUS_MODEL = opus;
    if (haiku) tiers.ANTHROPIC_DEFAULT_HAIKU_MODEL = haiku;

    if (!haiku) {
      this.logger.warn(
        '[provider-auth] resolved provider has no haiku tier; downstream tier ' +
          'resolution will substitute ANOTHER provider default or send the bare ' +
          'alias — map a haiku model for this provider',
        { providerId, scope },
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
   * The resolved provider's process env: ambient `process.env` with every
   * {@link CHAT_AUTH_KEYS} entry neutralised, then the resolved provider's own
   * values on top.
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
   * strip with no type error and no observable failure until a background run
   * happens on the chat provider's credentials: a JSON round-trip,
   * `Object.fromEntries(Object.entries(env).filter(([, v]) => v))`, a Zod
   * `.parse()` with a `Record<string, string>` shape, or a `structuredClone`
   * through an IPC boundary all do it. This is why the lane-side type is
   * `Readonly<Record<string, string | undefined>>` and never
   * `Record<string, string>`. `buildLaneEnv` pins the contract in
   * `provider-auth-resolver.spec.ts` with an explicit
   * `Object.prototype.hasOwnProperty` assertion rather than only
   * `toBeUndefined()`, because `toBeUndefined()` passes either way.
   */
  buildLaneEnv(values: AuthEnv): AuthEnv {
    const base: Record<string, string | undefined> = { ...process.env };
    for (const key of CHAT_AUTH_KEYS) {
      base[key] = undefined;
    }
    return { ...base, ...values } as AuthEnv;
  }
}
