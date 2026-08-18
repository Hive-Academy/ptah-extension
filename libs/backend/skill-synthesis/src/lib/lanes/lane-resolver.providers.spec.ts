/**
 * LaneResolverService — provider-agnosticism specs (P1-4).
 *
 * ## Why the body of this file contains ZERO provider-id literals
 *
 * That is the assertion, not a formatting rule. Every case is generated from
 * `ANTHROPIC_PROVIDERS`, so a provider added to the registry tomorrow is
 * covered the day it lands, and a lane that grew a special case for one vendor
 * fails here without anyone remembering to add a test for it. A spec that
 * named providers by hand would pass forever while the code drifted, which is
 * exactly how "no provider is privileged" invariants rot.
 *
 * ## Scope: this file tests THIS side of the seam
 *
 * The credential-building half — `buildLaneEnv` stripping `CHAT_AUTH_KEYS`,
 * `buildTierValues` reading the `'lane'` scope — lives in `auth-providers`
 * and is pinned by its own spec. `skill-synthesis` deliberately cannot import
 * it (that edge would close the `skill-synthesis → agent-sdk → …` cycle), so
 * what is asserted here is the contract this library owns: it asks the
 * resolver for the right thing, and it hands what comes back through
 * COMPLETELY UNTOUCHED.
 *
 * "Untouched" is the load-bearing half. Risk R2 is that a lane env's stripped
 * keys are carried as present-but-`undefined` properties, and that ANY
 * normalisation on the way through — a JSON round-trip, `structuredClone`, a
 * Zod parse, a truthiness filter, an object rebuild — drops them and silently
 * re-leaks the foreground provider's credentials into background work. The
 * `hasOwnProperty` assertions below fail on all of those; `toBeUndefined()`
 * alone would pass on every one.
 */
import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import {
  ANTHROPIC_PROVIDERS,
  getProviderBaseUrl,
} from '@ptah-extension/shared';
import { resolveJudgeModel } from '../model-resolver';
import type { LaneAuthOverride } from './lane.types';
import { SKILL_LANE_IDS } from './lane.types';
import { SKILL_LANE_KEYS } from './skill-lane-config';
import { LaneResolverService, resolveLaneModel } from './lane-resolver.service';

const PROVIDER_IDS = ANTHROPIC_PROVIDERS.map((p) => p.id);

/** Keys the foreground chat session owns and a lane must never inherit. */
const CHAT_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
] as const;

const CHAT_SENTINEL = 'FOREGROUND-CHAT-VALUE-MUST-NOT-LEAK';

const logger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as unknown as Logger;

function makeWorkspace(stored: Record<string, unknown>): IWorkspaceProvider {
  return {
    getConfiguration: jest.fn(
      (_section: string, key: string, fallback?: unknown) =>
        Object.prototype.hasOwnProperty.call(stored, key)
          ? stored[key]
          : fallback,
    ),
    getWorkspaceRoot: jest.fn(() => '/ws'),
  } as unknown as IWorkspaceProvider;
}

/**
 * Stands in for `ProviderAuthResolver`, reproducing the one structural
 * property of its output that matters here: stripped chat keys are PRESENT
 * with value `undefined`, never deleted.
 */
function laneOverrideFor(providerId: string): LaneAuthOverride {
  const env: Record<string, string | undefined> = {};
  for (const key of CHAT_KEYS) env[key] = undefined;
  env['ANTHROPIC_BASE_URL'] = getProviderBaseUrl(providerId);
  return { env, baseUrl: getProviderBaseUrl(providerId) };
}

function resolverFor(providerId: string) {
  return {
    resolve: jest.fn(async () => laneOverrideFor(providerId)),
  };
}

