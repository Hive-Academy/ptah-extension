import { NgClass } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  signal,
  computed,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { ViewportAnimationDirective } from '@hive-academy/angular-gsap';
import {
  Bot,
  Check,
  Globe,
  LucideAngularModule,
  Puzzle,
  Sparkles,
  Wand2,
  ArrowRight,
} from 'lucide-angular';

interface ShowcaseTab {
  id: string;
  icon: typeof Bot;
  label: string;
  title: string;
  description: string;
  highlights: string[];
  /** The docs page section ID to scroll to (used as fragment in /docs#section) */
  docsSection: string;
}

@Component({
  selector: 'ptah-premium-showcase-tabs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NgClass,
    RouterLink,
    ViewportAnimationDirective,
    LucideAngularModule,
  ],
  template: `
    <section class="relative bg-slate-950 overflow-hidden">
      <!-- Background texture -->
      <div
        class="absolute inset-0 opacity-[0.03] pointer-events-none"
        style="
          background-image: url('/assets/backgrounds/hieroglyph-circuit-pattern.png');
          background-repeat: repeat;
          background-size: 300px 300px;
        "
        aria-hidden="true"
      ></div>

      <!-- Subtle radial glow -->
      <div
        class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-[#d4af37]/[0.03] rounded-full blur-[120px] pointer-events-none"
        aria-hidden="true"
      ></div>

      <div
        class="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24 sm:py-32"
      >
        <!-- Section Header -->
        <div class="text-center mb-16 sm:mb-20">
          <div
            class="inline-block mb-6"
            viewportAnimation
            [viewportConfig]="{ animation: 'scaleIn', duration: 0.5 }"
          >
            <span
              class="inline-flex items-center gap-2 px-5 py-2 bg-[#d4af37]/10 border border-[#d4af37]/30 rounded-full text-sm font-semibold text-[#f4d47c]"
            >
              <lucide-angular
                [img]="SparklesIcon"
                class="w-4 h-4"
                aria-hidden="true"
              />
              WHAT PTAH OFFERS
            </span>
          </div>

          <h2
            class="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold text-white mb-6 leading-tight"
            viewportAnimation
            [viewportConfig]="{
              animation: 'slideUp',
              duration: 0.7,
              delay: 0.1
            }"
          >
            Everything You Need to
            <span
              class="bg-gradient-to-r from-[#d4af37] via-[#f4d47c] to-[#8a6d10] bg-clip-text text-transparent"
            >
              Ship Faster
            </span>
          </h2>

          <p
            class="text-lg sm:text-xl text-gray-400 max-w-2xl mx-auto"
            viewportAnimation
            [viewportConfig]="{
              animation: 'fadeIn',
              duration: 0.7,
              delay: 0.2
            }"
          >
            Ptah gives you many ways to supercharge your development workflow
          </p>
        </div>

        <!-- Main Layout: Tabs | Visual Card | Description -->
        <div
          class="grid grid-cols-1 lg:grid-cols-[220px_1fr_1fr] gap-8 lg:gap-6 xl:gap-10 items-start"
          viewportAnimation
          [viewportConfig]="{ animation: 'fadeIn', duration: 0.6, delay: 0.3 }"
        >
          <!-- Left: Vertical Tab Navigation -->
          <nav
            class="flex flex-row lg:flex-col gap-2 overflow-x-auto lg:overflow-visible pb-2 lg:pb-0 lg:pt-4 scrollbar-none"
            role="tablist"
            aria-label="Feature showcase tabs"
          >
            @for (tab of tabs; track tab.id; let i = $index) {
            <button
              type="button"
              role="tab"
              [attr.aria-selected]="activeTab() === i"
              [attr.aria-controls]="'panel-' + tab.id"
              class="flex items-center gap-3 px-4 py-3.5 rounded-xl text-left transition-all duration-300 whitespace-nowrap lg:whitespace-normal min-w-fit lg:min-w-0 w-full"
              [ngClass]="
                activeTab() === i
                  ? 'bg-white text-slate-900 shadow-lg shadow-white/10'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              "
              (click)="setActiveTab(i)"
            >
              <lucide-angular
                [img]="tab.icon"
                class="w-5 h-5 shrink-0"
                [ngClass]="
                  activeTab() === i ? 'text-slate-900' : 'text-gray-500'
                "
                aria-hidden="true"
              />
              <span class="text-sm font-medium">{{ tab.label }}</span>
            </button>
            }
          </nav>

          <!-- Center: Visual Showcase Card -->
          <div
            class="flex items-center justify-center"
            [attr.id]="'panel-' + activeTabData().id"
            role="tabpanel"
          >
            <div class="relative w-full max-w-md">
              <!-- Card -->
              <div
                class="relative rounded-2xl border border-white/10 bg-slate-900/80 backdrop-blur-sm overflow-hidden shadow-2xl shadow-black/40"
              >
                <!-- Card header with icon -->
                <div
                  class="px-6 pt-6 pb-4 border-b border-white/5 flex items-center gap-3"
                >
                  <div
                    class="w-10 h-10 rounded-xl bg-[#d4af37]/10 border border-[#d4af37]/20 flex items-center justify-center"
                  >
                    <lucide-angular
                      [img]="activeTabData().icon"
                      class="w-5 h-5 text-[#d4af37]"
                      aria-hidden="true"
                    />
                  </div>
                  <div>
                    <p class="text-sm font-semibold text-white">
                      {{ activeTabData().label }}
                    </p>
                    <p class="text-xs text-gray-500">Ptah Feature</p>
                  </div>
                </div>

                <!-- Highlights list -->
                <div class="px-6 py-5">
                  <div class="space-y-3">
                    @for ( highlight of activeTabData().highlights; track $index
                    ) {
                    <div class="flex items-start gap-3">
                      <div
                        class="mt-0.5 w-5 h-5 rounded-full bg-[#d4af37]/10 flex items-center justify-center shrink-0"
                      >
                        <lucide-angular
                          [img]="CheckIcon"
                          class="w-3 h-3 text-[#d4af37]"
                          aria-hidden="true"
                        />
                      </div>
                      <span class="text-sm text-gray-300 leading-relaxed">
                        {{ highlight }}
                      </span>
                    </div>
                    }
                  </div>
                </div>

                <!-- Bottom accent bar -->
                <div
                  class="h-1 bg-gradient-to-r from-[#d4af37]/60 via-[#f4d47c]/40 to-[#d4af37]/60"
                ></div>
              </div>

              <!-- Decorative glow -->
              <div
                class="absolute -inset-4 bg-[#d4af37]/[0.04] rounded-3xl blur-2xl pointer-events-none -z-10"
                aria-hidden="true"
              ></div>
            </div>
          </div>

          <!-- Right: Title + Description + CTA -->
          <div class="lg:pt-4">
            <h3
              class="text-2xl sm:text-3xl font-bold text-white mb-4 leading-snug"
            >
              {{ activeTabData().title }}
            </h3>

            <p class="text-base text-gray-400 leading-relaxed mb-8">
              {{ activeTabData().description }}
            </p>

            <a
              [routerLink]="['/docs']"
              [fragment]="activeTabData().docsSection"
              class="inline-flex items-center gap-2 text-[#f4d47c] hover:text-[#d4af37] font-medium text-sm transition-colors group"
            >
              <div
                class="w-8 h-8 rounded-full bg-[#d4af37]/10 border border-[#d4af37]/20 flex items-center justify-center group-hover:bg-[#d4af37]/20 transition-colors"
              >
                <lucide-angular
                  [img]="ArrowRightIcon"
                  class="w-4 h-4"
                  aria-hidden="true"
                />
              </div>
              Explore {{ activeTabData().label }}
            </a>
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

      .scrollbar-none::-webkit-scrollbar {
        display: none;
      }
      .scrollbar-none {
        -ms-overflow-style: none;
        scrollbar-width: none;
      }
    `,
  ],
})
export class PremiumShowcaseTabsComponent {
  public readonly SparklesIcon = Sparkles;
  public readonly CheckIcon = Check;
  public readonly ArrowRightIcon = ArrowRight;

