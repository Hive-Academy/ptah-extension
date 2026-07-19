import {
  Component,
  ChangeDetectionStrategy,
  ElementRef,
  afterNextRender,
  inject,
  signal,
  DestroyRef,
} from '@angular/core';
import {
  LucideAngularModule,
  Check,
  X,
  Tag,
  ChevronDown,
  ArrowRight,
  Download,
} from 'lucide-angular';
import { NgTemplateOutlet } from '@angular/common';
import gsap from 'gsap';

/**
 * PricingLabPageComponent — non-production sandbox exploring divergent
 * WHOLE-PAGE structures for the /pricing page, built on the same advanced
 * landing-page language as SectionLabPageComponent (ink ramp + amber #f5a524,
 * Inter / JetBrains Mono, mono lab-tags, reduced-motion-safe motion).
 *
 * Every variation renders the full two-plan story (Ptah — free forever, and
 * Ptah Builders — founding-member membership) as a distinct skeleton, and the
 * promo-code affordance lives inside the Builders card (per the pricing-grid
 * → pro-plan-card relocation), never floating above the grid.
 *
 * 1. Founding Ledger  — editorial manifesto + scarcity meter, plans as rows
 * 2. Two-Card Spotlight — dark two-card grid, Builders glow-spotlighted
 * 3. Capability Matrix — one unified Free-vs-Builders comparison table
 *
 * Reachable at /pricing-lab.
 */
