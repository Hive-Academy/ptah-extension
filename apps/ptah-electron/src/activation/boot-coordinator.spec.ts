/**
 * `BootCoordinator` — unit specs (TASK_2026_331 B1.T1 + B1.T7).
 *
 * The coordinator is the one piece of the window-first boot that CAN be stood
 * up honestly in Jest: it has no DI graph, no Electron import and no I/O. Every
 * import in the module under test is `import type`, so requiring it here costs
 * nothing.
 *
 * What these pin:
 *   - `refs` identity is stable across the whole boot, which is the entire
 *     reason `main.ts` may stop copying fifteen nullable variables.
 *   - The stored post-window promise never rejects outward, so a failed boot
 *     cannot become an unhandled rejection in the main process.
 *   - `awaitCompletion` is bounded: a boot that never settles must not hold
 *     `will-quit` open.
 *   - The warmup barrier waits for BOTH `did-finish-load` and the memory
 *     curator, and leaks no interval when it gives up.
 */

import { BootCoordinator, createEmptyBootRefs } from './boot-coordinator';

/** Minimal stand-in for the curator ref — the barrier only tests for null. */
function fakeCurator(): { stop: () => void } {
  return { stop: jest.fn() };
}

describe('BootCoordinator — refs', () => {
  it('starts every field null', () => {
    const refs = createEmptyBootRefs();
    expect(Object.values(refs).every((v) => v === null)).toBe(true);
  });

  it('keeps the same refs object identity across startPostWindow', async () => {
    const coordinator = new BootCoordinator();
    const before = coordinator.refs;

    coordinator.startPostWindow(async () => {
      coordinator.refs.gitWatcher = {
        stop: jest.fn(),
        switchWorkspace: jest.fn(),
      };
    });
    await coordinator.awaitCompletion(1000);

    expect(coordinator.refs).toBe(before);
    expect(coordinator.refs.gitWatcher).not.toBeNull();
  });

  it('exposes a service written into refs AFTER the caller took its reference', async () => {
    // This is the whole point: `main.ts` takes the reference once, before the
    // boot has created anything, and still sees late arrivals at quit time.
    const coordinator = new BootCoordinator();
    const held = coordinator.refs;
    expect(held.sqliteConnection).toBeNull();

    coordinator.startPostWindow(async () => {
      await Promise.resolve();
      coordinator.refs.sqliteConnection = {
        close: jest.fn(),
      } as unknown as typeof coordinator.refs.sqliteConnection;
    });
    await coordinator.awaitCompletion(1000);

    expect(held.sqliteConnection).not.toBeNull();
  });
});

describe('BootCoordinator — readiness', () => {
  it('starts warming and reaches ready on a successful boot', async () => {
    const coordinator = new BootCoordinator();
    expect(coordinator.readiness).toBe('warming');

    coordinator.startPostWindow(async () => undefined);
    await coordinator.awaitCompletion(1000);

    expect(coordinator.readiness).toBe('ready');
  });

  it('reaches failed on a rejected boot without rejecting outward', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const coordinator = new BootCoordinator();

    coordinator.startPostWindow(async () => {
      throw new Error('boom');
    });
    await expect(coordinator.awaitCompletion(1000)).resolves.toBeUndefined();

    expect(coordinator.readiness).toBe('failed');
    jest.restoreAllMocks();
  });

  it('treats a synchronous throw from the boot function as a failed boot', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const coordinator = new BootCoordinator();

    expect(() =>
      coordinator.startPostWindow((): Promise<void> => {
        throw new Error('sync boom');
      }),
    ).not.toThrow();
    await coordinator.awaitCompletion(1000);

    expect(coordinator.readiness).toBe('failed');
    jest.restoreAllMocks();
  });

  it('ignores a second startPostWindow instead of orphaning the first', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const coordinator = new BootCoordinator();
    const first = jest.fn(async () => undefined);
    const second = jest.fn(async () => undefined);

    coordinator.startPostWindow(first);
    coordinator.startPostWindow(second);
    await coordinator.awaitCompletion(1000);

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    jest.restoreAllMocks();
  });
});

describe('BootCoordinator — isRunning', () => {
  it('is false before a boot, true while pending, false after it settles', async () => {
    const coordinator = new BootCoordinator();
    expect(coordinator.isRunning).toBe(false);

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    coordinator.startPostWindow(() => gate);
    expect(coordinator.isRunning).toBe(true);

    release();
    await coordinator.awaitCompletion(1000);
    expect(coordinator.isRunning).toBe(false);
  });
});

