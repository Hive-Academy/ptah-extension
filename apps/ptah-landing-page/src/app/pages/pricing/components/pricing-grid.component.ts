import {
  Component,
  ChangeDetectionStrategy,
  signal,
  inject,
  OnInit,
  effect,
  OnDestroy,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { PlanCardComponent } from './plan-card.component';
import { ProPlanCardComponent } from './pro-plan-card.component';
import { PricingPlan } from '../models/pricing-plan.interface';
import {
  ViewportAnimationDirective,
  ViewportAnimationConfig,
} from '@hive-academy/angular-gsap';
import { PaddleCheckoutService } from '../../../services/paddle-checkout.service';
import { AuthService } from '../../../services/auth.service';
import { environment } from '../../../../environments/environment';
import { isPriceIdPlaceholder } from '../../../utils/paddle-validation.util';
import { LucideAngularModule, TriangleAlert, CircleX } from 'lucide-angular';

/**
 * PricingGridComponent - Grid of pricing plan cards
 *
 * Ptah Pricing Model (2 plans only):
 * - Free: Visual interface with user's own Claude Pro/Max subscription
 * - Pro: $3/month for first 3 months, then $8/month OR $80/year
 *
 * The Pro card contains its own monthly/yearly toggle.
 *
 * Evidence: Updated per user feedback - only 2 real plans
 */
@Component({
  selector: 'ptah-pricing-grid',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    PlanCardComponent,
    ProPlanCardComponent,
    ViewportAnimationDirective,
    LucideAngularModule,
  ],
  template: `
    <div
      class="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 lg:py-16 mt-[-150px]"
    >
      @if (paddleError()) {
      <div class="alert alert-warning mb-8 max-w-xl mx-auto">
        <lucide-angular
          [img]="TriangleAlertIcon"
          class="stroke-current shrink-0 h-6 w-6"
          aria-hidden="true"
        />
        <span>{{ paddleError() }}</span>
        <button class="btn btn-sm btn-secondary" (click)="retryPaddleInit()">
          Retry
        </button>
      </div>
      } @if (configError()) {
      <div class="alert alert-error mb-8 max-w-xl mx-auto">
        <lucide-angular
          [img]="CircleXIcon"
          class="stroke-current shrink-0 h-6 w-6"
          aria-hidden="true"
        />
        <span>{{ configError() }}</span>
        <button class="btn btn-sm" (click)="configError.set(null)">
          Dismiss
        </button>
      </div>
      }
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6 lg:gap-8">
        <!-- Free Plan Card -->
        <div viewportAnimation [viewportConfig]="getCardAnimationConfig(0)">
          <ptah-plan-card
            [plan]="freePlan"
            [isLoading]="isPlanLoading(freePlan.name)"
            (ctaClick)="handleCtaClick($event)"
          />
        </div>

        <!-- Pro Plan Card with integrated billing toggle -->
        <div viewportAnimation [viewportConfig]="getCardAnimationConfig(1)">
          <ptah-pro-plan-card
            [monthlyPlan]="proMonthlyPlan"
            [yearlyPlan]="proYearlyPlan"
            [isLoading]="isPlanLoading('Professional')"
            (ctaClick)="handleCtaClick($event)"
          />
        </div>
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
export class PricingGridComponent implements OnInit, OnDestroy {
  /** Lucide icon references */
  public readonly TriangleAlertIcon = TriangleAlert;
  public readonly CircleXIcon = CircleX;

  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly paddleService = inject(PaddleCheckoutService);
  private readonly authService = inject(AuthService);
  private readonly STAGGER_DELAY = 0.15;
  private readonly CHECKOUT_TIMEOUT = 30000; // 30 seconds
  private readonly AUTO_CHECKOUT_TIMEOUT = 10000; // 10 seconds max wait for Paddle

  private readonly paddleConfig = environment.paddle;
  private loadingTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private autoCheckoutIntervalId: ReturnType<typeof setInterval> | null = null;

  // Configuration error state (for placeholder detection)
  public readonly configError = signal<string | null>(null);

  // Expose paddle state for template
  public readonly paddleError = this.paddleService.error;
  public readonly isPaddleReady = this.paddleService.isReady;
  public readonly loadingPlanName = this.paddleService.loadingPlanName;

  public constructor() {
    // Sync loading state with paddle service
    effect(() => {
      if (!this.paddleService.isLoading()) {
        this.clearLoadingTimeout();
        this.paddleService.setLoadingPlan(null);
      }
    });
  }

  /**
   * Returns animation config for a card at given index with staggered delay.
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
   * Free plan - always shown
   */
  public readonly freePlan: PricingPlan = {
    name: 'Free',
    tier: 'free',
    price: '$0',
    priceSubtext: 'forever',
    idealFor: 'Ideal for trying Ptah',
    features: [],
    standoutFeatures: [
      'Beautiful visual interface',
      'Use your Claude Pro/Max subscription',
      'Native VS Code integration',
      'Real-time streaming responses',
      'Session history & management',
      'Basic workspace context',
    ],
    ctaText: 'Install Free',
    ctaAction: 'download',
  };

  /**
   * Pro Monthly plan data
   */
  public readonly proMonthlyPlan: PricingPlan = {
    name: 'Professional',
    tier: 'pro',
    price: '$3',
    priceSubtext: 'per month',
    priceId: this.paddleConfig.priceIdMonthly,
    idealFor: 'For serious developers',
    savings: '$3 for first 3 months, then $8/mo',
    features: [],
    standoutFeatures: [
      'All Free features included',
      'Intelligent Setup Wizard',
      'Code Execution MCP Server',
      'Workspace Intelligence (13+ project types)',
      'OpenRouter proxy (200+ models)',
      'Project-adaptive agent generation',
    ],
    ctaText: 'Start Pro Trial',
    ctaAction: 'checkout',
    highlight: true,
    badge: 'plan_badge_early_adopter.png',
  };

  /**
   * Pro Yearly plan data
   */
  public readonly proYearlyPlan: PricingPlan = {
    name: 'Professional',
    tier: 'pro',
    price: '$80',
    priceSubtext: 'per year',
    priceId: this.paddleConfig.priceIdYearly,
    idealFor: 'For serious developers',
    savings: 'Save ~17% vs monthly',
    features: [],
    standoutFeatures: [
      'All Free features included',
      'Intelligent Setup Wizard',
      'Code Execution MCP Server',
      'Workspace Intelligence (13+ project types)',
      'OpenRouter proxy (200+ models)',
      'Project-adaptive agent generation',
    ],
    ctaText: 'Subscribe Yearly',
    ctaAction: 'checkout',
    highlight: true,
    badge: 'plan_badge_early_adopter.png',
  };

  /**
   * ngOnInit - Initialize Paddle SDK when component loads
   * Also checks for autoCheckout query param for returning from login
   */
  public ngOnInit(): void {
    this.paddleService.initialize();

    // Check for auto-checkout param from login redirect
    const planKey = this.route.snapshot.queryParamMap.get('autoCheckout');
    if (planKey) {
      this.triggerAutoCheckout(planKey);
    }
  }

  /**
   * ngOnDestroy - Cleanup timeouts on component destroy
   */
  public ngOnDestroy(): void {
    this.clearLoadingTimeout();
    this.clearAutoCheckoutInterval();
  }

  /**
   * Clear auto-checkout interval if set
   */
  private clearAutoCheckoutInterval(): void {
    if (this.autoCheckoutIntervalId !== null) {
      clearInterval(this.autoCheckoutIntervalId);
      this.autoCheckoutIntervalId = null;
    }
  }

  /**
   * Trigger auto-checkout after returning from login
   * Waits for Paddle to be ready, then opens checkout for the specified plan
   */
  private triggerAutoCheckout(planKey: string): void {
    // Determine which plan to checkout based on key
    const plan =
      planKey === 'pro-yearly' ? this.proYearlyPlan : this.proMonthlyPlan;

    // Wait for Paddle to be ready, then trigger checkout
    const startTime = Date.now();
    this.autoCheckoutIntervalId = setInterval(() => {
      if (this.isPaddleReady()) {
        this.clearAutoCheckoutInterval();
        // Small delay to ensure UI is fully rendered
        setTimeout(() => {
          this.proceedWithCheckout(plan);
        }, 500);
      } else if (Date.now() - startTime > this.AUTO_CHECKOUT_TIMEOUT) {
        // Timeout - stop waiting
        this.clearAutoCheckoutInterval();
        console.warn('Auto-checkout timed out waiting for Paddle');
      }
    }, 100);
  }

  /**
   * Clear loading timeout if set
   */
  private clearLoadingTimeout(): void {
    if (this.loadingTimeoutId !== null) {
      clearTimeout(this.loadingTimeoutId);
      this.loadingTimeoutId = null;
    }
  }

  /**
   * Handle CTA button click from plan card
   */
  public handleCtaClick(plan: PricingPlan): void {
    if (plan.ctaAction === 'download') {
      window.open(
        'https://marketplace.visualstudio.com/items?itemName=ptah.ptah',
        '_blank'
      );
      return;
    }

    if (plan.ctaAction === 'signup') {
      this.router.navigate(['/login']);
      return;
    }

    if (plan.ctaAction === 'checkout') {
      // Validate price ID first
      if (isPriceIdPlaceholder(plan.priceId)) {
        this.configError.set(
          'Checkout is not configured yet. Please try again later.'
        );
        return;
      }

      // Check authentication FIRST before checkout
      this.authService.isAuthenticated().subscribe({
        next: (isAuth) => {
          if (!isAuth) {
            // Not authenticated - redirect to login with return URL
            const planKey =
              plan.priceSubtext === 'per year' ? 'pro-yearly' : 'pro-monthly';
            this.router.navigate(['/login'], {
              queryParams: {
                returnUrl: '/pricing',
                plan: planKey,
              },
            });
            return;
          }

          // Authenticated - proceed with checkout
          this.proceedWithCheckout(plan);
        },
        error: () => {
          // Auth check failed - redirect to login as fallback
          const planKey =
            plan.priceSubtext === 'per year' ? 'pro-yearly' : 'pro-monthly';
          this.router.navigate(['/login'], {
            queryParams: {
              returnUrl: '/pricing',
              plan: planKey,
            },
          });
        },
      });
    }
  }

  /**
   * Proceed with Paddle checkout (called after auth check passes)
   */
  private proceedWithCheckout(plan: PricingPlan): void {
    this.clearLoadingTimeout();
    this.paddleService.setLoadingPlan(plan.name);

    this.loadingTimeoutId = setTimeout(() => {
      this.paddleService.setLoadingPlan(null);
      this.loadingTimeoutId = null;
    }, this.CHECKOUT_TIMEOUT);

    this.authService.getCurrentUser().subscribe({
      next: (user) => {
        this.paddleService.openCheckout({
          priceId: plan.priceId!,
          customerEmail: user?.email,
        });
      },
      error: () => {
        this.paddleService.openCheckout({
          priceId: plan.priceId!,
        });
      },
      complete: () => {
        this.clearLoadingTimeout();
      },
    });
  }

  /**
   * Check if a plan's checkout is currently loading
   */
  public isPlanLoading(planName: string): boolean {
    return (
      this.loadingPlanName() === planName && this.paddleService.isLoading()
    );
  }

  /**
   * Retry Paddle SDK initialization after failure
   */
  public retryPaddleInit(): void {
    this.paddleService.retryInitialization();
  }
}