@Component({
  selector: 'ptah-pricing-lab-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideAngularModule, NgTemplateOutlet],
  template: `
    <div class="min-h-screen bg-ink-950 text-ink-100">
      <!-- sticky variation nav -->
      <nav
        class="sticky top-0 z-40 border-b border-ink-700/60 bg-ink-950/85 backdrop-blur-md"
      >
        <div
          class="max-w-6xl mx-auto px-6 h-14 flex items-center gap-2 overflow-x-auto"
        >
          <span
            class="font-mono text-[11px] uppercase tracking-[0.2em] text-amber-500 shrink-0 mr-2"
            >Pricing Lab</span
          >
          @for (v of variations; track v.id) {
            <a
              [href]="'#' + v.id"
              class="shrink-0 px-3 py-1.5 rounded-md text-xs font-medium text-ink-300 hover:text-white hover:bg-ink-800 transition-colors"
              >{{ v.n }}. {{ v.short }}</a
            >
          }
        </div>
      </nav>

      <!-- ============ V1 · FOUNDING LEDGER ============ -->
      <section id="v1" class="border-b border-ink-800">
        <div
          class="max-w-6xl mx-auto px-6 py-24 grid lg:grid-cols-[1.05fr_0.95fr] gap-12 lg:gap-16 items-start"
        >
          <div class="reveal">
            <span class="lab-tag">Variation 1 · Founding Ledger</span>
            <h2 class="v-head mt-8">
              The app is free.<br />
              The <span class="text-amber-500">craft</span> is the membership.
            </h2>
            <p class="v-lede mt-5">
              Ptah — Memory, Skills, Cron, and the Gateway suite — is free and
              open source, forever. Ptah Builders is the founding cohort: live
              build sessions, a PRD-to-production curriculum, and member skill
              packs, at pricing that locks in for good.
            </p>

            <!-- scarcity meter -->
            <div
              data-seats
              class="mt-10 rounded-2xl border border-ink-700 bg-ink-900/50 p-6"
            >
              <div
                class="flex items-baseline justify-between font-mono text-xs text-ink-400"
              >
                <span class="uppercase tracking-[0.15em]">Founding seats</span>
                <span
                  ><span data-seat-count class="text-amber-400 font-semibold"
                    >0</span
                  >
                  / 100 claimed</span
                >
              </div>
              <div
                class="mt-3 h-2 rounded-full bg-ink-800 overflow-hidden"
                role="progressbar"
                aria-valuemin="0"
                aria-valuemax="100"
                aria-valuenow="47"
              >
                <div
                  data-seat-bar
                  class="h-full rounded-full bg-gradient-to-r from-amber-500 to-secondary"
                  style="width: 47%"
                ></div>
              </div>
              <p class="mt-3 text-xs text-ink-500">
                Founding-member pricing closes at 100 seats.
              </p>
            </div>
          </div>

          <!-- plan ledger: two stacked rows -->
          <div class="reveal space-y-4" style="--reveal-delay: 0.12s">
            <!-- Free row -->
            <div
              class="rounded-2xl border border-ink-700 bg-ink-900/40 p-6 sm:p-7"
            >
              <div class="flex items-start justify-between gap-4">
                <div>
                  <div
                    class="font-mono text-[10px] uppercase tracking-[0.2em] text-emerald-400/80"
                  >
                    Free forever
                  </div>
                  <h3 class="mt-1.5 text-lg font-semibold text-white">Ptah</h3>
                  <p class="text-sm text-ink-400">{{ freePlan.idealFor }}</p>
                </div>
                <div class="text-right shrink-0">
                  <div class="text-3xl font-bold text-white">Free</div>
                  <div class="font-mono text-[10px] text-ink-500">
                    open source
                  </div>
                </div>
              </div>
              <ul class="mt-5 grid sm:grid-cols-2 gap-x-6 gap-y-2">
                @for (f of freePlan.features; track f) {
                  <li class="flex items-center gap-2 text-sm text-ink-300">
                    <lucide-angular
                      [img]="CheckIcon"
                      class="w-3.5 h-3.5 text-emerald-400 shrink-0"
                    />
                    {{ f }}
                  </li>
                }
              </ul>
              <button class="mt-6 cta cta-free">
                <lucide-angular [img]="DownloadIcon" class="w-4 h-4" />
                Download Free
              </button>
            </div>

            <!-- Builders row (spotlight) -->
            <div
              class="relative rounded-2xl border border-amber-500/40 bg-gradient-to-b from-amber-500/[0.06] to-ink-900/40 p-6 sm:p-7 shadow-lg shadow-amber-500/10"
            >
              <div
                class="absolute -top-3 left-6 px-3 py-1 rounded-full bg-gradient-to-r from-amber-500 to-secondary text-ink-950 font-mono text-[10px] font-bold uppercase tracking-[0.15em]"
              >
                Founding Member
              </div>
              <div class="flex items-start justify-between gap-4 mt-1">
                <div>
                  <h3 class="text-lg font-semibold text-white">
                    Ptah Builders
                  </h3>
                  <p class="text-sm text-ink-400">
                    {{ buildersPlan.idealFor }}
                  </p>
                </div>
                <div class="text-right shrink-0">
                  <div
                    class="text-3xl font-bold bg-gradient-to-r from-amber-300 to-secondary bg-clip-text text-transparent"
                  >
                    {{ buildersPlan.price }}
                  </div>
                  <div class="font-mono text-[10px] text-ink-500">
                    / mo · locked in
                  </div>
                </div>
              </div>
              <ul class="mt-5 grid sm:grid-cols-2 gap-x-6 gap-y-2">
                @for (f of buildersPlan.features; track f) {
                  <li class="flex items-center gap-2 text-sm text-ink-200">
                    <lucide-angular
                      [img]="CheckIcon"
                      class="w-3.5 h-3.5 text-amber-400 shrink-0"
                    />
                    {{ f }}
                  </li>
                }
              </ul>
              <button class="mt-6 cta cta-builders">
                Join the Builders Waitlist
                <lucide-angular [img]="ArrowRightIcon" class="w-4 h-4" />
              </button>
              <ng-container
                [ngTemplateOutlet]="promo"
                [ngTemplateOutletContext]="{ id: 'v1' }"
              />
            </div>
          </div>
        </div>
      </section>

      <!-- ============ V2 · TWO-CARD SPOTLIGHT ============ -->
      <section id="v2" class="border-b border-ink-800">
        <div class="max-w-5xl mx-auto px-6 py-24">
          <div class="reveal text-center">
            <span class="lab-tag mx-auto"
              >Variation 2 · Two-Card Spotlight</span
            >
            <h2 class="v-head mt-8 max-w-2xl mx-auto">
              Free to run. Built to ship.
            </h2>
            <p class="v-lede mx-auto text-center mt-5">
              The desktop app is free and open source. The membership is where
              you learn to turn a working prototype into a business you can
              charge for.
            </p>
          </div>

          <div class="mt-14 grid md:grid-cols-2 gap-6 lg:gap-7 items-stretch">
            <!-- Free card -->
            <div
              class="reveal flex flex-col rounded-2xl border border-ink-700 bg-ink-900/40 p-7 lg:p-8"
            >
              <div
                class="self-start px-3 py-1 rounded-full bg-emerald-500/15 text-emerald-300 font-mono text-[10px] font-bold uppercase tracking-[0.15em]"
              >
                Free forever
              </div>
              <h3 class="mt-5 text-xl font-semibold text-white">Ptah</h3>
              <p class="text-sm text-ink-400">{{ freePlan.idealFor }}</p>
              <div class="mt-5 flex items-baseline gap-2">
                <span class="text-5xl font-bold text-white">Free</span>
                <span class="font-mono text-xs text-ink-500"
                  >/ open source</span
                >
              </div>
              <div class="h-px bg-ink-800 my-6"></div>
              <ul class="space-y-2.5 flex-1">
                @for (f of freePlan.features; track f) {
                  <li class="flex items-start gap-2.5 text-sm text-ink-300">
                    <lucide-angular
                      [img]="CheckIcon"
                      class="w-4 h-4 text-emerald-400 mt-0.5 shrink-0"
                    />
                    {{ f }}
                  </li>
                }
              </ul>
              <button class="mt-8 cta cta-free">
                <lucide-angular [img]="DownloadIcon" class="w-4 h-4" />
                Download Free
              </button>
            </div>

            <!-- Builders card (spotlight) -->
            <div
              class="reveal relative flex flex-col rounded-2xl border border-amber-500/50 bg-gradient-to-b from-amber-500/[0.07] to-ink-900/50 p-7 lg:p-8 shadow-xl shadow-amber-500/10"
              style="--reveal-delay: 0.12s"
            >
              <div
                class="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full bg-gradient-to-r from-amber-500 to-secondary text-ink-950 font-mono text-[10px] font-bold uppercase tracking-[0.15em] shadow-lg shadow-amber-500/30"
              >
                Founding Member
              </div>
              <div
                class="self-start px-3 py-1 rounded-full bg-amber-500/15 text-amber-300 font-mono text-[10px] font-bold uppercase tracking-[0.15em] mt-1"
              >
                Membership
              </div>
              <h3 class="mt-5 text-xl font-semibold text-white">
                Ptah Builders
              </h3>
              <p class="text-sm text-ink-400">{{ buildersPlan.idealFor }}</p>
              <div class="mt-5 flex items-baseline gap-2">
                <span
                  class="text-5xl font-bold whitespace-nowrap bg-gradient-to-r from-amber-300 to-secondary bg-clip-text text-transparent"
                  >{{ buildersPlan.price }}</span
                >
                <span class="font-mono text-xs text-ink-500"
                  >/ mo · founding price</span
                >
              </div>
              <div class="h-px bg-amber-500/15 my-6"></div>
              <div
                class="font-mono text-[10px] uppercase tracking-[0.2em] text-amber-500/70 mb-3"
              >
                Everything free, plus
              </div>
              <ul class="space-y-2.5 flex-1">
                @for (f of buildersPlan.features; track f) {
                  <li class="flex items-start gap-2.5 text-sm text-ink-200">
                    <lucide-angular
                      [img]="CheckIcon"
                      class="w-4 h-4 text-amber-400 mt-0.5 shrink-0"
                    />
                    {{ f }}
                  </li>
                }
              </ul>
              <button class="mt-8 cta cta-builders">
                Join the Builders Waitlist
                <lucide-angular [img]="ArrowRightIcon" class="w-4 h-4" />
              </button>
              <ng-container
                [ngTemplateOutlet]="promo"
                [ngTemplateOutletContext]="{ id: 'v2' }"
              />
            </div>
          </div>
        </div>
      </section>

      <!-- ============ V3 · CAPABILITY MATRIX ============ -->
      <section id="v3">
        <div class="max-w-5xl mx-auto px-6 py-24">
          <div class="reveal">
            <span class="lab-tag">Variation 3 · Capability Matrix</span>
            <h2 class="v-head mt-8 max-w-2xl">
              One table. Two ways to build with Ptah.
            </h2>
            <p class="v-lede mt-5 max-w-2xl">
              Everything in the free column ships in the open-source app. The
              Builders column is what a founding membership adds on top.
            </p>
          </div>

          <div
            class="reveal mt-12 rounded-2xl border border-ink-700 overflow-hidden"
            style="--reveal-delay: 0.1s"
          >
            <!-- header row -->
            <div
              class="grid grid-cols-[1fr_7rem_9rem] sm:grid-cols-[1fr_9rem_11rem] items-end gap-2 px-5 sm:px-7 py-6 bg-ink-900/60 border-b border-ink-700"
            >
              <div
                class="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-500 self-center"
              >
                Capability
              </div>
              <div class="text-center">
                <div class="text-lg font-bold text-white leading-none">
                  Free
                </div>
                <div class="font-mono text-[9px] text-emerald-400/80 mt-1">
                  open source
                </div>
              </div>
              <div class="text-center">
                <div
                  class="text-lg font-bold leading-none bg-gradient-to-r from-amber-300 to-secondary bg-clip-text text-transparent"
                >
                  {{ buildersPlan.price }}
                </div>
                <div class="font-mono text-[9px] text-amber-500/80 mt-1">
                  Builders / mo
                </div>
              </div>
            </div>

            <!-- capability rows -->
            @for (row of matrix; track row.label) {
              <div
                class="grid grid-cols-[1fr_7rem_9rem] sm:grid-cols-[1fr_9rem_11rem] items-center gap-2 px-5 sm:px-7 py-3.5 border-b border-ink-800 last:border-0"
              >
                <span class="text-sm text-ink-200">{{ row.label }}</span>
                <span class="flex justify-center">
                  @if (row.free) {
                    <lucide-angular
                      [img]="CheckIcon"
                      class="w-4 h-4 text-emerald-400"
                    />
                  } @else {
                    <lucide-angular
                      [img]="XIcon"
                      class="w-4 h-4 text-ink-600"
                    />
                  }
                </span>
                <span class="flex justify-center">
                  <lucide-angular
                    [img]="CheckIcon"
                    class="w-4 h-4 text-amber-400"
                  />
                </span>
              </div>
            }

            <!-- CTA row -->
            <div
              class="grid grid-cols-[1fr_7rem_9rem] sm:grid-cols-[1fr_9rem_11rem] items-start gap-2 px-5 sm:px-7 py-6 bg-ink-950/60"
            >
              <div class="self-center">
                <div
                  class="font-mono text-[10px] uppercase tracking-[0.15em] text-ink-500"
                >
                  Founding-member pricing, locked in
                </div>
              </div>
              <div class="flex justify-center">
                <button class="cta cta-free cta-compact">
                  <lucide-angular [img]="DownloadIcon" class="w-3.5 h-3.5" />
                  Free
                </button>
              </div>
              <div class="flex flex-col items-center gap-2">
                <button class="cta cta-builders cta-compact">
                  Join Waitlist
                  <lucide-angular [img]="ArrowRightIcon" class="w-3.5 h-3.5" />
                </button>
                <ng-container
                  [ngTemplateOutlet]="promo"
                  [ngTemplateOutletContext]="{ id: 'v3' }"
                />
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>

    <!-- ===== shared promo affordance (lives inside the Builders card) ===== -->
    <ng-template #promo let-id="id">
      <div class="mt-4 flex flex-col items-center gap-2">
        <button
          type="button"
          class="flex items-center gap-1.5 text-xs text-ink-400 hover:text-ink-100 transition-colors"
          (click)="togglePromo(id)"
        >
          <lucide-angular [img]="TagIcon" class="w-3.5 h-3.5" />
          Have a promo code?
          <lucide-angular
            [img]="ChevronDownIcon"
            class="w-3 h-3 transition-transform duration-200"
            [class.rotate-180]="openPromo() === id"
          />
        </button>
        @if (openPromo() === id) {
          <input
            type="text"
            class="w-44 rounded-md border border-ink-600 bg-ink-950 px-3 py-1.5 text-center font-mono text-sm uppercase tracking-wider text-ink-100 placeholder:text-ink-600 focus:border-amber-500/60 focus:outline-none"
            placeholder="ENTER CODE"
            maxlength="50"
            autocomplete="off"
            aria-label="Promo code"
          />
        }
      </div>
    </ng-template>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .lab-tag {
        display: inline-block;
        font-family: 'JetBrains Mono', monospace;
        font-size: 11px;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        color: #f5a524;
        border: 1px solid rgba(245, 165, 36, 0.3);
        border-radius: 999px;
        padding: 4px 12px;
      }

      .v-head {
        color: #fff;
        font-weight: 700;
        letter-spacing: -0.02em;
        line-height: 1.1;
        font-size: clamp(1.85rem, 1.2rem + 2.6vw, 3rem);
        text-wrap: balance;
      }

      .v-lede {
        color: #b7bdc9;
        font-size: 1.05rem;
        line-height: 1.7;
        max-width: 42rem;
        text-wrap: pretty;
      }

      /* shared CTA button shapes */
      .cta {
        width: 100%;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        padding: 0.8rem 1.25rem;
        border-radius: 0.75rem;
        font-size: 0.875rem;
        font-weight: 600;
        transition:
          filter 0.25s ease,
          gap 0.25s ease;
      }
      .cta:hover {
        gap: 0.75rem;
        filter: brightness(1.08);
      }
      .cta-compact {
        width: auto;
        padding: 0.5rem 0.9rem;
        font-size: 0.8rem;
        border-radius: 0.6rem;
      }
      .cta-free {
        background: linear-gradient(90deg, #059669, #10b981);
        color: #fff;
      }
      .cta-builders {
        background: linear-gradient(90deg, #f5a524, #34d399);
        color: #0b0d10;
      }

      /* reduced-motion-safe entrance */
      .reveal {
        opacity: 0;
        transform: translateY(16px);
        animation: reveal 0.7s cubic-bezier(0.22, 1, 0.36, 1) forwards;
        animation-delay: var(--reveal-delay, 0s);
      }
      @keyframes reveal {
        to {
          opacity: 1;
          transform: none;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .reveal {
          animation: none;
          opacity: 1;
          transform: none;
        }
      }
    `,
  ],
})
export class PricingLabPageComponent {
  public readonly CheckIcon = Check;
  public readonly XIcon = X;
  public readonly TagIcon = Tag;
  public readonly ChevronDownIcon = ChevronDown;
  public readonly ArrowRightIcon = ArrowRight;
  public readonly DownloadIcon = Download;

