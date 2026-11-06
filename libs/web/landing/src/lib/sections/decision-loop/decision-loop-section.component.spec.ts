/** @jest-environment jsdom */
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import {
  DECISION_LOOP_CLIP,
  DECISION_LOOP_STAGES,
  DecisionLoopSectionComponent,
} from './decision-loop-section.component';

/** One environment per test: reduced motion, or a desktop with motion (never compact too). */
function installMatchMedia(mode: 'reduced' | 'desktop'): void {
  const matches = (query: string): boolean =>
    mode === 'reduced'
      ? query.includes('prefers-reduced-motion: reduce')
      : query.includes('min-width: 1024px') && query.includes('prefers-reduced-motion: no-preference');
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: jest.fn(
      (query: string): MediaQueryList => ({
        matches: matches(query),
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

/** gsap.matchMedia with add/revert stubbed: no real ScrollTrigger runs in jsdom. */
function stubGsapMatchMedia() {
  const media = gsap.matchMedia();
  const add = jest.spyOn(media, 'add').mockImplementation(() => media);
  const revert = jest.spyOn(media, 'revert').mockImplementation(() => undefined);
  jest.spyOn(gsap, 'matchMedia').mockReturnValue(media);
  return { add, revert };
}

/** A ScrollTrigger with the members bindSectionScroll uses: `end` (read by the scrub) and `kill`. */
function fakeTrigger(kill: jest.Mock): ScrollTrigger {
  return Object.assign(Object.create(ScrollTrigger.prototype) as ScrollTrigger, { kill, end: 2000 });
}

function mount(platform: 'server' | 'browser'): {
  component: DecisionLoopSectionComponent;
  root: HTMLElement;
  detectChanges: () => void;
  destroy: () => void;
} {
  // jsdom does not implement media playback; the clip pauses on destroy.
  jest.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  TestBed.configureTestingModule({
    imports: [DecisionLoopSectionComponent],
    providers: [{ provide: PLATFORM_ID, useValue: platform }],
  });
  const fixture = TestBed.createComponent(DecisionLoopSectionComponent);
  fixture.detectChanges();
  return {
    component: fixture.componentInstance,
    root: fixture.nativeElement as HTMLElement,
    detectChanges: () => fixture.detectChanges(),
    destroy: () => fixture.destroy(),
  };
}

describe('DecisionLoopSectionComponent', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  it('renders exact decision-model-loop copy and the six steps as an ordered list on the server', () => {
    const { root, destroy } = mount('server');

    const section = root.querySelector('section#decision-model-loop');
    expect(section).not.toBeNull();
    expect(section?.getAttribute('aria-labelledby')).toBe('decision-loop-title');

    expect(root.querySelector('.loop-eyebrow')?.textContent?.trim()).toBe('Who runs it');
    expect(root.querySelector('h2#decision-loop-title')?.textContent?.trim()).toBe(
      'How Ptah decides the work.',
    );
    expect(root.querySelector('.loop-subline')?.textContent?.trim()).toBe(
      'A fast model proposes the job. Ninety days of local results, plus hard rules, shape who runs it.',
    );

    const items = Array.from(root.querySelectorAll('ol.loop-stages > li.loop-stage'));
    expect(items.map((item) => item.querySelector('.stage-label')?.textContent?.trim())).toEqual([
      'Classify type and depth',
      'Fast model, 3-second abort',
      'Blend 90-day evidence',
      'Drop same-family review',
      'Routing reminder in chat',
      'Check files, feed back',
    ]);
    expect(items.map((item) => item.querySelector('.stage-number')?.textContent?.trim())).toEqual(
      DECISION_LOOP_STAGES.map((stage) => stage.number),
    );

    // Settled on the server: header and every step in.
    expect(root.querySelectorAll('.rise:not(.is-in)')).toHaveLength(0);
    expect(root.querySelectorAll('li.loop-stage.is-reached')).toHaveLength(6);
    destroy();
  });

  it('plays the decision-loop clip in place of the app mockup', () => {
    const { root, destroy } = mount('server');

    const clip = root.querySelector('[data-loop-clip] ptah-console-clip');
    expect(clip).not.toBeNull();
    const video = clip?.querySelector('video');
    const sources = Array.from(video?.querySelectorAll('source') ?? []).map((source) =>
      source.getAttribute('src'),
    );
    expect(sources).toEqual([DECISION_LOOP_CLIP.video, DECISION_LOOP_CLIP.videoWebm]);
    expect(sources).toEqual([
      '/assets/live-demo/decision-loop.mp4',
      '/assets/live-demo/decision-loop.webm',
    ]);
    expect(video?.getAttribute('poster')).toBe('/assets/live-demo/decision-loop.jpg');
    expect(video?.getAttribute('aria-label')).toBe(DECISION_LOOP_CLIP.label);
    // No autoplay on the server: native controls, the toggle hidden.
    expect(video?.hasAttribute('controls')).toBe(true);
    expect(clip?.querySelector('button.clip-toggle')?.hasAttribute('hidden')).toBe(true);

    // The drawn app mockup is gone.
    expect(root.querySelector('.loop-window, .app-frame, .app-card, svg')).toBeNull();
    destroy();
  });

  it('keeps every step in when prefers-reduced-motion is enabled', () => {
    installMatchMedia('reduced');
    const create = jest.spyOn(ScrollTrigger, 'create');
    const matchMedia = jest.spyOn(gsap, 'matchMedia');
    const { component, root, detectChanges, destroy } = mount('browser');
    detectChanges();

    expect(component.loopProgress()).toBe(1);
    expect(create).not.toHaveBeenCalled();
    expect(matchMedia).not.toHaveBeenCalled();
    expect(root.querySelectorAll('li.loop-stage.is-reached')).toHaveLength(6);
    destroy();
  });

  it('brings the steps in, in order, as the loop progresses', () => {
    installMatchMedia('desktop');
    stubGsapMatchMedia();
    const { component, root, detectChanges, destroy } = mount('browser');
    const reached = (): number => root.querySelectorAll('li.loop-stage.is-reached').length;

    component.setProgress(0.1);
    detectChanges();
    expect(reached()).toBe(1);

    component.setProgress(0.42);
    detectChanges();
    expect(reached()).toBe(3);
    expect(root.querySelectorAll('li.loop-stage')[2]?.classList.contains('is-reached')).toBe(true);
    expect(root.querySelectorAll('li.loop-stage')[3]?.classList.contains('is-reached')).toBe(false);

    component.setProgress(0.84);
    detectChanges();
    expect(reached()).toBe(6);

    component.setProgress(-1);
    expect(component.loopProgress()).toBe(0);
    destroy();
  });

  it('releases its scroll bindings on destroy', () => {
    installMatchMedia('desktop');
    const { add, revert } = stubGsapMatchMedia();
    const { destroy } = mount('browser');

    // Bound once, by the component's own afterNextRender.
    expect(add).toHaveBeenCalledTimes(2);
    expect(revert).not.toHaveBeenCalled();
    destroy();
    expect(revert).toHaveBeenCalledTimes(1);
  });

  it('pins and scrubs on desktop only, then kills both triggers on destroy', () => {
    installMatchMedia('desktop');
    const kill = jest.fn();
    const create = jest.spyOn(ScrollTrigger, 'create').mockReturnValue(fakeTrigger(kill));
    const { destroy } = mount('browser');

    // Desktop only: the pin and its scrub, not the compact scrub as well.
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0]?.[0]).toMatchObject({ pin: true });
    destroy();
    expect(kill).toHaveBeenCalledTimes(2);
  });
});
