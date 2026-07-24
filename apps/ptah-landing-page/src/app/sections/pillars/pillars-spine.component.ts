import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  inject,
} from '@angular/core';
import { NgClass } from '@angular/common';
import {
  ArrowRight,
  Bot,
  Brain,
  Clock,
  Code,
  LayoutGrid,
  LucideAngularModule,
  MessageSquare,
  Search,
  ShieldCheck,
  Sparkles,
  Workflow,
  type LucideIconData,
} from 'lucide-angular';
import {
  ScrollAnimationConfig,
  ScrollAnimationDirective,
} from '@hive-academy/angular-gsap';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ConsoleGridBackgroundComponent } from '../../components/console/console-grid-background.component';
import { MemoryRecallDiagramComponent } from '../../components/console/memory-recall-diagram.component';
import { OrchestraFanoutDiagramComponent } from '../../components/console/orchestra-fanout-diagram.component';
import { AlwaysOnLoopDiagramComponent } from '../../components/console/alwayson-loop-diagram.component';

type DiagramKind = 'memory' | 'orchestra' | 'alwayson';

interface FeaturePoint {
  readonly icon: LucideIconData;
  readonly title: string;
  readonly body: string;
}

interface GhostLink {
  readonly label: string;
  readonly href: string;
}

interface Pillar {
  readonly n: string;
  readonly anchor: string;
  readonly eyebrow: string;
  readonly headline: string;
  readonly lede: string;
  readonly points: readonly FeaturePoint[];
  readonly stat: string;
  readonly ghost?: GhostLink;
  readonly diagram: DiagramKind;
  /** Which side the mechanism diagram sits on at lg+, for rhythm. */
  readonly side: 'left' | 'right';
}

gsap.registerPlugin(ScrollTrigger);

/**
 * PillarsSpineComponent — production S4–S6: the three product pillars threaded by
 * one central, scroll-drawn "timeline spine". Each pillar is a chapter whose
 * visual hero is a self-animating mechanism diagram (memory recall, orchestra
 * fan-out, always-on loop); the ribbon between them draws on scroll and each
 * numbered node ignites as its chapter enters.
 *
 * Renders eagerly (not `@defer`) so every citable claim ships in the prerendered
 * HTML. The diagram is the visual lead, but the eyebrow, `<h2>`, lede, feature
 * points, and stat are all real, indexable text. Deep-link anchors preserved:
 * `#memory-intelligence`, `#skills-orchestration`, `#always-on`; the section owns
 * `#features`.
 *
 * SSG / reduced-motion safe: resting DOM is the fully-resolved still (ribbon
 * drawn, nodes lit, diagrams un-transformed, all copy opaque). Scroll motion is
 * gated behind `gsap.matchMedia('(prefers-reduced-motion: no-preference)')` in
 * `afterNextRender`; every ScrollTrigger is killed and the context reverted on
 * destroy. On mobile the centered ribbon + nodes are hidden and chapters stack
 * single-column.
 */
