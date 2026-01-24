import { ChangeDetectionStrategy, Component } from '@angular/core';
import {
  ViewportAnimationConfig,
  ViewportAnimationDirective,
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
 * ComparisonSplitScrollComponent - Simplified comparison showcase
 *
 * Replaced complex ParallaxSplitScrollComponent with simple viewport animations
 * to fix display issues and overflow problems.
 */
@Component({
  selector: 'ptah-comparison-split-scroll',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ViewportAnimationDirective],
  template: `
    <section
      id="comparison"
      class="relative py-24 bg-gradient-to-b from-slate-900 to-slate-950"
    >
      <!-- Section Header -->
      <div class="text-center mb-20 px-4">
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
          class="mt-4 text-xl text-slate-400 max-w-2xl mx-auto"
        >
          From terminal chaos to visual clarity. See how Ptah transforms your
          Claude Code experience.
        </p>
      </div>

      <!-- Comparison Grid -->
      <div class="container mx-auto px-4 max-w-7xl">
        <div class="grid md:grid-cols-2 gap-8 lg:gap-12">
          <!-- Before Ptah Column -->
          <div
            class="relative rounded-3xl bg-slate-800/40 border border-red-500/20 p-8 md:p-12"
            viewportAnimation
            [viewportConfig]="{ animation: 'slideRight', duration: 0.6 }"
          >
            <!-- Red accent glow -->
            <div
              class="absolute inset-0 rounded-3xl bg-gradient-to-br from-red-500/5 to-transparent pointer-events-none"
            ></div>

            <h3
              class="text-2xl md:text-3xl font-bold text-red-400/80 mb-8 flex items-center gap-3"
            >
              <span
                class="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center text-red-400"
              >
                ✕
              </span>
              Before Ptah
            </h3>

            <!-- Pain Points -->
            <ul class="space-y-6" role="list">
              @for (pain of painPoints; track pain.text; let i = $index) {
              <li
                viewportAnimation
                [viewportConfig]="getPainConfig(i)"
                class="flex items-start gap-4"
              >
                <span
                  class="flex-shrink-0 w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center text-red-400 font-bold text-sm"
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

          <!-- With Ptah Column -->
          <div
            class="relative rounded-3xl bg-slate-800/40 border border-emerald-500/20 p-8 md:p-12"
            viewportAnimation
            [viewportConfig]="{ animation: 'slideLeft', duration: 0.6 }"
          >
            <!-- Green accent glow -->
            <div
              class="absolute inset-0 rounded-3xl bg-gradient-to-br from-emerald-500/5 to-transparent pointer-events-none"
            ></div>

            <h3
              class="text-2xl md:text-3xl font-bold mb-8 flex items-center gap-3"
            >
              <span
                class="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400"
              >
                ✓
              </span>
              <span
                class="bg-gradient-to-r from-emerald-400 to-green-300 bg-clip-text text-transparent"
              >
                With Ptah
              </span>
            </h3>

            <!-- Benefits -->
            <ul class="space-y-6" role="list">
              @for (benefit of benefits; track benefit.text; let i = $index) {
              <li
                viewportAnimation
                [viewportConfig]="getBenefitConfig(i)"
                class="flex items-start gap-4"
              >
                <span
                  class="flex-shrink-0 w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center text-green-400 font-bold"
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

        <!-- Performance Metrics -->
        <div class="mt-16">
          <h3
            viewportAnimation
            [viewportConfig]="{ animation: 'slideUp', duration: 0.6 }"
            class="text-2xl md:text-3xl font-bold text-white text-center mb-12"
          >
            Performance That Speaks
          </h3>

          <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
            @for (metric of metrics; track metric.name; let i = $index) {
            <div
              viewportAnimation
              [viewportConfig]="getMetricConfig(i)"
              class="p-6 rounded-2xl bg-slate-800/60 border border-slate-700/50 backdrop-blur-sm text-center"
            >
              <div
                class="text-sm text-slate-400 mb-4 font-medium uppercase tracking-wide"
              >
                {{ metric.name }}
              </div>
              <div class="flex items-baseline justify-center gap-3 flex-wrap">
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
              </div>
              <span
                class="inline-block mt-4 text-sm font-semibold text-green-400 bg-green-500/10 px-4 py-2 rounded-full"
              >
                {{ metric.improvement }}
              </span>
            </div>
            }
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
    `,
  ],
})
export class ComparisonSplitScrollComponent {
  public readonly painPoints: PainPoint[] = [
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

  public readonly benefits: Benefit[] = [
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

  public readonly metrics: PerformanceMetric[] = [
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

  public readonly headerConfig: ViewportAnimationConfig = {
    animation: 'slideUp',
    duration: 0.8,
    threshold: 0.2,
  };

  public readonly subheaderConfig: ViewportAnimationConfig = {
    animation: 'fadeIn',
    duration: 0.8,
    delay: 0.1,
    threshold: 0.2,
  };

  public getPainConfig(index: number): ViewportAnimationConfig {
    return {
      animation: 'slideRight',
      duration: 0.5,
      delay: 0.1 + index * 0.1,
      threshold: 0.2,
    };
  }

  public getBenefitConfig(index: number): ViewportAnimationConfig {
    return {
      animation: 'slideLeft',
      duration: 0.5,
      delay: 0.1 + index * 0.1,
      ease: 'back.out(1.4)',
      threshold: 0.2,
    };
  }

  public getMetricConfig(index: number): ViewportAnimationConfig {
    return {
      animation: 'scaleIn',
      duration: 0.5,
      delay: index * 0.15,
      ease: 'back.out(1.7)',
      threshold: 0.2,
    };
  }
}
