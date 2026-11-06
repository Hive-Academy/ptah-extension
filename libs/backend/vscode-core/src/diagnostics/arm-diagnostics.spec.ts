import 'reflect-metadata';
import { container as rootContainer } from 'tsyringe';
import type { DependencyContainer } from 'tsyringe';
import { TOKENS } from '../di/tokens';
import { armDiagnostics } from './arm-diagnostics';
import { HANG_PROFILE_ENV, HangProfiler } from './hang-profiler';
import { createFakeInspectorSession } from '../testing/inspector-session.mock';
import type {
  EventLoopLagListener,
  EventLoopLagSample,
} from './event-loop-monitor';

/**
 * `armDiagnostics` is wiring, so it is tested with fakes: the question is which
 * collaborator gets started, joined and disposed — not what each one measures
 * (their own specs cover that, the watchdog against a real worker).
 */

function createFakes() {
  const listeners = new Set<EventLoopLagListener>();
  const sampleListeners = new Set<EventLoopLagListener>();
  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const monitor = {
    start: jest.fn(),
    dispose: jest.fn(),
    onLag: jest.fn((listener: EventLoopLagListener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }),
    onSample: jest.fn((listener: EventLoopLagListener) => {
      sampleListeners.add(listener);
      return () => {
        sampleListeners.delete(listener);
      };
    }),
  };
  const capture = {
    configure: jest.fn(),
    handleLag: jest.fn(),
    captureFor: jest.fn(async () => '/logs/p.cpuprofile'),
  };
  const watchdog = {
    start: jest.fn(),
    setBreadcrumb: jest.fn(),
    dispose: jest.fn(async () => undefined),
  };
  const emitLag = (sample: EventLoopLagSample) => {
    for (const listener of [...listeners]) listener(sample);
  };
  const governor = {
    attachLagSource: jest.fn(() => jest.fn()),
    dispose: jest.fn(),
  };
  return {
    logger,
    monitor,
    capture,
    watchdog,
    governor,
    listeners,
    sampleListeners,
    emitLag,
  };
}

function buildContainer(
  fakes: ReturnType<typeof createFakes>,
  options: { registerWatchdog?: boolean; registerGovernor?: boolean } = {},
): DependencyContainer {
  const c = rootContainer.createChildContainer();
  c.register(TOKENS.LOGGER, { useValue: fakes.logger });
  c.register(TOKENS.EVENT_LOOP_MONITOR, { useValue: fakes.monitor });
  c.register(TOKENS.CPU_PROFILE_CAPTURE, { useValue: fakes.capture });
  if (options.registerWatchdog !== false) {
    c.register(TOKENS.MAIN_LOOP_WATCHDOG, { useValue: fakes.watchdog });
  }
  if (options.registerGovernor !== false) {
    c.register(TOKENS.BACKGROUND_WORK_GOVERNOR, { useValue: fakes.governor });
  }
  return c;
}

const SAMPLE: EventLoopLagSample = { maxMs: 812, p99Ms: 640, meanMs: 90 };

describe('armDiagnostics — main-loop watchdog', () => {
  it('starts the watchdog against logsPath when one is given', () => {
    const fakes = createFakes();
    armDiagnostics({ container: buildContainer(fakes), logsPath: '/logs' });

    expect(fakes.watchdog.start).toHaveBeenCalledTimes(1);
    expect(fakes.watchdog.start).toHaveBeenCalledWith({ logsPath: '/logs' });
    expect(fakes.monitor.start).toHaveBeenCalledTimes(1);
  });

  it('does not start (or even need) the watchdog without logsPath', () => {
    const fakes = createFakes();
    const handle = armDiagnostics({
      container: buildContainer(fakes, { registerWatchdog: false }),
    });

    expect(fakes.watchdog.start).not.toHaveBeenCalled();
    expect(fakes.monitor.start).toHaveBeenCalledTimes(1);
    expect(fakes.logger.warn).not.toHaveBeenCalled();
    expect(() => handle.dispose()).not.toThrow();
  });

  it('keeps the lag monitor and profile capture when the watchdog fails to start', async () => {
    const fakes = createFakes();
    fakes.watchdog.start.mockImplementation(() => {
      throw new Error('workers unavailable');
    });

    const handle = armDiagnostics({
      container: buildContainer(fakes),
      logsPath: '/logs',
    });

    expect(fakes.logger.warn).toHaveBeenCalledWith(
      '[diagnostics] main-loop watchdog not armed',
      { reason: 'workers unavailable' },
    );
    expect(fakes.monitor.start).toHaveBeenCalledTimes(1);
    // Not the whole-handle fallback: capture still works.
    await expect(handle.captureCpuProfile(1_000)).resolves.toBe(
      '/logs/p.cpuprofile',
    );
    // A failed watchdog gets no breadcrumb listener and no dispose.
    fakes.emitLag(SAMPLE);
    expect(fakes.watchdog.setBreadcrumb).not.toHaveBeenCalled();
    handle.dispose();
    expect(fakes.watchdog.dispose).not.toHaveBeenCalled();
    expect(fakes.monitor.dispose).toHaveBeenCalledTimes(1);
  });

  it('also survives a watchdog that cannot be resolved', () => {
    const fakes = createFakes();
    armDiagnostics({
      container: buildContainer(fakes, { registerWatchdog: false }),
      logsPath: '/logs',
    });

    expect(fakes.logger.warn).toHaveBeenCalledWith(
      '[diagnostics] main-loop watchdog not armed',
      expect.objectContaining({ reason: expect.any(String) }),
    );
    expect(fakes.monitor.start).toHaveBeenCalledTimes(1);
  });

  it('records each lag warning as the lastLag breadcrumb', () => {
    const fakes = createFakes();
    armDiagnostics({ container: buildContainer(fakes), logsPath: '/logs' });

    fakes.emitLag(SAMPLE);

    expect(fakes.watchdog.setBreadcrumb).toHaveBeenCalledTimes(1);
    const [key, value] = fakes.watchdog.setBreadcrumb.mock.calls[0];
    expect(key).toBe('lastLag');
    expect(value).toMatch(/^max=812ms p99=640ms at \d{4}-\d{2}-\d{2}T/);
    expect(fakes.capture.handleLag).toHaveBeenCalledWith(SAMPLE);
  });

  it('disposes the watchdog with the handle and unsubscribes its lag listener', () => {
    const fakes = createFakes();
    const handle = armDiagnostics({
      container: buildContainer(fakes),
      logsPath: '/logs',
    });
    expect(fakes.listeners.size).toBe(2);

    handle.dispose();

    expect(fakes.watchdog.dispose).toHaveBeenCalledTimes(1);
    expect(fakes.monitor.dispose).toHaveBeenCalledTimes(1);
    expect(fakes.listeners.size).toBe(0);
  });
});

