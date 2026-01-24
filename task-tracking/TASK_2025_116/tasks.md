# Development Tasks - TASK_2025_116

**Total Tasks**: 15 | **Batches**: 4 | **Status**: 0/4 complete

---

## Plan Validation Summary

**Validation Status**: PASSED

### Assumptions Verified

- [Backend License API]: GET /api/v1/licenses/me exists and returns license status - VERIFIED
- [Auth Service Email]: getCurrentUser() returns AuthUser with email field - VERIFIED
- [Paddle Events]: checkout.completed, checkout.closed, checkout.error events available - VERIFIED
- [Signal Pattern]: Service already uses Angular signals correctly - VERIFIED

### Risks Identified

| Risk | Severity | Mitigation |
|------|----------|------------|
| License verification timing - webhook may not process immediately | MEDIUM | Add retry/polling in Task 1.1 |
| Auth error loses email context | LOW | Log warning in Task 2.3 |

### Edge Cases to Handle

- [ ] Checkout timeout after 5 minutes of inactivity -> Handled in Task 2.2
- [ ] Concurrent SDK initialization calls -> Handled in Task 3.1
- [ ] Multiple rapid CTA clicks -> Handled in Task 2.1
- [ ] Environment config missing price IDs -> Handled in Task 3.2

---

## Batch 1: Critical P0 Fixes (Backend Verification + Error Handling) - IMPLEMENTED

**Developer**: frontend-developer
**Tasks**: 3 | **Dependencies**: None
**Priority**: CRITICAL - These are P0 issues that must be fixed first
**Status**: IMPLEMENTED

### Task 1.1: Add Backend License Verification After Checkout - IMPLEMENTED

**File**: d:\projects\ptah-extension\apps\ptah-landing-page\src\app\services\paddle-checkout.service.ts
**Issue Reference**: Issue 1 - No Backend Verification After Checkout (P0)

**Quality Requirements**:
- Call `/api/v1/licenses/me` after checkout.completed event
- Implement retry logic (3 attempts with 2s delay) for verification
- Only navigate to /profile after successful verification
- Show error if verification fails after retries

**Implementation Details**:
- Inject HttpClient for API calls
- Add private method `verifyLicenseActivation(): Observable<boolean>`
- Modify handlePaddleEvent to call verification before navigation
- Add signal for verification state: `_isVerifying = signal(false)`

**Validation Notes**:
- Backend webhook may take 1-3 seconds to process
- Use retry with delay to handle race condition

---

### Task 1.2: Fix Loading State Stuck Forever - IMPLEMENTED

**File**: d:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\pricing\components\pricing-grid.component.ts
**Issue Reference**: Issue 2 - Loading State Can Stick Forever (P0)

**Quality Requirements**:
- Add timeout (30 seconds) for checkout loading state
- Add finally block to clear loadingPlanName on all paths
- Reset loading state when Paddle service loading changes to false

**Implementation Details**:
- Use effect() or computed() to sync with paddleService.isLoading
- Add timeout using setTimeout with cleanup
- Clear loadingPlanName in finally block of handleCtaClick

**Validation Notes**:
- Must handle both success and error paths
- Timeout should be user-friendly (not too short, not infinite)

---

### Task 1.3: Show User-Facing Error for Placeholder Price IDs - IMPLEMENTED

**File**: d:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\pricing\components\pricing-grid.component.ts
**Issue Reference**: Issue 3 - Placeholder Detection Fails Silently (P0)

**Quality Requirements**:
- Show user-visible error alert when placeholder price ID detected
- Replace console.warn with proper error state
- Add error signal for configuration issues

**Implementation Details**:
- Add `configError = signal<string | null>(null)`
- Set error message when placeholder detected: "Checkout is not configured yet. Please try again later."
- Display error in template with alert component

**Validation Notes**:
- Error should be dismissible
- Should not block other plans that may have valid IDs

---

**Batch 1 Verification**:
- All files exist at paths
- Build passes: `npx nx build ptah-landing-page`
- code-logic-reviewer approved
- P0 issues resolved

---

## Batch 2: Checkout Flow Protection (Loading State + Duplicate Prevention)

**Developer**: frontend-developer
**Tasks**: 4 | **Dependencies**: Batch 1

### Task 2.1: Prevent Duplicate Subscription Clicks

**File**: d:\projects\ptah-extension\apps\ptah-landing-page\src\app\services\paddle-checkout.service.ts
**Issue Reference**: Issue 7 - No Duplicate Subscription Prevention (P1)

**Quality Requirements**:
- Check if checkout already open before calling openCheckout()
- Add `_isCheckoutOpen = signal(false)` to track state
- Set true when opening, false on close/complete/error events

