# Implementation Plan - TASK_2025_114

## Paddle Subscription Integration - Frontend Implementation

---

## Codebase Investigation Summary

### Libraries Discovered

| Library | Purpose | Path | Key Exports |
|---------|---------|------|-------------|
| Angular HTTP | API calls | `@angular/common/http` | HttpClient, HttpInterceptorFn |
| Angular Router | Navigation | `@angular/router` | Router, Routes, CanActivateFn |
| Angular Signals | State management | `@angular/core` | signal, computed, effect |
| DaisyUI | UI Components | Tailwind config | btn, alert, loading classes |
| @hive-academy/angular-gsap | Animations | External | ViewportAnimationDirective |

### Patterns Identified

**Pattern 1: Service Architecture**
- **Evidence**: `auth.service.ts:28-58`
- **Components**: Injectable service with RxJS observables
- **Conventions**:
  - `providedIn: 'root'` for singleton services
  - `inject()` function for DI
  - HTTP calls return Observables with error handling

**Pattern 2: Signal-Based State (Components)**
- **Evidence**: `profile-page.component.ts:207-209`
- **Components**: Angular signals for reactive state
- **Conventions**:
  - `signal<T>()` for mutable state
  - Direct `.set()` calls for updates
  - Template reads via `signalName()`

**Pattern 3: Environment Configuration**
- **Evidence**: `environment.ts:1-29`, `environment.production.ts:1-27`
- **Structure**: Typed configuration object with paddle namespace
- **Conventions**: Separate files for dev/prod with identical structure

**Pattern 4: API Interceptor**
- **Evidence**: `api.interceptor.ts:18-35`
- **Pattern**: Prepend base URL for `/api` and `/auth` routes
- **Key**: Uses `withCredentials: true` for cookie auth

**Pattern 5: Pricing Plan Interface**
- **Evidence**: `pricing-plan.interface.ts:1-42`
- **Fields**: name, tier, price, priceSubtext, priceId, features, ctaText, ctaAction

### Integration Points

| Service/API | Purpose | Location | Interface |
|-------------|---------|----------|-----------|
| AuthService | User authentication state | `services/auth.service.ts` | `getCurrentUser()` returns Observable<AuthUser \| null> |
| API Interceptor | Base URL prefixing | `interceptors/api.interceptor.ts` | Auto-prepends apiBaseUrl |
| Environment Config | App configuration | `environments/environment.ts` | `environment.paddle.*` |
| Paddle Webhook | Backend subscription handling | `POST /webhooks/paddle` | Already implemented (TASK_2025_112) |

---

## Architecture Design (Codebase-Aligned)

### Design Philosophy

**Chosen Approach**: Hybrid Service Architecture with Signals
**Rationale**:
1. Matches existing `auth.service.ts` pattern for service structure
2. Uses signals for UI state (per `profile-page.component.ts` pattern)
3. Dynamic script loading to avoid blocking initial page load
4. Environment-driven configuration (per existing `environment.ts` pattern)

**Evidence**:
- Service pattern: `auth.service.ts:28-58`
- Signal pattern: `profile-page.component.ts:207-209`
- Environment pattern: `environment.ts:23-28`

### Architecture Diagram

```
+------------------+     +----------------------+     +------------------+
|   index.html     |     |  PaddleCheckoutSvc   |     |  pricing-grid    |
|                  |     |                      |     |    component     |
|  (No script tag) |     |  - isReady signal    |     |                  |
+------------------+     |  - isLoading signal  |     |  - plans signal  |
                         |  - error signal      |     |  - handleCtaClick|
                         |                      |     +--------+---------+
                         |  initialize()        |              |
                         |  openCheckout()      |<-------------+
                         |  closeCheckout()     |     injects service
                         +----------+-----------+
                                    |
                                    | dynamically loads
                                    v
                         +----------------------+
                         |  Paddle.js SDK       |
                         |  (CDN script)        |
                         |                      |
                         |  Paddle.Initialize() |
                         |  Paddle.Checkout     |
                         |    .open()           |
                         +----------+-----------+
                                    |
                                    | overlay checkout
                                    v
                         +----------------------+
                         |  Paddle Payment      |
                         |  Overlay             |
                         |                      |
                         |  -> success callback |
                         |  -> close callback   |
                         +----------------------+
```

