import {
  Component,
  signal,
  ChangeDetectionStrategy,
  afterNextRender,
} from '@angular/core';
import {
  ScrollAnimationDirective,
  ScrollAnimationConfig,
} from '@hive-academy/angular-gsap';
import { Hero3dSceneComponent } from './hero-3d-scene.component';
import { HeroContentOverlayComponent } from './hero-content-overlay.component';

/**
 * HeroComponent - Orchestrator for hero section
 *
 * Responsibilities:
 * - Manages reduced motion preference detection
 * - Composes Hero3dSceneComponent (3D background) and HeroContentOverlayComponent (HTML content)
 * - Applies scroll-based fade-out animation to content overlay
 *
 * NO raw Three.js or GSAP code - all via @hive-academy library components
 */
@Component({
  selector: 'ptah-hero',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    Hero3dSceneComponent,
    HeroContentOverlayComponent,
    ScrollAnimationDirective,
  ],
  template: `
    <section class="relative min-h-screen overflow-hidden bg-slate-950">
      <!-- 3D Scene (background layer) -->
      <ptah-hero-3d-scene
        class="absolute inset-0 z-0"
        [reducedMotion]="reducedMotion()"
      />

      <!-- Content Overlay (foreground layer with scroll fade-out) -->
      <ptah-hero-content-overlay
        class="relative z-10"
        scrollAnimation
        [scrollConfig]="fadeOutConfig"
      />
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class HeroComponent {
  /**
   * Signal tracking user's reduced motion preference
   * Initialized in afterNextRender to access window safely
   */
  readonly reducedMotion = signal(false);

  /**
   * Scroll animation config for content fade-out effect
   * Content fades and moves up as user scrolls past hero section
   */
  readonly fadeOutConfig: ScrollAnimationConfig = {
    animation: 'custom',
    start: 'top 20%',
    end: 'bottom 60%',
    scrub: 1.2,
    from: { opacity: 1, y: 0 },
    to: { opacity: 0, y: -150 },
  };

  constructor() {
    afterNextRender(() => {
      // Detect prefers-reduced-motion preference
      const prefersReducedMotion =
        typeof window !== 'undefined' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.reducedMotion.set(prefersReducedMotion);
    });
  }
}
