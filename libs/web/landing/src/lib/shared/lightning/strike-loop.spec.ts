/** @jest-environment jsdom */
import { STRIKE_TIMING, StrikeSchedule } from './strike-schedule';
import { StrikeLoop, StrikePainter } from './strike-loop';

describe('StrikeLoop', () => {
  const SEED = 9;
  let observe: IntersectionObserverCallback | undefined;
  const disconnect = jest.fn();
  const removeMotionListener = jest.fn();
  let painter: { draw: jest.Mock; clear: jest.Mock };

  beforeEach(() => {
    jest.useFakeTimers();
    disconnect.mockClear();
    removeMotionListener.mockClear();
    painter = { draw: jest.fn(), clear: jest.fn() };
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: jest.fn(() => ({
        matches: false,
        addEventListener: jest.fn(),
        removeEventListener: removeMotionListener,
      })),
    });
    Object.defineProperty(window, 'IntersectionObserver', {
      configurable: true,
      value: class {
        public constructor(callback: IntersectionObserverCallback) {
          observe = callback;
        }
        public observe(): void {
          return undefined;
        }
        public disconnect(): void {
          disconnect();
        }
      },
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  function start(): StrikeLoop {
    const loop = new StrikeLoop(
      window,
      painter as StrikePainter,
      document.createElement('div'),
      SEED,
    );
    observe?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    return loop;
  }

  it('runs no animation frames and draws nothing through a dark gap', () => {
    const raf = jest.spyOn(window, 'requestAnimationFrame');
    const reference = new StrikeSchedule(SEED);
    const firstStart = reference.untilNext(0);
    const firstEnd = firstStart + STRIKE_TIMING.durationMs;
    const gap = reference.untilNext(firstEnd);
    expect(gap).toBeGreaterThanOrEqual(STRIKE_TIMING.minGapMs);
    const secondStart = firstEnd + gap;

    const loop = start();
    // Before the first strike: one frame to find the gap, then a timer, no drawing.
    jest.advanceTimersByTime(firstStart - 50);
    expect(painter.draw).not.toHaveBeenCalled();
    expect(raf.mock.calls.length).toBeLessThanOrEqual(1);

    // Through the first strike: frames run and draw.
    jest.advanceTimersByTime(STRIKE_TIMING.durationMs + 100);
    expect(painter.draw.mock.calls.length).toBeGreaterThan(5);
    const framesAfterStrike = raf.mock.calls.length;
    const drawsAfterStrike = painter.draw.mock.calls.length;

    // The dark gap (now at firstEnd + 50, until 100 ms before the next strike):
    // no frames, no drawing, only the sleeping timer.
    jest.advanceTimersByTime(secondStart - 100 - (firstEnd + 50));
    expect(raf.mock.calls.length).toBe(framesAfterStrike);
    expect(painter.draw.mock.calls.length).toBe(drawsAfterStrike);
    expect(loop.running).toBe(true);
    loop.destroy();
  });

  it('cancels its pending frame or timer and tears down listeners and the observer on destroy', () => {
    const cancelFrame = jest.spyOn(window, 'cancelAnimationFrame');
    const clearTimer = jest.spyOn(window, 'clearTimeout');
    const removeDoc = jest.spyOn(document, 'removeEventListener');
    const first = new StrikeSchedule(SEED).untilNext(0);

    // Destroy while sleeping in the gap: the timer is cleared.
    const sleeping = start();
    jest.advanceTimersByTime(first / 2);
    expect(sleeping.running).toBe(true);
    sleeping.destroy();
    expect(clearTimer).toHaveBeenCalled();
    expect(sleeping.running).toBe(false);

    // Destroy mid-strike: the frame is cancelled.
    const striking = start();
    jest.advanceTimersByTime(first + 40);
    striking.destroy();
    expect(cancelFrame).toHaveBeenCalled();
    expect(striking.running).toBe(false);

    expect(disconnect).toHaveBeenCalledTimes(2);
    expect(removeMotionListener).toHaveBeenCalledWith('change', expect.any(Function));
    expect(removeDoc).toHaveBeenCalledWith('visibilitychange', expect.any(Function));

    // Nothing runs after destroy.
    const drawn = painter.draw.mock.calls.length;
    jest.advanceTimersByTime(30_000);
    expect(painter.draw.mock.calls.length).toBe(drawn);
  });
});
