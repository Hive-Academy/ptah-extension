import { TestBed } from '@angular/core/testing';
import {
  MESSAGE_TYPES,
  type PlanLimitOwnerSnapshot,
  type PlanLimitsSnapshot,
} from '@ptah-extension/shared';

import { ClaudeRpcService, type RpcResult } from './claude-rpc.service';
import { PLAN_LIMITS_CLOCK_TICK_MS, PlanLimitsStore } from './plan-limits.store';
import {
  createMockRpcService,
  rpcError,
  rpcSuccess,
  type MockRpcService,
} from '../../testing';

const T0 = Date.parse('2026-10-05T12:00:00Z');

function owner(key: string, used?: number): PlanLimitOwnerSnapshot {
  return {
    owner: {
      key,
      providerId: 'anthropic',
      identityKind: 'account',
      label: 'Claude account',
    },
    status: 'available',
    windowSetEstablished: true,
    windows: [
      {
        key: 'five_hour',
        kind: 'five_hour',
        label: '5-hour',
        observedAt: T0,
        ...(used === undefined
          ? {}
          : { used: { kind: 'percent' as const, percent: used } }),
      },
    ],
    ownerEvidence: [],
  };
}

function snapshot(
  generatedAt: number,
  owners: PlanLimitOwnerSnapshot[],
  sessionOwners: PlanLimitsSnapshot['sessionOwners'] = {},
): PlanLimitsSnapshot {
  return { generatedAt, owners, sessionOwners };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('PlanLimitsStore', () => {
  let rpc: MockRpcService;
  let store: PlanLimitsStore;
  let consoleWarn: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(T0);
    rpc = createMockRpcService();
    consoleWarn = jest.spyOn(console, 'warn').mockImplementation();
    TestBed.configureTestingModule({
      providers: [{ provide: ClaudeRpcService, useValue: rpc }],
    });
    store = TestBed.inject(PlanLimitsStore);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    consoleWarn.mockRestore();
    jest.useRealTimers();
  });

  it('handles only planLimits:changed', () => {
    expect(store.handledMessageTypes).toEqual([
      MESSAGE_TYPES.PLAN_LIMITS_CHANGED,
    ]);
    expect(MESSAGE_TYPES.PLAN_LIMITS_CHANGED).toBe('planLimits:changed');
  });

  it('starts with no snapshot and no owners', () => {
    expect(store.snapshot()).toBeNull();
    expect(store.ownerByKey('a')).toBeNull();
    expect(store.sessionOwner('s1')).toBeNull();
    expect(store.loading()).toBe(false);
  });

  describe('load', () => {
    it('calls provider:getPlanLimits with sessionIds and ownerKeys and exposes the result', async () => {
      const result = snapshot(T0, [owner('anthropic#account:a', 42)], {
        s1: { ownerKey: 'anthropic#account:a', modelScope: 'opus' },
      });
      rpc.call.mockResolvedValue(rpcSuccess(result) as RpcResult<never>);

      await store.load({ sessionIds: ['s1'], ownerKeys: ['run-owner'] });

      expect(rpc.call).toHaveBeenCalledWith('provider:getPlanLimits', {
        sessionIds: ['s1'],
        ownerKeys: ['run-owner'],
      });
      expect(store.snapshot()).toBe(result);
      expect(store.ownerByKey('anthropic#account:a')?.windows[0].used).toEqual(
        { kind: 'percent', percent: 42 },
      );
      expect(store.sessionOwner('s1')).toEqual({
        ownerKey: 'anthropic#account:a',
        modelScope: 'opus',
      });
      expect(store.sessionOwner('missing')).toBeNull();
      expect(store.loading()).toBe(false);
    });

    it('keeps the scope of earlier loads and sends refresh only when asked', async () => {
      rpc.call.mockResolvedValue(
        rpcSuccess(snapshot(T0, [])) as RpcResult<never>,
      );

      await store.load({ sessionIds: ['s1'], ownerKeys: ['k1'] });
      await store.load({ providerId: 'openai-codex', refresh: true });
      await store.load({ sessionIds: ['s2'] });

      expect(rpc.call.mock.calls.map((call) => call[1])).toEqual([
        { sessionIds: ['s1'], ownerKeys: ['k1'] },
        {
          sessionIds: ['s1'],
          ownerKeys: ['k1'],
          providerId: 'openai-codex',
          refresh: true,
        },
        { sessionIds: ['s2'], ownerKeys: ['k1'], providerId: 'openai-codex' },
      ]);
    });

    it('drops a response that a newer load superseded (generation guard)', async () => {
      const first = deferred<RpcResult<never>>();
      const second = deferred<RpcResult<never>>();
      rpc.call
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise);

      const older = store.load({ sessionIds: ['old'] });
      const newer = store.load({ sessionIds: ['new'] });

      second.resolve(
        rpcSuccess(snapshot(T0, [owner('new-owner')])) as RpcResult<never>,
      );
      await newer;
      expect(store.ownerByKey('new-owner')).not.toBeNull();

      first.resolve(
        rpcSuccess(snapshot(T0 + 10, [owner('old-owner')])) as RpcResult<never>,
      );
      await older;
      expect(store.ownerByKey('old-owner')).toBeNull();
      expect(store.ownerByKey('new-owner')).not.toBeNull();
      expect(store.loading()).toBe(false);
    });

    it('stays loading until the newest load settles', async () => {
      const first = deferred<RpcResult<never>>();
      const second = deferred<RpcResult<never>>();
      rpc.call
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise);

      const older = store.load();
      const newer = store.load();
      first.resolve(rpcSuccess(snapshot(T0, [])) as RpcResult<never>);
      await older;
      expect(store.loading()).toBe(true);

      second.resolve(rpcSuccess(snapshot(T0, [])) as RpcResult<never>);
      await newer;
      expect(store.loading()).toBe(false);
    });

    it('sets an empty snapshot on an RPC error — unavailable, never zero', async () => {
      rpc.call.mockResolvedValue(
        rpcSuccess(snapshot(T0, [owner('a', 10)])) as RpcResult<never>,
      );
      await store.load();
      rpc.call.mockResolvedValue(rpcError('boom') as RpcResult<never>);

      await store.load();

      expect(store.snapshot()).toEqual({
        generatedAt: T0,
        owners: [],
        sessionOwners: {},
      });
      expect(store.ownerByKey('a')).toBeNull();
    });

    it('sets an empty snapshot when the call throws, logging only the error name', async () => {
      rpc.call.mockRejectedValue(new TypeError('secret-ish detail'));

      await store.load();

      expect(store.snapshot()?.owners).toEqual([]);
      expect(store.loading()).toBe(false);
      expect(consoleWarn).toHaveBeenCalledWith(
        expect.stringContaining('provider:getPlanLimits failed'),
        'TypeError',
      );
    });

    it('sets an empty snapshot when the RPC result is malformed', async () => {
      rpc.call.mockResolvedValue(
        rpcSuccess({ generatedAt: 'later', owners: [] }) as RpcResult<never>,
      );

      await store.load();

      expect(store.snapshot()?.owners).toEqual([]);
      expect(consoleWarn).toHaveBeenCalled();
    });
  });

  describe('planLimits:changed push', () => {
    it('replaces the snapshot with the pushed one', async () => {
      rpc.call.mockResolvedValue(
        rpcSuccess(snapshot(T0, [owner('a', 10)])) as RpcResult<never>,
      );
      await store.load();

      const pushed = snapshot(T0 + 1000, [owner('b', 95)], {
        s1: { ownerKey: 'b', modelScope: null },
      });
      store.handleMessage({
        type: MESSAGE_TYPES.PLAN_LIMITS_CHANGED,
        payload: pushed,
      });

      expect(store.snapshot()).toBe(pushed);
      expect(store.ownerByKey('a')).toBeNull();
      expect(store.ownerByKey('b')?.windows[0].used).toEqual({
        kind: 'percent',
        percent: 95,
      });
      expect(store.sessionOwner('s1')).toEqual({
        ownerKey: 'b',
        modelScope: null,
      });
    });

    it('keeps a newer push when a slower pull returns an older snapshot', async () => {
      const pending = deferred<RpcResult<never>>();
      rpc.call.mockReturnValueOnce(pending.promise);
      const loading = store.load();

      const pushed = snapshot(T0 + 2000, [owner('pushed')]);
      store.handleMessage({
        type: MESSAGE_TYPES.PLAN_LIMITS_CHANGED,
        payload: pushed,
      });
      pending.resolve(
        rpcSuccess(snapshot(T0 + 1000, [owner('pulled')])) as RpcResult<never>,
      );
      await loading;

      expect(store.snapshot()).toBe(pushed);
    });

    it.each([
      ['null', null],
      ['missing owners', { generatedAt: T0, sessionOwners: {} }],
      [
        'owner without a key',
        {
          generatedAt: T0,
          owners: [{ ...owner('a'), owner: { providerId: 'x' } }],
          sessionOwners: {},
        },
      ],
      [
        'window without observedAt',
        {
          generatedAt: T0,
          owners: [{ ...owner('a'), windows: [{ key: 'weekly' }] }],
          sessionOwners: {},
        },
      ],
      [
        'session owner with a numeric key',
        {
          generatedAt: T0,
          owners: [],
          sessionOwners: { s1: { ownerKey: 7, modelScope: null } },
        },
      ],
    ])('ignores and logs a malformed payload (%s)', (_label, payload) => {
      const good = snapshot(T0, [owner('a', 10)]);
      store.handleMessage({
        type: MESSAGE_TYPES.PLAN_LIMITS_CHANGED,
        payload: good,
      });
      consoleWarn.mockClear();

      store.handleMessage({ type: MESSAGE_TYPES.PLAN_LIMITS_CHANGED, payload });

      expect(store.snapshot()).toBe(good);
      expect(consoleWarn).toHaveBeenCalledWith(
        expect.stringContaining('malformed planLimits:changed'),
      );
    });

    it('preserves an unknown used value as absent, never 0', () => {
      store.handleMessage({
        type: MESSAGE_TYPES.PLAN_LIMITS_CHANGED,
        payload: snapshot(T0, [owner('a')]),
      });

      expect(store.ownerByKey('a')?.windows[0].used).toBeUndefined();
    });
  });

  describe('shared clock', () => {
    it('does not tick before the first load', () => {
      jest.advanceTimersByTime(PLAN_LIMITS_CLOCK_TICK_MS * 3);
      expect(store.now()).toBe(T0);
      expect(jest.getTimerCount()).toBe(0);
    });

    it('starts ONE 30 s interval on the first load and advances now()', async () => {
      rpc.call.mockResolvedValue(
        rpcSuccess(snapshot(T0, [])) as RpcResult<never>,
      );
      await store.load();
      await store.load();
      await store.load();

      expect(jest.getTimerCount()).toBe(1);
      jest.advanceTimersByTime(PLAN_LIMITS_CLOCK_TICK_MS);
      expect(store.now()).toBe(T0 + PLAN_LIMITS_CLOCK_TICK_MS);
    });

    it('clears the interval when the injector is destroyed', async () => {
      rpc.call.mockResolvedValue(
        rpcSuccess(snapshot(T0, [])) as RpcResult<never>,
      );
      await store.load();
      expect(jest.getTimerCount()).toBe(1);

      TestBed.resetTestingModule();

      expect(jest.getTimerCount()).toBe(0);
    });
  });
});
