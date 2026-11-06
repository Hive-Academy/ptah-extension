/** @jest-environment jsdom */
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import {
  PROVIDERS_CLIP,
  PROVIDERS_POINTS,
  ProvidersSectionComponent,
} from './providers-section.component';

function mount(platform: 'server' | 'browser' = 'server') {
  // jsdom does not implement media playback; the clip pauses on destroy.
  jest.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  TestBed.configureTestingModule({
    imports: [ProvidersSectionComponent],
    providers: [{ provide: PLATFORM_ID, useValue: platform }],
  });
  const fixture = TestBed.createComponent(ProvidersSectionComponent);
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

describe('ProvidersSectionComponent', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  it('renders the copy and the cards on the server, settled', () => {
    const { root, fixture } = mount();

    expect(root.querySelector('section#providers')?.getAttribute('aria-labelledby')).toBe(
      'providers-title',
    );
    expect(root.querySelector('.section-eyebrow')?.textContent?.trim()).toBe('Your accounts');
    expect(root.querySelector('h2#providers-title')?.textContent?.trim()).toBe(
      'Bring the accounts you already have.',
    );
    expect(root.querySelector('.section-subline')?.textContent?.trim()).toBe(
      'A named Claude account is certified before launch, and the live subscription is checked.',
    );
    expect(
      Array.from(root.querySelectorAll('.pv-card .card-text')).map((el) => el.textContent?.trim()),
    ).toEqual([...PROVIDERS_POINTS]);
    expect(root.querySelectorAll('.card-index[aria-hidden="true"]')).toHaveLength(3);

    expect(root.querySelectorAll('.rise:not(.is-in)')).toHaveLength(0);
    expect(root.querySelectorAll('.pv-card.is-in')).toHaveLength(3);
    fixture.destroy();
  });

  it('plays the providers clip in place of the still and the app mockups, without autoplay on the server', () => {
    const { root, fixture } = mount();

    const clip = root.querySelector('[data-clip] ptah-console-clip');
    expect(clip).not.toBeNull();
    const video = clip?.querySelector('video');
    expect(
      Array.from(video?.querySelectorAll('source') ?? []).map((source) => source.getAttribute('src')),
    ).toEqual(['/assets/live-demo/providers.mp4', '/assets/live-demo/providers.webm']);
    expect(video?.getAttribute('poster')).toBe('/assets/live-demo/providers.jpg');
    expect(video?.getAttribute('aria-label')).toBe(PROVIDERS_CLIP.label);
    expect(video?.hasAttribute('controls')).toBe(true);
    expect(clip?.querySelector('button.clip-toggle')?.hasAttribute('hidden')).toBe(true);

    // The still, the connection card and the point fragments are gone, with their labels.
    expect(root.querySelector('img, [data-conn], ptah-providers-point-mock, .app-card')).toBeNull();
    expect(root.textContent).not.toContain('Active for main agent');
    expect(root.textContent).not.toContain('CLI subscription');
    fixture.destroy();
  });

  it('lays out the account deck: header, cards, then the clip, with no lightning', () => {
    const { root, fixture } = mount();
    const stage = root.querySelector('[data-stage]');
    expect(stage?.getAttribute('data-layout')).toBe('account-deck');
    expect(Array.from(stage?.children ?? []).map((el) => el.className.split(' ')[0])).toEqual([
      'pv-head',
      'pv-deck',
      'pv-clip',
    ]);
    expect(root.querySelector('.section-header')?.getAttribute('data-align')).toBe('start');
    expect(root.querySelector('ptah-flank-bolt, ptah-seam-bolt, ptah-lightning, canvas')).toBeNull();
    fixture.destroy();
  });

  it('reveals the header, then deals the cards in order', () => {
    const { component, root, fixture } = mount();
    const shown = (selector: string) => root.querySelectorAll(selector + '.is-in').length;

    component.scroll.reveal.set(0.5);
    component.scroll.enter.set(0);
    component.scroll.steps.set(0);
    fixture.detectChanges();
    expect(shown('.section-title')).toBe(1);
    expect(shown('.section-subline')).toBe(0);
    expect(shown('.pv-card')).toBe(0);

    component.scroll.reveal.set(1);
    component.scroll.steps.set(0.2);
    fixture.detectChanges();
    expect(shown('.pv-card')).toBe(1);

    component.scroll.steps.set(0.45);
    fixture.detectChanges();
    expect(shown('.pv-card')).toBe(2);

    component.scroll.steps.set(1);
    fixture.detectChanges();
    expect(shown('.pv-card')).toBe(3);
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
    expect(root.querySelectorAll('.pv-card.is-in')).toHaveLength(3);
    expect(root.querySelector('[data-clip] video')?.hasAttribute('controls')).toBe(true);
    fixture.destroy();
  });
});
