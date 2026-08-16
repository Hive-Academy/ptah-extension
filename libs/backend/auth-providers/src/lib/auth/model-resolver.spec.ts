/**
 * ModelResolver — the pricing chokepoint.
 *
 * `resolveForCost` is the ONE place that answers "what does this turn cost".
 * What these lock in:
 *
 *   - Billing policy is read off the ACTIVE PROVIDER, never off the model id.
 *     `gpt-5.4` is a Codex model AND an OpenRouter one; the id alone cannot
 *     say whether the user is on a flat fee.
 *   - A subscription provider is costed at the SAME published rates as a
 *     usage-billed one. Ptah reports what the tokens are worth, the way
 *     `claude /usage` and the Codex CLI do — `subscriptionCovered` labels the
 *     figure, it never changes it. A previous revision zeroed these; the
 *     regression test below is what stops that coming back.
 *   - The id handed to the pricing map is the RESOLVED provider model, not the
 *     Claude alias the SDK reported through the translation proxy.
 */

import 'reflect-metadata';

import {
  ANTHROPIC_PROVIDERS,
  CODEX_PROXY_TOKEN_PLACEHOLDER,
  COPILOT_PROXY_TOKEN_PLACEHOLDER,
  OPENROUTER_PROXY_TOKEN_PLACEHOLDER,
  getAnthropicProvider,
  updatePricingMap,
  type AuthEnv,
} from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import { ModelResolver } from './model-resolver';

/** Published rates for the slugs these specs exercise. */
const CATALOG = {
  'gpt-5.3-codex': { inputCostPerToken: 1.75e-6, outputCostPerToken: 14e-6 },
  'gpt-5.6-sol': { inputCostPerToken: 5e-6, outputCostPerToken: 30e-6 },
  'claude-sonnet-4.6': { inputCostPerToken: 3e-6, outputCostPerToken: 15e-6 },
} as const;

function makeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

function makeResolver(env: AuthEnv): ModelResolver {
  return new ModelResolver(makeLogger(), env);
}

/** Auth env as OAuthProxyStrategy leaves it once Codex is active. */
function codexEnv(overrides: Partial<AuthEnv> = {}): AuthEnv {
  return {
    ANTHROPIC_BASE_URL: 'http://127.0.0.1:51001',
    ANTHROPIC_AUTH_TOKEN: CODEX_PROXY_TOKEN_PLACEHOLDER,
    ...overrides,
  } as AuthEnv;
}

