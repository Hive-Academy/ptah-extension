import { TestBed } from '@angular/core/testing';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AuroraEffectComponent } from './aurora-effect.component';

describe('AuroraEffectComponent', () => {
  let motion: MediaQueryList;
  let motionChange: (() => void) | undefined;
  let intersection: IntersectionObserverCallback | undefined;
  const disconnect = jest.fn();
  const observe = jest.fn();
  const originalMatchMedia = window.matchMedia;
  const originalObserver = globalThis.IntersectionObserver;

  beforeEach(() => {
    motionChange = undefined;
    intersection = undefined;
    disconnect.mockClear();
    observe.mockClear();
    motion = {
      matches: false,
      media: '(prefers-reduced-motion: reduce)',
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn((_type, listener) => {
        if (typeof listener === 'function') motionChange = () => listener(new Event('change'));
      }),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    };
    window.matchMedia = jest.fn(() => motion);
    globalThis.IntersectionObserver = class implements IntersectionObserver {
      readonly root = null;
      readonly rootMargin = '0px';
      readonly thresholds = [0];
      constructor(callback: IntersectionObserverCallback) { intersection = callback; }
      observe = observe;
      unobserve = jest.fn();
      disconnect = disconnect;
      takeRecords = jest.fn(() => []);
    };
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    globalThis.IntersectionObserver = originalObserver;
  });

  it('uses theme-derived CSS, a static reduced-motion gradient and compositor animation', () => {
    const css = readFileSync(join(__dirname, 'aurora-effect.component.ts'), 'utf8');
    expect(css).toContain('color-mix(in oklch');
    expect(css).toContain('var(--s)');
    expect(css).toContain('var(--b1)');
    expect(css).toContain('prefers-reduced-motion: reduce');
    expect(css).toContain('animation: none');
    expect(css).toContain('transform: translateX');
    expect(css).toContain('inset: 0 -25%');
    expect(css).toContain(':host(.brand) { height: 100%; z-index: -1; }');
  });

  it('is decorative and pauses for visibility, intersection and live reduced motion', async () => {
    await TestBed.configureTestingModule({ imports: [AuroraEffectComponent] }).compileComponents();
    const fixture = TestBed.createComponent(AuroraEffectComponent);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.getAttribute('aria-hidden')).toBe('true');
    expect(observe).toHaveBeenCalledWith(element);
    expect(element.classList.contains('paused')).toBe(false);

    fixture.componentRef.setInput('visible', false);
    fixture.detectChanges();
    expect(element.classList.contains('paused')).toBe(true);
    fixture.componentRef.setInput('visible', true);
    intersection?.([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver);
    fixture.detectChanges();
    expect(element.classList.contains('paused')).toBe(true);
    intersection?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);

    Object.defineProperty(motion, 'matches', { value: true, configurable: true });
    motionChange?.();
    fixture.detectChanges();
    expect(element.classList.contains('paused')).toBe(true);
    Object.defineProperty(motion, 'matches', { value: false, configurable: true });
    motionChange?.();
    fixture.detectChanges();
    expect(element.classList.contains('paused')).toBe(false);

    const hiddenDescriptor = Object.getOwnPropertyDescriptor(document, 'hidden');
    try {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
      fixture.detectChanges();
      expect(element.classList.contains('paused')).toBe(true);
    } finally {
      if (hiddenDescriptor) Object.defineProperty(document, 'hidden', hiddenDescriptor);
      else Reflect.deleteProperty(document, 'hidden');
      document.dispatchEvent(new Event('visibilitychange'));
    }

    fixture.componentRef.setInput('variant', 'brand');
    fixture.detectChanges();
    expect(element.classList.contains('brand')).toBe(true);
    fixture.destroy();
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(motion.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });
});
