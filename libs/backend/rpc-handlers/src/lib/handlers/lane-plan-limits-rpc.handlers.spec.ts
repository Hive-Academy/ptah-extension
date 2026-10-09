/**
 * LanePlanLimitsRpcHandlers (TASK_2026_623 R10.1-R10.4, D13).
 *
 * Pins the read contract: list-identical text cells 0-4 per row, lane counts,
 * no identity in the response or the log (R10.4 sentinel), and the read
 * semantics of decisions.md #18 — only `agent.list` and `agent.limits` are ever
 * touched, `limits` gets exactly the rows and no `refresh`, and nothing spawns,
 * stops or continues a lane.
 */

// The vscode-lm-tools barrel reaches the workspace-intelligence tree-sitter
// loader, whose `wasm-bundle-dir` reads `import.meta.url` (unparseable under
// CommonJS ts-jest). This spec never parses, so the module is replaced by a
// stub; the plan-limit formatter below is the real one.
jest.mock('../../../../workspace-intelligence/src/ast/wasm-bundle-dir', () => ({
  BUNDLE_DIR: '',
  resolveWasmPath: (filename: string) => filename,
}));

import 'reflect-metadata';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import { ALLOWED_METHOD_PREFIXES, RpcUserError } from '@ptah-extension/vscode-core';
import {
  applicableLimits,
  classifyLaneState,
  FRESHNESS_MS,
  NEAR_LIMIT_PERCENT,
  type AgentGetLanePlanLimitsResult,
  type CliDetectionResult,
  type LaneLookupFailure,
  type PlanLimitOwnerSnapshot,
  type PlanLimitWindow,
  type RpcMethodName,
} from '@ptah-extension/shared';
import {
  formatPlanLimitRows,
  type AgentLimit,
  type PtahAPI,
  type PtahAPIBuilder,
} from '@ptah-extension/vscode-lm-tools';
import { LanePlanLimitsRpcHandlers } from './lane-plan-limits-rpc.handlers';

const METHOD = 'agent:getLanePlanLimits';
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 9, 3, 12, 0);

// --- R10.4 sentinels ---------------------------------------------------------
const SENTINEL_OWNER_KEY = 'sentinel-owner-key#account:fp-91c2';
const SENTINEL_OWNER_LABEL = 'Sentinel owner label';
const SENTINEL_PLAN_TYPE = 'sentinel-plan-type';
const SENTINEL_CLI_SESSION = 'sentinel-cli-session-7f3a';
const SENTINEL_PROVIDER_ID = 'sentinel-provider-id';
const SENTINEL_EMAIL = 'sentinel.user@example.com';
const SENTINELS = [
  SENTINEL_OWNER_KEY,
  SENTINEL_OWNER_LABEL,
  SENTINEL_PLAN_TYPE,
  SENTINEL_CLI_SESSION,
  SENTINEL_PROVIDER_ID,
  SENTINEL_EMAIL,
];

// --- fixtures ----------------------------------------------------------------
const FIVE_HOUR_NEAR: PlanLimitWindow = {
  key: 'five_hour',
  kind: 'five_hour',
  label: '5-hour session',
  used: { kind: 'percent', percent: 94 },
  usedSource: 'provider-api',
  resetsAt: NOW + 3 * HOUR,
  resetSource: 'provider-api',
  lastResetAt: NOW - 2 * HOUR,
  observedAt: NOW - MIN,
};

const WEEKLY_ROOM: PlanLimitWindow = {
  key: 'weekly',
  kind: 'weekly',
  label: 'Weekly',
  used: { kind: 'percent', percent: 12 },
  usedSource: 'provider-api',
  resetsAt: NOW + 5 * DAY,
  resetSource: 'provider-api',
  lastResetAt: NOW - DAY,
  observedAt: NOW - MIN,
};

const WEEKLY_EXHAUSTED: PlanLimitWindow = {
  key: 'weekly',
  kind: 'weekly',
  label: 'Weekly',
  used: { kind: 'percent', percent: 100 },
  usedSource: 'provider-api',
  resetsAt: NOW + 2 * DAY,
  resetSource: 'provider-api',
  lastResetAt: NOW - 5 * DAY,
  exhaustion: { observedAt: NOW - 5 * MIN, source: 'error-derived' },
  observedAt: NOW - MIN,
};

