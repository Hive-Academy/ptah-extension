/** @jest-environment jsdom */
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { LiveDemoSectionComponent } from './live-demo-section.component';
import type { ReplayState } from '../../live-demo/runtime/types';
import { parseLiveDemoVariant } from './live-demo-variant';

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
    expect(tabs.map((tab) => tab.textContent?.trim())).toEqual([
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

  describe('layout variations', () => {
    it('maps ?demo=a|b|c to a variation and falls back to stage', () => {
      expect(parseLiveDemoVariant('')).toBe('stage');
      expect(parseLiveDemoVariant('?demo=a')).toBe('stage');
      expect(parseLiveDemoVariant('?demo=b')).toBe('split');
      expect(parseLiveDemoVariant('?demo=C')).toBe('theater');
      expect(parseLiveDemoVariant('?demo=z&x=1')).toBe('stage');
      expect(parseLiveDemoVariant('?other=b')).toBe('stage');
    });

    it('renders the stage variation by default with a screen-reader heading and tabs under the window', () => {
      TestBed.configureTestingModule({ imports: [LiveDemoSectionComponent] });
      const fixture = TestBed.createComponent(LiveDemoSectionComponent);
      fixture.detectChanges();
      const root = fixture.nativeElement as HTMLElement;
      expect(fixture.componentInstance.variant()).toBe('stage');
      expect(fixture.componentInstance.layout().tilt).toBe(true);
      expect(root.querySelector('#ptah-live-demo-heading')?.classList).toContain('sr-only');
      const panel = root.querySelector('[role="tabpanel"]') as HTMLElement;
      const tablist = root.querySelector('[role="tablist"]') as HTMLElement;
      expect(panel.compareDocumentPosition(tablist) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(panel.parentElement?.className).toContain('max-w-[1280px]');
      fixture.destroy();
    });

    it('switches to the theater variation with a visible heading and chapter rails', () => {
      TestBed.configureTestingModule({ imports: [LiveDemoSectionComponent] });
      const fixture = TestBed.createComponent(LiveDemoSectionComponent);
      fixture.componentRef.setInput('variant', 'theater');
      fixture.detectChanges();
      const root = fixture.nativeElement as HTMLElement;
      expect(root.querySelector('#ptah-live-demo-heading')?.classList).not.toContain('sr-only');
      expect(root.textContent).toContain('Explore PtahCode sessions at your own pace.');
      const tabs = Array.from(root.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
      expect(tabs.every((tab) => tab.querySelector('span[aria-hidden="true"]'))).toBe(true);
      expect(tabs.map((tab) => tab.textContent?.trim())).toEqual([
        'Orchestration', 'Tribunal Council', 'Command Center', 'Multi-agent orchestration',
      ]);
      expect(root.querySelector('[role="tabpanel"] .lg\\:aspect-video')).toBeTruthy();
      fixture.destroy();
    });

    it('keeps one replay iframe when the variation changes', () => {
      TestBed.configureTestingModule({ imports: [LiveDemoSectionComponent] });
      const fixture = TestBed.createComponent(LiveDemoSectionComponent);
      fixture.detectChanges();
      fixture.componentInstance.startDemo();
      fixture.detectChanges();
      const root = fixture.nativeElement as HTMLElement;
      const before = root.querySelector('iframe');
      for (const variant of ['split', 'theater', 'stage'] as const) {
        fixture.componentRef.setInput('variant', variant);
        fixture.detectChanges();
        expect(root.querySelectorAll('iframe')).toHaveLength(1);
        expect(root.querySelectorAll('[role="tabpanel"]')).toHaveLength(1);
      }
      expect(root.querySelector('iframe')).toBe(before);
      expect(fixture.componentInstance.layout().tilt).toBe(true);
      fixture.componentRef.setInput('variant', 'split');
      expect(fixture.componentInstance.layout().tilt).toBe(false);
      fixture.destroy();
    });
  });
});
