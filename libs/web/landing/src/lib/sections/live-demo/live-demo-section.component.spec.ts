/** @jest-environment jsdom */
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { LiveDemoSectionComponent } from './live-demo-section.component';

type IntersectionCallback = (
  entries: Array<{ isIntersecting: boolean }>,
) => void;

function mockMotionPreference(reduced: boolean): typeof window.matchMedia {
  return jest.fn().mockImplementation((query: string) => ({
    matches: reduced && query === '(prefers-reduced-motion: reduce)',
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })) as unknown as typeof window.matchMedia;
}

describe('LiveDemoSectionComponent', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  it('renders the selected clip with its poster and native controls on the server', () => {
    TestBed.configureTestingModule({
      imports: [LiveDemoSectionComponent],
      providers: [{ provide: PLATFORM_ID, useValue: 'server' }],
    });
    const fixture = TestBed.createComponent(LiveDemoSectionComponent);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const video = root.querySelector('video');
    expect(video?.getAttribute('src')).toBe(
      '/assets/live-demo/orchestration.webm',
    );
    expect(video?.getAttribute('poster')).toBe(
      '/assets/live-demo/orchestration.jpg',
    );
    expect(video?.controls).toBe(true);
    expect(video?.muted).toBe(true);
    expect(video?.playsInline).toBe(true);
    expect(video?.preload).toBe('none');
    expect(video?.hasAttribute('autoplay')).toBe(false);
    expect(root.querySelector('iframe')).toBeNull();
    fixture.destroy();
  });

  it('supports roving tab focus and keyboard selection', () => {
    TestBed.configureTestingModule({ imports: [LiveDemoSectionComponent] });
    const fixture = TestBed.createComponent(LiveDemoSectionComponent);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const tabs = Array.from(
      root.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    );
    expect(
      tabs.map((tab) => tab.querySelector('[data-tab-label]')?.textContent?.trim()),
    ).toEqual([
      'Orchestration',
      'Tribunal Council',
      'Command Center',
      'Multi-agent orchestration',
    ]);
    expect(tabs.map((tab) => tab.getAttribute('aria-label'))).toEqual([
      'Orchestration',
      'Tribunal Council',
      'Command Center',
      'Multi-agent orchestration',
    ]);
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1, -1, -1]);
    tabs[0].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
    );
    fixture.detectChanges();
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([-1, 0, -1, -1]);
    expect(document.activeElement).toBe(tabs[1]);
    tabs[1].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'End', bubbles: true }),
    );
    fixture.detectChanges();
    expect(tabs[3].getAttribute('aria-selected')).toBe('true');
    tabs[3].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Home', bubbles: true }),
    );
    fixture.detectChanges();
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    tabs[0].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }),
    );
    fixture.detectChanges();
    expect(tabs[3].getAttribute('aria-selected')).toBe('true');
    tabs[3].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
    );
    fixture.detectChanges();
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tabs[0]);
    tabs[0].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }),
    );
    fixture.detectChanges();
    expect(tabs[3].getAttribute('aria-selected')).toBe('true');
    fixture.destroy();
  });

  it('pauses the current clip and changes the source and poster on tab selection', () => {
    const pause = jest
      .spyOn(HTMLMediaElement.prototype, 'pause')
      .mockImplementation(() => undefined);
    TestBed.configureTestingModule({ imports: [LiveDemoSectionComponent] });
    const fixture = TestBed.createComponent(LiveDemoSectionComponent);
    fixture.detectChanges();
    fixture.componentInstance.selectTab(2);
    fixture.detectChanges();
    const video = (fixture.nativeElement as HTMLElement).querySelector('video');
    expect(pause).toHaveBeenCalled();
    expect(video?.getAttribute('src')).toBe(
      '/assets/live-demo/command-center.webm',
    );
    expect(video?.getAttribute('poster')).toBe(
      '/assets/live-demo/command-center.jpg',
    );
    expect(video?.getAttribute('aria-label')).toBe(
      'PtahCode Command Center session clip',
    );
    expect(fixture.componentInstance.progress()).toBe(0);
    fixture.destroy();
  });

  it('starts a muted clip only after the visible page becomes idle', async () => {
    const originalObserver = window.IntersectionObserver;
    const originalMatchMedia = window.matchMedia;
    const width = window.innerWidth;
    let notify: IntersectionCallback | undefined;
    window.IntersectionObserver = class {
      constructor(callback: IntersectionCallback) {
        notify = callback;
      }
      observe(): void {}
      disconnect(): void {}
    } as unknown as typeof IntersectionObserver;
    window.matchMedia = mockMotionPreference(false);
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 1280,
    });
    const play = jest
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockImplementation(() => Promise.resolve());
    jest.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    try {
      TestBed.configureTestingModule({ imports: [LiveDemoSectionComponent] });
      const fixture = TestBed.createComponent(LiveDemoSectionComponent);
      fixture.detectChanges();
      await fixture.whenStable();
      notify?.([{ isIntersecting: true }]);
      expect(play).not.toHaveBeenCalled();
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(play).toHaveBeenCalledTimes(1);
      fixture.destroy();
    } finally {
      window.IntersectionObserver = originalObserver;
      window.matchMedia = originalMatchMedia;
      Object.defineProperty(window, 'innerWidth', {
        configurable: true,
        value: width,
      });
    }
  });

  it('never starts playback automatically under reduced motion', async () => {
    const originalObserver = window.IntersectionObserver;
    const originalMatchMedia = window.matchMedia;
    const width = window.innerWidth;
    let notify: IntersectionCallback | undefined;
    window.IntersectionObserver = class {
      constructor(callback: IntersectionCallback) {
        notify = callback;
      }
      observe(): void {}
      disconnect(): void {}
    } as unknown as typeof IntersectionObserver;
    window.matchMedia = mockMotionPreference(true);
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 1280,
    });
    const play = jest
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockImplementation(() => Promise.resolve());
    jest.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    try {
      TestBed.configureTestingModule({ imports: [LiveDemoSectionComponent] });
      const fixture = TestBed.createComponent(LiveDemoSectionComponent);
      fixture.detectChanges();
      await fixture.whenStable();
      notify?.([{ isIntersecting: true }]);
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(play).not.toHaveBeenCalled();
      const video = (fixture.nativeElement as HTMLElement).querySelector('video');
      expect(video?.hasAttribute('autoplay')).toBe(false);
      expect(video?.controls).toBe(true);
      fixture.destroy();
    } finally {
      window.IntersectionObserver = originalObserver;
      window.matchMedia = originalMatchMedia;
      Object.defineProperty(window, 'innerWidth', {
        configurable: true,
        value: width,
      });
    }
  });

  it('updates the selected scenario progress from the video timeline', () => {
    TestBed.configureTestingModule({ imports: [LiveDemoSectionComponent] });
    const fixture = TestBed.createComponent(LiveDemoSectionComponent);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const video = root.querySelector('video') as HTMLVideoElement;
    Object.defineProperty(video, 'duration', {
      configurable: true,
      value: 1000,
    });
    Object.defineProperty(video, 'currentTime', {
      configurable: true,
      value: 500,
    });
    video.dispatchEvent(new Event('timeupdate'));
    fixture.detectChanges();
    expect(fixture.componentInstance.progress()).toBe(50);
    const bar = root.querySelector<HTMLElement>(
      '[role="tab"][aria-selected="true"] span.h-1 > span',
    );
    expect(bar?.style.width).toBe('50%');
    fixture.destroy();
  });

  describe('stage layout', () => {
    it('renders a vertical playlist before the window with selected scenario details', () => {
      TestBed.configureTestingModule({ imports: [LiveDemoSectionComponent] });
      const fixture = TestBed.createComponent(LiveDemoSectionComponent);
      fixture.detectChanges();
      const root = fixture.nativeElement as HTMLElement;
      expect(root.querySelector('#ptah-live-demo-heading')?.classList).toContain(
        'sr-only',
      );
      expect(
        root.querySelector('#ptah-live-demo-heading')?.textContent?.trim(),
      ).toBe('See PtahCode work');
      const panel = root.querySelector('[role="tabpanel"]') as HTMLElement;
      const tablist = root.querySelector('[role="tablist"]') as HTMLElement;
      expect(tablist.getAttribute('aria-orientation')).toBe('vertical');
      expect(
        tablist.compareDocumentPosition(panel) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(tablist.parentElement?.className).toContain('max-w-[1680px]');
      expect(tablist.parentElement?.className).toContain(
        'lg:grid-cols-[264px_minmax(0,1fr)]',
      );
      const tabs = Array.from(
        root.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
      );
      expect(tabs[0].getAttribute('aria-describedby')).toBe(
        'ptah-live-demo-desc-orchestration',
      );
      expect(tabs[0].textContent).toContain('01');
      expect(tabs[0].textContent).toContain(
        'Watch a real PtahCode session coordinate work from a single prompt.',
      );
      expect(tabs[1].getAttribute('aria-describedby')).toBeNull();
      expect(tabs[1].textContent).not.toContain('bring several perspectives');
      expect(root.querySelector('a[href="/download"]')).toBeNull();
      expect(root.textContent).not.toContain('Click Send in the demo to start');
      fixture.componentInstance.selectTab(1);
      fixture.detectChanges();
      expect(tabs[1].textContent).toContain(
        'See PtahCode bring several perspectives into one decision.',
      );
      expect(tabs[0].getAttribute('aria-describedby')).toBeNull();
      fixture.destroy();
    });

    it('renders the switched-on screen statically with an inert power-on veil', () => {
      TestBed.configureTestingModule({
        imports: [LiveDemoSectionComponent],
        providers: [{ provide: PLATFORM_ID, useValue: 'server' }],
      });
      const fixture = TestBed.createComponent(LiveDemoSectionComponent);
      fixture.detectChanges();
      const root = fixture.nativeElement as HTMLElement;
      const veil = root.querySelector('[data-power-screen]') as HTMLElement;
      expect(veil.getAttribute('aria-hidden')).toBe('true');
      expect(veil.classList).toContain('pointer-events-none');
      expect(veil.classList).toContain('opacity-0');
      expect(root.querySelector('[data-power-line]')?.classList).toContain(
        'opacity-0',
      );
      const panel = root.querySelector('[role="tabpanel"]') as HTMLElement;
      expect(panel.getAttribute('style') ?? '').not.toContain('rotate');
      fixture.destroy();
    });
  });
});
