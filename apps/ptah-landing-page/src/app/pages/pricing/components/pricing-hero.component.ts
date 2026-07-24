import { Component, ChangeDetectionStrategy } from '@angular/core';
import {
  ViewportAnimationDirective,
  ViewportAnimationConfig,
} from '@hive-academy/angular-gsap';
import { ConsoleGridBackgroundComponent } from '../../../components/console/console-grid-background.component';

/**
 * PricingHeroComponent — pricing page hero in the Operator Console system.
 *
 * Replaces the previous Egyptian pyramid-image hero (pyramid_energy_apex.png,
 * 3D text shadows, gradient display type) with a coded ConsoleGridBackground +
 * amber-glow treatment, a mono kicker, and a clean H1 whose only accent is the
 * amber trial phrase — consistent with the home hero and section headers.
 */
@Component({
  selector: 'ptah-pricing-hero',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ViewportAnimationDirective, ConsoleGridBackgroundComponent],
  template: `
    <section class="relative bg-ink-950 pt-40 pb-20 px-6 overflow-hidden">
      <ptah-console-grid-background [glow]="true" />

      <div class="relative z-10 max-w-3xl mx-auto text-center">
        <span
          viewportAnimation
          [viewportConfig]="labelConfig"
          class="font-mono text-xs sm:text-sm uppercase tracking-[0.2em] text-amber-500/80 mb-4 inline-block"
          >PRICING &amp; PLANS</span
        >

        <h1
          viewportAnimation
          [viewportConfig]="headlineConfig"
          class="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-white leading-[1.05] mb-6"
        >
          Ptah Is Free.
          <span class="text-amber-500">Open Source, No Catch.</span>
        </h1>

        <p
          viewportAnimation
          [viewportConfig]="subtitleConfig"
          class="text-lg sm:text-xl text-ink-400 max-w-2xl mx-auto leading-relaxed"
        >
          The full desktop suite — Memory, Skills, Cron, and Gateways — is free
          and open source. Join Ptah Builders if you want live training,
          curriculum, and member skill packs on top.
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
export class PricingHeroComponent {
  public readonly headlineConfig: ViewportAnimationConfig = {
    animation: 'slideUp',
    duration: 0.7,
    threshold: 0.1,
    ease: 'power2.out',
  };

  public readonly subtitleConfig: ViewportAnimationConfig = {
    animation: 'fadeIn',
    duration: 0.6,
    delay: 0.15,
    threshold: 0.1,
  };

  public readonly labelConfig: ViewportAnimationConfig = {
    animation: 'fadeIn',
    duration: 0.5,
    threshold: 0.1,
  };
}
