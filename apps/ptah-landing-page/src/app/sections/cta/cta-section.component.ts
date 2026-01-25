import { Component, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
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
 * - Golden gradient headline "Get Started Free" with scaleIn animation
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
  imports: [CommonModule, ViewportAnimationDirective, LucideAngularModule],
  template: `
    <section id="cta" class="py-32 bg-base-100">
      <div class="container mx-auto px-6 text-center">
        <!-- Headline with gold gradient and scaleIn animation -->
        <h2
          viewportAnimation
          [viewportConfig]="headlineConfig"
          class="text-7xl font-display font-bold mb-6 gradient-text-gold"
        >
          Get Started Free
        </h2>

        <!-- Subheadline with fadeIn animation -->
        <p
          viewportAnimation
          [viewportConfig]="subheadlineConfig"
          class="text-xl text-base-content/70 mb-12 max-w-2xl mx-auto"
        >
          Free to install. No configuration needed. Works with your existing
          Claude Code setup.
        </p>

        <!-- Primary CTA Button with pulse animation via CSS keyframes -->
        <div viewportAnimation [viewportConfig]="primaryCtaConfig">
          <a
            href="https://marketplace.visualstudio.com/items?itemName=ptah.ptah"
            target="_blank"
            rel="noopener noreferrer"
            class="cta-button inline-block px-12 py-6 text-xl font-bold rounded-xl
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
            href="#"
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
        <div class="mt-12 flex flex-wrap justify-center gap-8">
          @for (signal of trustSignals; track signal; let i = $index) {
          <div
            viewportAnimation
            [viewportConfig]="getTrustSignalConfig(i)"
            class="flex items-center gap-2 text-base-content/60"
          >
            <lucide-angular
              [img]="CheckIcon"
              class="w-5 h-5 text-success"
            />
            <span class="text-sm font-medium">{{ signal }}</span>
          </div>
          }
        </div>

        <!-- Golden Divider with scaleX animation -->
        <div
          viewportAnimation
          [viewportConfig]="dividerConfig"
          class="overflow-hidden mt-16 mb-8"
        >
          <div
            class="h-[2px] w-full bg-gradient-to-r from-transparent via-secondary to-transparent"
          ></div>
        </div>

        <!-- Footer with fadeIn animation -->
        <footer
          viewportAnimation
          [viewportConfig]="footerConfig"
          class="pt-8"
          role="contentinfo"
        >
          <!-- Brand -->
          <div class="mb-8">
            <h3 class="text-2xl font-display font-bold text-secondary mb-2">
              Ptah
            </h3>
            <p class="text-base-content/60">Craftsman of AI Development</p>
          </div>

          <!-- Navigation Links -->
          <nav
            class="flex flex-wrap justify-center gap-6 mb-8"
            aria-label="Footer navigation"
          >
            <a
              href="#"
              class="text-base-content/70 hover:text-secondary transition-colors"
              aria-label="View documentation"
            >
              Documentation
            </a>
            <a
              href="https://github.com/anthropics/claude-code"
              target="_blank"
              rel="noopener noreferrer"
              class="text-base-content/70 hover:text-secondary transition-colors"
              aria-label="Visit GitHub repository"
            >
              GitHub
            </a>
            <a
              href="https://marketplace.visualstudio.com/items?itemName=ptah.ptah"
              target="_blank"
              rel="noopener noreferrer"
              class="text-base-content/70 hover:text-secondary transition-colors"
              aria-label="Visit VS Code Marketplace"
            >
              Marketplace
            </a>
            <a
              href="#"
              class="text-base-content/70 hover:text-secondary transition-colors"
              aria-label="Join community"
            >
              Community
            </a>
          </nav>

          <!-- Social Links -->
          <div class="flex justify-center gap-4 mb-8">
            <a
              href="#"
              class="text-base-content/70 hover:text-secondary transition-colors"
              aria-label="Twitter"
            >
              <span class="text-xl">X</span>
            </a>
            <a
              href="#"
              class="text-base-content/70 hover:text-secondary transition-colors"
              aria-label="Discord"
            >
              <span class="text-xl">Discord</span>
            </a>
            <a
              href="https://github.com/anthropics/claude-code"
              target="_blank"
              rel="noopener noreferrer"
              class="text-base-content/70 hover:text-secondary transition-colors"
              aria-label="GitHub"
            >
              <span class="text-xl">GitHub</span>
            </a>
          </div>

          <!-- Legal -->
          <div class="text-center text-sm text-base-content/50">
            <p>
              2025 Ptah Extension |
              <a href="#" class="hover:text-secondary transition-colors"
                >MIT License</a
              >
              |
              <a href="#" class="hover:text-secondary transition-colors"
                >Privacy</a
              >
              |
              <a href="#" class="hover:text-secondary transition-colors"
                >Terms</a
              >
            </p>
          </div>
        </footer>
      </div>
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CTASectionComponent {
  /** Lucide icon reference */
  readonly CheckIcon = Check;

  /**
   * Trust signals displayed with staggered fadeIn animations
   */
  public readonly trustSignals = [
    'Free Forever',
    'No Account Required',
    'Open Source',
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
   * Divider animation config - custom scaleX animation
   */
  public readonly dividerConfig: ViewportAnimationConfig = {
    animation: 'custom',
    duration: 1.2,
    delay: 0.4,
    threshold: 0.2,
    from: { scaleX: 0, transformOrigin: 'center' },
    to: { scaleX: 1 },
  };

  /**
   * Footer animation config - fadeIn
   */
  public readonly footerConfig: ViewportAnimationConfig = {
    animation: 'fadeIn',
    duration: 0.8,
    delay: 0.5,
    threshold: 0.1,
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