describe('armDiagnostics — background-work governor (TASK_2026_437 C14)', () => {
  it('attaches the monitor as the governor lag source, with or without logsPath', () => {
    const fakes = createFakes();
    armDiagnostics({
      container: buildContainer(fakes, { registerWatchdog: false }),
    });

    expect(fakes.governor.attachLagSource).toHaveBeenCalledTimes(1);
    expect(fakes.governor.attachLagSource).toHaveBeenCalledWith(fakes.monitor);
  });

  it('disposes the governor (host shutdown) when the handle is disposed', () => {
    const fakes = createFakes();
    const handle = armDiagnostics({
      container: buildContainer(fakes),
      logsPath: '/logs',
    });

    handle.dispose();

    expect(fakes.governor.dispose).toHaveBeenCalledTimes(1);
    expect(fakes.monitor.dispose).toHaveBeenCalledTimes(1);
  });

  it('keeps the lag monitor when the governor cannot be resolved', () => {
    const fakes = createFakes();
    armDiagnostics({
      container: buildContainer(fakes, { registerGovernor: false }),
      logsPath: '/logs',
    });

    expect(fakes.logger.warn).toHaveBeenCalledWith(
      '[diagnostics] background-work governor not attached',
      expect.objectContaining({ reason: expect.any(String) }),
    );
    expect(fakes.monitor.start).toHaveBeenCalledTimes(1);
    expect(fakes.watchdog.start).toHaveBeenCalledTimes(1);
  });
});

describe('armDiagnostics — opt-in hang profiler (PTAH_HANG_PROFILE)', () => {
  const original = process.env[HANG_PROFILE_ENV];

  afterEach(() => {
    if (original === undefined) delete process.env[HANG_PROFILE_ENV];
    else process.env[HANG_PROFILE_ENV] = original;
  });

  function armWithFakeSession(fakes: ReturnType<typeof createFakes>) {
    const session = createFakeInspectorSession();
    const handle = armDiagnostics({
      container: buildContainer(fakes),
      logsPath: '/logs',
      createHangProfiler: (options) =>
        new HangProfiler({ ...options, createSession: () => session }),
    });
    return { session, handle };
  }

  it('stays off by default: the watchdog writes its own recovery line', () => {
    delete process.env[HANG_PROFILE_ENV];
    const fakes = createFakes();
    const { session } = armWithFakeSession(fakes);

    expect(fakes.watchdog.start).toHaveBeenCalledWith({ logsPath: '/logs' });
    expect(session.calls).toEqual([]);
  });

  it('when on, starts sampling and routes the recovery line through the profiler', async () => {
    process.env[HANG_PROFILE_ENV] = '1';
    const fakes = createFakes();
    const { session, handle } = armWithFakeSession(fakes);

    const startArgs: unknown[] = fakes.watchdog.start.mock.calls[0];
    const options = startArgs[0] as { logsPath: string; onRecovered?: unknown };
    expect(options.logsPath).toBe('/logs');
    expect(typeof options.onRecovered).toBe('function');
    await waitForCalls(session, 3);
    expect(session.calls).toEqual([
      'Profiler.enable',
      'Profiler.setSamplingInterval',
      'Profiler.start',
    ]);

    handle.dispose();
    await waitForCalls(session, 4);
    expect(session.calls[3]).toBe('Profiler.stop');
    expect(session.disconnected).toBe(true);
  });

  it('disposes the profiler when the watchdog fails to start, leaving no debugger attached', async () => {
    process.env[HANG_PROFILE_ENV] = '1';
    const fakes = createFakes();
    fakes.watchdog.start.mockImplementation(() => {
      throw new Error('workers forbidden');
    });
    let profiler: HangProfiler | undefined;
    const session = createFakeInspectorSession();
    armDiagnostics({
      container: buildContainer(fakes),
      logsPath: '/logs',
      createHangProfiler: (options) => {
        profiler = new HangProfiler({ ...options, createSession: () => session });
        return profiler;
      },
    });
    for (let i = 0; i < 50; i++) {
      await new Promise((resolve) => setImmediate(resolve));
    }

    expect(profiler).toBeDefined();
    // Disposed before its queued start ran: no inspector session was opened,
    // so nothing samples and no rotation timer holds the profiler alive.
    expect(session.calls).toEqual([]);
    expect(
      (profiler as unknown as { rotateTimer: unknown }).rotateTimer,
    ).toBeUndefined();
  });
});

async function waitForCalls(
  session: { calls: string[] },
  count: number,
): Promise<void> {
  for (let i = 0; i < 50 && session.calls.length < count; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}