describe('ModelResolver', () => {
  beforeEach(() => {
    updatePricingMap({ ...CATALOG });
  });

  describe('isSubscriptionCovered', () => {
    it('is true for the two flat-fee proxy providers', () => {
      expect(makeResolver(codexEnv()).isSubscriptionCovered()).toBe(true);
      expect(
        makeResolver({
          ANTHROPIC_BASE_URL: 'http://127.0.0.1:51002',
          ANTHROPIC_AUTH_TOKEN: COPILOT_PROXY_TOKEN_PLACEHOLDER,
        } as AuthEnv).isSubscriptionCovered(),
      ).toBe(true);
    });

    it('is false for a usage-billed proxy provider', () => {
      expect(
        makeResolver({
          ANTHROPIC_BASE_URL: 'http://127.0.0.1:51003',
          ANTHROPIC_AUTH_TOKEN: OPENROUTER_PROXY_TOKEN_PLACEHOLDER,
        } as AuthEnv).isSubscriptionCovered(),
      ).toBe(false);
    });

    it('is false for direct Anthropic auth', () => {
      expect(
        makeResolver({
          ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
        } as AuthEnv).isSubscriptionCovered(),
      ).toBe(false);
      expect(makeResolver({} as AuthEnv).isSubscriptionCovered()).toBe(false);
    });

    it('reads the override env, not the injected one', () => {
      // Session replay and history reads pass the env the session ACTUALLY
      // ran on; answering from the currently-injected one would price an old
      // session against whatever provider happens to be active now.
      const resolver = makeResolver({
        ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
      } as AuthEnv);

      expect(resolver.isSubscriptionCovered(codexEnv())).toBe(true);
    });
  });

  describe('resolveForCost', () => {
    it('prices a Codex turn at published rates, not zero', () => {
      // The regression this exists for. Codex models are absent from the
      // pricing map by design (seedStaticModelPricing skips subscription
      // providers, so their $0 statics cannot pin a shared slug), and their
      // rates come from the catalog like everyone else's.
      const resolver = makeResolver(
        codexEnv({ ANTHROPIC_DEFAULT_SONNET_MODEL: 'gpt-5.3-codex' }),
      );

      const priced = resolver.resolveForCost('claude-sonnet-4-5');

      expect(priced.modelId).toBe('gpt-5.3-codex');
      expect(priced.subscriptionCovered).toBe(true);
      expect(priced.pricing).toMatchObject({
        inputCostPerToken: 1.75e-6,
        outputCostPerToken: 14e-6,
      });
    });

    it('gives a subscription and a usage provider the same rate for one slug', () => {
      // `gpt-5.6-sol` is sold per token on OpenRouter and covered by a ChatGPT
      // subscription. Both report the same dollar figure; only the label moves.
      const onCodex = makeResolver(
        codexEnv({ ANTHROPIC_DEFAULT_OPUS_MODEL: 'gpt-5.6-sol' }),
      ).resolveForCost('opus');
      const onOpenRouter = makeResolver({
        ANTHROPIC_BASE_URL: 'http://127.0.0.1:51003',
        ANTHROPIC_AUTH_TOKEN: OPENROUTER_PROXY_TOKEN_PLACEHOLDER,
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'gpt-5.6-sol',
      } as AuthEnv).resolveForCost('opus');

      expect(onCodex.modelId).toBe('gpt-5.6-sol');
      expect(onOpenRouter.modelId).toBe('gpt-5.6-sol');
      expect(onCodex.pricing).toEqual(onOpenRouter.pricing);
      expect(onCodex.subscriptionCovered).toBe(true);
      expect(onOpenRouter.subscriptionCovered).toBe(false);
    });

    it('prices direct Anthropic against the reported model id verbatim', () => {
      const resolver = makeResolver({
        ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
      } as AuthEnv);

      const priced = resolver.resolveForCost('claude-sonnet-4.6');

      expect(priced.modelId).toBe('claude-sonnet-4.6');
      expect(priced.subscriptionCovered).toBe(false);
      expect(priced.pricing).toMatchObject({ inputCostPerToken: 3e-6 });
    });

    it('reports unknown pricing as null rather than a fabricated zero', () => {
      // CostBadgeComponent renders null as "cost unavailable" and 0 as
      // "$0.00" — an unpriced model must not claim to be free.
      const priced =
        makeResolver(codexEnv()).resolveForCost('gpt-9.9-unreleased');

      expect(priced.pricing).toBeNull();
    });
  });

  /**
   * Where a TIER-SHAPED value stops resolving (TASK_2026_250 follow-up A).
   *
   * `skill-synthesis` documents its "inherit" fallback as safe because
   * `resolve` remaps a dated `claude-*` id to the active provider's tier
   * model. These pin the two places that argument runs out, so neither the
   * prose nor the mitigation can drift from the code:
   *
   *  1. The `claude-*` branch resolves through the tier ENV VAR only. It never
   *     consults `defaultTiers`, so the id survives verbatim if the env was
   *     not populated. (Every third-party activation path DOES populate it —
   *     `AuthManager.doConfigureAuthentication` → `strategy.configure` →
   *     `ProviderModelsService.switchActiveProvider` — so this is a shape, not
   *     a live defect.)
   *  2. A provider that declares no `defaultTiers` resolves NEITHER a dated id
   *     NOR a bare tier alias. This is the load-bearing one: it refutes
   *     "swap the pinned id for a tier alias" as a fix, because on exactly the
   *     providers that are exposed the alias is sent verbatim too.
   */
  describe('tier values with nothing left to resolve them', () => {
    /** `JUDGE_DEFAULT_MODEL_ID`, restated — skill-synthesis is not importable here. */
    const PINNED_CLAUDE_ID = 'claude-haiku-4-5-20251001';

    /** Unique-hostname entry that DOES declare `defaultTiers`. */
    const MAPPED_PROVIDER_ID = 'moonshot';

    function withLogger(env: AuthEnv): {
      resolver: ModelResolver;
      warn: jest.Mock;
    } {
      const logger = makeLogger();
      return {
        resolver: new ModelResolver(logger, env),
        warn: logger.warn as unknown as jest.Mock,
      };
    }

    /** Auth env as the OpenRouter proxy strategy leaves it — no tier vars. */
    function openRouterEnv(overrides: Partial<AuthEnv> = {}): AuthEnv {
      return {
        ANTHROPIC_BASE_URL: 'http://127.0.0.1:51003',
        ANTHROPIC_AUTH_TOKEN: OPENROUTER_PROXY_TOKEN_PLACEHOLDER,
        ...overrides,
      } as AuthEnv;
    }

    function mappedProviderEnv(overrides: Partial<AuthEnv> = {}): AuthEnv {
      return {
        ANTHROPIC_BASE_URL: getAnthropicProvider(MAPPED_PROVIDER_ID)?.baseUrl,
        ...overrides,
      } as AuthEnv;
    }

    it('names exactly the registry entries the docs say are exposed', () => {
      // The "3 of 11" figure in skill-synthesis/CLAUDE.md and in
      // `resolveJudgeModel`'s docblock. Derived from the registry rather than
      // restated, so adding `defaultTiers` to one of these fails HERE and
      // sends whoever did it to the prose.
      const withoutTiers = ANTHROPIC_PROVIDERS.filter(
        (p) => !('defaultTiers' in p) || !p.defaultTiers,
      ).map((p) => p.id);

      expect([...withoutTiers].sort()).toEqual([
        'lm-studio',
        'openrouter',
        'requesty',
      ]);
      expect(
        getAnthropicProvider(MAPPED_PROVIDER_ID)?.defaultTiers,
      ).toBeDefined();
    });

    it('sends a bare tier alias verbatim when the provider declares no defaultTiers', () => {
      // The refutation of "just fall back to a tier alias instead". On the
      // exposed providers the alias is no more servable than the pinned id.
      expect(withLogger(openRouterEnv()).resolver.resolve('haiku')).toBe(
        'haiku',
      );
    });

    it('sends a dated claude id verbatim there too — the two fallbacks are equally unresolved', () => {
      expect(
        withLogger(openRouterEnv()).resolver.resolve(PINNED_CLAUDE_ID),
      ).toBe(PINNED_CLAUDE_ID);
    });

    it('resolves the alias through defaultTiers when the provider declares them', () => {
      const expected =
        getAnthropicProvider(MAPPED_PROVIDER_ID)?.defaultTiers?.haiku;
      expect(expected).toBeTruthy();
      expect(withLogger(mappedProviderEnv()).resolver.resolve('haiku')).toBe(
        expected,
      );
    });

    it('does NOT resolve a dated claude id through defaultTiers — only through the tier env var', () => {
      // The asymmetry between the two branches, pinned. `applyPersistedTiers`
      // writes that env var on every third-party activation path, which is why
      // this shape is not a live defect; assert it so a future reader does not
      // have to re-derive that, and so removing the asymmetry is a deliberate
      // act rather than an accident.
      const { resolver } = withLogger(mappedProviderEnv());
      expect(resolver.resolve(PINNED_CLAUDE_ID)).toBe(PINNED_CLAUDE_ID);

      const populated = withLogger(
        mappedProviderEnv({ ANTHROPIC_DEFAULT_HAIKU_MODEL: 'kimi-fixture' }),
      );
      expect(populated.resolver.resolve(PINNED_CLAUDE_ID)).toBe('kimi-fixture');
    });

    it('warns once per provider and value, and never for a real provider model id', () => {
      const { resolver, warn } = withLogger(openRouterEnv());

      resolver.resolve('haiku');
      resolver.resolve('haiku');
      resolver.resolve(PINNED_CLAUDE_ID);
      // A concrete provider slug is what SHOULD be sent through untouched —
      // warning about it would train everyone to ignore the warning.
      resolver.resolve('anthropic/claude-haiku-4.5');

      expect(warn).toHaveBeenCalledTimes(2);
      expect(warn.mock.calls.map(([m]) => m).join('\n')).toContain(
        'openrouter',
      );
    });

    it('stays silent on direct Anthropic, where the pinned id is correct', () => {
      const { resolver, warn } = withLogger({
        ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
      } as AuthEnv);

      expect(resolver.resolve(PINNED_CLAUDE_ID)).toBe(PINNED_CLAUDE_ID);
      expect(resolver.resolve('haiku')).toBe('haiku');
      expect(warn).not.toHaveBeenCalled();
    });
  });
});
