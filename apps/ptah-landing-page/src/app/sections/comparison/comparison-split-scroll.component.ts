import { ChangeDetectionStrategy, Component } from '@angular/core';
import {
  ViewportAnimationConfig,
  ViewportAnimationDirective,
} from '@hive-academy/angular-gsap';
import { Check, LucideAngularModule, X } from 'lucide-angular';
import {
  FloatingGlyph,
  FloatingGlyphsComponent,
} from '../../components/floating-glyphs.component';

interface ComparisonPoint {
  text: string;
  detail: string;
}

interface PerformanceMetric {
  name: string;
  before: string;
  after: string;
  improvement: string;
}

@Component({
  selector: 'ptah-comparison-split-scroll',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ViewportAnimationDirective,
    LucideAngularModule,
    FloatingGlyphsComponent,
  ],
  template: `
    <section
      id="comparison"
      aria-label="The Ptah Difference"
      class="relative py-32 sm:py-44 bg-gradient-to-b from-slate-900 to-slate-950 overflow-hidden"
    >
      <ptah-floating-glyphs [glyphs]="glyphs" />

      <div class="relative z-10 max-w-7xl mx-auto px-6 sm:px-10 lg:px-16">
        <div class="text-center mb-20 sm:mb-28">
          <div
            viewportAnimation
            [viewportConfig]="headerConfig"
            class="mx-auto mb-10 h-px w-24 bg-gradient-to-r from-transparent via-[#d4af37]/70 to-transparent"
            aria-hidden="true"
          ></div>
          <h2
            viewportAnimation
            [viewportConfig]="headerConfig"
            class="font-display text-3xl md:text-4xl lg:text-5xl font-semibold text-white leading-tight mb-8"
          >
            The Ptah Difference
          </h2>
          <p
            viewportAnimation
            [viewportConfig]="subheaderConfig"
            class="text-base sm:text-lg text-gray-400 max-w-2xl mx-auto leading-relaxed"
          >
            From juggling AI providers to unified orchestration. See how Ptah
            transforms your coding workflow.
          </p>
        </div>

        <div class="grid md:grid-cols-2 gap-10 lg:gap-14">
          <div
            class="relative rounded-2xl border border-white/5 bg-slate-900/50 p-8 md:p-10 lg:p-12"
            viewportAnimation
            [viewportConfig]="{ animation: 'slideRight', duration: 0.6 }"
          >
            <h3
              class="text-lg font-semibold text-gray-400 mb-10 flex items-center gap-3"
            >
              <span
                class="w-9 h-9 rounded-full bg-[#b22222]/15 border border-[#b22222]/25 flex items-center justify-center"
              >
                <lucide-angular
                  [img]="XIcon"
                  class="w-4 h-4 text-[#b22222]"
                  aria-hidden="true"
                />
              </span>
              Before Ptah
            </h3>

            <ul class="space-y-8" role="list">
              @for (pain of painPoints; track pain.text; let i = $index) {
                <li
                  viewportAnimation
                  [viewportConfig]="getPainConfig(i)"
                  class="flex items-start gap-4"
                >
                  <lucide-angular
                    [img]="XIcon"
                    class="w-4 h-4 text-[#b22222]/70 mt-1.5 shrink-0"
                    aria-hidden="true"
                  />
                  <div>
                    <p class="text-base text-gray-300 font-medium">
                      {{ pain.text }}
                    </p>
                    <p class="text-sm text-gray-500 mt-1.5 leading-relaxed">
                      {{ pain.detail }}
                    </p>
                  </div>
                </li>
              }
            </ul>
          </div>

          <div
            class="relative rounded-2xl border border-[#d4af37]/25 bg-slate-900/70 p-8 md:p-10 lg:p-12 shadow-glow-gold"
            viewportAnimation
            [viewportConfig]="{ animation: 'slideLeft', duration: 0.6 }"
          >
            <div
              class="absolute inset-0 rounded-2xl bg-gradient-to-b from-[#d4af37]/5 to-transparent pointer-events-none"
              aria-hidden="true"
            ></div>
            <h3
              class="relative text-lg font-semibold text-[#f4d47c] mb-10 flex items-center gap-3"
            >
              <span
                class="w-9 h-9 rounded-full bg-[#d4af37]/15 border border-[#d4af37]/30 flex items-center justify-center"
              >
                <lucide-angular
                  [img]="CheckIcon"
                  class="w-4 h-4 text-[#d4af37]"
                  aria-hidden="true"
                />
              </span>
              With Ptah
            </h3>

            <ul class="relative space-y-8" role="list">
              @for (benefit of benefits; track benefit.text; let i = $index) {
                <li
                  viewportAnimation
                  [viewportConfig]="getBenefitConfig(i)"
                  class="flex items-start gap-4"
                >
                  <lucide-angular
                    [img]="CheckIcon"
                    class="w-4 h-4 text-[#d4af37] mt-1.5 shrink-0"
                    aria-hidden="true"
                  />
                  <div>
                    <p class="text-base text-white font-medium">
                      {{ benefit.text }}
                    </p>
                    <p class="text-sm text-gray-400 mt-1.5 leading-relaxed">
                      {{ benefit.detail }}
                    </p>
                  </div>
                </li>
              }
            </ul>
          </div>
        </div>

        <div class="mt-24 sm:mt-32">
          <div
            class="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-white/5 border-y border-white/5"
          >
            @for (metric of metrics; track metric.name; let i = $index) {
              <div
                viewportAnimation
                [viewportConfig]="getMetricConfig(i)"
                class="py-10 px-6 text-center"
              >
                <p class="text-sm text-gray-500 mb-3">{{ metric.name }}</p>
                <p class="flex items-baseline justify-center gap-3 flex-wrap">
                  <span
                    class="text-gray-600 line-through text-base font-mono"
                    >{{ metric.before }}</span
                  >
                  <span class="text-gray-600" aria-hidden="true">→</span>
                  <span
                    class="text-3xl font-semibold text-[#f4d47c] font-mono"
                    >{{ metric.after }}</span
                  >
                </p>
                <p class="mt-3 text-sm font-medium text-[#d4af37]">
                  {{ metric.improvement }}
                </p>
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
  public readonly XIcon = X;
  public readonly CheckIcon = Check;

  public readonly glyphs: FloatingGlyph[] = [
    {
      src: '/assets/icons/glyphs/feather-maat.png',
      size: 120,
      top: '8%',
      right: '6%',
      delay: 0,
      duration: 11,
    },
    {
      src: '/assets/icons/glyphs/ankh.png',
      size: 85,
      bottom: '12%',
      left: '5%',
      delay: 2,
      duration: 9,
    },
  ];

  public readonly painPoints: ComparisonPoint[] = [
    {
      text: 'Fragmented AI provider experience',
      detail:
        'Switching between OpenAI, Claude, and Copilot means different tools, different workflows',
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
      text: 'No memory between sessions',
      detail:
        'Every conversation starts cold — no recall of past decisions, project context, or repeated workflows',
    },
  ];

  public readonly benefits: ComparisonPoint[] = [
    {
      text: 'One harness for all AI providers',
      detail:
        'OpenAI, Claude, Copilot, and 200+ models through a single unified interface',
    },
    {
      text: '10x faster native integration',
      detail: '50ms session creation vs 500ms with CLI subprocess overhead',
    },
    {
      text: 'Project-adaptive AI agents',
      detail:
        'Agents customized to your codebase, stack, and coding conventions',
    },
    {
      text: 'Persistent memory that grows with you',
      detail:
        'Thoth remembers decisions, patterns, and context across every session (Electron desktop)',
    },
  ];

  public readonly metrics: PerformanceMetric[] = [
    {
      name: 'Session Creation',
      before: '500ms',
      after: '50ms',
      improvement: '10x faster',
    },
    {
      name: 'First Chunk Latency',
      before: '1000ms',
      after: '100ms',
      improvement: '10x faster',
    },
    {
      name: 'Concurrent Agents',
      before: '1',
      after: '9',
      improvement: '9x parallelism',
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
      threshold: 0.2,
    };
  }

  public getMetricConfig(index: number): ViewportAnimationConfig {
    return {
      animation: 'fadeIn',
      duration: 0.6,
      delay: 0.1 + index * 0.15,
      threshold: 0.2,
    };
  }
}
