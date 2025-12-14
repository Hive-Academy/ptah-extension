import {
  Component,
  ChangeDetectionStrategy,
  viewChild,
  ElementRef,
  inject,
  DestroyRef,
  afterNextRender,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

// Register ScrollTrigger plugin
gsap.registerPlugin(ScrollTrigger);

/**
 * CTA Section Component
 *
 * Purpose: Final call-to-action section with enhanced typography and golden divider
 *
 * Tasks 3.3 & 3.4 Enhancements:
 * - Text-7xl headline with gradient-text-gold class
 * - Large CTA button with pulse-ring animation
 * - Golden divider with GSAP draw animation on scroll
 * - Content from landing-page-copy.md applied
 *
 * Complexity Level: 2 (Medium)
 * - GSAP animation logic with lifecycle management
 * - Composition of CTA elements and footer
 * - Accessibility: Reduced motion support
 *
 * Patterns Applied:
 * - Standalone component with OnPush (performance)
 * - afterNextRender() for safe client-side initialization
 * - gsap.context() for scoped animations with cleanup
 * - DestroyRef.onDestroy() for resource management
 */
@Component({
  selector: 'ptah-cta-section',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section #sectionRef id="cta" class="py-32 bg-base-100">
      <div class="container mx-auto px-6 text-center">
        <!-- Headline with gold gradient (Task 3.3) -->
        <h2 class="text-7xl font-display font-bold mb-6 gradient-text-gold">
          Ready to Build Smarter?
        </h2>

        <!-- Subheadline from landing-page-copy.md -->
        <p class="text-xl text-base-content/70 mb-12 max-w-2xl mx-auto">
          Free to install. No configuration needed. Works with your existing
          Claude Code setup.
        </p>

        <!-- CTA Button with pulse animation (Task 3.3) -->
        <a
          href="https://marketplace.visualstudio.com/items?itemName=anthropic.claude-code"
          target="_blank"
          rel="noopener noreferrer"
          class="cta-button inline-block px-12 py-6 text-xl font-bold rounded-xl
                  bg-gradient-to-r from-secondary to-accent
                  text-base-100 shadow-glow-gold
                  hover:scale-105 hover:shadow-glow-gold-lg
                  transition-all duration-300 animate-pulse-ring"
          aria-label="Install Ptah Extension from VS Code Marketplace"
        >
          Install Ptah Extension
        </a>

        <!-- Secondary link -->
        <div class="mt-8">
          <a
            href="#"
            class="text-secondary hover:text-accent transition-colors"
            aria-label="Read the documentation"
          >
            Read the Documentation →
          </a>
        </div>

        <!-- Golden Divider with draw animation (Task 3.4) -->
        <div class="divider-container overflow-hidden mt-16 mb-8">
          <div
            class="golden-divider h-[2px] w-full bg-gradient-to-r from-transparent via-secondary to-transparent transform scale-x-0 origin-center"
          ></div>
        </div>

        <!-- Footer -->
        <footer class="pt-8" role="contentinfo">
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
              href="https://marketplace.visualstudio.com/items?itemName=anthropic.claude-code"
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
              <span class="text-xl">🐦</span>
            </a>
            <a
              href="#"
              class="text-base-content/70 hover:text-secondary transition-colors"
              aria-label="Discord"
            >
              <span class="text-xl">💬</span>
            </a>
            <a
              href="https://github.com/anthropics/claude-code"
              target="_blank"
              rel="noopener noreferrer"
              class="text-base-content/70 hover:text-secondary transition-colors"
              aria-label="GitHub"
            >
              <span class="text-xl">🔗</span>
            </a>
          </div>

          <!-- Legal -->
          <div class="text-center text-sm text-base-content/50">
            <p>
              © 2025 Ptah Extension |
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
  private readonly sectionRef = viewChild.required<ElementRef>('sectionRef');
  private readonly destroyRef = inject(DestroyRef);
  private gsapContext?: gsap.Context;

  constructor() {
    // Initialize animations after render (client-side only)
    afterNextRender(() => {
      this.initAnimations();
    });
  }

  /**
   * Initialize GSAP golden divider draw animation
   *
   * Task 3.4: Golden Divider Draw Animation
   * - Divider scales from 0 to full width on scroll-in
   * - Triggers at 85% viewport entry
   *
   * Accessibility: Respects prefers-reduced-motion media query
   */
  private initAnimations(): void {
    // Check if user prefers reduced motion - skip all animations
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }

    // Create GSAP context scoped to this section for automatic cleanup
    this.gsapContext = gsap.context(() => {
      // Golden divider draw animation
      gsap.from('.golden-divider', {
        scaleX: 0,
        duration: 1.5,
        ease: 'power2.out',
        scrollTrigger: {
          trigger: '.divider-container',
          start: 'top 85%',
          toggleActions: 'play none none reverse',
        },
      });
    }, this.sectionRef().nativeElement);

    // Register cleanup on component destroy
    this.destroyRef.onDestroy(() => {
      ScrollTrigger.getAll().forEach((trigger) => trigger.kill());
      this.gsapContext?.revert();
    });
  }
}
