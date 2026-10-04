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
import { COMPACTION_MAX_DWELL_MS } from './compaction/compaction-state.types';
import type {
  HookEvent,
  HookInput,
  SDKMessage,
} from '../types/sdk-types/claude-sdk.types';

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

  // ---- hold / release (TASK_2026_317) --------------------------------------
  //
  // A turn parked on `canUseTool` emits zero SDK messages, so without a hold
  // the watchdog reads a human reading a prompt as a wedged provider. These
  // pin the New Project regression: an AskUserQuestion card the UI advertises
  // as untimed must survive far longer than one window.

  describe('hold/release', () => {
    it('does NOT fire while held, however long the user takes', () => {
      const onTimeout = jest.fn();
      const wd = new NoActivityWatchdog(WINDOW, onTimeout);

      wd.start();
      wd.hold(); // canUseTool parked on an AskUserQuestion card

      jest.advanceTimersByTime(WINDOW * 10);
      expect(onTimeout).not.toHaveBeenCalled();
      expect(wd.isHeld).toBe(true);
    });

    it('release() starts a FULL fresh window — time spent waiting is not charged to the provider', () => {
      const onTimeout = jest.fn();
      const wd = new NoActivityWatchdog(WINDOW, onTimeout);

      wd.start();
      jest.advanceTimersByTime(WINDOW - 1); // nearly out of window already
      wd.hold();
      jest.advanceTimersByTime(WINDOW * 4); // user deliberates
      wd.release();
      expect(wd.isHeld).toBe(false);

      jest.advanceTimersByTime(WINDOW - 1);
      expect(onTimeout).not.toHaveBeenCalled();
      jest.advanceTimersByTime(1);
      expect(onTimeout).toHaveBeenCalledTimes(1);
    });

    it('is reference-counted — concurrent tool calls only unblock on the last release', () => {
      const onTimeout = jest.fn();
      const wd = new NoActivityWatchdog(WINDOW, onTimeout);

      wd.start();
      wd.hold();
      wd.hold();
      wd.release();

      jest.advanceTimersByTime(WINDOW * 3);
      expect(onTimeout).not.toHaveBeenCalled();

      wd.release();
      jest.advanceTimersByTime(WINDOW);
      expect(onTimeout).toHaveBeenCalledTimes(1);
    });

    it('kick() during a hold does not re-arm the window', () => {
      const onTimeout = jest.fn();
      const wd = new NoActivityWatchdog(WINDOW, onTimeout);

      wd.start();
      wd.hold();
      wd.kick();
      jest.advanceTimersByTime(WINDOW * 2);
      expect(onTimeout).not.toHaveBeenCalled();
    });

    it('an unbalanced release() never arms a watchdog that was never started', () => {
      const onTimeout = jest.fn();
      const wd = new NoActivityWatchdog(WINDOW, onTimeout);

      // Teardown paths may release without a matching hold; that must not
      // resurrect a timer on a watchdog the transformer never started.
      wd.release();
      wd.release();
      jest.advanceTimersByTime(WINDOW * 2);
      expect(onTimeout).not.toHaveBeenCalled();
    });

    it('hold()/release() are inert after stop()', () => {
      const onTimeout = jest.fn();
      const wd = new NoActivityWatchdog(WINDOW, onTimeout);

      wd.start();
      wd.stop();
      wd.hold();
      wd.release();
      jest.advanceTimersByTime(WINDOW * 2);
      expect(onTimeout).not.toHaveBeenCalled();
    });

    it('a hold taken before start() defers arming until start(), then honours it', () => {
      const onTimeout = jest.fn();
      const wd = new NoActivityWatchdog(WINDOW, onTimeout);

      wd.hold();
      wd.start();
      jest.advanceTimersByTime(WINDOW * 2);
      expect(onTimeout).not.toHaveBeenCalled();

      wd.release();
      jest.advanceTimersByTime(WINDOW);
      expect(onTimeout).toHaveBeenCalledTimes(1);
    });
  });

  describe('compaction dwell bound (TASK_2026_597 A8)', () => {
    const signal = new AbortController().signal;

    async function fireHook(
      wd: NoActivityWatchdog,
      input: Record<string, unknown>,
    ): Promise<void> {
      const event = input['hook_event_name'] as HookEvent;
      await wd.lifecycleHooks()[event]?.[0]?.hooks?.[0]?.(
        input as unknown as HookInput,
        undefined,
        { signal },
      );
    }

    const preCompact = { hook_event_name: 'PreCompact', trigger: 'auto' };
    const postCompact = { hook_event_name: 'PostCompact', trigger: 'auto' };
    /** The coordinator controls the session, so the dwell bound applies. */
    const enforced = () => true;

    it('reports an open compaction as overdue, then stops re-arming at COMPACTION_MAX_DWELL_MS and times out', async () => {
      const onTimeout = jest.fn();
      const onOverdue = jest.fn();
      const wd = new NoActivityWatchdog(10_000, onTimeout, onOverdue, enforced);
      wd.start();

      await fireHook(wd, preCompact);
      jest.advanceTimersByTime(COMPACTION_MAX_DWELL_MS - 1);
      expect(onOverdue).toHaveBeenCalledWith(['compaction']);
      const overdueCalls = onOverdue.mock.calls.length;
      expect(overdueCalls).toBe(29);
      expect(onTimeout).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1);
      expect(onTimeout).toHaveBeenCalledTimes(1);
      expect(onTimeout).toHaveBeenCalledWith('compaction-dwell');
      expect(onOverdue).toHaveBeenCalledTimes(overdueCalls);

      // Fired once: no timer is left to re-arm.
      jest.advanceTimersByTime(COMPACTION_MAX_DWELL_MS);
      expect(onTimeout).toHaveBeenCalledTimes(1);
      expect(onOverdue).toHaveBeenCalledTimes(overdueCalls);
    });

    it('with the production window, an open compaction is overdue at 180 s and times out at the 300 s bound', async () => {
      const onTimeout = jest.fn();
      const onOverdue = jest.fn();
      const wd = new NoActivityWatchdog(WINDOW, onTimeout, onOverdue, enforced);
      wd.start();

      await fireHook(wd, preCompact);
      jest.advanceTimersByTime(WINDOW);
      expect(onOverdue).toHaveBeenCalledWith(['compaction']);
      expect(onTimeout).not.toHaveBeenCalled();

      jest.advanceTimersByTime(COMPACTION_MAX_DWELL_MS - WINDOW - 1);
      expect(onTimeout).not.toHaveBeenCalled();
      jest.advanceTimersByTime(1);
      expect(onTimeout).toHaveBeenCalledTimes(1);
      expect(onOverdue).toHaveBeenCalledTimes(1);
    });

    it('root activity during the compaction does not push the deadline past the dwell bound', async () => {
      const onTimeout = jest.fn();
      const wd = new NoActivityWatchdog(WINDOW, onTimeout, undefined, enforced);
      wd.start();

      await fireHook(wd, preCompact);
      jest.advanceTimersByTime(COMPACTION_MAX_DWELL_MS - 10_000);
      wd.observe({
        type: 'system',
        subtype: 'status',
        status: 'compacting',
      } as unknown as SDKMessage);
      jest.advanceTimersByTime(10_000);

      expect(onTimeout).toHaveBeenCalledTimes(1);
    });

    it('a compaction closed before the bound restores the normal window, and the next one gets a fresh bound', async () => {
      const onTimeout = jest.fn();
      const onOverdue = jest.fn();
      const wd = new NoActivityWatchdog(10_000, onTimeout, onOverdue, enforced);
      wd.start();

      await fireHook(wd, preCompact);
      jest.advanceTimersByTime(100_000);
      await fireHook(wd, postCompact);
      await fireHook(wd, preCompact);
      jest.advanceTimersByTime(COMPACTION_MAX_DWELL_MS - 1);
      expect(onTimeout).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1);
      expect(onTimeout).toHaveBeenCalledTimes(1);
    });

    it('a re-announced compaction keeps its original start', async () => {
      const onTimeout = jest.fn();
      const wd = new NoActivityWatchdog(10_000, onTimeout, jest.fn(), enforced);
      wd.start();

      await fireHook(wd, preCompact);
      jest.advanceTimersByTime(COMPACTION_MAX_DWELL_MS / 2);
      await fireHook(wd, preCompact);
      jest.advanceTimersByTime(COMPACTION_MAX_DWELL_MS / 2);

      expect(onTimeout).toHaveBeenCalledTimes(1);
    });

    it('without enforcement (OBSERVE_ONLY) a 400 s compaction is reported overdue, never cut', async () => {
      const onTimeout = jest.fn();
      const onOverdue = jest.fn();
      const wd = new NoActivityWatchdog(WINDOW, onTimeout, onOverdue);
      wd.start();

      await fireHook(wd, preCompact);
      jest.advanceTimersByTime(400_000);
      expect(onOverdue).toHaveBeenCalledTimes(2);
      expect(onOverdue).toHaveBeenLastCalledWith(['compaction']);
      expect(onTimeout).not.toHaveBeenCalled();

      // Closing it restores the plain no-activity window.
      await fireHook(wd, postCompact);
      jest.advanceTimersByTime(WINDOW);
      expect(onTimeout).toHaveBeenCalledTimes(1);
      expect(onTimeout).toHaveBeenCalledWith('no-activity');
    });

    it('an enforced compaction closed at 216 s (B8 measurement) completes', async () => {
      const onTimeout = jest.fn();
      const wd = new NoActivityWatchdog(WINDOW, onTimeout, jest.fn(), enforced);
      wd.start();

      await fireHook(wd, preCompact);
      jest.advanceTimersByTime(216_000);
      await fireHook(wd, postCompact);
      jest.advanceTimersByTime(WINDOW - 1);
      expect(onTimeout).not.toHaveBeenCalled();
    });

    it('an outstanding root tool is still not capped', async () => {
      const onTimeout = jest.fn();
      const onOverdue = jest.fn();
      const wd = new NoActivityWatchdog(WINDOW, onTimeout, onOverdue);
      wd.start();

      await fireHook(wd, {
        hook_event_name: 'PreToolUse',
        tool_use_id: 'tool-1',
        tool_name: 'Bash',
      });
      jest.advanceTimersByTime(WINDOW * 3);

      expect(onOverdue).toHaveBeenCalledTimes(3);
      expect(onOverdue).toHaveBeenLastCalledWith(['Bash']);
      expect(onTimeout).not.toHaveBeenCalled();
    });
  });
});
