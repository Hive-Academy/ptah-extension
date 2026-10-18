import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { CacheCountdownClockService } from './cache-countdown-clock.service';

describe(CacheCountdownClockService.name, () => {
  let hidden = false;
  let documentMock: Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'>;
  let visibilityChanged: (() => void) | undefined;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(1_000);
    hidden = false;
    visibilityChanged = undefined;
    documentMock = {
      get hidden() { return hidden; },
      addEventListener: jest.fn((event: string, listener: EventListenerOrEventListenerObject) => {
        if (event === 'visibilitychange' && typeof listener === 'function') visibilityChanged = () => listener(new Event(event));
      }),
      removeEventListener: jest.fn(),
    };
    TestBed.configureTestingModule({ providers: [{ provide: DOCUMENT, useValue: documentMock }] });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    jest.useRealTimers();
  });

  it('shares one timer, samples immediately, and releases the last listener', () => {
    const clock = TestBed.inject(CacheCountdownClockService);
    const first = clock.acquire();
    expect(clock.now()).toBe(1_000);
    expect(jest.getTimerCount()).toBe(1);
    jest.setSystemTime(2_000);
    const second = clock.acquire();
    expect(clock.now()).toBe(2_000);
    expect(jest.getTimerCount()).toBe(1);
    first();
    expect(jest.getTimerCount()).toBe(1);
    second();
    second();
    expect(jest.getTimerCount()).toBe(0);
    expect(documentMock.removeEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  });

  it('pauses while hidden and samples immediately when visible', () => {
    const clock = TestBed.inject(CacheCountdownClockService);
    const release = clock.acquire();
    hidden = true;
    visibilityChanged?.();
    expect(jest.getTimerCount()).toBe(0);
    jest.setSystemTime(15_000);
    hidden = false;
    visibilityChanged?.();
    expect(clock.now()).toBe(15_000);
    expect(jest.getTimerCount()).toBe(1);
    jest.advanceTimersByTime(1_000);
    expect(clock.now()).toBe(16_000);
    release();
  });
});
