/**
 * `agent:getLanePlanLimits` wire contract (TASK_2026_623 R10.1-R10.4).
 *
 * Two halves, both load-bearing:
 *  - compile-time: the `Expect<Equals<...>>` aliases fail `tsc` (and ts-jest)
 *    if a key is added, removed or widened, or if an identifying field could be
 *    carried by the response;
 *  - runtime: a typed fixture shaped like R10.10's three lanes proves the key
 *    sets at runtime and that serialising a response leaks no identity.
 */

import type {
  PlanLimitOwnerSnapshot,
  PlanLimitsSnapshot,
  QuotaOwnerRef,
} from '../plan-limit.types';
import {
  RPC_METHOD_NAMES,
  type RpcMethodParams,
  type RpcMethodResult,
} from '../rpc.types';
import type {
  ProviderGetPlanLimitsParams,
  ProviderGetPlanLimitsResult,
} from './rpc-providers.types';
import type {
  AgentGetLanePlanLimitsParams,
  AgentGetLanePlanLimitsResult,
  AgentLanePlanLimitRow,
} from './rpc-lane-plan-limits.types';

// ---------------------------------------------------------------------------
// Compile-time helpers
// ---------------------------------------------------------------------------

/** Exact type equality (distinguishes `readonly`, `any` and optionality). */
type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

const ROW_KEYS = ['lane', 'window', 'used', 'state', 'reset'] as const;
const RESULT_KEYS = [
  'rows',
  'lanes',
  'atLimit',
  'nearLimit',
  'unknown',
  'asOf',
] as const;

/**
 * Every identifying key R10.4 forbids, including the ones the existing
 * snapshot types carry (`QuotaOwnerRef`, `PlanLimitOwnerSnapshot`,
 * `PlanLimitsSnapshot`).
 */
const FORBIDDEN_KEYS = [
  'owner',
  'owners',
  'ownerKey',
  'key',
  'label',
  'identityKind',
  'fingerprint',
  'account',
  'accountId',
  'planType',
  'providerId',
  'ptahCliId',
  'cliSessionId',
  'sessionId',
  'sessionOwners',
  'email',
  'credential',
  'token',
] as const;
type ForbiddenKey =
  | (typeof FORBIDDEN_KEYS)[number]
  | keyof QuotaOwnerRef
  | keyof PlanLimitOwnerSnapshot
  | keyof PlanLimitsSnapshot;

// Key sets are exactly the R10.1 lists: no extra, no missing, no index signature.
type _RowKeysExact = Expect<
  Equals<keyof AgentLanePlanLimitRow, (typeof ROW_KEYS)[number]>
>;
type _ResultKeysExact = Expect<
  Equals<keyof AgentGetLanePlanLimitsResult, (typeof RESULT_KEYS)[number]>
>;

// Every row cell is text; every scalar and `asOf` is a number; rows are read-only.
type _RowCellsAreText = Expect<
  Equals<
    AgentLanePlanLimitRow,
    {
      readonly lane: string;
      readonly window: string;
      readonly used: string;
      readonly state: string;
      readonly reset: string;
    }
  >
>;
type _ResultShape = Expect<
  Equals<
    AgentGetLanePlanLimitsResult,
    {
      readonly rows: readonly AgentLanePlanLimitRow[];
      readonly lanes: number;
      readonly atLimit: number;
      readonly nearLimit: number;
      readonly unknown: number;
      readonly asOf: number;
    }
  >
>;

// No parameters at all, so no `refresh` flag can be sent (decisions.md #18).
type _ParamsEmpty = Expect<
  Equals<AgentGetLanePlanLimitsParams, Record<string, never>>
>;

// Privacy sentinel (R10.4), type half: no identifying key exists on either type.
type _RowCarriesNoIdentity = Expect<
  Equals<Extract<keyof AgentLanePlanLimitRow, ForbiddenKey>, never>
>;
type _ResultCarriesNoIdentity = Expect<
  Equals<Extract<keyof AgentGetLanePlanLimitsResult, ForbiddenKey>, never>
>;

// Registry wiring: the method resolves to these exact types.
type _RegistryParams = Expect<
  Equals<
    RpcMethodParams<'agent:getLanePlanLimits'>,
    AgentGetLanePlanLimitsParams
  >
>;
type _RegistryResult = Expect<
  Equals<
    RpcMethodResult<'agent:getLanePlanLimits'>,
    AgentGetLanePlanLimitsResult
  >
>;

// `provider:getPlanLimits` stays unchanged (R10.1 rev 3.1).
type _ProviderPlanLimitsParamsUnchanged = Expect<
  Equals<RpcMethodParams<'provider:getPlanLimits'>, ProviderGetPlanLimitsParams>
>;
type _ProviderPlanLimitsResultUnchanged = Expect<
  Equals<RpcMethodResult<'provider:getPlanLimits'>, PlanLimitsSnapshot>
>;
type _ProviderPlanLimitsAliasUnchanged = Expect<
  Equals<ProviderGetPlanLimitsResult, PlanLimitsSnapshot>
>;

// ---------------------------------------------------------------------------
// Runtime fixture: R10.10's three lanes -> four rows
// ---------------------------------------------------------------------------

const AS_OF = 1_760_000_000_000;

