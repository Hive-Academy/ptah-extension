import { timer } from 'rxjs';
import { createUnrefScheduler } from './unref-scheduler';

describe('createUnrefScheduler', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.clearAllTimers();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('unrefs the real RxJS timer action and emits at its due time', () => {
    const realSetTimeout = global.setTimeout;
    const unref = jest.fn();
    jest.spyOn(global, 'setTimeout').mockImplementation(((
      callback: Parameters<typeof setTimeout>[0],
      delay?: number,
    ) => {
      const handle = realSetTimeout(callback, delay);
      handle.unref = unref;
      return handle;
    }) as typeof setTimeout);
    const values: number[] = [];
    const subscription = timer(1000, createUnrefScheduler()).subscribe(
      (value) => values.push(value),
    );

    expect(unref).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(1);
    jest.advanceTimersByTime(999);
    expect(values).toEqual([]);
    jest.advanceTimersByTime(1);
    expect(values).toEqual([0]);
    expect(subscription.closed).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('replaces its handle on reschedule and clears it on unsubscribe', () => {
    const action = createUnrefScheduler().schedule(function () {
      this.schedule(undefined, 1000);
    }, 1000);
    expect(jest.getTimerCount()).toBe(1);
    jest.advanceTimersByTime(1000);
    expect(jest.getTimerCount()).toBe(1);
    action.unsubscribe();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('clears a pending RxJS timer on unsubscribe', () => {
    const next = jest.fn();
    const subscription = timer(1000, createUnrefScheduler()).subscribe(next);
    expect(jest.getTimerCount()).toBe(1);
    subscription.unsubscribe();
    expect(jest.getTimerCount()).toBe(0);
    jest.advanceTimersByTime(1000);
    expect(next).not.toHaveBeenCalled();
  });
});
