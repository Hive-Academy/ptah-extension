import {
  Component,
  ChangeDetectionStrategy,
  ElementRef,
  viewChild,
  inject,
  afterNextRender,
  DestroyRef,
  CUSTOM_ELEMENTS_SCHEMA,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import gsap from 'gsap';

/**
 * Hero Section Component (Layout Only)
 *
 * Purpose: First impression section with headline, tagline, and CTAs.
 * This is the layout structure WITHOUT Three.js (Task 7 will add that).
 *
 * Design Specs (visual-design-specification.md:322-419):
 * - Full viewport height (100vh)
 * - Headline: "Ptah Extension" (Cinzel font, text-accent with golden glow)
 * - Tagline: "Ancient Wisdom for Modern AI"
 * - Subtext: "Enhance Claude Code with Egyptian-themed power-ups"
 * - CTAs: Primary (Install) + Secondary (View Demo)
 * - Scroll indicator at bottom
 *
 * Complexity Level: 2 (Medium)
 * - GSAP animation logic with lifecycle management
 * - Composition of content sections
 * - Accessibility: Reduced motion support
 *
 * Patterns Applied:
 * - Standalone component with OnPush (performance)
 * - afterNextRender() for safe client-side initialization
 * - gsap.context() for scoped animations with cleanup
 * - DestroyRef.onDestroy() for resource management
 */
@Component({
  selector: 'ptah-hero-section',
  standalone: true,
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <section
      #sectionRef
      class="relative min-h-screen flex items-center justify-center bg-base-100 overflow-hidden"
    >
      <!-- Gradient Background (placeholder for Three.js) -->
      <div class="absolute inset-0 z-0">
        <div
          class="absolute inset-0 bg-gradient-to-b from-secondary/10 via-transparent to-transparent"
        ></div>
        <div
          class="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-primary/20 via-transparent to-transparent"
        ></div>
      </div>

      <!-- Content -->
      <div class="relative z-10 container mx-auto px-6 text-center">
        <!-- Headline -->
        <h1
          class="hero-headline font-display font-bold text-5xl md:text-6xl lg:text-7xl text-accent mb-6"
          style="text-shadow: 0 0 40px rgba(251, 191, 36, 0.5);"
        >
          Ptah Extension
        </h1>

        <!-- Tagline -->
        <p
          class="hero-tagline text-xl md:text-2xl text-base-content/80 mb-4 font-medium"
        >
          Ancient Wisdom for Modern AI
        </p>

        <!-- Subtext -->
        <p
          class="hero-subtext text-base text-base-content/60 mb-12 max-w-2xl mx-auto"
        >
          Enhance Claude Code with Egyptian-themed power-ups for your VS Code
          experience
        </p>

        <!-- CTA Buttons -->
        <div
          class="hero-ctas flex flex-col sm:flex-row gap-4 justify-center"
        >
          <!-- Primary CTA: Install Now -->
          <a
            href="https://marketplace.visualstudio.com/items?itemName=anthropic.claude-code"
            target="_blank"
            rel="noopener noreferrer"
            class="bg-gradient-to-r from-secondary to-accent text-secondary-content px-8 py-4 rounded-xl text-lg font-semibold shadow-[0_0_40px_rgba(212,175,55,0.4)] hover:scale-105 hover:shadow-[0_0_60px_rgba(212,175,55,0.5)] transition-all"
            aria-label="Install Ptah Extension from VS Code Marketplace"
          >
            ⬇ Install Now
          </a>

          <!-- Secondary CTA: View Demo -->
          <a
            href="#demo"
            class="border-2 border-secondary/50 text-base-content px-8 py-4 rounded-xl text-lg font-medium hover:border-accent hover:bg-secondary/10 transition-all"
            aria-label="Scroll to view demo section"
          >
            View Demo ↓
          </a>
        </div>
      </div>

      <!-- Scroll Indicator -->
      <div
        class="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce opacity-60"
        aria-hidden="true"
      >
        <svg
          class="w-6 h-6 text-accent"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M19 14l-7 7m0 0l-7-7m7 7V3"
          ></path>
        </svg>
      </div>
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HeroSectionComponent {
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
   * Initialize GSAP entrance animations with reduced-motion support
   *
   * Animation Sequence:
   * 1. Headline fades in from below (y: 30 → 0, duration: 0.8s)
   * 2. Tagline fades in (y: 20 → 0, duration: 0.6s, offset: -0.4s)
   * 3. Subtext fades in (y: 20 → 0, duration: 0.6s, offset: -0.3s)
   * 4. CTAs fade in (y: 20 → 0, duration: 0.6s, offset: -0.3s)
   *
   * Accessibility: Respects prefers-reduced-motion media query
   */
  private initAnimations(): void {
    // Check if user prefers reduced motion
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      // Skip animations, set elements to final state immediately
      gsap.set('.hero-headline, .hero-tagline, .hero-subtext, .hero-ctas', {
        opacity: 1,
        y: 0,
      });
      return;
    }

    // Create GSAP context scoped to this section for automatic cleanup
    this.gsapContext = gsap.context(() => {
      const tl = gsap.timeline();

      // Staggered entrance animation
      tl.from('.hero-headline', {
        y: 30,
        opacity: 0,
        duration: 0.8,
        ease: 'power3.out',
      })
        .from(
          '.hero-tagline',
          {
            y: 20,
            opacity: 0,
            duration: 0.6,
          },
          '-=0.4'
        ) // Overlap by 0.4s
        .from(
          '.hero-subtext',
          {
            y: 20,
            opacity: 0,
            duration: 0.6,
          },
          '-=0.3'
        ) // Overlap by 0.3s
        .from(
          '.hero-ctas',
          {
            y: 20,
            opacity: 0,
            duration: 0.6,
          },
          '-=0.3'
        ); // Overlap by 0.3s
    }, this.sectionRef().nativeElement);

    // Register cleanup on component destroy
    this.destroyRef.onDestroy(() => {
      this.gsapContext?.revert();
    });
  }
}
