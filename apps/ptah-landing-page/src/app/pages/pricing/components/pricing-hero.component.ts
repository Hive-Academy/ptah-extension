import { Component, ChangeDetectionStrategy } from '@angular/core';
import {
  ViewportAnimationDirective,
  ViewportAnimationConfig,
} from '@hive-academy/angular-gsap';
import { LucideAngularModule, DollarSign } from 'lucide-angular';

/**
 * PricingHeroComponent - Premium pricing page hero section
 *
 * Design inspired by modern SaaS pricing pages with:
 * - Dramatic gradient background with Egyptian pyramid imagery
 * - Promotional headline with handwritten-style accent
 * - Animated content reveal
 *
 * Evidence: Redesign based on reference design with Ptah Egyptian theme
 */
@Component({
  selector: 'ptah-pricing-hero',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ViewportAnimationDirective, LucideAngularModule],
  template: `
    <section
      class="relative min-h-[80vh] flex items-center justify-center overflow-hidden"
    >
      <!-- Background Layers -->
      <div class="absolute inset-0 z-0">
        <!-- Base gradient -->
        <div
          class="absolute inset-0 bg-gradient-to-b from-base-100 via-base-100/95 to-base-100"
        ></div>

        <!-- Pyramid Background Image (static - parallax removed to prevent flickering) -->
        <div
          class="absolute inset-0 opacity-80 will-change-transform backface-hidden"
          style="background-image: url('/assets/backgrounds/pyramid_energy_apex.png');
                 background-size: cover;
                 background-position: center;
                 background-repeat: no-repeat;"
        ></div>

        <!-- Radial glow from center -->
        <div
          class="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(212,175,55,0.15)_0%,transparent_70%)]"
        ></div>

        <!-- Bottom fade to base -->
        <div
          class="absolute bottom-0 left-0 right-0 h-40 bg-gradient-to-t from-base-100 to-transparent"
        ></div>
      </div>

      <!-- Content -->
      <div
        class="relative z-10 text-center px-4 sm:px-6 py-16 sm:py-20 max-w-5xl mx-auto"
      >
        <!-- Text backdrop for readability -->
        <!-- <div
          class="absolute inset-0 -top-10 bg-gradient-to-b from-black/60 via-black/40 to-transparent
                 rounded-3xl backdrop-blur-[2px] -z-10"
        ></div> -->

        <!-- Main Headline with 3D effect -->
        <h1
          viewportAnimation
          [viewportConfig]="headlineConfig"
          class="text-4xl md:text-5xl lg:text-6xl font-bold text-white mb-2 leading-tight
                 [text-shadow:_0_2px_0_#1a1a1a,_0_4px_0_#0d0d0d,_0_6px_10px_rgba(0,0,0,0.8),_0_10px_40px_rgba(0,0,0,0.6)]"
        >
          Try
          <span
            class="bg-gradient-to-r from-amber-300 via-amber-400 to-secondary
                   bg-clip-text text-transparent
                   [filter:_drop-shadow(0_2px_0_#8a6d10)_drop-shadow(0_4px_8px_rgba(0,0,0,0.8))]"
          >
            14 days free
          </span>
          today
        </h1>

        <!-- Promotional Line with 3D Handwritten Style -->
        <div
          viewportAnimation
          [viewportConfig]="promoConfig"
          class="flex flex-wrap items-center justify-center gap-2 sm:gap-3 mb-6"
        >
          <span
            class="text-xl sm:text-2xl md:text-3xl lg:text-4xl text-white
                   [text-shadow:_0_2px_0_#1a1a1a,_0_4px_8px_rgba(0,0,0,0.7)]"
          >
            then
          </span>
          <span
            class="font-display text-2xl sm:text-3xl md:text-4xl lg:text-5xl italic p-1
                   bg-gradient-to-r from-amber-300 to-secondary bg-clip-text text-transparent
                   [filter:_drop-shadow(0_2px_0_#6b5510)_drop-shadow(0_4px_4px_rgba(0,0,0,0.8))_drop-shadow(0_0_30px_rgba(212,175,55,0.5))]"
          >
            only $5
          </span>
          <span
            class="text-xl sm:text-2xl md:text-3xl lg:text-4xl text-white
                   [text-shadow:_0_2px_0_#1a1a1a,_0_4px_8px_rgba(0,0,0,0.7)]"
          >
            per month
          </span>
        </div>

        <!-- Subtitle with improved visibility -->
        <p
          viewportAnimation
          [viewportConfig]="subtitleConfig"
          class="text-lg md:text-xl text-white/80 mb-10 max-w-2xl mx-auto
                 [text-shadow:_0_2px_4px_rgba(0,0,0,0.8),_0_4px_12px_rgba(0,0,0,0.5)]"
        >
          Beautiful visual interface for AI-assisted coding — switch plans as
          your needs grow.
        </p>

        <!-- Pricing Plans Label -->
        <div
          viewportAnimation
          [viewportConfig]="labelConfig"
          class="flex items-center justify-center gap-3 text-white/70
                 [text-shadow:_0_2px_4px_rgba(0,0,0,0.6)]"
        >
          <div
            class="w-4 h-4 rounded bg-base-content/10 flex items-center justify-center"
          >
            <lucide-angular [img]="DollarSignIcon" class="w-3 h-3" />
          </div>
          <span class="text-sm font-medium tracking-wide uppercase">
            Pricing & Plans
          </span>
        </div>
      </div>

      <!-- Decorative floating elements -->
      <div
        class="absolute top-20 left-10 w-2 h-2 bg-amber-400/40 rounded-full animate-pulse"
        aria-hidden="true"
      ></div>
      <div
        class="absolute top-40 right-20 w-3 h-3 bg-secondary/30 rounded-full animate-pulse"
        style="animation-delay: 300ms"
        aria-hidden="true"
      ></div>
      <div
        class="absolute bottom-40 left-1/4 w-1.5 h-1.5 bg-amber-300/50 rounded-full animate-pulse"
        style="animation-delay: 700ms"
        aria-hidden="true"
      ></div>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
        contain: layout style;
        backface-visibility: hidden;
      }

      .backface-hidden {
        backface-visibility: hidden;
        -webkit-backface-visibility: hidden;
      }
    `,
  ],
})
export class PricingHeroComponent {
  // Lucide icon reference
  protected readonly DollarSignIcon = DollarSign;

  public readonly headlineConfig: ViewportAnimationConfig = {
    animation: 'slideUp',
    duration: 0.8,
    threshold: 0.1,
    ease: 'power2.out',
  };

  public readonly promoConfig: ViewportAnimationConfig = {
    animation: 'slideUp',
    duration: 0.8,
    delay: 0.1,
    threshold: 0.1,
    ease: 'power2.out',
  };

  public readonly subtitleConfig: ViewportAnimationConfig = {
    animation: 'fadeIn',
    duration: 0.6,
    delay: 0.2,
    threshold: 0.1,
  };

  public readonly labelConfig: ViewportAnimationConfig = {
    animation: 'fadeIn',
    duration: 0.5,
    delay: 0.3,
    threshold: 0.1,
  };
}
