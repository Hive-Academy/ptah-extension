/** @jest-environment jsdom */
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { STILL_LEVEL } from '../../shared/lightning/strike-loop';
import { FlankBoltComponent } from './flank-bolt.component';

describe('FlankBoltComponent', () => {
  const alphas: number[] = [];
  let reducedMotion: boolean;
  let observe: IntersectionObserverCallback | undefined;
  const removeListener = jest.fn();

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

  beforeEach(() => {
    jest.useFakeTimers();
    alphas.length = 0;
    reducedMotion = false;
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
      return context as unknown as CanvasRenderingContext2D;
    } as never);
    jest.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(64);
    jest.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(600);
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: jest.fn(() => ({
        matches: reducedMotion,
        addEventListener: jest.fn(),
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

  it('paints only during brief strikes and sleeps between them', () => {
    const { component, fixture } = mount('browser');
    fixture.detectChanges();
    show(true);
    jest.advanceTimersByTime(15_000);

    // Several strikes, each a few frames of three strokes plus two forks.
    expect(alphas.length).toBeGreaterThan(0);
    expect(Math.max(...alphas)).toBeLessThanOrEqual(1);
    // Between strikes the loop waits on a timer, not on frames.
    expect(component.running).toBe(true);
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
});
