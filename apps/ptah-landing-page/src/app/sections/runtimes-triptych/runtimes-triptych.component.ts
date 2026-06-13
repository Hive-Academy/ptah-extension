import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  ScrollAnimationConfig,
  ScrollAnimationDirective,
  ViewportAnimationConfig,
  ViewportAnimationDirective,
} from '@hive-academy/angular-gsap';
import {
  ArrowRight,
  Check,
  LucideAngularModule,
  Monitor,
  Package,
  Terminal,
} from 'lucide-angular';
import {
  FloatingGlyph,
  FloatingGlyphsComponent,
} from '../../components/floating-glyphs.component';

interface RuntimePanel {
  icon: typeof Package;
  title: string;
  body: string;
  features: string[];
  ctaLabel: string;
  href: string;
  external: boolean;
  premium: boolean;
}

@Component({
  selector: 'ptah-runtimes-triptych',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    LucideAngularModule,
    ScrollAnimationDirective,
    ViewportAnimationDirective,
    FloatingGlyphsComponent,
  ],
  template: `
    <section
      id="runtimes"
      aria-label="Deployment Options"
      class="relative bg-slate-950 py-32 sm:py-44 overflow-hidden"
    >
      <ptah-floating-glyphs [glyphs]="glyphs" />

      <div class="relative z-10 max-w-7xl mx-auto px-6 sm:px-10 lg:px-16">
        <div class="text-center mb-24 sm:mb-32">
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
            One Codebase. Three Ways to Run It.
          </h2>
          <p
            viewportAnimation
            [viewportConfig]="subheadConfig"
            class="text-base sm:text-lg text-gray-400 max-w-2xl mx-auto leading-relaxed"
          >
            Install the extension in your editor, download the desktop app with
            the full Thoth suite, or run Ptah headless in CI and A2A pipelines.
            All three runtimes share one license.
          </p>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-10 lg:gap-14 items-end">
          @for (panel of panels; track panel.title; let i = $index) {
            <div
              scrollAnimation
              [scrollConfig]="getPanelScroll(i)"
              class="group relative flex flex-col rounded-t-[140px] rounded-b-2xl border bg-slate-900/80 px-8 pb-10 pt-20 transition-all duration-500"
              [class.border-[#d4af37]/20]="!panel.premium"
              [class.border-[#d4af37]/50]="panel.premium"
              [class.shadow-glow-gold]="panel.premium"
              [class.hover:border-[#d4af37]/40]="!panel.premium"
              [class.hover:shadow-glow-gold-lg]="panel.premium"
            >
              @if (panel.premium) {
                <span
                  class="absolute top-8 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full bg-gradient-to-r from-[#d4af37] to-[#8a6d10] text-[#0a0a0a] text-xs font-bold tracking-widest"
                >
                  PREMIUM
                </span>
              }
              <div
                class="absolute inset-x-0 top-0 h-40 rounded-t-[140px] bg-gradient-to-b from-[#d4af37]/10 to-transparent pointer-events-none"
                aria-hidden="true"
              ></div>
              <div
                class="mx-auto w-16 h-16 rounded-full bg-[#d4af37]/10 border border-[#d4af37]/30 flex items-center justify-center mb-8 transition-transform duration-500 group-hover:scale-110"
              >
                <lucide-angular
                  [img]="panel.icon"
                  class="w-8 h-8 text-[#d4af37]"
                  aria-hidden="true"
                />
              </div>
              <h3 class="text-xl font-semibold text-white text-center mb-4">
                {{ panel.title }}
              </h3>
              <p class="text-sm text-gray-400 text-center leading-relaxed mb-8">
                {{ panel.body }}
              </p>
              <ul class="space-y-3 mb-10 flex-1">
                @for (feature of panel.features; track feature) {
                  <li class="flex items-start gap-3">
                    <lucide-angular
                      [img]="CheckIcon"
                      class="w-5 h-5 text-[#d4af37] mt-0.5 shrink-0"
                      aria-hidden="true"
                    />
                    <span class="text-base text-gray-400">{{ feature }}</span>
                  </li>
                }
              </ul>
              @if (panel.external) {
                <a
                  [href]="panel.href"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="mx-auto inline-flex items-center gap-3 text-[#f4d47c] hover:text-[#d4af37] font-medium text-sm transition-colors group/link focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 focus-visible:outline-offset-2 rounded-md"
                >
                  <span
                    class="w-9 h-9 rounded-full bg-[#d4af37]/10 border border-[#d4af37]/20 flex items-center justify-center group-hover/link:bg-[#d4af37]/20 transition-colors"
                  >
                    <lucide-angular
                      [img]="ArrowRightIcon"
                      class="w-4 h-4"
                      aria-hidden="true"
                    />
                  </span>
                  {{ panel.ctaLabel }}
                </a>
              } @else {
                <a
                  [routerLink]="panel.href"
                  class="mx-auto inline-flex items-center gap-2 bg-gradient-to-r from-amber-500 to-amber-600 text-slate-900 px-6 py-3 rounded-lg font-semibold hover:from-amber-400 hover:to-amber-500 transition-all duration-200 shadow-lg shadow-amber-500/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 focus-visible:outline-offset-2"
                >
                  {{ panel.ctaLabel }}
                  <lucide-angular
                    [img]="ArrowRightIcon"
                    class="w-4 h-4"
                    aria-hidden="true"
                  />
                </a>
              }
            </div>
          }
        </div>

        <p class="text-center text-sm text-gray-500 mt-20">
          All three runtimes share one license subscription.
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
export class RuntimesTriptychComponent {
  public readonly CheckIcon = Check;
  public readonly ArrowRightIcon = ArrowRight;

  public readonly panels: RuntimePanel[] = [
    {
      icon: Package,
      title: 'VS Code Extension',
      body: 'Install directly from the VS Code Marketplace. Your editor gains a full AI orchestration panel, project-aware agents, and access to every provider — in seconds.',
      features: [
        '100-day free trial, no credit card',
        'All providers: Claude, Copilot, Codex, Ollama',
        'Automatic Marketplace updates',
        'Full plugin and skill ecosystem',
      ],
      ctaLabel: 'Install Extension',
      href: 'https://marketplace.visualstudio.com/items?itemName=ptah-extensions.ptah-coding-orchestra',
      external: true,
      premium: false,
    },
    {
      icon: Monitor,
      title: 'Electron Desktop App',
      body: 'A standalone coding oracle for Windows, macOS, and Linux. No VS Code required. Unlocks the Thoth suite: persistent memory, skill synthesis, the cron scheduler, and the messaging gateway.',
      features: [
        'Windows, macOS, and Linux',
        'Unlocks Thoth suite (Electron-exclusive)',
        'Canvas: up to 9 concurrent agent tiles',
        'Auto-updates via GitHub Releases',
      ],
      ctaLabel: 'Download Desktop App',
      href: '/download',
      external: false,
      premium: true,
    },
    {
      icon: Terminal,
      title: 'Headless CLI',
      body: 'Run Ptah anywhere Node.js runs. JSON-RPC stdio interface for CI/CD pipelines, A2A bridges, and scripted workflows. Connect any LLM provider with zero UI overhead.',
      features: [
        'JSON-RPC stdio — pipe-friendly',
        'CI/CD and A2A bridge support',
        'Works with any provider',
        'Scriptable harness automation',
      ],
      ctaLabel: 'Read CLI Docs',
      href: 'https://docs.ptah.live/providers/ptah-cli/',
      external: true,
      premium: false,
    },
  ];

  public readonly glyphs: FloatingGlyph[] = [
    {
      src: '/assets/icons/glyphs/ankh.png',
      size: 110,
      top: '12%',
      left: '6%',
      delay: 0,
      duration: 9,
    },
    {
      src: '/assets/icons/glyphs/djed.png',
      size: 95,
      top: '30%',
      right: '8%',
      delay: 2.5,
      duration: 11,
    },
    {
      src: '/assets/icons/glyphs/scarab.png',
      size: 85,
      bottom: '10%',
      left: '14%',
      delay: 1.2,
      duration: 10,
    },
  ];

  public readonly headerConfig: ViewportAnimationConfig = {
    animation: 'slideUp',
    duration: 0.8,
    threshold: 0.15,
  };

  public readonly subheadConfig: ViewportAnimationConfig = {
    animation: 'fadeIn',
    duration: 0.7,
    delay: 0.2,
    threshold: 0.15,
  };

  public getPanelScroll(index: number): ScrollAnimationConfig {
    const premium = index === 1;
    return {
      animation: 'custom',
      start: 'top 92%',
      end: 'top 45%',
      scrub: 0.9,
      from: { opacity: 0, y: premium ? 180 : 90 },
      to: { opacity: 1, y: premium ? -40 : 0 },
    };
  }
}
