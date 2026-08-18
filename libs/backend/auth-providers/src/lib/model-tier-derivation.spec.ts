/**
 * `deriveTiersFromCatalog` — the rule that turns a provider's own catalogue
 * into Opus/Sonnet/Haiku ids (TASK_2026_262).
 *
 * This is the highest-risk piece of the change, because a wrong-but-servable
 * model is worse than a 404: the 404 is loud and the wrong model is silent.
 * So these pin the rule's four promises rather than its convenient cases:
 *
 *   1. Every returned id is `===` an id from the input array. Nothing is
 *      synthesised, ever — that is what keeps "no invented model ids" true by
 *      construction rather than by review.
 *   2. It is total: an empty, malformed or unrankable catalogue produces a
 *      defined value ({} or a single repeated id), never a throw.
 *   3. It is deterministic and order-independent: shuffling the catalogue
 *      cannot change the answer.
 *   4. It is provider-agnostic. There is no provider id in the source, so the
 *      fixtures below are SHAPES (a broad router, a two-model local server),
 *      not providers.
 */

import type { ProviderModelInfo } from '@ptah-extension/shared';

import { deriveTiersFromCatalog } from './model-tier-derivation';

function model(
  id: string,
  overrides: Partial<ProviderModelInfo> = {},
): ProviderModelInfo {
  return {
    id,
    name: id,
    description: '',
    contextLength: 0,
    supportsToolUse: true,
    ...overrides,
  };
}

/**
 * Router shape: a broad catalogue that carries several vendors' models, prices
 * them, reports per-model context windows, and marks tool support. OpenRouter
 * is the live example; nothing here depends on that.
 */
const ROUTER_CATALOG: ProviderModelInfo[] = [
  model('anthropic/claude-opus-4.5', { contextLength: 200_000 }),
  model('anthropic/claude-opus-4.1', { contextLength: 200_000 }),
  model('anthropic/claude-sonnet-4.5', { contextLength: 1_000_000 }),
  model('anthropic/claude-haiku-4.5', { contextLength: 200_000 }),
  model('openai/gpt-5.3-codex', { contextLength: 400_000 }),
  model('google/gemini-3-pro', { contextLength: 2_000_000 }),
  model('meta-llama/llama-4-scout', { contextLength: 10_000_000 }),
  // Not agent-usable: no tool support. Must never be selected while
  // tool-capable entries exist.
  model('black-forest-labs/flux-1.1-pro', {
    contextLength: 8_000_000,
    supportsToolUse: false,
  }),
];

/**
 * Local-server shape: exactly what `LocalModelTranslationProxy.listModels`
 * produces for LM Studio — no pricing, `supportsToolUse: false` for every
 * entry, and the same hardcoded `contextLength` on all of them
 * (`local-model-translation-proxy.ts:148-154`).
 */
const LOCAL_CATALOG: ProviderModelInfo[] = [
  model('qwen3-coder-30b', { contextLength: 4096, supportsToolUse: false }),
  model('gemma-3-12b', { contextLength: 4096, supportsToolUse: false }),
];

