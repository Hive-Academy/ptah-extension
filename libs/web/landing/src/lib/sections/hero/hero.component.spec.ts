/** @jest-environment jsdom */
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import gsap from 'gsap';
import { HeroComponent } from './hero.component';
import { HeroLightning } from './hero-lightning';

type ScrollUpdate = (self: { progress: number }) => void;

class ObserverStub implements IntersectionObserver {
  public static instances: ObserverStub[] = [];
  public readonly root = null;
  public readonly rootMargin = '0px';
  public readonly scrollMargin = '0px';
  public readonly thresholds = [0];
  public readonly observe = jest.fn();
  public readonly unobserve = jest.fn();
  public readonly disconnect = jest.fn();

  public constructor(private readonly callback: IntersectionObserverCallback) {
    ObserverStub.instances.push(this);
  }

  public takeRecords(): IntersectionObserverEntry[] { return []; }

  public emit(target: Element, ratio: number): void {
    this.callback([{
      target,
      isIntersecting: ratio > 0,
      intersectionRatio: ratio,
    } as IntersectionObserverEntry], this);
  }
}

function installBrowserMocks(reduced: boolean, desktop = false): { removeListener: jest.Mock } {
  const removeListener = jest.fn();
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: jest.fn((query: string): MediaQueryList => ({
      matches: (reduced && query.includes('prefers-reduced-motion: reduce')) ||
        (desktop && query.includes('min-width: 768px')),
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: removeListener,
      dispatchEvent: jest.fn(),
    })),
  });
  Object.defineProperty(window, 'IntersectionObserver', { configurable: true, value: ObserverStub });
  return { removeListener };
}

function mount(platform: 'server' | 'browser'): {
  component: HeroComponent;
  root: HTMLElement;
  destroy: () => void;
} {
  TestBed.configureTestingModule({
    imports: [HeroComponent],
    providers: [provideRouter([]), { provide: PLATFORM_ID, useValue: platform }],
  });
  const fixture = TestBed.createComponent(HeroComponent);
  fixture.detectChanges();
  return {
    component: fixture.componentInstance,
    root: fixture.nativeElement as HTMLElement,
    destroy: () => fixture.destroy(),
  };
}

