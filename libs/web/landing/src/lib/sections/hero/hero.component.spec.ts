/** @jest-environment jsdom */
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import gsap from 'gsap';
import { HeroComponent } from './hero.component';
import { HeroLightning } from './hero-lightning';

class ObserverStub implements IntersectionObserver {
  static instances: ObserverStub[] = [];
  readonly root = null;
  readonly rootMargin = '0px';
  readonly scrollMargin = '0px';
  readonly thresholds = [0];
  readonly observe = jest.fn();
  readonly unobserve = jest.fn();
  readonly disconnect = jest.fn();

  constructor(private readonly callback: IntersectionObserverCallback) {
    ObserverStub.instances.push(this);
  }

  takeRecords(): IntersectionObserverEntry[] { return []; }

  emit(target: Element, ratio: number): void {
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
  detectChanges: () => void;
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
    detectChanges: () => fixture.detectChanges(),
    destroy: () => fixture.destroy(),
  };
}

function mockMedia(video: HTMLVideoElement): { play: jest.SpyInstance; pause: jest.SpyInstance; setReady: (ready: boolean) => void } {
  let paused = true;
  let readyState: number = HTMLMediaElement.HAVE_FUTURE_DATA;
  Object.defineProperty(video, 'paused', { configurable: true, get: () => paused });
  Object.defineProperty(video, 'readyState', { configurable: true, get: () => readyState });
  const play = jest.spyOn(video, 'play').mockImplementation(() => {
    paused = false;
    video.dispatchEvent(new Event('play'));
    return Promise.resolve();
  });
  const pause = jest.spyOn(video, 'pause').mockImplementation(() => {
    paused = true;
    video.dispatchEvent(new Event('pause'));
  });
  return { play, pause, setReady: (ready) => { readyState = ready ? HTMLMediaElement.HAVE_FUTURE_DATA : HTMLMediaElement.HAVE_NOTHING; } };
}

