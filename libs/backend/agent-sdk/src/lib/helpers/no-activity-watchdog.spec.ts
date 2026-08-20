/**
 * NoActivityWatchdog specs (TASK_2026_190).
 *
 * Pins the stuck-session detection behavior that replaced the stderr-pattern
 * provider-error abort:
 *   - a fully silent window (no kick) fires onTimeout once — the "stuck stream
 *     aborts after the window" case;
 *   - repeated kicks before the deadline keep pushing it out — the
 *     "slow-but-active stream (long tool call / thinking) does NOT abort" case;
 *   - stop() disarms permanently and start()/kick() are no-ops afterwards, so
 *     the callback can never fire late or twice (leak / double-abort guard).
 *
 * Uses Jest fake timers so the tests are deterministic and instant — no real
 * 3-minute waits.
 */

import { NoActivityWatchdog } from './no-activity-watchdog';

const WINDOW = 180_000;

describe('NoActivityWatchdog', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('fires onTimeout once after a fully silent window (stuck stream)', () => {
    const onTimeout = jest.fn();
    const wd = new NoActivityWatchdog(WINDOW, onTimeout);

    wd.start();
    expect(onTimeout).not.toHaveBeenCalled();

    // Just before the deadline: still silent, must not fire yet.
    jest.advanceTimersByTime(WINDOW - 1);
    expect(onTimeout).not.toHaveBeenCalled();

    // Deadline reached with zero activity → fire exactly once.
    jest.advanceTimersByTime(1);
    expect(onTimeout).toHaveBeenCalledTimes(1);

    // No further fires even if time keeps advancing.
    jest.advanceTimersByTime(WINDOW * 3);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('does NOT fire while kicked before each deadline (slow-but-active stream)', () => {
    const onTimeout = jest.fn();
    const wd = new NoActivityWatchdog(WINDOW, onTimeout);

    wd.start();

    // Simulate a long-but-alive turn: an event every (WINDOW - 1) ms for a
    // total elapsed time far larger than a single window. Each kick resets.
    for (let i = 0; i < 10; i++) {
      jest.advanceTimersByTime(WINDOW - 1);
      wd.kick();
    }
    // Elapsed ~10 windows, but never a full silent window → never fired.
    expect(onTimeout).not.toHaveBeenCalled();

    // Now go silent for a full window → fires.
    jest.advanceTimersByTime(WINDOW);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('measures the window from the LAST kick, not from start()', () => {
    const onTimeout = jest.fn();
    const wd = new NoActivityWatchdog(WINDOW, onTimeout);

    wd.start();
    jest.advanceTimersByTime(WINDOW - 10);
    wd.kick(); // reset — a fresh full window is now required

    jest.advanceTimersByTime(WINDOW - 1);
    expect(onTimeout).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('stop() disarms permanently — no fire after stop, kick/start are no-ops', () => {
    const onTimeout = jest.fn();
    const wd = new NoActivityWatchdog(WINDOW, onTimeout);

    wd.start();
    jest.advanceTimersByTime(WINDOW - 1);
    wd.stop();

    // The pending timer must be cleared: advancing past the old deadline fires
    // nothing.
    jest.advanceTimersByTime(WINDOW * 2);
    expect(onTimeout).not.toHaveBeenCalled();

    // Post-stop kick()/start() must not re-arm.
    wd.kick();
    wd.start();
    jest.advanceTimersByTime(WINDOW * 2);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('stop() is idempotent and safe to call from multiple teardown paths', () => {
    const onTimeout = jest.fn();
    const wd = new NoActivityWatchdog(WINDOW, onTimeout);

    wd.start();
    expect(() => {
      wd.stop();
      wd.stop();
      wd.stop();
    }).not.toThrow();
    jest.advanceTimersByTime(WINDOW * 2);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('start() before any kick still arms the timer', () => {
    const onTimeout = jest.fn();
    const wd = new NoActivityWatchdog(WINDOW, onTimeout);

    // No kick at all — the pre-first-message stuck case (provider never
    // forwards anything).
    wd.start();
    jest.advanceTimersByTime(WINDOW);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });
});
