import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  ScrollTimelineComponent,
  HijackedScrollItemDirective,
} from '@hive-academy/angular-gsap';
import { LucideAngularModule, ArrowRight, Check } from 'lucide-angular';
@Component({
  selector: 'ptah-premium-showcase',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    ScrollTimelineComponent,
    HijackedScrollItemDirective,
    LucideAngularModule,
  ],
  template: `
    <agsp-scroll-timeline
      [scrollHeightPerStep]="900"
      [start]="'top top'"
      [animationDuration]="0.8"
      [ease]="'power3.inOut'"
      [scrub]="1.5"
      [stepHold]="0.9"
      [showStepIndicator]="true"
      [stepIndicatorPosition]="'left'"
      (currentStepChange)="onStepChange($event)"
    >
      <!-- ======== SLIDE 1: Agent Orchestration (content left, image right) ======== -->
      <div
        hijackedScrollItem
        slideDirection="left"
        [fadeIn]="true"
        [scale]="true"
      >
        <div class="h-screen w-screen relative overflow-hidden bg-slate-950">
          <!-- Image fills right half only -->
          <div class="absolute inset-y-0 right-0 w-1/2" aria-hidden="true">
            <img
              src="/assets/images/showcase/panel-orchestration.png"
              alt=""
              class="w-full h-full object-cover"
            />
            <div class="absolute inset-0 bg-slate-950/40"></div>
            <div
              class="absolute inset-0 bg-gradient-to-r from-slate-950 via-slate-950/50 to-transparent"
            ></div>
          </div>

          <div class="relative z-10 h-full flex items-center">
            <div class="w-full max-w-7xl mx-auto px-6 sm:px-10 lg:px-16">
              <div class="flex h-full items-center">
                <!-- Content -->
                <div class="w-full md:w-1/2 lg:w-[45%]">
                  <div class="flex items-center gap-4 mb-6">
                    <span
                      class="flex items-center justify-center w-14 h-14 rounded-full bg-gradient-to-br from-[#d4af37] to-[#8a6d10] text-[#0a0a0a] font-bold text-xl shadow-lg shadow-[#d4af37]/20"
                      >01</span
                    >
                    <div
                      class="h-px flex-1 bg-gradient-to-r from-[#d4af37]/40 to-transparent max-w-[120px]"
                    ></div>
                  </div>
                  <p
                    class="text-sm font-semibold uppercase tracking-widest text-[#f4d47c]/70 mb-4"
                  >
                    Agent Orchestration
                  </p>
                  <h3
                    class="text-3xl lg:text-4xl xl:text-5xl font-bold text-white leading-tight mb-6"
                  >
                    Spawn a Team. Delegate. Conquer.
                  </h3>
                  <p class="text-lg text-gray-300 leading-relaxed mb-8">
                    Run Gemini CLI, Codex, Copilot, and Ptah CLI agents as
                    parallel workers. Fire-and-check orchestration with 6 MCP
                    lifecycle tools lets you delegate tasks across multiple AI
                    agents simultaneously.
                  </p>
                  <div class="space-y-3 mb-10">
                    <div class="flex items-start gap-3">
                      <lucide-angular
                        [img]="CheckIcon"
                        class="w-5 h-5 text-[#d4af37] mt-0.5 shrink-0"
                        aria-hidden="true"
                      /><span class="text-base text-gray-400"
                        >4 agent types: Gemini CLI, Codex SDK, Copilot SDK, Ptah
                        CLI</span
                      >
                    </div>
                    <div class="flex items-start gap-3">
                      <lucide-angular
                        [img]="CheckIcon"
                        class="w-5 h-5 text-[#d4af37] mt-0.5 shrink-0"
                        aria-hidden="true"
                      /><span class="text-base text-gray-400"
                        >Ptah CLI connects 200+ models via Claude Agent
                        SDK</span
                      >
                    </div>
                    <div class="flex items-start gap-3">
                      <lucide-angular
                        [img]="CheckIcon"
                        class="w-5 h-5 text-[#d4af37] mt-0.5 shrink-0"
                        aria-hidden="true"
                      /><span class="text-base text-gray-400"
                        >6 MCP lifecycle tools for fire-and-check
                        workflows</span
                      >
                    </div>
                    <div class="flex items-start gap-3">
                      <lucide-angular
                        [img]="CheckIcon"
                        class="w-5 h-5 text-[#d4af37] mt-0.5 shrink-0"
                        aria-hidden="true"
                      /><span class="text-base text-gray-400"
                        >True parallel execution across providers</span
                      >
                    </div>
                  </div>
                  <a
                    [routerLink]="['/docs']"
                    fragment="agent-orchestration"
                    class="inline-flex items-center gap-3 text-[#f4d47c] hover:text-[#d4af37] font-medium text-sm transition-colors group"
                  >
                    <div
                      class="w-9 h-9 rounded-full bg-[#d4af37]/10 border border-[#d4af37]/20 flex items-center justify-center group-hover:bg-[#d4af37]/20 transition-colors"
                    >
                      <lucide-angular
                        [img]="ArrowRightIcon"
                        class="w-4 h-4"
                        aria-hidden="true"
                      />
                    </div>
                    Explore Agent Orchestration
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ======== SLIDE 2: Skill Plugins (content right, image left) ======== -->
      <div
        hijackedScrollItem
        slideDirection="right"
        [fadeIn]="true"
        [scale]="true"
      >
        <div class="h-screen w-screen relative overflow-hidden bg-slate-950">
          <!-- Image fills left half only -->
          <div class="absolute inset-y-0 left-0 w-1/2" aria-hidden="true">
            <img
              src="/assets/images/showcase/panel-plugins.png"
              alt=""
              class="w-full h-full object-cover"
            />
            <div class="absolute inset-0 bg-slate-950/40"></div>
            <div
              class="absolute inset-0 bg-gradient-to-l from-slate-950 via-slate-950/50 to-transparent"
            ></div>
          </div>

          <div class="relative z-10 h-full flex items-center">
            <div class="w-full max-w-7xl mx-auto px-6 sm:px-10 lg:px-16">
              <div class="flex h-full items-center justify-end">
                <div class="w-full md:w-1/2 lg:w-[45%]">
                  <div class="flex items-center gap-4 mb-6">
                    <span
                      class="flex items-center justify-center w-14 h-14 rounded-full bg-gradient-to-br from-[#d4af37] to-[#8a6d10] text-[#0a0a0a] font-bold text-xl shadow-lg shadow-[#d4af37]/20"
                      >02</span
                    >
                    <div
                      class="h-px flex-1 bg-gradient-to-r from-[#d4af37]/40 to-transparent max-w-[120px]"
                    ></div>
                  </div>
                  <p
                    class="text-sm font-semibold uppercase tracking-widest text-[#f4d47c]/70 mb-4"
                  >
                    Skill Plugins
                  </p>
                  <h3
                    class="text-3xl lg:text-4xl xl:text-5xl font-bold text-white leading-tight mb-6"
                  >
                    Your Stack. Your Skills. Your Rules.
                  </h3>
                  <p class="text-lg text-gray-300 leading-relaxed mb-8">
                    Install domain-specific skill packs from skills.sh or the
                    built-in Skills Discovery panel in Ptah settings. Each
                    plugin brings specialized agents, slash commands, and code
                    patterns tuned for your stack.
                  </p>
                  <div class="space-y-3 mb-10">
                    <div class="flex items-start gap-3">
                      <lucide-angular
                        [img]="CheckIcon"
                        class="w-5 h-5 text-[#d4af37] mt-0.5 shrink-0"
                        aria-hidden="true"
                      /><span class="text-base text-gray-400"
                        >4+ skill packs: Core, Angular, NX SaaS, React</span
                      >
                    </div>
                    <div class="flex items-start gap-3">
                      <lucide-angular
                        [img]="CheckIcon"
                        class="w-5 h-5 text-[#d4af37] mt-0.5 shrink-0"
                        aria-hidden="true"
                      /><span class="text-base text-gray-400"
                        >skills.sh registry — browse & install with one
                        click</span
                      >
                    </div>
                    <div class="flex items-start gap-3">
                      <lucide-angular
                        [img]="CheckIcon"
                        class="w-5 h-5 text-[#d4af37] mt-0.5 shrink-0"
                        aria-hidden="true"
                      /><span class="text-base text-gray-400"
                        >Skills Discovery integrated into extension
                        settings</span
                      >
                    </div>
                    <div class="flex items-start gap-3">
                      <lucide-angular
                        [img]="CheckIcon"
                        class="w-5 h-5 text-[#d4af37] mt-0.5 shrink-0"
                        aria-hidden="true"
                      /><span class="text-base text-gray-400"
                        >Build custom plugins with the Skill Creator</span
                      >
                    </div>
                  </div>
                  <a
                    [routerLink]="['/docs']"
                    fragment="plugins"
                    class="inline-flex items-center gap-3 text-[#f4d47c] hover:text-[#d4af37] font-medium text-sm transition-colors group"
                  >
                    <div
                      class="w-9 h-9 rounded-full bg-[#d4af37]/10 border border-[#d4af37]/20 flex items-center justify-center group-hover:bg-[#d4af37]/20 transition-colors"
                    >
                      <lucide-angular
                        [img]="ArrowRightIcon"
                        class="w-4 h-4"
                        aria-hidden="true"
                      />
                    </div>
                    Explore Skill Plugins
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ======== SLIDE 3: Unified Providers (content left, image right) ======== -->
      <div
        hijackedScrollItem
        slideDirection="left"
        [fadeIn]="true"
        [scale]="true"
      >
        <div class="h-screen w-screen relative overflow-hidden bg-slate-950">
          <!-- Image fills right half only -->
          <div class="absolute inset-y-0 right-0 w-1/2" aria-hidden="true">
            <img
              src="/assets/images/showcase/panel-providers.png"
              alt=""
              class="w-full h-full object-cover"
            />
            <div class="absolute inset-0 bg-slate-950/40"></div>
            <div
              class="absolute inset-0 bg-gradient-to-r from-slate-950 via-slate-950/50 to-transparent"
            ></div>
          </div>

          <div class="relative z-10 h-full flex items-center">
            <div class="w-full max-w-7xl mx-auto px-6 sm:px-10 lg:px-16">
              <div class="flex h-full items-center">
                <div class="w-full md:w-1/2 lg:w-[45%]">
                  <div class="flex items-center gap-4 mb-6">
                    <span
                      class="flex items-center justify-center w-14 h-14 rounded-full bg-gradient-to-br from-[#d4af37] to-[#8a6d10] text-[#0a0a0a] font-bold text-xl shadow-lg shadow-[#d4af37]/20"
                      >03</span
                    >
                    <div
                      class="h-px flex-1 bg-gradient-to-r from-[#d4af37]/40 to-transparent max-w-[120px]"
                    ></div>
                  </div>
                  <p
                    class="text-sm font-semibold uppercase tracking-widest text-[#f4d47c]/70 mb-4"
                  >
                    Unified Providers
                  </p>
                  <h3
                    class="text-3xl lg:text-4xl xl:text-5xl font-bold text-white leading-tight mb-6"
                  >
                    One Harness. Every Model. Total Control.
                  </h3>
                  <p class="text-lg text-gray-300 leading-relaxed mb-8">
                    Access OpenAI, Claude, Copilot, Gemini, and 200+ OpenRouter
                    models in a single unified interface. Switch providers
                    seamlessly, share conversation context, and track costs in
                    real time.
                  </p>
                  <div class="space-y-3 mb-10">
                    <div class="flex items-start gap-3">
                      <lucide-angular
                        [img]="CheckIcon"
                        class="w-5 h-5 text-[#d4af37] mt-0.5 shrink-0"
                        aria-hidden="true"
                      /><span class="text-base text-gray-400"
                        >Unified provider tiles with one-click switching</span
                      >
                    </div>
                    <div class="flex items-start gap-3">
                      <lucide-angular
                        [img]="CheckIcon"
                        class="w-5 h-5 text-[#d4af37] mt-0.5 shrink-0"
                        aria-hidden="true"
                      /><span class="text-base text-gray-400"
                        >Shared context preserved across provider changes</span
                      >
                    </div>
                    <div class="flex items-start gap-3">
                      <lucide-angular
                        [img]="CheckIcon"
                        class="w-5 h-5 text-[#d4af37] mt-0.5 shrink-0"
                        aria-hidden="true"
                      /><span class="text-base text-gray-400"
                        >Real-time cost & token usage dashboards</span
                      >
                    </div>
                    <div class="flex items-start gap-3">
                      <lucide-angular
                        [img]="CheckIcon"
                        class="w-5 h-5 text-[#d4af37] mt-0.5 shrink-0"
                        aria-hidden="true"
                      /><span class="text-base text-gray-400"
                        >Secure per-provider API key management</span
                      >
                    </div>
                  </div>
                  <a
                    [routerLink]="['/docs']"
                    fragment="providers"
                    class="inline-flex items-center gap-3 text-[#f4d47c] hover:text-[#d4af37] font-medium text-sm transition-colors group"
                  >
                    <div
                      class="w-9 h-9 rounded-full bg-[#d4af37]/10 border border-[#d4af37]/20 flex items-center justify-center group-hover:bg-[#d4af37]/20 transition-colors"
                    >
                      <lucide-angular
                        [img]="ArrowRightIcon"
                        class="w-4 h-4"
                        aria-hidden="true"
                      />
                    </div>
                    Explore Unified Providers
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ======== SLIDE 4: Setup Wizard (content right, image left) ======== -->
      <div
        hijackedScrollItem
        slideDirection="right"
        [fadeIn]="true"
        [scale]="true"
      >
        <div class="h-screen w-screen relative overflow-hidden bg-slate-950">
          <!-- Image fills left half only -->
          <div class="absolute inset-y-0 left-0 w-1/2" aria-hidden="true">
            <img
              src="/assets/images/showcase/panel-setup-wizard.png"
              alt=""
              class="w-full h-full object-cover"
            />
            <div class="absolute inset-0 bg-slate-950/40"></div>
            <div
              class="absolute inset-0 bg-gradient-to-l from-slate-950 via-slate-950/50 to-transparent"
            ></div>
          </div>

          <div class="relative z-10 h-full flex items-center">
            <div class="w-full max-w-7xl mx-auto px-6 sm:px-10 lg:px-16">
              <div class="flex h-full items-center justify-end">
                <div class="w-full md:w-1/2 lg:w-[45%]">
                  <div class="flex items-center gap-4 mb-6">
                    <span
                      class="flex items-center justify-center w-14 h-14 rounded-full bg-gradient-to-br from-[#d4af37] to-[#8a6d10] text-[#0a0a0a] font-bold text-xl shadow-lg shadow-[#d4af37]/20"
                      >04</span
                    >
                    <div
                      class="h-px flex-1 bg-gradient-to-r from-[#d4af37]/40 to-transparent max-w-[120px]"
                    ></div>
                  </div>
                  <p
                    class="text-sm font-semibold uppercase tracking-widest text-[#f4d47c]/70 mb-4"
                  >
                    Setup Wizard
                  </p>
                  <h3
                    class="text-3xl lg:text-4xl xl:text-5xl font-bold text-white leading-tight mb-6"
                  >
                    Instant Project Awareness. From Day One.
                  </h3>
                  <p class="text-lg text-gray-300 leading-relaxed mb-8">
                    Ptah's Setup Wizard scans your workspace in seconds —
                    detects 13+ project types, analyzes dependencies, and
                    generates custom CLAUDE.md rules and project-adaptive
                    agents. Your AI starts fully informed.
                  </p>
                  <div class="space-y-3 mb-10">
                    <div class="flex items-start gap-3">
                      <lucide-angular
                        [img]="CheckIcon"
                        class="w-5 h-5 text-[#d4af37] mt-0.5 shrink-0"
                        aria-hidden="true"
                      /><span class="text-base text-gray-400"
                        >6-step automated workspace analysis</span
                      >
                    </div>
                    <div class="flex items-start gap-3">
                      <lucide-angular
                        [img]="CheckIcon"
                        class="w-5 h-5 text-[#d4af37] mt-0.5 shrink-0"
                        aria-hidden="true"
                      /><span class="text-base text-gray-400"
                        >13+ project type detection including monorepos</span
                      >
                    </div>
                    <div class="flex items-start gap-3">
                      <lucide-angular
                        [img]="CheckIcon"
                        class="w-5 h-5 text-[#d4af37] mt-0.5 shrink-0"
                        aria-hidden="true"
                      /><span class="text-base text-gray-400"
                        >LLM-generated rules & custom agent configurations</span
                      >
                    </div>
                    <div class="flex items-start gap-3">
                      <lucide-angular
                        [img]="CheckIcon"
                        class="w-5 h-5 text-[#d4af37] mt-0.5 shrink-0"
                        aria-hidden="true"
                      /><span class="text-base text-gray-400"
                        >Persistent project context across all sessions</span
                      >
                    </div>
                  </div>
                  <a
                    [routerLink]="['/docs']"
                    fragment="setup-wizard"
                    class="inline-flex items-center gap-3 text-[#f4d47c] hover:text-[#d4af37] font-medium text-sm transition-colors group"
                  >
                    <div
                      class="w-9 h-9 rounded-full bg-[#d4af37]/10 border border-[#d4af37]/20 flex items-center justify-center group-hover:bg-[#d4af37]/20 transition-colors"
                    >
                      <lucide-angular
                        [img]="ArrowRightIcon"
                        class="w-4 h-4"
                        aria-hidden="true"
                      />
                    </div>
                    Explore Setup Wizard
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </agsp-scroll-timeline>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class PremiumShowcaseComponent {
  public readonly CheckIcon = Check;
  public readonly ArrowRightIcon = ArrowRight;

  public readonly currentStep = signal(0);

  public onStepChange(step: number): void {
    this.currentStep.set(step);
  }
}
