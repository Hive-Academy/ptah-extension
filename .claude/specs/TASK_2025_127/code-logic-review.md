# Code Logic Review - TASK_2025_127

## Review Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall Score       | 6.5/10         |
| Assessment          | NEEDS_REVISION |
| Critical Issues     | 2              |
| Serious Issues      | 4              |
| Moderate Issues     | 5              |
| Failure Modes Found | 9              |

---

## The 5 Paranoid Questions

### 1. How does this fail silently?

**Failure Mode A: Authentication Desync**
The `subscriptionContext.isAuthenticated` is computed as:

```typescript
isAuthenticated:
  this.subscriptionService.isFetched() &&
  this.subscriptionService.licenseData() !== null,
```

This can be `true` even when the auth cookie has expired. The `SubscriptionStateService` calls `AuthService.isAuthenticated()` once during `fetchSubscriptionState()`, but then caches `_licenseData`. If the user's session expires AFTER the initial fetch, the UI continues showing subscription-aware state while the auth is actually invalid. Any portal action will fail with 401 but the user won't know until they click.

**Failure Mode B: License API Returns Different Type Than Expected**
The `LicenseData.plan` type is `'basic' | 'pro' | 'trial_basic' | 'trial_pro'`, but the `currentPlanTier` computed only checks for `includes('basic')` or `includes('pro')`. If the API ever returns a plan like `'team_basic'` or `'enterprise_pro'`, it would incorrectly match. More critically, if the API returns `null` for `plan` on an authenticated user (edge case: account exists but no license ever created), `currentPlanTier` becomes `null`, and the UI shows "Start Trial" even though user is authenticated.

**Failure Mode C: Portal Session Silent Failure**
In `handleManageSubscription()`:

```typescript
error: (error) => {
  this.configError.set(error.error?.message || 'Failed to open subscription management.');
};
```

If `error.error` is undefined (network error, timeout), the generic message appears but user has no retry mechanism and must dismiss the error manually. The action fails silently in terms of user understanding WHY it failed.

### 2. What user action causes unexpected behavior?

**Rapid Click on CTA During Context Load**
If user clicks CTA button while `isLoadingContext()` is true, the button is disabled BUT the `handleClick()` method has no guard for `isLoadingContext`:

```typescript
protected handleClick(): void {
  if (this.isCtaDisabled()) return;  // This checks it, but...
```

The `isCtaDisabled()` returns `true` during loading, so this is actually handled. However, if the loading state changes between the template `[disabled]` evaluation and the `(click)` handler execution (race condition in zoneless Angular), the click could go through with stale context.

**User Switches Billing Toggle After Loading**
User is a Basic monthly subscriber. They click "Yearly" toggle on Basic card, then click "Manage Subscription". The `handleManageSubscription()` method doesn't care about billing period (correct), but the user might expect different behavior. This is actually fine but could be confusing UX.

**User Opens Portal, Changes Plan in Portal, Returns**
User clicks "Manage Subscription", changes from Basic to Pro in Paddle portal, returns to pricing page. The cached subscription state is stale. There's no refresh on window focus. User sees "Current Plan" on Basic when they're now Pro.

### 3. What data makes this produce wrong results?

**Edge Case: `subscription.status` is `'trialing'` (not `isOnTrial` from plan)**
The `LicenseData` interface shows `subscription.status` can be `'active' | 'paused' | 'canceled' | 'past_due'` but the `PlanSubscriptionContext.subscriptionStatus` type includes `'trialing'`. The `SubscriptionStateService.isOnTrial()` checks `plan?.startsWith('trial_')` which is different from `subscription.status === 'trialing'`. These are two different concepts that could conflict:

- `plan = 'pro'` but `subscription.status = 'trialing'` (Paddle trial, but license shows full plan)
- `plan = 'trial_pro'` but `subscription.status = 'active'` (trial period ended but plan not updated)

**Edge Case: `periodEndDate` is null for canceled subscription**
For `canceled` status, the badge shows:

```html
Ends {{ subscriptionContext()?.periodEndDate | date:'MMM d, y' }}
```

If `periodEndDate` is null (which it can be per the interface), this renders as empty string or "Invalid Date".

**Edge Case: `trialDaysRemaining` is 0 or negative**
When trial expires but license data hasn't been updated, `trialDaysRemaining` could be 0 or even negative. The badge shows:

