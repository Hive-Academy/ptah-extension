/**
 * Unit tests for pricing.utils.ts — dynamic model pricing lookup, cost
 * calculation, context window lookup, and display-name formatting.
 */

import {
  calculateMessageCost,
  DEFAULT_MODEL_PRICING,
  findModelPricing,
  formatClaudeModelDisplayName,
  getModelContextWindow,
  getModelPricingDescription,
  getPricingMap,
  registerProviderPricing,
  resolveModelDisplayName,
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
    it('returns null when model id is empty', () => {
      expect(findModelPricing('')).toBeNull();
    });

    it('returns null silently for synthetic SDK ids like <synthetic>', () => {
      expect(findModelPricing('<synthetic>')).toBeNull();
      expect(console.warn).not.toHaveBeenCalled();
    });

    it('resolves exact match (case-insensitive)', () => {
      const pricing = findModelPricing('GPT-4O');
      expect(pricing).not.toBeNull();
      expect(pricing?.provider).toBe('openai');
      expect(pricing?.inputCostPerToken).toBe(2.5e-6);
    });

    it('resolves via partial match when modelId contains a known key', () => {
      const pricing = findModelPricing('gpt-4o-2024-08-06');
      expect(pricing).not.toBeNull();
      expect(pricing?.provider).toBe('openai');
      expect(pricing?.maxTokens).toBe(128_000);
    });

    it('resolves via partial match when a known key contains the modelId', () => {
      registerProviderPricing({
        'supermodel-2099-final-edition': {
          inputCostPerToken: 1e-7,
          outputCostPerToken: 2e-7,
          provider: 'future',
        },
      });
      const pricing = findModelPricing('supermodel');
      expect(pricing?.provider).toBe('future');
    });

    it('returns null and warns once for unknown model ids', () => {
      expect(findModelPricing('totally-unknown-model-xyz')).toBeNull();
      expect(findModelPricing('totally-unknown-model-xyz')).toBeNull();

      expect(console.warn).toHaveBeenCalledTimes(1);
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('totally-unknown-model-xyz'),
      );
    });
  });

  describe('calculateMessageCost', () => {
    it('returns 0 for zero tokens on a known model', () => {
      expect(calculateMessageCost('gpt-4o', { input: 0, output: 0 })).toBe(0);
    });

    it('returns null when the model is unknown (no fabricated fallback)', () => {
      expect(
        calculateMessageCost('totally-unknown-model-xyz', {
          input: 1000,
          output: 500,
        }),
      ).toBeNull();
    });

    it('computes cost from input + output tokens', () => {
      const cost = calculateMessageCost('gpt-4o', {
        input: 1000,
        output: 500,
      });
      expect(cost).toBeCloseTo(0.0075, 6);
    });

    it('includes cache read + cache creation tokens when provided', () => {
      const cost = calculateMessageCost('gpt-4o', {
        input: 100,
        output: 50,
        cacheHit: 1000,
        cacheCreation: 400,
        // gpt-4o has no cacheRead/cacheCreation pricing — both contribute 0.
      });
      // input 100 * 2.5e-6 = 0.00025
      // output 50 * 10e-6 = 0.0005
      // cache fields zero-priced.
      expect(cost).toBeCloseTo(0.00075, 6);
    });

    it('treats missing cache pricing as zero', () => {
      const cost = calculateMessageCost('gpt-3.5-turbo', {
        input: 1000,
        output: 500,
        cacheHit: 10000,
        cacheCreation: 10000,
      });
      // 1000 * 0.5e-6 + 500 * 1.5e-6 = 0.0005 + 0.00075 = 0.00125
      expect(cost).toBeCloseTo(0.00125, 6);
    });

    it('rounds to 6 decimal places (sub-cent accuracy)', () => {
      const cost = calculateMessageCost('gpt-4o-mini', {
        input: 1,
        output: 0,
      });
      // 1 * 0.15e-6 = 0.00000015 → rounded to 6 decimals = 0
      // Use a value that exercises the rounding boundary instead.
      expect(cost).toBe(0);
    });

    it('rounds non-trivial fractional totals to 6 decimal places', () => {
      // 7 input * 2.5e-6 = 0.0000175 → rounds to 0.000018
      const cost = calculateMessageCost('gpt-4o', { input: 7, output: 0 });
      expect(cost).toBe(0.000018);
    });

    it('uses explicit pricing argument without consulting findModelPricing', () => {
      const cost = calculateMessageCost(
        'unknown-third-party-id',
        { input: 1000, output: 500 },
        {
          inputCostPerToken: 10e-6,
          outputCostPerToken: 50e-6,
        },
      );
      // 1000 * 10e-6 + 500 * 50e-6 = 0.01 + 0.025 = 0.035
      expect(cost).toBe(0.035);
    });

    it('returns null when explicit pricing argument is null', () => {
      const cost = calculateMessageCost(
        'gpt-4o',
        { input: 1000, output: 500 },
        null,
      );
      expect(cost).toBeNull();
    });

    it('falls back to findModelPricing when no pricing argument is supplied', () => {
      const cost = calculateMessageCost('gpt-4o', { input: 1000, output: 0 });
      // 1000 * 2.5e-6 = 0.0025
      expect(cost).toBe(0.0025);
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
      expect(getModelPricingDescription('gpt-4o')).toBe(
        'Input: $2.50/1M, Output: $10.00/1M',
      );
    });

    it('formats zero-priced models as $0.00/1M', () => {
      expect(getModelPricingDescription('local')).toBe(
        'Input: $0.00/1M, Output: $0.00/1M',
      );
    });
  });

  describe('formatClaudeModelDisplayName regex', () => {
    it('returns "Unknown" for empty input', () => {
      expect(formatClaudeModelDisplayName('')).toBe('Unknown');
    });

    it.each([
      ['claude-opus-4-7', 'Opus 4.7'],
      ['claude-opus-4-6', 'Opus 4.6'],
      ['claude-opus-4-5', 'Opus 4.5'],
      ['claude-sonnet-4-6', 'Sonnet 4.6'],
      ['claude-haiku-4-5', 'Haiku 4.5'],
      ['claude-opus-4-8', 'Opus 4.8'],
      ['claude-sonnet-5-0', 'Sonnet 5.0'],
    ])('renders modern Claude %s as %s', (id, expected) => {
      expect(formatClaudeModelDisplayName(id)).toBe(expected);
    });

    it.each([
      ['claude-opus-4-7-20250101', 'Opus 4.7'],
      ['claude-sonnet-4-6-20250514', 'Sonnet 4.6'],
      ['claude-haiku-4-5-20251001', 'Haiku 4.5'],
    ])('strips 8-digit date suffix from %s -> %s', (id, expected) => {
      expect(formatClaudeModelDisplayName(id)).toBe(expected);
    });

    it.each([
      ['claude-opus-4-7-2025-01-01', 'Opus 4.7'],
      ['claude-sonnet-4-6-2025-05-14', 'Sonnet 4.6'],
    ])('strips ISO date suffix from %s -> %s', (id, expected) => {
      expect(formatClaudeModelDisplayName(id)).toBe(expected);
    });

    it.each([
      ['claude-3-5-sonnet', 'Sonnet 3.5'],
      ['claude-3-5-haiku', 'Haiku 3.5'],
      ['claude-3-opus', 'Opus 3'],
      ['claude-3-haiku', 'Haiku 3'],
      ['claude-3-5-sonnet-20241022', 'Sonnet 3.5'],
      ['claude-3-opus-20240229', 'Opus 3'],
    ])('renders legacy Claude %s as %s', (id, expected) => {
      expect(formatClaudeModelDisplayName(id)).toBe(expected);
    });

    it.each([
      ['anthropic/claude-opus-4-7', 'Opus 4.7'],
      ['openrouter/claude-sonnet-4-6', 'Sonnet 4.6'],
      ['google/claude-haiku-4-5', 'Haiku 4.5'],
      ['moonshot/claude-opus-4-7', 'Opus 4.7'],
      ['zai/claude-sonnet-4-6', 'Sonnet 4.6'],
    ])('strips provider prefix from %s -> %s', (id, expected) => {
      expect(formatClaudeModelDisplayName(id)).toBe(expected);
    });

    it('renders suffix as parenthetical for experimental builds', () => {
      expect(formatClaudeModelDisplayName('claude-opus-4-7-experimental')).toBe(
        'Opus 4.7 (experimental)',
      );
    });

    it('truncates unknown long ids to 30 chars + ellipsis', () => {
      const longId = 'some-very-long-unknown-model-id-that-exceeds-thirty';
      expect(formatClaudeModelDisplayName(longId)).toBe(
        longId.slice(0, 30) + '...',
      );
    });

    it('returns short unknown non-Claude ids untouched', () => {
      expect(formatClaudeModelDisplayName('mystery-42')).toBe('mystery-42');
    });

    it('strips provider prefix for non-Claude unknowns', () => {
      expect(formatClaudeModelDisplayName('openai/gpt-5.1-codex-max')).toBe(
        'gpt-5.1-codex-max',
      );
    });
  });

  describe('resolveModelDisplayName lookup', () => {
    it('returns "Unknown" for empty input', () => {
      expect(resolveModelDisplayName('')).toBe('Unknown');
    });

    it('returns the live catalog name when the id matches', () => {
      const catalog = [
        { id: 'claude-opus-4-7', name: 'Claude Opus 4.7 (anthropic)' },
        { id: 'anthropic/claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
      ];
      expect(resolveModelDisplayName('claude-opus-4-7', catalog)).toBe(
        'Claude Opus 4.7 (anthropic)',
      );
    });

    it('falls back to the regex when the catalog has no match', () => {
      const catalog = [{ id: 'claude-opus-4-7', name: 'Claude Opus 4.7' }];
      expect(resolveModelDisplayName('claude-sonnet-4-6', catalog)).toBe(
        'Sonnet 4.6',
      );
    });

    it('falls back to the regex when the catalog is undefined', () => {
      expect(resolveModelDisplayName('claude-opus-4-8')).toBe('Opus 4.8');
    });

    it('falls back to the regex when the catalog is an empty array', () => {
      expect(resolveModelDisplayName('claude-haiku-4-5', [])).toBe('Haiku 4.5');
    });
  });
});
