import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  inject,
} from '@angular/core';
import {
  ViewportAnimationConfig,
  ViewportAnimationDirective,
} from '@hive-academy/angular-gsap';
import { Check, LucideAngularModule } from 'lucide-angular';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

/**
 * One axis of the "Demo vs. Production" comparison. `demo` is the vibe-coding
 * tools reality (recessed, rose baseline); `ptah` is what Ptah Desktop staffs
 * instead (elevated, amber). One typed array drives the whole meter list.
 */
interface AxisRow {
  readonly axis: string;
  readonly demo: string;
  readonly ptah: string;
}

/**
 * ComparisonTugMeterComponent — S8 "The Ptah Difference" (design spec §4 S8).
 * A per-axis "tug-of-war" meter: on each of the wedge's four axes the demo
 * holds a thin rose baseline while Ptah's amber production fill sweeps across
 * and past it as the row scrolls through the viewport — the demo→production
 * tension resolving. Closes with the copy-deck honest-framing paragraph (no
 * FUD, no fabricated benchmarks).
 *
 * Promoted from the `/comparison-lab` sandbox (Variation 3). Live tokens only
 * (amber #f5a524 + ink ramp, rose accents for the demo side). Scrub motion is
 * gated behind `gsap.matchMedia('(prefers-reduced-motion: no-preference)')` in
 * `afterNextRender`, with every ScrollTrigger killed and the matchMedia
 * reverted on destroy. Resting DOM shows the resolved state: full amber fills,
 * so reduced-motion and SSG prerender read "Ptah ships it" on every axis.
 */
