import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  inject,
} from '@angular/core';
import {
  ArrowRight,
  BookOpen,
  Check,
  GraduationCap,
  LifeBuoy,
  LucideAngularModule,
  Package,
} from 'lucide-angular';
import {
  ViewportAnimationConfig,
  ViewportAnimationDirective,
} from '@hive-academy/angular-gsap';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ConsoleGridBackgroundComponent } from '../../components/console/console-grid-background.component';

gsap.registerPlugin(ScrollTrigger);

/** Every lucide icon export shares this structural type. */
type IconRef = typeof GraduationCap;

/** One "Ptah Builders" value proposition (title + body + icon). */
interface ValueProp {
  readonly icon: IconRef;
  readonly title: string;
  readonly body: string;
}

/**
 * BuildersSectionComponent — S8.5 Ptah Builders (content-spec §4). The paid
 * membership that is the product's moat + revenue stream, placed after the
 * Comparison section and before Also Available. Two beats:
 *
 * 1. Offer + Value Rail — a founding-membership card (price, inclusions, CTA)
 *    that stays with you (`lg:sticky`) while, beside it, each value prop ignites
 *    in turn as a scrubbed progress spine draws down the rail.
 * 2. The Compounding Moat — a stacked, auto-scrolling "skill library" wall of
 *    SKILL.md packs that makes the shared, compounding library tangible, closing
 *    on "that shared brain is the moat."
 *
 * Live tokens only (amber #f5a524 + ink ramp). Simple reveals use the
 * `viewportAnimation` directive; the seamless marquee loops, the scrubbed spine
 * and the ignite-on-enter rail nodes use raw gsap + ScrollTrigger, gated behind
 * `gsap.matchMedia('(prefers-reduced-motion: no-preference)')` in
 * `afterNextRender`, with every ScrollTrigger + loop killed and the matchMedia
 * reverted on destroy. Every mechanic resolves to a fully-resolved RESTING state
 * (rail nodes lit, spine full, marquee list visible + wrapped) so the
 * prerendered HTML is correct with JS disabled. The CTA targets `#waitlist`,
 * which `WaitlistFormComponent` (mounted directly below this section on the
 * landing page) renders as the scroll target.
 */
