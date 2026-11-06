import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

/**
 * Reading order for every section below the hero, as fractions of the
 * section's scroll progress: eyebrow, headline, subline, then the visual.
 * Progress 1 is the settled final state.
 */
export const REVEAL = {
  eyebrow: 0.02,
  headline: 0.06,
  subline: 0.1,
  visual: 0.16,
} as const;

const DESKTOP = '(min-width: 1024px) and (prefers-reduced-motion: no-preference)';
const COMPACT = '(max-width: 1023px) and (prefers-reduced-motion: no-preference)';

/**
 * Ties `onProgress` (0 to 1) to vertical scroll. Desktop pins the section at
 * its centre for a short distance so the visual builds while the reader
 * scrolls down; compact screens scrub without a pin. Reduced motion settles
 * at 1 and creates nothing. Returns the release function.
 */
export function bindSectionScroll(
  section: HTMLElement,
  view: Window,
  onProgress: (progress: number) => void,
): () => void {
  if (view.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false) {
    onProgress(1);
    return () => undefined;
  }

  gsap.registerPlugin(ScrollTrigger);
  const media = gsap.matchMedia();
  const update = (self: ScrollTrigger): void => onProgress(self.progress);

  media.add(DESKTOP, () => {
    onProgress(0);
    const pin = ScrollTrigger.create({
      trigger: section,
      start: 'center center',
      end: '+=110%',
      pin: true,
    });
    const scrub = ScrollTrigger.create({
      trigger: section,
      start: 'top 70%',
      end: () => pin.end,
      scrub: 0.4,
      onUpdate: update,
    });
    return () => {
      scrub.kill();
      pin.kill();
      onProgress(1);
    };
  });

  media.add(COMPACT, () => {
    onProgress(0);
    const scrub = ScrollTrigger.create({
      trigger: section,
      start: 'top 85%',
      end: 'bottom 90%',
      scrub: 0.4,
      onUpdate: update,
    });
    return () => {
      scrub.kill();
      onProgress(1);
    };
  });

  return () => media.revert();
}
