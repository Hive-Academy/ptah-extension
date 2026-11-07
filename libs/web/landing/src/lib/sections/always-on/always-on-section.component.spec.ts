/** @jest-environment jsdom */
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import {
  ALWAYS_ON_CLIP,
  ALWAYS_ON_POINTS,
  AlwaysOnSectionComponent,
} from './always-on-section.component';

function mount(platform: 'server' | 'browser' = 'server') {
  // jsdom does not implement media playback; the clip pauses on destroy.
  jest.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  TestBed.configureTestingModule({
    imports: [AlwaysOnSectionComponent],
    providers: [{ provide: PLATFORM_ID, useValue: platform }],
  });
  const fixture = TestBed.createComponent(AlwaysOnSectionComponent);
  fixture.detectChanges();
  return { fixture, component: fixture.componentInstance, root: fixture.nativeElement as HTMLElement };
}

function installReducedMotion(): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: jest.fn(
      (query: string): MediaQueryList => ({
        matches: query.includes('prefers-reduced-motion: reduce'),
        media: query,
        onchange: null,
        addListener: jest.fn(),
        removeListener: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
      }),
    ),
  });
}

describe('AlwaysOnSectionComponent', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  it('renders the copy and the points on the server, settled', () => {
    const { root, fixture } = mount();

    expect(root.querySelector('section#always-on')?.getAttribute('aria-labelledby')).toBe(
      'always-on-title',
    );
    expect(root.querySelector('.section-eyebrow')?.textContent?.trim()).toBe('Off the desk');
    expect(root.querySelector('h2#always-on-title')?.textContent?.trim()).toBe(
      'Hand the live chat to your phone.',
    );
    expect(root.querySelector('.section-subline')?.textContent?.trim()).toBe(
      'Pair Telegram, Discord, or Slack. The desktop composer locks until you take it back.',
    );
    expect(
      Array.from(root.querySelectorAll('ul.ao-points > li.ao-point')).map((el) =>
        el.textContent?.trim(),
      ),
    ).toEqual([...ALWAYS_ON_POINTS]);

    expect(root.querySelectorAll('.rise:not(.is-in)')).toHaveLength(0);
    expect(root.querySelectorAll('.ao-point.is-in')).toHaveLength(3);
    fixture.destroy();
  });

  it('plays the always-on clip in place of the app mockup, without autoplay on the server', () => {
    const { root, fixture } = mount();

    const clip = root.querySelector('[data-clip] ptah-console-clip');
    expect(clip).not.toBeNull();
    const video = clip?.querySelector('video');
    expect(
      Array.from(video?.querySelectorAll('source') ?? []).map((source) => source.getAttribute('src')),
    ).toEqual(['/assets/live-demo/always-on.mp4', '/assets/live-demo/always-on.webm']);
    expect(video?.getAttribute('poster')).toBe('/assets/live-demo/always-on.jpg');
    expect(video?.getAttribute('aria-label')).toBe(ALWAYS_ON_CLIP.label);
    expect(video?.hasAttribute('controls')).toBe(true);
    expect(clip?.querySelector('button.clip-toggle')?.hasAttribute('hidden')).toBe(true);

    // The drawn desk and phone are gone, with their mockup-only labels.
    expect(root.querySelector('[data-desk], [data-phone], ptah-always-on-desk, .app-card')).toBeNull();
    expect(root.textContent).not.toContain('Hand off session to');
    expect(root.querySelector('.phone-name')).toBeNull();
    fixture.destroy();
  });

  it('lays out the hand-off: header, clip, then the points, with no lightning', () => {
    const { root, fixture } = mount();
    const stage = root.querySelector('[data-stage]');
    expect(stage?.getAttribute('data-layout')).toBe('hand-off');
    expect(Array.from(stage?.children ?? []).map((el) => el.className.split(' ')[0])).toEqual([
      'ao-head',
      'ao-clip',
      'ao-points',
    ]);
    expect(root.querySelector('.section-header')?.getAttribute('data-align')).toBe('start');
    expect(root.querySelector('ptah-flank-bolt, ptah-seam-bolt, ptah-lightning, canvas')).toBeNull();
    fixture.destroy();
  });

  it('reveals the header, then brings the points in, top-down', () => {
    const { component, root, fixture } = mount();
    const shown = (selector: string) => root.querySelectorAll(selector + '.is-in').length;

    component.scroll.reveal.set(0.5);
    component.scroll.enter.set(0);
    component.scroll.steps.set(0);
    fixture.detectChanges();
    expect(shown('.section-title')).toBe(1);
    expect(shown('.section-subline')).toBe(0);
    expect(shown('.ao-point')).toBe(0);

    component.scroll.reveal.set(1);
    component.scroll.steps.set(0.2);
    fixture.detectChanges();
    expect(shown('.ao-point')).toBe(1);

    component.scroll.steps.set(1);
    fixture.detectChanges();
    expect(shown('.ao-point')).toBe(3);
    fixture.destroy();
  });

  it('keeps everything in and the clip without autoplay under reduced motion', () => {
    installReducedMotion();
    const create = jest.spyOn(ScrollTrigger, 'create');
    const matchMedia = jest.spyOn(gsap, 'matchMedia');
    const { root, fixture } = mount('browser');
    fixture.detectChanges();

    expect(create).not.toHaveBeenCalled();
    expect(matchMedia).not.toHaveBeenCalled();
    expect(root.querySelectorAll('.ao-point.is-in')).toHaveLength(3);
    expect(root.querySelector('[data-clip] video')?.hasAttribute('controls')).toBe(true);
    fixture.destroy();
  });
});