@Component({
  selector: 'ptah-builders-section',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    LucideAngularModule,
    ViewportAnimationDirective,
    ConsoleGridBackgroundComponent,
  ],
  template: `
    <section
      id="builders"
      aria-label="Ptah Builders membership"
      class="relative bg-ink-950 py-24 sm:py-32 overflow-hidden"
    >
      <ptah-console-grid-background [glow]="true" />

      <div class="relative z-10 max-w-7xl mx-auto px-6 sm:px-10 lg:px-16">
        <!-- Offer card + value rail -->
        <div class="grid lg:grid-cols-[0.92fr_1.08fr] gap-10 lg:gap-14">
          <!-- sticky founding offer card -->
          <div class="lg:sticky lg:top-24 self-start">
            <div
              class="rounded-2xl border border-amber-500/25 bg-ink-900/70 p-7 sm:p-8 shadow-xl"
            >
              <span
                class="font-mono text-[11px] uppercase tracking-[0.2em] text-amber-500/80"
                >{{ eyebrow }}</span
              >
              <h2
                class="mt-3 text-2xl sm:text-3xl font-bold tracking-tight text-white leading-snug"
              >
                {{ headline }}
              </h2>
              <p class="mt-4 text-sm sm:text-base text-ink-400 leading-relaxed">
                {{ subhead }}
              </p>

              <div
                class="mt-6 rounded-xl border border-ink-800 bg-ink-950/50 p-4 space-y-1.5"
              >
                <p class="font-mono text-sm text-amber-500">{{ listPrice }}</p>
                <p class="text-xs text-ink-400 leading-relaxed">
                  {{ foundingOffer }}
                </p>
              </div>

              <ul class="mt-6 space-y-3" role="list">
                @for (vp of valueProps; track vp.title) {
                  <li class="flex items-start gap-2.5 text-sm text-ink-200">
                    <lucide-angular
                      [img]="checkIcon"
                      class="w-4 h-4 text-amber-500 mt-0.5 shrink-0"
                      aria-hidden="true"
                    />
                    {{ vp.title }}
                  </li>
                }
              </ul>

              <a
                [href]="ctaHref"
                [class]="ctaClass + ' mt-7 w-full'"
                [attr.aria-label]="ctaAria"
              >
                <lucide-angular
                  [img]="arrowRight"
                  class="w-4 h-4"
                  aria-hidden="true"
                />
                {{ ctaLabel }}
              </a>
              <span class="block text-xs text-ink-500 mt-3 text-center">
                {{ reassurance }}
              </span>
            </div>
          </div>

          <!-- value rail -->
          <div data-rail class="relative pl-8">
            <!-- scrubbed progress spine -->
            <div
              aria-hidden="true"
              class="absolute left-3 top-0 bottom-0 w-px bg-ink-800"
            >
              <div
                data-rail-spine
                class="absolute inset-x-0 top-0 h-full origin-top bg-gradient-to-b from-amber-500 via-amber-500/60 to-amber-500/20"
              ></div>
            </div>

            <div class="space-y-6">
              @for (vp of valueProps; track vp.title; let i = $index) {
                <div
                  data-rail-node
                  class="rail-node is-active relative"
                  viewportAnimation
                  [viewportConfig]="railConfig(i)"
                >
                  <span
                    class="rail-dot absolute -left-[1.68rem] top-6 w-3 h-3 rounded-full bg-ink-700 border border-ink-600"
                    aria-hidden="true"
                  ></span>
                  <div
                    class="rail-card rounded-xl border border-ink-800 bg-ink-900/40 p-6"
                  >
                    <div class="flex items-center gap-3 mb-3">
                      <span
                        class="w-10 h-10 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0"
                      >
                        <lucide-angular
                          [img]="vp.icon"
                          class="w-5 h-5 text-amber-500"
                          aria-hidden="true"
                        />
                      </span>
                      <h3 class="text-base font-semibold text-white">
                        {{ vp.title }}
                      </h3>
                    </div>
                    <p class="text-sm text-ink-400 leading-relaxed">
                      {{ vp.body }}
                    </p>
                  </div>
                </div>
              }
            </div>
          </div>
        </div>

        <!-- The compounding moat · stacked skill-library marquees -->
        <div class="mt-16 sm:mt-20">
          <p
            class="font-mono text-xs uppercase tracking-[0.2em] text-amber-500/80 mb-4 text-center"
          >
            The shared brain that compounds
          </p>
          <div
            data-moat
            class="relative rounded-3xl border border-amber-500/15 bg-amber-500/[0.03] overflow-hidden"
          >
            <div class="relative z-10 py-10 space-y-3 marquee-mask">
              @for (row of skillWall; track $index) {
                <div class="overflow-hidden">
                  <div
                    data-wall-row
                    class="marquee-track flex flex-wrap gap-3 justify-center"
                  >
                    @for (pack of row; track pack) {
                      <span
                        class="inline-flex items-center gap-2 rounded-lg border border-ink-700 bg-ink-900/70 px-4 py-2 font-mono text-sm text-ink-300 whitespace-nowrap"
                      >
                        <span
                          class="w-1.5 h-1.5 rounded-full bg-amber-500/70"
                          aria-hidden="true"
                        ></span>
                        {{ pack }}<span class="text-ink-600">/SKILL.md</span>
                      </span>
                    }
                  </div>
                </div>
              }
            </div>
          </div>
          <p
            class="mt-6 max-w-2xl mx-auto text-center text-base text-ink-400 leading-relaxed"
          >
            Every pattern a Builder extracts becomes one more thing the next
            build starts with — a library that grows, is shared, and compounds.
            That shared brain is the moat.
          </p>
        </div>
      </div>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      /* Marquee track + soft edge fade. Motion is applied in JS only (matchMedia
         no-preference); the resting DOM is a wrapped, visible list. */
      .marquee-track {
        will-change: transform;
      }
      .marquee-mask {
        -webkit-mask-image: linear-gradient(
          to right,
          transparent,
          #000 8%,
          #000 92%,
          transparent
        );
        mask-image: linear-gradient(
          to right,
          transparent,
          #000 8%,
          #000 92%,
          transparent
        );
      }

      /* Rail node ignite. Resting DOM keeps .is-active lit; JS un-lights then
         re-ignites each node on scroll. */
      .rail-dot {
        transition:
          background-color 0.3s ease,
          border-color 0.3s ease,
          box-shadow 0.3s ease;
      }
      .rail-node.is-active .rail-dot {
        background-color: #f5a524;
        border-color: #f5a524;
        box-shadow:
          0 0 0 4px rgba(245, 165, 36, 0.12),
          0 0 14px rgba(245, 165, 36, 0.5);
      }
      .rail-card {
        transition: border-color 0.3s ease;
      }
      .rail-node.is-active .rail-card {
        border-color: rgba(245, 165, 36, 0.35);
      }
    `,
  ],
})
export class BuildersSectionComponent {
  protected readonly arrowRight = ArrowRight;
  protected readonly checkIcon = Check;

