/** @jest-environment jsdom */
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import {
  FRESH_BRIEF_FILL,
  MULTI_VENDOR_POINTS,
  MultiVendorSectionComponent,
} from './multi-vendor-section.component';

function installMatchMedia(reducedMotion: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: jest.fn(
      (query: string): MediaQueryList => ({
        matches: reducedMotion
          ? query.includes('prefers-reduced-motion: reduce')
          : query.includes('min-width: 1024px'),
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

/** Browser mounts: no media playback in jsdom, so the clip stays idle. */
function stubBrowserMedia(): void {
  jest.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
}

function mount(platform: 'server' | 'browser' = 'server') {
  TestBed.configureTestingModule({
    imports: [MultiVendorSectionComponent],
    providers: [{ provide: PLATFORM_ID, useValue: platform }],
  });
  const fixture = TestBed.createComponent(MultiVendorSectionComponent);
  fixture.detectChanges();
  return { fixture, component: fixture.componentInstance, root: fixture.nativeElement as HTMLElement };
}

describe('MultiVendorSectionComponent', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  it('renders the copy, the orchestration clip and the lanes on the server', () => {
    const { root, fixture } = mount();

    expect(
      root.querySelector('section#multi-vendor-orchestration')?.getAttribute('aria-labelledby'),
    ).toBe('multi-vendor-title');
    expect(root.querySelector('.section-eyebrow')?.textContent?.trim()).toBe('Beside the chat');
    expect(root.querySelector('h2#multi-vendor-title')?.textContent?.trim()).toBe(
      'Claude or Codex up front.',
    );
    expect(root.querySelector('.section-subline')?.textContent?.trim()).toBe(
      'Background work uses the command-line agents already installed on your machine.',
    );
    expect(
      Array.from(root.querySelectorAll('.lane-text')).map((el) => el.textContent?.trim()),
    ).toEqual([...MULTI_VENDOR_POINTS]);

    const video = root.querySelector('video');
    expect(video?.querySelector('source')?.getAttribute('src')).toBe(
      '/assets/live-demo/orchestration.mp4',
    );
    expect(video?.getAttribute('poster')).toBe('/assets/live-demo/orchestration.jpg');
    expect(video?.getAttribute('aria-label')).toBeTruthy();

    // Settled: every line and lane in, the meter reset to a fresh brief, no lightning.
    expect(root.querySelectorAll('.rise:not(.is-in)')).toHaveLength(0);
    expect(root.querySelectorAll('.mv-lane.is-in')).toHaveLength(3);
    const meter = root.querySelector<HTMLElement>('[data-meter]');
    expect(meter?.classList.contains('is-fresh')).toBe(true);
    expect(meter?.style.getPropertyValue('--fill')).toBe(String(FRESH_BRIEF_FILL));
    expect(root.querySelector('ptah-flank-bolt, ptah-seam-bolt, ptah-lightning, canvas')).toBeNull();
    fixture.destroy();
  });

  it('lays out front and lanes: the copy rides in the pinned stage beside the clip', () => {
    const { root, fixture } = mount();
    const stage = root.querySelector('[data-stage]');
    expect(stage?.getAttribute('data-layout')).toBe('front-lanes');
    expect(Array.from(stage?.children ?? []).map((el) => el.className.split(' ')[0])).toEqual([
      'mv-clip',
      'mv-text',
    ]);
    expect(stage?.querySelector('.mv-text[data-overlap] h2#multi-vendor-title')).not.toBeNull();
    expect(root.querySelector('.section-header')?.getAttribute('data-align')).toBe('start');
    // Only the last lane has a meter.
    expect(root.querySelectorAll('[data-meter]')).toHaveLength(1);
    expect(root.querySelector('.mv-lane:last-child [data-meter]')).not.toBeNull();
    // Nothing decorative is focusable; the only control is the clip's own toggle.
    expect(root.querySelectorAll('[tabindex], a, input')).toHaveLength(0);
    expect(root.querySelectorAll('button')).toHaveLength(1);
    fixture.destroy();
  });

  it('branches the lanes top-down, fills the meter, then resets it to a fresh brief', () => {
    const { component, root, fixture } = mount();
    const meter = () => root.querySelector<HTMLElement>('[data-meter]');

    component.scroll.reveal.set(0.5);
    component.scroll.steps.set(0);
    fixture.detectChanges();
    expect(root.querySelectorAll('.mv-lane.is-in')).toHaveLength(0);
    expect(meter()?.style.getPropertyValue('--fill')).toBe('0');

    component.scroll.reveal.set(1);
    component.scroll.steps.set(0.45);
    fixture.detectChanges();
    expect(root.querySelectorAll('.mv-lane.is-in')).toHaveLength(2);
    expect(component.fresh()).toBe(false);
    expect(component.meterFill()).toBeGreaterThan(0.6);
    expect(meter()?.classList.contains('is-fresh')).toBe(false);

    component.scroll.steps.set(0.7);
    fixture.detectChanges();
    expect(root.querySelectorAll('.mv-lane.is-in')).toHaveLength(3);
    expect(component.meterFill()).toBe(FRESH_BRIEF_FILL);
    expect(meter()?.classList.contains('is-fresh')).toBe(true);
    fixture.destroy();
  });

  it('stays settled and creates no scroll triggers under reduced motion', () => {
    installMatchMedia(true);
    stubBrowserMedia();
    const create = jest.spyOn(ScrollTrigger, 'create');
    const matchMedia = jest.spyOn(gsap, 'matchMedia');
    const { component, root, fixture } = mount('browser');

    expect(create).not.toHaveBeenCalled();
    expect(matchMedia).not.toHaveBeenCalled();
    expect([component.scroll.reveal(), component.scroll.enter(), component.scroll.steps()]).toEqual(
      [1, 1, 1],
    );
    expect(root.querySelectorAll('.mv-lane.is-in')).toHaveLength(3);
    fixture.destroy();
  });

  it('releases its scroll bindings on destroy', () => {
    installMatchMedia(false);
    stubBrowserMedia();
    const media = gsap.matchMedia();
    const add = jest.spyOn(media, 'add').mockImplementation(() => media);
    const revert = jest.spyOn(media, 'revert').mockImplementation(() => undefined);
    jest.spyOn(gsap, 'matchMedia').mockReturnValue(media);
    const { fixture } = mount('browser');

    expect(add).toHaveBeenCalled();
    expect(revert).not.toHaveBeenCalled();
    fixture.destroy();
    expect(revert).toHaveBeenCalledTimes(1);
  });
});