describe('deriveTiersFromCatalog', () => {
  describe('a broad router catalogue', () => {
    it('takes each tier from the model that names that tier', () => {
      // The nominal pass. When a catalogue carries a model called "opus",
      // "opus" on that provider means that model — no ranking required, and
      // no chance of a surprising pick.
      expect(deriveTiersFromCatalog(ROUTER_CATALOG)).toEqual({
        opus: 'anthropic/claude-opus-4.5',
        sonnet: 'anthropic/claude-sonnet-4.5',
        haiku: 'anthropic/claude-haiku-4.5',
      });
    });

    it('prefers the greatest id among several models naming the same tier', () => {
      // `.sort().at(-1)` — "newest version sorts last" — the convention
      // inherited from the fetch-path auto-resolver this rule replaced,
      // rather than invented here.
      const derived = deriveTiersFromCatalog(ROUTER_CATALOG);
      expect(derived.opus).toBe('anthropic/claude-opus-4.5');
      expect(derived.opus).not.toBe('anthropic/claude-opus-4.1');
    });

    it('gives the same answer whatever order the provider returned', () => {
      const shuffled = [...ROUTER_CATALOG].reverse();
      expect(deriveTiersFromCatalog(shuffled)).toEqual(
        deriveTiersFromCatalog(ROUTER_CATALOG),
      );
    });

    it('never picks a model that cannot use tools when tool-capable ones exist', () => {
      // `flux-1.1-pro` has the largest context window in the fixture, so a
      // rank-only rule would hand it Opus. An agent cannot use it.
      const derived = deriveTiersFromCatalog(ROUTER_CATALOG);
      expect(Object.values(derived)).not.toContain(
        'black-forest-labs/flux-1.1-pro',
      );
    });
  });

  describe('a catalogue that names no tier at all', () => {
    // The ordinal pass. Nothing here says "opus", so the rule must rank —
    // and must rank on capability, not on price.
    const UNNAMED: ProviderModelInfo[] = [
      model('vendor/small', { contextLength: 8_000 }),
      model('vendor/medium', { contextLength: 128_000 }),
      model('vendor/large', { contextLength: 1_000_000 }),
    ];

    it('ranks by context window: largest is opus, smallest is haiku', () => {
      expect(deriveTiersFromCatalog(UNNAMED)).toEqual({
        opus: 'vendor/large',
        sonnet: 'vendor/medium',
        haiku: 'vendor/small',
      });
    });

    it('leans sonnet toward the capable end on an even-sized catalogue', () => {
      const derived = deriveTiersFromCatalog([
        ...UNNAMED,
        model('vendor/tiny', { contextLength: 4_000 }),
      ]);
      expect(derived.opus).toBe('vendor/large');
      expect(derived.sonnet).toBe('vendor/medium');
      expect(derived.haiku).toBe('vendor/tiny');
    });

    it('fills only the tiers the nominal pass could not', () => {
      // Mixed catalogue: one model names its tier, the rest do not. The named
      // one must win its own tier and the others must be ranked.
      const derived = deriveTiersFromCatalog([
        model('vendor/haiku-mini', { contextLength: 8_000 }),
        model('vendor/big', { contextLength: 1_000_000 }),
        model('vendor/mid', { contextLength: 128_000 }),
      ]);
      expect(derived.haiku).toBe('vendor/haiku-mini');
      expect(derived.opus).toBe('vendor/big');
    });
  });

  describe('a two-model local server', () => {
    it('still produces a mapping even though every entry reports no tool use', () => {
      // A catalogue must not be silenced by its own silence: LM Studio marks
      // everything `supportsToolUse: false`, and those models are exactly the
      // ones the user loaded in order to run an agent against them.
      const derived = deriveTiersFromCatalog(LOCAL_CATALOG);
      expect(Object.keys(derived).sort()).toEqual(['haiku', 'opus', 'sonnet']);
    });

    it('maps every tier to one id rather than inventing a spread from the alphabet', () => {
      // Identical context lengths mean there is nothing to rank by. Three
      // different answers would be three guesses; one answer is one honest
      // choice.
      const derived = deriveTiersFromCatalog(LOCAL_CATALOG);
      expect(new Set(Object.values(derived)).size).toBe(1);
      expect(derived.opus).toBe('gemma-3-12b');
    });

    it('is unchanged by the order the local server listed them in', () => {
      expect(deriveTiersFromCatalog([...LOCAL_CATALOG].reverse())).toEqual(
        deriveTiersFromCatalog(LOCAL_CATALOG),
      );
    });
  });

  describe('catalogues it cannot read', () => {
    it('returns {} for an empty catalogue', () => {
      expect(deriveTiersFromCatalog([])).toEqual({});
    });

    it('returns {} for null and undefined rather than throwing', () => {
      // Reached whenever `readPersistedCatalog` finds nothing — the cold-cache
      // path runs through here on every fresh install.
      expect(deriveTiersFromCatalog(null)).toEqual({});
      expect(deriveTiersFromCatalog(undefined)).toEqual({});
    });

    it('returns {} when no entry carries a usable id', () => {
      const junk = [
        { id: '', name: 'blank' },
        { name: 'no id at all' },
        null,
      ] as unknown as ProviderModelInfo[];
      expect(deriveTiersFromCatalog(junk)).toEqual({});
    });
  });

  describe('the promise that keeps "no invented model ids" true', () => {
    it('only ever returns ids present in the input, across every fixture', () => {
      for (const catalog of [ROUTER_CATALOG, LOCAL_CATALOG]) {
        const ids = new Set(catalog.map((m) => m.id));
        for (const value of Object.values(deriveTiersFromCatalog(catalog))) {
          expect(ids.has(value)).toBe(true);
        }
      }
    });

    it('returns the single id when the catalogue holds exactly one model', () => {
      const derived = deriveTiersFromCatalog([model('vendor/only-one')]);
      expect(derived).toEqual({
        opus: 'vendor/only-one',
        sonnet: 'vendor/only-one',
        haiku: 'vendor/only-one',
      });
    });
  });
});
