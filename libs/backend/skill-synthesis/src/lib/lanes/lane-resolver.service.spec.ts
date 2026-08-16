/**
 * LaneResolverService — resolution-chain specs (P1-3).
 *
 * Three contracts, in descending order of how expensive they are to get wrong:
 *
 *  1. **`scope === 'lane'` on every call.** The scope is what keeps a lane's
 *     tier mapping separate from the chat provider's, and — because
 *     `ProviderModelsService.setModelTier` guards its `process.env` /
 *     `AuthEnv` writes with `scope === 'mainAgent'` — it is also what makes a
 *     lane inert with respect to globals BY CONSTRUCTION. Passing
 *     `'mainAgent'` here would not fail visibly; it would quietly make
 *     background work read (and eventually write) the user's live chat tiers.
 *  2. **A blank lane is byte-identical to today.** `provider: ''` +
 *     `model: ''` ⇒ `{auth: undefined, model: resolveJudgeModel(...)}`, the
 *     exact call `SkillJudgeService` already makes.
 *  3. **Unresolvable auth stalls, never falls back (Q2).**
 */
import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import { JUDGE_DEFAULT_MODEL_ID } from '../types';
import { LANE_AUTH_RETRY_MS, SKILL_LANE_IDS } from './lane.types';
import { PROVIDER_AUTH_ERROR_NAME } from './lane-auth-resolver.port';
import { SKILL_LANE_DEFAULTS, SKILL_LANE_KEYS } from './skill-lane-config';
import { LaneResolverService, resolveLaneModel } from './lane-resolver.service';

const logger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as unknown as Logger;

function makeWorkspace(
  stored: Record<string, unknown> = {},
): IWorkspaceProvider {
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

function providerAuthError(message: string): Error {
  const err = new Error(message);
  err.name = PROVIDER_AUTH_ERROR_NAME;
  return err;
}

beforeEach(() => jest.clearAllMocks());

describe('LaneResolverService.resolve — tier scope (P1-3)', () => {
  it.each(SKILL_LANE_IDS)(
    'calls the auth resolver once for lane %s with that lane s provider and scope "lane"',
    async (laneId) => {
      const resolve = jest.fn().mockResolvedValue(null);
      const ws = makeWorkspace({
        [SKILL_LANE_KEYS[laneId].provider]: 'configured-id',
      });
      const svc = new LaneResolverService(logger, ws, { resolve });

      await svc.resolve(laneId);

      expect(resolve).toHaveBeenCalledTimes(1);
      expect(resolve).toHaveBeenCalledWith('configured-id', 'lane');
    },
  );

  it('never passes mainAgent — the scope that would touch globals', async () => {
    const resolve = jest.fn().mockResolvedValue(null);
    const ws = makeWorkspace({
      [SKILL_LANE_KEYS.judge.provider]: 'configured-id',
    });
    await new LaneResolverService(logger, ws, { resolve }).resolve('judge');

    const scopes = resolve.mock.calls.map((c: unknown[]) => c[1]);
    expect(scopes).not.toContain('mainAgent');
    expect(scopes).not.toContain('cliAgent');
  });

  it('still consults the resolver for a blank provider, so it decides "active", not us', async () => {
    // `''` means inherit, and the resolver already returns `null` for it. A
    // short-circuit here would be a second place that knows what an empty
    // provider means, and the two would eventually disagree.
    const resolve = jest.fn().mockResolvedValue(null);
    const ws = makeWorkspace();
    await new LaneResolverService(logger, ws, { resolve }).resolve('synthesis');
    expect(resolve).toHaveBeenCalledWith('', 'lane');
  });
});

describe('LaneResolverService.resolve — untouched existing installs', () => {
  it('resolves a fully blank lane to {auth: undefined} and the active provider s model', async () => {
    const resolve = jest.fn().mockResolvedValue(null);
    // The active provider's selected model — the one key on this branch whose
    // value the endpoint the blank lane rides is known to serve. This seeded
    // `llm.vscode.model` until TASK_2026_250, which was a VS Code Language
    // Model `vendor/family` id and belonged to no endpoint reachable here.
    const ws = makeWorkspace({
      'provider.apiKey.selectedModel': 'workspace-pinned-model',
    });
    const out = await new LaneResolverService(logger, ws, { resolve }).resolve(
      'judge',
    );

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.lane.auth).toBeUndefined();
    // Byte-identical to `resolveJudgeModel('inherit', ws)` — today's call.
    expect(out.lane.model).toBe('workspace-pinned-model');
    expect(out.lane.config).toEqual(SKILL_LANE_DEFAULTS.judge);
  });

  it('falls to the shipped judge default when the workspace pins no model', async () => {
    const out = await new LaneResolverService(logger, makeWorkspace(), {
      resolve: jest.fn().mockResolvedValue(null),
    }).resolve('judge');
    expect(out.ok && out.lane.model).toBe(JUDGE_DEFAULT_MODEL_ID);
  });

  it('behaves identically with NO resolver registered (CLI / e2e host)', async () => {
    const ws = makeWorkspace({
      // Even a configured provider cannot be honoured without a resolver;
      // riding the active provider is the correct degradation, not a throw.
      [SKILL_LANE_KEYS.judge.provider]: 'configured-id',
    });
    const out = await new LaneResolverService(logger, ws, null).resolve(
      'judge',
    );
    expect(out.ok).toBe(true);
    expect(out.ok && out.lane.auth).toBeUndefined();
  });
});