  /** Verbatim copy from the S8.5 "Ptah Builders" content spec. */
  protected readonly eyebrow = 'PTAH BUILDERS — FOUNDING WAITLIST';
  protected readonly headline =
    'Ship Production SaaS Faster — With Builders Who Have Already Done It.';
  protected readonly subhead =
    'Ptah the app is free and open source. Ptah Builders is where you go deeper: live build sessions, a PRD-to-production curriculum, and the delivery patterns other builders have already turned into skills.';
  /** List pricing once Builders checkout opens. */
  protected readonly listPrice = '$29/mo or $290/yr at launch.';
  /** Founding-waitlist discount terms, applied automatically at launch invite. */
  protected readonly foundingOffer =
    'Join the waitlist now to lock in a founding-member spot: 35% off monthly (first 12 months) or 50% off yearly (first year) when Builders opens, plus early access.';
  protected readonly reassurance =
    "Membership isn't purchasable yet — join the waitlist and we'll email your founding invite (with a 30-day money-back guarantee) the moment it opens. No spam.";
  protected readonly ctaLabel = 'Join the Waitlist';
  protected readonly ctaHref = '#waitlist';
  protected readonly ctaAria = 'Join the Ptah Builders waitlist';

  /** Shared amber CTA button styling. */
  protected readonly ctaClass =
    'inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-lg bg-amber-500 text-ink-950 font-semibold text-sm transition-all duration-200 hover:bg-amber-400 hover:-translate-y-0.5 hover:shadow-glow-amber active:bg-amber-600 active:translate-y-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 focus-visible:outline-offset-2';

  protected readonly valueProps: readonly ValueProp[] = [
    {
      icon: GraduationCap,
      title: 'Live Training Sessions',
      body: 'Weekly live sessions where we ship a real feature end-to-end — multi-tenant auth, billing integration, a security-review pass — and take questions on your build.',
    },
    {
      icon: BookOpen,
      title: 'PRD-to-Production Curriculum',
      body: 'A structured path from a one-page PRD to a production-shaped SaaS: architecture decisions, tenant isolation, billing integration, and the review gates a solo prototype skips.',
    },
    {
      icon: Package,
      title: 'Member Skill Packs',
      body: 'Delivery patterns other Builders have already extracted and shared as SKILL.md packs — install the multi-tenant guard or billing webhook someone else already got right.',
    },
    {
      icon: LifeBuoy,
      title: 'Priority Support',
      body: 'Direct access for build questions and architecture reviews, ahead of the public queue.',
    },
  ];

  /**
   * Illustrative SKILL.md packs for the moat wall (three marquee rows) —
   * placeholder UI labels, NOT product claims.
   */
  protected readonly skillWall: readonly (readonly string[])[] = [
    [
      'multi-tenant-guard',
      'billing-webhook-reconcile',
      'rls-policy',
      'stripe-idempotency',
      'oauth-pkce-flow',
    ],
    [
      'audit-log-trail',
      'rate-limit-guard',
      'soft-delete-cascade',
      'tenant-scoped-cache',
      'webhook-retry-queue',
    ],
    [
      'jwt-rotation',
      'feature-flag-gate',
      'db-migration-guard',
      'csrf-double-submit',
      'idempotency-key-store',
    ],
  ];