@Component({
  selector: 'ptah-comparison-tug-meter',
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
            demo, fast. On every axis that separates a demo from a business, the
            demo holds a thin baseline — and Ptah keeps going.
          </p>
        </div>

        <!-- Tug-of-war meters -->
        <div class="max-w-4xl mx-auto space-y-8">
          @for (row of axes; track row.axis; let i = $index) {
            <div viewportAnimation [viewportConfig]="rowConfig(i)">
              <div
                class="flex items-baseline justify-between gap-4 mb-2.5 font-mono text-[11px] uppercase tracking-[0.15em]"
              >
                <span class="text-ink-300">{{ row.axis }}</span>
                <span class="text-amber-500/80">Ptah ships it</span>
              </div>

              <!-- meter track -->
              <div
                class="relative h-11 rounded-lg border border-ink-800 bg-ink-900/50 overflow-hidden"
              >
                <!-- rose demo baseline + ceiling tick -->
                <div
                  aria-hidden="true"
                  class="absolute inset-y-0 left-0 w-[38%] bg-rose-400/[0.08]"
                ></div>
                <div
                  aria-hidden="true"
                  class="absolute inset-y-0 left-[38%] w-px bg-rose-400/50"
                ></div>
                <!-- amber production fill (scrubbed scaleX) -->
                <div
                  data-tug-fill
                  class="absolute inset-y-0 left-0 w-full origin-left bg-gradient-to-r from-amber-500/25 to-amber-500/50 border-r border-amber-500/70"
                ></div>

                <div
                  class="relative h-full flex items-center justify-between px-3.5"
                >
                  <span class="font-mono text-[10px] text-rose-400/70"
                    >demo ceiling</span
                  >
                  <lucide-angular
                    [img]="CheckIcon"
                    class="w-4 h-4 text-amber-400"
                    aria-hidden="true"
                  />
                </div>
              </div>

              <div class="mt-2.5 grid sm:grid-cols-2 gap-x-6 gap-y-1">
                <p class="text-xs text-ink-500 leading-relaxed">
                  <span class="text-rose-400/70">demo — </span>{{ row.demo }}
                </p>
                <p class="text-xs text-ink-400 leading-relaxed">
                  <span class="text-amber-500/80">ptah — </span>{{ row.ptah }}
                </p>
              </div>
            </div>
          }
        </div>

        <!-- Honest framing, no FUD — a lifecycle map of where each tool fits -->
        <div
          viewportAnimation
          [viewportConfig]="lifecycleConfig"
          class="max-w-4xl mx-auto pt-20"
        >
          <p
            class="text-center font-mono text-[11px] uppercase tracking-[0.2em] text-ink-500 mb-8"
          >
            Where each tool fits — an honest map
          </p>

          <!-- lifecycle rail -->
          <div class="relative">
            <div
              class="flex justify-between font-mono text-[10px] uppercase tracking-[0.15em] mb-3"
            >
              <span class="text-ink-500">idea</span>
              <span class="text-amber-500/80"
                >production · feature 10 → 50</span
              >
            </div>

            <!-- track: rose demo stretch, amber production tail -->
            <div
              class="relative h-2 rounded-full bg-ink-900 border border-ink-800 overflow-hidden"
            >
              <div
                aria-hidden="true"
                class="absolute inset-y-0 left-0 w-[38%] bg-rose-400/15"
              ></div>
              <div
                data-lifecycle-fill
                aria-hidden="true"
                class="absolute inset-y-0 left-[38%] right-0 origin-left bg-gradient-to-r from-amber-500/40 to-amber-500/70"
              ></div>
            </div>

            <!-- handoff marker at the 38% seam -->
            <div class="relative mt-2 h-5">
              <span
                class="absolute left-[38%] -translate-x-1/2 font-mono text-[9px] uppercase tracking-[0.15em] text-ink-400 whitespace-nowrap"
                >↑ the demo lands</span
              >
            </div>
          </div>

          <!-- coverage cards, aligned to the seam -->
          <div class="mt-8 grid gap-4 sm:grid-cols-[38fr_62fr]">
            <div class="rounded-xl border border-ink-800 bg-ink-900/40 p-5">
              <p
                class="font-mono text-[11px] uppercase tracking-[0.15em] text-ink-400 mb-2"
              >
                Prototype generators
              </p>
              <p class="text-sm text-ink-500 leading-relaxed">
                Vibe-coding tools — and a raw CLI agent for a single scripted CI
                task — are a fast way from an idea to a clickable demo.
                Genuinely the right call here; Ptah doesn't compete on demo
                speed, and doesn't pretend to.
              </p>
            </div>
            <div class="rounded-xl border border-amber-500/25 bg-ink-850 p-5">
              <p
                class="font-mono text-[11px] uppercase tracking-[0.15em] text-amber-500/90 mb-2"
              >
                Ptah — production team
              </p>
              <p class="text-sm text-ink-300 leading-relaxed">
                For the moment after the demo lands: a codebase that has to
                isolate tenants, bill correctly, survive a review, and stay
                consistent past the tenth feature. A different job description —
                “production team,” not “prototype generator.”
              </p>
            </div>
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
export class ComparisonTugMeterComponent {
  public readonly CheckIcon = Check;

  public readonly axes: readonly AxisRow[] = [
    {
      axis: 'Multi-Tenant Isolation',
      demo: 'Tenant data isolation is whatever the generated scaffold happened to include — often nothing, until someone finds the leak.',
      ptah: "Every tenant-isolation pattern that shipped before is recalled next session — an agent that already got it right doesn't re-guess it.",
    },
    {
      axis: 'Billing Correctness',
      demo: 'Billing gets wired once. Webhook retries, edge cases, and reconciliation are rarely touched again after the demo works.',
      ptah: 'A staffed team — architect, backend, tester — builds and reviews the billing integration the way it would for a paying customer, not a demo.',
    },
    {
      axis: 'Security Review',
      demo: 'No review step before the code ships — the model that wrote it is the only one that ever looked at it.',
      ptah: 'Cross-vendor review: a different model reviews the diff than the one that wrote it, before anything merges.',
    },
    {
      axis: 'Architecture Consistency',
      demo: "Consistency degrades fast. Feature ten doesn't look like feature one, because nothing remembers feature one.",
      ptah: 'The same architectural decisions recalled every session, from feature one through feature fifty — Ptah keeps what it learns instead of starting cold.',
    },
  ];

  public readonly headerConfig: ViewportAnimationConfig = {
    animation: 'fadeIn',
    duration: 0.6,
    threshold: 0.2,
    ease: 'power2.out',
  };

  /** Staggered slide-up reveal for each meter row. */
  public rowConfig(index: number): ViewportAnimationConfig {
    return {
      animation: 'slideUp',
      duration: 0.5,
      delay: 0.08 + index * 0.08,
      threshold: 0.2,
      ease: 'power2.out',
    };
  }

  public readonly lifecycleConfig: ViewportAnimationConfig = {
    animation: 'fadeIn',
    duration: 0.6,
    delay: 0.1,
    threshold: 0.2,
    ease: 'power2.out',
  };

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    afterNextRender(() => {
      const triggers: ScrollTrigger[] = [];
      const mm = gsap.matchMedia();
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        this.buildTugMeters(this.host.nativeElement, triggers);
        this.buildLifecycle(this.host.nativeElement, triggers);
      });
      this.destroyRef.onDestroy(() => {
        triggers.forEach((t) => t.kill());
        mm.revert();
      });
    });
  }

  /**
   * Scrub each axis's amber production fill (scaleX) as its bar crosses the
   * viewport, sweeping past the rose demo baseline. Resting DOM shows a full
   * amber fill, so reduced-motion / SSG keep the resolved "Ptah ships it" state.
   */
  private buildTugMeters(host: HTMLElement, triggers: ScrollTrigger[]): void {
    gsap.utils.toArray<HTMLElement>('[data-tug-fill]', host).forEach((fill) => {
      gsap.set(fill, { scaleX: 0.12, transformOrigin: 'left' });
      const tween = gsap.to(fill, {
        scaleX: 1,
        ease: 'none',
        scrollTrigger: {
          trigger: fill,
          start: 'top 88%',
          end: 'top 42%',
          scrub: true,
        },
      });
      if (tween.scrollTrigger) triggers.push(tween.scrollTrigger);
    });
  }

  /**
   * Draw the amber production tail in from the "demo lands" seam once the
   * lifecycle map enters the viewport — the production phase extending past the
   * demo. Resting DOM shows the full tail, so reduced-motion / SSG keep it.
   */
  private buildLifecycle(host: HTMLElement, triggers: ScrollTrigger[]): void {
    const fill = host.querySelector<HTMLElement>('[data-lifecycle-fill]');
    if (!fill) return;
    gsap.set(fill, { scaleX: 0, transformOrigin: 'left' });
    const tween = gsap.to(fill, {
      scaleX: 1,
      duration: 0.9,
      ease: 'power2.out',
      scrollTrigger: { trigger: fill, start: 'top 85%', once: true },
    });
    if (tween.scrollTrigger) triggers.push(tween.scrollTrigger);
  }
}