### Event Flow

```
User clicks "Subscribe Monthly"
         |
         v
+-------------------+
| plan-card emits   |
| ctaClick(plan)    |
+--------+----------+
         |
         v
+-------------------+
| pricing-grid      |
| handleCtaClick()  |
+--------+----------+
         |
         v
+-------------------+
| paddleCheckout    |
| .openCheckout({   |
|   priceId,        |
|   customerEmail   |
| })                |
+--------+----------+
         |
         v
+-------------------+
| Paddle overlay    |
| appears           |
+--------+----------+
         |
    +----+----+
    |         |
 success    cancel
    |         |
    v         v
+-------+ +--------+
|redirect| |close   |
|/profile| |overlay |
+-------+ +--------+
```

---

## Component Specifications

### Component 1: Environment Configuration Update

**Purpose**: Update Paddle configuration structure in environment files to match new pricing model (Monthly/Yearly instead of EarlyAdopter/Pro)

**Pattern**: Environment Configuration
**Evidence**: `environment.ts:23-28`, `environment.production.ts:22-26`

**Responsibilities**:
- Define Paddle environment (sandbox/production)
- Store monthly price ID
- Store yearly price ID
- Optional: Store client token for enhanced features

**Current Configuration** (needs update):
```typescript
// environment.ts:23-28
paddle: {
  environment: 'sandbox' as const,
  priceIdEarlyAdopter: 'pri_01jqbkwnq87xxxxxxxxx',
  priceIdPro: 'pri_01jqbkwnq87yyyyyyyyy',
},
```

**New Configuration**:
```typescript
// Pattern source: environment.ts:23-28 (structure)
// Updated field names per PADDLE_SETUP_SIMPLIFIED.md
paddle: {
  /** Paddle environment: 'sandbox' for testing, 'production' for live */
  environment: 'sandbox' as const,
  /** Price ID for Pro Monthly ($8/month) - from Paddle dashboard */
  priceIdMonthly: 'pri_01jqbkwnq87xxxxxxxxx', // TODO: Replace with real Paddle price ID
  /** Price ID for Pro Yearly ($80/year) - from Paddle dashboard */
  priceIdYearly: 'pri_01jqbkwnq87yyyyyyyyy', // TODO: Replace with real Paddle price ID
},
```

**Quality Requirements**:
- Type safety via `as const` for environment literal
- Clear documentation comments
- Placeholder values with TODO for replacement
- Production file must use `'production'` environment

**Files Affected**:
- `d:\projects\ptah-extension\apps\ptah-landing-page\src\environments\environment.ts` (MODIFY)
- `d:\projects\ptah-extension\apps\ptah-landing-page\src\environments\environment.production.ts` (MODIFY)

---

### Component 2: PaddleCheckoutService

**Purpose**: Manage Paddle.js SDK lifecycle and provide checkout functionality to components

**Pattern**: Injectable Service with Signal State
**Evidence**:
- Service pattern: `auth.service.ts:28-58`
- Signal state pattern: `profile-page.component.ts:207-209`

**Responsibilities**:
1. Dynamically load Paddle.js SDK from CDN
2. Initialize Paddle with correct environment
3. Provide reactive state via signals (isReady, isLoading, error)
4. Open checkout overlay with pre-filled customer email
5. Handle checkout callbacks (success, close)
6. Retry logic for SDK loading failures (3 attempts)

**Dependencies** (verified):
- `@angular/core` - inject, Injectable, signal
- `@angular/router` - Router (for navigation on success)
- `./auth.service.ts` - AuthService (for customer email)
- `../../environments/environment` - environment.paddle config

