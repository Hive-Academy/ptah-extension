import { NgClass } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  signal,
  DestroyRef,
  inject,
  afterNextRender,
} from '@angular/core';
import { ViewportAnimationDirective } from '@hive-academy/angular-gsap';
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  ChevronLeft,
  ChevronRight,
  Globe,
  LucideAngularModule,
  Puzzle,
  Sparkles,
  Wand2,
  X,
} from 'lucide-angular';

interface ShowcasePanel {
  id: string;
  icon: typeof Bot;
  problemHeadline: string;
  problemBody: string;
  problemBullets: string[];
  solutionHeadline: string;
  solutionBody: string;
  solutionBullets: string[];
}

@Component({
  selector: 'ptah-premium-showcase-scroll',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgClass, ViewportAnimationDirective, LucideAngularModule],
  template: `
    <!-- Slider Section — viewport height -->
    <div class="relative bg-slate-950 h-screen flex flex-col">
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

      <!-- Slider track — fills available space -->
      <div class="relative z-10 flex-1 min-h-0 overflow-hidden">
        <!-- Section Intro -->
        <div class="relative py-20 sm:py-28 text-center overflow-hidden">
          <div
            class="absolute inset-0 bg-gradient-to-b from-slate-950 via-slate-900/90 to-slate-950 pointer-events-none"
            aria-hidden="true"
          ></div>

          <div class="relative z-10 px-4 sm:px-6 max-w-4xl mx-auto">
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
                WHY PTAH?
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
              Every Problem Has a
              <span
                class="bg-gradient-to-r from-[#d4af37] via-[#f4d47c] to-[#8a6d10] bg-clip-text text-transparent"
              >
                Golden Solution
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
              Discover how Ptah transforms the pain points of AI-assisted
              development into superpowers.
            </p>
          </div>
        </div>

        <div
          class="flex h-full transition-transform duration-500 ease-out"
          [style.transform]="'translateX(-' + currentSlide() * 100 + '%)'"
        >
          @for (panel of panels; track panel.id; let i = $index) {
          <div class="w-full h-full flex-shrink-0 overflow-y-auto">
            <div
              class="max-w-6xl mx-auto px-8 sm:px-12 lg:px-16 flex items-center py-8"
            >
              <!-- 3-column grid: Problem | Icon | Solution -->
              <div
                class="w-full grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] items-start gap-8 lg:gap-0"
              >
                <!-- Problem -->
                <div class="lg:pr-10 xl:pr-16">
                  <div
                    class="flex items-center gap-2 mb-4"
                    viewportAnimation
                    [viewportConfig]="{
                      animation: 'fadeIn',
                      duration: 0.4,
                      delay: 0,
                      threshold: 0.1,
                      once: true
                    }"
                  >
                    <span
                      class="w-6 h-6 rounded-full bg-red-500/15 flex items-center justify-center"
                    >
                      <lucide-angular
                        [img]="XIcon"
                        class="w-3.5 h-3.5 text-red-400/70"
                        aria-hidden="true"
                      />
                    </span>
                    <span
                      class="text-[11px] font-semibold uppercase tracking-[0.15em] text-red-400/60"
                      >The Problem</span
                    >
                  </div>

                  <h3
                    class="text-2xl sm:text-3xl lg:text-4xl text-white/90 font-bold mb-4 leading-snug"
                    viewportAnimation
                    [viewportConfig]="{
                      animation: 'slideRight',
                      duration: 0.6,
                      delay: 0.1,
                      threshold: 0.1,
                      once: true
                    }"
                  >
                    {{ panel.problemHeadline }}
                  </h3>

                  <p
                    class="text-sm sm:text-base text-gray-400 leading-relaxed mb-5"
                  >
                    {{ panel.problemBody }}
                  </p>

                  <ul class="space-y-2">
                    @for (bullet of panel.problemBullets; track $index) {
                    <li
                      class="flex items-center gap-2.5"
                      viewportAnimation
                      [viewportConfig]="{
                        animation: 'fadeIn',
                        duration: 0.5,
                        delay: 0.4,
                        threshold: 0.1,
                        once: true
                      }"
                    >
                      <lucide-angular
                        [img]="XIcon"
                        class="w-3.5 h-3.5 text-red-500/50 shrink-0"
                        aria-hidden="true"
                      />
                      <span class="text-sm text-gray-500">{{ bullet }}</span>
                    </li>
                    }
                  </ul>
                </div>

                <!-- Icon divider -->
                <div
                  class="flex flex-row lg:flex-col items-center gap-3 lg:px-8 xl:px-14 lg:self-center"
                >
                  <div class="relative">
                    <div
                      class="absolute inset-0 rounded-full bg-[#d4af37]/10 animate-icon-pulse"
                    ></div>
                    <div
                      class="absolute -inset-3 rounded-full bg-[#d4af37]/[0.06] blur-xl"
                    ></div>
                    <div
                      class="relative w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-slate-900 border border-[#d4af37]/30 flex items-center justify-center shadow-[0_0_40px_-5px_rgba(212,175,55,0.15)] animate-icon-float"
                    >
                      <lucide-angular
                        [img]="panel.icon"
                        class="w-7 h-7 sm:w-9 sm:h-9 text-[#d4af37]"
                        aria-hidden="true"
                      />
                    </div>
                  </div>
                  <div class="flex items-center gap-1.5 animate-arrow-nudge">
                    <div
                      class="w-10 h-px bg-gradient-to-r from-[#d4af37]/30 to-[#d4af37]/60"
                    ></div>
                    <lucide-angular
                      [img]="ArrowRightIcon"
                      class="w-5 h-5 text-[#d4af37]/70"
                      aria-hidden="true"
                    />
                  </div>
                </div>

                <!-- Solution -->
                <div class="lg:pl-10 xl:pl-16">
                  <div
                    class="flex items-center gap-2 mb-4"
                    viewportAnimation
                    [viewportConfig]="{
                      animation: 'fadeIn',
                      duration: 0.4,
                      delay: 0.2,
                      threshold: 0.1,
                      once: true
                    }"
                  >
                    <span
                      class="w-6 h-6 rounded-full bg-emerald-500/15 flex items-center justify-center"
                    >
                      <lucide-angular
                        [img]="CheckIcon"
                        class="w-3.5 h-3.5 text-emerald-400"
                        aria-hidden="true"
                      />
                    </span>
                    <span
                      class="text-[11px] font-semibold uppercase tracking-[0.15em] text-[#f4d47c]/70"
                      >With Ptah</span
                    >
                  </div>

                  <h3
                    class="text-2xl sm:text-3xl lg:text-4xl font-bold mb-4 leading-snug"
                    viewportAnimation
                    [viewportConfig]="{
                      animation: 'slideLeft',
                      duration: 0.6,
                      delay: 0.3,
                      threshold: 0.1,
                      once: true
                    }"
                  >
                    <span
                      class="bg-gradient-to-r from-[#d4af37] via-[#f4d47c] to-emerald-400 bg-clip-text text-transparent"
                    >
                      {{ panel.solutionHeadline }}
                    </span>
                  </h3>

                  <p
                    class="text-sm sm:text-base text-gray-300 leading-relaxed mb-5"
                    viewportAnimation
                    [viewportConfig]="{
                      animation: 'fadeIn',
                      duration: 0.5,
                      delay: 0.4,
                      threshold: 0.1,
                      once: true
                    }"
                  >
                    {{ panel.solutionBody }}
                  </p>

                  <ul class="space-y-2">
                    @for (bullet of panel.solutionBullets; track $index) {
                    <li
                      class="flex items-start gap-2.5"
                      viewportAnimation
                      [viewportConfig]="{
                        animation: 'fadeIn',
                        duration: 0.5,
                        delay: 0.4,
                        threshold: 0.1,
                        once: true
                      }"
                    >
                      <lucide-angular
                        [img]="CheckIcon"
                        class="w-4 h-4 text-[#d4af37] mt-0.5 shrink-0"
                        aria-hidden="true"
                      />
                      <span class="text-sm text-gray-300">{{ bullet }}</span>
                    </li>
                    }
                  </ul>
                </div>
              </div>
            </div>
          </div>
          }
        </div>
      </div>

      <!-- Navigation — pinned bottom -->
      <div class="relative z-10 py-5 shrink-0">
        <div
          class="max-w-6xl mx-auto px-8 sm:px-12 lg:px-16 flex items-center justify-between"
        >
          <!-- Dots -->
          <div class="flex items-center gap-3">
            @for (panel of panels; track panel.id; let j = $index) {
            <button
              type="button"
              class="group p-1"
              (click)="goToSlide(j)"
              [attr.aria-label]="'Go to slide ' + (j + 1)"
              [attr.aria-current]="j === currentSlide() ? 'step' : null"
            >
              <div
                class="w-2.5 h-2.5 rounded-full transition-all duration-300"
                [ngClass]="
                  j === currentSlide()
                    ? 'bg-[#d4af37] shadow-[0_0_8px_rgba(212,175,55,0.5)] scale-125'
                    : 'bg-white/20 group-hover:bg-white/40'
                "
              ></div>
            </button>
            }
          </div>

          <!-- Counter -->
          <span class="text-sm text-gray-500 font-mono">
            {{ currentSlide() + 1 }}
            <span class="text-gray-700">/</span>
            {{ panels.length }}
          </span>

          <!-- Prev / Next -->
          <div class="flex items-center gap-3">
            <button
              type="button"
              class="w-10 h-10 rounded-full border border-white/10 flex items-center justify-center transition-all duration-200 hover:border-[#d4af37]/40 hover:bg-[#d4af37]/5 disabled:opacity-30 disabled:cursor-not-allowed"
              (click)="prevSlide()"
              [disabled]="currentSlide() === 0"
              aria-label="Previous slide"
            >
              <lucide-angular
                [img]="ChevronLeftIcon"
                class="w-5 h-5 text-white/60"
              />
            </button>
            <button
              type="button"
              class="w-10 h-10 rounded-full border border-white/10 flex items-center justify-center transition-all duration-200 hover:border-[#d4af37]/40 hover:bg-[#d4af37]/5 disabled:opacity-30 disabled:cursor-not-allowed"
              (click)="nextSlide()"
              [disabled]="currentSlide() === panels.length - 1"
              aria-label="Next slide"
            >
              <lucide-angular
                [img]="ChevronRightIcon"
                class="w-5 h-5 text-white/60"
              />
            </button>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      @keyframes icon-float {
        0%,
        100% {
          transform: translateY(0);
        }
        50% {
          transform: translateY(-8px);
        }
      }

      @keyframes icon-pulse {
        0%,
        100% {
          transform: scale(1);
          opacity: 0.3;
        }
        50% {
          transform: scale(1.5);
          opacity: 0;
        }
      }

      @keyframes arrow-nudge {
        0%,
        100% {
          transform: translateX(0);
        }
        50% {
          transform: translateX(6px);
        }
      }

      .animate-icon-float {
        animation: icon-float 3s ease-in-out infinite;
      }

      .animate-icon-pulse {
        animation: icon-pulse 2.5s ease-in-out infinite;
      }

      .animate-arrow-nudge {
        animation: arrow-nudge 2s ease-in-out infinite;
      }
    `,
  ],
})
export class PremiumShowcaseScrollComponent {
  private readonly destroyRef = inject(DestroyRef);

