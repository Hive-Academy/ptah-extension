import { Component, ChangeDetectionStrategy, signal } from '@angular/core';
import { PlanCardComponent } from './plan-card.component';
import { PricingPlan } from '../models/pricing-plan.interface';
import {
  ViewportAnimationDirective,
  ViewportAnimationConfig,
} from '@hive-academy/angular-gsap';

/**
 * PricingGridComponent - Grid of pricing plan cards
 *
 * Displays 3 pricing tiers with staggered viewport animation.
 * Uses DaisyUI grid utilities for responsive layout.
 *
 * Note: ViewportAnimationDirective has a bug with stagger where it sets
 * opacity:0 on the parent but only animates children. We work around this
 * by wrapping each card in its own animated container with delay offsets.
 *
 * Evidence: implementation-plan.md Phase 2 - PricingGridComponent
 */
@Component({
  selector: 'ptah-pricing-grid',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PlanCardComponent, ViewportAnimationDirective],
  template: `
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 lg:py-16">
      <div class="grid grid-cols-1 md:grid-cols-3 gap-8">
        @for (plan of plans(); track plan.tier; let i = $index) {
        <div viewportAnimation [viewportConfig]="getCardAnimationConfig(i)">
          <ptah-plan-card [plan]="plan" (ctaClick)="handleCtaClick($event)" />
        </div>
        }
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class PricingGridComponent {
  private readonly STAGGER_DELAY = 0.15;

  /**
   * Returns animation config for a card at given index with staggered delay.
   * Workaround for ViewportAnimationDirective stagger bug.
   */
  public getCardAnimationConfig(index: number): ViewportAnimationConfig {
    return {
      animation: 'slideUp',
      duration: 0.6,
      delay: index * this.STAGGER_DELAY,
      threshold: 0.1,
      ease: 'power2.out',
    };
  }

  /**
   * Pricing plans data
   * TODO: Replace priceId values with real Paddle price IDs
   */
  public readonly plans = signal<PricingPlan[]>([
    {
      name: 'Free',
      tier: 'free',
      price: '$0',
      features: [
        'Basic extension features',
        'VS Code Marketplace download',
        'Community support',
        'Open source tools',
      ],
      ctaText: 'Download Extension',
      ctaAction: 'download',
    },
    {
      name: 'Early Adopter',
      tier: 'early_adopter',
      price: '$49',
      priceId: 'pri_01jqbkwnq87xxxxxxxxx', // TODO: Replace with real Paddle price ID
      features: [
        'All premium features',
        'MCP server access',
        'Advanced AI tools',
        'Priority support',
        'Lifetime updates',
        'Early access to new features',
      ],
      ctaText: 'Get Early Adopter',
      ctaAction: 'checkout',
      highlight: true,
      badge: 'plan_badge_early_adopter.png',
    },
    {
      name: 'Pro',
      tier: 'pro',
      price: '$99/mo',
      priceId: 'pri_01jqbkwnq87yyyyyyyyy', // TODO: Replace with real Paddle price ID
      features: [
        'All Early Adopter features',
        'Team collaboration',
        'Custom integrations',
        'Dedicated support',
        'SLA guarantees',
      ],
      ctaText: 'Notify Me',
      ctaAction: 'download',
    },
  ]);

  public handleCtaClick(plan: PricingPlan): void {
    if (plan.ctaAction === 'download') {
      window.open(
        'https://marketplace.visualstudio.com/items?itemName=hive-academy.ptah-extension',
        '_blank'
      );
    } else if (plan.ctaAction === 'checkout' && plan.priceId) {
      // TODO: Integrate Paddle checkout
      console.log('Paddle checkout for:', plan.name, plan.priceId);
    }
  }
}
