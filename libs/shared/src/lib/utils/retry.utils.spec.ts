/**
 * Unit tests for `retryWithBackoff`.
 *
 * Pure function test with deterministic jitter (Math.random stub) and fake
 * timers. Covers:
 *   - success on first try
 *   - retry success before retries exhausted
 *   - early abort when `shouldRetry` returns false
 *   - exponential backoff pattern (delays double; jitter applied)
 *   - final throw when retries exhausted
 *   - retries: 0 still runs once (attempt <= retries when retries=0)
 */

import { retryWithBackoff } from './retry.utils';

describe('retryWithBackoff', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    // Deterministic jitter: Math.random() -> 0.5 so factor = 1.0 exactly.
    jest.spyOn(Math, 'random').mockReturnValue(0.5);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  /**
   * Helper to run a `retryWithBackoff` call while advancing fake timers in
   * between failures. Resolves with whatever the function ultimately returns
   * (success) or rejects with the final error.
   */
  async function runWithTimers<T>(
    promiseFactory: () => Promise<T>,
    initialDelay: number,
    expectedAttempts: number,
  ): Promise<T> {
    const resultPromise = promiseFactory();

    // Allow the first synchronous attempt to settle, then advance timers for
    // each subsequent delay. Exponential with jitter=1.0 → delay = initial * 2^n.
    for (let attempt = 1; attempt < expectedAttempts; attempt++) {
      // Flush microtasks so the catch/await on setTimeout runs.
      await Promise.resolve();
      await Promise.resolve();
      const delay = initialDelay * 2 ** (attempt - 1);
      jest.advanceTimersByTime(delay);
    }
    // Flush final microtasks after the last attempt resolves.
    await Promise.resolve();
    await Promise.resolve();

    return resultPromise;
  }

  it('returns the value on the first successful attempt (no retries needed)', async () => {
    const asyncFn = jest.fn().mockResolvedValue('ok');

    const result = await retryWithBackoff(asyncFn, {
      retries: 3,
      initialDelay: 100,
      shouldRetry: () => true,
    });

    expect(result).toBe('ok');
    expect(asyncFn).toHaveBeenCalledTimes(1);
  });

  it('retries until success within the allowed retry count', async () => {
    const asyncFn = jest
      .fn()
      .mockRejectedValueOnce(new Error('transient-1'))
      .mockRejectedValueOnce(new Error('transient-2'))
      .mockResolvedValueOnce('recovered');

    const shouldRetry = jest.fn().mockReturnValue(true);

    const result = await runWithTimers(
      () =>
        retryWithBackoff(asyncFn, {
          retries: 3,
          initialDelay: 50,
          shouldRetry,
        }),
      50,
      3,
    );

    expect(result).toBe('recovered');
    expect(asyncFn).toHaveBeenCalledTimes(3);
    expect(shouldRetry).toHaveBeenCalledTimes(2);
  });

  it('throws immediately when shouldRetry returns false', async () => {
    const err = new Error('fatal');
    const asyncFn = jest.fn().mockRejectedValue(err);
    const shouldRetry = jest.fn().mockReturnValue(false);

    await expect(
      retryWithBackoff(asyncFn, {
        retries: 5,
        initialDelay: 100,
        shouldRetry,
      }),
    ).rejects.toBe(err);

    expect(asyncFn).toHaveBeenCalledTimes(1);
    expect(shouldRetry).toHaveBeenCalledTimes(1);
  });

  it('throws the final error after exhausting all retries', async () => {
    const err = new Error('persistent');
    const asyncFn = jest.fn().mockRejectedValue(err);

    await expect(
      runWithTimers(
        () =>
          retryWithBackoff(asyncFn, {
            retries: 2,
            initialDelay: 10,
            shouldRetry: () => true,
          }),
        10,
        3, // 1 initial + 2 retries
      ),
    ).rejects.toBe(err);

    expect(asyncFn).toHaveBeenCalledTimes(3);
  });

  it('uses exponential backoff (delays double between retries)', async () => {
    const asyncFn = jest
      .fn()
      .mockRejectedValueOnce(new Error('fail-1'))
      .mockRejectedValueOnce(new Error('fail-2'))
      .mockResolvedValueOnce('ok');

    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

    await runWithTimers(
      () =>
        retryWithBackoff(asyncFn, {
          retries: 5,
          initialDelay: 100,
          shouldRetry: () => true,
        }),
      100,
      3,
    );

    // With Math.random() → 0.5, the jitter factor is exactly 1.0.
    // Delays: initialDelay * 2^0 * 1.0, initialDelay * 2^1 * 1.0
    //       = 100, 200
    const delays = setTimeoutSpy.mock.calls.map((call) => call[1]);
    expect(delays).toEqual([100, 200]);
  });

  it('applies jitter (min factor 0.8, max factor 1.2)', async () => {
    // Verify the jitter formula by sampling Math.random extremes.
    jest.spyOn(Math, 'random').mockReturnValueOnce(0); // → factor 0.8
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

    const asyncFn = jest
      .fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce('ok');

    await runWithTimers(
      () =>
        retryWithBackoff(asyncFn, {
          retries: 2,
          initialDelay: 100,
          shouldRetry: () => true,
        }),
      100, // initial delay; first retry uses min jitter = 80
      2,
    );

    // First (and only) retry delay: 100 * 2^0 * 0.8 = 80
    const delays = setTimeoutSpy.mock.calls.map((call) => call[1]);
    expect(delays[0]).toBeCloseTo(80, 5);
  });

  it('retries: 0 still runs once then throws', async () => {
    const err = new Error('only-once');
    const asyncFn = jest.fn().mockRejectedValue(err);

    await expect(
      retryWithBackoff(asyncFn, {
        retries: 0,
        initialDelay: 10,
        shouldRetry: () => true,
      }),
    ).rejects.toBe(err);

    expect(asyncFn).toHaveBeenCalledTimes(1);
  });
});
