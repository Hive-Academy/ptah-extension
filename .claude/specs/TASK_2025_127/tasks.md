# Development Tasks - TASK_2025_127

**Total Tasks**: 5 | **Batches**: 3 | **Status**: COMPLETE

**Final Commit**: c2761b2 - feat(pricing): add subscription-aware pricing with QA fixes (TASK_2025_127)

---

## Plan Validation Summary

**Validation Status**: PASSED

### Assumptions Verified

- [LicenseData interface]: Verified at `license-data.interface.ts:42-75`
- [AuthService.isAuthenticated()]: Verified Observable-based at `auth.service.ts:52-59`
- [Signal-based service pattern]: Verified at `paddle-checkout.service.ts:76-96`
- [Input/output signals]: Verified at `basic-plan-card.component.ts:183-192`
- [Portal session endpoint]: Verified at `paddle-checkout.service.ts:222-227`

### Risks Identified

| Risk                                           | Severity | Mitigation                               |
| ---------------------------------------------- | -------- | ---------------------------------------- |
| SubscriptionInfo.status is generic string type | LOW      | Use type assertion with null checks      |
| Race condition between auth check and API call | LOW      | Sequential observable chain handles this |

### Edge Cases to Handle

- [x] Unauthenticated user -> Show default trial badges and CTAs
- [x] Authenticated but no subscription -> Show trial CTAs
- [x] Active Basic subscriber -> Show "Current Plan" on Basic, "Upgrade" on Pro
- [x] Active Pro subscriber -> Show "Current Plan" on Pro, "Included" on Basic
- [x] Trial user -> Show "Trial - X days left" badge with "Upgrade Now"
- [x] Canceled subscription -> Show "Ends [date]" with "Reactivate"
- [x] Past due subscription -> Show "Payment Issue" with "Update Payment"
- [x] API failure -> Gracefully fall back to generic view

---

## Batch 1: Foundation (Service + Types) - COMPLETE

**Developer**: frontend-developer
**Tasks**: 2 | **Dependencies**: None
**Status**: COMPLETE
**Commit**: 45c9cea

### Task 1.1: Create SubscriptionStateService

- **Status**: COMPLETE
- **Developer**: frontend-developer
- **File**: `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\services\subscription-state.service.ts` (CREATE)
- **Dependencies**: None

**Description**:
Create a new signal-based service to fetch and cache subscription state for the pricing page. This service centralizes subscription state management and provides computed helpers for UI logic.

**Pattern to Follow**: `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\services\paddle-checkout.service.ts:76-96`

**Quality Requirements**:

- Use signal-based state pattern matching PaddleCheckoutService
- Private writable signals + public readonly accessors
- Check authentication before making API call
- Handle loading, error, and success states
- Provide computed signals for: currentPlanTier, isOnTrial, trialDaysRemaining, subscriptionStatus, hasActiveSubscription, isCanceled, isPastDue
- Include reset() and refresh() methods

**Implementation Details**:

- Imports: `Injectable, signal, computed, inject` from `@angular/core`
- Imports: `HttpClient` from `@angular/common/http`
- Imports: `LicenseData` from `../pages/profile/models/license-data.interface`
- Imports: `AuthService` from `./auth.service`
- Decorator: `@Injectable({ providedIn: 'root' })`
- API endpoint: `GET /api/v1/licenses/me`

**Acceptance Criteria**:

- [ ] Service injectable at root level
- [ ] Fetches license data only when authenticated
- [ ] Caches data with `_isFetched` flag to prevent duplicate calls
- [ ] Normalizes plan types (trial_basic -> basic, trial_pro -> pro)
- [ ] Computed signal `currentPlanTier` returns 'basic' | 'pro' | null
- [ ] Computed signal `isOnTrial` correctly identifies trial plans
- [ ] Error handling logs to console and sets user-friendly error message
- [ ] No TypeScript errors, follows existing service patterns

---

### Task 1.2: Add Subscription Context Types to PricingPlan Interface

- **Status**: COMPLETE
- **Developer**: frontend-developer
- **File**: `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\pricing\models\pricing-plan.interface.ts` (MODIFY)
- **Dependencies**: None (can be done in parallel with Task 1.1)

**Description**:
Extend the pricing-plan.interface.ts with new types for subscription context, CTA variants, and badge variants. These types provide type-safe interfaces for plan card subscription state.

**Pattern to Follow**: Existing `PricingPlan` interface structure at lines 9-51

**Quality Requirements**:

- Add `PlanSubscriptionContext` interface for subscription state
- Add `PlanCtaVariant` type union for CTA button states
- Add `PlanBadgeVariant` type union for badge states
- All types exported for use in components

**Implementation Details**:

- Add after existing PricingPlan interface (line 52+)
- PlanSubscriptionContext properties: isAuthenticated, currentPlanTier, isOnTrial, trialDaysRemaining, subscriptionStatus, periodEndDate
- PlanCtaVariant values: 'start-trial', 'current-plan', 'upgrade', 'downgrade', 'upgrade-now', 'reactivate', 'update-payment', 'included'
- PlanBadgeVariant values: 'trial', 'current', 'trial-active', 'trial-ending', 'canceling', 'past-due', 'popular', 'included'

