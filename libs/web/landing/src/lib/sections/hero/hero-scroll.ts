import gsap from 'gsap';

/** The pin spans 0.9 viewports of scroll, as on main. */
export const PIN_VIEWPORTS = 0.9;

export interface HeroScrollHooks {
  /** Progress (0 to 1) of the pinned fade of the background, symbols and footnote. */
  readonly onLayers: (progress: number) => void;
  /** Progress (0 to 1) of the centred copy's fade at the bottom of the hero. */
  readonly onCopy: (progress: number) => void;
}

/**
 * Desktop scroll choreography of the hero.
 *
 * - Pinned for `PIN_VIEWPORTS`: the still, grain, symbols (with their lightning
 *   canvas), footnote and the frame's vignette fade and lift, as before.
 * - The centred copy (eyebrow, title, lead, CTAs) is not part of that fade. It
 *   stays fully visible and in place for the whole hero: during the pin it is
 *   pinned with the stage, after it a scrubbed counter-move cancels the
 *   stage's scroll.
 * - It fades only as the bottom of the hero (where the next section begins)
 *   passes over it: from the copy's bottom edge to its top edge.
 *
 * Returns the cleanup that kills every tween and trigger it made; the
 * gsap.matchMedia context that runs it reverts their inline styles.
 */
export function createHeroScroll(view: Window, stage: HTMLElement, hooks: HeroScrollHooks): () => void {
  const frame = stage.querySelector<HTMLElement>('[data-title-frame]');
  const copy = stage.querySelector<HTMLElement>('[data-title-content]');
  // The section wraps the pin spacer, so its height includes the pinned scroll.
  const section = stage.closest<HTMLElement>('section') ?? stage;
  const layers = frame
    ? Array.from(frame.children).filter((child) => child !== copy)
    : [];
  const pinDistance = (): number => Math.round(view.innerHeight * PIN_VIEWPORTS);

  const pinned = gsap.timeline({
    defaults: { ease: 'none' },
    scrollTrigger: {
      trigger: stage,
      start: 'top top',
      end: () => '+=' + pinDistance(),
      pin: true,
      scrub: 1,
      anticipatePin: 1,
      invalidateOnRefresh: true,
      onUpdate: (self) => hooks.onLayers(self.progress),
    },
  });
  if (frame) {
    // The same lift the whole frame had (8% of its height), now without the copy.
    pinned.to(layers, { opacity: 0, y: () => -0.08 * frame.offsetHeight, duration: 1 }, 0);
    pinned.to(frame, { '--frame-fade': 0, duration: 1 }, 0);
  }
  if (!copy) return () => killTimeline(pinned);

  // Created after the pin, so ScrollTrigger measures them with its spacing in place.
  const hold = gsap.to(copy, {
    y: () => stage.offsetHeight,
    ease: 'none',
    scrollTrigger: {
      trigger: section,
      start: () => `top -${pinDistance()}px`,
      end: 'bottom top',
      scrub: true,
      invalidateOnRefresh: true,
    },
  });
  // offsetTop ignores transforms: the copy's resting place in the pinned stage.
  const fade = gsap.to(copy, {
    opacity: 0,
    ease: 'none',
    scrollTrigger: {
      trigger: section,
      start: () => `bottom ${copy.offsetTop + copy.offsetHeight}px`,
      end: () => `bottom ${copy.offsetTop}px`,
      scrub: true,
      invalidateOnRefresh: true,
      onUpdate: (self) => hooks.onCopy(self.progress),
    },
  });

  return () => {
    killTimeline(pinned);
    for (const tween of [hold, fade]) {
      tween.scrollTrigger?.kill();
      tween.kill();
    }
  };
}

function killTimeline(timeline: gsap.core.Timeline): void {
  timeline.scrollTrigger?.kill();
  timeline.kill();
}
