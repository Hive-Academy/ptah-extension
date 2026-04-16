import {
  Component,
  ChangeDetectionStrategy,
  signal,
  computed,
  inject,
  OnInit,
  effect,
  OnDestroy,
  DestroyRef,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { CommunityPlanCardComponent } from './community-plan-card.component';
import { ProPlanCardComponent } from './pro-plan-card.component';
import {
  PricingPlan,
  PlanSubscriptionContext,
  VALID_SUBSCRIPTION_STATUSES,
  ValidSubscriptionStatus,
} from '../models/pricing-plan.interface';
import {
  ViewportAnimationDirective,
  ViewportAnimationConfig,
} from '@hive-academy/angular-gsap';
import { PaddleCheckoutService } from '../../../services/paddle-checkout.service';
import { AuthService } from '../../../services/auth.service';
import { SubscriptionStateService } from '../../../services/subscription-state.service';
import { environment } from '../../../../environments/environment';
import { isPriceIdPlaceholder } from '../../../utils/paddle-validation.util';
import { FormsModule } from '@angular/forms';
import {
  LucideAngularModule,
  TriangleAlert,
  CircleX,
  ExternalLink,
  Tag,
  ChevronDown,
} from 'lucide-angular';

/**
 * PricingGridComponent - Grid of pricing plan cards
 *
 * TASK_2025_128: Freemium Model Conversion
 * - Community: FREE forever - Core visual editor features (no Paddle)
 * - Pro: $5/month, $50/year (100-day trial) - Community + MCP server + all premium features
 *
 * Community tier has no billing toggle (always free).
 * Pro plan has monthly/yearly toggle.
 *
 * Evidence: TASK_2025_121 - Two-Tier Paid Extension Model
 * Evidence: TASK_2025_128 - Freemium Model Conversion
 */
@Component({
  selector: 'ptah-pricing-grid',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommunityPlanCardComponent,
    ProPlanCardComponent,
    ViewportAnimationDirective,
    LucideAngularModule,
    FormsModule,
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
      }
      @if (configError()) {
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
      @if (portalError()) {
        <div class="alert alert-error mb-8 max-w-xl mx-auto">
          <lucide-angular
            [img]="CircleXIcon"
            class="stroke-current shrink-0 h-6 w-6"
            aria-hidden="true"
          />
          <span>{{ portalError() }}</span>
          <button class="btn btn-sm" (click)="portalError.set(null)">
            Dismiss
          </button>
        </div>
      }
      @if (autoCheckoutError()) {
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
      }
      @if (validationError()) {
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
          <button
            class="btn btn-sm btn-ghost"
            (click)="dismissValidationError()"
          >
            Dismiss
          </button>
        </div>
      }
      <!-- Promo Code Input -->
      <div class="flex justify-center mb-6">
        <div class="flex flex-col items-center gap-2">
          <button
            type="button"
            class="flex items-center gap-1.5 text-sm text-base-content/50 hover:text-base-content/80 transition-colors"
            (click)="togglePromoInput()"
          >
            <lucide-angular
              [img]="TagIcon"
              class="w-4 h-4"
              aria-hidden="true"
            />
            Have a promo code?
            <lucide-angular
              [img]="ChevronDownIcon"
              class="w-3 h-3 transition-transform duration-200"
              [class.rotate-180]="showPromoInput()"
              aria-hidden="true"
            />
          </button>
          @if (showPromoInput()) {
            <div class="flex items-center gap-2 mt-1">
              <input
                type="text"
                class="input input-sm input-bordered w-48 uppercase tracking-wider text-center font-mono"
                placeholder="ENTER CODE"
                [(ngModel)]="promoCodeValue"
                (ngModelChange)="onPromoCodeChange($event)"
                maxlength="50"
                autocomplete="off"
                aria-label="Promo code"
              />
              @if (promoCode()) {
                <button
                  type="button"
                  class="btn btn-xs btn-ghost text-base-content/40"
                  (click)="clearPromoCode()"
                  aria-label="Clear promo code"
                >
                  ✕
                </button>
              }
            </div>
            @if (promoCode()) {
              <p class="text-xs text-success flex items-center gap-1">
                <lucide-angular
                  [img]="TagIcon"
                  class="w-3 h-3"
                  aria-hidden="true"
                />
                Code
                <span class="font-mono font-bold">{{ promoCode() }}</span> will
                be applied at checkout
              </p>
            }
          }
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-6 lg:gap-8 items-stretch">
        <!-- Community Plan Card (FREE - no billing toggle) -->
        <div
          class="h-full"
          viewportAnimation
          [viewportConfig]="getCardAnimationConfig(0)"
        >
          <ptah-community-plan-card
            [plan]="communityPlan"
            [subscriptionContext]="subscriptionContext()"
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
            [subscriptionContext]="subscriptionContext()"
            [isLoadingContext]="isLoadingSubscription()"
            (ctaClick)="handleCtaClick($event)"
            (manageSubscription)="handleManageSubscription()"
          />
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        contain: layout style;
        backface-visibility: hidden;
      }

      /* Card containment for animation isolation */
      ptah-community-plan-card,
      ptah-pro-plan-card {
        display: block;
        contain: layout style;
        backface-visibility: hidden;
      }
    `,
  ],
  host: { '(window:focus)': 'onWindowFocus()' },
})
export class PricingGridComponent implements OnInit, OnDestroy {
  /** Lucide icon references */
  public readonly TriangleAlertIcon = TriangleAlert;
  public readonly CircleXIcon = CircleX;
  public readonly ExternalLinkIcon = ExternalLink;
  public readonly TagIcon = Tag;
  public readonly ChevronDownIcon = ChevronDown;

  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly paddleService = inject(PaddleCheckoutService);
  private readonly authService = inject(AuthService);
  private readonly subscriptionService = inject(SubscriptionStateService);
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  private readonly STAGGER_DELAY = 0.15;
  private readonly CHECKOUT_TIMEOUT = 30000; // 30 seconds
  private readonly AUTO_CHECKOUT_TIMEOUT = 10000; // 10 seconds max wait for Paddle

  private readonly paddleConfig = environment.paddle;
  private loadingTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private autoCheckoutIntervalId: ReturnType<typeof setInterval> | null = null;

  // Track if portal was opened to refresh on return
  private portalWasOpened = false;

  // Configuration error state (for placeholder detection)
  public readonly configError = signal<string | null>(null);

  // Portal session error state (separate from config errors)
  public readonly portalError = signal<string | null>(null);

  // Portal loading state
  public readonly isPortalLoading = signal(false);

  // Auto-checkout error state (for timeout handling)
  public readonly autoCheckoutError = signal<string | null>(null);

  // Promo code state
  public readonly showPromoInput = signal(false);
  public readonly promoCode = signal<string>('');
  public promoCodeValue = ''; // ngModel binding (two-way, synced to promoCode signal)

  // Expose paddle state for template
  public readonly paddleError = this.paddleService.error;
  public readonly isPaddleReady = this.paddleService.isReady;
  public readonly loadingPlanName = this.paddleService.loadingPlanName;
  public readonly validationError = this.paddleService.validationError;
  public readonly customerPortalUrl = this.paddleService.customerPortalUrl;
  public readonly isValidating = this.paddleService.isValidating;

  /**
   * Computed subscription context for plan cards
   *
   * Builds a PlanSubscriptionContext from SubscriptionStateService signals.
   * This is passed to CommunityPlanCardComponent and ProPlanCardComponent
   * to enable subscription-aware UI rendering.
   *
   * Includes runtime validation for subscriptionStatus to ensure type safety.
   */
  public readonly subscriptionContext = computed<PlanSubscriptionContext>(
    () => {
      // Runtime validation for subscription status
      const rawStatus = this.subscriptionService.subscriptionStatus();
      const validatedStatus = this.validateSubscriptionStatus(rawStatus);

      return {
        isAuthenticated:
          this.subscriptionService.isFetched() &&
          this.subscriptionService.licenseData() !== null,
        currentPlanTier: this.subscriptionService.currentPlanTier(),
        isOnTrial: this.subscriptionService.isOnTrial(),
        trialDaysRemaining: this.subscriptionService.trialDaysRemaining(),
        subscriptionStatus: validatedStatus,
        periodEndDate: this.subscriptionService.periodEndDate(),
        // TASK_2025_143: Include license reason for trial ended display
        licenseReason: this.subscriptionService.licenseReason(),
      };
    },
  );

  /**
   * Validate subscription status against known valid values.
   * Returns null for unknown statuses to prevent runtime errors.
   *
   * @param status - Raw status string from API
   * @returns Validated status or null
   */
  private validateSubscriptionStatus(
    status: string | null,
  ): ValidSubscriptionStatus | null {
    if (status === null) return null;
    if (
      VALID_SUBSCRIPTION_STATUSES.includes(status as ValidSubscriptionStatus)
    ) {
      return status as ValidSubscriptionStatus;
    }
    // Log unexpected status for debugging but don't crash
    console.warn(
      `[PricingGrid] Unexpected subscription status: "${status}". Treating as null.`,
    );
    return null;
  }

  /**
   * Loading state for subscription context
   *
   * Exposed for template to show loading indicators on plan cards
   * while subscription state is being fetched.
   */
  public readonly isLoadingSubscription = this.subscriptionService.isLoading;

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
   * Handle window focus to refresh subscription state after portal return.
   * Only refreshes if portal was opened previously.
   */
  public onWindowFocus(): void {
    if (this.portalWasOpened) {
      this.portalWasOpened = false;
      // Refresh subscription state when returning from portal
      this.subscriptionService
        .refresh()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe();
    }
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
   * Community plan data (FREE - no Paddle checkout)
   *
   * TASK_2025_128: Freemium model conversion
   * - Free forever, no trial period needed
   * - CTA opens VS Code marketplace instead of checkout
   */
  public readonly communityPlan: PricingPlan = {
    name: 'Community',
    tier: 'community',
    price: 'Free',
    priceSubtext: 'forever',
    priceId: undefined, // No checkout - it's free
    idealFor: 'Perfect for getting started',
    trialDays: undefined, // No trial - always free
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
    ctaAction: 'download', // Opens VS Code marketplace
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
    trialDays: 30,
    features: [],
    standoutFeatures: [
      'All Community features included',
      'Intelligent Setup Wizard',
      'Code Execution MCP Server',
      'Workspace Intelligence (13+ project types)',
      'OpenRouter proxy (200+ models)',
      'Project-adaptive agent generation',
    ],
    ctaText: 'Start 30-Day Free Trial',
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
    trialDays: 30,
    features: [],
    standoutFeatures: [
      'All Community features included',
      'Intelligent Setup Wizard',
      'Code Execution MCP Server',
      'Workspace Intelligence (13+ project types)',
      'OpenRouter proxy (200+ models)',
      'Project-adaptive agent generation',
    ],
    ctaText: 'Start 30-Day Free Trial',
    ctaAction: 'checkout',
    highlight: true,
  };

  /**
   * ngOnInit - Initialize Paddle SDK when component loads
   * Also checks for autoCheckout query param for returning from login
   */
  public ngOnInit(): void {
    this.paddleService.initialize();

    // Fetch subscription state for authenticated users
    this.subscriptionService
      .fetchSubscriptionState()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe();

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
   *
   * TASK_2025_128: Only Pro plan keys exist - Community is free with no checkout
   */
  private triggerAutoCheckout(planKey: string): void {
    // Validate plan key - only allow Pro plans (Community is free, no checkout)
    const validPlanKeys = ['pro-monthly', 'pro-yearly'];
    if (!validPlanKeys.includes(planKey)) {
      this.autoCheckoutError.set(
        'Invalid checkout plan. Please select a plan manually.',
      );
      return;
    }

    // Clear any previous error
    this.autoCheckoutError.set(null);

    // Determine which Pro plan to checkout based on key
    let plan: PricingPlan;
    switch (planKey) {
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

        // Check if user already has a Pro subscription - skip auto-checkout if so
        // TASK_2025_128: Community users should still be able to auto-checkout Pro
        const ctx = this.subscriptionContext();
        if (ctx.isAuthenticated && ctx.currentPlanTier === 'pro') {
          // User already has Pro subscription, clear the query param and skip
          this.router.navigate([], {
            relativeTo: this.route,
            queryParams: { autoCheckout: null },
            queryParamsHandling: 'merge',
          });
          return;
        }

        // Small delay to ensure UI is fully rendered
        setTimeout(() => {
          this.proceedWithCheckout(plan);
        }, 500);
      } else if (Date.now() - startTime > this.AUTO_CHECKOUT_TIMEOUT) {
        // Timeout - stop waiting and show user-visible error
        this.clearAutoCheckoutInterval();
        this.autoCheckoutError.set(
          'Unable to start checkout automatically. Please click the checkout button to try again.',
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

  /** Toggle promo code input visibility */
  public togglePromoInput(): void {
    this.showPromoInput.update((v) => !v);
  }

  /** Sync ngModel string to the promoCode signal (uppercased and trimmed) */
  public onPromoCodeChange(value: string): void {
    this.promoCode.set(value.trim().toUpperCase());
  }

  /** Clear entered promo code */
  public clearPromoCode(): void {
    this.promoCodeValue = '';
    this.promoCode.set('');
  }

  /**
   * Handle CTA button click from plan card
   *
   * TASK_2025_128: Community plan uses 'download' action (opens VS Code marketplace).
   * Pro plan uses 'checkout' action (opens Paddle checkout).
   */
  public handleCtaClick(plan: PricingPlan): void {
    // Clear any running auto-checkout interval to prevent race conditions
    this.clearAutoCheckoutInterval();

    // Community plan: download action handled by CommunityPlanCardComponent directly
    // Pro plan: checkout action
    if (plan.ctaAction === 'checkout') {
      // Validate price ID first
      if (isPriceIdPlaceholder(plan.priceId)) {
        this.configError.set(
          'Checkout is not configured yet. Please try again later.',
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
   *
   * TASK_2025_128: Only Pro plans have checkout (Community is free)
   */
  private getPlanKey(plan: PricingPlan): string {
    const isYearly = plan.priceSubtext === 'per year';
    return isYearly ? 'pro-yearly' : 'pro-monthly';
  }

  /**
   * Proceed with Paddle checkout (called after auth check passes)
   */
  private proceedWithCheckout(plan: PricingPlan): void {
    // Validate priceId exists before proceeding
    if (!plan.priceId) {
      this.configError.set(
        'Price configuration error. Please contact support.',
      );
      return;
    }

    this.clearLoadingTimeout();
    this.paddleService.setLoadingPlan(plan.name);

    this.loadingTimeoutId = setTimeout(() => {
      this.paddleService.setLoadingPlan(null);
      this.loadingTimeoutId = null;
    }, this.CHECKOUT_TIMEOUT);

    // Capture priceId and promoCode to avoid TypeScript narrowing issues in callback
    const priceId = plan.priceId;
    const discountCode = this.promoCode() || undefined;

    this.authService
      .getCurrentUser()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (user) => {
          this.paddleService.openCheckout({
            priceId,
            customerEmail: user?.email,
            discountCode,
          });
        },
        error: () => {
          this.paddleService.openCheckout({
            priceId,
            discountCode,
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

  /**
   * Handle manage subscription action from plan cards
   *
   * Opens Paddle customer portal in a new tab for subscription management.
   * Called when user clicks "Manage Subscription", "Reactivate", "Update Payment", or "Resume".
   *
   * Includes:
   * - Auth check before API call (Issue 11)
   * - Loading state for button feedback (Issue 21)
   * - Debounce via loading check (Issue 19)
   * - Separate error signal (Issue 20)
   *
   * Pattern source: profile-page.component.ts:360-386
   */
  public handleManageSubscription(): void {
    // Prevent double-click while loading
    if (this.isPortalLoading()) return;

    // Check auth before making API call
    this.authService
      .isAuthenticated()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (isAuth) => {
          if (!isAuth) {
            // Auth expired - redirect to login
            this.router.navigate(['/login'], {
              queryParams: { returnUrl: '/pricing' },
            });
            return;
          }

          // Auth valid - proceed with portal session
          this.openPortalSession();
        },
        error: () => {
          // Auth check failed - redirect to login as fallback
          this.router.navigate(['/login'], {
            queryParams: { returnUrl: '/pricing' },
          });
        },
      });
  }

  /**
   * Open portal session after auth is verified
   */
  private openPortalSession(): void {
    this.isPortalLoading.set(true);
    this.portalError.set(null);

    this.http
      .post<{ url: string; expiresAt: string }>(
        '/api/v1/subscriptions/portal-session',
        {},
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.isPortalLoading.set(false);
          // Track that portal was opened for refresh on return
          this.portalWasOpened = true;
          window.open(response.url, '_blank', 'noopener,noreferrer');
        },
        error: (error) => {
          this.isPortalLoading.set(false);
          const message =
            error.error?.message || 'Failed to open subscription management.';
          this.portalError.set(message);
        },
      });
  }
}