const fixture: AgentGetLanePlanLimitsResult = {
  rows: [
    {
      lane: 'claude',
      window: '5-hour',
      used: '100%',
      state: 'AT LIMIT',
      reset: 'resets in 2h 10m',
    },
    {
      lane: 'claude',
      window: 'weekly',
      used: '40%',
      state: 'room',
      reset: 'resets in 3d',
    },
    {
      lane: 'codex',
      window: '5-hour',
      used: '85%',
      state: 'near limit',
      reset: 'reset unknown',
    },
    {
      lane: 'Unknown',
      window: '(none)',
      used: 'unknown',
      state: 'unknown (no usage source)',
      reset: '-',
    },
  ],
  lanes: 3,
  atLimit: 1,
  nearLimit: 1,
  unknown: 1,
  asOf: AS_OF,
};

/** Identity-shaped values a careless handler could copy from a snapshot. */
const SENTINEL_VALUES = [
  'claude#account:fp-sentinel-0001',
  'Claude account',
  'pro-sentinel-plan',
  'cli-session-sentinel-0001',
  'ptah-cli-provider-sentinel',
  'sentinel.user@example.com',
] as const;

describe('agent:getLanePlanLimits contract', () => {
  it('is registered in the RPC method list', () => {
    expect(RPC_METHOD_NAMES).toContain('agent:getLanePlanLimits');
    expect(
      RPC_METHOD_NAMES.filter((name) => name === 'agent:getLanePlanLimits'),
    ).toHaveLength(1);
  });

  it('keeps provider:getPlanLimits registered alongside it', () => {
    expect(RPC_METHOD_NAMES).toContain('provider:getPlanLimits');
  });

  it('has exactly the R10.1 result keys', () => {
    expect(Object.keys(fixture).sort()).toEqual([...RESULT_KEYS].sort());
  });

  it('has exactly five text cells per row', () => {
    for (const row of fixture.rows) {
      expect(Object.keys(row).sort()).toEqual([...ROW_KEYS].sort());
      for (const key of ROW_KEYS) {
        expect(typeof row[key]).toBe('string');
        // R10.3: missing values carry words, never an empty cell.
        expect(row[key].length).toBeGreaterThan(0);
      }
    }
  });

  it('counts lanes, not rows, in the scalars', () => {
    const distinctLanes = new Set(fixture.rows.map((row) => row.lane)).size;

    expect(fixture.rows).toHaveLength(4);
    expect(fixture.lanes).toBe(distinctLanes);
    expect(
      fixture.atLimit + fixture.nearLimit + fixture.unknown,
    ).toBeLessThanOrEqual(fixture.lanes);
    for (const key of ['lanes', 'atLimit', 'nearLimit', 'unknown'] as const) {
      expect(Number.isInteger(fixture[key])).toBe(true);
    }
    expect(fixture.asOf).toBe(AS_OF);
  });

  it('round-trips through JSON with no loss (plain data only)', () => {
    expect(JSON.parse(JSON.stringify(fixture))).toEqual(fixture);
  });

  describe('privacy sentinel (R10.4)', () => {
    // Each `@ts-expect-error` sits on the line of the excess property, where
    // tsc reports it, so formatting cannot move the error off the directive.
    // ts-jest type-checks this file: if any field ever becomes legal, the
    // unused directive fails the suite.
    it('rejects identifying fields on the result at compile time', () => {
      const cases: AgentGetLanePlanLimitsResult[] = [
        {
          ...fixture,
          // @ts-expect-error owner is not a result field
          owner: { key: SENTINEL_VALUES[0], label: SENTINEL_VALUES[1] },
        },
        {
          ...fixture,
          // @ts-expect-error account is not a result field
          account: { planType: SENTINEL_VALUES[2] },
        },
        {
          ...fixture,
          // @ts-expect-error providerId is not a result field
          providerId: SENTINEL_VALUES[4],
        },
        {
          ...fixture,
          // @ts-expect-error cliSessionId is not a result field
          cliSessionId: SENTINEL_VALUES[3],
        },
        {
          ...fixture,
          // @ts-expect-error email is not a result field
          email: SENTINEL_VALUES[5],
        },
      ];

      expect(cases).toHaveLength(5);
    });

    it('rejects identifying fields on a row at compile time', () => {
      const row = fixture.rows[0];
      const cases: AgentLanePlanLimitRow[] = [
        {
          ...row,
          // @ts-expect-error owner is not a row field
          owner: SENTINEL_VALUES[1],
        },
        {
          ...row,
          // @ts-expect-error account is not a row field
          account: SENTINEL_VALUES[2],
        },
        {
          ...row,
          // @ts-expect-error providerId is not a row field
          providerId: SENTINEL_VALUES[4],
        },
        {
          ...row,
          // @ts-expect-error cliSessionId is not a row field
          cliSessionId: SENTINEL_VALUES[3],
        },
        {
          ...row,
          // @ts-expect-error email is not a row field
          email: SENTINEL_VALUES[5],
        },
      ];

      expect(cases).toHaveLength(5);
    });

    it('cannot be satisfied by forwarding a provider snapshot', () => {
      const snapshot: PlanLimitsSnapshot = {
        generatedAt: AS_OF,
        owners: [],
        sessionOwners: {},
      };

      // @ts-expect-error a PlanLimitsSnapshot is not a lane plan-limit result
      const forwarded: AgentGetLanePlanLimitsResult = snapshot;

      expect(forwarded).not.toHaveProperty('rows');
    });

    it('serialises with no identifying key or value', () => {
      const json = JSON.stringify(fixture);

      for (const key of FORBIDDEN_KEYS) {
        expect(json).not.toContain(`"${key}"`);
      }
      for (const value of SENTINEL_VALUES) {
        expect(json).not.toContain(value);
      }
      expect(json).not.toMatch(/[^\s"@]+@[^\s"@]+\.[^\s"@]+/);
    });
  });
});
