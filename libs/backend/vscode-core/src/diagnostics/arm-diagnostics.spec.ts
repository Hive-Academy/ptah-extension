import 'reflect-metadata';
import { container as rootContainer } from 'tsyringe';
import type { DependencyContainer } from 'tsyringe';
import { TOKENS } from '../di/tokens';
import { armDiagnostics } from './arm-diagnostics';
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
  return { logger, monitor, capture, watchdog, listeners, emitLag };
}

function buildContainer(
  fakes: ReturnType<typeof createFakes>,
  options: { registerWatchdog?: boolean } = {},
): DependencyContainer {
  const c = rootContainer.createChildContainer();
  c.register(TOKENS.LOGGER, { useValue: fakes.logger });
  c.register(TOKENS.EVENT_LOOP_MONITOR, { useValue: fakes.monitor });
  c.register(TOKENS.CPU_PROFILE_CAPTURE, { useValue: fakes.capture });
  if (options.registerWatchdog !== false) {
    c.register(TOKENS.MAIN_LOOP_WATCHDOG, { useValue: fakes.watchdog });
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
