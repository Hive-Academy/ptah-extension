/** @jest-environment jsdom */
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { STILL_LEVEL } from '../../shared/lightning/strike-loop';
import { FlankBoltComponent } from './flank-bolt.component';

describe('FlankBoltComponent', () => {
  const alphas: number[] = [];
  let reducedMotion: boolean;
  let observe: IntersectionObserverCallback | undefined;
  let resized: ResizeObserverCallback | undefined;
  const resizeDisconnect = jest.fn();
  const mediaListeners = new Map<string, () => void>();
  const removeListener = jest.fn();
  let width: jest.SpyInstance;
  let canvas: HTMLCanvasElement | null;

  function mount(platform: 'server' | 'browser') {
    TestBed.configureTestingModule({
      imports: [FlankBoltComponent],
      providers: [{ provide: PLATFORM_ID, useValue: platform }],
    });
    const fixture = TestBed.createComponent(FlankBoltComponent);
    fixture.componentRef.setInput('seed', 31);
    fixture.detectChanges();
    return { fixture, component: fixture.componentInstance, root: fixture.nativeElement as HTMLElement };
  }

  const show = (visible: boolean): void =>
    observe?.([{ isIntersecting: visible } as IntersectionObserverEntry], {} as IntersectionObserver);

  const setPixelRatio = (ratio: number): void => {
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: ratio });
  };

  beforeEach(() => {
    jest.useFakeTimers();
    alphas.length = 0;
    reducedMotion = false;
    canvas = null;
    resized = undefined;
    mediaListeners.clear();
    removeListener.mockClear();
    resizeDisconnect.mockClear();
    setPixelRatio(1);
    const context: { canvas: HTMLCanvasElement | null; globalAlpha: number } & Record<string, unknown> = {
      canvas: null,
      beginPath: jest.fn(),
      moveTo: jest.fn(),
      lineTo: jest.fn(),
      stroke: jest.fn((): void => {
        alphas.push(context.globalAlpha);
      }),
      clearRect: jest.fn(),
      setTransform: jest.fn(),
      globalAlpha: 1,
      lineWidth: 1,
      shadowBlur: 0,
    };
    jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
      context.canvas = this;
      canvas = context.canvas;
      return context as unknown as CanvasRenderingContext2D;
    } as never);
    width = jest.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(64);
    jest.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(600);
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: jest.fn((query: string) => ({
        matches: reducedMotion && query.includes('reduce'),
        addEventListener: (_type: string, listener: () => void) => mediaListeners.set(query, listener),
        removeEventListener: removeListener,
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
          return undefined;
        }
      },
    });
    Object.defineProperty(window, 'ResizeObserver', {
      configurable: true,
      value: class {
        public constructor(callback: ResizeObserverCallback) {
          resized = callback;
        }
        public observe(): void {
          return undefined;
        }
        public disconnect(): void {
          resizeDisconnect();
        }
      },
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  it('is a decorative host with nothing drawn on the server', () => {
    const { root, fixture } = mount('server');
    expect(root.getAttribute('aria-hidden')).toBe('true');
    expect(root.getAttribute('data-axis')).toBe('vertical');
    expect(alphas).toHaveLength(0);
    fixture.destroy();
  });

  it('paints strikes while visible and stops the loop off screen', () => {
    const { component, fixture } = mount('browser');
    fixture.detectChanges();
    show(true);
    jest.advanceTimersByTime(15_000);

    expect(alphas.length).toBeGreaterThan(0);
    expect(Math.max(...alphas)).toBeLessThanOrEqual(1);
    show(false);
    expect(component.running).toBe(false);
    fixture.destroy();
  });

  it('reduced motion: one faint still bolt, no loop, and listeners released on destroy', () => {
    reducedMotion = true;
    const { component, fixture } = mount('browser');
    fixture.detectChanges();
    show(true);
    const drawn = alphas.length;
    jest.advanceTimersByTime(15_000);

    expect(component.running).toBe(false);
    expect(alphas.length).toBe(drawn);
    // The core stroke (alpha 0.95) scaled by the still level.
    expect(Math.max(...alphas)).toBeCloseTo(0.95 * STILL_LEVEL, 5);
    fixture.destroy();
    expect(removeListener).toHaveBeenCalledWith('change', expect.any(Function));
  });

  it('reduced motion: repaints the still bolt at the new size and pixel ratio', () => {
    reducedMotion = true;
    const { fixture } = mount('browser');
    fixture.detectChanges();
    show(true);
    expect(canvas?.width).toBe(64);
    const first = alphas.length;
    expect(first).toBeGreaterThan(0);

    // The host grows: the observer repaints into a bigger bitmap.
    width.mockReturnValue(128);
    resized?.([], {} as ResizeObserver);
    expect(canvas?.width).toBe(128);
    expect(alphas.length).toBe(2 * first);

    // The pixel ratio changes (zoom, another screen): the bitmap is capped at 1.5x.
    const dprListener = mediaListeners.get('(resolution: 1dppx)');
    expect(dprListener).toBeDefined();
    setPixelRatio(2);
    dprListener?.();
    expect(canvas?.width).toBe(192);
    expect(canvas?.height).toBe(900);
    expect(alphas.length).toBe(3 * first);
    // It now watches the new ratio.
    expect(mediaListeners.has('(resolution: 2dppx)')).toBe(true);

    fixture.destroy();
    expect(resizeDisconnect).toHaveBeenCalledTimes(1);
    expect(removeListener).toHaveBeenCalledWith('change', dprListener);
  });
});
