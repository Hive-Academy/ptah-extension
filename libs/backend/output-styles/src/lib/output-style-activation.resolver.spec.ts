/**
 * R3 / Req 5.3 — "applied exactly once" is proven STRUCTURALLY here, not by
 * counting occurrences downstream: `inject` is the complement of `fileVisible`,
 * so the truth table below is exhaustive over the one axis that still varies.
 *
 * That axis used to be a base URL, tested here against a localhost regex this
 * lib duplicated out of `sdk-query-options-builder.ts` — with a drift guard
 * that read the builder's source and compared the two literals. Both are gone:
 * the predicate is now `includesUserSettingSource` in `shared`, called by the
 * builder to BUILD `settingSources` and by this lib's callers to predict it, so
 * there is one definition and nothing to drift. The URL cases moved to that
 * function's own spec; what is left here is the decision itself.
 *
 * The last block is the surviving guard: the builder must still call the shared
 * predicate rather than re-inline a regex.
 */
import { existsSync, readFileSync } from 'fs';
import * as path from 'path';
import type {
  ActivationDecision,
  OutputStyleEntry,
  OutputStyleTier,
} from '@ptah-extension/shared';
import {
  OutputStyleActivationResolver,
  resolveActivation,
} from './output-style-activation.resolver';

const STYLE_BODY = 'Answer in short sentences.';

const BUILDER_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  'agent-sdk',
  'src',
  'lib',
  'helpers',
  'sdk-query-options-builder.ts',
);

function makeStyle(tier: OutputStyleTier): OutputStyleEntry {
  return {
    name: `Style-${tier}`,
    tier,
    description: `A ${tier} style.`,
    keepCodingInstructions: true,
    editable: tier === 'user' || tier === 'project',
    deletable: tier === 'user' || tier === 'project',
    body: STYLE_BODY,
  };
}

const TIERS: readonly OutputStyleTier[] = [
  'user',
  'project',
  'plugin',
  'builtin',
];

/** 4 tiers × user-tier visible/not = the whole space (§3.4). */
const TRUTH_TABLE: ReadonlyArray<{
  tier: OutputStyleTier;
  userSettingSourceIncluded: boolean;
}> = TIERS.flatMap((tier) =>
  [true, false].map((userSettingSourceIncluded) => ({
    tier,
    userSettingSourceIncluded,
  })),
);

describe('resolveActivation', () => {
  it('covers every combination of the one surviving axis', () => {
    expect(TRUTH_TABLE).toHaveLength(8);
  });

  it.each(TRUTH_TABLE)(
    'tier=$tier userSettingSourceIncluded=$userSettingSourceIncluded',
    ({ tier, userSettingSourceIncluded }) => {
      const decision = resolveActivation({
        style: makeStyle(tier),
        userSettingSourceIncluded,
      });

      // Invariant 1 — the single surviving axis.
      const expectInject = tier === 'user' && !userSettingSourceIncluded;
      expect(decision.path).toBe(expectInject ? 'inject' : 'flag');

      // Invariant 2 — the branches are structurally disjoint.
      if (decision.path === 'flag') {
        expect('body' in decision).toBe(false);
        expect(decision.styleName).toBe(`Style-${tier}`);
      } else if (decision.path === 'inject') {
        expect(decision.body).toBe(STYLE_BODY);
      }

      // Invariant 3 — 'inert' was deleted from the union as unreachable (G5).
      expect(decision.path).not.toBe('inert');
      expect(['none', 'flag', 'inject']).toContain(decision.path);
    },
  );

  it('returns "none" when no style is selected', () => {
    const decision = resolveActivation({
      style: null,
      userSettingSourceIncluded: false,
    });

    expect(decision).toEqual<ActivationDecision>({ path: 'none' });
  });

  describe('Req 5.1 — a project style never injects', () => {
    it.each([true, false])(
      'uses the flag tier with userSettingSourceIncluded=%s',
      (userSettingSourceIncluded) => {
        const decision = resolveActivation({
          style: makeStyle('project'),
          userSettingSourceIncluded,
        });

        expect(decision.path).toBe('flag');
      },
    );
  });

  describe('Req 5.2 — a user style injects only when its file is invisible', () => {
    it('injects when the user setting source is dropped', () => {
      const decision = resolveActivation({
        style: makeStyle('user'),
        userSettingSourceIncluded: false,
      });

      expect(decision.path).toBe('inject');
      if (decision.path === 'inject') expect(decision.body).toBe(STYLE_BODY);
    });

    it('uses the flag tier when the user setting source is kept', () => {
      const decision = resolveActivation({
        style: makeStyle('user'),
        userSettingSourceIncluded: true,
      });

      expect(decision.path).toBe('flag');
    });
  });

  it('never injects a built-in, even when the user tier is dropped (G5)', () => {
    const decision = resolveActivation({
      style: { ...makeStyle('builtin'), name: 'Learning', body: undefined },
      userSettingSourceIncluded: false,
    });

    expect(decision.path).toBe('flag');
    if (decision.path === 'flag') expect(decision.styleName).toBe('Learning');
  });

  it('never injects a plugin style, even when the user tier is dropped', () => {
    const decision = resolveActivation({
      style: makeStyle('plugin'),
      userSettingSourceIncluded: false,
    });

    expect(decision.path).toBe('flag');
  });
});

describe('OutputStyleActivationResolver', () => {
  it('delegates to the pure function without adding a second decision point', () => {
    const resolver = new OutputStyleActivationResolver();
    const input = {
      style: makeStyle('user'),
      userSettingSourceIncluded: false,
    };

    expect(resolver.resolve(input)).toEqual(resolveActivation(input));
    expect(resolver.resolve(input).path).toBe('inject');
  });
});

describe('settingSources predicate — single-definition guard', () => {
  it('the SDK builder derives settingSources from the shared predicate', () => {
    expect(existsSync(BUILDER_PATH)).toBe(true);

    const builderSource = readFileSync(BUILDER_PATH, 'utf8');

    // A unit test of `includesUserSettingSource` cannot see whether the builder
    // still USES it. If this fails, the builder re-inlined the decision and
    // this lib's prediction can silently disagree with it again.
    expect(builderSource).toContain(
      'settingSources: includesUserSettingSource(',
    );
  });

  it('the SDK builder no longer carries its own localhost literal', () => {
    const builderSource = readFileSync(BUILDER_PATH, 'utf8');

    // Guards the reverse regression: the predicate is re-added ALONGSIDE the
    // shared call, so both exist and only one is honoured.
    expect(builderSource).not.toContain('(127\\.0\\.0\\.1|localhost)');
  });
});