function snapshot(windows: readonly PlanLimitWindow[]): PlanLimitOwnerSnapshot {
  return {
    owner: {
      key: SENTINEL_OWNER_KEY,
      providerId: SENTINEL_PROVIDER_ID,
      identityKind: 'account',
      label: SENTINEL_OWNER_LABEL,
    },
    status: 'available',
    windowSetEstablished: true,
    windows,
    ownerEvidence: [],
    account: { planType: SENTINEL_PLAN_TYPE },
  };
}

/** A detection row carrying identity the response must never echo. */
function cliRow(cli: CliDetectionResult['cli']): CliDetectionResult {
  return {
    cli,
    installed: true,
    messagingMode: 'steer',
    cliSessionId: SENTINEL_CLI_SESSION,
  } as CliDetectionResult;
}

function ptahCliRow(): CliDetectionResult {
  return {
    cli: 'ptah-cli',
    installed: true,
    messagingMode: 'queue',
    ptahCliId: 'agent-1',
    ptahCliName: 'Team lane',
    providerId: SENTINEL_PROVIDER_ID,
    providerName: SENTINEL_EMAIL,
  };
}

/** A lane result exactly as `LaneLimitLookupService` builds it. */
function lane(
  row: CliDetectionResult,
  owner: PlanLimitOwnerSnapshot | undefined,
  lookupFailure?: LaneLookupFailure,
): AgentLimit {
  const state = classifyLaneState(owner && applicableLimits(owner, null), {
    now: NOW,
    nearLimitPercent: NEAR_LIMIT_PERCENT,
    freshnessMs: FRESHNESS_MS,
    lookupFailure,
  });
  const lookup = lookupFailure === undefined ? 'ok' : 'failed';
  return owner
    ? { row, lookup, owner: owner.owner, snapshot: owner, state }
    : { row, lookup, state };
}

const ROWS: CliDetectionResult[] = [
  cliRow('codex'),
  cliRow('copilot'),
  ptahCliRow(),
];

/** Three lanes: near limit (two windows), at limit, lookup failed. */
const LIMITS: AgentLimit[] = [
  lane(ROWS[0], snapshot([FIVE_HOUR_NEAR, WEEKLY_ROOM])),
  lane(ROWS[1], snapshot([WEEKLY_EXHAUSTED])),
  lane(ROWS[2], undefined, 'failed'),
];

// --- doubles -----------------------------------------------------------------
type Registered = (params: unknown) => Promise<AgentGetLanePlanLimitsResult>;

function createLogger(): Logger & {
  warn: jest.Mock;
  info: jest.Mock;
  error: jest.Mock;
  debug: jest.Mock;
} {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as Logger & {
    warn: jest.Mock;
    info: jest.Mock;
    error: jest.Mock;
    debug: jest.Mock;
  };
}

function createRpcHandler(): {
  rpcHandler: RpcHandler;
  registered: Map<string, Registered>;
} {
  const registered = new Map<string, Registered>();
  const rpcHandler = {
    registerMethod: (method: string, handler: Registered) => {
      const prefix = method.slice(0, method.indexOf(':') + 1);
      if (!(ALLOWED_METHOD_PREFIXES as readonly string[]).includes(prefix)) {
        throw new Error(`Method prefix not allowed: ${prefix}`);
      }
      registered.set(method, handler);
    },
  } as unknown as RpcHandler;
  return { rpcHandler, registered };
}

interface Recording {
  /** Every `PtahAPI` namespace read. */
  readonly namespaces: string[];
  /** Every `agent.*` property read. */
  readonly agentKeys: string[];
  readonly list: jest.Mock;
  readonly limits: jest.Mock;
  /** Lane-affecting methods; any call fails the test. */
  readonly forbidden: Record<string, jest.Mock>;
}

/**
 * A recording `PtahAPI`: the API and its `agent` namespace are proxies that
 * log every property read. The agent also carries real lane methods so a
 * stray call would be observable, not just undefined.
 */
