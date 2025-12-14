import {
  Component,
  ChangeDetectionStrategy,
  ElementRef,
  viewChild,
  inject,
  afterNextRender,
  DestroyRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { HeroSceneComponent } from './hero-scene.component';

// Register ScrollTrigger plugin
gsap.registerPlugin(ScrollTrigger);

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
  imports: [CommonModule, HeroSceneComponent],
  template: `
    <section
      #sectionRef
      class="relative min-h-screen flex items-center justify-center bg-base-100 overflow-hidden"
    >
      <!-- Three.js Egyptian Scene Background -->
      <app-hero-scene class="absolute inset-0 z-0" />

      <!-- Gradient Overlay for text readability -->
      <div class="absolute inset-0 z-[1] pointer-events-none">
        <div
          class="absolute inset-0 bg-gradient-to-b from-base-100/30 via-transparent to-base-100/50"
        ></div>
      </div>

      <!-- Content -->
      <div
        class="hero-text-content relative z-10 container mx-auto px-6 text-center flex flex-col items-center"
      >
        <!-- Headline - Dramatic gold gradient (Task 3.1: Enhanced typography) -->
        <h1
          class="hero-headline font-display font-bold text-6xl md:text-7xl lg:text-8xl mb-6 gradient-text-gold"
        >
          Ancient Wisdom for Modern AI
        </h1>

        <!-- Tagline - White with dark shadow for contrast -->
        <p
          class="hero-tagline text-xl md:text-2xl mb-12 max-w-3xl mx-auto font-medium"
          style="
            color: #ffffff;
            text-shadow:
              0 2px 4px rgba(0,0,0,0.9),
              0 4px 8px rgba(0,0,0,0.7),
              0 0 20px rgba(0,0,0,0.5);
          "
        >
          Transform Claude Code CLI into a native VS Code experience. Built by
          architects who understand your craft.
        </p>

        <!-- CTA Buttons -->
        <div
          class="hero-ctas flex flex-col sm:flex-row gap-4 justify-center items-center"
        >
          <!-- Primary CTA: Install Free -->
          <a
            href="https://marketplace.visualstudio.com/items?itemName=anthropic.claude-code"
            target="_blank"
            rel="noopener noreferrer"
            class="bg-gradient-to-r from-secondary to-accent text-secondary-content px-8 py-4 rounded-xl text-lg font-semibold shadow-[0_0_40px_rgba(212,175,55,0.4)] hover:scale-105 hover:shadow-[0_0_60px_rgba(212,175,55,0.5)] transition-all"
            aria-label="Install Ptah Extension from VS Code Marketplace"
          >
            Install Free
          </a>

          <!-- Secondary CTA: Scroll indicator -->
          <a
            href="#demo"
            class="text-secondary hover:text-accent transition-colors flex items-center gap-2"
            aria-label="Scroll to view demo section"
          >
            <span>See what it builds</span>
            <span class="animate-bounce">↓</span>
          </a>
        </div>
      </div>

      <!-- Scroll Indicator -->
      <div
        class="scroll-indicator absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce opacity-60"
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
   * Initialize GSAP animations with reduced-motion support
   *
   * Entry Animation (Task 3.2):
   * - Runs once on page load (headline → tagline → CTA sequence)
   * - Creates dramatic reveal effect with blur-to-clear fade-up
   *
   * Scroll Animation:
   * - As user scrolls down, content fades out and moves up
   * - Creates parallax effect with 3D scene staying in place
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
      // NEW: Entry animation timeline (runs once on load)
      const entryTl = gsap.timeline({ delay: 0.3 });
      entryTl
        .from('.hero-headline', {
          y: 30,
          opacity: 0,
          filter: 'blur(10px)',
          duration: 0.8,
          ease: 'power3.out',
        })
        .from(
          '.hero-tagline',
          {
            y: 20,
            opacity: 0,
            duration: 0.6,
            ease: 'power2.out',
          },
          '-=0.3'
        )
        .from(
          '.hero-ctas',
          {
            y: 15,
            opacity: 0,
            scale: 0.95,
            duration: 0.5,
            ease: 'back.out(1.7)',
          },
          '-=0.2'
        );

      // KEEP: Scroll-triggered fade out and move up animation
      // Animations complete within a short scroll distance (first 20% of viewport)
      // Each element animates with staggered timing for a cascading effect
      gsap.to('.hero-headline', {
        y: -50,
        opacity: 0,
        ease: 'power2.in',
        scrollTrigger: {
          trigger: this.sectionRef().nativeElement,
          start: 'top top',
          end: '15% top',
          scrub: 0.5,
        },
      });

      gsap.to('.hero-tagline', {
        y: -40,
        opacity: 0,
        ease: 'power2.in',
        scrollTrigger: {
          trigger: this.sectionRef().nativeElement,
          start: '2% top',
          end: '17% top',
          scrub: 0.5,
        },
      });

      gsap.to('.hero-ctas', {
        y: -20,
        opacity: 0,
        ease: 'power2.in',
        scrollTrigger: {
          trigger: this.sectionRef().nativeElement,
          start: '6% top',
          end: '21% top',
          scrub: 0.5,
        },
      });

      // Scroll indicator fades out immediately
      gsap.to('.scroll-indicator', {
        opacity: 0,
        ease: 'power2.in',
        scrollTrigger: {
          trigger: this.sectionRef().nativeElement,
          start: 'top top',
          end: '8% top',
          scrub: 0.5,
        },
      });
    }, this.sectionRef().nativeElement);

    // Register cleanup on component destroy
    this.destroyRef.onDestroy(() => {
      // Kill all ScrollTriggers associated with this context
      ScrollTrigger.getAll().forEach((trigger) => trigger.kill());
      this.gsapContext?.revert();
    });
  }
}
