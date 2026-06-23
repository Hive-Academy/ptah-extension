import { Component, ChangeDetectionStrategy } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideAngularModule, Check, ArrowRight } from 'lucide-angular';
import {
  ViewportAnimationDirective,
  ViewportAnimationConfig,
} from '@hive-academy/angular-gsap';
import {
  FloatingGlyph,
  FloatingGlyphsComponent,
} from '../../components/floating-glyphs.component';

@Component({
  selector: 'ptah-cta-section',
  imports: [
    RouterLink,
    ViewportAnimationDirective,
    LucideAngularModule,
    FloatingGlyphsComponent,
  ],
  template: `
    <section
      id="cta"
      aria-label="Get Started"
      class="relative py-32 sm:py-44 bg-slate-950 overflow-hidden"
    >
      <div
        class="absolute inset-x-0 bottom-0 h-[60%] bg-[radial-gradient(ellipse_at_bottom,rgba(212,175,55,0.08),transparent_70%)] pointer-events-none"
        aria-hidden="true"
      ></div>
      <ptah-floating-glyphs [glyphs]="glyphs" />

      <div
        class="relative z-10 max-w-3xl mx-auto px-6 sm:px-10 lg:px-16 text-center"
      >
        <h2
          viewportAnimation
          [viewportConfig]="headlineConfig"
          class="font-display text-3xl sm:text-4xl lg:text-5xl font-semibold text-[#f4d47c] mb-8"
        >
          Start Building.
        </h2>

        <p
          viewportAnimation
          [viewportConfig]="subheadlineConfig"
          class="text-base sm:text-lg text-gray-400 mb-14 max-w-xl mx-auto leading-relaxed"
        >
          100 days free. No credit card required. VS Code, Desktop, or headless
          CLI.
        </p>

        <div
          class="flex flex-col sm:flex-row justify-center items-center gap-5"
        >
          <div viewportAnimation [viewportConfig]="primaryCtaConfig">
            <a
              href="https://marketplace.visualstudio.com/items?itemName=ptah-extensions.ptah-coding-orchestra"
              target="_blank"
              rel="noopener noreferrer"
              class="inline-block px-8 py-3.5 text-base font-semibold rounded-lg bg-gradient-to-r from-amber-500 to-amber-600 text-slate-900 hover:from-amber-400 hover:to-amber-500 transition-all duration-200 shadow-lg shadow-amber-500/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 focus-visible:outline-offset-2"
              aria-label="Install Ptah Extension from VS Code Marketplace"
            >
              Install VS Code Extension
            </a>
          </div>
          <div viewportAnimation [viewportConfig]="secondaryCtaConfig">
            <a
              routerLink="/download"
              class="inline-block px-8 py-3.5 text-base font-semibold rounded-lg border border-[#d4af37]/40 text-[#f4d47c] hover:border-[#d4af37]/70 hover:bg-[#d4af37]/5 transition-all duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 focus-visible:outline-offset-2"
              aria-label="Download the Ptah desktop app"
            >
              Download Desktop App
            </a>
          </div>
        </div>

        <div
          viewportAnimation
          [viewportConfig]="tertiaryCtaConfig"
          class="mt-8"
        >
          <a
            href="https://docs.ptah.live/providers/ptah-cli/"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-2 text-sm font-medium text-gray-500 hover:text-[#f4d47c] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 focus-visible:outline-offset-2 rounded-md"
            aria-label="Read the CLI documentation"
          >
            or try the CLI
            <lucide-angular
              [img]="ArrowRightIcon"
              class="w-3.5 h-3.5"
              aria-hidden="true"
            />
          </a>
        </div>

        <div
          class="mt-16 pt-10 border-t border-white/5 flex flex-wrap justify-center gap-x-10 gap-y-4"
        >
          @for (signal of trustSignals; track signal; let i = $index) {
            <div
              viewportAnimation
              [viewportConfig]="getTrustSignalConfig(i)"
              class="flex items-center gap-2.5 text-gray-500"
            >
              <lucide-angular
                [img]="CheckIcon"
                class="w-4 h-4 text-[#d4af37]"
                aria-hidden="true"
              />
              <span class="text-sm">{{ signal }}</span>
            </div>
          }
        </div>
      </div>
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CTASectionComponent {
  public readonly CheckIcon = Check;
  public readonly ArrowRightIcon = ArrowRight;

  public readonly trustSignals = [
    '100-Day Free Trial',
    'No Credit Card Required',
    'All Three Runtimes Included',
  ];

  public readonly glyphs: FloatingGlyph[] = [
    {
      src: '/assets/icons/glyphs/ankh.png',
      size: 95,
      top: '16%',
      left: '8%',
      delay: 0,
      duration: 10,
    },
    {
      src: '/assets/icons/glyphs/eye-of-horus.png',
      size: 110,
      top: '22%',
      right: '7%',
      delay: 2.4,
      duration: 12,
    },
  ];

  public readonly headlineConfig: ViewportAnimationConfig = {
    animation: 'slideUp',
    duration: 0.8,
    threshold: 0.2,
  };

  public readonly subheadlineConfig: ViewportAnimationConfig = {
    animation: 'fadeIn',
    duration: 0.8,
    delay: 0.1,
    threshold: 0.2,
  };

  public readonly primaryCtaConfig: ViewportAnimationConfig = {
    animation: 'slideUp',
    duration: 0.6,
    delay: 0.2,
    threshold: 0.2,
  };

  public readonly secondaryCtaConfig: ViewportAnimationConfig = {
    animation: 'slideUp',
    duration: 0.6,
    delay: 0.3,
    threshold: 0.2,
  };

  public readonly tertiaryCtaConfig: ViewportAnimationConfig = {
    animation: 'fadeIn',
    duration: 0.6,
    delay: 0.4,
    threshold: 0.2,
  };

  public getTrustSignalConfig(index: number): ViewportAnimationConfig {
    return {
      animation: 'fadeIn',
      duration: 0.5,
      delay: 0.45 + index * 0.1,
      threshold: 0.2,
    };
  }
}