```html
Trial - {{ subscriptionContext()?.trialDaysRemaining }} days left
```

This would show "Trial - 0 days left" or "Trial - -2 days left".

### 4. What happens when dependencies fail?

| Integration                            | Failure Mode  | Current Handling                                         | Gap                                                         |
| -------------------------------------- | ------------- | -------------------------------------------------------- | ----------------------------------------------------------- |
| `/api/v1/licenses/me`                  | Network error | Logs error, sets generic error message, marks as fetched | Falls back to unauthenticated view - OK but no retry option |
| `/api/v1/subscriptions/portal-session` | Network error | Shows `configError` with message                         | No retry button, user must dismiss and try again manually   |
| `AuthService.isAuthenticated()`        | Throws error  | Marks as fetched, continues without data                 | Silent degradation - user sees wrong UI                     |
| Paddle SDK not ready                   | Timeout       | Shows `autoCheckoutError`                                | OK                                                          |

### 5. What's missing that the requirements didn't mention?

1. **No Refresh on Focus**: When user returns from Paddle portal after making changes, subscription state is stale. Profile page handles this but pricing page doesn't.

2. **No State Expiration**: Cached subscription state lives forever until page reload. If user leaves tab open for hours/days, data becomes increasingly stale.

3. **No Paused Subscription Handling**: `SubscriptionInfo.status` includes `'paused'` but there's no badge variant or CTA variant for paused subscriptions. User with paused subscription sees default "trial" badge.

4. **No Grace Period Visualization**: Canceled subscriptions show "Ends [date]" but don't indicate if the date is imminent (< 24 hours, < 3 days).

5. **No Accessibility for Dynamic Badge Changes**: When badge changes (e.g., trial days remaining updates), there's no `aria-live` announcement.

---

## Failure Mode Analysis

### Failure Mode 1: Stale Auth State After Session Expiry

- **Trigger**: User's session expires while pricing page is open
- **Symptoms**: UI shows subscription badges but portal actions fail with 401, user sees generic error
- **Impact**: HIGH - User confusion, broken experience
- **Current Handling**: No re-validation of auth before portal actions
- **Recommendation**: Re-check auth before portal-session call, or add global auth state listener

### Failure Mode 2: Subscription Status Mismatch (trialing vs trial_plan)

- **Trigger**: Paddle subscription status is 'trialing' but plan doesn't have 'trial\_' prefix (or vice versa)
- **Symptoms**: Badge shows wrong state (e.g., "Current Plan" when still trialing)
- **Impact**: MEDIUM - Misleading UI
- **Current Handling**: Uses `plan.startsWith('trial_')` only, ignores `subscription.status`
- **Recommendation**: Reconcile both signals, prefer subscription.status as source of truth

### Failure Mode 3: Portal Session Failure Without Recovery

- **Trigger**: Network failure, timeout, or backend error on portal-session endpoint
- **Symptoms**: User sees error toast but has no way to retry except dismissing and clicking again
- **Impact**: MEDIUM - Friction in subscription management
- **Current Handling**: Sets `configError`, user must dismiss and retry
- **Recommendation**: Add retry button in error alert, similar to Paddle init retry

### Failure Mode 4: Null/Empty periodEndDate for Canceled Subscription

- **Trigger**: API returns canceled subscription without periodEndDate
- **Symptoms**: Badge shows "Ends " with no date, or "Ends Invalid Date"
- **Impact**: MEDIUM - Broken UI, user confusion
- **Current Handling**: No null check before date pipe
- **Recommendation**: Add fallback text: `periodEndDate | date:'MMM d, y' : 'soon'`

### Failure Mode 5: Zero/Negative Trial Days

- **Trigger**: Trial expired but subscription data not updated, or clock skew
- **Symptoms**: Badge shows "Trial - 0 days left" or negative days
- **Impact**: LOW - Misleading but not blocking
- **Current Handling**: Displays raw number
- **Recommendation**: Show "Trial expired" if days <= 0

### Failure Mode 6: Missing Paused Status Handling

- **Trigger**: User has paused subscription (Paddle feature)
- **Symptoms**: Falls through to default 'trial' badge, shows "Start Trial" CTA
- **Impact**: MEDIUM - Incorrect UI for paused users
- **Current Handling**: No specific handling for 'paused' status
- **Recommendation**: Add 'paused' badge variant and 'resume' CTA variant

