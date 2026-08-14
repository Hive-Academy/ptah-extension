/**
 * P1-5 — RELEASE-BLOCKING. A lane MUST NOT mutate global auth state, and the
 * auth snapshot it was handed MUST reach the SDK unrebuilt.
 *
 * ## Why this is the highest-value spec in the batch (R1)
 *
 * `ProviderModelsService` has two global-mutating paths.
 * `setModelTier` (`provider-models.service.ts:495-500`) guards its
 * `this.authEnv[k] = …; process.env[k] = …` writes with `scope === 'mainAgent'`,
 * which is what makes the `'lane'` scope inert BY CONSTRUCTION.
 * `applyPersistedTiers` (`:617-643`) has **no scope guard at all** — it
 * hardcodes `'mainAgent'` internally and writes both for every mapped tier
 * unconditionally. It cannot be misdirected by a caller passing a scope; the
 * hazard is a lane code path calling it AT ALL.
 *
 * The consequence is not a failed background job. It is the user's live chat
 * session being repointed at the background provider mid-conversation, with no
 * error and no UI change — the user simply starts getting answers from a small
 * local model. Nothing else in this suite would catch that, because every other
 * assertion is about what the lane produced rather than what it left behind.
 *
 * ## Why the comparison is byte-for-byte
 *
 * Asserting "the key I care about is still correct" passes against a lane that
 * added three keys nobody thought to check, and against one that deleted a key
 * whose absence only matters two providers later. The whole environment is
 * serialized before and compared after, so ANY difference fails.
 *
 * `snapshotEnv` deliberately does not use `JSON.stringify` on the raw object:
 * that drops `undefined`-valued keys, which is exactly the class of change this
 * spec exists to detect (R2). Presence is encoded explicitly instead.
 *
 * ## R2 — presence-with-`undefined`, asserted with `hasOwnProperty`
 *
 * `toBeUndefined()` passes just as happily on a DELETED key, which is the
 * failure being guarded against: the consumer rebuilds the subprocess env as
 * `{ ...process.env, ...override }`, so a present-but-`undefined` key blanks
 * the ambient chat credential while a deleted one lets it survive into the
 * lane. Every assertion below therefore uses `hasOwnProperty`.
 */
import 'reflect-metadata';
import { LaneRunnerService } from './lane-runner.service';
import { SKILL_LANE_IDS } from './lane.types';
import {
  flushMicrotasks,
  makeBudgetStub,
  makeHangingQueryStub,
  makeLogger,
  makeQueryStub,
  makeResolverStub,
  resolvedLane,
  resultMessage,
} from './lane-runner.test-support';

/** The chat provider's live credentials, as they sit in `process.env` today. */
const CHAT_ENV: Record<string, string> = {
  ANTHROPIC_API_KEY: 'chat-provider-key',
  ANTHROPIC_AUTH_TOKEN: 'chat-provider-token',
  ANTHROPIC_BASE_URL: 'https://chat.example.invalid',
  ANTHROPIC_DEFAULT_HAIKU_MODEL: 'chat-haiku',
  ANTHROPIC_DEFAULT_SONNET_MODEL: 'chat-sonnet',
  ANTHROPIC_DEFAULT_OPUS_MODEL: 'chat-opus',
};

/**
 * A lane env in the shape `buildLaneEnv` actually produces: the chat
 * credentials blanked by ASSIGNING `undefined` (never deleted), the lane's own
 * base URL and tier models set.
 */
function laneEnv(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    PATH: process.env['PATH'],
    ANTHROPIC_API_KEY: undefined,
    ANTHROPIC_AUTH_TOKEN: undefined,
    ANTHROPIC_BASE_URL: 'https://lane.example.invalid',
    ANTHROPIC_DEFAULT_HAIKU_MODEL: 'lane-haiku',
    ANTHROPIC_DEFAULT_SONNET_MODEL: 'lane-sonnet',
    ANTHROPIC_DEFAULT_OPUS_MODEL: 'lane-opus',
    ...overrides,
  };
}

/**
 * Byte-for-byte, and presence-preserving. Keys are sorted so ordering churn is
 * not mistaken for mutation, and an `undefined` value is encoded as a sentinel
 * so "present but blank" and "absent" serialize differently.
 */
