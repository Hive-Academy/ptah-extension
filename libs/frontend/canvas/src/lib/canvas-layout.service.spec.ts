import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideSurfaceActiveTesting } from '@ptah-extension/core/testing';
import { CanvasLayoutService, type TileLayout } from './canvas-layout.service';

type ObserverCallback = (entries: ResizeObserverEntry[]) => void;

describe('CanvasLayoutService', () => {
  const active = signal(true);
  let service: CanvasLayoutService;
  let callback: ObserverCallback;
  let originalObserver: typeof ResizeObserver;
  let originalRaf: typeof requestAnimationFrame;
  let originalCancel: typeof cancelAnimationFrame;
  let disconnectMock: jest.Mock;
  let observeMock: jest.Mock;

  const measure = (width: number, height = 900): void => {
    callback([{ contentRect: { width, height } } as ResizeObserverEntry]);
  };

  beforeEach(() => {
    active.set(true);
    originalObserver = globalThis.ResizeObserver;
    originalRaf = globalThis.requestAnimationFrame;
    originalCancel = globalThis.cancelAnimationFrame;
    disconnectMock = jest.fn();
    observeMock = jest.fn();
    globalThis.ResizeObserver = class {
      constructor(cb: ObserverCallback) {
        callback = cb;
      }
      observe(): void {
        observeMock();
      }
      unobserve(): void {
        /* no-op */
      }
      disconnect(): void {
        disconnectMock();
      }
    } as unknown as typeof ResizeObserver;
    globalThis.requestAnimationFrame = jest.fn((cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    }) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = jest.fn() as typeof cancelAnimationFrame;
    TestBed.configureTestingModule({
      providers: [CanvasLayoutService, provideSurfaceActiveTesting(active)],
    });
    service = TestBed.inject(CanvasLayoutService);
    service.observe(document.createElement('div'));
  });

  afterEach(() => {
    globalThis.ResizeObserver = originalObserver;
    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCancel;
  });

  it('updates the width signal from observed container measurements', () => {
    measure(1234.9);
    expect(service.containerWidth()).toBe(1234);
    measure(800.4, 0);
    expect(service.containerWidth()).toBe(800);
    measure(0);
    expect(service.containerWidth()).toBe(800);
  });

  it('retains the latest valid pending width measurement', () => {
    const queuedFrames: FrameRequestCallback[] = [];
    let nextFrameId = 10;
    globalThis.requestAnimationFrame = jest.fn((frame: FrameRequestCallback) => {
      queuedFrames.push(frame);
      return ++nextFrameId;
    }) as typeof requestAnimationFrame;
    const cancelFrame = globalThis.cancelAnimationFrame as jest.Mock;

    measure(1000.9);
    measure(1234.9);
    measure(0);
    expect(cancelFrame).toHaveBeenCalledWith(11);
    expect(service.containerWidth()).toBe(0);
    queuedFrames.at(-1)?.(0);
    expect(service.containerWidth()).toBe(1234);
  });

  it('ignores inactive observations and re-observes on reactivation', () => {
    const frames: FrameRequestCallback[] = [];
    globalThis.requestAnimationFrame = jest.fn((frame: FrameRequestCallback) => {
      frames.push(frame);
      return frames.length;
    }) as typeof requestAnimationFrame;
    measure(1464);
    frames.at(-1)?.(0);
    active.set(false);
    TestBed.tick();
    measure(1180);
    expect(service.containerWidth()).toBe(1464);

    active.set(true);
    TestBed.tick();
    expect(observeMock).toHaveBeenCalledTimes(2);
    measure(1300);
    frames.at(-1)?.(0);
    expect(service.containerWidth()).toBe(1300);
  });

  it('disconnects the observer and cancels pending frames on destroy', () => {
    let pending: FrameRequestCallback | undefined;
    globalThis.requestAnimationFrame = jest.fn((frame: FrameRequestCallback) => {
      pending = frame;
      return 12;
    }) as typeof requestAnimationFrame;
    const cancelFrame = globalThis.cancelAnimationFrame as jest.Mock;

    measure(1200);
    TestBed.resetTestingModule();
    expect(disconnectMock).toHaveBeenCalledTimes(1);
    expect(cancelFrame).toHaveBeenCalledWith(12);
    pending?.(0);
    expect(service.containerWidth()).toBe(0);
  });

  it('TileLayout keeps the expected coordinate shape', () => {
    const position: TileLayout = { x: 0, y: 1, w: 2, h: 3 };
    expect([position.x, position.y, position.w, position.h]).toEqual([0, 1, 2, 3]);
  });
});