**Acceptance Criteria**:

- [ ] PlanSubscriptionContext interface exported with all required properties
- [ ] PlanCtaVariant type union exported with all variant values
- [ ] PlanBadgeVariant type union exported with all variant values
- [ ] Proper JSDoc comments on each type
- [ ] No TypeScript errors in existing code

---

**Batch 1 Verification**:

- [x] Both files exist at specified paths
- [x] Build passes: `npx nx build ptah-landing-page`
- [x] TypeScript compilation passes
- [x] Types properly exported and usable

---

## Batch 2: Container Component Integration - COMPLETE

**Developer**: frontend-developer
**Tasks**: 1 | **Dependencies**: Batch 1 (COMPLETE)
**Status**: COMPLETE
**Commit**: fe1fa40

### Task 2.1: Update PricingGridComponent with Subscription State

- **Status**: COMPLETE
- **Developer**: frontend-developer
- **File**: `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\pricing\components\pricing-grid.component.ts` (MODIFY)
- **Dependencies**: Task 1.1, Task 1.2

**Description**:
Integrate SubscriptionStateService into PricingGridComponent. Add computed subscription context, pass to child components, and implement manage subscription handler.

**Pattern to Follow**:

- Service injection: `pricing-grid.component.ts:167-171`
- Computed signals: `paddle-checkout.service.ts:98-101`

**Quality Requirements**:

- Inject SubscriptionStateService
- Call fetchSubscriptionState() in ngOnInit
- Create computed subscriptionContext from service signals
- Expose isLoadingSubscription for template
- Add handleManageSubscription() method for portal navigation
- Update template to pass context to plan cards
- Add manageSubscription output handler

**Implementation Details**:

- Import: `SubscriptionStateService` from `../../../services/subscription-state.service`
- Import: `PlanSubscriptionContext` from `../models/pricing-plan.interface`
- Import: `HttpClient` from `@angular/common/http` (for portal session)
- Add to ngOnInit: `this.subscriptionService.fetchSubscriptionState()`
- Computed subscriptionContext builds PlanSubscriptionContext from service signals
- handleManageSubscription calls POST /api/v1/subscriptions/portal-session
- Template updates: add [subscriptionContext], [isLoadingContext], (manageSubscription) to both plan cards

**Acceptance Criteria**:

- [ ] SubscriptionStateService injected and initialized in ngOnInit
- [ ] Computed subscriptionContext signal created with correct type
- [ ] isLoadingSubscription signal exposed for template
- [ ] handleManageSubscription opens portal in new tab
- [ ] Template passes subscriptionContext to BasicPlanCardComponent
- [ ] Template passes subscriptionContext to ProPlanCardComponent
- [ ] Template binds manageSubscription output events
- [ ] Error handling for portal session API failure
- [ ] No TypeScript errors, build passes

---

**Batch 2 Verification**:

- [x] File modified at specified path
- [x] Build passes: `npx nx build ptah-landing-page`
- [x] code-logic-reviewer approved
- [x] Subscription context flows to child components

---

## Batch 3: Presentational Component Updates - COMPLETE

**Developer**: frontend-developer
**Tasks**: 2 | **Dependencies**: Batch 2 (COMPLETE)
**Status**: COMPLETE
**Commit**: 96a709b

### Task 3.1: Update BasicPlanCardComponent with Subscription Awareness

- **Status**: COMPLETE
- **Developer**: frontend-developer
- **File**: `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\pricing\components\basic-plan-card.component.ts` (MODIFY)
- **Dependencies**: Task 2.1

**Description**:
Add subscription-aware UI to BasicPlanCardComponent. Accept subscription context input, compute badge/CTA variants, update template for conditional rendering, and emit manage subscription events.

**Pattern to Follow**:

- Input/output signals: `basic-plan-card.component.ts:183-192`
- Computed signals: `paddle-checkout.service.ts:98-101`

**Quality Requirements**:

- Add subscriptionContext input signal
- Add isLoadingContext input signal
- Add manageSubscription output
- Create computed signals: isCurrentPlan, isTrialPlan, badgeVariant, ctaVariant, ctaText, isCtaDisabled, cardBorderClass
- Update template with conditional badge rendering (6 variants)
- Update template with conditional CTA styling
- Update handleClick to emit manageSubscription for portal actions

**Implementation Details**:

- Import: `PlanSubscriptionContext, PlanCtaVariant, PlanBadgeVariant` from `../models/pricing-plan.interface`
- Import: `Settings, Crown` from `lucide-angular` (for icons)
- Input: `subscriptionContext = input<PlanSubscriptionContext | null>(null)`
- Input: `isLoadingContext = input<boolean>(false)`
- Output: `manageSubscription = output<void>()`
- Computed isCurrentPlan: ctx.currentPlanTier === 'basic' && !ctx.isOnTrial
- Computed badgeVariant returns: 'current', 'trial-active', 'trial-ending', 'canceling', 'past-due', or 'trial'
- Computed ctaVariant returns: 'current-plan', 'upgrade-now', 'reactivate', 'update-payment', 'included', or 'start-trial'
- Template: 6 badge variants with appropriate colors (success, info, warning, error, gradient)
- Template: CTA button with ngClass for variant-specific styling
- handleClick emits manageSubscription for portal actions, ctaClick for checkout

