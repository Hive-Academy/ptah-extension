# Implementation Plan - TASK_2025_127

## Authenticated Pricing Page - Display Current Subscription Status

---

## Codebase Investigation Summary

### Libraries Discovered

- **AuthService**: `apps/ptah-landing-page/src/app/services/auth.service.ts`

  - Key exports: `isAuthenticated()`, `getCurrentUser()`, `logout()`, auth hint management
  - Pattern: Observable-based with localStorage hint optimization

- **PaddleCheckoutService**: `apps/ptah-landing-page/src/app/services/paddle-checkout.service.ts`

  - Key exports: `openCheckout()`, `validateCheckoutBeforeOpen()`, signal-based state
  - Pattern: Signal-based state management with `_isReady`, `_isLoading`, etc.

- **LicenseData Interface**: `apps/ptah-landing-page/src/app/pages/profile/models/license-data.interface.ts`
  - Key types: `LicenseData`, `UserInfo`, `SubscriptionInfo`
  - Plan types: `'basic' | 'pro' | 'trial_basic' | 'trial_pro'`
  - Status types: `'active' | 'none' | 'expired'`

### Patterns Identified

- **Signal-based State Management**: All components use Angular signals (`signal()`, `computed()`)

  - Evidence: `profile-page.component.ts:177-184`, `pricing-grid.component.ts:181-192`
  - Pattern: Private writable signal + public readonly accessor

- **Component Composition**: Smart/container + presentational components

  - Evidence: `ProfilePageComponent` (container) + `ProfileDetailsComponent` (presentational)
  - Pattern: Container fetches data, passes to children via inputs, handles events via outputs

- **HttpClient API Calls**: Direct injection with Observable subscription

  - Evidence: `profile-page.component.ts:210-226`
  - Pattern: `http.get<T>('/api/v1/...').subscribe({ next, error })`

- **Input/Output Signals**: Modern Angular 18+ input/output functions
  - Evidence: `profile-details.component.ts:257-266`, `basic-plan-card.component.ts:183-192`
  - Pattern: `input.required<T>()`, `input<T>(default)`, `output<T>()`

### Integration Points

- **API Endpoint**: `GET /api/v1/licenses/me`

  - Location: Used in `profile-page.component.ts:210`
  - Returns: `LicenseData` with plan, status, subscription info

- **Paddle Portal**: `POST /api/v1/subscriptions/portal-session`
  - Location: Used in `profile-page.component.ts:365`
  - Returns: `{ url: string, expiresAt: string }`

---

## Architecture Design (Codebase-Aligned)

### Design Philosophy

**Chosen Approach**: Service-based subscription state with signal propagation to components

**Rationale**:

1. Matches existing `PaddleCheckoutService` signal-based state pattern
2. Reuses `LicenseData` interface already defined for profile page
3. Minimal changes to existing component structure (enhance, don't replace)
4. Single source of truth for subscription state across pricing components

**Evidence**:

- `paddle-checkout.service.ts:77-96` - Signal-based service state pattern
- `profile-page.component.ts:206-226` - License data fetching pattern
- `pricing-grid.component.ts:187-192` - Exposing service signals in components

### Component Specifications

---

#### Component 1: SubscriptionStateService (NEW)

**Purpose**: Centralized service for fetching and caching subscription state on pricing page

**Pattern**: Signal-based state service (matches `PaddleCheckoutService`)
**Evidence**: `paddle-checkout.service.ts:77-96`

**Responsibilities**:

- Fetch subscription status from `/api/v1/licenses/me` on demand
- Cache subscription state using signals for reactive updates
- Provide computed helpers for subscription state queries
- Handle loading and error states gracefully

**Base Classes/Interfaces** (verified):

- `LicenseData` (source: `license-data.interface.ts:42-75`)
- `SubscriptionInfo` (source: `license-data.interface.ts:30-39`)

**Key Dependencies** (verified):

- `HttpClient` (import from: `@angular/common/http`)
- `AuthService` (import from: `../services/auth.service.ts`)
- Angular signals: `signal`, `computed` (import from: `@angular/core`)

**Implementation Pattern**:

```typescript
// Pattern source: paddle-checkout.service.ts:77-96
import { Injectable, signal, computed, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { LicenseData } from '../pages/profile/models/license-data.interface';
import { AuthService } from './auth.service';

/**
 * SubscriptionStateService - Manages subscription state for pricing page
 *
 * Pattern: Signal-based state (matches PaddleCheckoutService)
 * Evidence: paddle-checkout.service.ts:77-96
 */
@Injectable({ providedIn: 'root' })
export class SubscriptionStateService {
  private readonly http = inject(HttpClient);
  private readonly authService = inject(AuthService);

  // Private writable signals
  private readonly _licenseData = signal<LicenseData | null>(null);
  private readonly _isLoading = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _isFetched = signal(false);

  // Public readonly signals
  public readonly licenseData = this._licenseData.asReadonly();
  public readonly isLoading = this._isLoading.asReadonly();
  public readonly error = this._error.asReadonly();
  public readonly isFetched = this._isFetched.asReadonly();

  // Computed: Current plan tier (normalized)
  public readonly currentPlanTier = computed<'basic' | 'pro' | null>(() => {
    const data = this._licenseData();
    if (!data?.plan) return null;
    // Normalize trial_basic -> basic, trial_pro -> pro
    if (data.plan.includes('basic')) return 'basic';
    if (data.plan.includes('pro')) return 'pro';
    return null;
  });

  // Computed: Is user on trial
  public readonly isOnTrial = computed(() => {
    const data = this._licenseData();
    return data?.plan?.startsWith('trial_') ?? false;
  });

  // Computed: Days remaining in trial
  public readonly trialDaysRemaining = computed(() => {
    const data = this._licenseData();
    if (!this.isOnTrial()) return null;
    return data?.daysRemaining ?? null;
  });

  // Computed: Subscription status
  public readonly subscriptionStatus = computed<string | null>(() => {
    return this._licenseData()?.subscription?.status ?? null;
  });

  // Computed: Has active subscription (not trial)
  public readonly hasActiveSubscription = computed(() => {
    const data = this._licenseData();
    return data?.subscription?.status === 'active' && !this.isOnTrial();
  });

  // Computed: Is subscription canceled but still active
  public readonly isCanceled = computed(() => {
    return this._licenseData()?.subscription?.status === 'canceled';
  });

  // Computed: Is subscription past due
  public readonly isPastDue = computed(() => {
    return this._licenseData()?.subscription?.status === 'past_due';
  });

  /**
   * Fetch subscription state (only if authenticated)
   * Pattern source: profile-page.component.ts:206-226
   */
  public fetchSubscriptionState(): void {
    // Skip if already fetched or currently loading
    if (this._isFetched() || this._isLoading()) return;

    this._isLoading.set(true);
    this._error.set(null);

    // First check authentication
    this.authService.isAuthenticated().subscribe({
      next: (isAuth) => {
        if (!isAuth) {
          this._isLoading.set(false);
          this._isFetched.set(true);
          return;
        }

        // Fetch license data
        this.http.get<LicenseData>('/api/v1/licenses/me').subscribe({
          next: (data) => {
            this._licenseData.set(data);
            this._isLoading.set(false);
            this._isFetched.set(true);
          },
          error: (err) => {
            console.error('[SubscriptionState] Failed to fetch:', err);
            this._error.set('Unable to load subscription status');
            this._isLoading.set(false);
            this._isFetched.set(true);
          },
        });
      },
      error: () => {
        this._isLoading.set(false);
        this._isFetched.set(true);
      },
    });
  }

  /**
   * Reset state (for logout or refresh scenarios)
   */
  public reset(): void {
    this._licenseData.set(null);
    this._isLoading.set(false);
    this._error.set(null);
    this._isFetched.set(false);
  }

  /**
   * Force refresh subscription state
   */
  public refresh(): void {
    this._isFetched.set(false);
    this.fetchSubscriptionState();
  }
}
```

**Quality Requirements**:

- Functional: Must fetch and cache license data correctly
- Functional: Must handle unauthenticated users gracefully (no API call)
- Functional: Must normalize plan types (trial_basic -> basic)
- Non-functional: Loading state must update synchronously
- Pattern Compliance: Must use signal pattern from `paddle-checkout.service.ts:77-96`

**Files Affected**:

- `apps/ptah-landing-page/src/app/services/subscription-state.service.ts` (CREATE)

---

#### Component 2: PlanCardState Interface (NEW)

**Purpose**: Type-safe interface for plan card subscription state

**Pattern**: Interface-driven component inputs (matches `PricingPlan` interface)
**Evidence**: `pricing-plan.interface.ts:9-51`

**Implementation Pattern**:

```typescript
// Add to: pricing-plan.interface.ts

/**
 * Subscription context for plan cards
 * Used to determine CTA button state and visual styling
 */
export interface PlanSubscriptionContext {
  /** Whether user is authenticated */
  isAuthenticated: boolean;

  /** User's current plan tier (null if no subscription) */
  currentPlanTier: 'basic' | 'pro' | null;

  /** Whether user is on trial */
  isOnTrial: boolean;

  /** Days remaining in trial (null if not on trial) */
  trialDaysRemaining: number | null;

  /** Subscription status */
  subscriptionStatus: 'active' | 'trialing' | 'canceled' | 'past_due' | 'paused' | null;

  /** Cancellation period end date (for canceled subscriptions) */
  periodEndDate: string | null;
}

/**
 * CTA button variant for plan cards
 */
export type PlanCtaVariant =
  | 'start-trial' // "Start 14-Day Free Trial" -> checkout
  | 'current-plan' // "Current Plan" -> manage subscription
  | 'upgrade' // "Upgrade to [Plan]" -> checkout
  | 'downgrade' // "Downgrade to [Plan]" (disabled or muted)
  | 'upgrade-now' // "Upgrade Now" (trial users) -> checkout
  | 'reactivate' // "Reactivate" (canceled) -> portal
  | 'update-payment' // "Update Payment" (past_due) -> portal
  | 'included'; // "Included in Pro" (disabled)

/**
 * Badge variant for plan cards
 */
export type PlanBadgeVariant =
  | 'trial' // "14-Day Free Trial" - existing cyan badge
  | 'current' // "Current Plan" - success/green
  | 'trial-active' // "Trial - X days left" - info/blue
  | 'trial-ending' // "Trial ends in X days" - warning/amber
  | 'canceling' // "Ends [date]" - warning/amber
  | 'past-due' // "Payment Issue" - error/red
  | 'popular' // "Most Popular" - amber gradient (existing)
  | 'included'; // "Included in Pro" - muted
```

**Files Affected**:

- `apps/ptah-landing-page/src/app/pages/pricing/models/pricing-plan.interface.ts` (MODIFY)

---

#### Component 3: PricingGridComponent Updates (MODIFY)

**Purpose**: Integrate subscription state and pass context to plan cards

**Pattern**: Container component with service injection
**Evidence**: `pricing-grid.component.ts:167-171`

**Responsibilities**:

- Inject and initialize `SubscriptionStateService`
- Compute subscription context from service signals
- Pass subscription context to plan card components
- Handle "Manage Subscription" action (portal navigation)

**Key Dependencies** (verified):

- `SubscriptionStateService` (new service)
- `PaddleCheckoutService` (existing: `pricing-grid.component.ts:169`)
- `AuthService` (existing: `pricing-grid.component.ts:170`)

**Implementation Pattern**:

```typescript
// Additions to pricing-grid.component.ts

// NEW: Import SubscriptionStateService
import { SubscriptionStateService } from '../../../services/subscription-state.service';
import { PlanSubscriptionContext } from '../models/pricing-plan.interface';

// In class:
private readonly subscriptionService = inject(SubscriptionStateService);

// NEW: Computed subscription context for cards
public readonly subscriptionContext = computed<PlanSubscriptionContext>(() => ({
  isAuthenticated: this.subscriptionService.isFetched() &&
                   this.subscriptionService.licenseData() !== null,
  currentPlanTier: this.subscriptionService.currentPlanTier(),
  isOnTrial: this.subscriptionService.isOnTrial(),
  trialDaysRemaining: this.subscriptionService.trialDaysRemaining(),
  subscriptionStatus: this.subscriptionService.subscriptionStatus() as any,
  periodEndDate: this.subscriptionService.licenseData()?.subscription?.currentPeriodEnd ?? null,
}));

// NEW: Loading state for subscription context
public readonly isLoadingSubscription = this.subscriptionService.isLoading;

// In ngOnInit:
public ngOnInit(): void {
  this.paddleService.initialize();
  this.subscriptionService.fetchSubscriptionState(); // NEW: Fetch subscription state

  // existing autoCheckout logic...
}

// NEW: Handle manage subscription action
public handleManageSubscription(): void {
  this.http
    .post<{ url: string; expiresAt: string }>('/api/v1/subscriptions/portal-session', {})
    .pipe(takeUntilDestroyed(this.destroyRef))
    .subscribe({
      next: (response) => {
        window.open(response.url, '_blank', 'noopener,noreferrer');
      },
      error: (error) => {
        this.configError.set(
          error.error?.message || 'Failed to open subscription management.'
        );
      },
    });
}
```

**Template Updates**:

```html
<!-- Update plan card usage to include subscription context -->
<ptah-basic-plan-card [monthlyPlan]="basicMonthlyPlan" [yearlyPlan]="basicYearlyPlan" [isLoading]="isPlanLoading('Basic')" [subscriptionContext]="subscriptionContext()" [isLoadingContext]="isLoadingSubscription()" (ctaClick)="handleCtaClick($event)" (manageSubscription)="handleManageSubscription()" />

<ptah-pro-plan-card [monthlyPlan]="proMonthlyPlan" [yearlyPlan]="proYearlyPlan" [isLoading]="isPlanLoading('Pro')" [subscriptionContext]="subscriptionContext()" [isLoadingContext]="isLoadingContext()" (ctaClick)="handleCtaClick($event)" (manageSubscription)="handleManageSubscription()" />
```

**Files Affected**:

- `apps/ptah-landing-page/src/app/pages/pricing/components/pricing-grid.component.ts` (MODIFY)

---

#### Component 4: BasicPlanCardComponent Updates (MODIFY)

**Purpose**: Display subscription-aware UI for Basic plan card

**Pattern**: Presentational component with computed state
**Evidence**: `basic-plan-card.component.ts:177-228`

**Responsibilities**:

- Accept subscription context input
- Compute badge variant based on context
- Compute CTA variant and text based on context
- Apply visual styling for "Current Plan" state
- Emit appropriate action (checkout vs manage)

**Implementation Pattern**:

```typescript
// Additions to basic-plan-card.component.ts

import { PlanSubscriptionContext, PlanCtaVariant, PlanBadgeVariant } from '../models/pricing-plan.interface';

// NEW: Lucide icons for states
import { Check, ArrowRight, Settings, Crown } from 'lucide-angular';

// In class:
public readonly SettingsIcon = Settings;
public readonly CrownIcon = Crown;

/** Subscription context from parent */
public readonly subscriptionContext = input<PlanSubscriptionContext | null>(null);

/** Whether subscription context is loading */
public readonly isLoadingContext = input<boolean>(false);

/** Manage subscription event */
public readonly manageSubscription = output<void>();

// Computed: Is this the user's current plan
public readonly isCurrentPlan = computed(() => {
  const ctx = this.subscriptionContext();
  if (!ctx?.currentPlanTier) return false;
  return ctx.currentPlanTier === 'basic' && !ctx.isOnTrial;
});

// Computed: Is this the user's trial plan
public readonly isTrialPlan = computed(() => {
  const ctx = this.subscriptionContext();
  if (!ctx?.isOnTrial) return false;
  return ctx.currentPlanTier === 'basic';
});

// Computed: Badge variant
public readonly badgeVariant = computed<PlanBadgeVariant>(() => {
  const ctx = this.subscriptionContext();
  if (!ctx) return 'trial'; // Default: show trial badge

  if (this.isCurrentPlan()) return 'current';
  if (this.isTrialPlan()) {
    const days = ctx.trialDaysRemaining ?? 0;
    return days <= 3 ? 'trial-ending' : 'trial-active';
  }
  if (ctx.subscriptionStatus === 'canceled' && ctx.currentPlanTier === 'basic') {
    return 'canceling';
  }
  if (ctx.subscriptionStatus === 'past_due' && ctx.currentPlanTier === 'basic') {
    return 'past-due';
  }

  return 'trial'; // Default for non-authenticated or no subscription
});

// Computed: CTA variant
public readonly ctaVariant = computed<PlanCtaVariant>(() => {
  const ctx = this.subscriptionContext();
  if (!ctx?.isAuthenticated) return 'start-trial';
  if (!ctx.currentPlanTier) return 'start-trial';

  // User has Basic subscription
  if (ctx.currentPlanTier === 'basic') {
    if (ctx.isOnTrial) return 'upgrade-now';
    if (ctx.subscriptionStatus === 'canceled') return 'reactivate';
    if (ctx.subscriptionStatus === 'past_due') return 'update-payment';
    return 'current-plan'; // Active basic subscription
  }

  // User has Pro subscription - Basic is included
  if (ctx.currentPlanTier === 'pro') {
    return 'included';
  }

  return 'start-trial';
});

// Computed: CTA text
public readonly ctaText = computed(() => {
  const variant = this.ctaVariant();
  switch (variant) {
    case 'start-trial': return 'Start 14-Day Free Trial';
    case 'current-plan': return 'Manage Subscription';
    case 'upgrade-now': return 'Upgrade Now';
    case 'reactivate': return 'Reactivate';
    case 'update-payment': return 'Update Payment';
    case 'included': return 'Included in Pro';
    default: return 'Start 14-Day Free Trial';
  }
});

// Computed: Is CTA disabled
public readonly isCtaDisabled = computed(() => {
  if (this.isLoading()) return true;
  if (this.isLoadingContext()) return true;
  const variant = this.ctaVariant();
  return variant === 'included';
});

// Computed: Card border class for current plan
public readonly cardBorderClass = computed(() => {
  if (this.isCurrentPlan()) {
    return 'border-success/50 shadow-success/20';
  }
  return 'border-base-content/10 hover:border-base-content/20';
});

// Updated click handler
protected handleClick(): void {
  if (this.isCtaDisabled()) return;

  const variant = this.ctaVariant();

  // Actions that go to Paddle portal
  if (['current-plan', 'reactivate', 'update-payment'].includes(variant)) {
    this.manageSubscription.emit();
    return;
  }

  // Actions that open checkout
  this.ctaClick.emit(this.activePlan());
}
```

**Template Updates** (key sections):

```html
<!-- Badge section - conditional rendering -->
@if (badgeVariant() === 'current') {
<div
  class="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1
         bg-success rounded-full
         text-xs font-bold text-success-content uppercase tracking-wider
         shadow-lg shadow-success/30 flex items-center gap-1.5"
>
  <lucide-angular [img]="CrownIcon" class="w-3 h-3" aria-hidden="true" />
  Current Plan
</div>
} @else if (badgeVariant() === 'trial-active') {
<div
  class="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1
         bg-info rounded-full
         text-xs font-bold text-info-content uppercase tracking-wider
         shadow-lg shadow-info/30"
>
  Trial - {{ subscriptionContext()?.trialDaysRemaining }} days left
</div>
} @else if (badgeVariant() === 'trial-ending') {
<div
  class="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1
         bg-warning rounded-full
         text-xs font-bold text-warning-content uppercase tracking-wider
         shadow-lg shadow-warning/30"
>
  Trial ends in {{ subscriptionContext()?.trialDaysRemaining }} days
</div>
} @else if (badgeVariant() === 'canceling') {
<div
  class="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1
         bg-warning rounded-full
         text-xs font-bold text-warning-content uppercase tracking-wider
         shadow-lg shadow-warning/30"
>
  Ends {{ formatDate(subscriptionContext()?.periodEndDate) }}
</div>
} @else if (badgeVariant() === 'past-due') {
<div
  class="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1
         bg-error rounded-full
         text-xs font-bold text-error-content uppercase tracking-wider
         shadow-lg shadow-error/30"
>
  Payment Issue
</div>
} @else {
<!-- Default trial badge -->
<div
  class="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1
         bg-gradient-to-r from-sky-500 to-cyan-500 rounded-full
         text-xs font-bold text-base-100 uppercase tracking-wider
         shadow-lg shadow-sky-500/30"
>
  {{ activePlan().trialDays }}-Day Free Trial
</div>
}

<!-- Card wrapper with dynamic border -->
<div
  class="relative rounded-2xl p-6 lg:p-8 h-full flex flex-col
         bg-base-200/40 transition-all duration-500 group"
  [ngClass]="cardBorderClass()"
>
  <!-- CTA Button - conditional styling -->
  <button
    class="mt-8 w-full py-3.5 px-6 rounded-xl font-semibold text-sm
         flex items-center justify-center gap-2 transition-all duration-300
         group-hover:gap-3 cursor-pointer"
    [ngClass]="{
    'bg-success/20 text-success border border-success/30': ctaVariant() === 'current-plan',
    'bg-base-content/10 text-base-content hover:bg-base-content/20': ctaVariant() === 'start-trial' || ctaVariant() === 'upgrade-now',
    'bg-warning/20 text-warning border border-warning/30': ctaVariant() === 'reactivate',
    'bg-error/20 text-error border border-error/30': ctaVariant() === 'update-payment',
    'bg-base-300/50 text-base-content/40 cursor-not-allowed': ctaVariant() === 'included',
    'opacity-50 cursor-not-allowed': isCtaDisabled()
  }"
    [disabled]="isCtaDisabled()"
    [attr.aria-busy]="isLoading()"
    (click)="handleClick()"
  >
    @if (isLoading() || isLoadingContext()) {
    <span class="loading loading-spinner loading-sm"></span>
    <span>Loading...</span>
    } @else { @if (ctaVariant() === 'current-plan') {
    <lucide-angular [img]="SettingsIcon" class="w-4 h-4" aria-hidden="true" />
    }
    <span>{{ ctaText() }}</span>
    @if (ctaVariant() !== 'current-plan' && ctaVariant() !== 'included') {
    <lucide-angular [img]="ArrowRightIcon" class="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1" />
    } }
  </button>
</div>
```

**Files Affected**:

- `apps/ptah-landing-page/src/app/pages/pricing/components/basic-plan-card.component.ts` (MODIFY)

---

#### Component 5: ProPlanCardComponent Updates (MODIFY)

**Purpose**: Display subscription-aware UI for Pro plan card

**Pattern**: Same as BasicPlanCardComponent updates
**Evidence**: `pro-plan-card.component.ts:192-243`

**Implementation follows same pattern as BasicPlanCardComponent with these differences**:

- `isCurrentPlan` checks for `pro` tier
- `isTrialPlan` checks for `trial_pro`
- No "included" state (Pro is the highest tier)
- For Basic subscribers viewing Pro: show "Upgrade to Pro" variant

**Computed CTA Variant for Pro Card**:

```typescript
public readonly ctaVariant = computed<PlanCtaVariant>(() => {
  const ctx = this.subscriptionContext();
  if (!ctx?.isAuthenticated) return 'start-trial';
  if (!ctx.currentPlanTier) return 'start-trial';

  // User has Pro subscription
  if (ctx.currentPlanTier === 'pro') {
    if (ctx.isOnTrial) return 'upgrade-now';
    if (ctx.subscriptionStatus === 'canceled') return 'reactivate';
    if (ctx.subscriptionStatus === 'past_due') return 'update-payment';
    return 'current-plan'; // Active pro subscription
  }

  // User has Basic subscription - can upgrade to Pro
  if (ctx.currentPlanTier === 'basic') {
    return 'upgrade'; // "Upgrade to Pro"
  }

  return 'start-trial';
});

public readonly ctaText = computed(() => {
  const variant = this.ctaVariant();
  switch (variant) {
    case 'start-trial': return 'Start 14-Day Free Trial';
    case 'current-plan': return 'Manage Subscription';
    case 'upgrade': return 'Upgrade to Pro';
    case 'upgrade-now': return 'Upgrade Now';
    case 'reactivate': return 'Reactivate';
    case 'update-payment': return 'Update Payment';
    default: return 'Start 14-Day Free Trial';
  }
});
```

**Files Affected**:

- `apps/ptah-landing-page/src/app/pages/pricing/components/pro-plan-card.component.ts` (MODIFY)

---

## Integration Architecture

### Integration Points

- **SubscriptionStateService <-> AuthService**

  - Service checks auth before API call
  - Pattern: Sequential observable chain
  - Evidence: `auth.service.ts:52-59`

- **SubscriptionStateService <-> HttpClient**

  - Fetches `/api/v1/licenses/me`
  - Pattern: Direct subscription with error handling
  - Evidence: `profile-page.component.ts:210-226`

- **PricingGridComponent <-> SubscriptionStateService**

  - Injects service, calls `fetchSubscriptionState()` on init
  - Exposes computed `subscriptionContext` to children
  - Pattern: Container component orchestration

- **Plan Cards <-> PricingGridComponent**
  - Receives `subscriptionContext` input
  - Emits `manageSubscription` output for portal actions
  - Pattern: Input/output signal communication

### Data Flow

```
[Page Load]
     │
     v
[PricingGridComponent.ngOnInit]
     │
     ├─> paddleService.initialize()
     │
     └─> subscriptionService.fetchSubscriptionState()
              │
              v
         [AuthService.isAuthenticated()]
              │
              ├─> false: Skip API call, set isFetched=true
              │
              └─> true: GET /api/v1/licenses/me
                         │
                         v
                    [Update signals: licenseData, isLoading, isFetched]
                         │
                         v
                    [Computed signals update: currentPlanTier, isOnTrial, etc.]
                         │
                         v
                    [subscriptionContext computed updates]
                         │
                         v
                    [Plan cards re-render with new context]
```

### Dependencies

**External Dependencies**:

- None (uses existing APIs and packages)

**Internal Dependencies**:

- `LicenseData` interface (existing)
- `AuthService` (existing)
- `HttpClient` (existing)

---

## Quality Requirements (Architecture-Level)

### Functional Requirements

- **REQ-1**: Authenticated users see their current plan highlighted with "Current Plan" badge
- **REQ-2**: CTA buttons reflect appropriate actions based on subscription state
- **REQ-3**: Trial users see "Trial - X days left" badge with upgrade prompt
- **REQ-4**: Canceled subscriptions show end date with "Reactivate" option
- **REQ-5**: "Manage Subscription" opens Paddle customer portal

### Non-Functional Requirements

- **Performance**: Subscription status loads within 500ms on 4G connection
- **Performance**: No layout shift during loading (skeleton/spinner brief)
- **Reliability**: Falls back to generic view if API fails
- **Security**: Never trusts client-side state for checkout eligibility
- **Accessibility**: Screen readers announce current plan status

### Pattern Compliance

- Signal-based state management (verified at: `paddle-checkout.service.ts:77-96`)
- Input/output signal pattern (verified at: `basic-plan-card.component.ts:183-192`)
- Container/presentational composition (verified at: `profile-page.component.ts`)
- HttpClient observable pattern (verified at: `profile-page.component.ts:210-226`)

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: frontend-developer

**Rationale**:

- All changes are in Angular frontend components
- Requires understanding of Angular signals and reactive patterns
- No backend API changes needed
- UI/UX implementation with DaisyUI/Tailwind

### Complexity Assessment

**Complexity**: MEDIUM
**Estimated Effort**: 6-8 hours

**Breakdown**:

- Phase 1 (Service): 1-2 hours
- Phase 2 (Interface): 0.5 hours
- Phase 3 (Grid Component): 1-2 hours
- Phase 4 (Basic Card): 1.5-2 hours
- Phase 5 (Pro Card): 1-1.5 hours
- Testing & Polish: 1 hour

### Files Affected Summary

**CREATE**:

- `apps/ptah-landing-page/src/app/services/subscription-state.service.ts`

**MODIFY**:

- `apps/ptah-landing-page/src/app/pages/pricing/models/pricing-plan.interface.ts`
- `apps/ptah-landing-page/src/app/pages/pricing/components/pricing-grid.component.ts`
- `apps/ptah-landing-page/src/app/pages/pricing/components/basic-plan-card.component.ts`
- `apps/ptah-landing-page/src/app/pages/pricing/components/pro-plan-card.component.ts`

### Critical Verification Points

**Before Implementation, Team-Leader Must Ensure Developer Verifies**:

1. **All imports exist in codebase**:

   - `signal`, `computed`, `inject` from `@angular/core`
   - `HttpClient` from `@angular/common/http`
   - `LicenseData` from `../pages/profile/models/license-data.interface.ts`
   - `AuthService` from `../services/auth.service.ts`

2. **All patterns verified from examples**:

   - Signal-based service: `paddle-checkout.service.ts:77-96`
   - License fetching: `profile-page.component.ts:206-226`
   - Input/output signals: `basic-plan-card.component.ts:183-192`
   - Portal session: `profile-page.component.ts:360-386`

3. **Library documentation consulted**:

   - Angular signals documentation
   - DaisyUI badge/button classes

4. **No hallucinated APIs**:
   - All Angular imports are standard (`@angular/core`, `@angular/common/http`)
   - `LicenseData` interface verified at `license-data.interface.ts:42-75`
   - `/api/v1/licenses/me` endpoint verified in use at `profile-page.component.ts:210`
   - `/api/v1/subscriptions/portal-session` verified at `profile-page.component.ts:365`

### Architecture Delivery Checklist

- [x] All components specified with evidence
- [x] All patterns verified from codebase
- [x] All imports/decorators verified as existing
- [x] Quality requirements defined
- [x] Integration points documented
- [x] Files affected list complete
- [x] Developer type recommended
- [x] Complexity assessed
- [x] No step-by-step implementation (that's team-leader's job)

---

## Risk Mitigation

### Technical Risks

| Risk                        | Mitigation                                              |
| --------------------------- | ------------------------------------------------------- |
| API response delay          | Loading state with graceful degradation to generic view |
| Race condition with auth    | Sequential auth check before license fetch              |
| State desync after checkout | Service provides `refresh()` method for manual updates  |

### UX Risks

| Risk                        | Mitigation                                                     |
| --------------------------- | -------------------------------------------------------------- |
| Layout shift during load    | Maintain fixed badge/button dimensions, use skeleton if needed |
| Confusing upgrade/downgrade | Clear visual hierarchy, explicit button labels                 |
| Portal opening in same tab  | Always use `target="_blank"` with `noopener,noreferrer`        |

---

## Implementation Phases Summary

### Phase 1: Create SubscriptionStateService

- New file: `subscription-state.service.ts`
- Signal-based state management
- Auth-aware API fetching

### Phase 2: Extend PricingPlan Interface

- Add `PlanSubscriptionContext` interface
- Add `PlanCtaVariant` and `PlanBadgeVariant` types

### Phase 3: Update PricingGridComponent

- Inject SubscriptionStateService
- Add computed subscriptionContext
- Add handleManageSubscription method
- Update template to pass context to cards

### Phase 4: Update BasicPlanCardComponent

- Add subscriptionContext input
- Add computed badge/CTA variants
- Update template for conditional rendering
- Add manageSubscription output

### Phase 5: Update ProPlanCardComponent

- Same updates as BasicPlanCardComponent
- Pro-specific CTA logic (upgrade from Basic)

---

## References

### Existing Implementations

- **Profile Page**: `apps/ptah-landing-page/src/app/pages/profile/profile-page.component.ts` (lines 206-226, 360-386)
- **Profile Details**: `apps/ptah-landing-page/src/app/pages/profile/components/profile-details.component.ts`
- **Paddle Service**: `apps/ptah-landing-page/src/app/services/paddle-checkout.service.ts` (lines 77-96)
- **Auth Service**: `apps/ptah-landing-page/src/app/services/auth.service.ts`

### Backend API Endpoints

- `GET /api/v1/licenses/me` - Full license details (verified in profile-page.component.ts:210)
- `POST /api/v1/subscriptions/portal-session` - Paddle portal URL (verified in profile-page.component.ts:365)