  /** Staggered slide-up reveal for each rail node card. */
  protected railConfig(index: number): ViewportAnimationConfig {
    return {
      animation: 'slideUp',
      duration: 0.5,
      delay: index * 0.06,
      threshold: 0.2,
      ease: 'power2.out',
    };
  }

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    afterNextRender(() => {
      const host = this.host.nativeElement;
      const triggers: ScrollTrigger[] = [];
      const cleanups: Array<() => void> = [];
      const mm = gsap.matchMedia();
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        this.buildRail(host, triggers);
        this.buildMoatWall(host, cleanups);
      });
      this.destroyRef.onDestroy(() => {
        triggers.forEach((t) => t.kill());
        cleanups.forEach((fn) => fn());
        mm.revert();
      });
    });
  }

  /**
   * Scrub the progress spine's vertical draw down the rail, and toggle each
   * node's `.is-active` ignite as it crosses the viewport. Resting DOM keeps the
   * spine full and every node lit; JS resets both before re-driving them.
   */
  private buildRail(host: HTMLElement, triggers: ScrollTrigger[]): void {
    const root = host.querySelector<HTMLElement>('[data-rail]');
    if (!root) return;

    const spine = root.querySelector<HTMLElement>('[data-rail-spine]');
    if (spine) {
      gsap.set(spine, { scaleY: 0, transformOrigin: 'top' });
      const tween = gsap.to(spine, {
        scaleY: 1,
        ease: 'none',
        scrollTrigger: {
          trigger: root,
          start: 'top center',
          end: 'bottom bottom',
          scrub: true,
        },
      });
      if (tween.scrollTrigger) triggers.push(tween.scrollTrigger);
    }

    gsap.utils
      .toArray<HTMLElement>('[data-rail-node]', root)
      .forEach((node) => {
        node.classList.remove('is-active');
        triggers.push(
          ScrollTrigger.create({
            trigger: node,
            start: 'top 78%',
            end: 'bottom 45%',
            onEnter: () => node.classList.add('is-active'),
            onEnterBack: () => node.classList.add('is-active'),
            onLeaveBack: () => node.classList.remove('is-active'),
          }),
        );
      });
  }

  /**
   * Loop each pack row as a seamless marquee, alternating direction row to row.
   * Resting DOM shows the wrapped, centered library.
   */
  private buildMoatWall(host: HTMLElement, cleanups: Array<() => void>): void {
    const root = host.querySelector<HTMLElement>('[data-moat]');
    if (!root) return;
    gsap.utils
      .toArray<HTMLElement>('[data-wall-row]', root)
      .forEach((row, i) => {
        this.buildMarquee(
          row,
          { reverse: i % 2 === 1, duration: 30 + i * 6 },
          cleanups,
        );
      });
  }

  /**
   * Seamless horizontal marquee. Switch the resting flex-wrap track to a single
   * nowrap line, duplicate its chips for a gapless wrap, then loop xPercent
   * forever (pause on hover). Pure JS, so reduced-motion / SSG keep the wrapped,
   * fully-visible list.
   */
  private buildMarquee(
    track: HTMLElement | null,
    opts: { reverse?: boolean; duration?: number },
    cleanups: Array<() => void>,
  ): void {
    if (!track) return;
    track.classList.remove('flex-wrap');
    track.classList.add('flex-nowrap');
    Array.from(track.children).forEach((child) => {
      const clone = child.cloneNode(true) as HTMLElement;
      clone.setAttribute('aria-hidden', 'true');
      track.appendChild(clone);
    });

    const from = opts.reverse ? -50 : 0;
    const to = opts.reverse ? 0 : -50;
    gsap.set(track, { xPercent: from });
    const loop = gsap.to(track, {
      xPercent: to,
      duration: opts.duration ?? 26,
      ease: 'none',
      repeat: -1,
    });

    const pause = (): void => {
      loop.pause();
    };
    const play = (): void => {
      loop.play();
    };
    track.addEventListener('mouseenter', pause);
    track.addEventListener('mouseleave', play);
    cleanups.push(() => {
      loop.kill();
      track.removeEventListener('mouseenter', pause);
      track.removeEventListener('mouseleave', play);
    });
  }
}
