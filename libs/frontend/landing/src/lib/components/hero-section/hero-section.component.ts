/**
 * Hero Section Component - Main Orchestrator
 *
 * Orchestrates the hero section by combining:
 * - Hero3dSceneComponent: Background 3D Glass/Cosmic scene (z-0)
 * - HeroContentOverlayComponent: Foreground HTML content (z-10)
 *
 * Features:
 * - Implements reducedMotion signal respecting prefers-reduced-motion media query
 * - Uses ScrollAnimationDirective for content fade-out on scroll
 * - Proper layering with relative/absolute positioning
 *
 * Accessibility:
 * - Respects user's motion preferences via reducedMotion signal
 * - All child animations can be disabled when reduced motion is preferred
 */
import {
  Component,
  signal,
  ChangeDetectionStrategy,
  OnInit,
  OnDestroy,
} from '@angular/core';
import { Hero3dSceneComponent } from './hero-3d-scene.component';
import { HeroContentOverlayComponent } from './hero-content-overlay.component';
import {
  ScrollAnimationDirective,
  ScrollAnimationConfig,
} from '@hive-academy/angular-gsap';

@Component({
  selector: 'ptah-hero-section',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    Hero3dSceneComponent,
    HeroContentOverlayComponent,
    ScrollAnimationDirective,
  ],
  template: `
    <section
      class="relative min-h-screen overflow-hidden bg-slate-950"
      aria-label="Hero section with 3D cosmic background"
    >
      <!-- 3D Scene (background layer) -->
      <ptah-hero-3d-scene
        class="absolute inset-0 z-0"
        [reducedMotion]="reducedMotion()"
      />

      <!-- Content Overlay (foreground layer with scroll animation) -->
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
        width: 100%;
      }
    `,
  ],
})
export class HeroSectionComponent implements OnInit, OnDestroy {
  /**
   * Signal to track whether reduced motion is preferred.
   * Initialized based on prefers-reduced-motion media query.
   * Updates reactively when user changes system preferences.
   */
  readonly reducedMotion = signal<boolean>(false);

  /**
   * Scroll animation config for the content overlay.
   * Fades out the content as user scrolls down.
   * - start: Animation begins when element is 20% from top of viewport
   * - end: Animation completes when element's bottom is at 60% of viewport
   * - scrub: Smooth 1.2 second delay for scroll-linked animation
   */
  readonly fadeOutConfig: ScrollAnimationConfig = {
    animation: 'custom',
    start: 'top 20%',
    end: 'bottom 60%',
    scrub: 1.2,
    from: { opacity: 1, y: 0 },
    to: { opacity: 0, y: -150 },
  };

  /**
   * Media query list for prefers-reduced-motion.
   * Stored to properly remove listener on destroy.
   */
  private mediaQueryList: MediaQueryList | null = null;

  /**
   * Bound listener function for proper cleanup.
   */
  private readonly mediaQueryListener = (event: MediaQueryListEvent): void => {
    this.reducedMotion.set(event.matches);
  };

  ngOnInit(): void {
    // Check if we're in a browser environment
    if (typeof window !== 'undefined' && window.matchMedia) {
      this.mediaQueryList = window.matchMedia(
        '(prefers-reduced-motion: reduce)'
      );

      // Set initial value
      this.reducedMotion.set(this.mediaQueryList.matches);

      // Listen for changes to user's motion preferences
      this.mediaQueryList.addEventListener('change', this.mediaQueryListener);
    }
  }

  ngOnDestroy(): void {
    // Clean up media query listener
    if (this.mediaQueryList) {
      this.mediaQueryList.removeEventListener(
        'change',
        this.mediaQueryListener
      );
    }
  }
}
