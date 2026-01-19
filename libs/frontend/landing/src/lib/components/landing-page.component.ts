/**
 * Landing Page Component - Main Orchestrator
 *
 * This component orchestrates all landing page sections and initializes
 * Lenis smooth scroll. It is the main entry point for the landing view
 * in app-shell.
 *
 * Sections (in order):
 * - HeroSection: 3D Glass/Cosmic scene with content overlay
 * - DemoSection: Glassmorphism window with code example (Batch 3)
 * - FeaturesHijackedScroll: Fullscreen feature slides (Batch 4)
 * - ComparisonSplitScroll: Before/After parallax comparison (Batch 5)
 * - CtaSection: Final call-to-action with golden gradient (Batch 6)
 *
 * NOTE: Sections are added incrementally as batches are completed.
 * Currently includes: HeroSection (Batch 2)
 */
import {
  Component,
  ChangeDetectionStrategy,
  inject,
  OnDestroy,
  afterNextRender,
} from '@angular/core';
import { LenisSmoothScrollService } from '@hive-academy/angular-gsap';
import { HeroSectionComponent } from './hero-section/hero-section.component';

@Component({
  selector: 'ptah-landing-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HeroSectionComponent],
  template: `
    <div class="min-h-screen bg-slate-950">
      <!-- Hero Section (Batch 2) -->
      <ptah-hero-section />

      <!-- Placeholder for Demo Section (Batch 3) -->
      <!-- <ptah-demo-section /> -->

      <!-- Placeholder for Features Hijacked Scroll (Batch 4) -->
      <!-- <ptah-features-hijacked-scroll /> -->

      <!-- Placeholder for Comparison Split Scroll (Batch 5) -->
      <!-- <ptah-comparison-split-scroll /> -->

      <!-- Placeholder for CTA Section (Batch 6) -->
      <!-- <ptah-cta-section /> -->
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
        min-height: 100%;
      }
    `,
  ],
})
export class LandingPageComponent implements OnDestroy {
  /**
   * Lenis smooth scroll service for butter-smooth scrolling.
   * Injected and initialized after first render.
   */
  private readonly lenis = inject(LenisSmoothScrollService);

  constructor() {
    // Initialize Lenis smooth scroll after the first render
    // This ensures the DOM is fully ready before Lenis attaches
    afterNextRender(() => {
      if (!this.lenis.isInitialized()) {
        this.lenis.initialize();
      }
    });
  }

  ngOnDestroy(): void {
    // Clean up Lenis when landing page is destroyed
    // This prevents memory leaks and ensures proper cleanup
    // when navigating away from the landing page
    this.lenis.destroy();
  }
}
