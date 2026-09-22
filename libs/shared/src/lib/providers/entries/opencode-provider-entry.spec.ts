/**
 * OpenCode Provider Entry & Route Catalog Specs
 *
 * Verifies:
 * 1. Protocol route lookup for OpenCode Zen and OpenCode Go, including
 *    the divergent protocol for `minimax-m3` and other collision models.
 * 2. Prototype pollution resistance and strict own-property lookups.
 * 3. Exact model counts per subscription per protocol (16/22/28 and 8/18/5).
 * 4. Exclusion of the 7 Google generateContent models and 2 Jev systemone models.
 * 5. Resolution through `getAnthropicProvider()` and `getAllAnthropicProviders()`.
 * 6. `defaultTiers` validation against each subscription's route table.
 * 7. `seedStaticModelPricing('opencode-go')` writes nothing due to the subscription guard.
 *
 * @see TASK_2026_526
 */

import {
  OPENCODE_MODEL_ROUTES,
  getOpenCodeModelProtocol,
  isOpenCodeProviderId,
  type OpenCodeProtocol,
  type OpenCodeProviderId,
} from './opencode-model-routes';
import {
  OPENCODE_ZEN_PROVIDER_ENTRY,
  OPENCODE_GO_PROVIDER_ENTRY,
  OPENCODE_ZEN_DEFAULT_TIERS,
  OPENCODE_GO_DEFAULT_TIERS,
  OPENCODE_ZEN_STATIC_MODELS,
  OPENCODE_GO_STATIC_MODELS,
} from './opencode-provider-entry';
import {
  getAllAnthropicProviders,
  getAnthropicProvider,
  isSubscriptionCoveredProvider,
  seedStaticModelPricing,
} from '../provider-registry';
import { getPricingMap } from '../../utils/pricing.utils';

/** The nine explicitly excluded model IDs that must never be routed or listed. */
const EXCLUDED_MODEL_IDS = [
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-pro',
  'gemini-3-flash',
  'jev-1.13',
  'jev-1.13-free',
] as const;

