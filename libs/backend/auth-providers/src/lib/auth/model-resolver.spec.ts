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
  CODEX_PROXY_TOKEN_PLACEHOLDER,
  COPILOT_PROXY_TOKEN_PLACEHOLDER,
  OPENROUTER_PROXY_TOKEN_PLACEHOLDER,
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
});
