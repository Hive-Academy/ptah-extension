import { ChangeDetectionStrategy, Component } from '@angular/core';
import {
  ViewportAnimationConfig,
  ViewportAnimationDirective,
} from '@hive-academy/angular-gsap';
import { Check, LucideAngularModule, X } from 'lucide-angular';

interface AxisRow {
  readonly axis: string;
  readonly detail: string;
}

/**
 * ComparisonSplitScrollComponent — S8 "The Ptah Difference" (design spec §4 S8,
 * copy deck S8 / §5). An honest two-column comparison on the wedge's own four
 * axes (persistence, multi-agent, schedulability, reachability): the left
 * column is Cursor/Copilot-class tools (recessed, not punished — no FUD), the
 * right column is Ptah Desktop. Closes with the copy-deck "honest framing"
 * paragraph instead of any fabricated benchmark numbers.
 */
@Component({
  selector: 'ptah-comparison-split-scroll',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ViewportAnimationDirective, LucideAngularModule],
  template: `
    <section
      id="comparison"
      aria-label="The Ptah difference"
      class="relative bg-ink-950 py-24 sm:py-32 overflow-hidden"
    >
      <div class="relative z-10 max-w-7xl mx-auto px-6 sm:px-10 lg:px-16">
        <!-- Header -->
        <div
          viewportAnimation
          [viewportConfig]="headerConfig"
          class="max-w-3xl mx-auto text-center mb-16"
        >
          <span
            class="font-mono text-xs sm:text-sm uppercase tracking-[0.2em] text-amber-500/80 mb-4 inline-block"
            >DEMO VS. PRODUCTION</span
          >
          <h2
            class="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-white leading-tight mb-6"
          >
            Vibe Coding Gets You a Demo. Ptah Ships the SaaS.
          </h2>
          <p class="text-lg sm:text-xl text-ink-400 leading-relaxed">
            Vibe-coding tools are excellent at turning a prompt into a working
            demo, fast. They don't isolate tenant data, they don't get billing
            edge cases right, nothing reviews the code before it ships, and
            nothing stays consistent past the first few features. That's a
            different job — the one Ptah does.
          </p>
        </div>

        <!-- Two-column comparison -->
        <div class="grid md:grid-cols-2 gap-6 lg:gap-8">
          <!-- Vibe-coding tools (recessed) -->
          <div
            viewportAnimation
            [viewportConfig]="{
              animation: 'slideRight',
              duration: 0.6,
              threshold: 0.2,
              ease: 'power2.out',
            }"
            class="rounded-xl border border-ink-800 bg-ink-900/50 p-8 md:p-10"
          >
            <h3
              class="text-lg font-semibold text-ink-500 mb-8 flex items-center gap-3"
            >
              <span
                class="w-9 h-9 rounded-full bg-rose-400/10 border border-rose-400/20 flex items-center justify-center"
              >
                <lucide-angular
                  [img]="XIcon"
                  class="w-4 h-4 text-rose-400/70"
                  aria-hidden="true"
                />
              </span>
              Vibe-Coding Tools
            </h3>
            <ul class="space-y-7" role="list">
              @for (row of vibeCodingRows; track row.axis; let i = $index) {
                <li
                  viewportAnimation
                  [viewportConfig]="rowConfig('slideRight', i)"
                  class="flex items-start gap-4"
                >
                  <lucide-angular
                    [img]="XIcon"
                    class="w-4 h-4 text-rose-400/70 mt-1.5 shrink-0"
                    aria-hidden="true"
                  />
                  <div>
                    <p class="text-base text-ink-300 font-medium">
                      {{ row.axis }}
                    </p>
                    <p class="text-sm text-ink-500 mt-1.5 leading-relaxed">
                      {{ row.detail }}
                    </p>
                  </div>
                </li>
              }
            </ul>
          </div>

          <!-- Ptah Desktop (elevated) -->
          <div
            viewportAnimation
            [viewportConfig]="{
              animation: 'slideLeft',
              duration: 0.6,
              threshold: 0.2,
              ease: 'power2.out',
            }"
            class="rounded-xl border border-amber-500/20 bg-ink-850 p-8 md:p-10"
          >
            <h3
              class="text-lg font-semibold text-white mb-8 flex items-center gap-3"
            >
              <span
                class="w-9 h-9 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center"
              >
                <lucide-angular
                  [img]="CheckIcon"
                  class="w-4 h-4 text-amber-500"
                  aria-hidden="true"
                />
              </span>
              Ptah Desktop
            </h3>
            <ul class="space-y-7" role="list">
              @for (row of ptahRows; track row.axis; let i = $index) {
                <li
                  viewportAnimation
                  [viewportConfig]="rowConfig('slideLeft', i)"
                  class="flex items-start gap-4"
                >
                  <lucide-angular
                    [img]="CheckIcon"
                    class="w-4 h-4 text-amber-500 mt-1.5 shrink-0"
                    aria-hidden="true"
                  />
                  <div>
                    <p class="text-base text-ink-100 font-medium">
                      {{ row.axis }}
                    </p>
                    <p class="text-sm text-ink-400 mt-1.5 leading-relaxed">
                      {{ row.detail }}
                    </p>
                  </div>
                </li>
              }
            </ul>
          </div>
        </div>

        <!-- Honest framing, no FUD -->
        <p
          viewportAnimation
          [viewportConfig]="{
            animation: 'fadeIn',
            duration: 0.6,
            delay: 0.1,
            threshold: 0.2,
          }"
          class="text-base text-ink-400 max-w-3xl mx-auto text-center leading-relaxed pt-12"
        >
          Vibe-coding tools remain a fast way to get from an idea to a clickable
          demo — Ptah doesn't compete on demo speed, and doesn't pretend to. A
          raw CLI agent is still the right call for a single scripted task in
          CI. Ptah is for the moment after the demo lands: a codebase that has
          to isolate tenants, bill correctly, survive a review, and stay
          consistent past the tenth feature. That's a different job description
          — "production team," not "prototype generator."
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
export class ComparisonSplitScrollComponent {
  public readonly XIcon = X;
  public readonly CheckIcon = Check;

  public readonly vibeCodingRows: readonly AxisRow[] = [
    {
      axis: 'Multi-Tenant Isolation',
      detail:
        'Tenant data isolation is whatever the generated scaffold happened to include — often nothing, until someone finds the leak.',
    },
    {
      axis: 'Billing Correctness',
      detail:
        'Billing gets wired once. Webhook retries, edge cases, and reconciliation are rarely touched again after the demo works.',
    },
    {
      axis: 'Security Review',
      detail:
        'No review step before the code ships — the model that wrote it is the only one that ever looked at it.',
    },
    {
      axis: 'Architecture Consistency',
      detail:
        "Consistency degrades fast. Feature ten doesn't look like feature one, because nothing remembers feature one.",
    },
  ];

  public readonly ptahRows: readonly AxisRow[] = [
    {
      axis: 'Multi-Tenant Isolation',
      detail:
        "Every tenant-isolation pattern that shipped before is recalled next session — an agent that already got it right doesn't re-guess it.",
    },
    {
      axis: 'Billing Correctness',
      detail:
        'A staffed team — architect, backend, tester — builds and reviews the billing integration the way it would for a paying customer, not a demo.',
    },
    {
      axis: 'Security Review',
      detail:
        'Cross-vendor review: a different model reviews the diff than the one that wrote it, before anything merges.',
    },
    {
      axis: 'Architecture Consistency',
      detail:
        'The same architectural decisions recalled every session, from feature one through feature fifty — Ptah keeps what it learns instead of starting cold.',
    },
  ];

  public readonly headerConfig: ViewportAnimationConfig = {
    animation: 'fadeIn',
    duration: 0.6,
    threshold: 0.2,
    ease: 'power2.out',
  };

  public rowConfig(
    animation: 'slideRight' | 'slideLeft',
    index: number,
  ): ViewportAnimationConfig {
    return {
      animation,
      duration: 0.5,
      delay: 0.1 + index * 0.1,
      threshold: 0.2,
      ease: 'power2.out',
    };
  }
}