### Failure Mode 7: Basic Subscriber with Pro Trial

- **Trigger**: User had Basic paid, upgraded to Pro trial (edge case, unusual flow)
- **Symptoms**: `currentPlanTier` returns 'pro', but old Basic subscription still exists
- **Impact**: LOW - Edge case, likely handled by backend
- **Current Handling**: Uses plan tier, doesn't consider multiple subscriptions
- **Recommendation**: Backend should return definitive "active" plan, not mixed state

### Failure Mode 8: Race Condition on Auto-Checkout

- **Trigger**: User returns from login with autoCheckout param, subscription data fetched shows existing subscription
- **Symptoms**: Auto-checkout tries to open, validation blocks it, but interval might already be cleared
- **Impact**: LOW - Edge case timing issue
- **Current Handling**: `triggerAutoCheckout` doesn't check subscription state
- **Recommendation**: Check subscriptionService state before auto-checkout

### Failure Mode 9: Concurrent Portal Session Requests

- **Trigger**: User double-clicks "Manage Subscription" quickly
- **Symptoms**: Two portal sessions created, two tabs open
- **Impact**: LOW - Minor UX issue, not breaking
- **Current Handling**: No debounce on manageSubscription button
- **Recommendation**: Add loading state or debounce to prevent double-click

---

## Critical Issues

### Issue 1: No Paused Subscription Status Handling

- **File**: `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\pricing\components\basic-plan-card.component.ts:335-369`
- **Scenario**: User has a paused Paddle subscription
- **Impact**: User sees "14-Day Free Trial" badge and "Start 14-Day Free Trial" CTA when they have a paused subscription. Clicking CTA would attempt checkout validation which should block, but the UI is misleading.
- **Evidence**:

```typescript
// No case for 'paused' in badgeVariant
if (ctx.subscriptionStatus === 'canceled' && ctx.currentPlanTier === 'basic') {
  return 'canceling';
}
if (ctx.subscriptionStatus === 'past_due' && ctx.currentPlanTier === 'basic') {
  return 'past-due';
}
// 'paused' falls through to 'trial' default
return 'trial';
```

- **Fix**: Add `'paused'` badge variant and CTA variant. Show "Subscription Paused" badge and "Resume" CTA.

### Issue 2: periodEndDate Null Not Handled in Badge Template

- **File**: `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\pricing\components\basic-plan-card.component.ts:77-85` (same in pro-plan-card)
- **Scenario**: Canceled subscription where backend doesn't provide `currentPeriodEnd`
- **Impact**: Badge renders "Ends " with empty/invalid date, confusing user
- **Evidence**:

```html
@case ('canceling') {
<div ...>Ends {{ subscriptionContext()?.periodEndDate | date:'MMM d, y' }}</div>
}
```

- **Fix**: Add null check: `{{ subscriptionContext()?.periodEndDate ? (subscriptionContext()?.periodEndDate | date:'MMM d, y') : 'soon' }}`

---

## Serious Issues

### Issue 1: No State Refresh After Portal Return

- **File**: `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\pricing\components\pricing-grid.component.ts`
- **Scenario**: User opens portal, changes plan, returns to pricing page
- **Impact**: Stale subscription data shown, wrong badges and CTAs displayed
- **Evidence**: No `window.focus` or `visibilitychange` listener to trigger refresh
- **Fix**: Add effect or listener to call `subscriptionService.refresh()` on window focus

### Issue 2: Auth Expiry Not Detected Before Portal Actions

- **File**: `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\pricing\components\pricing-grid.component.ts:607-624`
- **Scenario**: Session expires while page is open, user clicks "Manage Subscription"
- **Impact**: 401 error on portal-session call, generic error message
- **Evidence**:

```typescript
public handleManageSubscription(): void {
  // No auth check before API call
  this.http.post<{ url: string; expiresAt: string }>(
    '/api/v1/subscriptions/portal-session',
    {}
  )
```

- **Fix**: Re-validate auth before portal action, redirect to login if expired

### Issue 3: Trial Days Can Show Zero or Negative

- **File**: `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\pricing\components\basic-plan-card.component.ts:63-66`
- **Scenario**: Trial period exactly ended, `daysRemaining` is 0 or calculated as negative
- **Impact**: Confusing badge text "Trial - 0 days left" or "Trial - -1 days left"
- **Evidence**:

```html
Trial - {{ subscriptionContext()?.trialDaysRemaining }} days left
```

