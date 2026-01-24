import {
  Component,
  ChangeDetectionStrategy,
  signal,
  inject,
  OnInit,
} from '@angular/core';
import { Router } from '@angular/router';
import { PlanCardComponent } from './plan-card.component';
import { PricingPlan } from '../models/pricing-plan.interface';
import {
  ViewportAnimationDirective,
  ViewportAnimationConfig,
} from '@hive-academy/angular-gsap';
import { PaddleCheckoutService } from '../../../services/paddle-checkout.service';
import { AuthService } from '../../../services/auth.service';
import { environment } from '../../../../environments/environment';

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
      @if (paddleError()) {
        <div class="alert alert-warning mb-8 max-w-xl mx-auto">
          <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <span>{{ paddleError() }}</span>
          <button class="btn btn-sm btn-secondary" (click)="retryPaddleInit()">Retry</button>
        </div>
      }
      <div class="grid grid-cols-1 md:grid-cols-3 gap-8">
        @for (plan of plans(); track plan.name; let i = $index) {
        <div viewportAnimation [viewportConfig]="getCardAnimationConfig(i)">
          <ptah-plan-card
            [plan]="plan"
            [isLoading]="isPlanLoading(plan.name)"
            (ctaClick)="handleCtaClick($event)"
          />
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
export class PricingGridComponent implements OnInit {
  private readonly router = inject(Router);
  private readonly paddleService = inject(PaddleCheckoutService);
  private readonly authService = inject(AuthService);
  private readonly STAGGER_DELAY = 0.15;

  private readonly paddleConfig = environment.paddle;

  // Track which plan is currently loading
  public readonly loadingPlanName = signal<string | null>(null);

  // Expose paddle state for template
  public readonly paddleError = this.paddleService.error;
  public readonly isPaddleReady = this.paddleService.isReady;

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
   * Price IDs sourced from environment.paddle config
   * Evidence: Task 2.1 - Use environment config for price IDs
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
      priceId: this.paddleConfig.priceIdMonthly,
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
      priceId: this.paddleConfig.priceIdYearly,
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

  /**
   * ngOnInit - Initialize Paddle SDK when component loads
   * Evidence: Task 2.1 - Initialize Paddle in ngOnInit lifecycle
   */
  public ngOnInit(): void {
    this.paddleService.initialize();
  }

  /**
   * Handle CTA button click from plan card
   * Evidence: Task 2.1 - Handle checkout with email pre-fill from AuthService
   */
  public handleCtaClick(plan: PricingPlan): void {
    if (plan.ctaAction === 'signup') {
      this.router.navigate(['/login']);
      return;
    }

    if (plan.ctaAction === 'checkout') {
      if (!plan.priceId || this.isPriceIdPlaceholder(plan.priceId)) {
        console.warn('Invalid price ID:', plan.priceId);
        return;
      }

      // Set loading state for this specific plan
      this.loadingPlanName.set(plan.name);

      // Get authenticated user email for pre-fill
      this.authService.getCurrentUser().subscribe({
        next: (user) => {
          this.paddleService.openCheckout({
            priceId: plan.priceId!,
            customerEmail: user?.email,
          });
        },
        error: () => {
          // Proceed without email if auth check fails
          this.paddleService.openCheckout({
            priceId: plan.priceId!,
          });
        },
      });
    }
  }

  /**
   * Check if a plan's checkout is currently loading
   * Evidence: Task 2.1 - Track per-plan loading state
   */
  public isPlanLoading(planName: string): boolean {
    return this.loadingPlanName() === planName && this.paddleService.isLoading();
  }

  /**
   * Check if price ID is a placeholder that needs replacement
   * Evidence: Task 2.1 - Add isPriceIdPlaceholder validation method
   */
  private isPriceIdPlaceholder(priceId: string): boolean {
    return (
      priceId.includes('REPLACE') ||
      priceId.includes('xxxxxxxxx') ||
      priceId.includes('yyyyyyyyy') ||
      priceId.includes('REPLACE_ME')
    );
  }

  /**
   * Retry Paddle SDK initialization after failure
   * Evidence: Task 2.1 - Add retryPaddleInit method for error recovery
   */
  public retryPaddleInit(): void {
    this.paddleService.retryInitialization();
  }
}