**Implementation Details**:
- Add `isCheckoutOpen` public readonly signal
- Guard openCheckout() with early return if already open
- Update state in all handlePaddleEvent cases

---

### Task 2.2: Add Checkout Timeout Protection

**File**: d:\projects\ptah-extension\apps\ptah-landing-page\src\app\services\paddle-checkout.service.ts
**Issue Reference**: Issue 8 - No Checkout Timeout (P1)

**Quality Requirements**:
- Set 5-minute timeout when checkout opens
- Reset loading state and close checkout if timeout exceeded
- Clear timeout when checkout closes normally

**Implementation Details**:
- Add private `checkoutTimeoutId: ReturnType<typeof setTimeout> | null`
- Set timeout in openCheckout()
- Clear timeout in handlePaddleEvent for all closing events
- Call closeCheckout() and set error on timeout

---

### Task 2.3: Log Warning for Auth Error Email Loss

**File**: d:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\pricing\components\pricing-grid.component.ts
**Issue Reference**: Issue 11 - Auth Error Loses Email (P1)

**Quality Requirements**:
- Add logging when auth fails and checkout proceeds without email
- Use console.warn (acceptable for now, will be replaced in Batch 3)

**Implementation Details**:
- In error handler of getCurrentUser(), log: "Auth check failed, proceeding without email pre-fill"
- This is acceptable as checkout works without email

**Validation Notes**:
- This is LOW priority - just adds debugging info

---

### Task 2.4: Move Loading State to Service

**File**: d:\projects\ptah-extension\apps\ptah-landing-page\src\app\services\paddle-checkout.service.ts
**File**: d:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\pricing\components\pricing-grid.component.ts
**Issue Reference**: Issue 15 - Scattered Loading State (P1)

**Quality Requirements**:
- Move loadingPlanName signal to PaddleCheckoutService
- Component should only read from service, not manage own loading state
- Ensure reactive updates work correctly

**Implementation Details**:
- Add `_loadingPlanName = signal<string | null>(null)` to service
- Add public `loadingPlanName` readonly signal
- Add `setLoadingPlan(name: string | null)` method
- Update component to use service.loadingPlanName

---

**Batch 2 Verification**:
- All files exist at paths
- Build passes: `npx nx build ptah-landing-page`
- code-logic-reviewer approved
- Duplicate clicks prevented
- Timeout protection working

---

## Batch 3: Infrastructure + Code Quality (DI Tokens + Validation)

**Developer**: frontend-developer
**Tasks**: 5 | **Dependencies**: Batch 2

### Task 3.1: Guard Against Concurrent SDK Initialization

**File**: d:\projects\ptah-extension\apps\ptah-landing-page\src\app\services\paddle-checkout.service.ts
**Issue Reference**: Issue 10 - Concurrent Initialization Race (P1)

**Quality Requirements**:
- Add initialization promise tracking
- Return existing promise if initialization in progress
- Use Promise-based approach for proper async handling

**Implementation Details**:
- Add `private initPromise: Promise<void> | null = null`
- In initialize(), check and return existing promise
- Set promise when starting, clear when complete

---

### Task 3.2: Add Environment Config Validation

**File**: d:\projects\ptah-extension\apps\ptah-landing-page\src\app\services\paddle-checkout.service.ts
**Issue Reference**: Issue 9 - No Environment Validation (P1)

**Quality Requirements**:
- Validate paddle config at initialization
- Check that price IDs are not placeholders
- Set error state if config invalid

**Implementation Details**:
- Add private `validateConfig(): boolean` method
- Check priceIdMonthly and priceIdYearly for placeholders
- Set `_error` signal if validation fails
- Log warning about missing configuration

---

### Task 3.3: Create Paddle DI Configuration Token

**File**: d:\projects\ptah-extension\apps\ptah-landing-page\src\app\config\paddle.config.ts (NEW)
**File**: d:\projects\ptah-extension\apps\ptah-landing-page\src\app\services\paddle-checkout.service.ts
**Issue Reference**: Issue 5 - Direct Environment Imports (P1)

**Quality Requirements**:
- Create PADDLE_CONFIG injection token
- Define PaddleConfig interface
- Provide config in app.config.ts
- Update service to inject token instead of direct import

**Implementation Details**:
- Create new file: paddle.config.ts
- Export interface PaddleConfig { environment, priceIdMonthly, priceIdYearly, maxRetries?, baseRetryDelay? }
- Export PADDLE_CONFIG = new InjectionToken<PaddleConfig>('PADDLE_CONFIG')
- Export providePaddleConfig() function
- Update service constructor to inject PADDLE_CONFIG

---

### Task 3.4: Extract Retry Logic to Reusable Method

**File**: d:\projects\ptah-extension\apps\ptah-landing-page\src\app\services\paddle-checkout.service.ts
**Issue Reference**: Issue 12 - Inline Retry Logic (P1)

