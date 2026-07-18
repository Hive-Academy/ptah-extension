import { ChangeDetectionStrategy, Component } from '@angular/core';
import {
  ViewportAnimationConfig,
  ViewportAnimationDirective,
} from '@hive-academy/angular-gsap';
import { ConsoleGridBackgroundComponent } from '../../components/console/console-grid-background.component';

/**
 * ProviderStripComponent — S7 Provider Strip ("Choose Your Brain")
 * (design spec §4 S7, copy deck S7). A compact breather section between the
 * dense pillar grids and the comparison section: tighter header, a row of seven
 * mono provider chips (text only — no third-party logos), and a trust line.
 * Chips stagger in fast; final state is fully visible and un-scaled.
 */
@Component({
  selector: 'ptah-provider-strip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ViewportAnimationDirective, ConsoleGridBackgroundComponent],
  template: `
    <section
      id="providers"
      aria-label="Provider choice — no lock-in"
      class="relative bg-ink-950 py-16 sm:py-20 overflow-hidden"
    >
      <ptah-console-grid-background />

      <div class="relative z-10 max-w-7xl mx-auto px-6 sm:px-10 lg:px-16">
        <!-- Header -->
        <div
          viewportAnimation
          [viewportConfig]="headerConfig"
          class="max-w-2xl mx-auto text-center"
        >
          <span
            class="font-mono text-xs sm:text-sm uppercase tracking-[0.2em] text-amber-500/80 mb-4 inline-block"
            >CROSS-VENDOR REVIEW, NOT SELF-GRADED HOMEWORK</span
          >
          <h2
            class="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-white leading-tight mb-6"
          >
            No Model Grades Its Own Homework.
          </h2>
          <p class="text-lg sm:text-xl text-ink-400 leading-relaxed">
            Claude, GitHub Copilot, OpenAI Codex, 200+ OpenRouter models, local
            Ollama, Kimi K2, and GLM — mix vendors so the model reviewing a
            security-sensitive diff is not the model that wrote it.
          </p>
        </div>

        <!-- Provider chips -->
        <div class="flex flex-wrap justify-center gap-3 mt-10">
          @for (chip of chips; track chip; let i = $index) {
            <span
              viewportAnimation
              [viewportConfig]="chipConfigs[i]"
              class="font-mono text-sm text-ink-100 px-4 py-2 rounded-full border border-ink-700 bg-ink-850 hover:border-amber-500/30 transition-colors"
            >
              {{ chip }}
            </span>
          }
        </div>

        <!-- Trust line -->
        <p class="text-sm text-ink-400 text-center mt-6 max-w-xl mx-auto">
          Run a review panel: one vendor implements, a different vendor reviews
          the diff, a third judges the disagreement — before anything merges.
          Per-provider API keys, real-time cost and token tracking.
        </p>
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
export class ProviderStripComponent {
  protected readonly chips = [
    'Claude',
    'GitHub Copilot',
    'OpenAI Codex',
    'OpenRouter (200+ models)',
    'Ollama (local)',
    'Kimi K2',
    'GLM',
  ];

  protected readonly headerConfig: ViewportAnimationConfig = {
    animation: 'fadeIn',
    duration: 0.6,
    threshold: 0.2,
    ease: 'power2.out',
  };

  protected readonly chipConfigs: ViewportAnimationConfig[] = [
    0, 1, 2, 3, 4, 5, 6,
  ].map((i) => ({
    animation: 'scaleIn',
    duration: 0.4,
    delay: 0.05 + i * 0.06,
    threshold: 0.2,
    ease: 'power2.out',
  }));
}