@Component({
  selector: 'ptah-pillars-spine',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NgClass,
    LucideAngularModule,
    ScrollAnimationDirective,
    ConsoleGridBackgroundComponent,
    MemoryRecallDiagramComponent,
    OrchestraFanoutDiagramComponent,
    AlwaysOnLoopDiagramComponent,
  ],
  template: `
    <section
      id="features"
      aria-label="The three pillars — memory, orchestration, and always-on delivery"
      class="relative bg-ink-950 overflow-hidden"
    >
      <ptah-console-grid-background [glow]="true" />

      <div
        data-spine
        class="relative z-10 max-w-6xl mx-auto px-6 py-20 sm:py-28"
      >
        <!-- central drawing ribbon (lg+ only) -->
        <svg
          aria-hidden="true"
          class="hidden lg:block absolute left-1/2 -translate-x-1/2 top-0 h-full w-6"
          viewBox="0 0 10 1000"
          preserveAspectRatio="none"
          fill="none"
        >
          <defs>
            <linearGradient id="pillars-ribbon" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="#f5a524" />
              <stop offset="1" stop-color="#f5a524" stop-opacity="0.35" />
            </linearGradient>
          </defs>
          <path d="M5 0 L5 1000" stroke="#262a33" stroke-width="2" />
          <path
            data-v1-ribbon
            d="M5 0 L5 1000"
            stroke="url(#pillars-ribbon)"
            stroke-width="2"
            pathLength="1"
          />
        </svg>

        @for (p of pillars; track p.anchor) {
          <article
            [id]="p.anchor"
            data-v1-chapter
            class="relative scroll-mt-24 py-14 lg:py-24"
          >
            <div
              data-v1-node
              aria-hidden="true"
              class="ribbon-node hidden lg:flex absolute left-1/2 -translate-x-1/2 -top-3 z-20 w-12 h-12 rounded-full border border-amber-500/40 bg-ink-950 items-center justify-center font-mono text-sm text-amber-500"
            >
              {{ p.n }}
            </div>

            <!-- Row 1 · diagram beside the title + lede (balanced heights) -->
            <div
              class="grid lg:grid-cols-2 gap-10 lg:gap-14 items-center pt-4 lg:pt-8"
            >
              <!-- intro (SEO copy: eyebrow + headline + lede) -->
              <div
                scrollAnimation
                [scrollConfig]="headlineConfig"
                [ngClass]="p.side === 'left' ? 'lg:order-1' : 'lg:order-2'"
              >
                <span
                  class="font-mono text-xs uppercase tracking-[0.2em] text-amber-500/80 inline-block"
                  >{{ p.eyebrow }}</span
                >
                <h2
                  class="mt-4 text-3xl sm:text-4xl font-bold tracking-tight text-white leading-tight [text-wrap:balance]"
                >
                  {{ p.headline }}
                </h2>
                <p
                  class="mt-4 text-base sm:text-lg text-ink-400 leading-relaxed"
                >
                  {{ p.lede }}
                </p>

                <p class="mt-5 font-mono text-xs text-ink-500 leading-relaxed">
                  {{ p.stat }}
                </p>

                @if (p.ghost; as ghost) {
                  <a
                    [href]="ghost.href"
                    target="_blank"
                    rel="noopener"
                    class="mt-5 inline-flex items-center gap-2.5 text-amber-500 hover:text-amber-400 font-medium text-sm transition-colors"
                  >
                    {{ ghost.label }}
                    <span
                      class="w-8 h-8 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center"
                    >
                      <lucide-angular
                        [img]="arrowRight"
                        class="w-4 h-4"
                        aria-hidden="true"
                      />
                    </span>
                  </a>
                }
              </div>

              <!-- mechanism diagram (visual hero, y-parallax) -->
              <div [ngClass]="p.side === 'left' ? 'lg:order-2' : 'lg:order-1'">
                <div
                  data-v1-device
                  class="will-change-transform rounded-2xl border border-ink-700 bg-ink-900/60 p-3 sm:p-4"
                >
                  @switch (p.diagram) {
                    @case ('memory') {
                      <ptah-memory-recall-diagram />
                    }
                    @case ('orchestra') {
                      <ptah-orchestra-fanout-diagram />
                    }
                    @case ('alwayson') {
                      <ptah-alwayson-loop-diagram />
                    }
                  }
                </div>
              </div>
            </div>

            <!-- Row 2 · feature cards, full width -->
            <div
              scrollAnimation
              [scrollConfig]="listConfig"
              class="relative mt-10 lg:mt-14"
            >
              <ul class="grid gap-4 sm:gap-5 sm:grid-cols-2 lg:grid-cols-3">
                @for (point of p.points; track point.title; let last = $last) {
                  <li
                    [ngClass]="
                      last && p.points.length === 4 ? 'lg:col-start-2' : ''
                    "
                    class="rounded-xl border border-ink-700 bg-ink-850 p-5 sm:p-6 transition-colors duration-200 hover:border-amber-500/30"
                  >
                    <span
                      class="w-10 h-10 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center"
                    >
                      <lucide-angular
                        [img]="point.icon"
                        class="w-5 h-5 text-amber-500"
                        aria-hidden="true"
                      />
                    </span>
                    <h3 class="mt-4 text-base font-semibold text-white">
                      {{ point.title }}
                    </h3>
                    <p class="mt-2 text-sm text-ink-400 leading-relaxed">
                      {{ point.body }}
                    </p>
                  </li>
                }
              </ul>
            </div>
          </article>
        }
      </div>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      /* numbered nodes ignite when their chapter is active */
      .ribbon-node {
        transition:
          box-shadow 0.35s ease,
          border-color 0.35s ease;
      }
      .ribbon-node.is-active {
        border-color: #f5a524;
        box-shadow: 0 0 0 4px rgba(245, 165, 36, 0.15);
      }
    `,
  ],
})
export class PillarsSpineComponent {
  protected readonly arrowRight = ArrowRight;