describe('HeroComponent', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    TestBed.resetTestingModule();
    ObserverStub.instances = [];
  });

  it('renders final copy, actions and poster-first muted videos on the server', () => {
    const start = jest.spyOn(HeroLightning.prototype, 'start');
    const { root, destroy } = mount('server');
    expect(root.querySelector('.title-index')?.textContent?.trim()).toBe('PTAHCODE / YOUR AI DEV TEAM');
    expect(root.querySelector('h1')?.textContent?.trim()).toBe('Free and open source.');
    expect(root.querySelector('.title-lead')?.textContent).toContain('MIT-licensed desktop app');
    expect(root.querySelector('.title-footnote')?.textContent?.trim()).toBe('No account, no license key, no credit card');
    expect(root.textContent).not.toContain('Scroll to see the work');
    expect(root.querySelector<HTMLAnchorElement>('.download-link')?.getAttribute('href')).toBe('/download');
    expect(root.querySelectorAll('video')).toHaveLength(4);
    expect(Array.from(root.querySelectorAll('video')).every((video) =>
      video.hasAttribute('poster') && video.hasAttribute('muted') && video.getAttribute('preload') === 'none'
    )).toBe(true);
    const firstSources = Array.from(root.querySelectorAll('video')[0].querySelectorAll('source'));
    expect(firstSources.map((source) => [source.getAttribute('src'), source.getAttribute('type')])).toEqual([
      ['/assets/live-demo/orchestration.mp4', 'video/mp4'],
      ['/assets/live-demo/orchestration.webm', 'video/webm'],
    ]);
    expect(root.querySelectorAll('.artifact[alt=""][aria-hidden]')).toHaveLength(0);
    expect(root.querySelectorAll('.artifacts[aria-hidden] img[alt=""]')).toHaveLength(4);
    expect(root.querySelector('.artifacts canvas[aria-hidden="true"]')).not.toBeNull();
    expect(start).not.toHaveBeenCalled();
    destroy();
  });

  it('keeps reduced motion static and never autoplays', () => {
    const start = jest.spyOn(HeroLightning.prototype, 'start');
    installBrowserMocks(true);
    const { component, root, destroy } = mount('browser');
    component['initialize']();
    const videos = Array.from(root.querySelectorAll('video'));
    const media = videos.map(mockMedia);
    ObserverStub.instances[0].emit(root.querySelector('[data-story-stage]')!, 1);
    component.activeChapter.set(0);
    component['syncPlayback']();
    expect(root.classList.contains('is-cinematic')).toBe(false);
    expect(media.every(({ play }) => play.mock.calls.length === 0)).toBe(true);
    expect(start).not.toHaveBeenCalled();
    destroy();
  });

  it('starts desktop lightning once per run and stops on story, tab, media teardown, and destroy', () => {
    jest.useFakeTimers();
    installBrowserMocks(false, true);
    const media = gsap.matchMedia();
    const intro = gsap.timeline({ paused: true });
    const story = gsap.timeline({ paused: true });
    const secondIntro = gsap.timeline({ paused: true });
    const secondStory = gsap.timeline({ paused: true });
    const float = gsap.to({}, { paused: true });
    let mediaCleanup: (() => void) | undefined;
    let enterMedia: (() => void) | undefined;
    const context = gsap.context(() => undefined);
    jest.spyOn(media, 'add').mockImplementation((_query, callback) => {
      enterMedia = () => {
        const result = callback(context);
        mediaCleanup = typeof result === 'function' ? () => result() : undefined;
      };
      enterMedia();
      return media;
    });
    jest.spyOn(media, 'revert').mockImplementation(() => mediaCleanup?.());
    jest.spyOn(gsap, 'matchMedia').mockReturnValue(media);
    jest.spyOn(gsap, 'timeline').mockReturnValueOnce(intro).mockReturnValueOnce(story)
      .mockReturnValueOnce(secondIntro).mockReturnValueOnce(secondStory);
    jest.spyOn(gsap, 'to').mockReturnValue(float);
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

      const stage = root.querySelector('[data-story-stage]')!;
      ObserverStub.instances[0].emit(stage, 1);
      expect(start).toHaveBeenCalledTimes(1);
      const timerCount = jest.getTimerCount();
      const lightningTimer = component['lightning']?.['timeout'];
      expect(lightningTimer).toBeDefined();
      component['syncLightning']();
      expect(jest.getTimerCount()).toBe(timerCount);
      expect(component['lightning']?.['timeout']).toBe(lightningTimer);

      const stopsBeforeStory = stop.mock.calls.length;
      component['updateChapter'](1 / 6.2);
      expect(root.classList.contains('is-in-story')).toBe(true);
      expect(stop.mock.calls.length).toBeGreaterThan(stopsBeforeStory);
      expect(component['lightning']?.['timeout']).toBeUndefined();

      component['updateChapter'](0);
      const stopsBeforeHidden = stop.mock.calls.length;
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
      expect(stop.mock.calls.length).toBeGreaterThan(stopsBeforeHidden);
      expect(component['lightning']?.['timeout']).toBeUndefined();
      const stopsBeforeMediaTeardown = stop.mock.calls.length;
      media.revert();
      expect(destroyLightning).toHaveBeenCalledTimes(1);
      expect(stop.mock.calls.length).toBeGreaterThan(stopsBeforeMediaTeardown);
      expect(component['lightning']).toBeUndefined();

      Object.defineProperty(document, 'hidden', { configurable: true, value: false });
      enterMedia?.();
      expect(component['lightning']).toBeInstanceOf(HeroLightning);
      const stopsBeforeDestroy = stop.mock.calls.length;
      destroy();
      expect(destroyLightning).toHaveBeenCalledTimes(2);
      expect(stop.mock.calls.length).toBeGreaterThan(stopsBeforeDestroy);
    } finally {
      if (getContextDescriptor) Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', getContextDescriptor);
      if (hiddenDescriptor) Object.defineProperty(document, 'hidden', hiddenDescriptor);
      else Reflect.deleteProperty(document, 'hidden');
      jest.useRealTimers();
    }
  });

  it('plays only the revealed active clip and respects a manual pause', () => {
    installBrowserMocks(true);
    const { component, root, destroy } = mount('browser');
    component['initialize']();
    const videos = Array.from(root.querySelectorAll('video'));
    const media = videos.map(mockMedia);
    component['reducedMotion'] = false;
    component.cinematic.set(true);
    ObserverStub.instances[0].emit(root.querySelector('[data-story-stage]')!, 1);
    component.activeChapter.set(0);
    component['syncPlayback']();
    expect(media[0].play).toHaveBeenCalledTimes(1);
    expect(media[1].play).not.toHaveBeenCalled();

    component.activeChapter.set(1);
    component['syncPlayback']();
    expect(media[0].pause).toHaveBeenCalledTimes(1);
    expect(media[1].play).toHaveBeenCalledTimes(1);

    void videos[0].play(); // An inactive clip cannot run beside the active one.
    expect(videos[0].paused).toBe(true);
    expect(videos[1].paused).toBe(false);

    root.querySelector<HTMLButtonElement>('.playback-button')!.click();
    document.dispatchEvent(new Event('visibilitychange'));
    ObserverStub.instances[0].emit(root.querySelector('[data-story-stage]')!, 1);
    expect(media[1].play).toHaveBeenCalledTimes(1);
    destroy();
  });

  it('uses a custom play button in cinematic mode and waits for canplay', () => {
    installBrowserMocks(true);
    const { component, root, detectChanges, destroy } = mount('browser');
    component['initialize']();
    const videos = Array.from(root.querySelectorAll('video'));
    const media = videos.map(mockMedia);
    media[0].setReady(false);
    component['reducedMotion'] = false;
    component.cinematic.set(true);
    component.activeChapter.set(0);
    ObserverStub.instances[0].emit(root.querySelector('[data-story-stage]')!, 1);
    detectChanges();
    expect(videos.every((video) => !video.hasAttribute('controls'))).toBe(true);
    const button = root.querySelector<HTMLButtonElement>('.playback-button')!;
    expect(button.getAttribute('aria-label')).toBe('Play clip');
    expect(media[0].play).not.toHaveBeenCalled();
    media[0].setReady(true);
    videos[0].dispatchEvent(new Event('canplay'));
    detectChanges();
    expect(media[0].play).toHaveBeenCalledTimes(1);
    expect(button.getAttribute('aria-label')).toBe('Pause clip');
    button.click();
    detectChanges();
    expect(videos[0].paused).toBe(true);
    expect(button.getAttribute('aria-label')).toBe('Play clip');
    button.click();
    expect(media[0].play).toHaveBeenCalledTimes(2);
    destroy();
  });

  it('preloads only the active and next clips near the stage and updates the caption', () => {
    installBrowserMocks(true);
    const { component, root, detectChanges, destroy } = mount('browser');
    component['initialize']();
    const videos = Array.from(root.querySelectorAll('video'));
    component['reducedMotion'] = false;
    component.cinematic.set(true);
    component.activeChapter.set(1);
    detectChanges();
    expect(videos.map((video) => video.getAttribute('preload'))).toEqual(['none', 'none', 'none', 'none']);
    ObserverStub.instances[1].emit(root.querySelector('[data-story-stage]')!, 1);
    detectChanges();
    expect(videos.map((video) => video.getAttribute('preload'))).toEqual(['none', 'auto', 'auto', 'none']);
    expect(root.querySelector('.active-caption')?.textContent).toContain('Models review the work together.');
    expect(root.querySelector('.active-caption')?.getAttribute('aria-live')).toBe('polite');
    component.activeChapter.set(2);
    detectChanges();
    expect(videos.map((video) => video.getAttribute('preload'))).toEqual(['none', 'none', 'auto', 'auto']);
    expect(root.querySelector('.active-caption')?.textContent).toContain('Every session in one view.');
    expect(root.querySelector('.active-caption')?.textContent).not.toContain('Models review the work together.');
    ObserverStub.instances[1].emit(root.querySelector('[data-story-stage]')!, 0);
    detectChanges();
    expect(videos.map((video) => video.getAttribute('preload'))).toEqual(['none', 'none', 'none', 'none']);
    destroy();
  });

  it('removes the faded title CTAs from the tab order once the story starts', () => {
    installBrowserMocks(true);
    const { component, root, destroy } = mount('browser');
    const title = root.querySelector('[data-title-content]')!;
    component['updateChapter'](0.5);
    expect(title.hasAttribute('inert')).toBe(true);
    component['updateChapter'](0);
    expect(title.hasAttribute('inert')).toBe(false);
    destroy();
  });

  it('offers four chapter buttons and marks the snapped chapter as current', () => {
    installBrowserMocks(true);
    const { component, root, detectChanges, destroy } = mount('browser');
    const buttons = root.querySelectorAll<HTMLButtonElement>('.chapter-button');
    expect(buttons).toHaveLength(4);
    component.cinematic.set(true);
    component['updateChapter'](component.chapterStops[2]);
    detectChanges();
    expect(buttons[2].getAttribute('aria-current')).toBe('step');
    expect(Array.from(buttons).filter((button) => button.hasAttribute('aria-current'))).toHaveLength(1);
    destroy();
  });

  it('scrolls chapter buttons to their exact snap points', () => {
    installBrowserMocks(false);
    const { component, root, destroy } = mount('browser');
    const scrollTo = jest.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    component.cinematic.set(true);
    Object.defineProperty(component, 'storyTrigger', { configurable: true, value: { start: 100, end: 6300, kill: jest.fn() } });
    root.querySelectorAll<HTMLButtonElement>('.chapter-button')[1].click();
    expect(scrollTo).toHaveBeenCalledWith({ top: expect.closeTo(2400, 5), behavior: 'smooth' });
    destroy();
  });

  it('changes chapters at the midpoint between snap stops', () => {
    installBrowserMocks(true);
    const { component, destroy } = mount('browser');
    const cases: Array<[number, number]> = [
      [0.94 / 6.2, -1], [1 / 6.2, 0],
      [1.64 / 6.2, 0], [1.66 / 6.2, 1],
      [2.94 / 6.2, 1], [2.96 / 6.2, 2],
      [4.24 / 6.2, 2], [4.26 / 6.2, 3],
    ];
    for (const [progress, chapter] of cases) {
      component['updateChapter'](progress);
      expect(component.activeChapter()).toBe(chapter);
    }
    destroy();
  });

  it('sends "Watch it work" to the first clip in the natural layout', () => {
    installBrowserMocks(true);
    const { component, root, destroy } = mount('browser');
    const firstScene = root.querySelector<HTMLElement>('[data-story-scene]')!;
    const scrollIntoView = jest.fn();
    firstScene.scrollIntoView = scrollIntoView;
    const event = new MouseEvent('click', { cancelable: true });
    component.watchStory(event);
    expect(event.defaultPrevented).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: 'start' }));
    destroy();
  });

  it('disconnects observation and removes the motion listener on destroy', () => {
    const { removeListener } = installBrowserMocks(true);
    const { component, destroy } = mount('browser');
    component['initialize']();
    const observer = ObserverStub.instances[0];
    const preloadObserver = ObserverStub.instances[1];
    destroy();
    expect(observer.disconnect).toHaveBeenCalledTimes(1);
    expect(preloadObserver.disconnect).toHaveBeenCalledTimes(1);
    expect(removeListener).toHaveBeenCalledWith('change', expect.any(Function));
  });
});