**Implementation Pattern**:

```typescript
// Pattern source: auth.service.ts:28-58 (service structure)
// Pattern source: profile-page.component.ts:207-209 (signal state)

import { Injectable, signal, inject, computed } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from './auth.service';
import { environment } from '../../environments/environment';

/**
 * Paddle.js global interface
 * @see https://developer.paddle.com/paddlejs/overview
 */
declare global {
  interface Window {
    Paddle?: {
      Initialize: (options: PaddleInitOptions) => void;
      Checkout: {
        open: (options: PaddleCheckoutOptions) => void;
        close: () => void;
      };
      Environment: {
        set: (env: 'sandbox' | 'production') => void;
      };
    };
  }
}

interface PaddleInitOptions {
  token?: string;
  environment?: 'sandbox' | 'production';
  eventCallback?: (event: PaddleEvent) => void;
}

interface PaddleCheckoutOptions {
  items: Array<{ priceId: string; quantity: number }>;
  customer?: { email?: string };
  settings?: {
    displayMode?: 'overlay' | 'inline';
    successUrl?: string;
    theme?: 'light' | 'dark';
    locale?: string;
  };
}

interface PaddleEvent {
  name: string;
  data?: unknown;
}

export interface CheckoutOptions {
  priceId: string;
  customerEmail?: string;
  successUrl?: string;
}

/**
 * PaddleCheckoutService - Manages Paddle.js SDK and checkout flow
 *
 * Pattern: Injectable service with signal-based state
 * Evidence: auth.service.ts:28-58, profile-page.component.ts:207-209
 */
@Injectable({ providedIn: 'root' })
export class PaddleCheckoutService {
  private readonly router = inject(Router);
  private readonly authService = inject(AuthService);

  private readonly paddleConfig = environment.paddle;
  private readonly PADDLE_SDK_URL = 'https://cdn.paddle.com/paddle/v2/paddle.js';
  private readonly MAX_RETRY_ATTEMPTS = 3;

  // Reactive state signals
  private readonly _isReady = signal(false);
  private readonly _isLoading = signal(false);
  private readonly _error = signal<string | null>(null);

  // Public readonly signals
  public readonly isReady = this._isReady.asReadonly();
  public readonly isLoading = this._isLoading.asReadonly();
  public readonly error = this._error.asReadonly();

  // Computed: Can checkout if ready and not loading
  public readonly canCheckout = computed(() =>
    this._isReady() && !this._isLoading()
  );

  private initAttempts = 0;
  private scriptElement: HTMLScriptElement | null = null;

  /**
   * Initialize Paddle.js SDK
   *
   * Loads script from CDN and initializes with environment config.
   * Retries up to MAX_RETRY_ATTEMPTS on failure.
   */
  public initialize(): void {
    if (this._isReady() || this._isLoading()) {
      return; // Already initialized or in progress
    }

    this._isLoading.set(true);
    this._error.set(null);
    this.loadScript();
  }

  /**
   * Open Paddle checkout overlay
   */
  public openCheckout(options: CheckoutOptions): void {
    if (!window.Paddle || !this._isReady()) {
      this._error.set('Paddle SDK not ready. Please try again.');
      return;
    }

    this._isLoading.set(true);

    window.Paddle.Checkout.open({
      items: [{ priceId: options.priceId, quantity: 1 }],
      customer: options.customerEmail ? { email: options.customerEmail } : undefined,
      settings: {
        displayMode: 'overlay',
        theme: 'dark', // Match anubis theme
        locale: 'en',
      },
    });
  }

  /**
   * Close checkout overlay programmatically
   */
  public closeCheckout(): void {
    if (window.Paddle) {
      window.Paddle.Checkout.close();
    }
    this._isLoading.set(false);
  }

  /**
   * Retry initialization after failure
   */
  public retryInitialization(): void {
    this.initAttempts = 0;
    this._isReady.set(false);
    this._error.set(null);

    // Remove existing script if present
    if (this.scriptElement) {
      this.scriptElement.remove();
      this.scriptElement = null;
    }

    this.initialize();
  }

  private loadScript(): void {
    // Check if script already exists
    if (document.querySelector(`script[src="${this.PADDLE_SDK_URL}"]`)) {
      this.initializePaddle();
      return;
    }

    this.scriptElement = document.createElement('script');
    this.scriptElement.src = this.PADDLE_SDK_URL;
    this.scriptElement.async = true;

    this.scriptElement.onload = () => this.initializePaddle();
    this.scriptElement.onerror = () => this.handleScriptError();

    document.head.appendChild(this.scriptElement);
  }

  private initializePaddle(): void {
    if (!window.Paddle) {
      this.handleScriptError();
      return;
    }

    try {
      window.Paddle.Initialize({
        environment: this.paddleConfig.environment,
        eventCallback: (event) => this.handlePaddleEvent(event),
      });

      this._isReady.set(true);
      this._isLoading.set(false);
      this._error.set(null);
      console.log(`Paddle SDK initialized in ${this.paddleConfig.environment} mode`);
    } catch (err) {
      this.handleScriptError();
    }
  }

  private handleScriptError(): void {
    this.initAttempts++;

    if (this.initAttempts < this.MAX_RETRY_ATTEMPTS) {
      // Retry with exponential backoff
      const delay = Math.pow(2, this.initAttempts) * 1000;
      setTimeout(() => this.loadScript(), delay);
    } else {
      this._isLoading.set(false);
      this._error.set(
        'Payment system temporarily unavailable. Please try again later.'
      );
    }
  }

  private handlePaddleEvent(event: PaddleEvent): void {
    console.log('Paddle event:', event.name, event.data);

    switch (event.name) {
      case 'checkout.completed':
        this._isLoading.set(false);
        // Navigate to profile page after successful checkout
        this.router.navigate(['/profile']);
        break;

      case 'checkout.closed':
        this._isLoading.set(false);
        // User closed checkout - no action needed
        break;

      case 'checkout.error':
        this._isLoading.set(false);
        // Paddle handles error display in overlay
        break;
    }
  }
}
```

