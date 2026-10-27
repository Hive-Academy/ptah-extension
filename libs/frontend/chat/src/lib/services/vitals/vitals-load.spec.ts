import { effect, Injector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RpcResult } from '@ptah-extension/core';
import {
  VITALS_EMPTY,
  VITALS_ERROR,
  VITALS_ERROR_RETRY_MS,
  VITALS_LOADING,
  VITALS_READY_TTL_MS,
  VitalsLoadCache,
  settleVitalsRpc,
  vitalsReady,
  type VitalsLoad,
  type VitalsRpcSource,
} from './vitals-load';

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

type Fetch = jest.Mock<Promise<VitalsLoad<number>>, []>;

describe('VitalsLoadCache', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-26T12:00:00Z'));
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    jest.useRealTimers();
  });

  it('keeps one fetch in flight for concurrent reads', async () => {
    const pending = deferred<VitalsLoad<number>>();
    const fetch: Fetch = jest.fn(() => pending.promise);
    const cache = new VitalsLoadCache(fetch);

    const first = cache.read();
    const second = cache.read();
    void cache.refresh();

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
    expect(first()).toEqual(VITALS_LOADING);

    pending.resolve(vitalsReady(3));
    await flush();
    expect(first()).toEqual(vitalsReady(3));
  });

  it('serves a ready answer for the TTL, then revalidates while keeping it', async () => {
    const next = deferred<VitalsLoad<number>>();
    const fetch: Fetch = jest
      .fn()
      .mockResolvedValueOnce(vitalsReady(1))
      .mockReturnValueOnce(next.promise);
    const cache = new VitalsLoadCache(fetch);

    const state = cache.read();
    await flush();
    jest.advanceTimersByTime(VITALS_READY_TTL_MS - 1);
    cache.read();
    expect(fetch).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(1);
    cache.read();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(state()).toEqual(vitalsReady(1));

    next.resolve(vitalsReady(2));
    await flush();
    expect(state()).toEqual(vitalsReady(2));
  });

  it('caches an empty answer and keeps it while refetching', async () => {
    const next = deferred<VitalsLoad<number>>();
    const fetch: Fetch = jest
      .fn()
      .mockResolvedValueOnce(VITALS_EMPTY)
      .mockReturnValueOnce(next.promise);
    const cache = new VitalsLoadCache(fetch);

    cache.read();
    await flush();
    cache.read();
    expect(fetch).toHaveBeenCalledTimes(1);

    void cache.refresh();
    expect(cache.value()).toEqual(VITALS_EMPTY);
    next.resolve(vitalsReady(4));
    await flush();
    expect(cache.value()).toEqual(vitalsReady(4));
  });

  it('keeps the last good answer when a refetch fails', async () => {
    const fetch: Fetch = jest
      .fn()
      .mockResolvedValueOnce(vitalsReady(1))
      .mockResolvedValueOnce(VITALS_ERROR);
    const cache = new VitalsLoadCache(fetch);

    await cache.refresh();
    await cache.refresh();

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(cache.value()).toEqual(vitalsReady(1));
  });

  it('shows an error without a good answer and retries after the retry floor', async () => {
    const retry = deferred<VitalsLoad<number>>();
    const fetch: Fetch = jest
      .fn()
      .mockResolvedValueOnce(VITALS_ERROR)
      .mockReturnValueOnce(retry.promise);
    const cache = new VitalsLoadCache(fetch);

    const state = cache.read();
    await flush();
    expect(state()).toEqual(VITALS_ERROR);

    jest.advanceTimersByTime(VITALS_ERROR_RETRY_MS - 1);
    cache.read();
    expect(fetch).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(1);
    cache.read();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(state()).toEqual(VITALS_LOADING);

    retry.resolve(vitalsReady(5));
    await flush();
    expect(state()).toEqual(vitalsReady(5));
  });

  it('does not loop when an effect reads it and the fetch fails', async () => {
    const fetch: Fetch = jest.fn().mockResolvedValue(VITALS_ERROR);
    const cache = new VitalsLoadCache(fetch);
    const seen: string[] = [];
    const injector = TestBed.inject(Injector);

    const ref = effect(() => seen.push(cache.read()().status), { injector });
    for (let pass = 0; pass < 5; pass++) {
      TestBed.tick();
      await flush();
    }

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(seen).toEqual(['loading', 'error']);
    ref.destroy();
  });

  it('turns a rejected fetch into an error', async () => {
    const cache = new VitalsLoadCache<number>(() =>
      Promise.reject(new Error('transport')),
    );

    const state = cache.read();
    await flush();
    expect(state()).toEqual(VITALS_ERROR);
  });

  it('exposes the state through value without fetching', () => {
    const fetch: Fetch = jest.fn().mockResolvedValue(vitalsReady(1));
    const cache = new VitalsLoadCache(fetch);

    expect(cache.value()).toEqual(VITALS_LOADING);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refresh refetches a fresh answer', async () => {
    const fetch: Fetch = jest
      .fn()
      .mockResolvedValueOnce(vitalsReady(1))
      .mockResolvedValueOnce(vitalsReady(2));
    const cache = new VitalsLoadCache(fetch);

    await cache.refresh();
    await cache.refresh();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(cache.value()).toEqual(vitalsReady(2));
  });
});

describe('settleVitalsRpc', () => {
  let error: jest.Mock;

  beforeEach(() => {
    error = jest.fn();
  });

  const source = (): VitalsRpcSource => ({
    logger: { error },
    context: 'Spec',
    label: 'Thing',
  });

  it('maps a successful answer', async () => {
    const load = await settleVitalsRpc(
      source(),
      async () => new RpcResult(true, { count: 2 }),
      (data) => vitalsReady(data.count),
    );

    expect(load).toEqual(vitalsReady(2));
    expect(error).not.toHaveBeenCalled();
  });

  it('logs and returns error for a failed, invalid or rejected call', async () => {
    const failed = await settleVitalsRpc<{ count: number }, number>(
      source(),
      async () => new RpcResult<{ count: number }>(false, undefined, 'boom'),
      (data) => vitalsReady(data.count),
    );
    const invalid = await settleVitalsRpc(
      source(),
      async () => new RpcResult(true, { count: 2 }),
      () => null,
    );
    const rejected = await settleVitalsRpc<{ count: number }, number>(
      source(),
      () => Promise.reject(new TypeError('transport')),
      (data) => vitalsReady(data.count),
    );

    expect([failed, invalid, rejected]).toEqual([VITALS_ERROR, VITALS_ERROR, VITALS_ERROR]);
    expect(error.mock.calls.map((call) => call[1])).toEqual([
      'Thing RPC failed',
      'Thing result is invalid',
      'Thing RPC rejected',
    ]);
    expect(error.mock.calls[2][2]).toEqual({ errorType: 'TypeError' });
  });
});
