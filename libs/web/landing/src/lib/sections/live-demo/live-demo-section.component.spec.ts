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
});
