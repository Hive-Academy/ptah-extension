import { Component, ChangeDetectionStrategy } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  LucideAngularModule,
  ArrowRight,
  Check,
  GitFork,
  Download,
  Code,
} from 'lucide-angular';
import {
  ViewportAnimationDirective,
  ViewportAnimationConfig,
} from '@hive-academy/angular-gsap';

@Component({
  selector: 'ptah-open-source-section',
  imports: [RouterLink, LucideAngularModule, ViewportAnimationDirective],
  template: `
    <section class="relative py-24 sm:py-32 bg-slate-950 overflow-hidden">
      <!-- Background pattern -->
      <div class="absolute inset-0" aria-hidden="true">
        <div
          class="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(212,175,55,0.05),transparent_60%)]"
        ></div>
        <div
          class="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,rgba(30,58,138,0.08),transparent_60%)]"
        ></div>
      </div>

      <div class="relative z-10 max-w-7xl mx-auto px-6 sm:px-10 lg:px-16">
        <!-- Section Header -->
        <div class="text-center mb-16 sm:mb-20">
          <p
            viewportAnimation
            [viewportConfig]="labelConfig"
            class="text-sm font-semibold uppercase tracking-widest text-[#f4d47c]/70 mb-4"
          >
            Open Source
          </p>
          <h2
            viewportAnimation
            [viewportConfig]="headlineConfig"
            class="text-3xl sm:text-4xl lg:text-5xl xl:text-6xl font-bold text-white leading-tight mb-6"
          >
            Built in the Open.
            <span class="gradient-text-gold">Yours to Shape.</span>
          </h2>
          <p
            viewportAnimation
            [viewportConfig]="subheadlineConfig"
            class="text-lg sm:text-xl text-gray-400 max-w-3xl mx-auto leading-relaxed"
          >
            Ptah is open source under the FSL-1.1-MIT license. Use the hosted
            extension, download the Electron app, or fork the entire project and
            make it yours.
          </p>
        </div>

        <!-- Three Cards -->
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8 mb-16">
          <!-- Card 1: VS Code Extension -->
          <div
            viewportAnimation
            [viewportConfig]="card1Config"
            class="group relative rounded-2xl border border-[#d4af37]/20 bg-slate-900/60 backdrop-blur-sm p-8 hover:border-[#d4af37]/40 transition-all duration-300"
          >
            <div
              class="absolute inset-0 rounded-2xl bg-gradient-to-b from-[#d4af37]/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"
            ></div>
            <div class="relative z-10">
              <div
                class="w-12 h-12 rounded-xl bg-[#d4af37]/10 border border-[#d4af37]/20 flex items-center justify-center mb-6"
              >
                <lucide-angular
                  [img]="CodeIcon"
                  class="w-6 h-6 text-[#d4af37]"
                  aria-hidden="true"
                />
              </div>
              <h3 class="text-xl font-bold text-white mb-3">
                VS Code Extension
              </h3>
              <p class="text-gray-400 mb-6 leading-relaxed">
                Install from the Marketplace and get a 30-day free trial. Access
                every provider, agent orchestration, and the full plugin
                ecosystem.
              </p>
              <ul class="space-y-2.5 mb-8">
                <li class="flex items-start gap-2.5">
                  <lucide-angular
                    [img]="CheckIcon"
                    class="w-4 h-4 text-[#d4af37] mt-0.5 shrink-0"
                    aria-hidden="true"
                  />
                  <span class="text-sm text-gray-400"
                    >30-day free trial, no credit card</span
                  >
                </li>
                <li class="flex items-start gap-2.5">
                  <lucide-angular
                    [img]="CheckIcon"
                    class="w-4 h-4 text-[#d4af37] mt-0.5 shrink-0"
                    aria-hidden="true"
                  />
                  <span class="text-sm text-gray-400"
                    >All providers & 200+ models</span
                  >
                </li>
                <li class="flex items-start gap-2.5">
                  <lucide-angular
                    [img]="CheckIcon"
                    class="w-4 h-4 text-[#d4af37] mt-0.5 shrink-0"
                    aria-hidden="true"
                  />
                  <span class="text-sm text-gray-400"
                    >Automatic updates & support</span
                  >
                </li>
              </ul>
              <a
                routerLink="/signup"
                class="inline-flex items-center gap-2 text-[#f4d47c] hover:text-[#d4af37] font-medium text-sm transition-colors group/link"
              >
                <div
                  class="w-8 h-8 rounded-full bg-[#d4af37]/10 border border-[#d4af37]/20 flex items-center justify-center group-hover/link:bg-[#d4af37]/20 transition-colors"
                >
                  <lucide-angular
                    [img]="ArrowRightIcon"
                    class="w-3.5 h-3.5"
                    aria-hidden="true"
                  />
                </div>
                Sign Up & Subscribe
              </a>
            </div>
          </div>

          <!-- Card 2: Electron App -->
          <div
            viewportAnimation
            [viewportConfig]="card2Config"
            class="group relative rounded-2xl border border-[#d4af37]/20 bg-slate-900/60 backdrop-blur-sm p-8 hover:border-[#d4af37]/40 transition-all duration-300"
          >
            <div
              class="absolute inset-0 rounded-2xl bg-gradient-to-b from-[#d4af37]/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"
            ></div>
            <div class="relative z-10">
              <div
                class="w-12 h-12 rounded-xl bg-[#d4af37]/10 border border-[#d4af37]/20 flex items-center justify-center mb-6"
              >
                <lucide-angular
                  [img]="DownloadIcon"
                  class="w-6 h-6 text-[#d4af37]"
                  aria-hidden="true"
                />
              </div>
              <h3 class="text-xl font-bold text-white mb-3">
                Standalone Desktop App
              </h3>
              <p class="text-gray-400 mb-6 leading-relaxed">
                Download the Electron app for Windows, macOS, or Linux. Same
                powerful features, no VS Code required. Use your existing
                subscription.
              </p>
              <ul class="space-y-2.5 mb-8">
                <li class="flex items-start gap-2.5">
                  <lucide-angular
                    [img]="CheckIcon"
                    class="w-4 h-4 text-[#d4af37] mt-0.5 shrink-0"
                    aria-hidden="true"
                  />
                  <span class="text-sm text-gray-400"
                    >Windows, macOS & Linux</span
                  >
                </li>
                <li class="flex items-start gap-2.5">
                  <lucide-angular
                    [img]="CheckIcon"
                    class="w-4 h-4 text-[#d4af37] mt-0.5 shrink-0"
                    aria-hidden="true"
                  />
                  <span class="text-sm text-gray-400"
                    >Works with your existing license</span
                  >
                </li>
                <li class="flex items-start gap-2.5">
                  <lucide-angular
                    [img]="CheckIcon"
                    class="w-4 h-4 text-[#d4af37] mt-0.5 shrink-0"
                    aria-hidden="true"
                  />
                  <span class="text-sm text-gray-400"
                    >Auto-updates via GitHub Releases</span
                  >
                </li>
              </ul>
              <a
                routerLink="/download"
                class="inline-flex items-center gap-2 text-[#f4d47c] hover:text-[#d4af37] font-medium text-sm transition-colors group/link"
              >
                <div
                  class="w-8 h-8 rounded-full bg-[#d4af37]/10 border border-[#d4af37]/20 flex items-center justify-center group-hover/link:bg-[#d4af37]/20 transition-colors"
                >
                  <lucide-angular
                    [img]="DownloadIcon"
                    class="w-3.5 h-3.5"
                    aria-hidden="true"
                  />
                </div>
                Download Latest Release
              </a>
            </div>
          </div>

          <!-- Card 3: Fork & Build Your Own -->
          <div
            viewportAnimation
            [viewportConfig]="card3Config"
            class="group relative rounded-2xl border border-[#d4af37]/20 bg-slate-900/60 backdrop-blur-sm p-8 hover:border-[#d4af37]/40 transition-all duration-300"
          >
            <div
              class="absolute inset-0 rounded-2xl bg-gradient-to-b from-[#d4af37]/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"
            ></div>
            <div class="relative z-10">
              <div
                class="w-12 h-12 rounded-xl bg-[#d4af37]/10 border border-[#d4af37]/20 flex items-center justify-center mb-6"
              >
                <lucide-angular
                  [img]="GitForkIcon"
                  class="w-6 h-6 text-[#d4af37]"
                  aria-hidden="true"
                />
              </div>
              <h3 class="text-xl font-bold text-white mb-3">
                Fork & Build Your Own
              </h3>
              <p class="text-gray-400 mb-6 leading-relaxed">
                The entire source code is on GitHub. Fork it, customize it, add
                your own providers and plugins, or build a completely new
                product on top of Ptah's architecture.
              </p>
              <ul class="space-y-2.5 mb-8">
                <li class="flex items-start gap-2.5">
                  <lucide-angular
                    [img]="CheckIcon"
                    class="w-4 h-4 text-[#d4af37] mt-0.5 shrink-0"
                    aria-hidden="true"
                  />
                  <span class="text-sm text-gray-400"
                    >FSL-1.1-MIT license (MIT after 2 years)</span
                  >
                </li>
                <li class="flex items-start gap-2.5">
                  <lucide-angular
                    [img]="CheckIcon"
                    class="w-4 h-4 text-[#d4af37] mt-0.5 shrink-0"
                    aria-hidden="true"
                  />
                  <span class="text-sm text-gray-400"
                    >Full Nx monorepo with 19 projects</span
                  >
                </li>
                <li class="flex items-start gap-2.5">
                  <lucide-angular
                    [img]="CheckIcon"
                    class="w-4 h-4 text-[#d4af37] mt-0.5 shrink-0"
                    aria-hidden="true"
                  />
                  <span class="text-sm text-gray-400"
                    >Contributing guide & developer docs</span
                  >
                </li>
              </ul>
              <a
                href="https://github.com/Hive-Academy/ptah-extension"
                target="_blank"
                rel="noopener noreferrer"
                class="inline-flex items-center gap-2 text-[#f4d47c] hover:text-[#d4af37] font-medium text-sm transition-colors group/link"
              >
                <div
                  class="w-8 h-8 rounded-full bg-[#d4af37]/10 border border-[#d4af37]/20 flex items-center justify-center group-hover/link:bg-[#d4af37]/20 transition-colors"
                >
                  <lucide-angular
                    [img]="GitForkIcon"
                    class="w-3.5 h-3.5"
                    aria-hidden="true"
                  />
                </div>
                View on GitHub
              </a>
            </div>
          </div>
        </div>

        <!-- Bottom CTA bar -->
        <div
          viewportAnimation
          [viewportConfig]="ctaBarConfig"
          class="text-center"
        >
          <div
            class="inline-flex flex-col sm:flex-row items-center gap-4 sm:gap-6 p-6 sm:p-8 rounded-2xl border border-white/5 bg-white/[0.02]"
          >
            <p class="text-gray-300 text-base sm:text-lg">
              Ready to get started?
            </p>
            <div class="flex items-center gap-3">
              <a
                href="https://marketplace.visualstudio.com/items?itemName=ptah-extensions.ptah-coding-orchestra"
                target="_blank"
                rel="noopener noreferrer"
                class="bg-gradient-to-r from-amber-500 to-amber-600 text-slate-900 px-6 py-2.5 rounded-lg font-semibold text-sm hover:from-amber-400 hover:to-amber-500 hover:scale-105 transition-all duration-200 shadow-lg shadow-amber-500/20"
              >
                Get the Extension
              </a>
              <a
                href="https://github.com/Hive-Academy/ptah-extension"
                target="_blank"
                rel="noopener noreferrer"
                class="flex items-center gap-2 border border-white/10 hover:border-[#d4af37]/30 text-white/80 hover:text-white px-5 py-2.5 rounded-lg font-medium text-sm transition-all duration-200"
              >
                <svg
                  class="w-4 h-4"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path
                    d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"
                  />
                </svg>
                Star on GitHub
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OpenSourceSectionComponent {
  public readonly ArrowRightIcon = ArrowRight;
  public readonly CheckIcon = Check;
  public readonly GitForkIcon = GitFork;
  public readonly DownloadIcon = Download;
  public readonly CodeIcon = Code;

  public readonly labelConfig: ViewportAnimationConfig = {
    animation: 'fadeIn',
    duration: 0.6,
    threshold: 0.2,
  };

  public readonly headlineConfig: ViewportAnimationConfig = {
    animation: 'scaleIn',
    duration: 0.8,
    delay: 0.1,
    threshold: 0.2,
  };

  public readonly subheadlineConfig: ViewportAnimationConfig = {
    animation: 'fadeIn',
    duration: 0.8,
    delay: 0.2,
    threshold: 0.2,
  };

  public readonly card1Config: ViewportAnimationConfig = {
    animation: 'slideUp',
    duration: 0.7,
    delay: 0.1,
    ease: 'power2.out',
    threshold: 0.15,
  };

  public readonly card2Config: ViewportAnimationConfig = {
    animation: 'slideUp',
    duration: 0.7,
    delay: 0.2,
    ease: 'power2.out',
    threshold: 0.15,
  };

  public readonly card3Config: ViewportAnimationConfig = {
    animation: 'slideUp',
    duration: 0.7,
    delay: 0.3,
    ease: 'power2.out',
    threshold: 0.15,
  };

  public readonly ctaBarConfig: ViewportAnimationConfig = {
    animation: 'fadeIn',
    duration: 0.8,
    delay: 0.4,
    threshold: 0.2,
  };
}
