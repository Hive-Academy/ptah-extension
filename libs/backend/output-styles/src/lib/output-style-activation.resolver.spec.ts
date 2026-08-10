/**
 * R3 / Req 5.3 — "applied exactly once" is proven STRUCTURALLY here, not by
 * counting occurrences downstream: `inject` is the complement of `fileVisible`,
 * so the truth table below is exhaustive over the one axis that still varies.
 *
 * The last block is a DRIFT GUARD. `LOCALHOST_BASE_URL_RE` is a deliberate
 * duplicate of the predicate in `sdk-query-options-builder.ts` (output-styles
 * must not depend on agent-sdk), so this spec reads the builder's source and
 * fails if the two literals separate. Do not relax it to make it pass — if the
 * builder's regex moved, this resolver has to move with it.
 */
import { existsSync, readFileSync } from 'fs';
import * as path from 'path';
import type {
  ActivationDecision,
  OutputStyleEntry,
  OutputStyleTier,
} from '@ptah-extension/shared';
import {
  LOCALHOST_BASE_URL_RE,
  OutputStyleActivationResolver,
  resolveActivation,
} from './output-style-activation.resolver';

const STYLE_BODY = 'Answer in short sentences.';
const LOCALHOST_URL = 'http://127.0.0.1:11434';
const REMOTE_URL = 'https://api.anthropic.com';

/** The exact literal `sdk-query-options-builder.ts` uses for the same decision. */
const BUILDER_PREDICATE_SOURCE = String.raw`^https?:\/\/(127\.0\.0\.1|localhost)`;

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

/** 4 tiers × 2 provider kinds = the whole space (§3.4, shrunk from 30 by rev 2). */
const TRUTH_TABLE: ReadonlyArray<{
  tier: OutputStyleTier;
  isLocalhost: boolean;
}> = TIERS.flatMap((tier) =>
  [true, false].map((isLocalhost) => ({ tier, isLocalhost })),
);

describe('resolveActivation', () => {
  it('covers every combination of the one surviving axis', () => {
    expect(TRUTH_TABLE).toHaveLength(8);
  });

  it.each(TRUTH_TABLE)(
    'tier=$tier localhost=$isLocalhost',
    ({ tier, isLocalhost }) => {
      const decision = resolveActivation({
        style: makeStyle(tier),
        providerBaseUrl: isLocalhost ? LOCALHOST_URL : REMOTE_URL,
      });

      // Invariant 1 — the single surviving axis.
      const expectInject = tier === 'user' && isLocalhost;
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
      providerBaseUrl: LOCALHOST_URL,
    });

    expect(decision).toEqual<ActivationDecision>({ path: 'none' });
  });

  describe('Req 5.1 — a project style never injects, on any provider', () => {
    it.each([
      LOCALHOST_URL,
      'http://localhost:8080',
      REMOTE_URL,
      undefined,
      '',
    ])('baseUrl=%s', (providerBaseUrl) => {
      const decision = resolveActivation({
        style: makeStyle('project'),
        providerBaseUrl,
      });

      expect(decision.path).toBe('flag');
    });
  });

  describe('Req 5.2 — a user style injects only behind a localhost proxy', () => {
    it.each([
      'http://127.0.0.1:11434',
      'http://localhost:1234',
      'https://LOCALHOST:443',
      '  http://127.0.0.1:8000  ',
    ])('injects for %s', (providerBaseUrl) => {
      const decision = resolveActivation({
        style: makeStyle('user'),
        providerBaseUrl,
      });

      expect(decision.path).toBe('inject');
      if (decision.path === 'inject') expect(decision.body).toBe(STYLE_BODY);
    });

    it.each([
      REMOTE_URL,
      'https://api.moonshot.cn/anthropic',
      'http://127.0.0.2:11434',
      'http://not-localhost.example.com',
      undefined,
      '',
    ])('uses the flag tier for %s', (providerBaseUrl) => {
      const decision = resolveActivation({
        style: makeStyle('user'),
        providerBaseUrl,
      });

      expect(decision.path).toBe('flag');
    });
  });

  it('never injects a built-in, even on localhost (G5)', () => {
    const decision = resolveActivation({
      style: { ...makeStyle('builtin'), name: 'Learning', body: undefined },
      providerBaseUrl: LOCALHOST_URL,
    });

    expect(decision.path).toBe('flag');
    if (decision.path === 'flag') expect(decision.styleName).toBe('Learning');
  });

  it('never injects a plugin style, even on localhost', () => {
    const decision = resolveActivation({
      style: makeStyle('plugin'),
      providerBaseUrl: LOCALHOST_URL,
    });

    expect(decision.path).toBe('flag');
  });
});

describe('OutputStyleActivationResolver', () => {
  it('delegates to the pure function without adding a second decision point', () => {
    const resolver = new OutputStyleActivationResolver();
    const input = {
      style: makeStyle('user'),
      providerBaseUrl: LOCALHOST_URL,
    };

    expect(resolver.resolve(input)).toEqual(resolveActivation(input));
    expect(resolver.resolve(input).path).toBe('inject');
  });
});

describe('LOCALHOST_BASE_URL_RE — drift guard', () => {
  it('is the literal this resolver was written against', () => {
    expect(LOCALHOST_BASE_URL_RE.source).toBe(BUILDER_PREDICATE_SOURCE);
    expect(LOCALHOST_BASE_URL_RE.flags).toContain('i');
  });

  it('still matches the predicate in sdk-query-options-builder.ts', () => {
    expect(existsSync(BUILDER_PATH)).toBe(true);

    const builderSource = readFileSync(BUILDER_PATH, 'utf8');

    // If this fails, the builder's settingSources predicate changed. Mirror the
    // change here — do NOT weaken the assertion.
    expect(builderSource).toContain(`/${BUILDER_PREDICATE_SOURCE}/i`);
  });

  it('is stateless across calls (no global flag)', () => {
    expect(LOCALHOST_BASE_URL_RE.global).toBe(false);
    expect(LOCALHOST_BASE_URL_RE.test(LOCALHOST_URL)).toBe(true);
    expect(LOCALHOST_BASE_URL_RE.test(LOCALHOST_URL)).toBe(true);
  });
});
