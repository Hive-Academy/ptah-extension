import { DOCUMENT } from '@angular/common';
import {
  EnvironmentInjector,
  NgZone,
  createEnvironmentInjector,
  runInInjectionContext,
  signal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  WALL_CLOCK_COARSE_MS,
  WallClockService,
  injectWallClock,
} from './wall-clock.service';

describe(WallClockService.name, () => {
  let hidden: boolean;
  let visibilityListener: EventListenerOrEventListenerObject | undefined;
  let documentMock: Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'>;

  const changeVisibility = (isHidden: boolean): void => {
    hidden = isHidden;
    const event = new Event('visibilitychange');
    if (typeof visibilityListener === 'function') visibilityListener(event);
    else visibilityListener?.handleEvent(event);
  };

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(1_000);
    hidden = false;
    visibilityListener = undefined;
    documentMock = {
      get hidden() { return hidden; },
      addEventListener: jest.fn((event: string, listener: EventListenerOrEventListenerObject) => {
        if (event === 'visibilitychange') visibilityListener = listener;
      }),
      removeEventListener: jest.fn(),
    };
    TestBed.configureTestingModule({ providers: [{ provide: DOCUMENT, useValue: documentMock }] });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    jest.useRealTimers();
  });

  it('shares one interval per cadence, refreshes every acquisition, and releases idempotently', () => {
    const clock = TestBed.inject(WallClockService);
    const now = clock.now('second');
    const first = clock.acquire('second');
    expect(clock.now('second')).toBe(now);
    expect(jest.getTimerCount()).toBe(1);
    expect(documentMock.addEventListener).toHaveBeenCalledTimes(1);

    jest.setSystemTime(2_000);
    const second = clock.acquire('second');
    expect(now()).toBe(2_000);
    expect(jest.getTimerCount()).toBe(1);
    first();
    first();
    expect(jest.getTimerCount()).toBe(1);
    second();
    second();
    expect(jest.getTimerCount()).toBe(0);
    expect(documentMock.removeEventListener).toHaveBeenCalledTimes(1);
    expect(documentMock.removeEventListener).toHaveBeenCalledWith('visibilitychange', visibilityListener);
  });

  it('runs independent second and coarse intervals outside Angular', () => {
    const zone = TestBed.inject(NgZone);
    const outsideAngular = jest.spyOn(zone, 'runOutsideAngular');
    const clock = TestBed.inject(WallClockService);
    const releaseSecond = clock.acquire('second');
    const releaseCoarse = clock.acquire('coarse');
    expect(jest.getTimerCount()).toBe(2);
    expect(outsideAngular).toHaveBeenCalledTimes(2);
    expect(documentMock.addEventListener).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(1_000);
    expect(clock.now('second')()).toBe(2_000);
    expect(clock.now('coarse')()).toBe(1_000);
    jest.advanceTimersByTime(WALL_CLOCK_COARSE_MS - 1_000);
    expect(clock.now('coarse')()).toBe(31_000);
    releaseSecond();
    expect(jest.getTimerCount()).toBe(1);
    expect(documentMock.removeEventListener).not.toHaveBeenCalled();
    releaseCoarse();
    expect(jest.getTimerCount()).toBe(0);
    expect(documentMock.removeEventListener).toHaveBeenCalledTimes(1);
  });

  it('pauses while hidden and immediately refreshes acquired cadences on visibility', () => {
    const clock = TestBed.inject(WallClockService);
    const releaseSecond = clock.acquire('second');
    const releaseCoarse = clock.acquire('coarse');
    changeVisibility(true);
    expect(jest.getTimerCount()).toBe(0);
    jest.setSystemTime(50_000);
    expect(clock.now('second')()).toBe(1_000);
    expect(clock.now('coarse')()).toBe(1_000);
    changeVisibility(false);
    expect(clock.now('second')()).toBe(50_000);
    expect(clock.now('coarse')()).toBe(50_000);
    expect(jest.getTimerCount()).toBe(2);
    releaseSecond();
    releaseCoarse();
  });

  it('releases an unconditional injection when its DestroyRef is destroyed', () => {
    const injector = createEnvironmentInjector([], TestBed.inject(EnvironmentInjector));
    const clock = TestBed.inject(WallClockService);
    const now = runInInjectionContext(injector, () => injectWallClock('second'));
    expect(now).toBe(clock.now('second'));
    expect(jest.getTimerCount()).toBe(1);
    injector.destroy();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('holds no interval while inactive and cleans up an active injection on destroy', () => {
    const injector = createEnvironmentInjector([], TestBed.inject(EnvironmentInjector));
    const active = signal(false);
    const clock = TestBed.inject(WallClockService);
    const now = runInInjectionContext(injector, () => injectWallClock('coarse', active));
    TestBed.tick();
    expect(now).toBe(clock.now('coarse'));
    expect(jest.getTimerCount()).toBe(0);

    active.set(true);
    TestBed.tick();
    expect(jest.getTimerCount()).toBe(1);
    active.set(false);
    TestBed.tick();
    expect(jest.getTimerCount()).toBe(0);
    active.set(true);
    TestBed.tick();
    expect(jest.getTimerCount()).toBe(1);
    injector.destroy();
    expect(jest.getTimerCount()).toBe(0);
  });
});