- **Fix**: Change to: `{{ (subscriptionContext()?.trialDaysRemaining ?? 0) > 0 ? subscriptionContext()?.trialDaysRemaining + ' days left' : 'expiring today' }}`

### Issue 4: Auto-Checkout Doesn't Check Existing Subscription

- **File**: `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\pricing\components\pricing-grid.component.ts:404-457`
- **Scenario**: User already subscribed, somehow gets `autoCheckout` query param
- **Impact**: Checkout validation will block it, but user sees delayed error after Paddle loads
- **Evidence**:

```typescript
private triggerAutoCheckout(planKey: string): void {
  // No check of subscriptionService.hasActiveSubscription()
  this.autoCheckoutIntervalId = setInterval(() => {
    if (this.isPaddleReady()) {
      // ... proceeds to checkout without subscription check
    }
  }, 100);
}
```

- **Fix**: After Paddle ready, check if user already has subscription, skip checkout if so

---

## Moderate Issues

### Issue 1: No Debounce on Manage Subscription Button

- **File**: `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\pricing\components\pricing-grid.component.ts:607`
- **Scenario**: User double-clicks "Manage Subscription"
- **Impact**: Two API calls, two portal tabs open
- **Fix**: Add loading state signal or RxJS debounce

### Issue 2: configError Used for Multiple Error Types

- **File**: `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\pricing\components\pricing-grid.component.ts:195`
- **Scenario**: Multiple different errors share same signal
- **Impact**: If portal fails, then price config fails, only one error shown
- **Fix**: Use separate signals or error queue

### Issue 3: isAuthenticated Computation Could Be Clearer

- **File**: `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\pricing\components\pricing-grid.component.ts:215-232`
- **Scenario**: `isFetched() && licenseData() !== null` isn't the same as authenticated
- **Impact**: User with account but no license shows as unauthenticated
- **Evidence**:

```typescript
isAuthenticated:
  this.subscriptionService.isFetched() &&
  this.subscriptionService.licenseData() !== null,
```

- **Fix**: Add explicit `isAuthenticated` computed in service, or check `authService.hasAuthHint()`

### Issue 4: Pro Trial User Viewing Basic - No Downgrade Warning

- **File**: `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\pricing\components\basic-plan-card.component.ts:382-407`
- **Scenario**: Pro trial user clicks "Upgrade Now" on Basic card (wants to convert trial to Basic paid)
- **Impact**: CTA says "Upgrade Now" but they're downgrading from Pro trial to Basic paid
- **Evidence**: `ctaVariant` returns 'start-trial' because `ctx.currentPlanTier` is 'pro' (from 'trial_pro')
- **Fix**: Detect Pro trial viewing Basic, show appropriate downgrade messaging

### Issue 5: No Loading State on Portal Session Call

- **File**: `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\pricing\components\pricing-grid.component.ts:607-624`
- **Scenario**: User clicks "Manage Subscription", no feedback while API call in progress
- **Impact**: User might double-click, no visual feedback
- **Fix**: Add `_isPortalLoading` signal, show spinner on button

---

## Data Flow Analysis

```
User lands on Pricing Page
        |
        v
+------------------+     fetchSubscriptionState()      +------------------+
| PricingGridComponent | --------------------------->  | SubscriptionStateService |
| ngOnInit()        |                                  | (singleton)      |
+------------------+                                   +--------+---------+
        |                                                       |
        |                                   authService.isAuthenticated()
        |                                                       |
        |                                              +--------v---------+
        |                                              | AuthService      |
        |                                              | - hasAuthHint()  |
        |                                              | - /api/auth/me   |
        |                                              +--------+---------+
        |                                                       |
        |  <-- GAP: Auth can expire after this point -->        |
        |                                                       v
        |                                   http.get('/api/v1/licenses/me')
        |                                                       |
        |                                              +--------v---------+
        |                                              | _licenseData     |
        |                                              | (cached, no TTL) |
        |                                              +------------------+
        v
subscriptionContext() computed
        |
        v
+------------------+                              +------------------+
| BasicPlanCard    |  <-- Input: context -->      | ProPlanCard      |
| - badgeVariant() |                              | - badgeVariant() |
| - ctaVariant()   |                              | - ctaVariant()   |
| - handleClick()  |                              | - handleClick()  |
+--------+---------+                              +--------+---------+
         |                                                 |
         |  User clicks "Manage Subscription"              |
         v                                                 v
+---------+---------------+       +---------+---------------+
| manageSubscription.emit() | --> | handleManageSubscription() |
+---------+---------------+       +---------+---------------+
                                           |
                   GAP: No auth re-check   |
                                           v
                          http.post('/api/v1/subscriptions/portal-session')
                                           |
                   GAP: No loading state   |
                   GAP: No double-click    |
                          prevention       v
                                    window.open(portal_url)
                                           |
                                           |  User modifies subscription in portal
                                           |
                                           v
                          GAP: No refresh on return <-------------+
```

