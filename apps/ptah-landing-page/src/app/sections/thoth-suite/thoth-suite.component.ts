import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  ViewportAnimationConfig,
  ViewportAnimationDirective,
} from '@hive-academy/angular-gsap';
import {
  Brain,
  Clock,
  LucideAngularModule,
  MessageSquare,
  Sparkles,
} from 'lucide-angular';
import {
  FloatingGlyph,
  FloatingGlyphsComponent,
} from '../../components/floating-glyphs.component';

interface ThothPillar {
  icon: typeof Brain;
  title: string;
  body: string;
  offset: boolean;
}

@Component({
  selector: 'ptah-thoth-suite',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    LucideAngularModule,
    ViewportAnimationDirective,
    FloatingGlyphsComponent,
  ],
  template: `
    <section
      id="thoth"
      aria-label="Thoth Suite"
      class="relative bg-gradient-to-b from-slate-900 to-slate-950 py-32 sm:py-44 overflow-hidden"
    >
      <ptah-floating-glyphs [glyphs]="glyphs" />

      <div class="relative z-10 max-w-7xl mx-auto px-6 sm:px-10 lg:px-16">
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-16 lg:gap-20">
          <div class="lg:col-span-5">
            <div class="lg:sticky lg:top-32">
              <div
                viewportAnimation
                [viewportConfig]="badgeConfig"
                class="inline-flex items-center gap-2 px-4 py-2 mb-8 bg-teal-500/10 border border-teal-500/20 rounded-full"
              >
                <span
                  class="w-2 h-2 bg-teal-400 rounded-full animate-pulse"
                  aria-hidden="true"
                ></span>
                <span class="text-sm font-medium text-teal-300/90 tracking-wide"
                  >ELECTRON EXCLUSIVE</span
                >
              </div>

              <h2
                viewportAnimation
                [viewportConfig]="headlineConfig"
                class="font-display text-3xl sm:text-4xl lg:text-5xl font-semibold text-white leading-tight mb-8"
              >
                Meet Thoth.
                <span class="block mt-3 text-[#f4d47c]"
                  >The Scribe That Never Forgets.</span
                >
              </h2>

              <p
                viewportAnimation
                [viewportConfig]="bodyConfig"
                class="text-base sm:text-lg text-gray-400 leading-relaxed mb-12"
              >
                Thoth is Ptah's intelligent layer: a persistent memory curator,
                skill synthesiser, cron scheduler, and messaging gateway built
                into the Electron desktop app. It turns your session history
                into institutional knowledge.
              </p>

              <a
                viewportAnimation
                [viewportConfig]="ctaConfig"
                routerLink="/download"
                class="inline-block bg-gradient-to-r from-amber-500 to-amber-600 text-slate-900 px-7 py-3.5 rounded-xl font-semibold text-base hover:from-amber-400 hover:to-amber-500 transition-all duration-200 shadow-lg shadow-amber-500/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 focus-visible:outline-offset-2"
              >
                Download the Desktop App to Unlock Thoth
              </a>
            </div>
          </div>

          <div class="lg:col-span-7">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-8 lg:gap-10">
              @for (pillar of pillars; track pillar.title; let i = $index) {
                <div
                  viewportAnimation
                  [viewportConfig]="getPillarConfig(i)"
                  class="group relative rounded-2xl border border-teal-500/15 bg-slate-900/70 p-8 hover:border-teal-400/35 transition-all duration-300"
                  [class.sm:mt-12]="pillar.offset"
                >
                  <div
                    class="absolute inset-0 rounded-2xl bg-gradient-to-b from-teal-400/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                    aria-hidden="true"
                  ></div>
                  <div class="relative z-10">
                    <div
                      class="w-14 h-14 rounded-full bg-teal-500/10 border border-teal-400/25 flex items-center justify-center mb-6 transition-transform duration-300 group-hover:scale-110"
                    >
                      <lucide-angular
                        [img]="pillar.icon"
                        class="w-7 h-7 text-teal-300"
                        aria-hidden="true"
                      />
                    </div>
                    <h3 class="text-lg font-semibold text-white mb-3">
                      {{ pillar.title }}
                    </h3>
                    <p class="text-sm text-gray-400 leading-relaxed">
                      {{ pillar.body }}
                    </p>
                  </div>
                </div>
              }
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
export class ThothSuiteComponent {
  public readonly pillars: ThothPillar[] = [
    {
      icon: Brain,
      title: 'Memory Curator',
      body: 'Hybrid BM25 + vector search with Reciprocal Rank Fusion. Memories persist across workspaces and grow richer with every session. Import knowledge corpora to prime your AI before it even begins.',
      offset: false,
    },
    {
      icon: Sparkles,
      title: 'Skill Synthesis',
      body: 'Tracks successful session trajectories and promotes repeatable workflows into permanent, shareable skill files. Your best patterns become first-class tools — no manual work required.',
      offset: true,
    },
    {
      icon: Clock,
      title: 'Cron Scheduler',
      body: 'Schedule agents to run on any cron expression. Automated code reviews at midnight, dependency scans every Sunday, daily standup summaries — all powered by SQLite-backed job definitions.',
      offset: false,
    },
    {
      icon: MessageSquare,
      title: 'Messaging Gateway',
      body: 'Receive and respond to agent work via Telegram, Discord, or Slack. Approve tool calls from your phone. Discord per-thread sessions keep each conversation isolated and tracked.',
      offset: true,
    },
  ];

  public readonly glyphs: FloatingGlyph[] = [
    {
      src: '/assets/icons/glyphs/ibis.png',
      size: 140,
      top: '14%',
      right: '7%',
      delay: 0,
      duration: 10,
    },
    {
      src: '/assets/icons/glyphs/eye-of-horus.png',
      size: 90,
      bottom: '18%',
      right: '20%',
      delay: 3,
      duration: 12,
    },
    {
      src: '/assets/icons/glyphs/feather-maat.png',
      size: 80,
      bottom: '8%',
      left: '4%',
      delay: 1.5,
      duration: 9,
    },
  ];

  public readonly badgeConfig: ViewportAnimationConfig = {
    animation: 'scaleIn',
    duration: 0.5,
    threshold: 0.15,
  };

  public readonly headlineConfig: ViewportAnimationConfig = {
    animation: 'slideUp',
    duration: 0.9,
    delay: 0.1,
    ease: 'power3.out',
    threshold: 0.15,
  };

  public readonly bodyConfig: ViewportAnimationConfig = {
    animation: 'fadeIn',
    duration: 0.7,
    delay: 0.25,
    threshold: 0.15,
  };

  public readonly ctaConfig: ViewportAnimationConfig = {
    animation: 'slideUp',
    duration: 0.6,
    delay: 0.4,
    threshold: 0.15,
  };

  public getPillarConfig(index: number): ViewportAnimationConfig {
    return {
      animation: index % 2 === 0 ? 'slideRight' : 'slideLeft',
      duration: 0.7,
      delay: 0.1 + index * 0.12,
      ease: 'power2.out',
      threshold: 0.15,
    };
  }
}
