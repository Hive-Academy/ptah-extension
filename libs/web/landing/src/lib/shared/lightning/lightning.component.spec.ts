/** @jest-environment jsdom */
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { LightningComponent, STILL_LEVEL } from './lightning.component';
import { LightningRenderer, LightningUniforms } from './lightning-renderer';
import { StrikeSchedule } from './strike-schedule';

function mount(platform: 'server' | 'browser', seed = 3) {
  TestBed.configureTestingModule({
    imports: [LightningComponent],
    providers: [{ provide: PLATFORM_ID, useValue: platform }],
  });
  const fixture = TestBed.createComponent(LightningComponent);
  fixture.componentRef.setInput('hue', 40);
  fixture.componentRef.setInput('intensity', 0.6);
  fixture.componentRef.setInput('seed', seed);
  fixture.detectChanges();
  return { fixture, component: fixture.componentInstance, root: fixture.nativeElement as HTMLElement };
}

describe('LightningComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('server render: a hidden canvas plus the static faint line at the given intensity', () => {
    const { root, component, fixture } = mount('server');
    expect(root.querySelector('canvas')?.getAttribute('aria-hidden')).toBe('true');
    expect(component.fallback()).toBe(true);
    expect((root.querySelector('.bolt-fallback') as HTMLElement | null)?.style.opacity).toBe('0.6');
    fixture.destroy();
  });

  it('keeps the static line when the browser has no WebGL', () => {
    const { component, root, fixture } = mount('browser');
    fixture.detectChanges();
    expect(component.fallback()).toBe(true);
    expect(root.querySelector('.bolt-fallback')).not.toBeNull();
    fixture.destroy();
  });

  describe('with WebGL', () => {
    const draws: { at: number; uniforms: LightningUniforms }[] = [];
    const renderer = {
      draw: jest.fn((_time: number, uniforms: LightningUniforms) =>
        draws.push({ at: performance.now(), uniforms }),
      ),
      clear: jest.fn(),
      dispose: jest.fn(),
    };
    let observe: IntersectionObserverCallback | undefined;
    let reducedMotion: boolean;
    let motionListener: ((event: MediaQueryListEvent) => void) | undefined;
    const removeListener = jest.fn();

    beforeEach(() => {
      jest.useFakeTimers();
      draws.length = 0;
      jest.clearAllMocks();
      reducedMotion = false;
      motionListener = undefined;
      Object.defineProperty(window, 'WebGLRenderingContext', { configurable: true, value: function WebGL() {} });
      jest.spyOn(LightningRenderer, 'create').mockReturnValue(renderer as unknown as LightningRenderer);
      Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: jest.fn(() => ({
          matches: reducedMotion,
          addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) =>
            (motionListener = listener),
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
    });

    const show = (visible: boolean): void =>
      observe?.([{ isIntersecting: visible } as IntersectionObserverEntry], {} as IntersectionObserver);

    it('strikes briefly, then stays dark through seeded idle gaps', () => {
      const started = performance.now();
      const { fixture } = mount('browser', 3);
      fixture.detectChanges();
      show(true);
      jest.advanceTimersByTime(20_000);

      const reference = new StrikeSchedule(3);
      expect(draws.length).toBeGreaterThan(0);
      for (const draw of draws) expect(reference.envelope(draw.at - started)).toBeGreaterThan(0);
      // Group draws into strikes: a new strike starts after more than a second of darkness.
      const strikes = draws.filter((draw, i) => i === 0 || draw.at - draws[i - 1].at > 1000);
      expect(strikes.length).toBeGreaterThanOrEqual(3);
      // Never brighter than the input intensity.
      expect(Math.max(...draws.map((draw) => draw.uniforms.intensity))).toBeLessThanOrEqual(0.6);
      // Thin and crisp: sub-pixel core, a few pixels of halo.
      expect(draws[0].uniforms.core).toBeLessThanOrEqual(1);
      expect(draws[0].uniforms.glow).toBeLessThanOrEqual(5);
      fixture.destroy();
    });

    it('stops the loop off screen and while the tab is hidden', () => {
      const { component, fixture } = mount('browser');
      fixture.detectChanges();
      show(true);
      expect(component.running).toBe(true);
      show(false);
      expect(component.running).toBe(false);

      show(true);
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
      expect(component.running).toBe(false);
      Object.defineProperty(document, 'hidden', { configurable: true, value: false });
      fixture.destroy();
    });

    it('reduced motion: one faint still frame, no flashing, no loop', () => {
      reducedMotion = true;
      const { component, fixture } = mount('browser');
      fixture.detectChanges();
      show(true);
      fixture.componentRef.setInput('strike', 1);
      fixture.detectChanges();
      jest.advanceTimersByTime(20_000);

      expect(component.running).toBe(false);
      expect(new Set(draws.map((draw) => draw.uniforms.intensity))).toEqual(new Set([0.6 * STILL_LEVEL]));
      fixture.destroy();
    });

    it('follows a live reduced-motion change and releases everything on destroy', () => {
      const { component, fixture } = mount('browser');
      fixture.detectChanges();
      show(true);
      expect(component.running).toBe(true);

      motionListener?.({ matches: true } as MediaQueryListEvent);
      expect(component.running).toBe(false);
      const drawn = draws.length;
      jest.advanceTimersByTime(20_000);
      expect(draws.length).toBe(drawn);
      expect(draws.at(-1)?.uniforms.intensity).toBeCloseTo(0.6 * STILL_LEVEL);

      const handler = motionListener;
      fixture.destroy();
      expect(removeListener).toHaveBeenCalledWith('change', handler);
      expect(renderer.dispose).toHaveBeenCalledTimes(1);
    });

    it('a scroll strike flashes briefly even inside an idle gap', () => {
      const { fixture } = mount('browser', 3);
      fixture.detectChanges();
      show(true);
      fixture.componentRef.setInput('strike', 1);
      fixture.detectChanges();
      jest.advanceTimersByTime(1);
      fixture.componentRef.setInput('strike', 2);
      fixture.detectChanges();
      const start = performance.now();
      jest.advanceTimersByTime(400);
      const flash = draws.filter((draw) => draw.at >= start);
      expect(flash.length).toBeGreaterThan(0);
      expect(Math.max(...flash.map((draw) => draw.at - start))).toBeLessThan(330);
      fixture.destroy();
    });
  });
});
