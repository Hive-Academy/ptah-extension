import { Component, ChangeDetectionStrategy } from '@angular/core';
import {
  ViewportAnimationDirective,
  ViewportAnimationConfig,
  ScrollAnimationDirective,
  ScrollAnimationConfig,
} from '@hive-academy/angular-gsap';

/**
 * HeroContentOverlayComponent - Hero text content with cinematic scroll animations
 *
 * Animation Strategy:
 * 1. ENTRANCE (viewport): Staggered reveal - badge → headline → subheadline → CTAs → stats
 * 2. EXIT (scroll): Cinematic fade-out + rise as user scrolls down
 *
 * The scroll exit creates a dramatic "leaving the temple" effect
 */
@Component({
  selector: 'ptah-hero-content-overlay',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ViewportAnimationDirective, ScrollAnimationDirective],
  template: `
    <!-- Scroll-linked fade-out container for cinematic exit -->
    <div
      scrollAnimation
      [scrollConfig]="contentScrollExitConfig"
      class="flex flex-col items-center justify-center min-h-screen py-20 px-6 text-center max-w-4xl mx-auto"
    >
      <!-- Badge -->
      <div
        viewportAnimation
        [viewportConfig]="badgeConfig"
        class="inline-flex items-center gap-2 px-4 py-2 mb-10 bg-amber-500/10 border border-amber-500/20 rounded-full"
      >
        <span class="w-2 h-2 bg-amber-400 rounded-full animate-pulse"></span>
        <span class="text-sm font-medium text-amber-300/90 tracking-wide"
          >Powered by Claude Agent SDK</span
        >
      </div>

      <!-- Main Headline: Ptah -->
      <h1
        viewportAnimation
        [viewportConfig]="headlineConfig"
        class="text-4xl sm:text-5xl md:text-6xl lg:text-7xl xl:text-8xl font-bold mb-8 leading-none tracking-tight bg-gradient-to-r from-amber-300 via-amber-400 to-amber-500 bg-clip-text text-transparent"
      >
        Ptah
      </h1>

      <!-- Subheadline -->
      <p
        viewportAnimation
        [viewportConfig]="subheadlineConfig"
        class="text-base md:text-lg lg:text-xl text-white/70 mb-12 max-w-2xl leading-relaxed font-light"
      >
        The AI coding orchestra for VS Code, powered by Claude Agent SDK.
        Intelligent workspace analysis, Code Execution MCP server, and
        project-adaptive AI agents.
      </p>

      <!-- CTA Buttons -->
      <div
        viewportAnimation
        [viewportConfig]="ctaConfig"
        class="flex flex-col sm:flex-row gap-3 sm:gap-4 mb-12 sm:mb-16 w-full sm:w-auto px-2 sm:px-0"
      >
        <a
          href="https://marketplace.visualstudio.com/items?itemName=ptah.ptah"
          target="_blank"
          rel="noopener"
          class="px-5 sm:px-8 py-3 sm:py-4 text-sm sm:text-base font-semibold text-slate-900 bg-gradient-to-r from-amber-400 to-amber-500 rounded-lg hover:from-amber-300 hover:to-amber-400 transform hover:-translate-y-0.5 transition-all duration-200 shadow-lg shadow-amber-500/25 text-center"
        >
          Try 14 Days Free — Install Now
        </a>
        <a
          href="#demo"
          class="px-5 sm:px-8 py-3 sm:py-4 text-sm sm:text-base font-medium text-white/90 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 hover:border-white/20 transition-all duration-200 text-center"
        >
          Watch 3-Minute Demo
        </a>
      </div>

      <!-- Social Proof Stats -->
      <div
        viewportAnimation
        [viewportConfig]="socialProofConfig"
        class="grid grid-cols-2 gap-x-6 gap-y-4 sm:gap-6 md:flex md:flex-wrap md:justify-center md:gap-10 w-full max-w-sm sm:max-w-none mx-auto"
      >
        @for (stat of stats; track stat.value) {
        <div class="flex items-baseline justify-center gap-1.5 sm:gap-2">
          <span class="text-xl sm:text-2xl font-semibold text-white/90">{{
            stat.value
          }}</span>
          <span class="text-xs sm:text-sm text-white/50">{{ stat.label }}</span>
        </div>
        }
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class HeroContentOverlayComponent {
  public readonly stats = [
    { value: '12', label: 'libraries' },
    { value: '48+', label: 'components' },
    { value: '60+', label: 'DI tokens' },
    { value: '94', label: 'message types' },
  ];

  /**
   * Cinematic scroll exit - content fades out and rises as user scrolls
   * Creates "ascending from the temple" effect
   */
  public readonly contentScrollExitConfig: ScrollAnimationConfig = {
    animation: 'custom',
    start: 'top top',
    end: 'bottom 50%',
    scrub: 1.2,
    from: { opacity: 1, y: 0 },
    to: { opacity: 0, y: -120 },
  };

  /**
   * Badge entrance - quick scale in
   */
  public readonly badgeConfig: ViewportAnimationConfig = {
    animation: 'scaleIn',
    duration: 0.5,
    threshold: 0.1,
  };

  /**
   * Headline entrance - dramatic slide up
   */
  public readonly headlineConfig: ViewportAnimationConfig = {
    animation: 'slideUp',
    duration: 0.8,
    delay: 0.15,
    threshold: 0.1,
    ease: 'power2.out',
  };

  /**
   * Subheadline - fade in after headline
   */
  public readonly subheadlineConfig: ViewportAnimationConfig = {
    animation: 'fadeIn',
    duration: 0.7,
    delay: 0.3,
    threshold: 0.1,
  };

  /**
   * CTAs - slide up together
   */
  public readonly ctaConfig: ViewportAnimationConfig = {
    animation: 'slideUp',
    duration: 0.6,
    delay: 0.45,
    threshold: 0.1,
    ease: 'power2.out',
  };

  /**
   * Stats - fade in last
   */
  public readonly socialProofConfig: ViewportAnimationConfig = {
    animation: 'fadeIn',
    duration: 0.6,
    delay: 0.6,
    threshold: 0.1,
  };
}