  public readonly activeTab = signal(0);

  public readonly tabs: ShowcaseTab[] = [
    {
      id: 'orchestration',
      icon: Bot,
      label: 'Agent Orchestration',
      docsSection: 'agent-orchestration',
      title: 'Spawn a Team. Delegate. Conquer.',
      description:
        'Run Gemini CLI, Codex, Copilot, and Ptah CLI agents as parallel workers. Fire-and-check orchestration with 6 MCP lifecycle tools lets you delegate tasks across multiple AI agents simultaneously — all from within VS Code.',
      highlights: [
        '4 agent types: Gemini CLI, Codex SDK, Copilot SDK, Ptah CLI',
        'Ptah CLI connects 200+ models via Claude Agent SDK',
        '6 MCP lifecycle tools for fire-and-check workflows',
        'True parallel execution across providers',
      ],
    },
    {
      id: 'plugins',
      icon: Puzzle,
      label: 'Skill Plugins',
      docsSection: 'plugins',
      title: 'Your Stack. Your Skills. Your Rules.',
      description:
        'Install domain-specific skill packs — Angular, NestJS, React, SaaS monetization — directly from skills.sh or the built-in Skills Discovery panel in Ptah settings. Each plugin brings specialized agents, slash commands, and code patterns tuned for your stack.',
      highlights: [
        '4+ skill packs: Core, Angular, NX SaaS, React',
        'skills.sh registry — browse & install with one click',
        'Skills Discovery integrated into extension settings',
        'Slash commands & specialized sub-agents per plugin',
        'Build custom plugins with the Skill Creator',
      ],
    },
    {
      id: 'providers',
      icon: Globe,
      label: 'Unified Providers',
      docsSection: 'providers',
      title: 'One Harness. Every Model. Total Control.',
      description:
        'Access OpenAI, Claude, Copilot, Gemini, and 200+ OpenRouter models in a single unified interface. Switch providers seamlessly, share conversation context, and track costs in real time — all inside VS Code.',
      highlights: [
        'Unified provider tiles with one-click switching',
        'Shared context preserved across provider changes',
        'Real-time cost & token usage dashboards',
        'Secure per-provider API key management',
      ],
    },
    {
      id: 'setup-wizard',
      icon: Wand2,
      label: 'Setup Wizard',
      docsSection: 'setup-wizard',
      title: 'Instant Project Awareness. From Day One.',
      description:
        "Ptah's Setup Wizard scans your workspace in seconds — detects 13+ project types, analyzes dependencies, and generates custom CLAUDE.md rules and project-adaptive agents. Your AI starts fully informed on every session.",
      highlights: [
        '6-step automated workspace analysis',
        '13+ project type detection including monorepos',
        'LLM-generated rules & custom agent configurations',
        'Persistent project context across all sessions',
      ],
    },
  ];

  public readonly activeTabData = computed(() => this.tabs[this.activeTab()]);

  public setActiveTab(index: number): void {
    this.activeTab.set(index);
  }
}
