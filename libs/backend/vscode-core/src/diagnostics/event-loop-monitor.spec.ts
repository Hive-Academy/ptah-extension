import 'reflect-metadata';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import {
  DEFAULT_EVENT_LOOP_LAG_WARN_MS,
  EVENT_LOOP_LAG_WARN_MS_ENV,
  EventLoopMonitor,
} from './event-loop-monitor';
import type { Logger } from '../logging/logger';

/**
 * The histogram is mocked rather than driven for real because the assertions
 * here are about the DECISIONS the monitor makes — threshold, reset, listener
 * fan-out — not about libuv's measurements. Blocking a real event loop for
 * 250 ms inside a unit test would trade determinism for nothing.
 */
jest.mock('node:perf_hooks', () => ({
  monitorEventLoopDelay: jest.fn(),
}));

const NS_PER_MS = 1e6;

interface FakeHistogram {
  enable: jest.Mock;
  disable: jest.Mock;
  reset: jest.Mock;
  percentile: jest.Mock;
  max: number;
  mean: number;
}

function createHistogram(maxMs: number, p99Ms = maxMs): FakeHistogram {
  return {
    enable: jest.fn(),
    disable: jest.fn(),
    reset: jest.fn(),
    percentile: jest.fn().mockReturnValue(p99Ms * NS_PER_MS),
    max: maxMs * NS_PER_MS,
    mean: (maxMs / 2) * NS_PER_MS,
  };
}

function createLogger(): jest.Mocked<Pick<Logger, 'debug' | 'info' | 'warn'>> {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  } as unknown as jest.Mocked<Pick<Logger, 'debug' | 'info' | 'warn'>>;
}

describe('EventLoopMonitor', () => {
  const monitorMock = monitorEventLoopDelay as unknown as jest.Mock;
  let logger: ReturnType<typeof createLogger>;
  let monitor: EventLoopMonitor;
  let unref: jest.Mock;
  let clearIntervalSpy: jest.SpyInstance;
  let setIntervalSpy: jest.SpyInstance;
  /** The callback the monitor handed to `setInterval`, invoked by hand. */
  let tick: () => void;

  beforeEach(() => {
    logger = createLogger();
    monitor = new EventLoopMonitor(logger as unknown as Logger);
    unref = jest.fn();

    setIntervalSpy = jest.spyOn(global, 'setInterval').mockImplementation(((
      callback: () => void,
    ) => {
      tick = callback;
      return { unref } as unknown as NodeJS.Timeout;
    }) as unknown as typeof setInterval);
    clearIntervalSpy = jest
      .spyOn(global, 'clearInterval')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    delete process.env[EVENT_LOOP_LAG_WARN_MS_ENV];
    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
    monitorMock.mockReset();
  });

  it('unrefs the sampling interval so it cannot hold the process open', () => {
    monitorMock.mockReturnValue(createHistogram(0));

    monitor.start();

    expect(unref).toHaveBeenCalledTimes(1);
  });

  it('warns with maxMs and p99Ms once the window breaches the threshold', () => {
    monitorMock.mockReturnValue(createHistogram(900, 640));

    monitor.start({ warnThresholdMs: 250 });
    tick();

    expect(logger.warn).toHaveBeenCalledWith('[event-loop] lag', {
      maxMs: 900,
      p99Ms: 640,
    });
  });

  it('stays silent for a window under the threshold', () => {
    monitorMock.mockReturnValue(createHistogram(40, 30));

    monitor.start({ warnThresholdMs: 250 });
    tick();

    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('resets the histogram every window, breach or not', () => {
    const histogram = createHistogram(10);
    monitorMock.mockReturnValue(histogram);

    monitor.start({ warnThresholdMs: 250 });
    tick();
    tick();

    // Without this, `max` is a session high-water mark and one early stall
    // would keep every later window above the threshold forever.
    expect(histogram.reset).toHaveBeenCalledTimes(2);
  });

  it('defaults the threshold to 250 ms', () => {
    monitorMock.mockReturnValue(createHistogram(0));

    monitor.start();

    expect(monitor.thresholdMs).toBe(DEFAULT_EVENT_LOOP_LAG_WARN_MS);
  });

  it('lets PTAH_LOOP_LAG_WARN_MS override an explicit option', () => {
    process.env[EVENT_LOOP_LAG_WARN_MS_ENV] = '75';
    monitorMock.mockReturnValue(createHistogram(100, 90));

    monitor.start({ warnThresholdMs: 5000 });
    tick();

    expect(monitor.thresholdMs).toBe(75);
    expect(logger.warn).toHaveBeenCalledWith('[event-loop] lag', {
      maxMs: 100,
      p99Ms: 90,
    });
  });

  it('ignores a malformed threshold rather than breaking the monitor', () => {
    process.env[EVENT_LOOP_LAG_WARN_MS_ENV] = 'not-a-number';
    monitorMock.mockReturnValue(createHistogram(0));

    monitor.start();

    expect(monitor.thresholdMs).toBe(DEFAULT_EVENT_LOOP_LAG_WARN_MS);
  });

  it('notifies onLag subscribers and honours unsubscribe', () => {
    monitorMock.mockReturnValue(createHistogram(500, 400));
    const listener = jest.fn();

    const unsubscribe = monitor.onLag(listener);
    monitor.start({ warnThresholdMs: 250 });
    tick();
    expect(listener).toHaveBeenCalledWith({
      maxMs: 500,
      p99Ms: 400,
      meanMs: 250,
    });

    unsubscribe();
    tick();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('keeps sampling when a listener throws', () => {
    monitorMock.mockReturnValue(createHistogram(500, 400));
    monitor.onLag(() => {
      throw new Error('capture exploded');
    });

    monitor.start({ warnThresholdMs: 250 });

    expect(() => {
      tick();
      tick();
    }).not.toThrow();
    expect(
      logger.warn.mock.calls.filter((call) => call[0] === '[event-loop] lag'),
    ).toHaveLength(2);
  });

  it('is idempotent — a second start does not create a second histogram', () => {
    monitorMock.mockReturnValue(createHistogram(0));

    monitor.start();
    monitor.start();

    expect(monitorMock).toHaveBeenCalledTimes(1);
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
  });

  it('dispose clears the interval, disables the histogram and stops reporting', () => {
    const histogram = createHistogram(900);
    monitorMock.mockReturnValue(histogram);
    const listener = jest.fn();
    monitor.onLag(listener);

    monitor.start({ warnThresholdMs: 250 });
    expect(monitor.running).toBe(true);

    monitor.dispose();

    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
    expect(histogram.disable).toHaveBeenCalledTimes(1);
    expect(monitor.running).toBe(false);

    // A tick that somehow still lands after disposal must be inert.
    tick();
    expect(listener).not.toHaveBeenCalled();
  });

  it('dispose is safe before start and safe twice', () => {
    monitorMock.mockReturnValue(createHistogram(0));

    expect(() => monitor.dispose()).not.toThrow();
    monitor.start();
    expect(() => {
      monitor.dispose();
      monitor.dispose();
    }).not.toThrow();
  });
});