**Quality Requirements**:
- Functional: SDK loads successfully from CDN
- Functional: Checkout overlay opens with correct price ID
- Functional: Customer email pre-filled when authenticated
- Functional: Success redirects to `/profile`
- Non-Functional: SDK load < 2 seconds on 3G
- Non-Functional: Retry logic with exponential backoff
- Non-Functional: Graceful degradation if SDK fails

**Files Affected**:
- `d:\projects\ptah-extension\apps\ptah-landing-page\src\app\services\paddle-checkout.service.ts` (CREATE)

---

### Component 3: Pricing Grid Component Update

**Purpose**: Integrate PaddleCheckoutService and use environment configuration for price IDs

**Pattern**: Signal-based component with service injection
**Evidence**: `pricing-grid.component.ts:1-147`

**Responsibilities**:
1. Inject PaddleCheckoutService and AuthService
2. Initialize Paddle SDK on component init
3. Source price IDs from environment config (not hardcoded)
4. Handle CTA clicks with checkout integration
5. Track per-plan loading state
6. Display error state if Paddle unavailable

**Dependencies** (verified):
- `@angular/core` - inject, signal, OnInit
- `@angular/router` - Router
- `./paddle-checkout.service.ts` - PaddleCheckoutService
- `./auth.service.ts` - AuthService
- `../../environments/environment` - environment.paddle config

**Current Implementation** (needs update):
```typescript
// pricing-grid.component.ts:130-146
public handleCtaClick(plan: PricingPlan): void {
  if (plan.ctaAction === 'signup') {
    this.router.navigate(['/login']);
  } else if (plan.ctaAction === 'checkout' && plan.priceId) {
    // TODO: Integrate Paddle.js checkout
    console.log('Paddle checkout for:', plan.name, plan.priceId);
  }
}
```