function recordingApi(
  limitsResult: readonly AgentLimit[],
  options: { listError?: Error; withoutLimits?: boolean } = {},
): { api: PtahAPI; recording: Recording } {
  const list = jest.fn(async () => {
    if (options.listError) throw options.listError;
    return ROWS;
  });
  const limits = jest.fn<
    Promise<readonly AgentLimit[] | undefined>,
    [readonly CliDetectionResult[]]
  >(async () => limitsResult);
  const forbidden: Record<string, jest.Mock> = {};
  for (const name of [
    'spawn',
    'stop',
    'continue',
    'steer',
    'message',
    'status',
    'read',
    'wait',
    'report',
    'listRoles',
  ]) {
    forbidden[name] = jest.fn(() => {
      throw new Error(`agent.${name} must not be called`);
    });
  }
  const agentTarget: Record<string, unknown> = { list, ...forbidden };
  if (!options.withoutLimits) agentTarget['limits'] = limits;

  const namespaces: string[] = [];
  const agentKeys: string[] = [];
  const agent = new Proxy(agentTarget, {
    get(target, key, receiver) {
      agentKeys.push(String(key));
      return Reflect.get(target, key, receiver);
    },
  });
  const api = new Proxy({ agent } as Record<string, unknown>, {
    get(target, key, receiver) {
      namespaces.push(String(key));
      return Reflect.get(target, key, receiver);
    },
  }) as unknown as PtahAPI;
  return {
    api,
    recording: { namespaces, agentKeys, list, limits, forbidden },
  };
}

function setup(
  limitsResult: readonly AgentLimit[] = LIMITS,
  options: { listError?: Error; withoutLimits?: boolean } = {},
) {
  const logger = createLogger();
  const { rpcHandler, registered } = createRpcHandler();
  const { api, recording } = recordingApi(limitsResult, options);
  const build = jest.fn(() => api);
  const apiBuilder = { build } as unknown as PtahAPIBuilder;
  new LanePlanLimitsRpcHandlers(logger, rpcHandler, apiBuilder).register();
  /** The registered handler, given exactly `params` (no default). */
  const send = (params: unknown) => {
    const handler = registered.get(METHOD);
    if (!handler) throw new Error(`${METHOD} was not registered`);
    return handler(params);
  };
  const call = (params: unknown = {}) => send(params);
  return { logger, recording, build, call, send };
}