describe('BootCoordinator — abort and bounded completion', () => {
  it('fires the abort signal', () => {
    const coordinator = new BootCoordinator();
    const onAbort = jest.fn();
    coordinator.abortSignal.addEventListener('abort', onAbort);

    expect(coordinator.abortSignal.aborted).toBe(false);
    coordinator.abort();

    expect(coordinator.abortSignal.aborted).toBe(true);
    expect(onAbort).toHaveBeenCalledTimes(1);
  });

  it('is idempotent', () => {
    const coordinator = new BootCoordinator();
    coordinator.abort();
    expect(() => coordinator.abort()).not.toThrow();
    expect(coordinator.abortSignal.aborted).toBe(true);
  });

  it('resolves awaitCompletion immediately when no boot was started', async () => {
    const coordinator = new BootCoordinator();
    await expect(coordinator.awaitCompletion(5000)).resolves.toBeUndefined();
  });

  it('returns after the timeout when the boot never settles', async () => {
    jest.useFakeTimers();
    try {
      const coordinator = new BootCoordinator();
      // A boot that hangs forever — exactly the quit-during-boot case.
      coordinator.startPostWindow(() => new Promise<void>(() => undefined));

      let settled = false;
      const waiting = coordinator.awaitCompletion(2000).then(() => {
        settled = true;
      });

      await Promise.resolve();
      expect(settled).toBe(false);

      jest.advanceTimersByTime(2000);
      await waiting;

      expect(settled).toBe(true);
      expect(coordinator.isRunning).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('BootCoordinator — warmup barrier', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('runs the warmup when did-finish-load fires FIRST and the curator appears later', async () => {
    // The window-first ordering: `did-finish-load` fires long before the
    // post-window boot creates the curator. The old `scheduleWarmup` sampled
    // the curator once at that moment and returned, so warmup never ran.
    const coordinator = new BootCoordinator();
    const warmup = jest.fn();

    coordinator.armWarmup(warmup);
    coordinator.notifyWindowLoaded();

    jest.advanceTimersByTime(5000);
    expect(warmup).not.toHaveBeenCalled();

    coordinator.refs.memoryCurator =
      fakeCurator() as unknown as typeof coordinator.refs.memoryCurator;

    // Next poll tick opens the barrier; the 3 s idle timer starts from there.
    jest.advanceTimersByTime(200);
    expect(warmup).not.toHaveBeenCalled();

    jest.advanceTimersByTime(3000);
    expect(warmup).toHaveBeenCalledTimes(1);
  });

  it('runs the warmup when the curator already exists before the window loads', () => {
    const coordinator = new BootCoordinator();
    const warmup = jest.fn();
    coordinator.refs.memoryCurator =
      fakeCurator() as unknown as typeof coordinator.refs.memoryCurator;

    coordinator.armWarmup(warmup);
    coordinator.notifyWindowLoaded();
    jest.advanceTimersByTime(3000);

    expect(warmup).toHaveBeenCalledTimes(1);
  });

  it('does not run the warmup before the window has loaded', () => {
    const coordinator = new BootCoordinator();
    const warmup = jest.fn();
    coordinator.refs.memoryCurator =
      fakeCurator() as unknown as typeof coordinator.refs.memoryCurator;

    coordinator.armWarmup(warmup);
    jest.advanceTimersByTime(10_000);

    expect(warmup).not.toHaveBeenCalled();
  });

  it('gives up after 30 s and leaves no live timer behind', () => {
    const coordinator = new BootCoordinator();
    const warmup = jest.fn();

    coordinator.armWarmup(warmup);
    coordinator.notifyWindowLoaded();

    jest.advanceTimersByTime(30_000);
    expect(warmup).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);

    // A curator arriving after the deadline must not resurrect the barrier.
    coordinator.refs.memoryCurator =
      fakeCurator() as unknown as typeof coordinator.refs.memoryCurator;
    jest.advanceTimersByTime(60_000);
    expect(warmup).not.toHaveBeenCalled();
  });

  it('clears the poll and skips the warmup when the boot is aborted', () => {
    const coordinator = new BootCoordinator();
    const warmup = jest.fn();

    coordinator.armWarmup(warmup);
    coordinator.notifyWindowLoaded();
    expect(jest.getTimerCount()).toBeGreaterThan(0);

    coordinator.abort();

    expect(jest.getTimerCount()).toBe(0);
    coordinator.refs.memoryCurator =
      fakeCurator() as unknown as typeof coordinator.refs.memoryCurator;
    jest.advanceTimersByTime(60_000);
    expect(warmup).not.toHaveBeenCalled();
  });

  it('does not run the warmup when the abort lands during the 3 s idle delay', () => {
    const coordinator = new BootCoordinator();
    const warmup = jest.fn();
    coordinator.refs.memoryCurator =
      fakeCurator() as unknown as typeof coordinator.refs.memoryCurator;

    coordinator.armWarmup(warmup);
    coordinator.notifyWindowLoaded();
    jest.advanceTimersByTime(1000);

    coordinator.abort();
    jest.advanceTimersByTime(10_000);

    expect(warmup).not.toHaveBeenCalled();
  });

  it('swallows a rejected warmup body', async () => {
    const coordinator = new BootCoordinator();
    const warmup = jest.fn(async () => {
      throw new Error('warmup blew up');
    });
    coordinator.refs.memoryCurator =
      fakeCurator() as unknown as typeof coordinator.refs.memoryCurator;

    coordinator.armWarmup(warmup);
    coordinator.notifyWindowLoaded();
    jest.advanceTimersByTime(3000);
    await Promise.resolve();
    await Promise.resolve();

    expect(warmup).toHaveBeenCalledTimes(1);
  });
});