  protected readonly pillars: readonly Pillar[] = [
    {
      n: '01',
      anchor: 'memory-intelligence',
      eyebrow: 'PILLAR 1 — KNOWS YOUR ARCHITECTURE',
      headline: 'It Knows Your Architecture. It Never Re-Learns It.',
      lede: 'Vibe-coded prototypes forget every session — that is how duplicate services and missing auth checks pile up. Ptah indexes your project before the first message and keeps the decisions it makes after the last one, so feature ten stays as consistent as feature one.',
      points: [
        {
          icon: Brain,
          title: 'Persistent Memory',
          body: 'Hybrid BM25 and vector search, fused with Reciprocal Rank Fusion, recalls the architectural decisions, security fixes, and data-model conventions from session one — so the agent building feature five does not reinvent the auth pattern from feature one.',
        },
        {
          icon: Code,
          title: 'Tree-sitter Codebase Indexing',
          body: 'Structural AST parsing across JavaScript, TypeScript, Python, and Go indexes every function, class, and import with exact file positions — the same map every agent works from, not a fresh guess per session.',
        },
        {
          icon: Search,
          title: 'Hybrid Symbol Search',
          body: "Ask 'where do we validate auth tokens' in plain English and get ranked, cited results injected straight into agent context.",
        },
      ],
      stat: 'Hybrid BM25 + vector memory search, fused with Reciprocal Rank Fusion.',
      ghost: { label: 'See how memory works', href: 'https://docs.ptah.live' },
      diagram: 'memory',
      side: 'left',
    },
    {
      n: '02',
      anchor: 'skills-orchestration',
      eyebrow: 'PILLAR 2 — A STAFFED TEAM, NOT A SOLO AGENT',
      headline:
        'Delivery Patterns That Compound. A Staffed Team That Ships Them.',
      lede: 'Ptah is not one generalist agent guessing at your stack — it is a staffed team: architect, backend developer, frontend developer, tester, and reviewer, each reusing the delivery pattern that worked last time instead of relearning it from scratch.',
      points: [
        {
          icon: Sparkles,
          title: 'Auto-Learning Skills Curator',
          body: 'When a delivery pattern succeeds — a tenant-isolation guard, a billing webhook, a migration — Ptah extracts the trajectory, judges its quality, and promotes it to a permanent, shareable SKILL.md file. The tenth SaaS you ship reuses what the first one learned.',
        },
        {
          icon: Bot,
          title: 'Sub-Agent Orchestration',
          body: 'A main agent fans work out to specialist sub-agents — architect, backend developer, frontend developer, tester, reviewer — across a three-tier hierarchy, each with its own provider, model, and context window.',
        },
        {
          icon: LayoutGrid,
          title: 'Orchestra Canvas',
          body: 'Run up to nine concurrent agent sessions in one drag-and-resize grid — architecture in one tile, billing integration in another, tests in a third. Background agents keep working while you review a single tile.',
        },
        {
          icon: Workflow,
          title: 'Built-in Workflows & Skills Library',
          body: 'Ship with pre-built delivery patterns for common SaaS stacks — multi-tenant setup, billing integration, auth guards — and browse more from the skills registry, install with one click.',
        },
      ],
      stat: 'Up to 9 concurrent agent tiles — architect, backend, frontend, tester, and reviewer among them — in one gridstack view, each with an independent provider and model.',
      diagram: 'orchestra',
      side: 'right',
    },
    {
      n: '03',
      anchor: 'always-on',
      eyebrow: 'PILLAR 3 — SHIPS OVERNIGHT, APPROVED FROM YOUR PHONE',
      headline: 'It Keeps Shipping Overnight. You Approve From Telegram.',
      lede: 'Schedule the next migration, the nightly security scan, the dependency bump like a cron job. Wake up to a diff waiting for your approval — from Telegram, Discord, or Slack, not a laptop you have to keep open.',
      points: [
        {
          icon: Clock,
          title: 'Cron Scheduler',
          body: 'SQLite-backed, slot-claimed scheduled runs. Nightly security reviews, Sunday dependency scans, the next ticket in the backlog — no server to babysit, no laptop that has to stay open.',
        },
        {
          icon: MessageSquare,
          title: 'Messaging Gateways',
          body: 'Trigger and approve agent work from Telegram, Discord, or Slack, including voice input. Discord supports per-thread multi-session conversations, so each thread keeps its own agent context.',
        },
        {
          icon: ShieldCheck,
          title: 'Approval Relay',
          body: "Review and approve every tool call and diff before it executes — including the ones that touch billing, auth, or tenant isolation — from any connected gateway. Nothing ships unattended that you haven't signed off on.",
        },
      ],
      stat: 'Trigger and approve agent runs — including production-sensitive diffs — from Telegram, Discord, or Slack, including per-thread sessions on Discord.',
      diagram: 'alwayson',
      side: 'left',
    },
  ];

