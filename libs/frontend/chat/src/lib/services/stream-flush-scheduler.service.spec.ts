import { TestBed } from '@angular/core/testing';
import { StreamFlushScheduler } from './stream-flush-scheduler.service';
import { StreamViewportController, type StreamTier } from './stream-viewport-controller.service';

describe('StreamFlushScheduler', () => {
  let scheduler: StreamFlushScheduler;
  let tiers: Map<string, StreamTier>;
  let frameCallbacks: FrameRequestCallback[];
  let requestFrameSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    tiers = new Map();
    frameCallbacks = [];
    requestFrameSpy = jest
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        frameCallbacks.push(callback);
        return frameCallbacks.length;
      });
    TestBed.configureTestingModule({
      providers: [
        StreamFlushScheduler,
        {
          provide: StreamViewportController,
          useValue: {
            tierFor: (tabId: string | undefined): StreamTier =>
              tiers.get(tabId ?? '') ?? 'hidden',
          },
        },
      ],
    });
    scheduler = TestBed.inject(StreamFlushScheduler);
  });

  afterEach(() => {
    requestFrameSpy.mockRestore();
    TestBed.resetTestingModule();
    jest.useRealTimers();
  });

  it('uses one rAF to apply all focused records in arrival order', () => {
    tiers.set('tab-1', 'focused');
    const applied: string[] = [];

    scheduler.enqueue('tab-1', () => applied.push('first'));
    scheduler.enqueue('tab-1', () => applied.push('second'));

    expect(requestFrameSpy).toHaveBeenCalledTimes(1);
    frameCallbacks[0](0);
    expect(applied).toEqual(['first', 'second']);
  });

  it('uses one 50 ms task per visible surface', () => {
    tiers.set('tab-1', 'visible');
    const applied: string[] = [];

    scheduler.enqueue('tab-1', () => applied.push('first'));
    scheduler.enqueue('tab-1', () => applied.push('second'));

    expect(requestFrameSpy).not.toHaveBeenCalled();
    jest.advanceTimersByTime(49);
    expect(applied).toEqual([]);
    jest.advanceTimersByTime(1);
    expect(applied).toEqual(['first', 'second']);
  });

  it('does not schedule hidden records', () => {
    tiers.set('tab-1', 'hidden');
    const applied = jest.fn();

    scheduler.enqueue('tab-1', applied);

    expect(requestFrameSpy).not.toHaveBeenCalled();
    jest.advanceTimersByTime(100);
    expect(applied).not.toHaveBeenCalled();
  });

  it('applies an ordered reveal snapshot once', () => {
    tiers.set('tab-1', 'focused');
    const applied: string[] = [];
    const snapshot = {
      protocolVersion: 2 as const,
      tabId: 'tab-1',
      fromSequence: 4,
      toSequence: 6,
      events: [],
    };

    scheduler.enqueueSnapshot(snapshot, () => applied.push('snapshot'));
    scheduler.enqueueSnapshot(snapshot, () => applied.push('duplicate'));
    frameCallbacks[0](0);

    expect(applied).toEqual(['snapshot']);
  });

  it('preserves tab ordering when a visible tab becomes focused mid-stream', () => {
    tiers.set('tab-1', 'visible');
    const applied: string[] = [];

    scheduler.enqueue('tab-1', () => applied.push('visible-before-switch'));
    tiers.set('tab-1', 'focused');
    scheduler.enqueue('tab-1', () => applied.push('focused-after-switch'));

    frameCallbacks[0](0);
    expect(applied).toEqual(['visible-before-switch', 'focused-after-switch']);
  });
});
