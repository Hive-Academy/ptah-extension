import {
  BackgroundWorkGovernor,
  DEFAULT_MAX_DEFER_MS,
  LAG_ENTER_P99_MS,
  LAG_EXIT_MAX_MS,
  LAG_FREEZE_MAX_MS,
  type BackgroundWorkState,
  type ForegroundActivitySource,
  type GovernorTimers,
  type LagSampleSource,
} from './background-work-governor';
import type { EventLoopLagListener } from './event-loop-monitor';
import type { Logger } from '../logging/logger';

/**
 * The governor is a state machine over two fake inputs and a fake clock
 * (TASK_2026_437 C14, INV-7 core). Nothing here waits on real time: the
 * starvation ceiling is ten minutes, and a spec that proved it with a real
 * timer would prove nothing faster than a manual clock does.
 */

function createLogger() {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

/** A manual clock: `advance` fires every timer whose deadline has passed. */
function createClock() {
  let now = 0;
  let nextId = 1;
  const pending = new Map<number, { at: number; callback: () => void }>();
  const timers: GovernorTimers = {
    setTimeout: (callback, ms) => {
      const id = nextId++;
      pending.set(id, { at: now + ms, callback });
      return id;
    },
    clearTimeout: (handle) => {
      pending.delete(handle as number);
    },
  };
  return {
    timers,
    get pendingCount() {
      return pending.size;
    },
    advance(ms: number) {
      now += ms;
      for (const [id, timer] of [...pending]) {
        if (timer.at <= now) {
          pending.delete(id);
          timer.callback();
        }
      }
    },
  };
}

function createForeground(initiallyBusy = false) {
  let busy = initiallyBusy;
  const listeners = new Set<() => void>();
  const source: ForegroundActivitySource = {
    isForegroundBusy: () => busy,
    onForegroundChange: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return {
    source,
    listeners,
    set(value: boolean) {
      busy = value;
      for (const listener of [...listeners]) listener();
    },
  };
}

function createLagSource() {
  const listeners = new Set<EventLoopLagListener>();
  const source: LagSampleSource = {
    onSample: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return {
    source,
    listeners,
    emit(p99Ms: number, maxMs = p99Ms) {
      for (const listener of [...listeners]) {
        listener({ p99Ms, maxMs, meanMs: p99Ms / 2 });
      }
    },
  };
}

/** Let resolved promise callbacks run. */
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function setup() {
  const logger = createLogger();
  const clock = createClock();
  const governor = new BackgroundWorkGovernor(
    logger as unknown as Logger,
    clock.timers,
  );
  const changes: BackgroundWorkState[] = [];
  governor.onChange((state) => changes.push(state));
  return { logger, clock, governor, changes };
}

const HIGH = LAG_ENTER_P99_MS + 1;
const QUIET = LAG_EXIT_MAX_MS - 1;

describe('BackgroundWorkGovernor — lag hysteresis', () => {
  it('starts clear with no sources at all', () => {
    const { governor } = setup();
    expect(governor.state).toBe('clear');
    expect(governor.isClear()).toBe(true);
  });

  it('enters lagging only after two consecutive windows above p99 100 ms', () => {
    const { governor, changes } = setup();
    const lag = createLagSource();
    governor.attachLagSource(lag.source);

    lag.emit(HIGH);
    expect(governor.state).toBe('clear');
    lag.emit(HIGH);
    expect(governor.state).toBe('lagging');
    expect(changes).toEqual(['lagging']);
  });

  it('does not count p99 exactly at the threshold, and a quiet window resets the streak', () => {
    const { governor } = setup();
    const lag = createLagSource();
    governor.attachLagSource(lag.source);

    lag.emit(LAG_ENTER_P99_MS);
    lag.emit(HIGH);
    lag.emit(10);
    lag.emit(HIGH);
    expect(governor.state).toBe('clear');
    lag.emit(HIGH);
    expect(governor.state).toBe('lagging');
  });

  it('exits only after three consecutive windows with max under 40 ms', () => {
    const { governor, changes } = setup();
    const lag = createLagSource();
    governor.attachLagSource(lag.source);
    lag.emit(HIGH);
    lag.emit(HIGH);

    lag.emit(20, QUIET);
    lag.emit(20, QUIET);
    // A single max at the exit bar restarts the count: max, not p99, decides.
    lag.emit(20, LAG_EXIT_MAX_MS);
    lag.emit(20, QUIET);
    lag.emit(20, QUIET);
    expect(governor.state).toBe('lagging');
    lag.emit(20, QUIET);
    expect(governor.state).toBe('clear');
    expect(changes).toEqual(['lagging', 'clear']);
  });

  it('enters lagging from ONE post-freeze window whose max reaches 1 s', () => {
    const { governor, changes, logger } = setup();
    const lag = createLagSource();
    governor.attachLagSource(lag.source);

    // A total freeze: the one window that saw it carries a healthy p99 and a
    // huge max, and the next window is quiet. The 2-window p99 rule never fires.
    lag.emit(20, LAG_FREEZE_MAX_MS - 1);
    expect(governor.state).toBe('clear');
    lag.emit(20, LAG_FREEZE_MAX_MS);
    expect(governor.state).toBe('lagging');
    expect(changes).toEqual(['lagging']);
    expect(logger.info).toHaveBeenCalledWith(
      '[background-work] lagging — deferring background work',
      { p99Ms: 20, maxMs: LAG_FREEZE_MAX_MS, trigger: 'freeze' },
    );

    // Recovery still needs the full 3-window quiet exit.
    lag.emit(10, QUIET);
    lag.emit(10, QUIET);
    expect(governor.state).toBe('lagging');
    lag.emit(10, QUIET);
    expect(governor.state).toBe('clear');
  });

  it('holds lagging through windows between the exit and entry bars', () => {
    const { governor } = setup();
    const lag = createLagSource();
    governor.attachLagSource(lag.source);
    lag.emit(HIGH);
    lag.emit(HIGH);

    for (let i = 0; i < 10; i++) lag.emit(60, 80);
    expect(governor.state).toBe('lagging');
  });

  it('detaching the lag source clears the lag half of the state', () => {
    const { governor, changes } = setup();
    const lag = createLagSource();
    const detach = governor.attachLagSource(lag.source);
    lag.emit(HIGH);
    lag.emit(HIGH);

    detach();

    expect(governor.state).toBe('clear');
    expect(lag.listeners.size).toBe(0);
    expect(changes).toEqual(['lagging', 'clear']);
    // Idempotent.
    expect(() => detach()).not.toThrow();
  });

  it('a second lag source replaces the first instead of double-counting', () => {
    const { governor } = setup();
    const first = createLagSource();
    const second = createLagSource();
    const detachFirst = governor.attachLagSource(first.source);
    governor.attachLagSource(second.source);

    expect(first.listeners.size).toBe(0);
    second.emit(HIGH);
    expect(governor.state).toBe('clear');
    second.emit(HIGH);
    expect(governor.state).toBe('lagging');
    // The stale detacher must not tear down the live source.
    detachFirst();
    expect(second.listeners.size).toBe(1);
    expect(governor.state).toBe('lagging');
  });
});

describe('BackgroundWorkGovernor — foreground sources', () => {
  it('is foreground-busy while any source is busy', () => {
    const { governor, changes } = setup();
    const a = createForeground();
    const b = createForeground();
    governor.addForegroundSource(a.source);
    governor.addForegroundSource(b.source);

    a.set(true);
    b.set(true);
    a.set(false);
    expect(governor.state).toBe('foreground-busy');
    b.set(false);
    expect(governor.state).toBe('clear');
    expect(changes).toEqual(['foreground-busy', 'clear']);
  });

  it('reads a source that is already busy when it is added', () => {
    const { governor } = setup();
    governor.addForegroundSource(createForeground(true).source);
    expect(governor.state).toBe('foreground-busy');
  });

  it('foreground takes the label over lag, and lag shows once foreground ends', () => {
    const { governor, changes } = setup();
    const fg = createForeground();
    const lag = createLagSource();
    governor.addForegroundSource(fg.source);
    governor.attachLagSource(lag.source);

    fg.set(true);
    lag.emit(HIGH);
    lag.emit(HIGH);
    expect(governor.state).toBe('foreground-busy');
    fg.set(false);
    expect(governor.state).toBe('lagging');
    expect(changes).toEqual(['foreground-busy', 'lagging']);
  });

  it('removing a source unsubscribes it and re-derives the state', () => {
    const { governor } = setup();
    const fg = createForeground(true);
    const remove = governor.addForegroundSource(fg.source);

    remove();

    expect(governor.state).toBe('clear');
    expect(fg.listeners.size).toBe(0);
    expect(() => remove()).not.toThrow();
  });

  it('treats a throwing source as idle and logs it', () => {
    const { governor, logger } = setup();
    governor.addForegroundSource({
      isForegroundBusy: () => {
        throw new Error('registry exploded');
      },
      onForegroundChange: () => () => undefined,
    });

    expect(governor.state).toBe('clear');
    expect(logger.warn).toHaveBeenCalledWith(
      '[background-work] foreground source threw — treating as idle',
      { reason: 'registry exploded' },
    );
  });

  it('does not emit for a re-read that produced the same state', () => {
    const { governor, changes } = setup();
    const fg = createForeground();
    governor.addForegroundSource(fg.source);

    fg.set(false);
    fg.set(true);
    fg.set(true);
    expect(changes).toEqual(['foreground-busy']);
  });
});

describe('BackgroundWorkGovernor — onChange listeners', () => {
  it('isolates a throwing listener from the others', () => {
    const { governor, logger, changes } = setup();
    governor.onChange(() => {
      throw new Error('adopter exploded');
    });
    const fg = createForeground();
    governor.addForegroundSource(fg.source);

    expect(() => fg.set(true)).not.toThrow();
    expect(changes).toEqual(['foreground-busy']);
    expect(logger.warn).toHaveBeenCalledWith(
      '[background-work] state listener threw',
      { reason: 'adopter exploded' },
    );
  });

  it('honours unsubscribe', () => {
    const { governor } = setup();
    const listener = jest.fn();
    const unsubscribe = governor.onChange(listener);
    const fg = createForeground();
    governor.addForegroundSource(fg.source);

    unsubscribe();
    fg.set(true);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('BackgroundWorkGovernor — whenClear', () => {
  it('resolves clear immediately when already clear, arming no timer', async () => {
    const { governor, clock } = setup();
    await expect(governor.whenClear()).resolves.toBe('clear');
    expect(clock.pendingCount).toBe(0);
  });

  it('resolves clear when the state clears, and clears its ceiling timer', async () => {
    const { governor, clock } = setup();
    const fg = createForeground(true);
    governor.addForegroundSource(fg.source);

    const outcome = jest.fn();
    void governor.whenClear().then(outcome);
    await flush();
    expect(outcome).not.toHaveBeenCalled();
    expect(clock.pendingCount).toBe(1);

    fg.set(false);
    await flush();
    expect(outcome).toHaveBeenCalledWith('clear');
    expect(clock.pendingCount).toBe(0);
  });

  it('does not resolve on a busy-to-busy transition (foreground to lagging)', async () => {
    const { governor } = setup();
    const fg = createForeground(true);
    const lag = createLagSource();
    governor.addForegroundSource(fg.source);
    governor.attachLagSource(lag.source);
    lag.emit(HIGH);
    lag.emit(HIGH);

    const outcome = jest.fn();
    void governor.whenClear().then(outcome);
    fg.set(false);
    await flush();
    expect(governor.state).toBe('lagging');
    expect(outcome).not.toHaveBeenCalled();
  });

  it('logs the ceiling once per lane per deferral episode, and again after a clear', async () => {
    const { governor, clock, logger } = setup();
    const fg = createForeground(true);
    governor.addForegroundSource(fg.source);
    const ceilingLines = () =>
      logger.warn.mock.calls.filter((call) =>
        String(call[0]).includes('deferral ceiling reached'),
      );

    void governor.whenClear({ lane: 'memory-curator', maxDeferMs: 10 });
    void governor.whenClear({ lane: 'memory-curator', maxDeferMs: 10 });
    void governor.whenClear({ lane: 'skill-synthesis', maxDeferMs: 10 });
    clock.advance(10);
    await flush();
    expect(ceilingLines().map((call) => call[1].lane)).toEqual([
      'memory-curator',
      'skill-synthesis',
    ]);

    // Same episode, later waiter: still silent.
    void governor.whenClear({ lane: 'memory-curator', maxDeferMs: 10 });
    clock.advance(10);
    await flush();
    expect(ceilingLines()).toHaveLength(2);

    // A clear ends the episode.
    fg.set(false);
    fg.set(true);
    void governor.whenClear({ lane: 'memory-curator', maxDeferMs: 10 });
    clock.advance(10);
    await flush();
    expect(ceilingLines()).toHaveLength(3);
  });

  it('resolves timeout at the 10-minute default ceiling and logs one line (R-P7)', async () => {
    const { governor, clock, logger } = setup();
    governor.addForegroundSource(createForeground(true).source);

    const outcome = jest.fn();
    void governor.whenClear({ lane: 'memory-curator' }).then(outcome);
    clock.advance(DEFAULT_MAX_DEFER_MS - 1);
    await flush();
    expect(outcome).not.toHaveBeenCalled();

    clock.advance(1);
    await flush();
    expect(outcome).toHaveBeenCalledWith('timeout');
    const ceilingLines = logger.warn.mock.calls.filter((call) =>
      String(call[0]).includes('deferral ceiling reached'),
    );
    expect(ceilingLines).toEqual([
      [
        '[background-work] deferral ceiling reached — proceeding',
        {
          lane: 'memory-curator',
          maxDeferMs: DEFAULT_MAX_DEFER_MS,
          state: 'foreground-busy',
        },
      ],
    ]);
  });

  it('honours a custom ceiling and falls back to the default for a nonsensical one', async () => {
    const { governor, clock } = setup();
    governor.addForegroundSource(createForeground(true).source);

    const custom = jest.fn();
    const fallback = jest.fn();
    void governor.whenClear({ maxDeferMs: 1_000 }).then(custom);
    void governor.whenClear({ maxDeferMs: -5 }).then(fallback);

    clock.advance(1_000);
    await flush();
    expect(custom).toHaveBeenCalledWith('timeout');
    expect(fallback).not.toHaveBeenCalled();
    clock.advance(DEFAULT_MAX_DEFER_MS);
    await flush();
    expect(fallback).toHaveBeenCalledWith('timeout');
  });

  it('rejects with AbortError on abort, removes the waiter and its timer', async () => {
    const { governor, clock } = setup();
    const fg = createForeground(true);
    governor.addForegroundSource(fg.source);
    const controller = new AbortController();

    const promise = governor.whenClear({ signal: controller.signal });
    controller.abort();

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(clock.pendingCount).toBe(0);
    // A later clear has nothing left to resolve.
    expect(() => fg.set(false)).not.toThrow();
  });

  it('rejects at once when the signal is already aborted', async () => {
    const { governor, clock } = setup();
    governor.addForegroundSource(createForeground(true).source);
    const controller = new AbortController();
    controller.abort();

    await expect(
      governor.whenClear({ signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(clock.pendingCount).toBe(0);
  });

  it('removes the abort listener once the waiter resolves', async () => {
    const { governor } = setup();
    const fg = createForeground(true);
    governor.addForegroundSource(fg.source);
    const controller = new AbortController();
    const removeSpy = jest.spyOn(controller.signal, 'removeEventListener');

    const promise = governor.whenClear({ signal: controller.signal });
    fg.set(false);

    await expect(promise).resolves.toBe('clear');
    expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));
  });
});

describe('BackgroundWorkGovernor — dispose (host shutdown)', () => {
  it('rejects pending waiters with AbortError instead of releasing them as clear', async () => {
    const { governor, clock } = setup();
    const fg = createForeground();
    const lag = createLagSource();
    governor.addForegroundSource(fg.source);
    governor.attachLagSource(lag.source);
    // Lagging with an idle foreground: detaching the lag source during dispose
    // must NOT re-derive `clear` and release the waiter.
    lag.emit(HIGH);
    lag.emit(HIGH);

    const pending = governor.whenClear({ lane: 'memory-curator' });
    governor.dispose();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(clock.pendingCount).toBe(0);
    expect(fg.listeners.size).toBe(0);
    expect(lag.listeners.size).toBe(0);
  });

  it('tells listeners disposed once, then drops them, and is terminal', async () => {
    const { governor, changes } = setup();
    const fg = createForeground(true);
    governor.addForegroundSource(fg.source);

    governor.dispose();
    governor.dispose();

    expect(changes).toEqual(['foreground-busy', 'disposed']);
    expect(governor.state).toBe('disposed');
    expect(governor.isClear()).toBe(false);
    await expect(governor.whenClear()).rejects.toMatchObject({
      name: 'AbortError',
    });

    // Late sources and listeners are inert rather than resurrecting it.
    const late = createForeground(false);
    governor.addForegroundSource(late.source);
    expect(late.listeners.size).toBe(0);
    const lateListener = jest.fn();
    governor.onChange(lateListener);
    expect(governor.state).toBe('disposed');
    expect(lateListener).not.toHaveBeenCalled();
  });
});