  public readonly SparklesIcon = Sparkles;
  public readonly CheckIcon = Check;
  public readonly XIcon = X;
  public readonly ArrowRightIcon = ArrowRight;
  public readonly ArrowLeftIcon = ArrowLeft;
  public readonly ChevronLeftIcon = ChevronLeft;
  public readonly ChevronRightIcon = ChevronRight;

  public readonly currentSlide = signal(0);
  public readonly autoPlayPaused = signal(false);

  private autoPlayTimer: ReturnType<typeof setInterval> | null = null;
  private readonly autoPlayInterval = 6000; // 6 seconds per slide

  public constructor() {
    afterNextRender(() => {
      this.startAutoPlay();
    });
  }

  private startAutoPlay(): void {
    this.autoPlayTimer = setInterval(() => {
      if (this.autoPlayPaused()) return;

      if (this.currentSlide() < this.panels.length - 1) {
        this.currentSlide.update((v) => v + 1);
      } else {
        this.currentSlide.set(0); // loop back
      }
    }, this.autoPlayInterval);

    this.destroyRef.onDestroy(() => {
      if (this.autoPlayTimer) {
        clearInterval(this.autoPlayTimer);
      }
    });
  }

  /** Pause auto-play on user interaction, resume after 10s */
  private pauseAutoPlay(): void {
    this.autoPlayPaused.set(true);
    setTimeout(() => this.autoPlayPaused.set(false), 10000);
  }

