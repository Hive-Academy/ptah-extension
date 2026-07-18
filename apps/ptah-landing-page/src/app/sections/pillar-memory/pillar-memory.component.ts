import { ChangeDetectionStrategy, Component } from '@angular/core';
import {
  ArrowRight,
  Brain,
  Code,
  LucideAngularModule,
  Search,
} from 'lucide-angular';
import {
  ViewportAnimationConfig,
  ViewportAnimationDirective,
} from '@hive-academy/angular-gsap';
import { ConsoleGridBackgroundComponent } from '../../components/console/console-grid-background.component';
import { DeviceFrameComponent } from '../../components/console/device-frame.component';
import { MemoryTimelineMockComponent } from '../../components/console/memory-timeline-mock.component';

/**
 * PillarMemoryComponent — S4 Pillar 1: Memory & Codebase Intelligence
 * (design spec §4 S4, copy deck S4). Hybrid layout: centered section header +
 * coded `MemoryTimelineMockComponent` device visual + 3-card feature grid +
 * citable stat callout + a low-commitment ghost link. Every entrance is
 * opacity/transform only (final DOM state fully opaque) so the prerendered HTML
 * is correct with JS disabled.
 */
@Component({
  selector: 'ptah-pillar-memory',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    LucideAngularModule,
    ViewportAnimationDirective,
    ConsoleGridBackgroundComponent,
    DeviceFrameComponent,
    MemoryTimelineMockComponent,
  ],
  template: `
    <section
      id="memory-intelligence"
      aria-label="Pillar 1 — memory and codebase intelligence"
      class="relative bg-ink-950 py-24 sm:py-32 overflow-hidden"
    >
      <ptah-console-grid-background [glow]="true" />

      <div class="relative z-10 max-w-7xl mx-auto px-6 sm:px-10 lg:px-16">
        <!-- Header -->
        <div
          viewportAnimation
          [viewportConfig]="headerConfig"
          class="max-w-3xl mx-auto text-center mb-16"
        >
          <span
            class="font-mono text-xs sm:text-sm uppercase tracking-[0.2em] text-amber-500/80 mb-4 inline-block"
            >PILLAR 1 — KNOWS YOUR ARCHITECTURE</span
          >
          <h2
            class="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-white leading-tight mb-6"
          >
            It Knows Your Architecture. It Never Re-Learns It.
          </h2>
          <p class="text-lg sm:text-xl text-ink-400 leading-relaxed">
            Vibe-coded prototypes forget every session — that is how duplicate
            services and missing auth checks pile up. Ptah indexes your project
            before the first message and keeps the decisions it makes after the
            last one, so feature ten stays as consistent as feature one.
          </p>
        </div>

        <!-- Device visual -->
        <div
          viewportAnimation
          [viewportConfig]="deviceConfig"
          class="max-w-4xl mx-auto mb-16"
        >
          <ptah-device-frame
            title="Ptah — Memory"
            liveLabel="1,425 memories indexed"
            aspect="16/10"
          >
            <ptah-memory-timeline-mock />
          </ptah-device-frame>
        </div>

        <!-- Feature cards -->
        <div class="grid md:grid-cols-3 gap-6 lg:gap-8">
          @for (card of cards; track card.title; let i = $index) {
            <article
              viewportAnimation
              [viewportConfig]="cardConfigs[i]"
              class="rounded-xl border border-ink-700 bg-ink-850 p-6 sm:p-8 transition-colors duration-200 hover:border-amber-500/30"
            >
              <div
                class="w-11 h-11 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mb-5"
              >
                <lucide-angular
                  [img]="card.icon"
                  class="w-5 h-5 text-amber-500"
                  aria-hidden="true"
                />
              </div>
              <h3 class="text-lg sm:text-xl font-semibold text-white mb-2">
                {{ card.title }}
              </h3>
              <p class="text-base text-ink-400 leading-relaxed">
                {{ card.body }}
              </p>
            </article>
          }
        </div>

        <!-- Citable stat callout -->
        <p
          class="mt-14 max-w-2xl mx-auto text-center font-mono text-sm text-ink-400"
        >
          Hybrid BM25 + vector memory search, fused with Reciprocal Rank Fusion.
        </p>

        <!-- Ghost link -->
        <div class="mt-8 flex justify-center">
          <a
            href="https://docs.ptah.live"
            target="_blank"
            rel="noopener"
            class="inline-flex items-center gap-3 text-amber-500 hover:text-amber-400 font-medium text-sm transition-colors"
          >
            See how memory works
            <span
              class="w-9 h-9 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center"
            >
              <lucide-angular
                [img]="arrowRight"
                class="w-4 h-4"
                aria-hidden="true"
              />
            </span>
          </a>
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
export class PillarMemoryComponent {
  protected readonly arrowRight = ArrowRight;

  protected readonly cards = [
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
  ];

  protected readonly headerConfig: ViewportAnimationConfig = {
    animation: 'fadeIn',
    duration: 0.6,
    threshold: 0.2,
    ease: 'power2.out',
  };

  protected readonly deviceConfig: ViewportAnimationConfig = {
    animation: 'scaleIn',
    duration: 0.6,
    delay: 0.1,
    threshold: 0.2,
    ease: 'power2.out',
  };

  protected readonly cardConfigs: ViewportAnimationConfig[] = [0, 1, 2].map(
    (i) => ({
      animation: 'slideUp',
      duration: 0.5,
      delay: 0.1 + i * 0.12,
      threshold: 0.2,
      ease: 'power2.out',
    }),
  );
}
