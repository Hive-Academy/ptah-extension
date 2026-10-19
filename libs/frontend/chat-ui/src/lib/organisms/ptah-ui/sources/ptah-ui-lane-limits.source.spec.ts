import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  ClaudeRpcService,
  PlanLimitsStore,
  RpcResult,
} from '@ptah-extension/core';
import type {
  AgentGetLanePlanLimitsResult,
  PlanLimitsSnapshot,
} from '@ptah-extension/shared';
import {
  LANE_PLAN_LIMITS_TIMEOUT_MS,
  PtahUiLaneLimitsSource,
} from './ptah-ui-lane-limits.source';

type Result = RpcResult<AgentGetLanePlanLimitsResult>;

const FIXTURE: AgentGetLanePlanLimitsResult = {
  rows: [
    {
      lane: 'claude',
      window: '5-hour',
      used: '100%',
      state: 'AT LIMIT',
      reset: 'resets in 2h 10m',
    },
    {
      lane: 'codex',
      window: '5-hour',
      used: '85%',
      state: 'near limit',
      reset: 'reset unknown',
    },
  ],
  lanes: 2,
  atLimit: 1,
  nearLimit: 1,
  unknown: 0,
  asOf: 1_760_000_000_000,
};

const SENTINEL = 'claude#account:fp-sentinel-0001';

const ok = (data: unknown): Result =>
  new RpcResult(true, data as AgentGetLanePlanLimitsResult);
const failed = (error: string): Result =>
  new RpcResult<AgentGetLanePlanLimitsResult>(false, undefined, error);

/** A settable promise, so a read can be held in flight. */
function deferred(): { promise: Promise<Result>; resolve(r: Result): void } {
  let resolve!: (r: Result) => void;
  const promise = new Promise<Result>((done) => (resolve = done));
  return { promise, resolve };
}

/** Lets resolved RPC promises and the source's continuation run. */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

/** A new snapshot object: the store pushed or pulled. */
const push = (n: number): PlanLimitsSnapshot =>
  ({ generatedAt: n }) as unknown as PlanLimitsSnapshot;