describe('OpenCode Model Routes', () => {
  describe('protocol resolution and collision handling', () => {
    it('resolves minimax-m3 to chat/completions on Zen and messages on Go', () => {
      expect(getOpenCodeModelProtocol('opencode-zen', 'minimax-m3')).toBe(
        'chat/completions',
      );
      expect(getOpenCodeModelProtocol('opencode-go', 'minimax-m3')).toBe(
        'messages',
      );
    });

    it('resolves minimax-m2.7 and minimax-m2.5 divergent protocols in both directions', () => {
      expect(getOpenCodeModelProtocol('opencode-zen', 'minimax-m2.7')).toBe(
        'chat/completions',
      );
      expect(getOpenCodeModelProtocol('opencode-go', 'minimax-m2.7')).toBe(
        'messages',
      );

      expect(getOpenCodeModelProtocol('opencode-zen', 'minimax-m2.5')).toBe(
        'chat/completions',
      );
      expect(getOpenCodeModelProtocol('opencode-go', 'minimax-m2.5')).toBe(
        'messages',
      );
    });

    it('resolves shared models with matching protocols correctly', () => {
      expect(getOpenCodeModelProtocol('opencode-zen', 'glm-5.3')).toBe(
        'chat/completions',
      );
      expect(getOpenCodeModelProtocol('opencode-go', 'glm-5.3')).toBe(
        'chat/completions',
      );

      expect(getOpenCodeModelProtocol('opencode-zen', 'kimi-k3')).toBe(
        'chat/completions',
      );
      expect(getOpenCodeModelProtocol('opencode-go', 'kimi-k3')).toBe(
        'chat/completions',
      );

      expect(getOpenCodeModelProtocol('opencode-zen', 'qwen3.7-max')).toBe(
        'messages',
      );
      expect(getOpenCodeModelProtocol('opencode-go', 'qwen3.7-max')).toBe(
        'messages',
      );

      expect(getOpenCodeModelProtocol('opencode-zen', 'grok-4.7')).toBe(
        'responses',
      );
      expect(getOpenCodeModelProtocol('opencode-go', 'grok-4.7')).toBe(
        'responses',
      );
    });

    it('returns undefined for models exclusive to the other subscription', () => {
      // claude-sonnet-5 exists in Zen but not Go
      expect(getOpenCodeModelProtocol('opencode-zen', 'claude-sonnet-5')).toBe(
        'messages',
      );
      expect(
        getOpenCodeModelProtocol('opencode-go', 'claude-sonnet-5'),
      ).toBeUndefined();

      // longcat-2.0 exists in Go but not Zen
      expect(
        getOpenCodeModelProtocol('opencode-zen', 'longcat-2.0'),
      ).toBeUndefined();
      expect(getOpenCodeModelProtocol('opencode-go', 'longcat-2.0')).toBe(
        'chat/completions',
      );

      // qwen3.8-max exists in Go but not Zen
      expect(
        getOpenCodeModelProtocol('opencode-zen', 'qwen3.8-max'),
      ).toBeUndefined();
      expect(getOpenCodeModelProtocol('opencode-go', 'qwen3.8-max')).toBe(
        'messages',
      );
    });

    it('returns undefined for unknown model IDs', () => {
      expect(
        getOpenCodeModelProtocol('opencode-zen', 'unknown-model-id'),
      ).toBeUndefined();
      expect(
        getOpenCodeModelProtocol('opencode-go', 'unknown-model-id'),
      ).toBeUndefined();
      expect(getOpenCodeModelProtocol('opencode-zen', '')).toBeUndefined();
    });

    it('rejects Object prototype properties as unsupported IDs (own-property lookup)', () => {
      const prototypeKeys = [
        'constructor',
        'toString',
        '__proto__',
        'valueOf',
        'hasOwnProperty',
        'isPrototypeOf',
      ];

      for (const key of prototypeKeys) {
        expect(getOpenCodeModelProtocol('opencode-zen', key)).toBeUndefined();
        expect(getOpenCodeModelProtocol('opencode-go', key)).toBeUndefined();
      }
    });

    it('is case-sensitive and does not strip prefixes or guess suffixes', () => {
      expect(
        getOpenCodeModelProtocol('opencode-zen', 'CLAUDE-SONNET-5'),
      ).toBeUndefined();
      expect(
        getOpenCodeModelProtocol('opencode-zen', 'claude-sonnet-5-v1'),
      ).toBeUndefined();
      expect(
        getOpenCodeModelProtocol('opencode-zen', 'zen/claude-sonnet-5'),
      ).toBeUndefined();
    });

    it('validates isOpenCodeProviderId guard', () => {
      expect(isOpenCodeProviderId('opencode-zen')).toBe(true);
      expect(isOpenCodeProviderId('opencode-go')).toBe(true);
      expect(isOpenCodeProviderId('openrouter')).toBe(false);
      expect(isOpenCodeProviderId('sakana')).toBe(false);
      expect(isOpenCodeProviderId('opencode')).toBe(false);
      expect(isOpenCodeProviderId('')).toBe(false);
    });

    it('returns undefined when getOpenCodeModelProtocol is called with invalid provider ID', () => {
      expect(
        getOpenCodeModelProtocol(
          'openrouter' as unknown as OpenCodeProviderId,
          'claude-sonnet-5',
        ),
      ).toBeUndefined();
    });
  });

  describe('explicit exclusions', () => {
    it.each(EXCLUDED_MODEL_IDS)(
      'excludes %s from Zen routes, Go routes, static models, and default tiers',
      (excludedId) => {
        // Not in routing functions
        expect(
          getOpenCodeModelProtocol('opencode-zen', excludedId),
        ).toBeUndefined();
        expect(
          getOpenCodeModelProtocol('opencode-go', excludedId),
        ).toBeUndefined();

        // Not in route table objects
        expect(
          Object.prototype.hasOwnProperty.call(
            OPENCODE_MODEL_ROUTES['opencode-zen'],
            excludedId,
          ),
        ).toBe(false);
        expect(
          Object.prototype.hasOwnProperty.call(
            OPENCODE_MODEL_ROUTES['opencode-go'],
            excludedId,
          ),
        ).toBe(false);

        // Not in static models
        expect(
          OPENCODE_ZEN_STATIC_MODELS.some((m) => m.id === excludedId),
        ).toBe(false);
        expect(
          OPENCODE_GO_STATIC_MODELS.some((m) => m.id === excludedId),
        ).toBe(false);

        // Not in default tiers
        expect(Object.values(OPENCODE_ZEN_DEFAULT_TIERS)).not.toContain(
          excludedId,
        );
        expect(Object.values(OPENCODE_GO_DEFAULT_TIERS)).not.toContain(
          excludedId,
        );
      },
    );
  });

  describe('coverage and counts per protocol', () => {
    function countProtocols(
      providerId: OpenCodeProviderId,
    ): Record<OpenCodeProtocol, number> {
      const counts: Record<OpenCodeProtocol, number> = {
        messages: 0,
        'chat/completions': 0,
        responses: 0,
      };
      for (const protocol of Object.values(OPENCODE_MODEL_ROUTES[providerId])) {
        counts[protocol]++;
      }
      return counts;
    }

    it('encodes exactly 66 Zen models (16 messages, 22 chat/completions, 28 responses)', () => {
      const counts = countProtocols('opencode-zen');
      expect(counts.messages).toBe(16);
      expect(counts['chat/completions']).toBe(22);
      expect(counts.responses).toBe(28);
      expect(Object.keys(OPENCODE_MODEL_ROUTES['opencode-zen'])).toHaveLength(
        66,
      );
    });

    it('encodes exactly 31 Go models (8 messages, 18 chat/completions, 5 responses)', () => {
      const counts = countProtocols('opencode-go');
      expect(counts.messages).toBe(8);
      expect(counts['chat/completions']).toBe(18);
      expect(counts.responses).toBe(5);
      expect(Object.keys(OPENCODE_MODEL_ROUTES['opencode-go'])).toHaveLength(
        31,
      );
    });

    it('encodes exactly 97 total model routes across both subscriptions', () => {
      const totalRoutes =
        Object.keys(OPENCODE_MODEL_ROUTES['opencode-zen']).length +
        Object.keys(OPENCODE_MODEL_ROUTES['opencode-go']).length;
      expect(totalRoutes).toBe(97);
    });

    it('freezes the routing table against mutation', () => {
      expect(Object.isFrozen(OPENCODE_MODEL_ROUTES)).toBe(true);
      expect(Object.isFrozen(OPENCODE_MODEL_ROUTES['opencode-zen'])).toBe(true);
      expect(Object.isFrozen(OPENCODE_MODEL_ROUTES['opencode-go'])).toBe(true);
    });
  });
});

