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

describe('BootCoordinator — persistence gate', () => {
  /** Resolve-tracking wrapper — the gate must be PENDING, not just falsy. */
  function track<T>(promise: Promise<T>): () => boolean {
    let done = false;
    void promise.then(() => {
      done = true;
    });
    return () => done;
  }

  it('stays pending until markPersistenceSettled is called', async () => {
    const coordinator = new BootCoordinator();
    const gateSettled = track(coordinator.whenPersistenceSettled());

    await Promise.resolve();
    await Promise.resolve();
    expect(gateSettled()).toBe(false);

    coordinator.markPersistenceSettled({ sqliteOpen: true });
    await expect(coordinator.whenPersistenceSettled()).resolves.toEqual({
      sqliteOpen: true,
    });
  });

  it('returns the same promise to every caller', () => {
    const coordinator = new BootCoordinator();
    expect(coordinator.whenPersistenceSettled()).toBe(
      coordinator.whenPersistenceSettled(),
    );
  });

  it('lets the FIRST mark win and ignores later ones', async () => {
    const coordinator = new BootCoordinator();

    coordinator.markPersistenceSettled({ sqliteOpen: true });
    coordinator.markPersistenceSettled({ sqliteOpen: false });

    await expect(coordinator.whenPersistenceSettled()).resolves.toEqual({
      sqliteOpen: true,
    });
  });

  it('is settled by a boot that never marks — false when SQLite never arrived', async () => {
    // The no-workspace-root launch: the booter body never runs, so nothing on
    // the normal path ever marks. Without the `.finally` backstop a gated
    // consumer would wait for the rest of the session.
    const coordinator = new BootCoordinator();
    coordinator.startPostWindow(async () => undefined);
    await coordinator.awaitCompletion(1000);

    await expect(coordinator.whenPersistenceSettled()).resolves.toEqual({
      sqliteOpen: false,
    });
  });

  it('is settled by a boot that never marks — true when refs hold an open connection', async () => {
    const coordinator = new BootCoordinator();
    coordinator.startPostWindow(async () => {
      coordinator.refs.sqliteConnection = {
        isOpen: true,
      } as unknown as typeof coordinator.refs.sqliteConnection;
    });
    await coordinator.awaitCompletion(1000);

    await expect(coordinator.whenPersistenceSettled()).resolves.toEqual({
      sqliteOpen: true,
    });
  });

  it('is settled by a REJECTED boot', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const coordinator = new BootCoordinator();

    coordinator.startPostWindow(async () => {
      throw new Error('boom');
    });
    await coordinator.awaitCompletion(1000);

    await expect(coordinator.whenPersistenceSettled()).resolves.toEqual({
      sqliteOpen: false,
    });
    jest.restoreAllMocks();
  });

  it('is settled by abort(), so a quit during boot strands no waiter', async () => {
    const coordinator = new BootCoordinator();
    const gateSettled = track(coordinator.whenPersistenceSettled());

    await Promise.resolve();
    expect(gateSettled()).toBe(false);

    coordinator.abort();

    await expect(coordinator.whenPersistenceSettled()).resolves.toEqual({
      sqliteOpen: false,
    });
  });

  it('does not let the boot backstop overwrite an earlier mark', async () => {
    // The real sequence: the heavy boot marks `true` mid-flight, and the
    // `.finally` backstop then runs against refs that may already be torn down.
    const coordinator = new BootCoordinator();
    coordinator.startPostWindow(async () => {
      coordinator.markPersistenceSettled({ sqliteOpen: true });
      coordinator.refs.sqliteConnection = null;
    });
    await coordinator.awaitCompletion(1000);

    await expect(coordinator.whenPersistenceSettled()).resolves.toEqual({
      sqliteOpen: true,
    });
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

describe('BootCoordinator — phase state (TASK_2026_380)', () => {
  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('starts at `starting` / `warming` with a boot-start instant', () => {
    const coordinator = new BootCoordinator();

    const snapshot = coordinator.snapshot();

    expect(snapshot.phase).toBe('starting');
    expect(snapshot.readiness).toBe('warming');
    expect(snapshot.startedAt).toBe(coordinator.startedAt);
    expect(snapshot.detail).toBeUndefined();
  });

  it('emits once per distinct phase', () => {
    const emit = jest.fn();
    const coordinator = new BootCoordinator();
    coordinator.onReadinessChange(emit);

    coordinator.setPhase('database', 'Opening the database');
    coordinator.setPhase('harness', 'Syncing skills and agents');

    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit.mock.calls[0][0]).toEqual({
      readiness: 'warming',
      phase: 'database',
      detail: 'Opening the database',
      startedAt: coordinator.startedAt,
    });
  });

  it('emits ZERO times for a repeat of the current phase', () => {
    // Edge-triggered. The renderer contract is one message per transition, so
    // a call site inside a retry loop must not become a progress tick.
    const emit = jest.fn();
    const coordinator = new BootCoordinator();
    coordinator.onReadinessChange(emit);

    coordinator.setPhase('database');
    emit.mockClear();
    coordinator.setPhase('database', 'a different detail');

    expect(emit).not.toHaveBeenCalled();
  });

  it('reflects the last phase in `snapshot()`', () => {
    const coordinator = new BootCoordinator();

    coordinator.setPhase('sessions', 'Importing recent sessions');

    expect(coordinator.snapshot()).toEqual({
      readiness: 'warming',
      phase: 'sessions',
      detail: 'Importing recent sessions',
      startedAt: coordinator.startedAt,
    });
  });

  it('does not propagate a throwing emitter into the boot path', () => {
    const coordinator = new BootCoordinator();
    coordinator.onReadinessChange(() => {
      throw new Error('webview manager exploded');
    });

    expect(() => coordinator.setPhase('database')).not.toThrow();
    // The state transition still happened — the emit is a side effect of it,
    // not a precondition for it.
    expect(coordinator.snapshot().phase).toBe('database');
  });

  it('tolerates a phase change with no emitter registered', () => {
    const coordinator = new BootCoordinator();

    expect(() => coordinator.setPhase('index')).not.toThrow();
    expect(coordinator.snapshot().phase).toBe('index');
  });

  it('moves to `settled` / `ready` when the post-window boot resolves', async () => {
    const emit = jest.fn();
    const coordinator = new BootCoordinator();
    coordinator.onReadinessChange(emit);

    coordinator.setPhase('index', 'Starting background services');
    coordinator.startPostWindow(async () => undefined);
    await coordinator.awaitCompletion(1000);

    expect(coordinator.snapshot()).toEqual({
      readiness: 'ready',
      phase: 'settled',
      startedAt: coordinator.startedAt,
    });
    expect(emit).toHaveBeenLastCalledWith(coordinator.snapshot());
  });

  it('KEEPS the last phase when the boot fails', async () => {
    // "Failed during `harness`" is the only thing the renderer can say about
    // where a boot died; overwriting it with `settled` would throw that away.
    const emit = jest.fn();
    const coordinator = new BootCoordinator();
    coordinator.onReadinessChange(emit);

    coordinator.setPhase('harness', 'Syncing skills and agents');
    coordinator.startPostWindow(async () => {
      throw new Error('boot blew up');
    });
    await coordinator.awaitCompletion(1000);

    expect(coordinator.snapshot()).toEqual({
      readiness: 'failed',
      phase: 'harness',
      detail: 'Syncing skills and agents',
      startedAt: coordinator.startedAt,
    });
  });
});

describe('BootCoordinator — degradation summary (TASK_2026_383)', () => {
  it('fires the armed summary exactly once when the boot settles', async () => {
    const summary = jest.fn();
    const coordinator = new BootCoordinator();
    coordinator.armBootSummary(summary);

    coordinator.startPostWindow(async () => undefined);
    await coordinator.awaitCompletion(1000);

    // ONE line per boot, not one per degradation. A boot with forty degraded
    // capabilities that printed forty lines would reproduce the invisibility
    // the whole task exists to remove.
    expect(summary).toHaveBeenCalledTimes(1);
  });

  it('fires the summary after the terminal phase is already written', async () => {
    const phaseAtSummary: string[] = [];
    const coordinator = new BootCoordinator();
    coordinator.armBootSummary(() => {
      phaseAtSummary.push(coordinator.snapshot().phase);
    });

    coordinator.startPostWindow(async () => undefined);
    await coordinator.awaitCompletion(1000);

    // The summary narrates a transition that has already happened, so it is
    // structurally incapable of being upstream of it.
    expect(phaseAtSummary).toEqual(['settled']);
  });

  it('still fires the summary when the boot FAILS', async () => {
    // The failed boot is the one whose degradations a reader most needs.
    // Hanging the line off the success branch alone would hide them at exactly
    // the moment they matter.
    const summary = jest.fn();
    const coordinator = new BootCoordinator();
    coordinator.armBootSummary(summary);

    coordinator.setPhase('harness');
    coordinator.startPostWindow(async () => {
      throw new Error('boot blew up');
    });
    await coordinator.awaitCompletion(1000);

    expect(summary).toHaveBeenCalledTimes(1);
    expect(coordinator.snapshot().readiness).toBe('failed');
    expect(coordinator.snapshot().phase).toBe('harness');
  });

  it('does not let a throwing summary disturb the terminal transition', async () => {
    const warn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const coordinator = new BootCoordinator();
    coordinator.armBootSummary(() => {
      throw new Error('logger exploded');
    });

    coordinator.startPostWindow(async () => undefined);
    await expect(coordinator.awaitCompletion(1000)).resolves.toBeUndefined();

    expect(coordinator.snapshot()).toEqual({
      readiness: 'ready',
      phase: 'settled',
      startedAt: coordinator.startedAt,
    });
    expect(warn).toHaveBeenCalledWith(
      '[BootCoordinator] degradation summary failed (non-fatal):',
      'logger exploded',
    );
    warn.mockRestore();
  });

  it('does not let a throwing summary strand the persistence gate', async () => {
    const warn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const coordinator = new BootCoordinator();
    coordinator.armBootSummary(() => {
      throw new Error('logger exploded');
    });

    coordinator.startPostWindow(async () => undefined);
    await coordinator.awaitCompletion(1000);

    await expect(coordinator.whenPersistenceSettled()).resolves.toEqual({
      sqliteOpen: false,
    });
    warn.mockRestore();
  });

  it('still fires the summary exactly once when a quit aborts the boot', async () => {
    // The third terminal case beside settle and fail, and the one `will-quit`
    // actually takes. `abort()` does NOT settle the post-window promise itself
    // (`boot-coordinator.ts` — it fires the signal and releases the persistence
    // gate); the in-flight boot observes `abortSignal` and returns, which is
    // what this `fn` reproduces. The summary rides the same `.finally()` as the
    // other two branches, so a quit still gets exactly one line.
    const summary = jest.fn();
    const coordinator = new BootCoordinator();
    coordinator.armBootSummary(summary);

    coordinator.startPostWindow(
      async () =>
        new Promise<void>((resolve) => {
          if (coordinator.abortSignal.aborted) {
            resolve();
            return;
          }
          coordinator.abortSignal.addEventListener('abort', () => resolve(), {
            once: true,
          });
        }),
    );

    expect(summary).not.toHaveBeenCalled();
    coordinator.abort();
    await coordinator.awaitCompletion(1000);

    expect(summary).toHaveBeenCalledTimes(1);
    expect(coordinator.snapshot().phase).toBe('settled');
  });

  it('does not delay the bounded drain when the summary throws on the abort path', async () => {
    // `handleWillQuit` gives the aborted boot ~2 s and then disposes regardless.
    // A summary that throws during that window must cost nothing: the drain has
    // to return on the boot's own timing, not on the diagnostic's.
    const warn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const coordinator = new BootCoordinator();
    coordinator.armBootSummary(() => {
      throw new Error('logger exploded mid-quit');
    });

    coordinator.startPostWindow(
      async () =>
        new Promise<void>((resolve) => {
          coordinator.abortSignal.addEventListener('abort', () => resolve(), {
            once: true,
          });
        }),
    );

    coordinator.abort();
    const startedAt = Date.now();
    await expect(coordinator.awaitCompletion(2000)).resolves.toBeUndefined();

    // Returned on the boot's timing, nowhere near the 2000 ms budget.
    expect(Date.now() - startedAt).toBeLessThan(1000);
    expect(warn).toHaveBeenCalledWith(
      '[BootCoordinator] degradation summary failed (non-fatal):',
      'logger exploded mid-quit',
    );
    warn.mockRestore();
  });

  it('leaves the summary UNFIRED when an aborted boot never observes the signal', async () => {
    // The honest limit of the guarantee, pinned rather than assumed. The
    // summary hangs off the post-window promise's `.finally()`, so a boot body
    // that ignores `abortSignal` and is still pending when `will-quit`'s drain
    // expires takes its line with it. That is deliberate — a summary emitted
    // from a timeout would describe a boot that is still running — and it is
    // why the summary is best-effort on a quit, not guaranteed.
    const summary = jest.fn();
    const coordinator = new BootCoordinator();
    coordinator.armBootSummary(summary);

    coordinator.startPostWindow(async () => new Promise<void>(() => undefined));

    coordinator.abort();
    await coordinator.awaitCompletion(20);

    expect(summary).not.toHaveBeenCalled();
    // The gate is still released, so no consumer is stranded by the quit.
    await expect(coordinator.whenPersistenceSettled()).resolves.toEqual({
      sqliteOpen: false,
    });
  });

  it('tolerates a boot with no summary armed', async () => {
    const coordinator = new BootCoordinator();
    coordinator.startPostWindow(async () => undefined);

    await expect(coordinator.awaitCompletion(1000)).resolves.toBeUndefined();
    expect(coordinator.snapshot().phase).toBe('settled');
  });
});
