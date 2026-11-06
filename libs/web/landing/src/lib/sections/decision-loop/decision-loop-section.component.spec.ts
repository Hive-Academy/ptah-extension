/** @jest-environment jsdom */
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import {
  DECISION_LOOP_STAGES,
  DecisionLoopSectionComponent,
} from './decision-loop-section.component';

function installMatchMedia(reducedMotion: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: jest.fn(
      (query: string): MediaQueryList => ({
        matches: reducedMotion
          ? query.includes('prefers-reduced-motion: reduce')
          : query.includes('prefers-reduced-motion: no-preference'),
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

function mount(platform: 'server' | 'browser'): {
  component: DecisionLoopSectionComponent;
  root: HTMLElement;
  detectChanges: () => void;
  destroy: () => void;
} {
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

  it('renders exact decision-model-loop copy and an accessible ordered list on the server', () => {
    const { root, destroy } = mount('server');

    const section = root.querySelector('section#decision-model-loop');
    expect(section).not.toBeNull();
    expect(section?.getAttribute('aria-labelledby')).toBe('decision-loop-title');

    expect(root.querySelector('.loop-eyebrow')?.textContent?.trim()).toBe(
      'Who runs it',
    );
    expect(root.querySelector('h2#decision-loop-title')?.textContent?.trim()).toBe(
      'How Ptah decides the work.',
    );
    expect(root.querySelector('.loop-subline')?.textContent?.trim()).toBe(
      'A fast model proposes the job. Ninety days of local results, plus hard rules, shape who runs it.',
    );

    const orderedList = root.querySelector('ol.loop-stages');
    expect(orderedList).not.toBeNull();

    const items = Array.from(orderedList?.querySelectorAll('li.loop-stage') ?? []);
    expect(items).toHaveLength(6);
    expect(
      items.map((item) =>
        item.querySelector('.stage-label')?.textContent?.trim(),
      ),
    ).toEqual(DECISION_LOOP_STAGES.map((stage) => stage.label));

    // The window reads as the app's Settings: the roles accordion header and
    // each stage's control, all decorative and in the app's own words.
    const rolesBar = root.querySelector('ptah-decision-loop-roles-bar .roles-bar');
    expect(rolesBar?.getAttribute('aria-hidden')).toBe('true');
    expect(rolesBar?.querySelector('.roles-title')?.textContent?.trim()).toBe(
      'Background Model Roles',
    );
    const cues = Array.from(root.querySelectorAll('li.loop-stage .cue'));
    expect(cues.map((cue) => cue.getAttribute('aria-hidden'))).toEqual(['true', 'true', 'true']);
    // The cue's spans sit side by side with no whitespace text node between them.
    const cueText = (cue: Element): string =>
      Array.from(cue.querySelectorAll('span'))
        .filter((span) => span.children.length === 0)
        .map((span) => span.textContent?.trim() ?? '')
        .filter(Boolean)
        .join(' ');
    expect(cues.map(cueText)).toEqual([
      'Decision model',
      'Ollama ready',
      'Routing suggestions',
    ]);
    expect(root.querySelector('ptah-decision-loop-track svg.loop-svg-desktop')).not.toBeNull();

    // Nothing non-interactive is focusable.
    expect(root.querySelectorAll('[tabindex], button, a, input')).toHaveLength(0);
    destroy();
  });

  it('keeps the loop settled when prefers-reduced-motion is enabled', () => {
    installMatchMedia(true);
    const createSpy = jest.spyOn(ScrollTrigger, 'create');
    const { component, root, destroy } = mount('browser');
    component['initialize']();

    expect(component.loopProgress()).toBe(1);
    expect(component.feedbackLit()).toBe(true);
    expect(createSpy).not.toHaveBeenCalled();
    expect(root.querySelectorAll('li.loop-stage.is-reached')).toHaveLength(6);
    destroy();
  });

  it('advances stages along the closed loop and returns from stage 06 to stage 03', () => {
    installMatchMedia(false);
    const { component, root, detectChanges, destroy } = mount('browser');

    component.setProgress(0.1);
    detectChanges();
    expect(component.activeStage()).toBe(0);
    expect(component.feedbackLit()).toBe(false);

    component.setProgress(0.42);
    detectChanges();
    expect(component.activeStage()).toBe(2);
    expect(root.querySelectorAll('li.loop-stage.is-reached')).toHaveLength(3);

    component.setProgress(0.84);
    detectChanges();
    expect(component.activeStage()).toBe(5);
    expect(root.querySelectorAll('li.loop-stage.is-reached')).toHaveLength(6);

    // Closed-loop completion returns focus to stage 03 (Blend 90-day evidence).
    component.setProgress(0.96);
    detectChanges();
    expect(component.activeStage()).toBe(2);
    expect(component.feedbackLit()).toBe(true);
    expect(
      root
        .querySelectorAll('li.loop-stage')[2]
        ?.classList.contains('is-feedback-lit'),
    ).toBe(true);

    destroy();
  });

  it('cleans up ScrollTrigger and matchMedia on destroy', () => {
    installMatchMedia(false);
    const kill = jest.fn();
    jest.spyOn(ScrollTrigger, 'create').mockReturnValue({
      kill,
    } as unknown as ScrollTrigger);

    const { component, destroy } = mount('browser');
    component['initialize']();
    destroy();

    expect(kill).toHaveBeenCalled();
  });
});