describe('HeroComponent', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    TestBed.resetTestingModule();
    ObserverStub.instances = [];
  });

  it('renders the headline, CTAs and both lightning layers on the server', () => {
    const start = jest.spyOn(HeroLightning.prototype, 'start');
    const { root, destroy } = mount('server');
    expect(root.querySelector('.title-index')?.textContent?.trim()).toBe('PTAHCODE / YOUR AI DEV TEAM');
    expect(root.querySelector('h1')?.textContent?.trim()).toBe('Free and open source.');
    expect(root.querySelector('.title-lead')?.textContent).toContain('MIT-licensed desktop app');
    expect(root.querySelector('.title-footnote')?.textContent?.trim()).toBe('No account, no license key, no credit card');
    expect(root.querySelector<HTMLAnchorElement>('.download-link')?.getAttribute('href')).toBe('/download');
    expect(root.querySelector<HTMLAnchorElement>('.watch-link')?.getAttribute('href')).toBe('#command-center');
    expect(root.querySelectorAll('.artifacts[aria-hidden] img[alt=""]')).toHaveLength(4);
    expect(root.querySelector('.artifacts canvas[data-lightning][aria-hidden="true"]')).not.toBeNull();
    expect(root.querySelector('[data-story-stage] > ptah-lightning.hero-bolt')).not.toBeNull();
    expect(start).not.toHaveBeenCalled();
    destroy();
  });

  it('renders no video player, clip list or chapter ledger', () => {
    const { root, destroy } = mount('server');
    expect(root.querySelector('video')).toBeNull();
    expect(root.querySelector('[data-story-scene], [data-scene-track], .chapter-rail, .playback-button, .story-outro')).toBeNull();
    expect(root.querySelector('#live-demo')).toBeNull();
    expect(root.textContent).not.toContain('04 / 04');
    expect(root.textContent).not.toContain('Built to ship.');
    destroy();
  });

  it('keeps reduced motion static: no GSAP motion and no arcs', () => {
    const matchMedia = jest.spyOn(gsap, 'matchMedia');
    const start = jest.spyOn(HeroLightning.prototype, 'start');
    installBrowserMocks(true, true);
    const { component, root, destroy } = mount('browser');
    ObserverStub.instances[0].emit(root.querySelector('[data-story-stage]')!, 1);
    expect(matchMedia).not.toHaveBeenCalled();
    expect(root.classList.contains('is-cinematic')).toBe(false);
    expect(component['lightning']).toBeUndefined();
    expect(start).not.toHaveBeenCalled();
    destroy();
  });

  it('pins the title for its fade and runs the arcs only while the copy is visible', () => {
    jest.useFakeTimers();
    installBrowserMocks(false, true);
    const media = gsap.matchMedia();
    const cleanups: Array<() => void> = [];
    const context = gsap.context(() => undefined);
    jest.spyOn(media, 'add').mockImplementation((_query, callback) => {
      const result = callback(context);
      if (typeof result === 'function') cleanups.push(() => result());
      return media;
    });
    jest.spyOn(media, 'revert').mockImplementation(() => cleanups.splice(0).forEach((cleanup) => cleanup()));
    jest.spyOn(gsap, 'matchMedia').mockReturnValue(media);
    const timelineVars: gsap.TimelineVars[] = [];
    const realTimeline = gsap.timeline.bind(gsap);
    jest.spyOn(gsap, 'timeline').mockImplementation((vars?: gsap.TimelineVars) => {
      timelineVars.push(vars ?? {});
      return realTimeline({ paused: true });
    });
    jest.spyOn(gsap, 'to').mockReturnValue(gsap.to({}, { paused: true }));
    const start = jest.spyOn(HeroLightning.prototype, 'start');
    const stop = jest.spyOn(HeroLightning.prototype, 'stop');
    const destroyLightning = jest.spyOn(HeroLightning.prototype, 'destroy');
    const hiddenDescriptor = Object.getOwnPropertyDescriptor(document, 'hidden');
    const getContextDescriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'getContext');
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: jest.fn(() => Object.assign({} as CanvasRenderingContext2D, {
        setTransform: jest.fn(), clearRect: jest.fn(),
      })),
    });
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    try {
      const { component, root, destroy } = mount('browser');
      expect(root.classList.contains('is-cinematic')).toBe(true);
      expect(component['lightning']).toBeInstanceOf(HeroLightning);
      expect(start).not.toHaveBeenCalled();

      ObserverStub.instances[0].emit(root.querySelector('[data-story-stage]')!, 1);
      expect(start).toHaveBeenCalledTimes(1);

      const scrollTrigger = timelineVars.find((vars) => vars.scrollTrigger)?.scrollTrigger as ScrollTrigger.Vars;
      expect(scrollTrigger).toMatchObject({ start: 'top top', pin: true, scrub: 1 });
      expect(scrollTrigger.snap).toBeUndefined();
      const onUpdate = scrollTrigger.onUpdate as unknown as ScrollUpdate;
      const content = root.querySelector('[data-title-content]')!;

      const stopsBeforeFade = stop.mock.calls.length;
      onUpdate({ progress: 1 });
      expect(stop.mock.calls.length).toBeGreaterThan(stopsBeforeFade);
      expect(component['lightning']?.['timeout']).toBeUndefined();
      expect(root.classList.contains('is-in-story')).toBe(true);
      expect(content.hasAttribute('inert')).toBe(true);

      onUpdate({ progress: 0.1 });
      expect(start).toHaveBeenCalledTimes(2);
      expect(root.classList.contains('is-in-story')).toBe(false);
      expect(content.hasAttribute('inert')).toBe(false);

      const stopsBeforeHidden = stop.mock.calls.length;
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
      expect(stop.mock.calls.length).toBeGreaterThan(stopsBeforeHidden);

      destroy();
      expect(destroyLightning).toHaveBeenCalled();
      expect(component['lightning']).toBeUndefined();
      expect(root.classList.contains('is-cinematic')).toBe(false);
    } finally {
      if (getContextDescriptor) Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', getContextDescriptor);
      if (hiddenDescriptor) Object.defineProperty(document, 'hidden', hiddenDescriptor);
      else Reflect.deleteProperty(document, 'hidden');
      jest.useRealTimers();
    }
  });

  it('disconnects observation and removes listeners on destroy', () => {
    const { removeListener } = installBrowserMocks(true);
    const removeDocListener = jest.spyOn(document, 'removeEventListener');
    const { destroy } = mount('browser');
    const observer = ObserverStub.instances[0];
    destroy();
    expect(observer.disconnect).toHaveBeenCalledTimes(1);
    expect(removeListener).toHaveBeenCalledWith('change', expect.any(Function));
    expect(removeDocListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  });
});