**Updated Implementation Pattern**:
```typescript
// Pattern source: pricing-grid.component.ts (existing structure)
// Pattern source: profile-page.component.ts:201-204 (service injection)

import { PaddleCheckoutService } from '../../../services/paddle-checkout.service';
import { AuthService } from '../../../services/auth.service';
import { environment } from '../../../../environments/environment';

@Component({
  // ... existing decorator config
})
export class PricingGridComponent implements OnInit {
  private readonly router = inject(Router);
  private readonly paddleService = inject(PaddleCheckoutService);
  private readonly authService = inject(AuthService);

  private readonly paddleConfig = environment.paddle;

  // Track which plan is currently loading
  public readonly loadingPlanName = signal<string | null>(null);

  // Expose paddle state for template
  public readonly paddleError = this.paddleService.error;
  public readonly isPaddleReady = this.paddleService.isReady;

  // Updated plans signal - uses environment config
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
      badge: 'plan_badge_early_adopter.png',
    },
  ]);

  public ngOnInit(): void {
    // Initialize Paddle SDK when pricing page loads
    this.paddleService.initialize();
  }

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
   */
  public isPlanLoading(planName: string): boolean {
    return this.loadingPlanName() === planName && this.paddleService.isLoading();
  }

  /**
   * Check if price ID is a placeholder that needs replacement
   */
  private isPriceIdPlaceholder(priceId: string): boolean {
    return priceId.includes('REPLACE') ||
           priceId.includes('xxxxxxxxx') ||
           priceId.includes('yyyyyyyyy');
  }

  public retryPaddleInit(): void {
    this.paddleService.retryInitialization();
  }
}
```

**Template Updates** (add error display):
```html
<!-- Add at top of template, after opening div -->
@if (paddleError()) {
  <div class="alert alert-warning mb-8 max-w-xl mx-auto">
    <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
    <span>{{ paddleError() }}</span>
    <button class="btn btn-sm btn-secondary" (click)="retryPaddleInit()">Retry</button>
  </div>
}
```

**Quality Requirements**:
- Functional: Price IDs sourced from environment config
- Functional: Checkout opens with correct price ID
- Functional: Per-plan loading state tracked
- Functional: Error state displayed with retry option
- Non-Functional: No hardcoded price IDs in component

**Files Affected**:
- `d:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\pricing\components\pricing-grid.component.ts` (MODIFY)

---

### Component 4: Plan Card Component Enhancement

**Purpose**: Add loading states and disabled button handling for checkout flow

**Pattern**: Input/Output component with conditional rendering
**Evidence**: `plan-card.component.ts:1-115`

**Responsibilities**:
1. Accept `isLoading` input for button state
2. Display spinner during checkout loading
3. Disable button when loading or price ID invalid
4. Add ARIA attributes for accessibility
5. Visual feedback for disabled state

**Dependencies** (verified):
- `@angular/core` - input, output
- `../models/pricing-plan.interface.ts` - PricingPlan

**Current Implementation** (needs update):
```typescript
// plan-card.component.ts:92-101
<button
  class="btn w-full transition-all duration-300"
  [class.btn-secondary]="plan().highlight"
  [class.btn-outline]="!plan().highlight"
  [disabled]="plan().ctaAction === 'checkout' && !plan().priceId"
>
  {{ plan().ctaText }}
</button>
```

**Updated Implementation Pattern**:
```typescript
// Pattern source: plan-card.component.ts (existing structure)
// Enhanced per requirements: task-description.md:229-259

export class PlanCardComponent {
  public readonly plan = input.required<PricingPlan>();
  public readonly isLoading = input<boolean>(false); // NEW: Loading state input
  public readonly ctaClick = output<PricingPlan>();

  /**
   * Computed: Button should be disabled if:
   * - Checkout action with no price ID
   * - Currently loading
   * - Price ID is placeholder
   */
  protected isButtonDisabled(): boolean {
    const p = this.plan();
    if (this.isLoading()) return true;
    if (p.ctaAction !== 'checkout') return false;
    if (!p.priceId) return true;
    // Check for placeholder patterns
    if (p.priceId.includes('REPLACE') ||
        p.priceId.includes('xxxxxxxxx') ||
        p.priceId.includes('yyyyyyyyy')) {
      return true;
    }
    return false;
  }
}
```