describe('OpenCode Provider Entries', () => {
  describe('registry integration', () => {
    it('resolves both entries through getAnthropicProvider', () => {
      expect(getAnthropicProvider('opencode-zen')).toBe(
        OPENCODE_ZEN_PROVIDER_ENTRY,
      );
      expect(getAnthropicProvider('opencode-go')).toBe(
        OPENCODE_GO_PROVIDER_ENTRY,
      );
    });

    it('includes both entries in getAllAnthropicProviders', () => {
      const all = getAllAnthropicProviders();
      expect(all.some((p) => p.id === 'opencode-zen')).toBe(true);
      expect(all.some((p) => p.id === 'opencode-go')).toBe(true);
    });

    it('configures OpenCode Zen entry with correct properties', () => {
      expect(OPENCODE_ZEN_PROVIDER_ENTRY).toMatchObject({
        id: 'opencode-zen',
        name: 'OpenCode Zen',
        baseUrl: 'https://opencode.ai/zen/v1',
        authEnvVar: 'ANTHROPIC_AUTH_TOKEN',
        authType: 'apiKey',
        requiresProxy: true,
        isLocal: false,
        keyPrefix: '',
        helpUrl: 'https://opencode.ai/docs/zen/',
        description:
          'Usage-billed OpenCode models via Messages, Chat Completions and Responses. Gemini and Jev are not supported.',
        keyPlaceholder: 'Enter OpenCode Zen API key...',
        maskedKeyDisplay: '••••••••',
        pricingModel: 'usage',
        defaultTiers: OPENCODE_ZEN_DEFAULT_TIERS,
      });
      expect(OPENCODE_ZEN_PROVIDER_ENTRY.modelsEndpoint).toBeUndefined();
    });

    it('configures OpenCode Go entry with correct properties', () => {
      expect(OPENCODE_GO_PROVIDER_ENTRY).toMatchObject({
        id: 'opencode-go',
        name: 'OpenCode Go',
        baseUrl: 'https://opencode.ai/zen/go/v1',
        authEnvVar: 'ANTHROPIC_AUTH_TOKEN',
        authType: 'apiKey',
        requiresProxy: true,
        isLocal: false,
        keyPrefix: '',
        helpUrl: 'https://opencode.ai/docs/go/',
        description:
          'OpenCode Go, $10/month with a separate Go key. Messages, Chat Completions and Responses; Gemini and Jev are not supported.',
        keyPlaceholder: 'Enter OpenCode Go API key...',
        maskedKeyDisplay: '••••••••',
        pricingModel: 'subscription',
        defaultTiers: OPENCODE_GO_DEFAULT_TIERS,
      });
      expect(OPENCODE_GO_PROVIDER_ENTRY.modelsEndpoint).toBeUndefined();
    });
  });

  describe('static models', () => {
    it('derives Zen static models strictly from Zen route keys', () => {
      expect(OPENCODE_ZEN_STATIC_MODELS).toHaveLength(66);
      for (const model of OPENCODE_ZEN_STATIC_MODELS) {
        expect(
          Object.prototype.hasOwnProperty.call(
            OPENCODE_MODEL_ROUTES['opencode-zen'],
            model.id,
          ),
        ).toBe(true);
        expect(model.name).toBe(model.id);
        expect(model.contextLength).toBe(0);
        expect(model.supportsToolUse).toBe(false);
        expect(model.inputCostPerToken).toBeUndefined();
        expect(model.outputCostPerToken).toBeUndefined();
      }
    });

    it('derives Go static models strictly from Go route keys', () => {
      expect(OPENCODE_GO_STATIC_MODELS).toHaveLength(31);
      for (const model of OPENCODE_GO_STATIC_MODELS) {
        expect(
          Object.prototype.hasOwnProperty.call(
            OPENCODE_MODEL_ROUTES['opencode-go'],
            model.id,
          ),
        ).toBe(true);
        expect(model.name).toBe(model.id);
        expect(model.contextLength).toBe(0);
        expect(model.supportsToolUse).toBe(false);
        expect(model.inputCostPerToken).toBeUndefined();
        expect(model.outputCostPerToken).toBeUndefined();
      }
    });
  });

  describe('default tiers', () => {
    it('names IDs in Zen defaultTiers that exist in Zen route table', () => {
      expect(OPENCODE_ZEN_DEFAULT_TIERS).toEqual({
        sonnet: 'claude-sonnet-5',
        opus: 'claude-opus-5',
        haiku: 'claude-haiku-4-5',
      });

      for (const [_tier, modelId] of Object.entries(
        OPENCODE_ZEN_DEFAULT_TIERS,
      )) {
        const protocol = getOpenCodeModelProtocol('opencode-zen', modelId);
        expect(protocol).toBeDefined();
        expect(protocol).toBe('messages');
      }
    });

    it('names IDs in Go defaultTiers that exist in Go route table', () => {
      expect(OPENCODE_GO_DEFAULT_TIERS).toEqual({
        sonnet: 'glm-5.3',
        opus: 'kimi-k3',
        haiku: 'glm-5.3-flash',
      });

      for (const [_tier, modelId] of Object.entries(
        OPENCODE_GO_DEFAULT_TIERS,
      )) {
        const protocol = getOpenCodeModelProtocol('opencode-go', modelId);
        expect(protocol).toBeDefined();
        expect(protocol).toBe('chat/completions');
      }
    });
  });

  describe('pricing and subscription policy', () => {
    it('identifies OpenCode Go as a subscription-covered provider', () => {
      expect(isSubscriptionCoveredProvider('opencode-go')).toBe(true);
    });

    it('identifies OpenCode Zen as not subscription-covered (usage-billed)', () => {
      expect(isSubscriptionCoveredProvider('opencode-zen')).toBe(false);
    });

    it('seedStaticModelPricing("opencode-go") writes nothing to the pricing map', () => {
      const beforeKeys = Object.keys(getPricingMap());

      seedStaticModelPricing('opencode-go');

      const afterMap = getPricingMap();
      const afterKeys = Object.keys(afterMap);

      expect(afterKeys).toEqual(beforeKeys);

      // Verify specific Go model IDs were not seeded
      expect(afterMap['glm-5.3']).toBeUndefined();
      expect(afterMap['kimi-k3']).toBeUndefined();
      expect(afterMap['minimax-m3']).toBeUndefined();
    });

    it('seedStaticModelPricing("opencode-zen") writes nothing because cost fields are omitted', () => {
      const beforeKeys = Object.keys(getPricingMap());

      seedStaticModelPricing('opencode-zen');

      const afterMap = getPricingMap();
      const afterKeys = Object.keys(afterMap);

      expect(afterKeys).toEqual(beforeKeys);
      expect(afterMap['claude-sonnet-5']).toBeUndefined();
    });
  });
});
