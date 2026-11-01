/** @jest-environment jsdom */
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { LiveDemoSectionComponent } from './live-demo-section.component';
import type { ReplayState } from '../../live-demo/runtime/types';

const replayState = (scenario = 'orchestration'): ReplayState => ({
  scenario,
  ready: true,
  waitingForSend: false,
  booted: true,
  paused: false,
  readyAt: 1,
  playing: true,
  complete: false,
  elapsed: 500,
  duration: 1000,
  speed: 1,
});

describe('LiveDemoSectionComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('renders a poster and no iframe on the server', () => {
    TestBed.configureTestingModule({
      imports: [LiveDemoSectionComponent],
      providers: [{ provide: PLATFORM_ID, useValue: 'server' }],
    });
    const fixture = TestBed.createComponent(LiveDemoSectionComponent);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('img')?.getAttribute('src')).toBe('/assets/live-demo/orchestration.jpg');
    expect(root.querySelector('img')?.getAttribute('width')).toBe('1440');
    expect(root.querySelector('iframe')).toBeNull();
    expect(root.querySelector('video')).toBeNull();
    fixture.destroy();
  });

  it('supports roving tab focus and keyboard selection', () => {
    TestBed.configureTestingModule({ imports: [LiveDemoSectionComponent] });
    const fixture = TestBed.createComponent(LiveDemoSectionComponent);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const tabs = Array.from(root.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    expect(tabs.map((tab) => tab.querySelector('[data-tab-label]')?.textContent?.trim())).toEqual([
      'Orchestration', 'Tribunal Council', 'Command Center', 'Multi-agent orchestration',
    ]);
    expect(tabs.map((tab) => tab.getAttribute('aria-label'))).toEqual([
      'Orchestration', 'Tribunal Council', 'Command Center', 'Multi-agent orchestration',
    ]);
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1, -1, -1]);
    tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    fixture.detectChanges();
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([-1, 0, -1, -1]);
    expect(document.activeElement).toBe(tabs[1]);
    tabs[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    fixture.detectChanges();
    expect(tabs[3].getAttribute('aria-selected')).toBe('true');
    tabs[3].dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    fixture.detectChanges();
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    fixture.detectChanges();
    expect(tabs[3].getAttribute('aria-selected')).toBe('true');
    tabs[3].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    fixture.detectChanges();
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tabs[0]);
    tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    fixture.detectChanges();
    expect(tabs[3].getAttribute('aria-selected')).toBe('true');
    fixture.destroy();
  });

  it('loads the selected iframe URL and reloads it on tab change', () => {
    TestBed.configureTestingModule({ imports: [LiveDemoSectionComponent] });
    const fixture = TestBed.createComponent(LiveDemoSectionComponent);
    fixture.detectChanges();
    fixture.componentInstance.startDemo();
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const first = root.querySelector('iframe');
    expect(first?.getAttribute('src')).toBe('/demo/?scenario=orchestration');
    fixture.componentInstance.selectTab(2);
    fixture.detectChanges();
    const second = root.querySelector('iframe');
    expect(second?.getAttribute('src')).toBe('/demo/?scenario=command-center');
    expect(second?.getAttribute('title')).toBe('PtahCode live demo replay');
    fixture.destroy();
  });

  it('accepts replay state only from the selected iframe and same origin', async () => {
    TestBed.configureTestingModule({ imports: [LiveDemoSectionComponent] });
    const fixture = TestBed.createComponent(LiveDemoSectionComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.componentInstance.startDemo();
    fixture.detectChanges();
    const frameWindow = (fixture.nativeElement as HTMLElement).querySelector('iframe')?.contentWindow;
    expect(frameWindow).toBeTruthy();
    const send = (origin: string, source: MessageEventSource | null, state: ReplayState) => {
      window.dispatchEvent(new MessageEvent('message', {
        origin,
        source,
        data: { source: 'ptah-replay-state', state },
      }));
      fixture.detectChanges();
    };
    send('https://other.example', frameWindow ?? null, replayState());
    expect(fixture.componentInstance.progress()).toBe(0);
    send(window.location.origin, window, replayState());
    expect(fixture.componentInstance.progress()).toBe(0);
    send(window.location.origin, frameWindow ?? null, replayState('command-center'));
    expect(fixture.componentInstance.progress()).toBe(0);
    send(window.location.origin, frameWindow ?? null, replayState());
    expect(fixture.componentInstance.progress()).toBe(50);
    expect((fixture.nativeElement as HTMLElement).querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('50');
    fixture.destroy();
  });

  it('re-sends pause when the replay plays while the section is not visible', async () => {
    TestBed.configureTestingModule({ imports: [LiveDemoSectionComponent] });
    const fixture = TestBed.createComponent(LiveDemoSectionComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.componentInstance.startDemo();
    fixture.detectChanges();
    const frameWindow = (fixture.nativeElement as HTMLElement).querySelector('iframe')?.contentWindow;
    expect(frameWindow).toBeTruthy();
    const postMessage = jest.spyOn(frameWindow as Window, 'postMessage').mockImplementation(() => undefined);
    window.dispatchEvent(new MessageEvent('message', {
      origin: window.location.origin,
      source: frameWindow ?? null,
      data: { source: 'ptah-replay-state', state: replayState() },
    }));
    expect(postMessage).toHaveBeenCalledWith({ source: 'ptah-replay-control', cmd: 'pause' }, window.location.origin);
    fixture.destroy();
  });

  it('binds the mobile video source on the video element so a tab change reloads it', async () => {
    const width = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 500 });
    try {
      TestBed.configureTestingModule({ imports: [LiveDemoSectionComponent] });
      const fixture = TestBed.createComponent(LiveDemoSectionComponent);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      const root = fixture.nativeElement as HTMLElement;
      expect(root.querySelector('video')?.getAttribute('src')).toBe('/assets/live-demo/orchestration.webm');
      expect(root.textContent).not.toContain('Click Send in the demo to start');
      fixture.componentInstance.selectTab(1);
      fixture.detectChanges();
      expect(root.querySelector('video')?.getAttribute('src')).toBe('/assets/live-demo/tribunal-council.webm');
      expect(root.querySelector('iframe')).toBeNull();
      fixture.destroy();
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
    }
  });

  it('autostarts only after the page has loaded and gone idle, never before', async () => {
    let notify: ((entries: Array<{ isIntersecting: boolean }>) => void) | undefined;
    const original = (window as { IntersectionObserver?: unknown }).IntersectionObserver;
    (window as { IntersectionObserver?: unknown }).IntersectionObserver = class {
      constructor(cb: (entries: Array<{ isIntersecting: boolean }>) => void) {
        notify = cb;
      }
      observe(): void {}
      disconnect(): void {}
    };
    try {
      TestBed.configureTestingModule({ imports: [LiveDemoSectionComponent] });
      const fixture = TestBed.createComponent(LiveDemoSectionComponent);
      fixture.detectChanges();
      await fixture.whenStable();
      notify?.([{ isIntersecting: true }]);
      expect(fixture.componentInstance.active()).toBe(false);
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(fixture.componentInstance.active()).toBe(true);
      fixture.destroy();
    } finally {
      (window as { IntersectionObserver?: unknown }).IntersectionObserver = original;
    }
  });

  describe('stage layout', () => {
    it('renders a vertical playlist before the window with the selected scenario details inside it', () => {
      TestBed.configureTestingModule({ imports: [LiveDemoSectionComponent] });
      const fixture = TestBed.createComponent(LiveDemoSectionComponent);
      fixture.detectChanges();
      const root = fixture.nativeElement as HTMLElement;
      expect(root.querySelector('#ptah-live-demo-heading')?.classList).toContain('sr-only');
      expect(root.querySelector('#ptah-live-demo-heading')?.textContent?.trim()).toBe('See PtahCode work');
      const panel = root.querySelector('[role="tabpanel"]') as HTMLElement;
      const tablist = root.querySelector('[role="tablist"]') as HTMLElement;
      expect(tablist.getAttribute('aria-orientation')).toBe('vertical');
      expect(tablist.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(tablist.parentElement?.className).toContain('max-w-[1680px]');
      expect(tablist.parentElement?.className).toContain('lg:grid-cols-[264px_minmax(0,1fr)]');
      const tabs = Array.from(root.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
      expect(tabs[0].getAttribute('aria-describedby')).toBe('ptah-live-demo-desc-orchestration');
      expect(tabs[0].textContent).toContain('01');
      expect(tabs[0].textContent).toContain('Watch a real PtahCode session coordinate work from a single prompt.');
      expect(tabs[1].getAttribute('aria-describedby')).toBeNull();
      expect(tabs[1].textContent).not.toContain('bring several perspectives');
      expect(root.querySelector('a[href="/download"]')).toBeNull();
      expect(root.textContent).not.toContain('Download PtahCode');
      fixture.componentInstance.selectTab(1);
      fixture.detectChanges();
      expect(tabs[1].textContent).toContain('See PtahCode bring several perspectives into one decision.');
      expect(tabs[0].getAttribute('aria-describedby')).toBeNull();
      fixture.destroy();
    });

    it('shows replay progress on the selected playlist item once the demo runs', async () => {
      TestBed.configureTestingModule({ imports: [LiveDemoSectionComponent] });
      const fixture = TestBed.createComponent(LiveDemoSectionComponent);
      fixture.detectChanges();
      await fixture.whenStable();
      const root = fixture.nativeElement as HTMLElement;
      const selectedTab = () => root.querySelector('[role="tab"][aria-selected="true"]') as HTMLElement;
      expect(selectedTab().querySelector('span[aria-hidden="true"] > span')).toBeNull();
      fixture.componentInstance.startDemo();
      fixture.componentInstance.state.set(replayState());
      fixture.detectChanges();
      const bar = selectedTab().querySelector<HTMLElement>('span.h-1 > span');
      expect(bar?.style.width).toBe('50%');
      fixture.destroy();
    });

    it('renders the switched-on screen statically: the power-on veil is invisible, hidden and inert', () => {
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
      expect(root.querySelector('[data-power-line]')?.classList).toContain('opacity-0');
      const panel = root.querySelector('[role="tabpanel"]') as HTMLElement;
      expect(panel.getAttribute('style') ?? '').not.toContain('rotate');
      fixture.destroy();
    });
  });
});