**Template Updates**:
```html
<!-- CTA Button - Enhanced with loading state -->
<button
  class="btn w-full transition-all duration-300"
  [class.btn-secondary]="plan().highlight"
  [class.btn-outline]="!plan().highlight"
  [class.btn-disabled]="isButtonDisabled()"
  [disabled]="isButtonDisabled()"
  [attr.aria-busy]="isLoading()"
  [attr.aria-disabled]="isButtonDisabled()"
  (click)="!isButtonDisabled() && ctaClick.emit(plan())"
>
  @if (isLoading()) {
    <span class="loading loading-spinner loading-sm"></span>
    <span>Processing...</span>
  } @else {
    {{ plan().ctaText }}
  }
</button>

<!-- Tooltip for disabled state (when not loading) -->
@if (isButtonDisabled() && !isLoading() && plan().ctaAction === 'checkout') {
  <div class="text-center text-xs text-base-content/50 mt-2">
    Checkout temporarily unavailable
  </div>
}
```

**Quality Requirements**:
- Functional: Loading spinner displayed during checkout
- Functional: Button disabled when loading or invalid price ID
- Functional: "Processing..." text during loading
- Non-Functional: ARIA attributes for screen readers
- Non-Functional: Focus returns to button after checkout closes

**Files Affected**:
- `d:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\pricing\components\plan-card.component.ts` (MODIFY)

---

### Component 5: Pricing Plan Interface Update

**Purpose**: Add optional `isCheckoutLoading` field for per-plan loading state tracking

**Pattern**: TypeScript interface extension
**Evidence**: `pricing-plan.interface.ts:1-42`

**Responsibilities**:
1. Add `isCheckoutLoading` optional field
2. Maintain backward compatibility

**Implementation Pattern**:
```typescript
// pricing-plan.interface.ts - Add new field
export interface PricingPlan {
  // ... existing fields (lines 10-41) ...

  /** Whether checkout is loading for this specific plan (runtime state) */
  isCheckoutLoading?: boolean;
}
```

**Note**: After investigation, the loading state is better tracked in the parent component (`loadingPlanName` signal) rather than in the interface, as it's runtime state not configuration. This keeps the interface clean for plan configuration only.

**Decision**: NO CHANGE to interface. Loading state tracked via `loadingPlanName` signal in `pricing-grid.component.ts`.

**Files Affected**:
- None (loading state tracked in component, not interface)

---

## Integration Architecture

### Integration Points

| Integration | How Components Connect | Pattern | Evidence |
|-------------|------------------------|---------|----------|
| PaddleCheckoutService -> Paddle.js | Dynamic script injection | Script loading pattern | Standard browser API |
| pricing-grid -> PaddleCheckoutService | Angular DI injection | `inject()` function | `auth.service.ts:30` |
| pricing-grid -> AuthService | Angular DI injection | `inject()` function | `profile-page.component.ts:203` |
| plan-card -> pricing-grid | Input/Output binding | `input()`, `output()` | `plan-card.component.ts:113-114` |
| Environment -> Components | Direct import | Module import | `api.interceptor.ts:2` |

