/**
 * Hero Content Overlay Component
 *
 * Displays the hero text content with staggered entrance animations.
 * Features:
 * - Badge with scaleIn animation
 * - Main headline with slideUp animation
 * - Subheadline with fadeIn animation
 * - CTA buttons with slideUp animation
 * - Social proof bar with fadeIn animation
 *
 * All animations use ViewportAnimationDirective from @hive-academy/angular-gsap
 * for intersection-observer-based triggering.
 *
 * Social proof stats: 12 libraries, 48+ components, 60+ DI tokens, 94 message types
 */
import { Component, ChangeDetectionStrategy } from '@angular/core';
import {
  ViewportAnimationDirective,
  ViewportAnimationConfig,
} from '@hive-academy/angular-gsap';
import { SocialProofStat } from '../../types/landing.types';

@Component({
  selector: 'ptah-hero-content-overlay',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ViewportAnimationDirective],
  template: `
    <div
      class="flex flex-col items-center justify-center min-h-screen px-4 text-center"
    >
      <!-- Badge - Powered by Claude Agent SDK -->
      <div
        viewportAnimation
        [viewportConfig]="badgeConfig"
        class="inline-flex items-center gap-2 px-4 py-2 mb-6
               bg-gradient-to-r from-purple-500/20 to-pink-500/20
               rounded-full border border-purple-500/30"
      >
        <span class="relative flex h-2 w-2">
          <span
            class="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75"
          ></span>
          <span
            class="relative inline-flex rounded-full h-2 w-2 bg-purple-500"
          ></span>
        </span>
        <span class="text-sm font-semibold text-purple-300"
          >Powered by Claude Agent SDK</span
        >
      </div>

      <!-- Main Headline -->
      <h1
        viewportAnimation
        [viewportConfig]="headlineConfig"
        class="text-5xl md:text-7xl font-bold mb-6 leading-tight"
      >
        <span class="block text-white">VS Code AI Development,</span>
        <span
          class="block bg-gradient-to-r from-purple-400 via-pink-400 to-amber-400
                 bg-clip-text text-transparent"
        >
          Powered Up by Claude Code
        </span>
      </h1>

      <!-- Subheadline -->
      <p
        viewportAnimation
        [viewportConfig]="subheadlineConfig"
        class="text-xl md:text-2xl text-gray-300 mb-8 max-w-3xl mx-auto leading-relaxed"
      >
        A VS Code-native extension powered by the Claude Code Agent SDK.
        Intelligent workspace analysis, Code Execution MCP server, and
        project-adaptive AI agents.
      </p>

      <!-- CTA Buttons -->
      <div
        viewportAnimation
        [viewportConfig]="ctaConfig"
        class="flex flex-col sm:flex-row gap-4 justify-center mb-12"
      >
        <!-- Primary CTA - VS Code Marketplace -->
        <a
          href="https://marketplace.visualstudio.com/items?itemName=ptah.ptah"
          target="_blank"
          rel="noopener"
          class="px-8 py-4 bg-gradient-to-r from-purple-500 to-pink-500
                 text-white font-semibold rounded-xl
                 hover:from-purple-600 hover:to-pink-600
                 transform hover:scale-105 transition-all duration-200
                 shadow-lg shadow-purple-500/25
                 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-slate-950"
        >
          Install Free from VS Code Marketplace
        </a>

        <!-- Secondary CTA - Watch Demo -->
        <a
          href="#demo"
          class="px-8 py-4 bg-white/10 backdrop-blur-sm
                 text-white font-semibold rounded-xl
                 border border-white/20
                 hover:bg-white/20 transition-all duration-200
                 focus:outline-none focus:ring-2 focus:ring-white/50 focus:ring-offset-2 focus:ring-offset-slate-950"
        >
          Watch 3-Minute Demo
        </a>
      </div>

      <!-- Social Proof Bar -->
      <div
        viewportAnimation
        [viewportConfig]="socialProofConfig"
        class="flex flex-wrap justify-center gap-8 text-sm text-gray-400"
      >
        @for (stat of stats; track stat.value) {
        <div class="flex items-center gap-2">
          <span class="text-2xl font-bold text-white">{{ stat.value }}</span>
          <span>{{ stat.label }}</span>
        </div>
        }
      </div>
    </div>
  `,
})
export class HeroContentOverlayComponent {
  /**
   * Social proof statistics displayed at the bottom of the hero section.
   * These values are accurate based on the Ptah codebase:
   * - 12 libraries (2 apps + 10 libraries in Nx workspace)
   * - 48+ components (Angular components across all libraries)
   * - 60+ DI tokens (dependency injection tokens in vscode-core)
   * - 94 message types (distinct message types in shared library)
   */
  readonly stats: SocialProofStat[] = [
    { value: '12', label: 'libraries' },
    { value: '48+', label: 'components' },
    { value: '60+', label: 'DI tokens' },
    { value: '94', label: 'message types' },
  ];

  /**
   * Animation config for the badge - scaleIn effect with quick reveal
   */
  readonly badgeConfig: ViewportAnimationConfig = {
    animation: 'scaleIn',
    duration: 0.6,
    threshold: 0.1,
  };

  /**
   * Animation config for the main headline - slideUp with slight delay
   */
  readonly headlineConfig: ViewportAnimationConfig = {
    animation: 'slideUp',
    duration: 0.8,
    delay: 0.1,
    threshold: 0.1,
  };

  /**
   * Animation config for the subheadline - fadeIn with more delay
   */
  readonly subheadlineConfig: ViewportAnimationConfig = {
    animation: 'fadeIn',
    duration: 0.8,
    delay: 0.2,
    threshold: 0.1,
  };

  /**
   * Animation config for the CTA buttons - slideUp with cascade delay
   */
  readonly ctaConfig: ViewportAnimationConfig = {
    animation: 'slideUp',
    duration: 0.6,
    delay: 0.3,
    threshold: 0.1,
  };

  /**
   * Animation config for the social proof bar - final fadeIn
   */
  readonly socialProofConfig: ViewportAnimationConfig = {
    animation: 'fadeIn',
    duration: 0.8,
    delay: 0.4,
    threshold: 0.1,
  };
}