  protected readonly headlineConfig: ScrollAnimationConfig = {
    animation: 'fadeIn',
    duration: 0.6,
    start: 'top 82%',
    once: true,
    ease: 'power2.out',
  };

  protected readonly listConfig: ScrollAnimationConfig = {
    animation: 'slideUp',
    duration: 0.5,
    delay: 0.1,
    start: 'top 85%',
    once: true,
    ease: 'power2.out',
  };

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    afterNextRender(() => {
      const triggers: ScrollTrigger[] = [];
      const mm = gsap.matchMedia();
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        this.buildSpine(this.host.nativeElement, triggers);
      });
      this.destroyRef.onDestroy(() => {
        triggers.forEach((t) => t.kill());
        mm.revert();
      });
    });
  }

  /**
   * Scrub the central ribbon draw across the section and ignite each chapter's
   * numbered node as it enters; give each diagram a y-parallax. Resting DOM shows
   * a fully-drawn ribbon, lit nodes, and un-transformed diagrams.
   */
  private buildSpine(host: HTMLElement, triggers: ScrollTrigger[]): void {
    const root = host.querySelector<HTMLElement>('[data-spine]');
    if (!root) return;

    const ribbon = root.querySelector<SVGPathElement>('[data-v1-ribbon]');
    if (ribbon) {
      gsap.set(ribbon, { strokeDasharray: 1, strokeDashoffset: 1 });
      const tween = gsap.to(ribbon, {
        strokeDashoffset: 0,
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

    const nodes = gsap.utils.toArray<HTMLElement>('[data-v1-node]', root);
    const chapters = gsap.utils.toArray<HTMLElement>('[data-v1-chapter]', root);
    chapters.forEach((chapter, i) => {
      triggers.push(
        ScrollTrigger.create({
          trigger: chapter,
          start: 'top center',
          end: 'bottom center',
          onToggle: (self) =>
            nodes[i]?.classList.toggle('is-active', self.isActive),
        }),
      );
    });

    gsap.utils.toArray<HTMLElement>('[data-v1-device]', root).forEach((d) => {
      const tween = gsap.fromTo(
        d,
        { y: 44 },
        {
          y: -44,
          ease: 'none',
          scrollTrigger: {
            trigger: d,
            start: 'top bottom',
            end: 'bottom top',
            scrub: true,
          },
        },
      );
      if (tween.scrollTrigger) triggers.push(tween.scrollTrigger);
    });
  }
}
