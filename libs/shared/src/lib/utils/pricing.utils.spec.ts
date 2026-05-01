/**
 * Unit tests for pricing.utils.ts — dynamic model pricing lookup, cost
 * calculation, context window lookup, and display-name formatting.
 *
 * Covers branches for:
 *   - updatePricingMap / registerProviderPricing / getPricingMap
 *   - findModelPricing: empty input, synthetic tags, exact match, partial
 *     match (both directions), default fallback + warn-once suppression
 *   - calculateMessageCost: zero tokens, cache-inclusive, rounding
 *   - getModelContextWindow: empty, known, unknown (maxTokens undefined)
 *   - getModelPricingDescription: formatting to $/1M tokens
 *   - formatModelDisplayName: every Claude / GPT / Gemini / Kimi / GLM
 *     branch + date-suffix stripping + long-id truncation + empty input
 */

import {
  calculateMessageCost,
  DEFAULT_MODEL_PRICING,
  findModelPricing,
  formatModelDisplayName,
  getModelContextWindow,
  getModelPricingDescription,
  getPricingMap,
  registerProviderPricing,
  updatePricingMap,
} from './pricing.utils';

/**
 * Restore the pricing map to its bundled default between tests. The module
 * owns a private mutable copy, so we reset by re-applying the defaults on top.
 * (The internal merge is additive but re-applying defaults is a no-op since
 * the original keys were already present.)
 */
function resetPricingMap(): void {
  // Clear any dynamic entries that were added during the test by overwriting
  // with the bundled defaults. This is sufficient because all test keys we
  // add below use prefixes that do not collide with the bundled ones.
  updatePricingMap({ ...DEFAULT_MODEL_PRICING });
}