/** Seed the ambient env with foreground values, the way a live session would. */
function withChatEnv<T>(run: () => T): T {
  const saved = CHAT_KEYS.map(
    (k) => [k, process.env[k]] as [string, string | undefined],
  );
  for (const k of CHAT_KEYS) process.env[k] = CHAT_SENTINEL;
  try {
    return run();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

beforeEach(() => jest.clearAllMocks());

describe.each(PROVIDER_IDS)('lane pointed at registry provider %s', (id) => {
  function resolveOn(laneId: (typeof SKILL_LANE_IDS)[number] = 'judge') {
    const resolver = resolverFor(id);
    const svc = new LaneResolverService(
      logger,
      makeWorkspace({ [SKILL_LANE_KEYS[laneId].provider]: id }),
      resolver,
    );
    return { svc, resolver, laneId };
  }

  it('asks the resolver for exactly this id, on the lane scope', async () => {
    const { svc, resolver } = resolveOn();
    await svc.resolve('judge');
    expect(resolver.resolve).toHaveBeenCalledWith(id, 'lane');
  });

  it('carries the provider s own base url through to the lane', async () => {
    const { svc } = resolveOn();
    const out = await svc.resolve('judge');
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.lane.auth?.env['ANTHROPIC_BASE_URL']).toBe(
      getProviderBaseUrl(id),
    );
  });

  it('preserves stripped keys as PRESENT-with-undefined, not deleted (R2)', async () => {
    const { svc } = resolveOn();
    const out = await svc.resolve('judge');
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const env = out.lane.auth?.env ?? {};

    for (const key of CHAT_KEYS) {
      if (key === 'ANTHROPIC_BASE_URL') continue; // repopulated by the provider
      // `toBeUndefined()` alone would pass on a deleted key too — which is the
      // silent-leak shape. Ownership is what actually blanks the ambient value.
      expect(Object.prototype.hasOwnProperty.call(env, key)).toBe(true);
      expect(env[key]).toBeUndefined();
    }
  });

  it('lets no key of the lane env carry a foreground chat value', async () => {
    await withChatEnv(async () => {
      const { svc } = resolveOn();
      const out = await svc.resolve('judge');
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      const values = Object.values(out.lane.auth?.env ?? {});
      expect(values).not.toContain(CHAT_SENTINEL);
    });
  });

  it('sends a bare tier alias, never a hardcoded model id, when only a provider is set', async () => {
    const { svc } = resolveOn();
    const out = await svc.resolve('judge');
    // The lane declared no model, so the tier alias travels. A pinned dated
    // Claude id could not: the lane env's `ANTHROPIC_DEFAULT_*_MODEL` keys are
    // blanked by design (R2), leaving it no mapping to travel through.
    //
    // What the alias resolves to downstream is the PROVIDER'S business, not
    // this lib's, and it is not guaranteed: `ModelResolver` maps it through the
    // entry's `defaultTiers`, which three registry entries deliberately omit
    // (`openrouter`, `lm-studio`, `requesty` — dynamic catalogue, locally
    // loaded model, unverifiable tier map respectively). On those the alias
    // goes out verbatim too. That is a product-wide gap for dynamic-catalogue
    // providers — the foreground chat sends a bare `'opus'` in the same
    // situation — and NOT something a different value here would fix. Pinned in
    // `auth-providers/src/lib/auth/model-resolver.spec.ts`.
    expect(out.ok && out.lane.model).toBe('haiku');
  });

  it.each(SKILL_LANE_IDS)(
    'behaves identically on lane %s — lanes differ by capability, not by provider',
    async (laneId) => {
      const { svc, resolver } = resolveOn(laneId);
      const out = await svc.resolve(laneId);
      expect(resolver.resolve).toHaveBeenCalledWith(id, 'lane');
      expect(out.ok && out.lane.auth?.baseUrl).toBe(getProviderBaseUrl(id));
    },
  );
});

describe('registry coverage', () => {
  it('is parameterized over a non-empty registry', () => {
    // Guards against the whole `describe.each` silently generating zero cases,
    // which would make every assertion above vacuous while still reporting green.
    expect(PROVIDER_IDS.length).toBeGreaterThan(0);
  });

  it('routes proxy-requiring providers through the resolver like any other', () => {
    // `requiresProxy` providers reach `CuratorProxyManager` inside the
    // resolver. This library has exactly one obligation there — never bypass
    // the resolver — so the only thing to assert is that no branch here
    // distinguishes them.
    // `requiresProxy` is declared on only some registry entries, so the union
    // does not carry it — narrow with `in` rather than widening the registry.
    const proxied = ANTHROPIC_PROVIDERS.filter(
      (p) => 'requiresProxy' in p && p.requiresProxy === true,
    );
    expect(proxied.length).toBeGreaterThan(0);
    const source = LaneResolverService.prototype.resolve.toString();
    for (const p of proxied) {
      expect(source).not.toContain(p.id);
    }
  });

  it('names no registry provider anywhere in the model-resolution chain', () => {
    // Global invariant 1, enforced against the compiled function bodies rather
    // than by review.
    //
    // The two FREE functions are here deliberately (TASK_2026_250 follow-up A).
    // This scan used to cover the three prototype methods only, while
    // `resolveLaneModel` and `resolveJudgeModel` — the functions that actually
    // decide the model string, and the ones that grew a settings-key read in
    // TASK_2026_250 — sat outside it. `skill-synthesis/CLAUDE.md` cited this
    // spec as pinning the invariant "mechanically", which was an overclaim for
    // exactly the code most likely to break it.
    //
    // `Function.prototype.toString` returns the body only, so the docblocks
    // above these functions are NOT scanned — which is what makes the scan
    // usable at all, since those docblocks legitimately name the three registry
    // entries that declare no `defaultTiers`. Code, not prose, is the subject.
    const source = [
      LaneResolverService.prototype.resolve.toString(),
      LaneResolverService.prototype.readConfig.toString(),
      LaneResolverService.prototype.readConfigs.toString(),
      resolveLaneModel.toString(),
      resolveJudgeModel.toString(),
    ]
      .join('\n')
      .toLowerCase();
    const leaked = PROVIDER_IDS.filter((p) => source.includes(p.toLowerCase()));
    expect(leaked).toEqual([]);
  });
});
