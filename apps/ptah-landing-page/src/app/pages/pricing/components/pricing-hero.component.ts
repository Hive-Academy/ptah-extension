import { Component, ChangeDetectionStrategy } from '@angular/core';
import {
  ViewportAnimationDirective,
  ViewportAnimationConfig,
} from '@hive-academy/angular-gsap';

/**
 * PricingHeroComponent - Pricing page hero section
 *
 * Gradient gold headline with viewport animation.
 * Uses Tailwind utilities for layout and DaisyUI theme colors.
 *
 * Evidence: implementation-plan.md Phase 2 - PricingHeroComponent
 */
@Component({
  selector: 'ptah-pricing-hero',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ViewportAnimationDirective],
  template: `
    <section class="relative py-24 md:py-32 px-6 overflow-hidden text-center">
      <!-- Background Pattern -->
      <div
        class="absolute inset-0 z-0 opacity-15 bg-cover bg-center"
        style="background-image: url('/assets/images/license-system/pricing_hero_pattern.png')"
        aria-hidden="true"
      ></div>

      <!-- Content -->
      <div class="relative z-10 max-w-3xl mx-auto">
        <h1
          viewportAnimation
          [viewportConfig]="titleConfig"
          class="font-display text-5xl md:text-6xl lg:text-7xl font-bold mb-4 
                 bg-gradient-to-r from-amber-300 to-secondary bg-clip-text text-transparent"
        >
          Choose Your Plan
        </h1>
        <p
          viewportAnimation
          [viewportConfig]="subtitleConfig"
          class="text-lg md:text-xl text-neutral-content"
        >
          Premium features for modern development
        </p>
      </div>
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
export class PricingHeroComponent {
  public readonly titleConfig: ViewportAnimationConfig = {
    animation: 'slideUp',
    duration: 0.8,
    threshold: 0.1,
    ease: 'power2.out',
  };

  public readonly subtitleConfig: ViewportAnimationConfig = {
    animation: 'fadeIn',
    duration: 0.6,
    delay: 0.2,
    threshold: 0.1,
  };
}