### Gap Points Identified:

1. Auth state can expire after initial check - no re-validation
2. License data cached indefinitely - no TTL or refresh trigger
3. No loading state during portal session creation
4. No protection against double-click on portal button
5. No subscription state refresh when user returns from portal

---

## Requirements Fulfillment

| Requirement                                                | Status   | Concern                                                          |
| ---------------------------------------------------------- | -------- | ---------------------------------------------------------------- |
| Basic subscriber viewing Basic: "Manage Subscription"      | COMPLETE | Works correctly                                                  |
| Basic subscriber viewing Pro: "Upgrade to Pro"             | COMPLETE | Works correctly                                                  |
| Pro subscriber viewing Pro: "Manage Subscription"          | COMPLETE | Works correctly                                                  |
| Pro subscriber viewing Basic: "Included in Pro" (disabled) | COMPLETE | Works correctly                                                  |
| Trial user: "Upgrade Now"                                  | PARTIAL  | Works but no distinction between trial-Basic and trial-Pro users |
| Canceled: "Reactivate"                                     | PARTIAL  | Missing null check on periodEndDate in badge                     |
| Past due: "Update Payment"                                 | COMPLETE | Works correctly                                                  |
| Paused subscription                                        | MISSING  | No handling for 'paused' status                                  |
| Loading state during context fetch                         | COMPLETE | Shows "Loading..."                                               |
| Graceful fallback on API failure                           | COMPLETE | Falls back to unauthenticated view                               |

### Implicit Requirements NOT Addressed:

1. State refresh after portal interactions (user expectation)
2. Session expiry handling during page session (security expectation)
3. Paused subscription handling (Paddle feature users may have)
4. Zero/negative trial days edge case (data integrity)

---

## Edge Case Analysis

| Edge Case                        | Handled | How                               | Concern                     |
| -------------------------------- | ------- | --------------------------------- | --------------------------- |
| Null subscriptionContext         | YES     | Returns 'trial'/'popular' default | OK                          |
| Auth fails during fetch          | PARTIAL | Marks as fetched, no data         | Silent degradation          |
| periodEndDate is null            | NO      | Template shows empty              | CRITICAL - must fix         |
| trialDaysRemaining <= 0          | NO      | Shows raw number                  | Should show "expiring"      |
| User has paused subscription     | NO      | Falls to trial                    | Must add paused handling    |
| Double-click on CTA              | PARTIAL | Disabled during loading           | Portal button not protected |
| Tab switch during fetch          | YES     | Signal updates when complete      | OK                          |
| Network timeout on license fetch | YES     | Sets error, marks fetched         | Falls back gracefully       |
| Race: billing toggle + CTA       | YES     | Uses activePlan computed          | Correct behavior            |
| Multiple subscriptions           | N/A     | Backend returns single active     | Not a frontend concern      |

---

## Integration Risk Assessment

| Integration                            | Failure Probability | Impact | Mitigation                     |
| -------------------------------------- | ------------------- | ------ | ------------------------------ |
| `/api/v1/licenses/me`                  | LOW                 | HIGH   | Has error handling, falls back |
| `AuthService.isAuthenticated()`        | LOW                 | MEDIUM | Has catch, marks fetched       |
| `/api/v1/subscriptions/portal-session` | MEDIUM              | MEDIUM | Needs retry button             |
| Paddle SDK                             | LOW                 | LOW    | Has retry mechanism            |
| Date pipe with null                    | MEDIUM              | LOW    | Needs null check               |

---

## Business Logic Verification

### CTA State Matrix Verification

