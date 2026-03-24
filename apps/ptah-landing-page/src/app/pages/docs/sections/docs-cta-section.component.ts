import { Component, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ViewportAnimationDirective,
  ViewportAnimationConfig,
} from '@hive-academy/angular-gsap';
import { LucideAngularModule, Monitor, Download, Check } from 'lucide-angular';

@Component({
  selector: 'ptah-docs-cta',
  imports: [CommonModule, ViewportAnimationDirective, LucideAngularModule],
  template: `
    <section id="get-started" class="py-16 sm:py-24">
      <div class="max-w-4xl mx-auto text-center">
        <h2
          viewportAnimation
          [viewportConfig]="headingConfig"
          class="text-3xl sm:text-4xl font-display font-bold gradient-text-gold mb-4"
        >
          Ready to Get Started?
        </h2>
        <p
          viewportAnimation
          [viewportConfig]="subtitleConfig"
          class="text-neutral-content/70 mb-12 max-w-xl mx-auto"
        >
          Choose your platform and start building with intelligent AI agents
          today.
        </p>

        <!-- Two CTA cards -->
        <div
          viewportAnimation
          [viewportConfig]="cardsConfig"
          class="grid grid-cols-1 sm:grid-cols-2 gap-6 max-w-2xl mx-auto"
        >
          <!-- VS Code Extension card -->
          <div
            class="relative flex flex-col items-center gap-5 pt-10 pb-8 px-8 rounded-2xl bg-gradient-to-b from-amber-500/[0.06] to-transparent border border-amber-400/20 hover:border-amber-400/40 transition-all duration-300 group"
          >
            <span
              class="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-base-100 border border-amber-400/50 text-xs font-bold text-amber-400 tracking-wide z-10 whitespace-nowrap"
            >
              14 DAYS TRIAL
            </span>
            <div
              class="w-14 h-14 rounded-xl bg-amber-500/10 border border-amber-400/20 flex items-center justify-center group-hover:bg-amber-500/20 transition-colors"
            >
              <lucide-angular
                [img]="MonitorIcon"
                class="w-7 h-7 text-amber-400"
                aria-hidden="true"
              />
            </div>
            <div>
              <h3 class="text-lg font-semibold text-base-content mb-1">
                VS Code Extension
              </h3>
              <p class="text-sm text-neutral-content/60">
                Install directly from the VS Code Marketplace
              </p>
            </div>
            <a
              href="https://marketplace.visualstudio.com/items?itemName=ptah.ptah"
              target="_blank"
              rel="noopener noreferrer"
              class="cta-glow-button block relative overflow-hidden w-full px-6 py-3 rounded-xl text-white font-semibold text-sm text-center"
            >
              <span class="relative z-[1]">Install Extension</span>
            </a>
          </div>

          <!-- Desktop App card -->
          <div
            class="relative flex flex-col items-center gap-5 pt-10 pb-8 px-8 rounded-2xl bg-gradient-to-b from-amber-500/[0.06] to-transparent border border-amber-400/20 hover:border-amber-400/40 transition-all duration-300 group"
          >
            <span
              class="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-base-100 border border-amber-400/50 text-xs font-bold text-amber-400 tracking-wide z-10 whitespace-nowrap"
            >
              14 DAYS TRIAL
            </span>
            <div
              class="w-14 h-14 rounded-xl bg-amber-500/10 border border-amber-400/20 flex items-center justify-center group-hover:bg-amber-500/20 transition-colors"
            >
              <lucide-angular
                [img]="DownloadIcon"
                class="w-7 h-7 text-amber-400"
                aria-hidden="true"
              />
            </div>
            <div>
              <h3 class="text-lg font-semibold text-base-content mb-1">
                Desktop App
              </h3>
              <p class="text-sm text-neutral-content/60">
                Standalone desktop experience for any editor
              </p>
            </div>
            <a
              href="https://github.com/Hive-Academy/ptah-extension/releases/latest"
              target="_blank"
              rel="noopener noreferrer"
              class="cta-glow-button block relative overflow-hidden w-full px-6 py-3 rounded-xl text-white font-semibold text-sm text-center"
            >
              <span class="relative z-[1]">Download Desktop App</span>
            </a>
          </div>
        </div>

        <!-- Trust signals -->
        <div
          viewportAnimation
          [viewportConfig]="trustConfig"
          class="mt-10 flex flex-wrap justify-center gap-6"
        >
          @for (signal of trustSignals; track signal) {
          <div class="flex items-center gap-2 text-base-content/60">
            <lucide-angular
              [img]="CheckIcon"
              class="w-4 h-4 text-success"
              aria-hidden="true"
            />
            <span class="text-sm font-medium">{{ signal }}</span>
          </div>
          }
        </div>
      </div>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .cta-glow-button {
        background: linear-gradient(
          135deg,
          rgba(212, 175, 55, 0.15) 0%,
          rgba(212, 175, 55, 0.05) 50%,
          rgba(212, 175, 55, 0.15) 100%
        );
        border: 1px solid rgba(212, 175, 55, 0.3);
        box-shadow: 0 0 15px rgba(212, 175, 55, 0.15),
          0 0 30px rgba(212, 175, 55, 0.05),
          inset 0 1px 0 rgba(244, 212, 124, 0.1);
        transition: all 0.3s ease;
      }

      .cta-glow-button:hover {
        transform: translateY(-2px);
        border-color: rgba(212, 175, 55, 0.5);
        box-shadow: 0 0 20px rgba(212, 175, 55, 0.3),
          0 0 50px rgba(212, 175, 55, 0.1),
          inset 0 1px 0 rgba(244, 212, 124, 0.2);
      }

      .cta-glow-button::before {
        content: '';
        position: absolute;
        top: 50%;
        left: 50%;
        width: 200%;
        height: 200%;
        background: conic-gradient(
          from 0deg,
          transparent 0%,
          transparent 65%,
          rgba(244, 212, 124, 0.7) 75%,
          rgba(212, 175, 55, 1) 80%,
          rgba(244, 212, 124, 0.7) 85%,
          transparent 95%,
          transparent 100%
        );
        animation: beam-spin 4s linear infinite;
        z-index: 0;
      }

      .cta-glow-button::after {
        content: '';
        position: absolute;
        inset: 1px;
        border-radius: 10px;
        background: linear-gradient(
          135deg,
          rgba(15, 23, 42, 0.95) 0%,
          rgba(15, 23, 42, 0.98) 50%,
          rgba(15, 23, 42, 0.95) 100%
        );
        z-index: 0;
      }

      @keyframes beam-spin {
        from {
          transform: translate(-50%, -50%) rotate(0deg);
        }
        to {
          transform: translate(-50%, -50%) rotate(360deg);
        }
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DocsCtaSectionComponent {
  public readonly MonitorIcon = Monitor;
  public readonly DownloadIcon = Download;
  public readonly CheckIcon = Check;

  public readonly trustSignals = [
    'No credit card required',
    'All 13 agents included',
    'Cancel anytime',
  ];

  public readonly headingConfig: ViewportAnimationConfig = {
    animation: 'scaleIn',
    duration: 0.7,
    threshold: 0.2,
  };

  public readonly subtitleConfig: ViewportAnimationConfig = {
    animation: 'fadeIn',
    duration: 0.7,
    delay: 0.1,
    threshold: 0.2,
  };

  public readonly cardsConfig: ViewportAnimationConfig = {
    animation: 'slideUp',
    duration: 0.7,
    delay: 0.2,
    ease: 'back.out(1.7)',
    threshold: 0.1,
  };

  public readonly trustConfig: ViewportAnimationConfig = {
    animation: 'fadeIn',
    duration: 0.5,
    delay: 0.35,
    threshold: 0.2,
  };
}
