import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Check, Download, LucideAngularModule } from 'lucide-angular';
import {
  ViewportAnimationConfig,
  ViewportAnimationDirective,
} from '@hive-academy/angular-gsap';
import { ConsoleGridBackgroundComponent } from '../../components/console/console-grid-background.component';

/**
 * CTASectionComponent — S10 Final CTA (design spec §4 S10, copy deck S10).
 *
 * Repeats the single primary action (Download) with trial framing, and absorbs
 * the "Open Source (FSL-1.1-MIT)" fact from the retired open-source section into
 * its trust row. Bookends the page on the same ConsoleGridBackground + amber
 * glow treatment as the hero.
 */
@Component({
  selector: 'ptah-cta-section',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    ViewportAnimationDirective,
    LucideAngularModule,
    ConsoleGridBackgroundComponent,
  ],
  template: `
    <section
      id="cta"
      aria-label="Download Ptah"
      class="relative bg-ink-950 py-24 sm:py-32 overflow-hidden"
    >
      <ptah-console-grid-background [glow]="true" />

      <div
        class="relative z-10 max-w-3xl mx-auto px-6 sm:px-10 lg:px-16 text-center"
      >
        <h2
          viewportAnimation
          [viewportConfig]="headlineConfig"
          class="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-white mb-6"
        >
          Download Ptah.
        </h2>

        <p
          viewportAnimation
          [viewportConfig]="subheadlineConfig"
          class="text-lg sm:text-xl text-ink-400 mb-10 max-w-xl mx-auto leading-relaxed"
        >
          100 days free. No credit card. Windows, macOS, and Linux.
        </p>

        <div viewportAnimation [viewportConfig]="primaryCtaConfig">
          <a
            routerLink="/download"
            class="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-lg bg-amber-500 text-ink-950 font-semibold text-sm sm:text-base transition-all duration-200 hover:bg-amber-400 hover:-translate-y-0.5 hover:shadow-glow-amber active:bg-amber-600 active:translate-y-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 focus-visible:outline-offset-2"
            aria-label="Download the Ptah desktop app"
          >
            <lucide-angular
              [img]="downloadIcon"
              class="w-4 h-4"
              aria-hidden="true"
            />
            Download Ptah
          </a>
        </div>

        <div
          viewportAnimation
          [viewportConfig]="tertiaryCtaConfig"
          class="mt-6"
        >
          <a
            routerLink="/pricing"
            class="text-amber-500 hover:text-amber-400 text-sm font-medium underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 focus-visible:outline-offset-2 rounded"
          >
            or view pricing →
          </a>
        </div>

        <div
          class="mt-12 flex flex-wrap justify-center gap-x-8 gap-y-3"
        >
          @for (signal of trustSignals; track signal; let i = $index) {
            <div
              viewportAnimation
              [viewportConfig]="getTrustSignalConfig(i)"
              class="flex items-center gap-2.5 text-ink-400"
            >
              <lucide-angular
                [img]="checkIcon"
                class="w-4 h-4 text-emerald-400"
                aria-hidden="true"
              />
              <span class="text-sm">{{ signal }}</span>
            </div>
          }
        </div>
      </div>
    </section>
  `,
})
export class CTASectionComponent {
  protected readonly checkIcon = Check;
  protected readonly downloadIcon = Download;

  protected readonly trustSignals = [
    '100-Day Free Trial',
    'No Credit Card Required',
    'Open Source (FSL-1.1-MIT)',
  ];

  protected readonly headlineConfig: ViewportAnimationConfig = {
    animation: 'slideUp',
    duration: 0.6,
    threshold: 0.2,
    ease: 'power2.out',
  };

  protected readonly subheadlineConfig: ViewportAnimationConfig = {
    animation: 'fadeIn',
    duration: 0.6,
    delay: 0.1,
    threshold: 0.2,
  };

  protected readonly primaryCtaConfig: ViewportAnimationConfig = {
    animation: 'slideUp',
    duration: 0.6,
    delay: 0.2,
    threshold: 0.2,
    ease: 'power2.out',
  };

  protected readonly tertiaryCtaConfig: ViewportAnimationConfig = {
    animation: 'fadeIn',
    duration: 0.6,
    delay: 0.3,
    threshold: 0.2,
  };

  public getTrustSignalConfig(index: number): ViewportAnimationConfig {
    return {
      animation: 'fadeIn',
      duration: 0.5,
      delay: 0.35 + index * 0.1,
      threshold: 0.2,
    };
  }
}