### Data Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                        USER INTERACTION                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  1. User visits /pricing                                            │
│     │                                                                │
│     v                                                                │
│  2. pricing-grid.ngOnInit()                                         │
│     │                                                                │
│     v                                                                │
│  3. paddleService.initialize()                                      │
│     │                                                                │
│     v                                                                │
│  4. Paddle.js loads from CDN                                        │
│     │                                                                │
│     v                                                                │
│  5. paddleService.isReady = true                                    │
│                                                                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  6. User clicks "Subscribe Monthly" on plan-card                    │
│     │                                                                │
│     v                                                                │
│  7. plan-card emits ctaClick(plan)                                  │
│     │                                                                │
│     v                                                                │
│  8. pricing-grid.handleCtaClick(plan)                               │
│     │                                                                │
│     ├──> Sets loadingPlanName = plan.name                           │
│     │                                                                │
│     v                                                                │
│  9. authService.getCurrentUser() → get email                        │
│     │                                                                │
│     v                                                                │
│ 10. paddleService.openCheckout({ priceId, email })                  │
│     │                                                                │
│     v                                                                │
│ 11. Paddle.Checkout.open() → overlay appears                        │
│                                                                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│ 12a. CHECKOUT SUCCESS:                                              │
│      │                                                               │
│      v                                                               │
│      Paddle event: 'checkout.completed'                             │
│      │                                                               │
│      v                                                               │
│      paddleService → router.navigate(['/profile'])                  │
│      │                                                               │
│      v                                                               │
│      Backend: Paddle webhook → license created → email sent         │
│                                                                      │
│ 12b. CHECKOUT CANCELED:                                             │
│      │                                                               │
│      v                                                               │
│      Paddle event: 'checkout.closed'                                │
│      │                                                               │
│      v                                                               │
│      paddleService.isLoading = false                                │
│      │                                                               │
│      v                                                               │
│      User stays on /pricing (no action needed)                      │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Dependencies

**External Dependencies**:
| Dependency | Type | Risk Level | Notes |
|------------|------|------------|-------|
| Paddle.js SDK | CDN Script | Low | Official Paddle CDN, high availability |
| Paddle API | External Service | Low | Handles all payment processing |

**Internal Dependencies**:
| Dependency | Type | Notes |
|------------|------|-------|
| AuthService | Service | For customer email pre-fill |
| Router | Angular | For navigation on success |
| Environment | Config | For Paddle configuration |

---

## Quality Requirements (Architecture-Level)

### Functional Requirements

1. **SDK Loading**: Paddle.js loads successfully from CDN within 3 retry attempts
2. **Checkout Initiation**: Clicking subscribe button opens Paddle overlay with correct price ID
3. **Email Pre-fill**: Authenticated user's email is pre-filled in checkout
4. **Success Handling**: Successful checkout redirects to `/profile`
5. **Cancel Handling**: Canceled checkout closes overlay, user stays on page
6. **Error Display**: SDK failures show user-friendly message with retry option

### Non-Functional Requirements

**Performance**:
- Paddle.js loads async, doesn't block page render
- Checkout overlay appears within 500ms of button click
- Service adds < 5KB to main bundle (SDK loaded separately)

**Security**:
- No API keys or secrets in frontend code
- Paddle handles all payment data (PCI compliance)
- All SDK requests over HTTPS
- Price IDs validated before checkout

**Reliability**:
- 3 retry attempts with exponential backoff for SDK loading
- Graceful degradation: pricing page works without Paddle (disabled buttons)
- Error states clearly communicated to user

**Accessibility**:
- Loading states have `aria-busy` attribute
- Disabled buttons have `aria-disabled` attribute
- Focus management after checkout closes

### Pattern Compliance

All implementations must follow patterns verified from codebase:

| Pattern | Verified At | Must Follow |
|---------|-------------|-------------|
| Service with `providedIn: 'root'` | `auth.service.ts:28` | Yes |
| Signal state in services | `profile-page.component.ts:207` | Yes |
| `inject()` for DI | `auth.service.ts:30` | Yes |
| Environment config import | `api.interceptor.ts:2` | Yes |
| OnPush change detection | `plan-card.component.ts:24` | Yes |
| DaisyUI button classes | `plan-card.component.ts:93-95` | Yes |

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: frontend-developer

**Rationale**:
- 100% Angular/TypeScript work
- UI component modifications
- Browser API integration (script loading)
- No backend changes required

### Complexity Assessment

**Complexity**: MEDIUM
**Estimated Effort**: 4-6 hours

