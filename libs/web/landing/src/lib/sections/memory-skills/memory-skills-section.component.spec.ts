/** @jest-environment jsdom */
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import {
  APPLY_AT,
  MEMORY_SKILLS_POINTS,
  MemorySkillsSectionComponent,
} from './memory-skills-section.component';

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

function mount(platform: 'server' | 'browser' = 'server') {
  TestBed.configureTestingModule({
    imports: [MemorySkillsSectionComponent],
    providers: [{ provide: PLATFORM_ID, useValue: platform }],
  });
  const fixture = TestBed.createComponent(MemorySkillsSectionComponent);
  fixture.detectChanges();
  return { fixture, component: fixture.componentInstance, root: fixture.nativeElement as HTMLElement };
}

describe('MemorySkillsSectionComponent', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  it('renders the copy, the anchors and the diff lines, settled and applied, on the server', () => {
    const { root, fixture } = mount();

    expect(root.querySelector('section#memory-intelligence')?.getAttribute('aria-labelledby')).toBe(
      'memory-skills-title',
    );
    expect(root.querySelector('#the-onboarding-problem')).not.toBeNull();
    expect(root.querySelector('#skills-orchestration')).not.toBeNull();
    expect(root.querySelector('.section-eyebrow')?.textContent?.trim()).toBe('On this machine');
    expect(root.querySelector('h2#memory-skills-title')?.textContent?.trim()).toBe(
      'It remembers. You apply the diff.',
    );
    expect(root.querySelector('.section-subline')?.textContent?.trim()).toBe(
      'Memory stays local. A skill file changes only when you apply it.',
    );
    expect(
      Array.from(root.querySelectorAll('li.ms-hunk .hunk-text')).map((el) => el.textContent?.trim()),
    ).toEqual([...MEMORY_SKILLS_POINTS]);

    // A diagram section: no clip. Settled: every line, row and hunk in, the diff applied.
    expect(root.querySelector('video, ptah-console-clip')).toBeNull();
    expect(root.querySelectorAll('.rise:not(.is-in)')).toHaveLength(0);
    expect(root.querySelectorAll('.ms-hunk.is-in')).toHaveLength(3);
    expect(root.querySelectorAll('.memory-row:not(.is-lit)')).toHaveLength(0);
    expect(root.querySelector('[data-sheet]')?.classList.contains('is-applied')).toBe(true);
    expect(root.querySelector('[data-apply]')?.classList.contains('is-on')).toBe(true);
    expect(root.querySelectorAll('ptah-flank-bolt[aria-hidden="true"]')).toHaveLength(2);
    expect(root.querySelector('ptah-seam-bolt')).toBeNull();
    fixture.destroy();
  });

  it('lays out the split sheet: the header rides in the pinned stage, the decoration is hidden', () => {
    const { root, fixture } = mount();
    const stage = root.querySelector('[data-stage]');
    expect(stage?.getAttribute('data-layout')).toBe('split-sheet');
    expect(Array.from(stage?.children ?? []).map((el) => el.className.split(' ')[0])).toEqual([
      'ms-head',
      'ms-sheet-wrap',
    ]);
    expect(stage?.querySelector('.ms-head[data-overlap] h2#memory-skills-title')).not.toBeNull();
    expect(root.querySelector('.section-header')?.getAttribute('data-align')).toBe('start');
    // The memory pane and the diff marks are decorative; the points stay readable.
    expect(root.querySelector('[data-memory]')?.getAttribute('aria-hidden')).toBe('true');
    expect(
      Array.from(root.querySelectorAll('.hunk-sign, .hunk-context')).every(
        (el) => el.getAttribute('aria-hidden') === 'true',
      ),
    ).toBe(true);
    expect(root.querySelectorAll('.memory-row[data-kind="keyword"]').length).toBeGreaterThan(0);
    expect(root.querySelectorAll('.memory-row[data-kind="vector"]').length).toBeGreaterThan(0);
    expect(root.querySelector('.ms-bolt-floor')?.getAttribute('data-axis')).toBe('horizontal');
    expect(root.querySelector('.ms-bolt-margin')?.getAttribute('data-axis')).toBe('vertical');
    expect(root.querySelectorAll('[tabindex], button, a, input')).toHaveLength(0);
    fixture.destroy();
  });

  it('lights the index with the window, adds the lines top-down, then applies the diff last', () => {
    const { component, root, fixture } = mount();
    const applied = () => root.querySelector('[data-sheet]')?.classList.contains('is-applied');

    component.scroll.reveal.set(0.5);
    component.scroll.enter.set(0);
    component.scroll.steps.set(0);
    fixture.detectChanges();
    expect(root.querySelectorAll('.memory-row.is-lit')).toHaveLength(0);
    expect(root.querySelectorAll('.ms-hunk.is-in')).toHaveLength(0);
    expect(applied()).toBe(false);
    expect(component.strike()).toBe(2);

    component.scroll.reveal.set(1);
    component.scroll.enter.set(0.5);
    component.scroll.steps.set(0.45);
    fixture.detectChanges();
    expect(root.querySelectorAll('.memory-row.is-lit')).toHaveLength(4);
    expect(root.querySelectorAll('.ms-hunk.is-in')).toHaveLength(2);
    expect(applied()).toBe(false);
    expect(component.strike()).toBe(5);

    component.scroll.enter.set(1);
    component.scroll.steps.set(0.75);
    fixture.detectChanges();
    expect(root.querySelectorAll('.ms-hunk.is-in')).toHaveLength(3);
    expect(applied()).toBe(false);

    component.scroll.steps.set(APPLY_AT);
    fixture.detectChanges();
    expect(applied()).toBe(true);
    expect(component.strike()).toBe(7);
    fixture.destroy();
  });

  it('stays settled and creates no scroll triggers under reduced motion', () => {
    installMatchMedia(true);
    jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const create = jest.spyOn(ScrollTrigger, 'create');
    const matchMedia = jest.spyOn(gsap, 'matchMedia');
    const { component, root, fixture } = mount('browser');

    expect(create).not.toHaveBeenCalled();
    expect(matchMedia).not.toHaveBeenCalled();
    expect(component.applied()).toBe(true);
    expect(root.querySelectorAll('.ms-hunk.is-in')).toHaveLength(3);
    fixture.destroy();
  });

  it('releases its scroll bindings on destroy', () => {
    installMatchMedia(false);
    jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
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