describe('PtahUiLaneLimitsSource', () => {
  let call: jest.Mock<Promise<Result>, unknown[]>;
  let snapshot: WritableSignal<PlanLimitsSnapshot | null>;
  let warn: jest.SpyInstance;
  let source: PtahUiLaneLimitsSource;

  beforeEach(() => {
    call = jest.fn(() => Promise.resolve(ok(FIXTURE)));
    snapshot = signal<PlanLimitsSnapshot | null>(null);
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    TestBed.configureTestingModule({
      providers: [
        { provide: ClaudeRpcService, useValue: { call } },
        { provide: PlanLimitsStore, useValue: { snapshot } },
      ],
    });
    source = TestBed.inject(PtahUiLaneLimitsSource);
  });

  afterEach(() => warn.mockRestore());

  /** The warning arguments, flattened to text. */
  const warnText = (): string =>
    warn.mock.calls.map((args) => args.map(String).join(' ')).join('\n');

  it('makes no call without an acquire, even when the snapshot changes (R10.1)', async () => {
    TestBed.tick();
    snapshot.set(push(1));
    TestBed.tick();
    await flush();

    expect(call).not.toHaveBeenCalled();
  });

  it('starts pending and maps a valid read 1:1 onto "available"', async () => {
    const limits = source.acquire();
    expect(limits()).toEqual({ kind: 'pending' });

    await flush();

    expect(call).toHaveBeenCalledWith(
      'agent:getLanePlanLimits',
      {},
      { timeout: LANE_PLAN_LIMITS_TIMEOUT_MS },
    );
    expect(LANE_PLAN_LIMITS_TIMEOUT_MS).toBe(15_000);
    expect(limits()).toEqual({ kind: 'available', ...FIXTURE });
    const value = limits();
    if (value.kind !== 'available') throw new Error('not available');
    expect(value.rows[0]).not.toBe(FIXTURE.rows[0]);
  });

  it('shares one call and one signal across two acquires', async () => {
    const first = source.acquire();
    const second = source.acquire();
    TestBed.tick();
    await flush();

    expect(call).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it('re-reads once per snapshot change while acquired, and not after the last release', async () => {
    source.acquire();
    source.acquire();
    TestBed.tick();
    await flush();
    expect(call).toHaveBeenCalledTimes(1);

    snapshot.set(push(1));
    TestBed.tick();
    await flush();
    expect(call).toHaveBeenCalledTimes(2);

    source.release();
    snapshot.set(push(2));
    TestBed.tick();
    await flush();
    expect(call).toHaveBeenCalledTimes(3);

    source.release();
    snapshot.set(push(3));
    TestBed.tick();
    await flush();
    expect(call).toHaveBeenCalledTimes(3);
  });

  it('is single-flight: changes during a read queue exactly one follow-up', async () => {
    const pending = deferred();
    call.mockImplementationOnce(() => pending.promise);
    source.acquire();
    TestBed.tick();

    snapshot.set(push(1));
    TestBed.tick();
    snapshot.set(push(2));
    TestBed.tick();
    await flush();
    expect(call).toHaveBeenCalledTimes(1);

    pending.resolve(ok(FIXTURE));
    await flush();
    expect(call).toHaveBeenCalledTimes(2);
    await flush();
    expect(call).toHaveBeenCalledTimes(2);
  });

  it('ignores a release without a holder', async () => {
    source.release();
    const limits = source.acquire();
    await flush();

    expect(call).toHaveBeenCalledTimes(1);
    expect(limits().kind).toBe('available');
  });

  describe('failure', () => {
    it.each([
      ['an RPC error', failed('Method not found: agent:getLanePlanLimits')],
      ['a timeout', failed('RPC timeout: agent:getLanePlanLimits')],
    ])(
      'shows "unavailable" on %s and warns without the payload',
      async (_label, result) => {
        call.mockImplementation(() => Promise.resolve(result));
        const limits = source.acquire();
        await flush();

        expect(limits()).toEqual({ kind: 'unavailable' });
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warnText()).not.toContain(result.error ?? '');
      },
    );

    it('shows "unavailable" when the call throws, naming only the error type', async () => {
      call.mockImplementation(() =>
        Promise.reject(new TypeError(`bad ${SENTINEL}`)),
      );
      const limits = source.acquire();
      await flush();

      expect(limits()).toEqual({ kind: 'unavailable' });
      expect(warnText()).toContain('TypeError');
      expect(warnText()).not.toContain(SENTINEL);
    });

    it('makes no further call after a failed read when no push arrives', async () => {
      call.mockImplementation(() =>
        Promise.resolve(failed('RPC timeout: agent:getLanePlanLimits')),
      );
      const limits = source.acquire();
      source.acquire();
      TestBed.tick();
      await flush();
      TestBed.tick();
      await flush();

      expect(call).toHaveBeenCalledTimes(1);
      expect(limits()).toEqual({ kind: 'unavailable' });
    });

    it('re-reads once on a push after a failed read, and a success there shows "available"', async () => {
      call.mockImplementationOnce(() =>
        Promise.resolve(failed('RPC timeout: agent:getLanePlanLimits')),
      );
      const limits = source.acquire();
      TestBed.tick();
      await flush();
      expect(call).toHaveBeenCalledTimes(1);
      expect(limits()).toEqual({ kind: 'unavailable' });

      snapshot.set(push(1));
      TestBed.tick();
      await flush();

      expect(call).toHaveBeenCalledTimes(2);
      expect(limits()).toEqual({ kind: 'available', ...FIXTURE });
    });

    it.each([
      ['a non-object', 'rows'],
      ['a missing key', { ...FIXTURE, asOf: undefined }],
      ['a non-array rows', { ...FIXTURE, rows: {} }],
      ['a non-string cell', { ...FIXTURE, rows: [{ ...FIXTURE.rows[0], used: 1 }] }],
      ['a missing cell', { ...FIXTURE, rows: [{ lane: 'claude' }] }],
      ['a non-finite count', { ...FIXTURE, lanes: Number.NaN }],
      ['a negative count', { ...FIXTURE, atLimit: -1 }],
      ['a non-finite asOf', { ...FIXTURE, asOf: Number.POSITIVE_INFINITY }],
    ])('shows "unavailable" for a malformed payload: %s', async (_label, data) => {
      call.mockImplementation(() => Promise.resolve(ok(data)));
      const limits = source.acquire();
      await flush();

      expect(limits()).toEqual({ kind: 'unavailable' });
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['the result', { ...FIXTURE, owner: SENTINEL }],
      [
        'a row',
        { ...FIXTURE, rows: [{ ...FIXTURE.rows[0], account: SENTINEL }] },
      ],
    ])(
      'rejects an extra identity key on %s (R10.4 sentinel)',
      async (_label, data) => {
        call.mockImplementation(() => Promise.resolve(ok(data)));
        const limits = source.acquire();
        await flush();

        expect(limits()).toEqual({ kind: 'unavailable' });
        expect(JSON.stringify(limits())).not.toContain(SENTINEL);
        expect(warnText()).not.toContain(SENTINEL);
      },
    );
  });
});