**Acceptance Criteria**:

- [ ] subscriptionContext input accepts PlanSubscriptionContext | null
- [ ] isLoadingContext input for loading state
- [ ] manageSubscription output emits for portal-bound actions
- [ ] Computed isCurrentPlan returns true for active Basic subscribers
- [ ] Computed badgeVariant returns correct variant for each state
- [ ] Computed ctaVariant returns correct variant for each state
- [ ] Computed ctaText returns appropriate button text
- [ ] "Current Plan" badge shows green/success styling
- [ ] "Trial - X days" badge shows blue/info styling
- [ ] "Trial ends in X days" badge shows amber/warning for <= 3 days
- [ ] "Payment Issue" badge shows red/error styling
- [ ] CTA disabled for "included" variant (Pro subscribers viewing Basic)
- [ ] handleClick routes to manageSubscription or ctaClick appropriately
- [ ] No TypeScript errors, template renders correctly

---

### Task 3.2: Update ProPlanCardComponent with Subscription Awareness

- **Status**: COMPLETE
- **Developer**: frontend-developer
- **File**: `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\pricing\components\pro-plan-card.component.ts` (MODIFY)
- **Dependencies**: Task 2.1

**Description**:
Add subscription-aware UI to ProPlanCardComponent. Same pattern as BasicPlanCardComponent but with Pro-specific logic (no "included" state, "Upgrade to Pro" for Basic subscribers).

**Pattern to Follow**:

- Same as Task 3.1 (BasicPlanCardComponent updates)

**Quality Requirements**:

- Add subscriptionContext input signal
- Add isLoadingContext input signal
- Add manageSubscription output
- Create computed signals: isCurrentPlan, isTrialPlan, badgeVariant, ctaVariant, ctaText, isCtaDisabled, cardBorderClass
- Pro-specific CTA logic: Basic subscribers see "Upgrade to Pro"
- No "included" state (Pro is highest tier)
- Update template with conditional badge rendering
- Update template with conditional CTA styling

**Implementation Details**:

- Import: `PlanSubscriptionContext, PlanCtaVariant, PlanBadgeVariant` from `../models/pricing-plan.interface`
- Import: `Settings, Crown` from `lucide-angular` (for icons)
- Input: `subscriptionContext = input<PlanSubscriptionContext | null>(null)`
- Input: `isLoadingContext = input<boolean>(false)`
- Output: `manageSubscription = output<void>()`
- Computed isCurrentPlan: ctx.currentPlanTier === 'pro' && !ctx.isOnTrial
- Computed ctaVariant: Basic subscribers get 'upgrade', Pro trial gets 'upgrade-now', active Pro gets 'current-plan'
- ctaText for 'upgrade' variant: "Upgrade to Pro"
- Template: Badge rendering same as BasicPlanCard but for Pro
- Template: CTA button styling matches Pro theme (amber/gradient)

**Acceptance Criteria**:

- [ ] subscriptionContext input accepts PlanSubscriptionContext | null
- [ ] isLoadingContext input for loading state
- [ ] manageSubscription output emits for portal-bound actions
- [ ] Computed isCurrentPlan returns true for active Pro subscribers
- [ ] Basic subscribers see "Upgrade to Pro" CTA
- [ ] Pro trial users see "Upgrade Now" CTA
- [ ] Active Pro subscribers see "Manage Subscription" CTA
- [ ] "Current Plan" badge shows success styling on Pro card
- [ ] Canceled Pro shows "Ends [date]" with "Reactivate"
- [ ] Past due Pro shows "Payment Issue" with "Update Payment"
- [ ] CTA is NEVER disabled on Pro card (no "included" state)
- [ ] handleClick routes correctly based on ctaVariant
- [ ] No TypeScript errors, template renders correctly

---

**Batch 3 Verification**:

- [x] Both files modified at specified paths
- [x] Build passes: `npx nx build ptah-landing-page`
- [x] code-logic-reviewer approved
- [x] All subscription states render correctly
- [x] Visual styling matches design requirements

---

## Files Summary

### CREATE (1 file):

- `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\services\subscription-state.service.ts`

### MODIFY (4 files):

- `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\pricing\models\pricing-plan.interface.ts`
- `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\pricing\components\pricing-grid.component.ts`
- `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\pricing\components\basic-plan-card.component.ts`
- `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\pricing\components\pro-plan-card.component.ts`

---

## References

- **Implementation Plan**: `D:\projects\ptah-extension\task-tracking\TASK_2025_127\implementation-plan.md`
- **Task Description**: `D:\projects\ptah-extension\task-tracking\TASK_2025_127\task-description.md`
- **Signal Pattern Reference**: `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\services\paddle-checkout.service.ts:76-96`
- **License Data Interface**: `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\profile\models\license-data.interface.ts:42-75`
- **Auth Service Pattern**: `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\services\auth.service.ts:52-59`
