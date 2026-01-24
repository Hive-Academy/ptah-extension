# Development Tasks - TASK_2025_114

**Total Tasks**: 7 | **Batches**: 3 | **Status**: 3/3 complete

---

## Plan Validation Summary

**Validation Status**: PASSED

### Assumptions Verified

- [AuthService.getCurrentUser()]: Verified - Returns Observable<AuthUser | null> with email field (auth.service.ts:47-48)
- [Environment config structure]: Verified - paddle config exists with environment and price ID fields (environment.ts:23-27)
- [Component patterns]: Verified - Uses signal(), input(), output(), OnPush change detection (pricing-grid.component.ts, plan-card.component.ts)
- [Service patterns]: Verified - Uses inject(), providedIn: 'root', HttpClient (auth.service.ts:28-30)

### Risks Identified

| Risk | Severity | Mitigation |
|------|----------|------------|
| Environment config uses old naming (priceIdEarlyAdopter/priceIdPro) | LOW | Task 1.1 updates to priceIdMonthly/priceIdYearly before service creation |
| Placeholder price IDs in production could cause checkout failures | MEDIUM | Placeholder detection logic added to pricing-grid and plan-card |
| Paddle SDK load failure blocks checkout | LOW | Retry logic with exponential backoff (3 attempts) + graceful degradation |

### Edge Cases to Handle

- [x] SDK load timeout/failure -> Handled in Task 1.2 with retry logic
- [x] Unauthenticated user checkout -> Handled in Task 2.1 (proceed without email pre-fill)
- [x] Placeholder price ID detection -> Handled in Task 2.2 (isPriceIdPlaceholder check)
- [x] Per-plan loading state -> Handled in Task 2.2 (loadingPlanName signal)

---

## Batch 1: Foundation - Service and Configuration [COMPLETE]

**Developer**: frontend-developer
**Tasks**: 2 | **Dependencies**: None
**Commit**: af3ff8d

### Task 1.1: Update Environment Configuration for New Pricing Model [COMPLETE]

**File**: d:\projects\ptah-extension\apps\ptah-landing-page\src\environments\environment.ts (MODIFY)
**File**: d:\projects\ptah-extension\apps\ptah-landing-page\src\environments\environment.production.ts (MODIFY)
**Spec Reference**: implementation-plan.md:163-207
**Pattern to Follow**: environment.ts:23-27 (existing paddle config structure)

**Quality Requirements**:
- Rename `priceIdEarlyAdopter` to `priceIdMonthly`
- Rename `priceIdPro` to `priceIdYearly`
- Add documentation comments explaining each field
- Development: Use sandbox environment with placeholder price IDs
- Production: Use production environment with REPLACE markers

**Implementation Details**:
- Keep `as const` for environment literal type safety
- Preserve existing `apiBaseUrl` field
- Add TODO comments for price ID replacement
- Ensure consistent structure between dev and prod files

---

### Task 1.2: Create PaddleCheckoutService [COMPLETE]

**File**: d:\projects\ptah-extension\apps\ptah-landing-page\src\app\services\paddle-checkout.service.ts (CREATE)
**Spec Reference**: implementation-plan.md:211-465
**Pattern to Follow**: auth.service.ts:28-58 (service structure), profile-page.component.ts:207-209 (signal state)

**Quality Requirements**:
- Injectable service with providedIn: 'root'
- Signal-based reactive state (isReady, isLoading, error)
- Dynamic Paddle.js script loading from CDN
- initialize() method for SDK initialization
- openCheckout() method accepting CheckoutOptions
- closeCheckout() method for programmatic close
- Retry logic with exponential backoff (3 attempts max)
- Paddle event callbacks for checkout.completed, checkout.closed
- Router navigation to /profile on success
- TypeScript interfaces for Paddle.js API (PaddleInitOptions, PaddleCheckoutOptions, PaddleEvent)

**Implementation Details**:
- Imports: Injectable, signal, inject, computed from @angular/core
- Imports: Router from @angular/router
- Imports: environment from ../../environments/environment
- CDN URL: https://cdn.paddle.com/paddle/v2/paddle.js
- Global Window interface extension for Paddle
- canCheckout computed signal for UX

---

**Batch 1 Verification**:
- Both environment files updated with new naming
- PaddleCheckoutService created with full implementation
- Build passes: `npx nx build ptah-landing-page`
- code-logic-reviewer approved
- No TODO placeholders in service code (only in environment config)

---

## Batch 2: Component Integration [COMPLETE]

**Developer**: frontend-developer
**Tasks**: 2 | **Dependencies**: Batch 1 complete
**Commit**: 5906912

### Task 2.1: Update Pricing Grid Component with Paddle Integration [COMPLETE]

**File**: d:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\pricing\components\pricing-grid.component.ts (MODIFY)
**Spec Reference**: implementation-plan.md:481-670
**Pattern to Follow**: pricing-grid.component.ts:52-54 (existing inject pattern)

**Quality Requirements**:
- Inject PaddleCheckoutService and AuthService
- Initialize Paddle SDK in ngOnInit lifecycle
- Source price IDs from environment.paddle config (not hardcoded)
- Track per-plan loading state with loadingPlanName signal
- Expose paddleError and isPaddleReady for template
- Handle checkout click with email pre-fill from AuthService
- Add isPriceIdPlaceholder() validation method
- Add retryPaddleInit() method for error recovery