| User State            | Basic Card Expected           | Basic Card Actual                  | Pro Card Expected             | Pro Card Actual         | Status  |
| --------------------- | ----------------------------- | ---------------------------------- | ----------------------------- | ----------------------- | ------- |
| Not authenticated     | Start Trial -> Login          | Start Trial (redirects in handler) | Start Trial -> Login          | Start Trial (redirects) | PASS    |
| Authenticated, no sub | Start Trial -> Checkout       | Start Trial                        | Start Trial -> Checkout       | Start Trial             | PASS    |
| Active Basic          | Manage Subscription -> Portal | Manage Subscription                | Upgrade to Pro -> Checkout    | Upgrade to Pro          | PASS    |
| Active Pro            | Included in Pro (disabled)    | Included in Pro (disabled)         | Manage Subscription -> Portal | Manage Subscription     | PASS    |
| Trial Basic           | Upgrade Now -> Checkout       | Upgrade Now                        | Upgrade to Pro -> Checkout    | Upgrade to Pro          | PASS\*  |
| Trial Pro             | ?                             | Start Trial (BUG)                  | Upgrade Now -> Checkout       | Upgrade Now             | PARTIAL |
| Canceled Basic        | Reactivate -> Portal          | Reactivate                         | Switch to Pro -> Checkout     | Upgrade to Pro          | PASS    |
| Canceled Pro          | ?                             | Start Trial                        | Reactivate -> Portal          | Reactivate              | PARTIAL |
| Past Due (any)        | Update Payment -> Portal      | Update Payment                     | Update Payment -> Portal      | Update Payment          | PASS    |
| Paused (any)          | Resume -> Portal              | Start Trial (BUG)                  | Resume -> Portal              | Start Trial (BUG)       | FAIL    |

\*Note: Trial Basic viewing Pro shows "Upgrade to Pro" which is contextually correct.

---

## Security Assessment

### Positive Findings:

1. **Server-side validation**: Checkout validation calls `/api/v1/subscriptions/validate-checkout` before opening Paddle
2. **No sensitive data exposure**: Only displays plan names, dates - no customer IDs or payment info
3. **HTTP-only auth cookie**: Session not accessible via JavaScript (handled by AuthService pattern)
4. **Target="\_blank" with rel**: Portal links use `noopener,noreferrer` correctly
5. **Price ID validation**: Checks for placeholder IDs before checkout

### Security Concerns:

1. **No CSRF protection visible**: Portal session POST doesn't show CSRF token (may be in HTTP interceptor)
2. **Stale auth state**: No re-validation before sensitive actions (portal session)
3. **Client-side plan check**: CTA state determined client-side, could be manipulated (but server validates)

### Assessment: LOW RISK

Security model relies correctly on server-side validation. Client-side state is for UX only. Main concern is UX degradation from stale auth, not security vulnerability.

---

## Verdict

**Recommendation**: NEEDS_REVISION
**Confidence**: HIGH
**Top Risk**: Paused subscription status completely unhandled, causing incorrect UI for affected users

### Required Fixes Before Approval:

1. Add paused subscription badge and CTA variants
2. Add null check for periodEndDate in canceling badge template
3. Handle zero/negative trial days gracefully

### Recommended Fixes (Not Blocking):

4. Add subscription state refresh on window focus
5. Add loading state to portal session action
6. Re-validate auth before portal actions

---

## What Robust Implementation Would Include

A bulletproof implementation would add:

1. **State Refresh Triggers**:

   - Refresh subscription on window focus (`visibilitychange` event)
   - Refresh after returning from portal (detect via `document.hasFocus()` change)
   - Optional: periodic refresh every 5 minutes if page stays open

2. **Auth Re-validation**:

   - Before portal-session call, verify auth is still valid
   - If expired, redirect to login with return URL

3. **Complete Status Coverage**:

   - Handle all Paddle statuses: active, trialing, canceled, past_due, paused
   - Add 'paused' badge variant with appropriate messaging
   - Add 'resume' CTA variant pointing to portal

4. **Defensive Template Logic**:

   - Null checks on all date/number displays
   - Fallback text for missing data
   - Boundary conditions for days remaining (< 0, = 0, > 14)

5. **Double-Click Prevention**:

   - Disable portal button during API call
   - Use RxJS `exhaustMap` or signal-based mutex

6. **Error Recovery**:

   - Retry buttons for all error states
   - More specific error messages
   - Link to support for unrecoverable errors

7. **Accessibility**:
   - `aria-live` region for badge changes
   - `aria-disabled` with explanation text
   - Screen reader announcements for state changes