describe('resolveLaneModel — the three-line ladder', () => {
  const ws = makeWorkspace({
    'provider.apiKey.selectedModel': 'active-provider-model',
  });

  it('prefers an explicitly pinned lane model', () => {
    expect(
      resolveLaneModel(
        { ...SKILL_LANE_DEFAULTS.judge, model: '  pinned  ' },
        'inherit',
        ws,
      ),
    ).toBe('pinned');
  });

  it('inherits the ACTIVE PROVIDER s model when NEITHER provider nor model is set', () => {
    expect(resolveLaneModel(SKILL_LANE_DEFAULTS.judge, 'inherit', ws)).toBe(
      'active-provider-model',
    );
  });

  it('sends a BARE TIER ALIAS when a provider is set but no model is', () => {
    // A bare alias resolves through ANTHROPIC_DEFAULT_<TIER>_MODEL, and that
    // env var is now populated for the lane's own provider even when the
    // registry entry declares no `defaultTiers`, from that provider's live
    // catalogue (`ProviderAuthResolver.buildTierValues`, TASK_2026_262). A
    // pinned dated Claude id would reach a non-Anthropic endpoint verbatim
    // and 404, because that env var is the ONLY route open on this branch.
    expect(
      resolveLaneModel(
        { ...SKILL_LANE_DEFAULTS.judge, provider: 'configured-id' },
        'inherit',
        ws,
      ),
    ).toBe('haiku');
  });

  it('honours a remapped defaultTier', () => {
    expect(
      resolveLaneModel(
        {
          ...SKILL_LANE_DEFAULTS.judge,
          provider: 'configured-id',
          defaultTier: 'opus',
        },
        'inherit',
        ws,
      ),
    ).toBe('opus');
  });

  it('ships a tier word on every lane — the shape the downstream remap needs', () => {
    // TASK_2026_262 task 2.2. Line 3's value is only servable because
    // `ModelResolver.resolve` maps it through ANTHROPIC_DEFAULT_<TIER>_MODEL,
    // and it does that for exactly three literals. A lane default outside that
    // set would be sent verbatim on every provider, not just the three with no
    // `defaultTiers` — so this is the property that makes "skill-synthesis
    // needed no production change" true, asserted rather than assumed.
    const ENV_MAPPED_TIERS = ['opus', 'sonnet', 'haiku'];
    for (const [laneId, config] of Object.entries(SKILL_LANE_DEFAULTS)) {
      const model = resolveLaneModel(
        { ...config, provider: 'configured-id' },
        'inherit',
        ws,
      );
      expect([laneId, ENV_MAPPED_TIERS.includes(model)]).toEqual([
        laneId,
        true,
      ]);
    }
  });

  it('returns no hardcoded model id of its own on any branch', () => {
    const outputs = [
      resolveLaneModel(SKILL_LANE_DEFAULTS.judge, 'explicit-model', ws),
      resolveLaneModel(
        { ...SKILL_LANE_DEFAULTS.judge, provider: 'p' },
        'inherit',
        ws,
      ),
      resolveLaneModel(
        { ...SKILL_LANE_DEFAULTS.judge, model: 'm' },
        'inherit',
        ws,
      ),
    ];
    // Every value came from settings, the tier field, or the shared legacy
    // resolver — none was minted here.
    expect(outputs).toEqual(['explicit-model', 'haiku', 'm']);
  });
});