describe('LanePlanLimitsRpcHandlers', () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('declares exactly the one read method', () => {
    const methods: readonly RpcMethodName[] = LanePlanLimitsRpcHandlers.METHODS;
    expect(methods).toEqual([METHOD]);
  });

  it('registers under the `agent:` prefix without building the API', () => {
    const { build } = setup();
    expect(build).not.toHaveBeenCalled();
  });

  describe('response', () => {
    it('returns four rows and lane counts for three lanes', async () => {
      const { call } = setup();

      const result = await call();

      expect(result.rows).toHaveLength(4);
      expect(result.lanes).toBe(3);
      expect(result.atLimit).toBe(1);
      expect(result.nearLimit).toBe(1);
      expect(result.unknown).toBe(1);
      expect(result.asOf).toBe(NOW);
    });

    it('carries the list formatter cells 0-4 verbatim, in list order', async () => {
      const { call } = setup();

      const result = await call();

      const expected = formatPlanLimitRows(LIMITS, NOW).map((cells) => ({
        lane: cells[0],
        window: cells[1],
        used: cells[2],
        state: cells[3],
        reset: cells[4],
      }));
      expect(result.rows).toEqual(expected);
      expect(result.rows[0].lane).toBe('codex');
      expect(result.rows[3].lane).toBe('Team lane');
    });

    it('has exactly the R10.1 keys: five text cells per row, four scalars and asOf', async () => {
      const { call } = setup();

      const result = await call();

      expect(Object.keys(result).sort()).toEqual(
        ['asOf', 'atLimit', 'lanes', 'nearLimit', 'rows', 'unknown'].sort(),
      );
      for (const row of result.rows) {
        expect(Object.keys(row).sort()).toEqual(
          ['lane', 'reset', 'state', 'used', 'window'].sort(),
        );
        for (const value of Object.values(row)) {
          expect(typeof value).toBe('string');
        }
      }
    });

    it('never sends the Source cell', async () => {
      const { call } = setup();

      const result = await call();

      // Every window above reports `provider-api`, which only cell 5 prints.
      expect(formatPlanLimitRows(LIMITS, NOW)[0][5]).toBe('provider-api');
      expect(JSON.stringify(result)).not.toContain('provider-api');
    });
  });

  describe('R10.4 privacy sentinel', () => {
    it('keeps owner, account, provider id, CLI session id and email out of the response', async () => {
      const { call } = setup();

      const json = JSON.stringify(await call());

      for (const sentinel of SENTINELS) {
        expect(json).not.toContain(sentinel);
      }
    });

    it('keeps row contents and sentinels out of every log line', async () => {
      const { call, logger } = setup();
      await call();
      const failing = setup(LIMITS, {
        listError: new Error(`list failed for ${SENTINEL_EMAIL}`),
      });
      await expect(failing.call()).rejects.toThrow();

      const logged = JSON.stringify([
        logger.info.mock.calls,
        logger.warn.mock.calls,
        logger.error.mock.calls,
        logger.debug.mock.calls,
        failing.logger.info.mock.calls,
        failing.logger.warn.mock.calls,
        failing.logger.error.mock.calls,
        failing.logger.debug.mock.calls,
      ]);
      for (const sentinel of [...SENTINELS, 'Team lane', '5-hour session']) {
        expect(logged).not.toContain(sentinel);
      }
    });
  });

  describe('read semantics (decisions.md #18)', () => {
    it('reads only agent.list and agent.limits, and never touches a lane', async () => {
      const { call, recording } = setup();

      await call();

      expect([...new Set(recording.namespaces)]).toEqual(['agent']);
      expect([...new Set(recording.agentKeys)].sort()).toEqual(
        ['limits', 'list'].sort(),
      );
      for (const fn of Object.values(recording.forbidden)) {
        expect(fn).not.toHaveBeenCalled();
      }
    });

    it('calls list() with no arguments, then limits() with exactly the rows', async () => {
      const { call, recording } = setup();

      await call();

      expect(recording.list).toHaveBeenCalledTimes(1);
      expect(recording.list.mock.calls[0]).toHaveLength(0);
      expect(recording.limits).toHaveBeenCalledTimes(1);
      expect(recording.limits.mock.calls[0]).toHaveLength(1);
      expect(recording.limits.mock.calls[0][0]).toBe(ROWS);
      expect(
        recording.list.mock.invocationCallOrder[0],
      ).toBeLessThan(recording.limits.mock.invocationCallOrder[0]);
    });

    it('never passes refresh in any call argument', async () => {
      const { call, recording } = setup();

      await call();

      for (const args of [
        ...recording.list.mock.calls,
        ...recording.limits.mock.calls,
      ]) {
        expect(JSON.stringify(args)).not.toContain('"refresh"');
      }
    });

    it('builds the API once, lazily, and reuses it', async () => {
      const { call, build } = setup();

      await call();
      await call();

      expect(build).toHaveBeenCalledTimes(1);
    });
  });

  describe('params', () => {
    it('accepts an empty object and an absent payload', async () => {
      const { call } = setup();
      await expect(call({})).resolves.toBeDefined();
      await expect(call(undefined)).resolves.toBeDefined();
    });

    it.each([[{ refresh: true }], [{ anything: 1 }], ['text']])(
      'rejects %p with INVALID_PARAMS before any lookup',
      async (params) => {
        const { call, recording, build } = setup();

        const rejection = call(params);

        await expect(rejection).rejects.toBeInstanceOf(RpcUserError);
        await expect(rejection).rejects.toMatchObject({
          errorCode: 'INVALID_PARAMS',
        });
        expect(build).not.toHaveBeenCalled();
        expect(recording.list).not.toHaveBeenCalled();
      },
    );

    it('rejects null with INVALID_PARAMS before any lookup', async () => {
      const { send, recording, build } = setup();

      const rejection = send(null);

      await expect(rejection).rejects.toBeInstanceOf(RpcUserError);
      await expect(rejection).rejects.toMatchObject({
        errorCode: 'INVALID_PARAMS',
      });
      expect(build).not.toHaveBeenCalled();
      expect(recording.list).not.toHaveBeenCalled();
    });

    it('still succeeds when params are omitted (undefined reaches the handler)', async () => {
      const { send } = setup();

      await expect(send(undefined)).resolves.toMatchObject({ lanes: 3 });
    });
  });

  describe('failure', () => {
    it('reports a per-lane lookup failure as an unknown row, not an error', async () => {
      const failedLimits = ROWS.map((row) => lane(row, undefined, 'failed'));
      const { call } = setup(failedLimits);

      const result = await call();

      expect(result.lanes).toBe(3);
      expect(result.unknown).toBe(3);
      expect(result.atLimit).toBe(0);
      expect(result.nearLimit).toBe(0);
      expect(result.rows.map((row) => row.state)).toEqual([
        'limit lookup failed',
        'limit lookup failed',
        'limit lookup failed',
      ]);
    });

    it('rejects with fixed text when the lookup is unavailable', async () => {
      const { call, recording } = setup(LIMITS);
      recording.limits.mockResolvedValue(undefined);
      await expect(call()).rejects.toThrow(
        'Lane plan limits are unavailable on this host',
      );
    });

    it('rejects with fixed text when the lookup resolves null', async () => {
      const { call, recording } = setup();
      recording.limits.mockResolvedValue(
        null as unknown as readonly AgentLimit[],
      );

      await expect(call()).rejects.toThrow(
        'Lane plan limits are unavailable on this host',
      );
    });

    it.each([[{}], ['not an array']])(
      'rejects with fixed text when the lookup resolves the non-array %p',
      async (value) => {
        const { call, recording } = setup();
        recording.limits.mockResolvedValue(
          value as unknown as readonly AgentLimit[],
        );

        await expect(call()).rejects.toThrow(
          'Lane plan limits are unavailable on this host',
        );
      },
    );

    it('rejects with fixed text on a malformed row, without logging or linking its error', async () => {
      const SENTINEL_MALFORMED = 'SENTINEL-lane-/home/acct';
      const malformed = new Proxy(
        {},
        {
          get() {
            throw new Error(SENTINEL_MALFORMED);
          },
        },
      ) as AgentLimit;
      const { call, recording, logger } = setup();
      recording.limits.mockResolvedValue([LIMITS[0], malformed]);

      const error = await call().then(
        () => undefined,
        (reason: unknown) => reason,
      );

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(
        'Lane plan limits are unavailable on this host',
      );
      expect(error).not.toHaveProperty('cause');
      const logged = JSON.stringify([
        logger.info.mock.calls,
        logger.warn.mock.calls,
        logger.error.mock.calls,
        logger.debug.mock.calls,
      ]);
      expect(logger.warn).toHaveBeenCalled();
      expect(logged).not.toContain(SENTINEL_MALFORMED);
      expect(logged).not.toContain('/home/acct');
    });

    it.each([
      [
        'an Error whose name getter throws',
        () => {
          const hostile = new Error('SENTINEL-hostile-error');
          Object.defineProperty(hostile, 'name', {
            get() {
              throw new Error('SENTINEL-name-getter');
            },
          });
          return hostile;
        },
      ],
      [
        'a proxy whose prototype lookup throws',
        () =>
          new Proxy(
            {},
            {
              getPrototypeOf() {
                throw new Error('SENTINEL-proto-trap');
              },
            },
          ),
      ],
    ])(
      'rejects with fixed text when the row throws %s',
      async (_label, makeThrown) => {
        const malformed = new Proxy(
          {},
          {
            get() {
              throw makeThrown();
            },
          },
        ) as AgentLimit;
        const { call, recording, logger } = setup();
        recording.limits.mockResolvedValue([LIMITS[0], malformed]);

        const error = await call().then(
          () => undefined,
          (reason: unknown) => reason,
        );

        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe(
          'Lane plan limits are unavailable on this host',
        );
        expect(error).not.toHaveProperty('cause');
        expect(logger.warn).toHaveBeenCalledWith(expect.any(String), {
          errorName: 'uninspectable',
        });
        expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(
          'SENTINEL',
        );
      },
    );

    it('rejects with fixed text when the namespace has no limits lookup', async () => {
      const { call } = setup(LIMITS, { withoutLimits: true });
      await expect(call()).rejects.toThrow(
        'Lane plan limits are unavailable on this host',
      );
    });

    it('rejects with fixed text when list() throws, without leaking its message', async () => {
      const { call } = setup(LIMITS, {
        listError: new Error(`detect failed at ${SENTINEL_EMAIL}`),
      });

      const rejection = call();

      await expect(rejection).rejects.toThrow(
        'Lane plan limits are unavailable on this host',
      );
      await expect(rejection).rejects.not.toThrow(SENTINEL_EMAIL);
    });

    it('retries the build on the next read after a failed build', async () => {
      const logger = createLogger();
      const { rpcHandler, registered } = createRpcHandler();
      const { api } = recordingApi(LIMITS);
      const build = jest
        .fn<PtahAPI, []>()
        .mockImplementationOnce(() => {
          throw new Error('namespace wiring failed');
        })
        .mockImplementation(() => api);
      new LanePlanLimitsRpcHandlers(
        logger,
        rpcHandler,
        { build } as unknown as PtahAPIBuilder,
      ).register();
      const handler = registered.get(METHOD) as Registered;

      await expect(handler({})).rejects.toThrow(
        'Lane plan limits are unavailable on this host',
      );
      await expect(handler({})).resolves.toMatchObject({ lanes: 3 });
      expect(build).toHaveBeenCalledTimes(2);
    });
  });
});
