import { Component, ChangeDetectionStrategy } from '@angular/core';
import {
  ParallaxSplitScrollComponent,
  ParallaxSplitItemDirective,
  ViewportAnimationDirective,
  ViewportAnimationConfig,
} from '@hive-academy/angular-gsap';

/**
 * Pain point data interface for "Before Ptah" section
 */
interface PainPoint {
  text: string;
  detail: string;
}

/**
 * Benefit data interface for "With Ptah" section
 */
interface Benefit {
  text: string;
  detail: string;
}

/**
 * Performance metric data interface
 */
interface PerformanceMetric {
  name: string;
  cli: string;
  sdk: string;
  improvement: string;
}

/**
 * ComparisonSplitScrollComponent - Parallax split scroll comparison showcase
 *
 * Complexity Level: 2 (Medium)
 * Patterns: Composition with library components, signal-based state, ViewportAnimation
 *
 * Features:
 * - Uses ParallaxSplitScrollComponent for split-screen parallax effect
 * - 3 sections: "Before Ptah" (left), "With Ptah" (right), "Performance Metrics" (left)
 * - Staggered viewport animations for pain points, benefits, and metrics
 * - Red/warning colors for pain points, green/success colors for benefits
 * - Performance metrics with crossed-out CLI values and highlighted SDK values
 *
 * SOLID Principles:
 * - Single Responsibility: Orchestrate parallax split scroll with comparison content
 * - Composition: Uses ParallaxSplitScrollComponent and ViewportAnimationDirective
 * - Open/Closed: Add sections to array without modifying component logic
 */