describe('LaneResolverService.resolve — auth-unresolvable stalls (Q2)', () => {
  it('returns a failure instead of falling back to the active provider', async () => {
    const resolve = jest
      .fn()
      .mockRejectedValue(providerAuthError('LM Studio is not reachable.'));
    const ws = makeWorkspace({
      [SKILL_LANE_KEYS.archaeologist.provider]: 'configured-id',
    });

    const out = await new LaneResolverService(logger, ws, {
      resolve,
    }).resolve('archaeologist');

    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.failure.kind).toBe('auth-unresolvable');
    expect(out.failure.reason).toBe(
      'Lane archaeologist: LM Studio is not reachable.',
    );
    expect(out.failure.retryAfterMs).toBe(LANE_AUTH_RETRY_MS);
  });

  it('backs off for 30 minutes', () => {
    expect(LANE_AUTH_RETRY_MS).toBe(30 * 60_000);
  });

  it('carries no auth on the failure path — there is nothing to ride', async () => {
    const out = await new LaneResolverService(
      logger,
      makeWorkspace({ [SKILL_LANE_KEYS.judge.provider]: 'configured-id' }),
      { resolve: jest.fn().mockRejectedValue(providerAuthError('nope')) },
    ).resolve('judge');
    expect(out).not.toHaveProperty('lane');
  });

  it('rethrows a NON-auth error rather than burying a bug in a queue reason', async () => {
    const bug = new TypeError('cannot read properties of undefined');
    const svc = new LaneResolverService(
      logger,
      makeWorkspace({ [SKILL_LANE_KEYS.judge.provider]: 'configured-id' }),
      { resolve: jest.fn().mockRejectedValue(bug) },
    );
    await expect(svc.resolve('judge')).rejects.toThrow(bug);
  });
});

describe('LaneResolverService.resolve — the snapshot is passed through, not applied', () => {
  it('returns the resolver s override verbatim', async () => {
    const env = { ANTHROPIC_BASE_URL: 'http://127.0.0.1:1234' };
    const auth = { env, baseUrl: 'http://127.0.0.1:1234' };
    const out = await new LaneResolverService(
      logger,
      makeWorkspace({ [SKILL_LANE_KEYS.synthesis.provider]: 'configured-id' }),
      { resolve: jest.fn().mockResolvedValue(auth) },
    ).resolve('synthesis');

    expect(out.ok && out.lane.auth).toBe(auth);
    expect(out.ok && out.lane.auth?.env).toBe(env);
  });

  it('does not write process.env while resolving', async () => {
    // R1 in miniature: the resolver hands back a value precisely so nothing
    // on this path mutates global auth state.
    const before = JSON.stringify(process.env);
    await new LaneResolverService(
      logger,
      makeWorkspace({ [SKILL_LANE_KEYS.synthesis.provider]: 'configured-id' }),
      {
        resolve: jest.fn().mockResolvedValue({
          env: { ANTHROPIC_API_KEY: 'lane-only-secret' },
        }),
      },
    ).resolve('synthesis');
    expect(JSON.stringify(process.env)).toBe(before);
  });

  it('logs the (provider, baseUrl, tier models) triple — R7 diagnosability', async () => {
    await new LaneResolverService(
      logger,
      makeWorkspace({ [SKILL_LANE_KEYS.replay.provider]: 'configured-id' }),
      {
        resolve: jest.fn().mockResolvedValue({
          env: {
            ANTHROPIC_BASE_URL: 'http://127.0.0.1:11434',
            ANTHROPIC_DEFAULT_HAIKU_MODEL: 'some-small-model',
          },
        }),
      },
    ).resolve('replay');

    expect(logger.debug).toHaveBeenCalledWith(
      '[skill-synthesis] lane resolved',
      expect.objectContaining({
        lane: 'replay',
        providerId: 'configured-id',
        baseUrl: 'http://127.0.0.1:11434',
        tierModels: expect.objectContaining({ haiku: 'some-small-model' }),
      }),
    );
  });
});

describe('LaneResolverService.readConfigs', () => {
  it('reads all four lanes for the drain s stale-claim TTL assertion', () => {
    const lanes = new LaneResolverService(
      logger,
      makeWorkspace(),
      null,
    ).readConfigs();
    expect(Object.keys(lanes).sort()).toEqual([...SKILL_LANE_IDS].sort());
  });
});
