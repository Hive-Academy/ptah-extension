import {
  DestroyRef,
  EnvironmentInjector,
  createEnvironmentInjector,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  MESSAGE_TYPES,
  type PlanLimitOwnerSnapshot,
  type PlanLimitsSnapshot,
} from '@ptah-extension/shared';

import { ClaudeRpcService, type RpcResult } from './claude-rpc.service';
import {
  PLAN_LIMITS_CLOCK_TICK_MS,
  PlanLimitsStore,
  type PlanLimitsScopeHandle,
} from './plan-limits.store';
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

  /** A surface with its own injector, so destroying it runs its DestroyRef. */
  function surfaceWithInjector(): {
    handle: PlanLimitsScopeHandle;
    injector: EnvironmentInjector;
  } {
    const injector = createEnvironmentInjector(
      [],
      TestBed.inject(EnvironmentInjector),
    );
    return {
      handle: store.registerScope(injector.get(DestroyRef)),
      injector,
    };
  }

  function surface(): PlanLimitsScopeHandle {
    return surfaceWithInjector().handle;
  }

  function sentScopes(): unknown[] {
    return rpc.call.mock.calls.map((call) => call[1]);
  }

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
    it('calls provider:getPlanLimits with a surface scope and exposes the result', async () => {
      const result = snapshot(T0, [owner('anthropic#account:a', 42)], {
        s1: { ownerKey: 'anthropic#account:a', modelScope: 'opus' },
      });
      rpc.call.mockResolvedValue(rpcSuccess(result) as RpcResult<never>);

      await surface().update({ sessionIds: ['s1'], ownerKeys: ['run-owner'] });

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

    it('names only the provider while no surface is registered (dashboard alone)', async () => {
      rpc.call.mockResolvedValue(
        rpcSuccess(snapshot(T0, [])) as RpcResult<never>,
      );

      await store.load({ providerId: 'openai-codex' });

      expect(rpc.call).toHaveBeenCalledWith('provider:getPlanLimits', {
        providerId: 'openai-codex',
      });
    });

    it('keeps the latest provider and sends refresh only when asked', async () => {
      rpc.call.mockResolvedValue(
        rpcSuccess(snapshot(T0, [])) as RpcResult<never>,
      );
      const pane = surface();

      await pane.update({ sessionIds: ['s1'], ownerKeys: ['k1'] });
      await store.load({ providerId: 'openai-codex', refresh: true });
      await pane.update({ sessionIds: ['s2'], ownerKeys: [] });

      expect(sentScopes()).toEqual([
        { sessionIds: ['s1'], ownerKeys: ['k1'] },
        {
          sessionIds: ['s1'],
          ownerKeys: ['k1'],
          providerId: 'openai-codex',
          refresh: true,
        },
        { sessionIds: ['s2'], ownerKeys: [], providerId: 'openai-codex' },
      ]);
    });

    it('drops a response that a newer load superseded (generation guard)', async () => {
      const first = deferred<RpcResult<never>>();
      const second = deferred<RpcResult<never>>();
      rpc.call
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise);
      const pane = surface();

      const older = pane.update({ sessionIds: ['old'], ownerKeys: [] });
      const newer = pane.update({ sessionIds: ['new'], ownerKeys: [] });

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

    it('sets an empty placeholder on a first-read RPC error — unavailable, never zero, never browser-clocked', async () => {
      rpc.call.mockResolvedValue(rpcError('boom') as RpcResult<never>);

      await store.load();

      expect(store.snapshot()).toEqual({
        generatedAt: 0,
        owners: [],
        sessionOwners: {},
      });
      expect(store.loadError()).toBe(true);
    });

    it('keeps the last valid snapshot on a later RPC error and flags loadError', async () => {
      const good = snapshot(T0, [owner('a', 10)]);
      rpc.call.mockResolvedValue(rpcSuccess(good) as RpcResult<never>);
      await store.load();
      expect(store.loadError()).toBe(false);
      rpc.call.mockResolvedValue(rpcError('boom') as RpcResult<never>);

      await store.load();

      expect(store.snapshot()).toBe(good);
      expect(store.loadError()).toBe(true);

      rpc.call.mockResolvedValue(rpcSuccess(good) as RpcResult<never>);
      await store.load();
      expect(store.loadError()).toBe(false);
    });

    it('lets any host snapshot replace the failure placeholder', async () => {
      jest.setSystemTime(T0 + 60_000); // browser clock ahead of the host
      rpc.call.mockResolvedValue(rpcError('boom') as RpcResult<never>);
      await store.load();

      const pushed = snapshot(T0, [owner('host')]);
      store.handleMessage({
        type: MESSAGE_TYPES.PLAN_LIMITS_CHANGED,
        payload: pushed,
      });

      expect(store.snapshot()).toBe(pushed);
      expect(store.loadError()).toBe(false);
    });

    it('sets an empty snapshot when the call throws, logging only the error name', async () => {
      rpc.call.mockRejectedValue(new TypeError('secret-ish detail'));

      await store.load();

      expect(store.snapshot()?.owners).toEqual([]);
      expect(store.loadError()).toBe(true);
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

  describe('surface scopes (grid panes)', () => {
    beforeEach(() => {
      rpc.call.mockImplementation(async (_method, params) => {
        // The host answers exactly what it was asked: one owner per session.
        const sessionIds = (params as { sessionIds?: string[] }).sessionIds;
        const sessionOwners: PlanLimitsSnapshot['sessionOwners'] = {};
        for (const id of sessionIds ?? []) {
          sessionOwners[id] = { ownerKey: `owner-${id}`, modelScope: null };
        }
        return rpcSuccess(
          snapshot(Date.now(), [], sessionOwners),
        ) as RpcResult<never>;
      });
    });

    it('keeps both panes` sessions and owners after interleaved loads', async () => {
      const paneA = surface();
      const paneB = surface();

      await paneA.update({ sessionIds: ['sA'], ownerKeys: ['kA'] });
      await paneB.update({ sessionIds: ['sB'], ownerKeys: ['kB'] });
      await paneA.update({ sessionIds: ['sA'], ownerKeys: ['kA', 'kA2'] });

      expect(sentScopes().at(-1)).toEqual({
        sessionIds: ['sA', 'sB'],
        ownerKeys: ['kA', 'kA2', 'kB'],
      });
      expect(store.sessionOwner('sA')?.ownerKey).toBe('owner-sA');
      expect(store.sessionOwner('sB')?.ownerKey).toBe('owner-sB');
    });

    it('sends each id once when two panes show the same session', async () => {
      await surface().update({ sessionIds: ['s1'], ownerKeys: ['k'] });
      await surface().update({ sessionIds: ['s1'], ownerKeys: ['k'] });

      expect(sentScopes().at(-1)).toEqual({
        sessionIds: ['s1'],
        ownerKeys: ['k'],
      });
    });

    it('a pane with no session does not erase another pane`s scope', async () => {
      await surface().update({ sessionIds: ['sA'], ownerKeys: ['kA'] });
      await surface().update({ sessionIds: [], ownerKeys: [] });

      expect(sentScopes().at(-1)).toEqual({
        sessionIds: ['sA'],
        ownerKeys: ['kA'],
      });
      expect(store.sessionOwner('sA')?.ownerKey).toBe('owner-sA');
    });

    it('a dashboard provider load keeps every chat scope', async () => {
      await surface().update({ sessionIds: ['sA'], ownerKeys: ['kA'] });
      await surface().update({ sessionIds: ['sB'], ownerKeys: [] });

      await store.load({ providerId: 'openai-codex' });

      expect(sentScopes().at(-1)).toEqual({
        providerId: 'openai-codex',
        sessionIds: ['sA', 'sB'],
        ownerKeys: ['kA'],
      });
      expect(store.sessionOwner('sA')).not.toBeNull();
      expect(store.sessionOwner('sB')).not.toBeNull();
    });

    it('drops a released pane`s ids from the next load, without reloading', async () => {
      const paneA = surface();
      const paneB = surface();
      await paneA.update({ sessionIds: ['sA'], ownerKeys: ['kA'] });
      await paneB.update({ sessionIds: ['sB'], ownerKeys: ['kB'] });
      const calls = rpc.call.mock.calls.length;

      paneB.release();
      expect(rpc.call.mock.calls.length).toBe(calls);
      await store.load();

      expect(sentScopes().at(-1)).toEqual({
        sessionIds: ['sA'],
        ownerKeys: ['kA'],
      });
    });

    it('releases a pane`s scope when its DestroyRef is destroyed', async () => {
      const paneA = surface();
      const paneB = surfaceWithInjector();
      await paneA.update({ sessionIds: ['sA'], ownerKeys: [] });
      await paneB.handle.update({ sessionIds: ['sB'], ownerKeys: [] });

      paneB.injector.destroy();
      await store.load();

      expect(sentScopes().at(-1)).toEqual({
        sessionIds: ['sA'],
        ownerKeys: [],
      });
    });

    it('ignores an update after release (no load, no re-registration)', async () => {
      const pane = surface();
      pane.release();

      await pane.update({ sessionIds: ['late'], ownerKeys: [] });

      expect(rpc.call).not.toHaveBeenCalled();
      await store.load();
      expect(sentScopes().at(-1)).toEqual({});
    });

    it('gives each pane a distinct, stable id', () => {
      const paneA = surface();
      const paneB = surface();

      expect(paneA.id).not.toBe(paneB.id);
      expect(paneA.id).toBe(paneA.id);
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
      ['an RPC error', () => rpcError('boom') as RpcResult<never>],
      [
        'a malformed result',
        () => rpcSuccess({ generatedAt: 'x' }) as RpcResult<never>,
      ],
    ])(
      'keeps a pushed snapshot when the earlier in-flight pull fails (%s)',
      async (_label, failure) => {
        const pending = deferred<RpcResult<never>>();
        rpc.call.mockReturnValueOnce(pending.promise);
        const loading = store.load();

        const pushed = snapshot(T0 + 2000, [owner('pushed', 30)]);
        store.handleMessage({
          type: MESSAGE_TYPES.PLAN_LIMITS_CHANGED,
          payload: pushed,
        });
        pending.resolve(failure());
        await loading;

        expect(store.snapshot()).toBe(pushed);
        expect(store.ownerByKey('pushed')).not.toBeNull();
        expect(store.loadError()).toBe(true);
      },
    );

    it('keeps a pushed snapshot when the earlier in-flight pull throws', async () => {
      let reject!: (error: unknown) => void;
      rpc.call.mockReturnValueOnce(
        new Promise<RpcResult<never>>((_resolve, r) => (reject = r)),
      );
      const loading = store.load();

      const pushed = snapshot(T0 + 2000, [owner('pushed')]);
      store.handleMessage({
        type: MESSAGE_TYPES.PLAN_LIMITS_CHANGED,
        payload: pushed,
      });
      reject(new Error('transport'));
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