  /** Which variation's promo input is expanded (only one at a time). */
  public readonly openPromo = signal<string | null>(null);

  public readonly variations = [
    { id: 'v1', n: '1', short: 'Ledger' },
    { id: 'v2', n: '2', short: 'Spotlight' },
    { id: 'v3', n: '3', short: 'Matrix' },
  ];

  public readonly freePlan = {
    idealFor: 'The full desktop app — no catch',
    features: [
      'Memory, Skills, Cron, and Gateway suite',
      'Bring any of 7 model providers',
      'Native VS Code integration',
      'Real-time streaming responses',
      'Session history and management',
      'Tree-sitter workspace intelligence',
    ],
  };

  public readonly buildersPlan = {
    price: '$29-49',
    idealFor: 'Live training and curriculum for shipping SaaS',
    features: [
      'Everything in Ptah (it is free)',
      'Weekly live build sessions',
      'PRD-to-production curriculum',
      'Member skill packs',
      'Priority support',
      'Founding-member pricing, locked in',
    ],
  };

  /** V3 matrix: free column varies, Builders column is always included. */
  public readonly matrix = [
    { label: 'Memory, Skills, Cron & Gateway suite', free: true },
    { label: 'Bring any of 7 model providers', free: true },
    { label: 'Native VS Code integration', free: true },
    { label: 'Tree-sitter workspace intelligence', free: true },
    { label: 'Weekly live build sessions', free: false },
    { label: 'PRD-to-production curriculum', free: false },
    { label: 'Member skill packs', free: false },
    { label: 'Priority support', free: false },
  ];

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    afterNextRender(() => {
      const mm = gsap.matchMedia();
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        this.runSeatsMeter(this.host.nativeElement);
      });
      this.destroyRef.onDestroy(() => mm.revert());
    });
  }

  /** Expand the promo input for one variation, collapsing any other. */
  public togglePromo(id: string): void {
    this.openPromo.update((cur) => (cur === id ? null : id));
  }

  /**
   * V1 scarcity meter: count the seat number up to 47 and grow the bar from 0,
   * once, on scroll into view. Static DOM already shows the resolved 47% state,
   * so reduced-motion / no-JS render correctly without this.
   */
  private runSeatsMeter(host: HTMLElement): void {
    const root = host.querySelector<HTMLElement>('[data-seats]');
    const bar = root?.querySelector<HTMLElement>('[data-seat-bar]');
    const count = root?.querySelector<HTMLElement>('[data-seat-count]');
    if (!root || !bar || !count) return;

    const target = 47;
    gsap.set(bar, { width: '0%' });
    const state = { v: 0 };

    ScrollTriggerless(root, () => {
      gsap.to(bar, {
        width: `${target}%`,
        duration: 1.4,
        ease: 'power2.out',
      });
      gsap.to(state, {
        v: target,
        duration: 1.4,
        ease: 'power2.out',
        onUpdate: () => {
          count.textContent = String(Math.round(state.v));
        },
      });
    });

    function ScrollTriggerless(el: HTMLElement, onEnter: () => void): void {
      const io = new IntersectionObserver(
        (entries, obs) => {
          for (const e of entries) {
            if (e.isIntersecting) {
              onEnter();
              obs.disconnect();
            }
          }
        },
        { threshold: 0.4 },
      );
      io.observe(el);
    }
  }
}
