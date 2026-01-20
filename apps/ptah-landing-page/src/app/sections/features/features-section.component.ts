import { Component, ChangeDetectionStrategy } from '@angular/core';
import { FeaturesHijackedScrollComponent } from './features-hijacked-scroll.component';

/**
 * FeaturesSectionComponent - Features section wrapper
 *
 * Complexity Level: 1 (Simple wrapper)
 * Patterns: Composition, Single Responsibility
 *
 * Purpose:
 * - Simple wrapper for FeaturesHijackedScrollComponent
 * - Maintains section id="features" for anchor link navigation
 * - Delegates all scroll behavior to child component
 *
 * Previous Implementation:
 * - Feature cards in grid layout with GSAP ScrollTrigger
 * - Replaced with fullscreen hijacked scroll timeline for premium feel
 *
 * SOLID Principles:
 * - Single Responsibility: Section wrapper with anchor link support
 * - Composition: Delegates to FeaturesHijackedScrollComponent
 * - Open/Closed: Add section-level features without modifying scroll logic
 */
@Component({
  selector: 'ptah-features-section',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FeaturesHijackedScrollComponent],
  template: `
    <section id="features" class="relative" aria-label="Features">
      <ptah-features-hijacked-scroll />
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
export class FeaturesSectionComponent {}