**Quality Requirements**:
- Extract retry logic to private retryWithBackoff() method
- Make maxRetries and baseDelay configurable via PADDLE_CONFIG
- Improve testability

**Implementation Details**:
- Add private `retryWithBackoff<T>(fn: () => Promise<T>, maxRetries: number, baseDelay: number): Promise<T>`
- Use exponential backoff formula: delay = baseDelay * 2^attempt
- Replace inline retry in loadScript() with method call

---

### Task 3.5: Add Paddle SDK Type Guard

**File**: d:\projects\ptah-extension\apps\ptah-landing-page\src\app\services\paddle-checkout.service.ts
**Issue Reference**: Issue 14 - Paddle Type Cast (P1)

**Quality Requirements**:
- Create isPaddleSDK() type guard function
- Validate that window.Paddle has expected methods
- Replace unsafe type cast with guarded check

**Implementation Details**:
- Add private `isPaddleSDK(obj: unknown): obj is typeof window.Paddle`
- Check for Initialize, Checkout.open, Checkout.close methods
- Use in initializePaddle() instead of direct cast

---

**Batch 3 Verification**:
- All files exist at paths
- paddle.config.ts created
- Build passes: `npx nx build ptah-landing-page`
- code-logic-reviewer approved
- DI token working correctly

---

## Batch 4: Shared Utilities + Console Cleanup

**Developer**: frontend-developer
**Tasks**: 3 | **Dependencies**: Batch 3

### Task 4.1: Extract Shared Placeholder Validation Utility

**File**: d:\projects\ptah-extension\apps\ptah-landing-page\src\app\utils\paddle-validation.util.ts (NEW)
**File**: d:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\pricing\components\pricing-grid.component.ts
**File**: d:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\pricing\components\plan-card.component.ts
**Issue Reference**: Issue 6 - Duplicate Placeholder Validation (P1)

**Quality Requirements**:
- Create shared utility file with isPriceIdPlaceholder() function
- Update both components to use shared function
- Remove duplicate inline logic

**Implementation Details**:
- Create paddle-validation.util.ts
- Export function isPriceIdPlaceholder(priceId: string | undefined): boolean
- Check for: 'REPLACE', 'xxxxxxxxx', 'yyyyyyyyy', 'REPLACE_ME', undefined/null
- Update imports in pricing-grid.component.ts and plan-card.component.ts

---

### Task 4.2: Remove Console.log Statements from Production Code

**File**: d:\projects\ptah-extension\apps\ptah-landing-page\src\app\services\paddle-checkout.service.ts
**File**: d:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\pricing\components\pricing-grid.component.ts
**Issue Reference**: Issue 4 - Console.log in Production (P1)

**Quality Requirements**:
- Remove all console.log statements
- Replace with conditional logging for development only
- Use environment.production flag

**Implementation Details**:
- Remove console.log from paddle-checkout.service.ts lines 194, 218
- Remove console.warn from pricing-grid.component.ts line 190
- Add private `logDebug(message: string, ...args: unknown[])` helper if needed
- Only log in non-production environment

---

### Task 4.3: Final Cleanup and Code Review Preparation

**File**: All modified files
**Issue Reference**: Final verification

**Quality Requirements**:
- Ensure all imports are correct
- Verify no unused imports remain
- Check for any remaining TODO comments
- Verify build passes

**Implementation Details**:
- Run `nx lint ptah-landing-page`
- Run `nx build ptah-landing-page`
- Address any lint errors
- Update any outdated comments

---

**Batch 4 Verification**:
- All files exist at paths
- paddle-validation.util.ts created
- Build passes: `npx nx build ptah-landing-page`
- Lint passes: `npx nx lint ptah-landing-page`
- code-logic-reviewer approved
- No console.log in production code

---

## Summary

| Batch | Focus | Tasks | Priority |
|-------|-------|-------|----------|
| 1 | Critical P0 Fixes | 3 | CRITICAL |
| 2 | Checkout Flow Protection | 4 | HIGH |
| 3 | Infrastructure + DI | 5 | MEDIUM |
| 4 | Utilities + Cleanup | 3 | MEDIUM |

**Estimated Total Time**: 4-6 hours

**Files to Modify**:
1. `d:\projects\ptah-extension\apps\ptah-landing-page\src\app\services\paddle-checkout.service.ts`
2. `d:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\pricing\components\pricing-grid.component.ts`
3. `d:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\pricing\components\plan-card.component.ts`

**Files to Create**:
1. `d:\projects\ptah-extension\apps\ptah-landing-page\src\app\config\paddle.config.ts`
2. `d:\projects\ptah-extension\apps\ptah-landing-page\src\app\utils\paddle-validation.util.ts`
