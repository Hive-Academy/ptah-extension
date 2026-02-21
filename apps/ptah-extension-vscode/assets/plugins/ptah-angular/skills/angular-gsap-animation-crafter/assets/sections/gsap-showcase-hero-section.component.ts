import { ChangeDetectionStrategy, Component } from '@angular/core';
import { NgOptimizedImage } from '@angular/common';
import {
  ScrollAnimationDirective,
  ViewportAnimationDirective,
} from '@hive-academy/angular-gsap';

/**
 * GSAP Showcase Hero Section
 *
 * A premium hero section with:
 * - Viewport animations for initial load (badge, title, subtitle, pills, buttons)
 * - Scroll animations for parallax background and fade-out effect
 * - No conflict: viewport animations fire once on load, scroll animations
 *   use scrub to create smooth scroll-linked effects
 */
@Component({
  selector: 'app-gsap-showcase-hero-section',
  imports: [
    NgOptimizedImage,
    ScrollAnimationDirective,
    ViewportAnimationDirective,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="relative min-h-screen flex items-center justify-center overflow-hidden"
    >
      <!-- Background Layer - Smooth Parallax -->
      <div
        class="absolute inset-0 w-full h-full min-h-screen"
        scrollAnimation
        [scrollConfig]="{
          animation: 'parallax',
          speed: 0.3,
          scrub: 1.5,
          start: 'top top',
          end: 'bottom 50%'
        }"
      >
        <img
          ngSrc="images/showcase/hero-bg-back.png"
          alt=""
          fill
          priority
          class="object-cover scale-110"
        />
      </div>

      <!-- Gradient Overlay -->
      <div
        class="absolute inset-0 bg-gradient-to-b from-background-dark/100 via-transparent to-background-dark/100"
      ></div>

      <!-- Hero Content - Combined Viewport + Scroll Animations -->
      <div
        class="relative z-10 text-center text-white px-4 sm:px-6 md:px-8 max-w-5xl mx-auto mt-20 hero-content"
        scrollAnimation
        [scrollConfig]="{
          animation: 'custom',
          start: 'top 20%',
          end: 'bottom 60%',
          scrub: 1.2,
          from: { opacity: 1, y: 0 },
          to: { opacity: 0, y: -150 }
        }"
      >
        <!-- Badge - Viewport animation on load -->
        <div
          class="pt-8"
          viewportAnimation
          [viewportConfig]="{
            animation: 'scaleIn',
            duration: 0.6,
            delay: 0.1,
            threshold: 0.1
          }"
        >
          <span
            class="inline-flex items-center gap-2 sm:gap-3 px-4 sm:px-6 py-2 sm:py-3 bg-white/5 backdrop-blur-md rounded-full text-xs sm:text-sm font-medium border border-white/10 shadow-lg"
          >
            <span class="relative flex h-2 w-2 sm:h-3 sm:w-3">
              <span
                class="animate-ping absolute inline-flex h-full w-full rounded-full bg-neon-green opacity-75"
              ></span>
              <span
                class="relative inline-flex rounded-full h-2 w-2 sm:h-3 sm:w-3 bg-neon-green"
              ></span>
            </span>
            <span class="text-white/90">Angular + GSAP ScrollTrigger</span>
          </span>
        </div>

        <!-- Main Title - Viewport animation with stagger -->
        <h1
          class="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-black mb-6 sm:mb-8 leading-none tracking-tight"
          viewportAnimation
          [viewportConfig]="{
            animation: 'slideUp',
            duration: 0.8,
            delay: 0.2,
            threshold: 0.1
          }"
        >
          <span
            class="block bg-gradient-to-r p-4 from-white via-white to-white/80 bg-clip-text text-transparent drop-shadow-2xl"
          >
            Angular
          </span>
          <span
            class="block bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent"
          >
            GSAP
          </span>
        </h1>

        <!-- Subtitle - Viewport animation -->
        <p
          class="text-base font-medium sm:text-lg md:text-xl text-white/70 max-w-3xl mx-auto mb-4 sm:mb-6 leading-relaxed font-light"
          viewportAnimation
          [viewportConfig]="{
            animation: 'fadeIn',
            duration: 0.8,
            delay: 0.4,
            threshold: 0.1
          }"
        >
          Create stunning scroll-driven animations with declarative directives.
        </p>

        <!-- Feature Pills - Viewport animation with stagger -->
        <div class="flex flex-wrap gap-2 sm:gap-3 justify-center mb-8 sm:mb-12">
          <span
            class="px-3 sm:px-4 py-1.5 sm:py-2 bg-cyan-500/20 text-cyan-300 rounded-full text-xs sm:text-sm font-semibold border border-cyan-500/30"
          >
            10+ Built-in Effects
          </span>
          <span
            class="px-3 sm:px-4 py-1.5 sm:py-2 bg-purple-500/20 text-purple-300 rounded-full text-xs sm:text-sm font-semibold border border-purple-500/30"
          >
            SSR-Safe
          </span>
          <span
            class="px-3 sm:px-4 py-1.5 sm:py-2 bg-pink-500/20 text-pink-300 rounded-full text-xs sm:text-sm font-semibold border border-pink-500/30"
          >
            TypeScript-First
          </span>
        </div>

        <!-- CTA Buttons - Viewport animation -->
        <div
          class="flex flex-wrap gap-4 sm:gap-6 justify-center mb-12 sm:mb-16"
          viewportAnimation
          [viewportConfig]="{
            animation: 'slideUp',
            duration: 0.6,
            delay: 0.6,
            threshold: 0.1
          }"
        >
          <button
            class="group relative px-6 sm:px-8 md:px-10 py-3 sm:py-4 md:py-5 bg-gradient-to-r from-neon-green to-emerald-400 text-background-dark rounded-full font-bold text-sm sm:text-base md:text-lg hover:scale-105 transition-all duration-300 shadow-xl shadow-neon-green/30"
          >
            <span class="relative z-10">Get Started</span>
            <div
              class="absolute inset-0 rounded-full bg-gradient-to-r from-neon-green to-emerald-400 blur-xl opacity-50 group-hover:opacity-75 transition-opacity"
            ></div>
          </button>
          <a
            href="#features"
            class="px-6 sm:px-8 md:px-10 py-3 sm:py-4 md:py-5 bg-white/5 backdrop-blur-md text-white rounded-full font-bold text-sm sm:text-base md:text-lg border border-white/20 hover:bg-white/10 hover:border-white/40 transition-all duration-300"
          >
            See Examples
          </a>
        </div>

        <!-- Scroll Indicator - Viewport animation -->
        <div
          class="flex flex-col items-center gap-2 sm:gap-3 text-white/50"
          viewportAnimation
          [viewportConfig]="{
            animation: 'fadeIn',
            duration: 0.6,
            delay: 0.8,
            threshold: 0.1
          }"
        >
          <span class="text-xs sm:text-sm font-medium tracking-widest uppercase"
            >Scroll to explore</span
          >
          <div
            class="w-5 h-8 sm:w-6 sm:h-10 border-2 border-white/30 rounded-full flex justify-center pt-1.5 sm:pt-2"
          >
            <div
              class="w-1 h-2.5 sm:w-1.5 sm:h-3 bg-white/50 rounded-full animate-bounce"
            ></div>
          </div>
        </div>
      </div>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      @keyframes bounce {
        0%,
        100% {
          transform: translateY(-25%);
          animation-timing-function: cubic-bezier(0.8, 0, 1, 1);
        }
        50% {
          transform: translateY(0);
          animation-timing-function: cubic-bezier(0, 0, 0.2, 1);
        }
      }

      .animate-bounce {
        animation: bounce 1s infinite;
      }
    `,
  ],
})
export class GsapShowcaseHeroSectionComponent {}