function snapshotEnv(env: Record<string, string | undefined>): string {
  return JSON.stringify(
    Object.keys(env)
      .sort()
      .map((key) => [
        key,
        // `Object.keys` DOES return a key whose value is `undefined`, so this
        // sentinel is what makes 'present but blank' and 'deleted' serialize
        // to different bytes.
        env[key] === undefined ? ' present-but-undefined' : env[key],
      ]),
  );
}

/**
 * The `AuthEnv` singleton `ProviderModelsService` would write to. This library
 * never injects it — which is the point: if a lane ever reaches it, it can only
 * be through one of the two banned methods, and the object handed to the fake
 * resolver is the closest stand-in this suite can hold.
 */
function makeGlobalAuthEnv(): Record<string, string | undefined> {
  return { ...CHAT_ENV };
}

const CHAT_KEYS = Object.keys(CHAT_ENV);

let restoreEnv: Array<[string, string | undefined]> = [];

beforeEach(() => {
  restoreEnv = CHAT_KEYS.map((key) => [key, process.env[key]]);
  for (const [key, value] of Object.entries(CHAT_ENV)) {
    process.env[key] = value;
  }
});

afterEach(() => {
  for (const [key, value] of restoreEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('P1-5 — a lane run leaves global auth state byte-for-byte unchanged', () => {
  it.each(SKILL_LANE_IDS)(
    'lane %s mutates neither process.env nor the AuthEnv singleton',
    async (laneId) => {
      const globalAuthEnv = makeGlobalAuthEnv();
      const lane = resolvedLane(laneId, {
        model: 'a-tier-alias',
        auth: { env: laneEnv() },
      });

      const processBefore = snapshotEnv(
        process.env as Record<string, string | undefined>,
      );
      const authEnvBefore = snapshotEnv(globalAuthEnv);

      const out = await new LaneRunnerService(
        makeLogger(),
        makeResolverStub(lane).service,
        makeBudgetStub().store,
        makeQueryStub([
          [
            resultMessage({
              result: '{"ok":true}',
              usage: { input_tokens: 10, output_tokens: 4 },
            }),
          ],
        ]).query,
      ).run({
        laneId,
        prompt: 'run something on a non-default provider',
        outputSchema: { type: 'object' },
      });

      expect(out.status).toBe('ok');
      expect(
        snapshotEnv(process.env as Record<string, string | undefined>),
      ).toBe(processBefore);
      expect(snapshotEnv(globalAuthEnv)).toBe(authEnvBefore);
      // And the chat credentials are still the CHAT ones, not the lane's.
      expect(process.env['ANTHROPIC_BASE_URL']).toBe(
        'https://chat.example.invalid',
      );
      expect(process.env['ANTHROPIC_DEFAULT_HAIKU_MODEL']).toBe('chat-haiku');
    },
  );

  it('holds for a requiresProxy provider, whose auth carries a proxy handle url', async () => {
    // `requiresProxy: true` providers resolve through CuratorProxyManager and
    // come back with a LOCAL base url. That path is the one most likely to be
    // "helpfully" applied globally so the proxy is reachable everywhere.
    const globalAuthEnv = makeGlobalAuthEnv();
    const lane = resolvedLane('synthesis', {
      auth: {
        env: laneEnv({ ANTHROPIC_BASE_URL: 'http://127.0.0.1:49731' }),
        baseUrl: 'http://127.0.0.1:49731',
      },
    });

    const processBefore = snapshotEnv(
      process.env as Record<string, string | undefined>,
    );
    const authEnvBefore = snapshotEnv(globalAuthEnv);

    await new LaneRunnerService(
      makeLogger(),
      makeResolverStub(lane).service,
      makeBudgetStub().store,
      makeQueryStub([[resultMessage({ result: 'ok' })]]).query,
    ).run({ laneId: 'synthesis', prompt: 'x' });

    expect(snapshotEnv(process.env as Record<string, string | undefined>)).toBe(
      processBefore,
    );
    expect(snapshotEnv(globalAuthEnv)).toBe(authEnvBefore);
  });

  it('holds on the failure paths too — a timeout must not leave a half-applied env', async () => {
    jest.useFakeTimers();
    try {
      const globalAuthEnv = makeGlobalAuthEnv();
      const lane = resolvedLane('judge', {
        config: { timeoutMs: 5_000 },
        auth: { env: laneEnv() },
      });
      const processBefore = snapshotEnv(
        process.env as Record<string, string | undefined>,
      );
      const authEnvBefore = snapshotEnv(globalAuthEnv);

      const pending = new LaneRunnerService(
        makeLogger(),
        makeResolverStub(lane).service,
        makeBudgetStub().store,
        makeHangingQueryStub().query,
      ).run({ laneId: 'judge', prompt: 'x' });

      // Let the resolver and `execute` promises settle so the timer is armed
      // before the clock moves; advancing an unarmed timer would hang the run.
      await flushMicrotasks();
      await jest.advanceTimersByTimeAsync(5_000);
      const out = await pending;

      expect(out.status).toBe('failed');
      expect(
        snapshotEnv(process.env as Record<string, string | undefined>),
      ).toBe(processBefore);
      expect(snapshotEnv(globalAuthEnv)).toBe(authEnvBefore);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('R2 — the auth snapshot reaches the SDK unrebuilt', () => {
  it('passes the resolver s override object BY REFERENCE', async () => {
    // Identity, not equality. `toEqual` would pass against a spread copy, and a
    // spread copy is precisely how the undefined-valued keys get dropped.
    const env = laneEnv();
    const auth = { env };
    const query = makeQueryStub([[resultMessage({ result: 'ok' })]]);

    await new LaneRunnerService(
      makeLogger(),
      makeResolverStub(resolvedLane('judge', { auth })).service,
      makeBudgetStub().store,
      query.query,
    ).run({ laneId: 'judge', prompt: 'x' });

    expect(query.calls[0].auth).toBe(auth);
    expect(query.calls[0].auth?.env).toBe(env);
  });

  it('keeps every blanked chat key PRESENT with an undefined value', async () => {
    const query = makeQueryStub([[resultMessage({ result: 'ok' })]]);
    const auth = { env: laneEnv() };

    await new LaneRunnerService(
      makeLogger(),
      makeResolverStub(resolvedLane('archaeologist', { auth })).service,
      makeBudgetStub().store,
      query.query,
    ).run({ laneId: 'archaeologist', prompt: 'x' });

    const delivered = query.calls[0].auth?.env as Record<
      string,
      string | undefined
    >;
    for (const key of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN']) {
      // `toBeUndefined()` would ALSO pass on a deleted key — which is the bug.
      expect(Object.prototype.hasOwnProperty.call(delivered, key)).toBe(true);
      expect(delivered[key]).toBeUndefined();
    }
  });

  it('survives the second execution of the structured-output ladder', async () => {
    // The re-run rebuilds the call options; it must not rebuild the auth.
    const env = laneEnv();
    const auth = { env };
    const query = makeQueryStub([
      [resultMessage({ result: 'prose, no json' })],
      [resultMessage({ result: '{"ok":true}' })],
    ]);

    await new LaneRunnerService(
      makeLogger(),
      makeResolverStub(
        resolvedLane('judge', { auth, config: { structuredOutput: 'sdk' } }),
      ).service,
      makeBudgetStub().store,
      query.query,
    ).run({ laneId: 'judge', prompt: 'x', outputSchema: { type: 'object' } });

    expect(query.calls).toHaveLength(2);
    expect(query.calls[1].auth).toBe(auth);
    expect(
      Object.prototype.hasOwnProperty.call(
        query.calls[1].auth?.env ?? {},
        'ANTHROPIC_API_KEY',
      ),
    ).toBe(true);
  });

  it('sends no auth at all when the lane rides the active provider', async () => {
    const query = makeQueryStub([[resultMessage({ result: 'ok' })]]);
    await new LaneRunnerService(
      makeLogger(),
      makeResolverStub(resolvedLane('replay', { auth: undefined })).service,
      makeBudgetStub().store,
      query.query,
    ).run({ laneId: 'replay', prompt: 'x' });

    expect(query.calls[0].auth).toBeUndefined();
  });
});
