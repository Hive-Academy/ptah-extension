import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  DestroyRef,
  ElementRef,
  PLATFORM_ID,
  WritableSignal,
  afterNextRender,
  inject,
  signal,
} from '@angular/core';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

/** Three scroll phases of a clip section, each 0 to 1; 1 is settled. */
export interface StageProgress {
  /** The header lines, top-down. */
  readonly reveal: WritableSignal<number>;
  /** The clip frame entering: tilt or clip reveal resolves to flat, full size. */
  readonly enter: WritableSignal<number>;
  /** Pinned steps: caption chips one by one, then the electric edge. */
  readonly steps: WritableSignal<number>;
}

/** Where the pinned `steps` phase brings in each of a section's three points. */
export const STEP_THRESHOLDS = [0.12, 0.4, 0.68] as const;

/** How many points are in at `steps` (0 to 3). */
export function stepsReached(steps: number): number {
  return STEP_THRESHOLDS.filter((threshold) => steps >= threshold).length;
}

const DESKTOP = '(min-width: 1024px) and (prefers-reduced-motion: no-preference)';
const COMPACT = '(max-width: 1023px) and (prefers-reduced-motion: no-preference)';

/**
 * Binds a clip section's three phases to vertical scroll. Desktop pins the
 * stage (not the whole section) at the viewport centre while the steps play;
 * compact screens scrub without a pin; reduced motion settles everything.
 */
export function bindStageScroll(
  section: HTMLElement,
  stage: HTMLElement,
  view: Window,
  progress: StageProgress,
): () => void {
  const settle = (): void => {
    progress.reveal.set(1);
    progress.enter.set(1);
    progress.steps.set(1);
  };
  if (view.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false) {
    settle();
    return () => undefined;
  }

  gsap.registerPlugin(ScrollTrigger);
  const media = gsap.matchMedia();
  const scrubTo =
    (target: WritableSignal<number>) =>
    (self: ScrollTrigger): void =>
      target.set(self.progress);

  const phases = (pinned: boolean): (() => void) => {
    progress.reveal.set(0);
    progress.enter.set(0);
    progress.steps.set(0);
    const triggers = [
      ScrollTrigger.create({
        trigger: section,
        start: 'top 85%',
        end: 'top 30%',
        scrub: 0.3,
        onUpdate: scrubTo(progress.reveal),
      }),
      ScrollTrigger.create({
        trigger: stage,
        start: 'top bottom',
        end: pinned ? 'center center' : 'top 35%',
        scrub: 0.4,
        onUpdate: scrubTo(progress.enter),
      }),
      ScrollTrigger.create({
        trigger: stage,
        start: pinned ? 'center center' : 'top 60%',
        end: pinned ? '+=120%' : 'bottom 70%',
        pin: pinned,
        scrub: 0.4,
        onUpdate: scrubTo(progress.steps),
      }),
    ];
    return () => {
      triggers.forEach((trigger) => trigger.kill());
      settle();
    };
  };

  media.add(DESKTOP, () => phases(true));
  media.add(COMPACT, () => phases(false));
  return () => media.revert();
}

/**
 * Call in a component's injection context. Signals start settled (SSR,
 * reduced motion); in the browser they bind to the host's `<section>` and its
 * `[data-stage]` after the first render, and are released on destroy.
 */
export function stageScrollProgress(): StageProgress {
  const progress: StageProgress = { reveal: signal(1), enter: signal(1), steps: signal(1) };
  const host = inject<ElementRef<HTMLElement>>(ElementRef);
  const document = inject(DOCUMENT);
  if (!isPlatformBrowser(inject(PLATFORM_ID))) return progress;

  let release: (() => void) | undefined;
  afterNextRender(() => {
    const view = document.defaultView;
    const section = host.nativeElement.querySelector('section');
    const stage = host.nativeElement.querySelector<HTMLElement>('[data-stage]');
    if (view && section && stage) release = bindStageScroll(section, stage, view, progress);
  });
  inject(DestroyRef).onDestroy(() => release?.());
  return progress;
}
