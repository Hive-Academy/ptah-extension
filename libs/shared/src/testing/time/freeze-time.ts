/**
 * Frozen-clock helper for tests that need deterministic timestamps.
 *
 * Wraps Jest's modern fake timers so consumers don't each re-learn the API.
 * Pattern matches project conventions documented in `implementation-plan.md`
 * §3.1 ("freezeTime wraps jest.useFakeTimers with project conventions").
 *
 * Example:
 *
 *   const clock = freezeTime('2026-01-01T00:00:00Z');
 *   // ... Date.now() === clock.now
 *   clock.advanceBy(60_000);     // Advance fake time by 60s
 *   clock.restore();             // Restore real timers in afterEach
 */

export interface FrozenClock {
  /** Epoch ms of the instant the clock is currently pinned to. */
  readonly now: number;
  /**
   * Advance the fake clock by `ms` milliseconds. Pending timers that fall
   * within the window fire as usual.
   */
  advanceBy(ms: number): void;
  /** Restore real timers. Call from `afterEach`. */
  restore(): void;
}

export function freezeTime(instant: Date | string | number): FrozenClock {
  const frozen = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(frozen.getTime())) {
    throw new TypeError(
      `freezeTime: invalid instant ${JSON.stringify(instant)}`,
    );
  }

  jest.useFakeTimers({ doNotFake: [] });
  jest.setSystemTime(frozen);

  return {
    get now(): number {
      return Date.now();
    },
    advanceBy(ms: number): void {
      // `jest.advanceTimersByTime` advances both the fake system clock and
      // fires any timers that fall within the window in one shot.
      jest.advanceTimersByTime(ms);
    },
    restore(): void {
      jest.useRealTimers();
    },
  };
}