**Implementation Details**:
- Imports: PaddleCheckoutService from ../../../services/paddle-checkout.service
- Imports: AuthService from ../../../services/auth.service
- Imports: environment from ../../../../environments/environment
- Imports: OnInit from @angular/core
- Update plans signal to use environment.paddle.priceIdMonthly and priceIdYearly
- Subscribe to authService.getCurrentUser() for email in handleCtaClick
- Add error alert with retry button in template

---

### Task 2.2: Enhance Plan Card Component with Loading States [COMPLETE]

**File**: d:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\pricing\components\plan-card.component.ts (MODIFY)
**Spec Reference**: implementation-plan.md:686-785
**Pattern to Follow**: plan-card.component.ts:112-114 (existing input/output pattern)

**Quality Requirements**:
- Add isLoading input for button state
- Display DaisyUI loading spinner during checkout
- Disable button when loading or price ID invalid/placeholder
- Add ARIA attributes (aria-busy, aria-disabled)
- Show "Processing..." text during loading
- Add tooltip for disabled state explanation
- Prevent click propagation when disabled

**Implementation Details**:
- Imports: input from @angular/core (already present)
- Add isLoading input with default false
- Add isButtonDisabled() method checking loading state and placeholder patterns
- Update button template with conditional spinner and text
- Add class.btn-disabled binding
- Placeholder patterns to detect: 'REPLACE', 'xxxxxxxxx', 'yyyyyyyyy', 'REPLACE_ME'

---

**Batch 2 Verification**:
- pricing-grid.component.ts uses environment config for price IDs
- plan-card.component.ts shows loading states correctly
- Template error display works with retry
- No hardcoded price IDs remain in components
- Build passes: `npx nx build ptah-landing-page`
- code-logic-reviewer approved

---

## Batch 3: Template Updates and Polish [COMPLETE]

**Developer**: frontend-developer
**Tasks**: 3 | **Dependencies**: Batch 2 complete
**Note**: All tasks completed in Batch 2 (verification only - no git commit needed)

### Task 3.1: Update Pricing Grid Template with Error Handling [COMPLETE]

**File**: d:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\pricing\components\pricing-grid.component.ts (MODIFY - template)
**Spec Reference**: implementation-plan.md:656-669
**Pattern to Follow**: DaisyUI alert component pattern

**Quality Requirements**:
- Add error alert at top of template when paddleError() is truthy
- Include warning icon SVG
- Display error message from paddleError()
- Add "Retry" button calling retryPaddleInit()
- Use DaisyUI alert alert-warning classes
- Center alert with max-w-xl mx-auto

**Implementation Details**:
- Add @if (paddleError()) block at template start
- Use DaisyUI alert alert-warning mb-8 classes
- Warning SVG icon from DaisyUI docs
- Button with btn btn-sm btn-secondary

---

### Task 3.2: Pass Loading State to Plan Card [COMPLETE]

**File**: d:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\pricing\components\pricing-grid.component.ts (MODIFY - template)
**Spec Reference**: implementation-plan.md:637-640
**Pattern to Follow**: pricing-grid.component.ts:38 (existing input binding)

**Quality Requirements**:
- Bind isLoading input on ptah-plan-card
- Calculate per-plan loading state using loadingPlanName and paddleService.isLoading
- Add isPlanLoading(planName) method if not already present

**Implementation Details**:
- Update template: [isLoading]="isPlanLoading(plan.name)"
- Ensure isPlanLoading() method exists from Task 2.1

---

### Task 3.3: Final Validation and Cleanup [COMPLETE]

**File**: d:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\pricing\components\pricing-grid.component.ts (MODIFY)
**File**: d:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\pricing\components\plan-card.component.ts (MODIFY)
**Spec Reference**: implementation-plan.md:951-961

**Quality Requirements**:
- Remove all TODO comments related to Paddle integration (except price ID placeholders in env)
- Remove console.log statements (except the one in paddle service for debugging)
- Ensure all imports are used
- Verify OnPush change detection preserved
- Verify no circular dependencies
- Final lint check passes

**Implementation Details**:
- Remove lines 136-145 (commented out future implementation) in pricing-grid.component.ts
- Remove line 137 console.log in pricing-grid.component.ts (replaced by real implementation)
- Ensure template animations still work (ViewportAnimationDirective)

---

**Batch 3 Verification**:
- Error handling visible in template (lines 39-47 pricing-grid.component.ts)
- Loading states pass to plan cards correctly (line 53 pricing-grid.component.ts)
- All TODO comments for Paddle integration removed (except env file placeholders)
- All console.log debugging removed from components
- Build passes: `npx nx build ptah-landing-page`
- Lint passes: `npx nx lint ptah-landing-page`
- Verified by team-leader: All tasks completed in Batch 2

---

## Status Icons Reference

| Status | Meaning | Who Sets |
|--------|---------|----------|
| [PENDING] | Not started | team-leader (initial) |
| [IN PROGRESS] | Assigned to developer | team-leader |
| [IMPLEMENTED] | Developer done, awaiting verify | developer |
| [COMPLETE] | Verified and committed | team-leader |
| [FAILED] | Verification failed | team-leader |

---

## Files Summary

**CREATE**:
- d:\projects\ptah-extension\apps\ptah-landing-page\src\app\services\paddle-checkout.service.ts

**MODIFY**:
- d:\projects\ptah-extension\apps\ptah-landing-page\src\environments\environment.ts
- d:\projects\ptah-extension\apps\ptah-landing-page\src\environments\environment.production.ts
- d:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\pricing\components\pricing-grid.component.ts
- d:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\pricing\components\plan-card.component.ts