  public readonly panels: ShowcasePanel[] = [
    {
      id: 'orchestration',
      icon: Bot,
      problemHeadline: 'One Agent. One Brain. One Bottleneck.',
      problemBody:
        'Your AI assistant works alone — sequentially. Need a code review while implementing? Wait. Need tests while refactoring? Wait. Every task queues behind the last.',
      problemBullets: [
        'Single-threaded workflows',
        'No delegation capability',
        'Context switching overhead',
        'Providers locked in silos',
      ],
      solutionHeadline: 'Spawn a Team. Delegate. Conquer.',
      solutionBody:
        'Ptah spawns Gemini CLI, Codex, GitHub Copilot, and Ptah CLI agents as background workers. Ptah CLI uses Claude Agent SDK to connect any Anthropic-compatible provider — OpenRouter, Moonshot, Z.AI — as a headless agent. Fire-and-check orchestration for true multi-agent parallelism.',
      solutionBullets: [
        '4 agent types: Gemini CLI, Codex SDK, Copilot SDK, Ptah CLI',
        'Ptah CLI: Claude Agent SDK + 200+ 3rd-party models',
        'Fire-and-check workflow with 6 MCP lifecycle tools',
        'Parallel task execution across providers',
      ],
    },
    {
      id: 'plugins',
      icon: Puzzle,
      problemHeadline: 'Generic AI. Generic Results.',
      problemBody:
        "Every AI tool ships the same generic capabilities. It doesn't know Angular from React, NestJS from Express, or your team's conventions.",
      problemBullets: [
        'One-size-fits-all knowledge',
        'No domain expertise',
        'Repeated context setup',
        'No team conventions',
      ],
      solutionHeadline: 'Your Stack. Your Skills. Your Rules.',
      solutionBody:
        'Install domain-specific skill packs — Angular patterns, NestJS architecture, GSAP animations, SaaS monetization. Each plugin brings specialized agents, slash commands, and code patterns. Build your own with the Skill Creator.',
      solutionBullets: [
        '4+ plugin packs: Core, Angular, NX SaaS, React',
        'Slash commands & specialized sub-agents per plugin',
        'Skill Creator for building custom plugins',
        'Community-extensible ecosystem',
      ],
    },
    {
      id: 'providers',
      icon: Globe,
      problemHeadline: 'Five Providers. Five Tabs. Zero Sync.',
      problemBody:
        'Juggling OpenAI, Claude, Copilot, and Gemini across different tools. Different auth, different context windows, different pricing. Switching kills flow state.',
      problemBullets: [
        'Fragmented experience',
        'Lost context between tools',
        'No cost visibility',
        'Separate auth flows',
      ],
      solutionHeadline: 'One Harness. Every Model. Total Control.',
      solutionBody:
        'Ptah unifies OpenAI, Claude, Copilot, Gemini, and 200+ OpenRouter models in one interface. Seamless provider switching, shared conversation context, real-time cost tracking — all inside VS Code.',
      solutionBullets: [
        'Unified provider tiles with one-click switching',
        'Shared context across provider changes',
        'Real-time cost & token dashboards',
        'Secure per-provider API key management',
      ],
    },
    {
      id: 'setup-wizard',
      icon: Wand2,
      problemHeadline: 'Day One: AI Knows Nothing About Your Code.',
      problemBody:
        'Every new AI conversation starts from zero. You manually explain your project structure, tech stack, and conventions. 30 minutes wasted before the AI is useful.',
      problemBullets: [
        'Manual context every session',
        'No project awareness',
        'Generic responses',
        'Wasted onboarding time',
      ],
      solutionHeadline: 'Day One: AI Already Knows Your Architecture.',
      solutionBody:
        "Ptah's Setup Wizard scans your workspace in seconds — detects 13+ project types, analyzes dependencies, and uses LLM-powered generation to create custom CLAUDE.md rules and project-adaptive agents. Your AI starts informed.",
      solutionBullets: [
        '6-step automated workspace scan',
        '13+ project type detection (monorepos included)',
        'LLM-generated rules & custom agent configurations',
        'Persistent project context across all sessions',
      ],
    },
  ];

  public nextSlide(): void {
    this.pauseAutoPlay();
    if (this.currentSlide() < this.panels.length - 1) {
      this.currentSlide.update((v) => v + 1);
    }
  }

  public prevSlide(): void {
    this.pauseAutoPlay();
    if (this.currentSlide() > 0) {
      this.currentSlide.update((v) => v - 1);
    }
  }

  public goToSlide(index: number): void {
    this.pauseAutoPlay();
    this.currentSlide.set(index);
  }
}
