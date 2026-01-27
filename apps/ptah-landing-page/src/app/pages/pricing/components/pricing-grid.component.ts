import {
  Component,
  ChangeDetectionStrategy,
  signal,
  inject,
  OnInit,
  effect,
  OnDestroy,
  DestroyRef,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { BasicPlanCardComponent } from './basic-plan-card.component';
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
import {
  LucideAngularModule,
  TriangleAlert,
  CircleX,
  ExternalLink,
} from 'lucide-angular';

/**
 * PricingGridComponent - Grid of pricing plan cards
 *
 * Ptah Pricing Model (TASK_2025_121 - Two-Tier Paid Model):
 * - Basic: $3/month, $30/year (14-day trial) - Core visual editor features
 * - Pro: $5/month, $50/year (14-day trial) - Basic + MCP server + all premium features
 *
 * Both plans have their own monthly/yearly toggle.
 * FREE tier has been removed entirely.
 *
 * Evidence: TASK_2025_121 - Two-Tier Paid Extension Model
 */
@Component({
  selector: 'ptah-pricing-grid',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    BasicPlanCardComponent,
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
      } @if (autoCheckoutError()) {
      <div class="alert alert-warning mb-8 max-w-xl mx-auto">
        <lucide-angular
          [img]="TriangleAlertIcon"
          class="stroke-current shrink-0 h-6 w-6"
          aria-hidden="true"
        />
        <span>{{ autoCheckoutError() }}</span>
        <button class="btn btn-sm" (click)="autoCheckoutError.set(null)">
          Dismiss
        </button>
      </div>
      } @if (validationError()) {
      <div class="alert alert-error mb-8 max-w-xl mx-auto shadow-lg">
        <lucide-angular
          [img]="CircleXIcon"
          class="stroke-current shrink-0 h-6 w-6"
          aria-hidden="true"
        />
        <div class="flex flex-col gap-2">
          <span class="font-medium">{{ validationError() }}</span>
          @if (customerPortalUrl()) {
          <a
            [href]="customerPortalUrl()"
            target="_blank"
            rel="noopener noreferrer"
            class="link link-secondary flex items-center gap-1"
          >
            <lucide-angular
              [img]="ExternalLinkIcon"
              class="w-4 h-4"
              aria-hidden="true"
            />
            Manage your subscription
          </a>
          }
        </div>
        <button class="btn btn-sm btn-ghost" (click)="dismissValidationError()">
          Dismiss
        </button>
      </div>
      }
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6 lg:gap-8 items-stretch">
        <!-- Basic Plan Card with integrated billing toggle -->
        <div
          class="h-full"
          viewportAnimation
          [viewportConfig]="getCardAnimationConfig(0)"
        >
          <ptah-basic-plan-card
            [monthlyPlan]="basicMonthlyPlan"
            [yearlyPlan]="basicYearlyPlan"
            [isLoading]="isPlanLoading('Basic')"
            (ctaClick)="handleCtaClick($event)"
          />
        </div>

        <!-- Pro Plan Card with integrated billing toggle -->
        <div
          class="h-full"
          viewportAnimation
          [viewportConfig]="getCardAnimationConfig(1)"
        >
          <ptah-pro-plan-card
            [monthlyPlan]="proMonthlyPlan"
            [yearlyPlan]="proYearlyPlan"
            [isLoading]="isPlanLoading('Pro')"
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
  public readonly ExternalLinkIcon = ExternalLink;

  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly paddleService = inject(PaddleCheckoutService);
  private readonly authService = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly STAGGER_DELAY = 0.15;
  private readonly CHECKOUT_TIMEOUT = 30000; // 30 seconds
  private readonly AUTO_CHECKOUT_TIMEOUT = 10000; // 10 seconds max wait for Paddle

  private readonly paddleConfig = environment.paddle;
  private loadingTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private autoCheckoutIntervalId: ReturnType<typeof setInterval> | null = null;

  // Configuration error state (for placeholder detection)
  public readonly configError = signal<string | null>(null);

  // Auto-checkout error state (for timeout handling)
  public readonly autoCheckoutError = signal<string | null>(null);

  // Expose paddle state for template
  public readonly paddleError = this.paddleService.error;
  public readonly isPaddleReady = this.paddleService.isReady;
  public readonly loadingPlanName = this.paddleService.loadingPlanName;
  public readonly validationError = this.paddleService.validationError;
  public readonly customerPortalUrl = this.paddleService.customerPortalUrl;
  public readonly isValidating = this.paddleService.isValidating;

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
   * Basic Monthly plan data
   */
  public readonly basicMonthlyPlan: PricingPlan = {
    name: 'Basic',
    tier: 'basic',
    price: '$3',
    priceSubtext: 'per month',
    priceId: this.paddleConfig.basicPriceIdMonthly,
    idealFor: 'Perfect for individual developers',
    trialDays: 14,
    features: [],
    standoutFeatures: [
      'Beautiful visual interface',
      'Use your Claude Pro/Max subscription',
      'Native VS Code integration',
      'Real-time streaming responses',
      'Session history & management',
      'Basic workspace context',
    ],
    ctaText: 'Start 14-Day Free Trial',
    ctaAction: 'checkout',
  };

  /**
   * Basic Yearly plan data
   */
  public readonly basicYearlyPlan: PricingPlan = {
    name: 'Basic',
    tier: 'basic',
    price: '$30',
    priceSubtext: 'per year',
    priceId: this.paddleConfig.basicPriceIdYearly,
    idealFor: 'Perfect for individual developers',
    savings: 'Save ~17% vs monthly',
    trialDays: 14,
    features: [],
    standoutFeatures: [
      'Beautiful visual interface',
      'Use your Claude Pro/Max subscription',
      'Native VS Code integration',
      'Real-time streaming responses',
      'Session history & management',
      'Basic workspace context',
    ],
    ctaText: 'Start 14-Day Free Trial',
    ctaAction: 'checkout',
  };

  /**
   * Pro Monthly plan data
   */
  public readonly proMonthlyPlan: PricingPlan = {
    name: 'Pro',
    tier: 'pro',
    price: '$5',
    priceSubtext: 'per month',
    priceId: this.paddleConfig.proPriceIdMonthly,
    idealFor: 'For serious developers',
    trialDays: 14,
    features: [],
    standoutFeatures: [
      'All Basic features included',
      'Intelligent Setup Wizard',
      'Code Execution MCP Server',
      'Workspace Intelligence (13+ project types)',
      'OpenRouter proxy (200+ models)',
      'Project-adaptive agent generation',
    ],
    ctaText: 'Start 14-Day Free Trial',
    ctaAction: 'checkout',
    highlight: true,
  };

  /**
   * Pro Yearly plan data
   */
  public readonly proYearlyPlan: PricingPlan = {
    name: 'Pro',
    tier: 'pro',
    price: '$50',
    priceSubtext: 'per year',
    priceId: this.paddleConfig.proPriceIdYearly,
    idealFor: 'For serious developers',
    savings: 'Save ~17% vs monthly',
    trialDays: 14,
    features: [],
    standoutFeatures: [
      'All Basic features included',
      'Intelligent Setup Wizard',
      'Code Execution MCP Server',
      'Workspace Intelligence (13+ project types)',
      'OpenRouter proxy (200+ models)',
      'Project-adaptive agent generation',
    ],
    ctaText: 'Start 14-Day Free Trial',
    ctaAction: 'checkout',
    highlight: true,
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
    // Validate plan key - only allow known values
    const validPlanKeys = [
      'basic-monthly',
      'basic-yearly',
      'pro-monthly',
      'pro-yearly',
    ];
    if (!validPlanKeys.includes(planKey)) {
      this.autoCheckoutError.set(
        'Invalid checkout plan. Please select a plan manually.'
      );
      return;
    }

    // Clear any previous error
    this.autoCheckoutError.set(null);

    // Determine which plan to checkout based on key
    let plan: PricingPlan;
    switch (planKey) {
      case 'basic-monthly':
        plan = this.basicMonthlyPlan;
        break;
      case 'basic-yearly':
        plan = this.basicYearlyPlan;
        break;
      case 'pro-yearly':
        plan = this.proYearlyPlan;
        break;
      case 'pro-monthly':
      default:
        plan = this.proMonthlyPlan;
        break;
    }

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
        // Timeout - stop waiting and show user-visible error
        this.clearAutoCheckoutInterval();
        this.autoCheckoutError.set(
          'Unable to start checkout automatically. Please click the checkout button to try again.'
        );
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
    // All plans now use checkout action (no more download or signup)
    if (plan.ctaAction === 'checkout') {
      // Validate price ID first
      if (isPriceIdPlaceholder(plan.priceId)) {
        this.configError.set(
          'Checkout is not configured yet. Please try again later.'
        );
        return;
      }

      // Check authentication FIRST before checkout
      this.authService
        .isAuthenticated()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (isAuth) => {
            if (!isAuth) {
              // Not authenticated - redirect to login with return URL
              const planKey = this.getPlanKey(plan);
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
            const planKey = this.getPlanKey(plan);
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
   * Get the plan key for auto-checkout redirect
   */
  private getPlanKey(plan: PricingPlan): string {
    const isYearly = plan.priceSubtext === 'per year';
    const isBasic = plan.tier === 'basic';

    if (isBasic) {
      return isYearly ? 'basic-yearly' : 'basic-monthly';
    }
    return isYearly ? 'pro-yearly' : 'pro-monthly';
  }

  /**
   * Proceed with Paddle checkout (called after auth check passes)
   */
  private proceedWithCheckout(plan: PricingPlan): void {
    // Validate priceId exists before proceeding
    if (!plan.priceId) {
      this.configError.set(
        'Price configuration error. Please contact support.'
      );
      return;
    }

    this.clearLoadingTimeout();
    this.paddleService.setLoadingPlan(plan.name);

    this.loadingTimeoutId = setTimeout(() => {
      this.paddleService.setLoadingPlan(null);
      this.loadingTimeoutId = null;
    }, this.CHECKOUT_TIMEOUT);

    // Capture priceId to avoid TypeScript narrowing issues in callback
    const priceId = plan.priceId;

    this.authService
      .getCurrentUser()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (user) => {
          this.paddleService.openCheckout({
            priceId,
            customerEmail: user?.email,
          });
        },
        error: () => {
          this.paddleService.openCheckout({
            priceId,
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

  /**
   * Dismiss validation error alert
   * Clears both the error message and portal URL
   */
  public dismissValidationError(): void {
    this.paddleService.clearValidationError();
  }
}