@Component({
  selector: 'ptah-comparison-split-scroll',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ParallaxSplitScrollComponent,
    ParallaxSplitItemDirective,
    ViewportAnimationDirective,
  ],
  template: `
    <section
      id="comparison"
      class="relative bg-gradient-to-b from-slate-900 to-slate-950"
    >
      <!-- Section Header -->
      <div class="py-16 text-center">
        <h2
          viewportAnimation
          [viewportConfig]="headerConfig"
          class="text-4xl md:text-5xl font-bold text-white"
        >
          The Ptah Difference
        </h2>
        <p
          viewportAnimation
          [viewportConfig]="subheaderConfig"
          class="mt-4 text-xl text-slate-400 max-w-2xl mx-auto px-4"
        >
          From terminal chaos to visual clarity. See how Ptah transforms your
          Claude Code experience.
        </p>
      </div>

      <!-- Parallax Split Scroll Comparison -->
      <agsp-parallax-split-scroll
        [scrollHeightPerStep]="800"
        [animationDuration]="0.8"
        [ease]="'power3.inOut'"
        [parallaxSpeed]="0.3"
      >
        <!-- Section 1: Before Ptah (Left Layout) -->
        <div
          parallaxSplitItem
          [imageSrc]="'/assets/images/before-ptah-terminal.png'"
          [imageAlt]="
            'Terminal chaos before Ptah - context switching and CLI overhead'
          "
          [layout]="'left'"
        >
          <div class="p-8 md:p-12 min-h-[70vh] flex flex-col justify-center">
            <h3
              viewportAnimation
              [viewportConfig]="sectionTitleConfig"
              class="text-3xl md:text-4xl font-bold text-red-400/80 mb-8"
            >
              Before Ptah
            </h3>

            <!-- Pain Points with Staggered Animation -->
            <ul class="space-y-6" role="list">
              @for (pain of painPoints; track pain.text; let i = $index) {
              <li
                viewportAnimation
                [viewportConfig]="getPainConfig(i)"
                class="flex items-start gap-4"
              >
                <span
                  class="flex-shrink-0 w-8 h-8 rounded-full bg-red-500/20
                           flex items-center justify-center text-red-400 font-bold"
                  aria-hidden="true"
                >
                  ✕
                </span>
                <div>
                  <p class="text-lg text-slate-200 font-medium">
                    {{ pain.text }}
                  </p>
                  <p class="text-sm text-slate-500 mt-1">{{ pain.detail }}</p>
                </div>
              </li>
              }
            </ul>
          </div>
        </div>

        <!-- Section 2: With Ptah (Right Layout) -->
        <div
          parallaxSplitItem
          [imageSrc]="'/assets/images/with-ptah-vscode.png'"
          [imageAlt]="
            'Seamless experience with Ptah - VS Code native integration'
          "
          [layout]="'right'"
        >
          <div class="p-8 md:p-12 min-h-[70vh] flex flex-col justify-center">
            <h3
              viewportAnimation
              [viewportConfig]="sectionTitleConfig"
              class="text-3xl md:text-4xl font-bold mb-8"
            >
              <span
                class="bg-gradient-to-r from-emerald-400 to-green-300
                       bg-clip-text text-transparent"
              >
                With Ptah
              </span>
            </h3>

            <!-- Benefits with Staggered Animation -->
            <ul class="space-y-6" role="list">
              @for (benefit of benefits; track benefit.text; let i = $index) {
              <li
                viewportAnimation
                [viewportConfig]="getBenefitConfig(i)"
                class="flex items-start gap-4"
              >
                <span
                  class="flex-shrink-0 w-8 h-8 rounded-full bg-green-500/20
                           flex items-center justify-center text-green-400 font-bold"
                  aria-hidden="true"
                >
                  ✓
                </span>
                <div>
                  <p class="text-lg text-white font-medium">
                    {{ benefit.text }}
                  </p>
                  <p class="text-sm text-slate-400 mt-1">
                    {{ benefit.detail }}
                  </p>
                </div>
              </li>
              }
            </ul>
          </div>
        </div>

        <!-- Section 3: Performance Metrics (Left Layout) -->
        <div
          parallaxSplitItem
          [imageSrc]="'/assets/images/performance-chart.png'"
          [imageAlt]="'Performance comparison chart - CLI vs SDK metrics'"
          [layout]="'left'"
        >
          <div class="p-8 md:p-12 min-h-[70vh] flex flex-col justify-center">
            <h3
              viewportAnimation
              [viewportConfig]="sectionTitleConfig"
              class="text-3xl md:text-4xl font-bold text-white mb-8"
            >
              Performance That Speaks
            </h3>

            <!-- Metrics Grid -->
            <div class="grid grid-cols-1 gap-6">
              @for (metric of metrics; track metric.name; let i = $index) {
              <div
                viewportAnimation
                [viewportConfig]="getMetricConfig(i)"
                class="p-6 rounded-2xl bg-slate-800/60 border border-slate-700/50
                         backdrop-blur-sm"
              >
                <div class="text-sm text-slate-400 mb-3 font-medium">
                  {{ metric.name }}
                </div>
                <div class="flex items-baseline gap-4 flex-wrap">
                  <span
                    class="text-slate-500 line-through text-lg"
                    aria-label="CLI value"
                  >
                    {{ metric.cli }}
                  </span>
                  <span class="text-slate-600" aria-hidden="true">→</span>
                  <span
                    class="text-3xl font-bold text-green-400"
                    aria-label="SDK value"
                  >
                    {{ metric.sdk }}
                  </span>
                  <span
                    class="text-sm font-semibold text-green-400 bg-green-500/10
                             px-3 py-1 rounded-full"
                  >
                    {{ metric.improvement }}
                  </span>
                </div>
              </div>
              }
            </div>
          </div>
        </div>
      </agsp-parallax-split-scroll>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class ComparisonSplitScrollComponent {
  /**
   * Pain points for "Before Ptah" section
   * Shows the problems users face with CLI-only Claude Code
   */
  readonly painPoints: PainPoint[] = [
    {
      text: 'Terminal switching disrupts your flow',
      detail:
        'Constant context switching between editor and terminal breaks concentration',
    },
    {
      text: 'Slow CLI subprocess overhead',
      detail:
        '500ms+ startup time for each interaction adds up throughout the day',
    },
    {
      text: 'Generic agents waste context',
      detail:
        'No understanding of your specific project structure or conventions',
    },
    {
      text: 'Limited workspace awareness',
      detail: 'Manual context management required for every conversation',
    },
  ];

  /**
   * Benefits for "With Ptah" section
   * Shows the improvements Ptah brings to the Claude Code experience
   */
  readonly benefits: Benefit[] = [
    {
      text: 'VS Code native - never leave your editor',
      detail:
        'Seamlessly integrated into your existing workflow and keybindings',
    },
    {
      text: '10x faster SDK integration',
      detail: '50ms session creation vs 500ms with CLI subprocess',
    },
    {
      text: 'Project-adaptive AI agents',
      detail:
        'Agents customized to your codebase, stack, and coding conventions',
    },
    {
      text: 'Full workspace intelligence',
      detail: 'Automatic context from 13+ project types and 6 monorepo tools',
    },
  ];

  /**
   * Performance metrics comparing CLI vs SDK
   * Shows concrete performance improvements with real numbers
   */
  readonly metrics: PerformanceMetric[] = [
    {
      name: 'Session Creation',
      cli: '500ms',
      sdk: '50ms',
      improvement: '10x faster',
    },
    {
      name: 'First Chunk Latency',
      cli: '1000ms',
      sdk: '100ms',
      improvement: '10x faster',
    },
    {
      name: 'Memory Usage',
      cli: '50MB',
      sdk: '20MB',
      improvement: '60% less',
    },
  ];

  /**
   * Animation config for section header
   */
  readonly headerConfig: ViewportAnimationConfig = {
    animation: 'slideUp',
    duration: 0.8,
    threshold: 0.2,
  };

  /**
   * Animation config for section subheader
   */
  readonly subheaderConfig: ViewportAnimationConfig = {
    animation: 'fadeIn',
    duration: 0.8,
    delay: 0.1,
    threshold: 0.2,
  };

  /**
   * Animation config for section titles within parallax items
   */
  readonly sectionTitleConfig: ViewportAnimationConfig = {
    animation: 'slideUp',
    duration: 0.6,
    threshold: 0.3,
  };

  /**
   * Generate animation config for pain points with stagger effect
   * @param index - Index of the pain point (0-based)
   * @returns ViewportAnimationConfig with appropriate delay for stagger
   */
  getPainConfig(index: number): ViewportAnimationConfig {
    return {
      animation: 'slideLeft',
      duration: 0.6,
      delay: index * 0.1,
      threshold: 0.2,
    };
  }

  /**
   * Generate animation config for benefits with stagger effect
   * @param index - Index of the benefit (0-based)
   * @returns ViewportAnimationConfig with appropriate delay and easing
   */
  getBenefitConfig(index: number): ViewportAnimationConfig {
    return {
      animation: 'slideRight',
      duration: 0.6,
      delay: index * 0.1,
      ease: 'back.out(1.4)',
      threshold: 0.2,
    };
  }

  /**
   * Generate animation config for metrics with stagger effect
   * @param index - Index of the metric (0-based)
   * @returns ViewportAnimationConfig with scale-in animation
   */
  getMetricConfig(index: number): ViewportAnimationConfig {
    return {
      animation: 'scaleIn',
      duration: 0.5,
      delay: index * 0.15,
      ease: 'back.out(1.7)',
      threshold: 0.2,
    };
  }
}