describe('pricing.utils', () => {
  beforeEach(() => {
    resetPricingMap();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('updatePricingMap', () => {
    it('merges new pricing entries into the runtime map', () => {
      updatePricingMap({
        'test-model-x': {
          inputCostPerToken: 1e-6,
          outputCostPerToken: 2e-6,
          provider: 'testco',
        },
      });

      expect(getPricingMap()['test-model-x']).toEqual({
        inputCostPerToken: 1e-6,
        outputCostPerToken: 2e-6,
        provider: 'testco',
      });
    });

    it('returns a cloned pricing map (mutations do not leak)', () => {
      const map = getPricingMap();
      // Mutate the returned map — should not affect internal state.
      (map as Record<string, unknown>)['mutant'] = { inputCostPerToken: 999 };

      const mapAgain = getPricingMap();
      expect((mapAgain as Record<string, unknown>)['mutant']).toBeUndefined();
    });
  });

  describe('registerProviderPricing', () => {
    it('is a no-op for empty / undefined input', () => {
      const before = getPricingMap();
      registerProviderPricing({});
      registerProviderPricing(
        undefined as unknown as Record<string, typeof before.default>,
      );
      expect(getPricingMap()).toEqual(before);
    });

    it('adds both exact and lowercase keys when casing differs', () => {
      registerProviderPricing({
        'MixedCase-Model': {
          inputCostPerToken: 5e-6,
          outputCostPerToken: 10e-6,
          provider: 'custom',
        },
      });

      const map = getPricingMap();
      expect(map['MixedCase-Model']).toBeDefined();
      expect(map['mixedcase-model']).toBeDefined();
      expect(map['mixedcase-model']).toEqual(map['MixedCase-Model']);
    });

    it('does not duplicate keys when the id is already lowercase', () => {
      registerProviderPricing({
        'all-lower': {
          inputCostPerToken: 1e-6,
          outputCostPerToken: 2e-6,
          provider: 'x',
        },
      });

      const map = getPricingMap();
      expect(map['all-lower']).toBeDefined();
    });
  });

  describe('findModelPricing', () => {
    it('returns default when model id is empty', () => {
      const pricing = findModelPricing('');
      expect(pricing).toEqual(DEFAULT_MODEL_PRICING['default']);
    });

    it('returns default silently for synthetic SDK ids like <synthetic>', () => {
      const pricing = findModelPricing('<synthetic>');
      expect(pricing).toEqual(DEFAULT_MODEL_PRICING['default']);
      expect(console.warn).not.toHaveBeenCalled();
    });

    it('resolves exact match (case-insensitive)', () => {
      const pricing = findModelPricing('CLAUDE-OPUS-4-7');
      expect(pricing.provider).toBe('anthropic');
      expect(pricing.inputCostPerToken).toBe(15e-6);
    });

    it('resolves via partial match when modelId contains a known key', () => {
      // "claude-opus-4-5-20251101" includes "claude-opus-4-5" as a substring.
      const pricing = findModelPricing('claude-opus-4-5-20251101');
      expect(pricing.provider).toBe('anthropic');
      expect(pricing.maxTokens).toBe(200_000);
    });

    it('resolves via partial match when a known key contains the modelId', () => {
      // Register a longer key, then look up a shorter substring.
      registerProviderPricing({
        'supermodel-2099-final-edition': {
          inputCostPerToken: 1e-7,
          outputCostPerToken: 2e-7,
          provider: 'future',
        },
      });
      const pricing = findModelPricing('supermodel');
      expect(pricing.provider).toBe('future');
    });

    it('falls back to default and warns once for unknown model ids', () => {
      findModelPricing('totally-unknown-model-xyz');
      findModelPricing('totally-unknown-model-xyz'); // second call should not re-warn

      expect(console.warn).toHaveBeenCalledTimes(1);
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('totally-unknown-model-xyz'),
      );
    });
  });

  describe('calculateMessageCost', () => {
    it('returns 0 for zero tokens', () => {
      expect(
        calculateMessageCost('claude-opus-4-7', { input: 0, output: 0 }),
      ).toBe(0);
    });

    it('computes cost from input + output tokens', () => {
      // claude-opus-4-7: 15e-6 input, 75e-6 output
      // 1000 input + 500 output = 0.015 + 0.0375 = 0.0525
      const cost = calculateMessageCost('claude-opus-4-7', {
        input: 1000,
        output: 500,
      });
      expect(cost).toBeCloseTo(0.0525, 6);
    });

    it('includes cache read + cache creation tokens when provided', () => {
      const cost = calculateMessageCost('claude-opus-4-7', {
        input: 100,
        output: 50,
        cacheHit: 1000, // 1000 * 1.5e-6 = 0.0015
        cacheCreation: 400, // 400 * 18.75e-6 = 0.0075
      });
      // input 100 * 15e-6 = 0.0015
      // output 50 * 75e-6 = 0.00375
      // total = 0.0015 + 0.00375 + 0.0015 + 0.0075 = 0.01425
      expect(cost).toBeCloseTo(0.01425, 6);
    });

    it('treats missing cache pricing as zero', () => {
      // claude-3-haiku-20240307 has no cache pricing fields.
      const cost = calculateMessageCost('claude-3-haiku-20240307', {
        input: 1000,
        output: 500,
        cacheHit: 10000,
        cacheCreation: 10000,
      });
      // Only input/output counted: 1000*0.25e-6 + 500*1.25e-6
      //                          = 0.00025 + 0.000625 = 0.000875
      expect(cost).toBeCloseTo(0.000875, 6);
    });

    it('rounds to 6 decimal places (sub-cent accuracy)', () => {
      const cost = calculateMessageCost('claude-opus-4-7', {
        input: 1,
        output: 0,
      }); // 1 * 15e-6 = 0.000015 → 6 decimals
      expect(cost).toBe(0.000015);
    });
  });

  describe('getModelContextWindow', () => {
    it('returns 0 for empty model id', () => {
      expect(getModelContextWindow('')).toBe(0);
    });

    it('returns maxTokens for a known model', () => {
      expect(getModelContextWindow('claude-opus-4-7')).toBe(1_000_000);
      expect(getModelContextWindow('gpt-4o')).toBe(128_000);
    });

    it('returns 0 when pricing entry has no maxTokens field', () => {
      // The "local" and ":cloud" entries do not set maxTokens.
      expect(getModelContextWindow('local')).toBe(0);
    });
  });

  describe('getModelPricingDescription', () => {
    it('formats pricing as $X/1M per input/output', () => {
      expect(getModelPricingDescription('claude-opus-4-7')).toBe(
        'Input: $15.00/1M, Output: $75.00/1M',
      );
    });

    it('formats zero-priced models as $0.00/1M', () => {
      expect(getModelPricingDescription('local')).toBe(
        'Input: $0.00/1M, Output: $0.00/1M',
      );
    });
  });

  describe('formatModelDisplayName', () => {
    it('returns "Unknown" for empty input', () => {
      expect(formatModelDisplayName('')).toBe('Unknown');
    });

    it.each([
      ['claude-opus-4-7', 'Opus 4.7'],
      ['claude-opus-4-6-20250623', 'Opus 4.6'],
      ['claude-opus-4-5-20251101', 'Opus 4.5'],
      ['claude-opus-4-20250514', 'Opus 4'],
      ['claude-3-opus-20240229', 'Opus 3'],
      ['some-opus-model-unmapped', 'Opus'],
    ])('formats Claude Opus variant %s as %s', (id, expected) => {
      expect(formatModelDisplayName(id)).toBe(expected);
    });

    it.each([
      ['claude-sonnet-4-6-20250514', 'Sonnet 4.6'],
      ['claude-sonnet-4-5-20250929', 'Sonnet 4.5'],
      ['claude-sonnet-4-20250219', 'Sonnet 4'],
      ['claude-3-5-sonnet-20241022', 'Sonnet 3.5'],
      ['plain-sonnet', 'Sonnet'],
    ])('formats Claude Sonnet variant %s as %s', (id, expected) => {
      expect(formatModelDisplayName(id)).toBe(expected);
    });

    it.each([
      ['claude-haiku-4-5-20251001', 'Haiku 4.5'],
      ['claude-3-5-haiku-20241022', 'Haiku 3.5'],
      ['claude-3-haiku-20240307', 'Haiku 3'],
      ['plain-haiku', 'Haiku'],
    ])('formats Claude Haiku variant %s as %s', (id, expected) => {
      expect(formatModelDisplayName(id)).toBe(expected);
    });

    it.each([
      ['gpt-4o-mini', 'GPT-4o Mini'],
      ['gpt-4o-2024-08-06', 'GPT-4o'],
      ['gpt-4-turbo', 'GPT-4 Turbo'],
      ['gpt-4', 'GPT-4'],
      ['gpt-3.5-turbo', 'GPT-3.5'],
    ])('formats OpenAI %s as %s', (id, expected) => {
      expect(formatModelDisplayName(id)).toBe(expected);
    });

    it.each([
      ['gemini-2.5-pro', 'Gemini 2.5 Pro'],
      ['gemini-2.5-flash', 'Gemini 2.5 Flash'],
      ['gemini-2.0-pro', 'Gemini 2.0 Pro'],
      ['gemini-2.0-flash', 'Gemini 2.0 Flash'],
      ['gemini-2', 'Gemini 2'],
      ['gemini-1.5-pro', 'Gemini 1.5 Pro'],
      ['gemini-1.5-flash', 'Gemini 1.5 Flash'],
      ['gemini-nano', 'Gemini'],
    ])('formats Google Gemini %s as %s', (id, expected) => {
      expect(formatModelDisplayName(id)).toBe(expected);
    });

    it.each([
      ['kimi-k2.6-chat', 'Kimi K2.6'],
      ['kimi-k2.5-preview', 'Kimi K2.5'],
      ['kimi-k2-thinking', 'Kimi K2 Thinking'],
      ['kimi-k2', 'Kimi K2'],
    ])('formats Moonshot Kimi %s as %s', (id, expected) => {
      expect(formatModelDisplayName(id)).toBe(expected);
    });

    it.each([
      ['glm-5.1', 'GLM-5.1'],
      ['glm-5-turbo', 'GLM-5 Turbo'],
      ['glm-5-code', 'GLM-5 Code'],
      ['glm-5', 'GLM-5'],
      ['glm-4.7-flash', 'GLM-4.7 Flash'],
      ['glm-4.7-flashx', 'GLM-4.7 FlashX'],
      ['glm-4.7', 'GLM-4.7'],
      ['glm-4.6', 'GLM-4.6'],
      ['glm-4.5-x', 'GLM-4.5-X'],
      ['glm-4.5-airx', 'GLM-4.5 AirX'],
      ['glm-4.5-air', 'GLM-4.5 Air'],
      ['glm-4.5-flash', 'GLM-4.5 Flash'],
      ['glm-4.5', 'GLM-4.5'],
    ])('formats Z.AI GLM %s as %s', (id, expected) => {
      expect(formatModelDisplayName(id)).toBe(expected);
    });

    it('truncates unknown long ids to 30 chars + ellipsis', () => {
      const longId = 'some-very-long-unknown-model-id-that-exceeds-thirty';
      expect(formatModelDisplayName(longId)).toBe(
        longId.substring(0, 30) + '...',
      );
    });

    it('returns short unknown ids untouched', () => {
      expect(formatModelDisplayName('mystery-42')).toBe('mystery-42');
    });
  });
});
