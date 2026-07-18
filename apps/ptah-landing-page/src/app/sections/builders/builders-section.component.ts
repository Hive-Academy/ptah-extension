import { ChangeDetectionStrategy, Component } from '@angular/core';
import {
  ArrowRight,
  BookOpen,
  GraduationCap,
  LifeBuoy,
  LucideAngularModule,
  Package,
} from 'lucide-angular';
import {
  ViewportAnimationConfig,
  ViewportAnimationDirective,
} from '@hive-academy/angular-gsap';
import { ConsoleGridBackgroundComponent } from '../../components/console/console-grid-background.component';

/**
 * BuildersSectionComponent — S8.5 Ptah Builders (content-spec §4). Placed after
 * the Comparison section and before Also Available. Same hybrid pillar layout:
 * ConsoleGridBackground, centered mono amber eyebrow, section header, a 4-card
 * value grid, a founding-member price anchor, and a waitlist CTA. Entrance
 * animations are opacity/transform only so the prerendered HTML is correct with
 * JS disabled. The CTA targets the #waitlist placeholder anchor (community
 * provider integration is a later task).
 */
@Component({
  selector: 'ptah-builders-section',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    LucideAngularModule,
    ViewportAnimationDirective,
    ConsoleGridBackgroundComponent,
  ],
  template: `
    <section
      id="builders"
      aria-label="Ptah Builders membership"
      class="relative bg-ink-950 py-24 sm:py-32 overflow-hidden"
    >
      <ptah-console-grid-background [glow]="true" />

      <div class="relative z-10 max-w-7xl mx-auto px-6 sm:px-10 lg:px-16">
        <!-- Header -->
        <div
          viewportAnimation
          [viewportConfig]="headerConfig"
          class="max-w-3xl mx-auto text-center mb-16"
        >
          <span
            class="font-mono text-xs sm:text-sm uppercase tracking-[0.2em] text-amber-500/80 mb-4 inline-block"
            >PTAH BUILDERS</span
          >
          <h2
            class="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-white leading-tight mb-6"
          >
            Ship Production SaaS Faster — With Builders Who Have Already Done
            It.
          </h2>
          <p class="text-lg sm:text-xl text-ink-400 leading-relaxed">
            Ptah the app is free and open source. Ptah Builders is where you go
            deeper: live build sessions, a PRD-to-production curriculum, and the
            delivery patterns other builders have already turned into skills.
          </p>
        </div>

        <!-- Value cards -->
        <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 items-start">
          @for (card of cards; track card.title; let i = $index) {
            <article
              viewportAnimation
              [viewportConfig]="cardConfigs[i]"
              class="rounded-xl border border-ink-700 bg-ink-850 p-6 sm:p-8 transition-colors duration-200 hover:border-amber-500/30"
            >
              <div
                class="w-11 h-11 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mb-5"
              >
                <lucide-angular
                  [img]="card.icon"
                  class="w-5 h-5 text-amber-500"
                  aria-hidden="true"
                />
              </div>
              <h3 class="text-lg sm:text-xl font-semibold text-white mb-2">
                {{ card.title }}
              </h3>
              <p class="text-base text-ink-400 leading-relaxed">
                {{ card.body }}
              </p>
            </article>
          }
        </div>

        <!-- Price anchor -->
        <p
          viewportAnimation
          [viewportConfig]="priceConfig"
          class="mt-14 max-w-2xl mx-auto text-center font-mono text-sm text-ink-400"
        >
          Founding-member pricing: $29 to $49 per month — locked in for early
          members.
        </p>

        <!-- CTA -->
        <div
          viewportAnimation
          [viewportConfig]="ctaConfig"
          class="mt-8 flex flex-col items-center"
        >
          <a
            href="#waitlist"
            class="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-lg bg-amber-500 text-ink-950 font-semibold text-sm sm:text-base transition-all duration-200 hover:bg-amber-400 hover:-translate-y-0.5 hover:shadow-glow-amber active:bg-amber-600 active:translate-y-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 focus-visible:outline-offset-2"
            aria-label="Join the Ptah Builders waitlist"
          >
            <lucide-angular
              [img]="arrowRight"
              class="w-4 h-4"
              aria-hidden="true"
            />
            Join the Waitlist
          </a>
          <span class="text-xs text-ink-500 mt-3 text-center max-w-sm">
            We'll email you when Builders opens. No spam, no community platform
            yet — just the waitlist.
          </span>
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
export class BuildersSectionComponent {
  protected readonly arrowRight = ArrowRight;

  protected readonly cards = [
    {
      icon: GraduationCap,
      title: 'Live Training Sessions',
      body: 'Weekly live sessions where we ship a real feature end-to-end — multi-tenant auth, billing integration, a security-review pass — and take questions on your build.',
    },
    {
      icon: BookOpen,
      title: 'PRD-to-Production Curriculum',
      body: 'A structured path from a one-page PRD to a production-shaped SaaS: architecture decisions, tenant isolation, billing integration, and the review gates a solo prototype skips.',
    },
    {
      icon: Package,
      title: 'Member Skill Packs',
      body: 'Delivery patterns other Builders have already extracted and shared as SKILL.md packs — install the multi-tenant guard or billing webhook someone else already got right.',
    },
    {
      icon: LifeBuoy,
      title: 'Priority Support',
      body: 'Direct access for build questions and architecture reviews, ahead of the public queue.',
    },
  ];

  protected readonly headerConfig: ViewportAnimationConfig = {
    animation: 'fadeIn',
    duration: 0.6,
    threshold: 0.2,
    ease: 'power2.out',
  };

  protected readonly cardConfigs: ViewportAnimationConfig[] = [0, 1, 2, 3].map(
    (i) => ({
      animation: 'slideUp',
      duration: 0.5,
      delay: 0.1 + i * 0.12,
      threshold: 0.2,
      ease: 'power2.out',
    }),
  );

  protected readonly priceConfig: ViewportAnimationConfig = {
    animation: 'fadeIn',
    duration: 0.6,
    delay: 0.1,
    threshold: 0.2,
  };

  protected readonly ctaConfig: ViewportAnimationConfig = {
    animation: 'slideUp',
    duration: 0.6,
    delay: 0.2,
    threshold: 0.2,
    ease: 'power2.out',
  };
}
