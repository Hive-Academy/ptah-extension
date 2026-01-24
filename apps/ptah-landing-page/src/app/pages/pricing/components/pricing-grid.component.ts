import {
  Component,
  ChangeDetectionStrategy,
  signal,
  inject,
} from '@angular/core';
import { Router } from '@angular/router';
import { PlanCardComponent } from './plan-card.component';
import { PricingPlan } from '../models/pricing-plan.interface';
import {
  ViewportAnimationDirective,
  ViewportAnimationConfig,
} from '@hive-academy/angular-gsap';

/**
 * PricingGridComponent - Grid of pricing plan cards
 *
 * New Pricing Model (Updated):
 * - Free Trial: 14 days, all features, no credit card
 * - Pro Monthly: $8/month
 * - Pro Yearly: $80/year (save ~17%)
 *
 * Optional Paddle Promotions:
 * - First 3 months discount: Configure in Paddle dashboard
 * - Seasonal discounts: Configure in Paddle dashboard
 *
 * Evidence: Updated per user feedback - single plan with monthly/yearly options
 */
@Component({
  selector: 'ptah-pricing-grid',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PlanCardComponent, ViewportAnimationDirective],
  template: `
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 lg:py-16">
      <div class="grid grid-cols-1 md:grid-cols-3 gap-8">
        @for (plan of plans(); track plan.name; let i = $index) {
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
  private readonly router = inject(Router);
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
   *
   * TODO: Replace priceId placeholders with real Paddle price IDs after setup
   * See: docs/PADDLE_SETUP.md for instructions
   */
  public readonly plans = signal<PricingPlan[]>([
    {
      name: 'Free Trial',
      tier: 'free',
      price: '$0',
      priceSubtext: '14 days',
      features: [
        'All Pro features included',
        'No credit card required',
        'Full SDK access',
        'Workspace intelligence',
        'Custom MCP tools',
        'Session history',
      ],
      ctaText: 'Start Free Trial',
      ctaAction: 'signup',
    },
    {
      name: 'Pro Monthly',
      tier: 'pro',
      price: '$8',
      priceSubtext: 'per month',
      priceId: 'pri_MONTHLY_REPLACE_ME', // TODO: Replace with Paddle monthly price ID
      features: [
        'Everything in trial',
        'Unlimited sessions',
        'Priority support',
        'Early access to features',
        'Cancel anytime',
      ],
      ctaText: 'Subscribe Monthly',
      ctaAction: 'checkout',
      highlight: true,
    },
    {
      name: 'Pro Yearly',
      tier: 'pro',
      price: '$80',
      priceSubtext: 'per year',
      priceId: 'pri_YEARLY_REPLACE_ME', // TODO: Replace with Paddle yearly price ID
      savings: 'Save $16/year',
      features: [
        'Everything in monthly',
        '~17% discount vs monthly',
        'Billed annually',
        'Priority support',
        'Cancel anytime',
      ],
      ctaText: 'Subscribe Yearly',
      ctaAction: 'checkout',
      badge: 'plan_badge_early_adopter.png', // Reuse badge for yearly plan
    },
  ]);

  public handleCtaClick(plan: PricingPlan): void {
    if (plan.ctaAction === 'signup') {
      // Free trial - navigate to login (magic link auth)
      this.router.navigate(['/login']);
    } else if (plan.ctaAction === 'checkout' && plan.priceId) {
      // Paid subscription - initiate Paddle checkout
      // TODO: Integrate Paddle.js checkout when price IDs are configured
      console.log('Paddle checkout for:', plan.name, plan.priceId);

      // Future implementation:
      // this.paddleCheckoutService.openCheckout({
      //   priceId: plan.priceId,
      //   successUrl: '/profile',
      //   cancelUrl: '/pricing',
      // });
    }
  }
}
