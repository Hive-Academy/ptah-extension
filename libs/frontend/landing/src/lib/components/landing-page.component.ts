/**
 * Landing Page Component - Main Orchestrator
 *
 * This component orchestrates all landing page sections and initializes
 * Lenis smooth scroll. It is the main entry point for the landing view
 * in app-shell.
 *
 * Sections:
 * - HeroSection: 3D Glass/Cosmic scene with content overlay
 * - DemoSection: Glassmorphism window with code example
 * - FeaturesHijackedScroll: Fullscreen feature slides
 * - ComparisonSplitScroll: Before/After parallax comparison
 * - CtaSection: Final call-to-action with golden gradient
 */
import {
  Component,
  ChangeDetectionStrategy,
  inject,
  OnDestroy,
  afterNextRender,
} from '@angular/core';

@Component({
  selector: 'ptah-landing-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [],
  template: `
    <div class="min-h-screen bg-slate-950">
      <!-- Landing page sections will be added in Batch 2-6 -->
      <div class="flex items-center justify-center min-h-screen">
        <div class="text-center text-white">
          <h1 class="text-4xl font-bold mb-4">Ptah Landing Page</h1>
          <p class="text-gray-400">Premium sections loading in next batches...</p>
        </div>
      </div>
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
  constructor() {
    // Lenis initialization will be added after @hive-academy/angular-gsap is available
    afterNextRender(() => {
      // Initialize Lenis smooth scroll here when package is installed
    });
  }

  ngOnDestroy(): void {
    // Cleanup Lenis when component is destroyed
  }
}
