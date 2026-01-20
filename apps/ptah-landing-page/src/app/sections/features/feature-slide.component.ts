import { Component, input, ChangeDetectionStrategy } from '@angular/core';

/**
 * Feature data interface for slide content
 */
export interface Feature {
  title: string;
  headline: string;
  description: string;
  metric: string;
  icon: string;
  gradient: string; // Tailwind gradient class like 'from-purple-500 to-pink-500'
  bgGlow: string; // Glow color class like 'bg-purple-500/10'
}

/**
 * FeatureSlideComponent - Individual fullscreen feature slide
 *
 * Complexity Level: 1 (Simple atom)
 * Patterns: Standalone component, OnPush change detection, input signals
 *
 * Features:
 * - Full viewport height/width slide design (h-screen w-full)
 * - Dynamic gradient/glow classes via class binding
 * - Step number indicator with gradient styling
 * - Icon, headline, description, and metric badge display
 * - Ambient glow background effect
 *
 * SOLID Principles:
 * - Single Responsibility: Display one feature slide with content
 * - Composition: Used within FeaturesHijackedScrollComponent
 */
@Component({
  selector: 'ptah-feature-slide',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Fullscreen Feature Slide -->
    <div
      class="h-screen w-screen flex items-center justify-center
             bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950
             relative overflow-hidden"
    >
      <!-- Ambient Glow Background -->
      <div class="absolute inset-0 pointer-events-none">
        <div
          class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
                 w-[600px] h-[600px] rounded-full blur-[150px]"
          [class]="feature().bgGlow"
        ></div>
      </div>

      <!-- Content -->
      <div class="relative z-10 text-center max-w-4xl mx-auto px-8">
        <!-- Step Number -->
        <div
          class="text-8xl md:text-9xl font-black mb-6 bg-clip-text text-transparent bg-gradient-to-br"
          [class]="feature().gradient"
        >
          {{ stepNumber().toString().padStart(2, '0') }}
        </div>

        <!-- Icon -->
        <div class="text-7xl md:text-8xl mb-8" aria-hidden="true">
          {{ feature().icon }}
        </div>

        <!-- Headline -->
        <h2 class="text-4xl md:text-6xl font-bold text-white mb-4">
          {{ feature().headline }}
        </h2>

        <!-- Title (smaller subtitle) -->
        <p
          class="text-lg md:text-xl font-semibold mb-6 bg-clip-text text-transparent bg-gradient-to-r"
          [class]="feature().gradient"
        >
          {{ feature().title }}
        </p>

        <!-- Description -->
        <p
          class="text-xl md:text-2xl text-slate-300 max-w-2xl mx-auto mb-8 leading-relaxed"
        >
          {{ feature().description }}
        </p>

        <!-- Metric Badge -->
        <div
          class="inline-flex items-center px-6 py-3 rounded-full
                 border border-white/20 backdrop-blur-sm bg-white/5"
        >
          <span class="text-lg font-bold text-white">
            {{ feature().metric }}
          </span>
        </div>
      </div>

      <!-- Step Counter (bottom) -->
      <div
        class="absolute bottom-8 left-1/2 -translate-x-1/2 text-slate-500 text-sm"
      >
        {{ stepNumber() }} / {{ totalSteps() }}
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
export class FeatureSlideComponent {
  /**
   * Feature data containing title, headline, description, metric, icon, gradient, and bgGlow
   */
  readonly feature = input.required<Feature>();

  /**
   * Current step number (1-indexed for display)
   */
  readonly stepNumber = input.required<number>();

  /**
   * Total number of steps for progress indicator
   */
  readonly totalSteps = input.required<number>();
}
