import { Component, ChangeDetectionStrategy } from '@angular/core';
import {
  ScrollAnimationDirective,
  ScrollAnimationConfig,
} from '@hive-academy/angular-gsap';
import { HeroContentOverlayComponent } from './hero-content-overlay.component';
import { HeroFloatingImagesComponent } from './hero-floating-images.component';

/**
 * HeroComponent - Orchestrator for hero section with cinematic scroll animations
 *
 * Layer Structure (z-index order):
 * 1. Hieroglyph Circuit Pattern (z-0) - Parallax background (slowest)
 * 2. Dark Overlay (z-1) - Semi-transparent for readability
 * 3. Cinematic Vignette (z-2) - Darker corners with scroll intensity
 * 4. Floating Images (z-3) - Egyptian symbols with mouse + scroll parallax
 * 5. Content Overlay (z-10) - Text, CTAs, stats with scroll fade-out
 *
 * Scroll Animation Strategy:
 * - Background: Slow parallax (0.3 speed) creates depth
 * - Vignette: Intensifies on scroll for dramatic exit
 * - Content: Fades out and moves up as user scrolls (cinematic exit)
 */
@Component({
  selector: 'ptah-hero',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    HeroContentOverlayComponent,
    HeroFloatingImagesComponent,
    ScrollAnimationDirective,
  ],
  template: `
    <section class="relative min-h-screen overflow-hidden bg-slate-950">
      <!-- Layer 1: Hieroglyph Circuit Pattern with Scroll Parallax (z-0) -->
      <div
        scrollAnimation
        [scrollConfig]="backgroundParallaxConfig"
        class="absolute inset-0 w-full h-[130%] -top-[15%] z-0"
        style="
          background-image: url('/assets/backgrounds/hieroglyph-circuit-pattern.png');
          background-repeat: repeat;
          background-size: 400px 400px;
        "
        aria-hidden="true"
      ></div>

      <!-- Layer 2: Dark Overlay for readability (z-1) -->
      <div
        class="absolute inset-0 z-[1] bg-gradient-to-b from-slate-950/70 via-slate-900/75 to-slate-950/80"
        aria-hidden="true"
      ></div>

      <!-- Layer 3: Cinematic Vignette with Scroll Intensity (z-2) -->
      <div
        scrollAnimation
        [scrollConfig]="vignetteScrollConfig"
        class="vignette-container absolute inset-0 z-[2] pointer-events-none"
        aria-hidden="true"
      >
        <!-- Top-left corner -->
        <div
          class="absolute top-0 left-0 w-1/2 h-1/2 bg-gradient-to-br from-black/80 via-black/40 to-transparent"
        ></div>
        <!-- Top-right corner -->
        <div
          class="absolute top-0 right-0 w-1/2 h-1/2 bg-gradient-to-bl from-black/80 via-black/40 to-transparent"
        ></div>
        <!-- Bottom-left corner -->
        <div
          class="absolute bottom-0 left-0 w-1/2 h-1/2 bg-gradient-to-tr from-black/80 via-black/40 to-transparent"
        ></div>
        <!-- Bottom-right corner -->
        <div
          class="absolute bottom-0 right-0 w-1/2 h-1/2 bg-gradient-to-tl from-black/80 via-black/40 to-transparent"
        ></div>
      </div>

      <!-- Layer 4: Floating Egyptian Symbols with Mouse + Scroll Parallax (z-3) -->
      <ptah-hero-floating-images class="z-[3]" />

      <!-- Layer 5: Content Overlay with Scroll Fade-Out (z-10) -->
      <ptah-hero-content-overlay class="relative z-10" />
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
   * Background parallax - moves at 30% scroll speed for depth effect
   * Creates the illusion of distance
   */
  readonly backgroundParallaxConfig: ScrollAnimationConfig = {
    animation: 'parallax',
    speed: 0.3,
    scrub: 1.5,
  };

  /**
   * Vignette intensity increases on scroll for dramatic effect
   * Opacity goes from 1 to 1.3 (slightly stronger) as user scrolls
   */
  readonly vignetteScrollConfig: ScrollAnimationConfig = {
    animation: 'custom',
    start: 'top top',
    end: 'bottom 60%',
    scrub: 1,
    from: { opacity: 1 },
    to: { opacity: 1.4 },
  };
}