**Breakdown**:
| Task | Effort |
|------|--------|
| Environment config update | 0.5h |
| PaddleCheckoutService | 2h |
| pricing-grid updates | 1.5h |
| plan-card enhancements | 1h |
| Testing & debugging | 1h |

### Files Affected Summary

**CREATE**:
- `d:\projects\ptah-extension\apps\ptah-landing-page\src\app\services\paddle-checkout.service.ts`

**MODIFY**:
- `d:\projects\ptah-extension\apps\ptah-landing-page\src\environments\environment.ts`
- `d:\projects\ptah-extension\apps\ptah-landing-page\src\environments\environment.production.ts`
- `d:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\pricing\components\pricing-grid.component.ts`
- `d:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\pricing\components\plan-card.component.ts`

### Critical Verification Points

**Before Implementation, Developer Must Verify**:

1. **All imports exist in codebase**:
   - `signal`, `computed`, `inject` from `@angular/core`
   - `Router` from `@angular/router`
   - `environment` from `../../environments/environment`
   - `AuthService` from `./auth.service.ts`

2. **All patterns verified from examples**:
   - Service pattern: `auth.service.ts:28-58`
   - Signal pattern: `profile-page.component.ts:207-209`
   - Input/Output pattern: `plan-card.component.ts:113-114`

3. **Paddle.js API verified**:
   - `Paddle.Initialize()` - SDK initialization
   - `Paddle.Checkout.open()` - Opens overlay
   - `Paddle.Checkout.close()` - Closes overlay
   - Event names: `checkout.completed`, `checkout.closed`

4. **No hallucinated APIs**:
   - All Angular APIs verified from Angular 20 documentation
   - All Paddle APIs verified from Paddle.js v2 documentation

### Architecture Delivery Checklist

- [x] All components specified with evidence
- [x] All patterns verified from codebase
- [x] All imports/decorators verified as existing
- [x] Quality requirements defined
- [x] Integration points documented
- [x] Files affected list complete
- [x] Developer type recommended (frontend-developer)
- [x] Complexity assessed (MEDIUM, 4-6 hours)
- [x] No step-by-step implementation (that's team-leader's job)

---

## Testing Strategy

### Unit Testing

| Component | Test Focus |
|-----------|------------|
| PaddleCheckoutService | Script loading, state transitions, error handling |
| pricing-grid | CTA click handling, loading state, error display |
| plan-card | Button disabled states, loading display |

### Integration Testing

| Flow | Steps |
|------|-------|
| Checkout Happy Path | Click subscribe -> Paddle loads -> Overlay opens -> Complete -> Redirect |
| Checkout Cancel | Click subscribe -> Overlay opens -> Close -> Stay on page |
| SDK Failure | Block CDN -> Error displayed -> Retry works |

### E2E Testing (Sandbox)

| Scenario | Test Card | Expected |
|----------|-----------|----------|
| Successful payment | 4242 4242 4242 4242 | Redirect to /profile |
| Card declined | 4000 0000 0000 0002 | Error in overlay |
| Cancel checkout | N/A | Stay on /pricing |

---

## Security Checklist

- [x] No API keys in frontend code (only price IDs)
- [x] No webhook secrets exposed
- [x] All external scripts loaded via HTTPS
- [x] Payment data never touches our servers (Paddle PCI compliance)
- [x] Price IDs validated before checkout (placeholder detection)
- [x] Environment-based configuration (sandbox vs production)

---

## References

- **Paddle.js v2 Documentation**: https://developer.paddle.com/paddlejs/overview
- **Paddle Checkout Events**: https://developer.paddle.com/paddlejs/events
- **Paddle Sandbox Testing**: https://developer.paddle.com/getting-started/sandbox
- **Internal Setup Guide**: `docs/PADDLE_SETUP_SIMPLIFIED.md`
- **Backend Webhook Handler**: `apps/ptah-license-server/src/paddle/paddle.service.ts`
