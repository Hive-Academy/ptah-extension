/** @jest-environment jsdom */
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { HeroComponent } from './hero.component';

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

function installBrowserMocks(reduced: boolean): { removeListener: jest.Mock } {
  const removeListener = jest.fn();
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: jest.fn((query: string): MediaQueryList => ({
      matches: reduced && query.includes('prefers-reduced-motion: reduce'),
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

function mockMedia(video: HTMLVideoElement): { play: jest.SpyInstance; pause: jest.SpyInstance } {
  let paused = true;
  Object.defineProperty(video, 'paused', { configurable: true, get: () => paused });
  const play = jest.spyOn(video, 'play').mockImplementation(() => {
    paused = false;
    video.dispatchEvent(new Event('play'));
    return Promise.resolve();
  });
  const pause = jest.spyOn(video, 'pause').mockImplementation(() => {
    paused = true;
    video.dispatchEvent(new Event('pause'));
  });
  return { play, pause };
}

describe('HeroComponent', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    TestBed.resetTestingModule();
    ObserverStub.instances = [];
  });

  it('renders final copy, actions and poster-first muted videos on the server', () => {
    const { root, destroy } = mount('server');
    expect(root.querySelector('h1')?.textContent).toContain('Your AI dev team.');
    expect(root.querySelector('h1')?.textContent).toContain('Free and open source.');
    expect(root.querySelector('.title-lead')?.textContent).toContain('MIT-licensed desktop app');
    expect(root.querySelector('.title-footnote')?.textContent).toContain('No account. No license key. No credit card.');
    expect(root.querySelector<HTMLAnchorElement>('.download-link')?.getAttribute('href')).toBe('/download');
    expect(root.querySelectorAll('video')).toHaveLength(4);
    expect(Array.from(root.querySelectorAll('video')).every((video) =>
      video.hasAttribute('poster') && video.hasAttribute('muted') && video.getAttribute('preload') === 'none'
    )).toBe(true);
    expect(root.querySelectorAll('.artifact[alt=""][aria-hidden]')).toHaveLength(0);
    expect(root.querySelectorAll('.artifacts[aria-hidden] img[alt=""]')).toHaveLength(4);
    destroy();
  });

  it('keeps reduced motion static and never autoplays', () => {
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
    destroy();
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

    videos[1].pause(); // Native controls, not the component, initiated this pause.
    document.dispatchEvent(new Event('visibilitychange'));
    ObserverStub.instances[0].emit(root.querySelector('[data-story-stage]')!, 1);
    expect(media[1].play).toHaveBeenCalledTimes(1);
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
    destroy();
    expect(observer.disconnect).toHaveBeenCalledTimes(1);
    expect(removeListener).toHaveBeenCalledWith('change', expect.any(Function));
  });
});
