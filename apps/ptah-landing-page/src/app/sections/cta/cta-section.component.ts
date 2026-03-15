import { Component, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { LucideAngularModule, Check } from 'lucide-angular';
import {
  ViewportAnimationDirective,
  ViewportAnimationConfig,
} from '@hive-academy/angular-gsap';

/**
 * CTA Section Component
 *
 * Purpose: Final call-to-action section with enhanced typography and golden divider
 *
 * Batch 5 Enhancements (Task 5.1):
 * - Golden gradient headline "Start Your Free Trial" with scaleIn animation
 * - Primary CTA with pulse animation (CSS keyframes)
 * - Secondary CTAs with fadeIn animation
 * - Trust signals with staggered fadeIn animations
 * - All animations via @hive-academy/angular-gsap ViewportAnimationDirective
 *
 * Complexity Level: 2 (Medium)
 * - ViewportAnimationDirective for scroll-triggered entrance animations
 * - Composition of CTA elements and footer
 * - Accessibility: Reduced motion support via library defaults
 *
 * Patterns Applied:
 * - Standalone component with OnPush (performance)
 * - Declarative animations via ViewportAnimationDirective
 * - No raw GSAP code - all via @hive-academy library
 */
@Component({
  selector: 'ptah-cta-section',
  imports: [
    CommonModule,
    RouterLink,
    ViewportAnimationDirective,
    LucideAngularModule,
  ],
  template: `
    <section id="cta" class="py-16 sm:py-24 md:py-32 bg-base-100">
      <div class="container mx-auto px-4 sm:px-6 text-center">
        <!-- Headline with gold gradient and scaleIn animation -->
        <h2
          viewportAnimation
          [viewportConfig]="headlineConfig"
          class="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-display font-bold mb-6 gradient-text-gold"
        >
          Start Your Free Trial
        </h2>

        <!-- Subheadline with fadeIn animation -->
        <p
          viewportAnimation
          [viewportConfig]="subheadlineConfig"
          class="text-base sm:text-lg md:text-xl text-base-content/70 mb-8 sm:mb-10 md:mb-12 max-w-2xl mx-auto"
        >
          14 days free. No credit card required. Works with OpenAI, Claude,
          GitHub Copilot, and more.
        </p>

        <!-- Primary CTA Button with pulse animation via CSS keyframes -->
        <div viewportAnimation [viewportConfig]="primaryCtaConfig">
          <a
            href="https://marketplace.visualstudio.com/items?itemName=ptah.ptah"
            target="_blank"
            rel="noopener noreferrer"
            class="cta-button inline-block px-8 py-4 text-base sm:px-10 sm:py-5 sm:text-lg md:px-12 md:py-6 md:text-xl font-bold rounded-xl
                    bg-gradient-to-r from-secondary to-accent
                    text-base-100 shadow-glow-gold
                    hover:scale-105 hover:shadow-glow-gold-lg
                    transition-all duration-300 animate-pulse-ring"
            aria-label="Install Ptah Extension from VS Code Marketplace"
          >
            Install from VS Code Marketplace
          </a>
        </div>

        <!-- Secondary CTAs with fadeIn animation -->
        <div
          viewportAnimation
          [viewportConfig]="secondaryCtasConfig"
          class="mt-8 flex flex-wrap justify-center gap-6"
        >
          <a
            routerLink="/docs"
            class="text-secondary hover:text-accent transition-colors font-medium"
            aria-label="Read the documentation"
          >
            Read the Docs
          </a>
          <a
            href="#demo"
            class="text-secondary hover:text-accent transition-colors font-medium"
            aria-label="Watch product demo"
          >
            Watch Demo
          </a>
        </div>

        <!-- Trust Signals with staggered fadeIn -->
        <div
          class="mt-8 sm:mt-10 md:mt-12 flex flex-wrap justify-center gap-4 sm:gap-6 md:gap-8"
        >
          @for (signal of trustSignals; track signal; let i = $index) {
          <div
            viewportAnimation
            [viewportConfig]="getTrustSignalConfig(i)"
            class="flex items-center gap-2 text-base-content/60"
          >
            <lucide-angular
              [img]="CheckIcon"
              class="w-5 h-5 text-success"
              aria-hidden="true"
            />
            <span class="text-sm font-medium">{{ signal }}</span>
          </div>
          }
        </div>
      </div>
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CTASectionComponent {
  /** Lucide icon reference */
  public readonly CheckIcon = Check;

  /**
   * Trust signals displayed with staggered fadeIn animations
   */
  public readonly trustSignals = [
    '14-Day Free Trial',
    'No Credit Card Required',
    'Cancel Anytime',
  ];

  /**
   * Headline animation config - scaleIn for dramatic entrance
   */
  public readonly headlineConfig: ViewportAnimationConfig = {
    animation: 'scaleIn',
    duration: 0.8,
    threshold: 0.2,
  };

  /**
   * Subheadline animation config - fadeIn with slight delay
   */
  public readonly subheadlineConfig: ViewportAnimationConfig = {
    animation: 'fadeIn',
    duration: 0.8,
    delay: 0.1,
    threshold: 0.2,
  };

  /**
   * Primary CTA animation config - slideUp with bounce
   */
  public readonly primaryCtaConfig: ViewportAnimationConfig = {
    animation: 'slideUp',
    duration: 0.6,
    delay: 0.2,
    ease: 'back.out(1.7)',
    threshold: 0.2,
  };

  /**
   * Secondary CTAs animation config - fadeIn
   */
  public readonly secondaryCtasConfig: ViewportAnimationConfig = {
    animation: 'fadeIn',
    duration: 0.6,
    delay: 0.3,
    threshold: 0.2,
  };

  /**
   * Get trust signal animation config with staggered delay
   * @param index Position in the trust signals array
   * @returns ViewportAnimationConfig with calculated delay
   */
  public getTrustSignalConfig(index: number): ViewportAnimationConfig {
    return {
      animation: 'fadeIn',
      duration: 0.5,
      delay: 0.35 + index * 0.1,
      threshold: 0.2,
    };
  }
}
