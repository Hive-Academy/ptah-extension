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
  PLATFORM_ID,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { NgClass } from '@angular/common';
import {
  PricingPlan,
  PlanSubscriptionContext,
  PlanCtaVariant,
  VALID_SUBSCRIPTION_STATUSES,
  ValidSubscriptionStatus,
} from '../models/pricing-plan.interface';
import {
  computeCtaVariant,
  computeCtaText,
  computeCtaButtonClass,
  isPortalAction,
} from '../utils/plan-card-state.utils';
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
  Check,
  X,
  Download,
  ArrowRight,
  Settings,
} from 'lucide-angular';

/**
 * PricingGridComponent - Grid of pricing plan cards
 *
 * - Community: FREE forever - Core visual editor features (no Paddle)
 * - Ptah Builders: founding-member monthly membership - live training and curriculum
 *
 * Evidence: TASK_2025_121 - Two-Tier Paid Extension Model
 * Evidence: TASK_2025_128 - Freemium Model Conversion
 */
@Component({
  selector: 'ptah-pricing-grid',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NgClass,
    FormsModule,
    ViewportAnimationDirective,
    LucideAngularModule,
  ],
  template: `
    <div
      class="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 lg:py-16 -mt-16 sm:-mt-24 lg:-mt-[150px]"
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
      <!-- Capability Matrix: one unified Free-vs-Builders comparison table -->
      <div
        class="max-w-4xl mx-auto rounded-2xl border border-ink-700 overflow-hidden bg-ink-950/40"
        viewportAnimation
        [viewportConfig]="getCardAnimationConfig(0)"
      >
        <!-- Header row -->
        <div
          class="grid grid-cols-[1fr_5.5rem_7rem] sm:grid-cols-[1fr_9rem_11rem] items-end gap-2 px-5 sm:px-7 py-6 bg-ink-900/60 border-b border-ink-700"
        >
          <div
            class="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-500 self-center"
          >
            Capability
          </div>
          <div class="text-center">
            <div class="text-lg font-bold text-white leading-none">Free</div>
            <div class="font-mono text-[9px] text-emerald-400/80 mt-1">
              open source
            </div>
          </div>
          <div class="text-center">
            <div
              class="text-lg font-bold leading-none whitespace-nowrap bg-gradient-to-r from-amber-300 to-secondary bg-clip-text text-transparent"
            >
              {{ proPlan.price }}
            </div>
            <div class="font-mono text-[9px] text-amber-500/80 mt-1">
              or {{ proPlan.priceSubtext }}
            </div>
          </div>
        </div>

        @if (isFoundingPromo()) {
          <div
            class="mx-5 sm:mx-7 mt-4 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] px-4 py-3 flex items-start gap-2.5"
          >
            <lucide-angular
              [img]="TagIcon"
              class="w-4 h-4 text-amber-400 shrink-0 mt-0.5"
              aria-hidden="true"
            />
            <span class="text-xs text-amber-100/90 leading-relaxed">
              @if (buildersCheckoutEnabled) {
                Founding invite applied — your discount is ready at checkout.
              } @else {
                Early Adopter program — approved contributors get their first
                year of Builders free. Apply below and we'll review your
                request.
              }
            </span>
          </div>
        }

        <!-- Capability rows -->
        @for (row of matrix; track row.label) {
          <div
            class="grid grid-cols-[1fr_5.5rem_7rem] sm:grid-cols-[1fr_9rem_11rem] items-center gap-2 px-5 sm:px-7 py-3.5 border-b border-ink-800 last:border-0"
          >
            <span class="text-sm text-ink-200">{{ row.label }}</span>
            <span class="flex justify-center">
              @if (row.free) {
                <lucide-angular
                  [img]="CheckIcon"
                  class="w-4 h-4 text-emerald-400"
                  aria-label="Included in Free"
                />
              } @else {
                <lucide-angular
                  [img]="XIcon"
                  class="w-4 h-4 text-ink-600"
                  aria-label="Not in Free"
                />
              }
            </span>
            <span class="flex justify-center">
              <lucide-angular
                [img]="CheckIcon"
                class="w-4 h-4 text-amber-400"
                aria-label="Included in Builders"
              />
            </span>
          </div>
        }

        <!-- CTA row -->
        <div
          class="grid grid-cols-[1fr_5.5rem_7rem] sm:grid-cols-[1fr_9rem_11rem] items-start gap-2 px-5 sm:px-7 py-6 bg-ink-950/60"
        >
          <div class="self-center">
            <div
              class="font-mono text-[10px] uppercase tracking-[0.15em] text-ink-500"
            >
              List price {{ proPlan.price }} &middot; {{ proPlan.priceSubtext }}
            </div>
            <div class="mt-1 text-[10px] text-amber-500/70 leading-snug">
              Early adopters: first year of Builders free
            </div>
          </div>

          <!-- Free CTA -->
          <div class="flex justify-center">
            @if (isProUser()) {
              <span
                class="text-center text-[11px] text-ink-500 leading-tight py-2"
              >
                Included in Builders
              </span>
            } @else {
              <button
                type="button"
                class="cta-matrix bg-gradient-to-r from-emerald-600 to-emerald-500 text-white hover:brightness-110"
                (click)="downloadFree()"
              >
                <lucide-angular [img]="DownloadIcon" class="w-3.5 h-3.5" />
                Free
              </button>
            }
          </div>

          <!-- Builders CTA + promo -->
          <div class="flex flex-col items-center gap-2">
            @if (buildersCtaIsMember()) {
              <span
                class="cta-matrix"
                [ngClass]="buildersCtaButtonClass()"
                role="status"
              >
                <lucide-angular [img]="CheckIcon" class="w-3.5 h-3.5" />
                <span>{{ buildersCtaText() }}</span>
              </span>
            } @else if (buildersCtaIsWaitlistLink()) {
              <a
                [href]="buildersWaitlistHref()"
                class="cta-matrix"
                [ngClass]="buildersCtaButtonClass()"
              >
                <span>{{ buildersCtaText() }}</span>
                <lucide-angular [img]="ArrowRightIcon" class="w-3.5 h-3.5" />
              </a>
            } @else {
              <button
                type="button"
                class="cta-matrix"
                [ngClass]="buildersCtaButtonClass()"
                [disabled]="isBuildersCtaDisabled()"
                [attr.aria-busy]="
                  isBuildersLoading() || isLoadingSubscription()
                "
                (click)="onBuildersCta()"
              >
                @if (isBuildersLoading() || isLoadingSubscription()) {
                  <span class="loading loading-spinner loading-xs"></span>
                } @else {
                  @if (buildersCtaVariant() === 'current-plan') {
                    <lucide-angular [img]="SettingsIcon" class="w-3.5 h-3.5" />
                  }
                  <span>{{ buildersCtaText() }}</span>
                }
              </button>
            }

            <!-- Promo code (Builders column) -->
            @if (showPromoOption()) {
              <button
                type="button"
                class="flex items-center gap-1 text-[11px] text-ink-400 hover:text-ink-100 transition-colors"
                (click)="togglePromoInput()"
              >
                <lucide-angular [img]="TagIcon" class="w-3 h-3" />
                Promo code
                <lucide-angular
                  [img]="ChevronDownIcon"
                  class="w-3 h-3 transition-transform duration-200"
                  [class.rotate-180]="showPromoInput()"
                />
              </button>
              @if (showPromoInput()) {
                <input
                  type="text"
                  class="w-32 sm:w-36 rounded-md border border-ink-600 bg-ink-950 px-2 py-1 text-center font-mono text-xs uppercase tracking-wider text-ink-100 placeholder:text-ink-600 focus:border-amber-500/60 focus:outline-none"
                  placeholder="ENTER CODE"
                  [(ngModel)]="promoCodeValue"
                  (ngModelChange)="onPromoCodeChange($event)"
                  maxlength="50"
                  autocomplete="off"
                  aria-label="Promo code"
                />
                @if (promoCode()) {
                  <p class="text-[10px] text-success text-center">
                    <span class="font-mono font-bold">{{ promoCode() }}</span>
                    applied at checkout
                  </p>
                }
              }
            }
          </div>
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

      .cta-matrix {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 0.375rem;
        width: 100%;
        padding: 0.5rem 0.75rem;
        border-radius: 0.6rem;
        font-size: 0.8rem;
        font-weight: 600;
        line-height: 1.15;
        text-align: center;
        transition:
          filter 0.25s ease,
          box-shadow 0.25s ease;
      }
      .cta-matrix:disabled {
        cursor: not-allowed;
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
  public readonly CheckIcon = Check;
  public readonly XIcon = X;
  public readonly DownloadIcon = Download;
  public readonly ArrowRightIcon = ArrowRight;
  public readonly SettingsIcon = Settings;

  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly paddleService = inject(PaddleCheckoutService);
  private readonly authService = inject(AuthService);
  private readonly subscriptionService = inject(SubscriptionStateService);
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly STAGGER_DELAY = 0.15;
  private readonly CHECKOUT_TIMEOUT = 30000; // 30 seconds
  private readonly AUTO_CHECKOUT_TIMEOUT = 10000; // 10 seconds max wait for Paddle

  private readonly paddleConfig = environment.paddle;
  /** Exposed for the template — the founding-offer callout renders differently once checkout opens. */
  protected readonly buildersCheckoutEnabled =
    environment.buildersCheckoutEnabled;
  private loadingTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private autoCheckoutIntervalId: ReturnType<typeof setInterval> | null = null;
  private portalWasOpened = false;
  public readonly configError = signal<string | null>(null);
  public readonly portalError = signal<string | null>(null);
  public readonly isPortalLoading = signal(false);
  public readonly autoCheckoutError = signal<string | null>(null);
  /** Promo code applied at checkout, entered in the Builders matrix column. */
  public readonly showPromoInput = signal(false);
  public readonly promoCode = signal<string>('');
  public promoCodeValue = ''; // ngModel binding, synced to promoCode signal

  /**
   * Founding-invite promo wiring: `?promo=founding&cycle=monthly|yearly&d=<discountId>`
   * from the waitlist launch invite email. `d` is a Paddle discount id, passed
   * through verbatim as `discountCode` at checkout (never uppercased, unlike
   * the manually-entered promo code above).
   */
  public readonly isFoundingPromo = signal(false);
  public readonly foundingCycle = signal<'monthly' | 'yearly'>('monthly');
  private readonly foundingDiscountId = signal<string | null>(null);
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
      const rawStatus = this.subscriptionService.subscriptionStatus();
      const validatedStatus = this.validateSubscriptionStatus(rawStatus);

      return {
        isAuthenticated:
          this.subscriptionService.isFetched() &&
          this.subscriptionService.licenseData() !== null,
        currentPlanTier: this.subscriptionService.currentPlanTier(),
        subscriptionStatus: validatedStatus,
        hasPaddleSubscription: this.subscriptionService.hasPaddleSubscription(),
        periodEndDate: this.subscriptionService.periodEndDate(),
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
   * Ptah Builders plan data
   */
  public readonly proPlan: PricingPlan = {
    name: 'Ptah Builders',
    tier: 'builders',
    price: '$29/mo',
    priceSubtext: '$290/yr',
    priceId: this.paddleConfig.proPriceIdMonthly,
    idealFor: 'Live training and curriculum for shipping SaaS',
    features: [],
    standoutFeatures: [
      'Everything in Ptah (it is free)',
      'Weekly live build sessions',
      'PRD-to-production curriculum',
      'Member skill packs',
      'Priority support',
      'Founding-member pricing, locked in',
    ],
    ctaText: 'Apply for Early Adopter',
    ctaAction: 'checkout',
    highlight: true,
  };

  /**
   * Capability matrix rows. `free` marks whether the open-source app ships the
   * capability; the Builders column always includes everything.
   */
  public readonly matrix: ReadonlyArray<{ label: string; free: boolean }> = [
    { label: 'Memory, Skills, Cron & Gateway suite', free: true },
    { label: 'Bring any of 7 model providers', free: true },
    { label: 'Native VS Code integration', free: true },
    { label: 'Real-time streaming responses', free: true },
    { label: 'Tree-sitter workspace intelligence', free: true },
    { label: 'Weekly live build sessions', free: false },
    { label: 'PRD-to-production curriculum', free: false },
    { label: 'Member skill packs', free: false },
    { label: 'Priority support', free: false },
  ];

  /** Whether the viewer already holds the Builders plan. */
  public readonly isProUser = computed(
    () => this.subscriptionContext().currentPlanTier === 'builders',
  );

  /**
   * Target for the "Apply for Early Adopter" CTA link.
   *
   * The apply form lives at the landing-page `#waitlist` fragment. An
   * authenticated non-member goes straight there. An anonymous viewer is
   * first routed through login (carrying `returnUrl=/#waitlist`) so they
   * land back on the apply form already signed in — mirrors the
   * `returnUrl` bounce that `auth-page.component.ts` honors after auth.
   */
  public readonly buildersWaitlistHref = computed<string>(() =>
    this.subscriptionContext().isAuthenticated
      ? '/#waitlist'
      : `/login?returnUrl=${encodeURIComponent('/#waitlist')}`,
  );

  /** Builders CTA variant derived from subscription context (shared util). */
  public readonly buildersCtaVariant = computed<PlanCtaVariant>(() =>
    computeCtaVariant(this.subscriptionContext()),
  );

  /**
   * Whether the Builders CTA is the complimentary "Early Adopter" member
   * badge — a non-interactive status pill, not a link or button.
   */
  public readonly buildersCtaIsMember = computed(
    () => this.buildersCtaVariant() === 'member',
  );

  /** Builders CTA button label. */
  public readonly buildersCtaText = computed(() =>
    computeCtaText(
      this.buildersCtaVariant(),
      environment.buildersCheckoutEnabled,
    ),
  );

  /** Builders checkout loading state (matches the plan name set on checkout). */
  public readonly isBuildersLoading = computed(
    () =>
      this.loadingPlanName() === this.proPlan.name &&
      this.paddleService.isLoading(),
  );

  /**
   * Whether the Builders CTA renders as a plain link to the apply form instead
   * of a button that opens checkout/portal. True whenever checkout is closed
   * (`buildersCheckoutEnabled` false) AND the viewer is neither a portal-managed
   * subscriber nor a complimentary member - portal actions stay as buttons so
   * `onBuildersCta` can route them to the customer portal, and the 'member'
   * variant renders as a non-interactive badge.
   */
  public readonly buildersCtaIsWaitlistLink = computed(
    () =>
      !environment.buildersCheckoutEnabled &&
      !this.buildersCtaIsMember() &&
      !isPortalAction(this.buildersCtaVariant()),
  );

  /**
   * Whether the Builders CTA button is disabled. Never disabled by subscription
   * state (Builders is the highest tier); only for loading, or an unconfigured
   * price when checkout is actually reachable (flag on, non-portal variant
   * rendered as a button rather than the waitlist link).
   */
  public readonly isBuildersCtaDisabled = computed(() => {
    if (this.isBuildersLoading() || this.isLoadingSubscription()) return true;
    if (
      environment.buildersCheckoutEnabled &&
      !isPortalAction(this.buildersCtaVariant())
    ) {
      return isPriceIdPlaceholder(this.activeCheckoutPriceId());
    }
    return false;
  });

  /** Builders CTA styling from the shared util. */
  public readonly buildersCtaButtonClass = computed(() =>
    computeCtaButtonClass(
      this.buildersCtaVariant(),
      this.isBuildersCtaDisabled(),
    ),
  );

  /**
   * Whether to surface the promo option. Hidden while Builders checkout is
   * closed (no checkout to apply a discount to) and once the viewer already
   * holds the subscription (portal states), where a discount no longer applies.
   */
  public readonly showPromoOption = computed(
    () =>
      environment.buildersCheckoutEnabled &&
      !isPortalAction(this.buildersCtaVariant()),
  );

  /**
   * ngOnInit - Initialize Paddle SDK when component loads
   * Also checks for autoCheckout query param for returning from login
   */
  public ngOnInit(): void {
    if (!this.isBrowser) {
      return;
    }

    this.paddleService.initialize();
    this.subscriptionService
      .fetchSubscriptionState()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe();

    const params = this.route.snapshot.queryParamMap;
    if (params.get('promo') === 'founding') {
      this.isFoundingPromo.set(true);
      if (params.get('cycle') === 'yearly') {
        this.foundingCycle.set('yearly');
      }
      const discountId = params.get('d');
      if (discountId) {
        this.foundingDiscountId.set(discountId);
      }
    }

    const planKey = params.get('autoCheckout');
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
   * Only the Builders plan keys exist - Community is free with no checkout.
   * Plan keys mirror the license-server's VALID_PLAN_KEYS
   * (auth.controller.ts): 'builders-monthly' | 'builders-yearly'.
   *
   * Builders checkout is gated behind `environment.buildersCheckoutEnabled`:
   * while closed, this bails out immediately rather than silently retrying -
   * `proceedWithCheckout` also re-checks the flag as a backstop.
   */
  private triggerAutoCheckout(planKey: string): void {
    if (!environment.buildersCheckoutEnabled) {
      this.autoCheckoutError.set(
        'Builders checkout is not open yet. Please join the waitlist.',
      );
      return;
    }
    const validPlanKeys = ['builders-monthly', 'builders-yearly'];
    if (!validPlanKeys.includes(planKey)) {
      this.autoCheckoutError.set(
        'Invalid checkout plan. Please select a plan manually.',
      );
      return;
    }
    if (planKey === 'builders-yearly') {
      this.foundingCycle.set('yearly');
    }
    this.autoCheckoutError.set(null);
    const plan = this.proPlan;
    const startTime = Date.now();
    this.autoCheckoutIntervalId = setInterval(() => {
      if (this.isPaddleReady()) {
        this.clearAutoCheckoutInterval();
        const ctx = this.subscriptionContext();
        if (ctx.isAuthenticated && ctx.currentPlanTier === 'builders') {
          this.router.navigate([], {
            relativeTo: this.route,
            queryParams: { autoCheckout: null },
            queryParamsHandling: 'merge',
          });
          return;
        }
        setTimeout(() => {
          this.proceedWithCheckout(plan);
        }, 500);
      } else if (Date.now() - startTime > this.AUTO_CHECKOUT_TIMEOUT) {
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

  /** Free column CTA: open the VS Code marketplace listing. */
  public downloadFree(): void {
    if (!this.isBrowser) return;
    window.open(
      'https://marketplace.visualstudio.com/items?itemName=ptah-extensions.ptah-coding-orchestra',
      '_blank',
      'noopener,noreferrer',
    );
  }

  /**
   * Builders column CTA. Routes by variant: portal actions open the
   * subscription portal, checkout variants run the Paddle flow.
   */
  public onBuildersCta(): void {
    if (this.isBuildersCtaDisabled()) return;
    // The 'member' badge is non-interactive — it renders as a <span> with no
    // click handler, but guard here so no code path reaches checkout/portal
    // for a complimentary member (they have no subscription to manage).
    if (this.buildersCtaIsMember()) return;
    if (isPortalAction(this.buildersCtaVariant())) {
      this.handleManageSubscription();
      return;
    }
    this.handleCtaClick(this.proPlan);
  }

  /**
   * Handle CTA button click from plan card
   *
   * Community plan uses 'download' action (opens VS Code marketplace).
   * Builders plan uses 'checkout' action (opens Paddle checkout).
   */
  public handleCtaClick(plan: PricingPlan): void {
    this.clearAutoCheckoutInterval();
    if (plan.ctaAction === 'checkout') {
      if (isPriceIdPlaceholder(plan.priceId)) {
        this.configError.set(
          'Checkout is not configured yet. Please try again later.',
        );
        return;
      }
      const planKey =
        this.foundingCycle() === 'yearly'
          ? 'builders-yearly'
          : 'builders-monthly';
      this.authService
        .isAuthenticated()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (isAuth) => {
            if (!isAuth) {
              this.router.navigate(['/login'], {
                queryParams: {
                  returnUrl: '/pricing',
                  plan: planKey,
                },
              });
              return;
            }
            this.proceedWithCheckout(plan);
          },
          error: () => {
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
   * The Paddle price id to check out with: yearly when the founding-invite
   * `?cycle=yearly` param was present, monthly otherwise (the only cadence
   * reachable from the matrix's single CTA absent a promo link).
   */
  private readonly activeCheckoutPriceId = computed(() =>
    this.foundingCycle() === 'yearly'
      ? this.paddleConfig.proPriceIdYearly
      : this.proPlan.priceId,
  );

  /**
   * Proceed with Paddle checkout (called after auth check passes)
   *
   * Backstop guard: Builders checkout must never run while
   * `environment.buildersCheckoutEnabled` is false, however this was
   * reached (button click, or the `autoCheckout` query-param flow).
   */
  private proceedWithCheckout(plan: PricingPlan): void {
    if (!environment.buildersCheckoutEnabled) {
      this.configError.set(
        'Builders checkout is not open yet. Please join the waitlist instead.',
      );
      return;
    }
    const priceId = this.activeCheckoutPriceId();
    if (!priceId) {
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
    // A founding-invite discount id (from the `?d=` launch-email link) wins
    // over a manually-entered promo code.
    const discountCode =
      this.foundingDiscountId() ?? (this.promoCode() || undefined);

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
    if (this.isPortalLoading()) return;
    this.authService
      .isAuthenticated()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (isAuth) => {
          if (!isAuth) {
            this.router.navigate(['/login'], {
              queryParams: { returnUrl: '/pricing' },
            });
            return;
          }
          this.openPortalSession();
        },
        error: () => {
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
