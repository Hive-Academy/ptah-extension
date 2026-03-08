# Code Logic Review - TASK_2025_134

## Review Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall Score       | 6/10           |
| Assessment          | NEEDS_REVISION |
| Critical Issues     | 2              |
| Serious Issues      | 4              |
| Moderate Issues     | 3              |
| Failure Modes Found | 7              |

---

## The 5 Paranoid Questions

### 1. How does this fail silently?

**Stale license key after plan change**: When an SSE event fires (`licenseUpdated$`, `subscriptionStatus$`, `reconciliationCompleted$`), the parent calls `refreshLicenseData()` which updates the `license` signal, but **never clears** the `licenseKey` signal. If a user's license gets revoked or downgraded while the page is open, the old license key remains visible in the UI even though it is no longer valid. The user sees a revoked/expired key they believe is valid. This is a silent security and UX failure.

**Backend returns HTTP 200 for "no license found"**: The `revealMyLicenseKey()` endpoint returns `{ success: false, message: "No active license found" }` with an HTTP 200 status. This is not a silent failure per se, but it means the frontend cannot distinguish between "server returned success with a negative result" and an actual 200 success at the HTTP level. More critically, the frontend correctly handles this case, but any monitoring/alerting on HTTP error codes would miss repeated failed attempts.

**Clipboard copy failure is unhandled**: `navigator.clipboard.writeText(key)` can throw (user denied clipboard permission, insecure context, browser doesn't support it). The `copyLicenseKey()` method has no try/catch. If clipboard write fails, the promise rejects silently -- no error shown to user, and the "Copied!" feedback never appears, leaving the user confused about whether it worked.

### 2. What user action causes unexpected behavior?

**Rapid button clicks**: The "Get License Key" button is disabled only by `[disabled]="isRevealingKey()"`. If the first request completes (isRevealingKey becomes false) and the user clicks again, a second POST request fires. The result: the license key is re-fetched and the signal is re-set (no harm done, but it wastes a rate-limited request). After 3 rapid successful requests within a minute, the 4th will get a 429 error, confusing the user since they already have their key displayed.

**User navigates away during request**: The `handleRevealLicenseKey()` method subscribes to an HTTP observable but never unsubscribes. If the user navigates away from the profile page before the response returns, the component is destroyed but the subscription callback still executes, calling `.set()` on a signal from a destroyed component. While Angular signals don't crash on this (unlike RxJS subjects in some scenarios), it is a subscription leak.

**Toggle visibility before key arrives**: Not really a problem due to `@if (licenseKey())` guard, but the `showLicenseKey` signal persists across reveal cycles. If the user reveals the key, toggles visibility on, then the license refreshes and the key signal gets cleared somehow, `showLicenseKey` would still be `true`. On next reveal, the key would be shown unmasked immediately, skipping the masked default.

### 3. What data makes this produce wrong results?

**Short license keys break masking**: `getMaskedKey()` does `key.substring(0, 12) + '...' + key.substring(key.length - 4)`. If the key is fewer than 16 characters, the substrings overlap and produce nonsensical output. For example, a 10-character key would produce 12 chars (clamped to full string) + "..." + last 4 chars, showing the key almost in full. The standard format `ptah_lic_{64 hex}` (73 chars) is safe, but any legacy or malformed key would break.

**Backend `license.plan` not in frontend `LicenseData` union**: The backend can return any string for `license.plan` (it's a freeform `String` column in Prisma). The frontend `LicenseData.plan` type is `'community' | 'pro' | 'trial_pro'`. If the database contains any other plan value, TypeScript typing lies to the runtime. This is pre-existing, not introduced by this task, but the `revealMyLicenseKey` endpoint passes `license.plan` through without validation.

**User with multiple active licenses**: The Prisma query uses `findFirst` with `orderBy: { createdAt: 'desc' }`. If a user has multiple active licenses (e.g., one community + one pro), the endpoint returns the most recently created one. This may or may not be the one the user expects. The `/me` endpoint has the same pattern, so this is consistent, but it means the revealed key might not match what the user thinks their "active" license is.

### 4. What happens when dependencies fail?

| Dependency            | Failure Mode              | Current Handling                  | Assessment                                                                                 |
| --------------------- | ------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------ |
| Prisma query          | DB connection lost        | Unhandled exception -> NestJS 500 | Frontend shows generic error                                                               |
| JwtAuthGuard          | Invalid/expired token     | 401 UnauthorizedException         | Frontend hits `error` callback but does not handle 401 specifically (no redirect to login) |
| Throttle guard        | Rate limit exceeded       | 429 with Retry-After header       | Frontend shows "Too many requests" message -- OK                                           |
| navigator.clipboard   | Permission denied / HTTPS | Unhandled promise rejection       | CONCERN: No feedback to user                                                               |
| HttpClient POST       | Network offline           | Error callback fires              | Shows generic error -- OK                                                                  |
| Angular signal .set() | Component destroyed       | Signal set on orphaned signal     | Minor leak, no crash                                                                       |
| SSE license refresh   | Stale licenseKey signal   | Key not cleared on refresh        | CONCERN: Stale key displayed                                                               |

### 5. What's missing that the requirements didn't mention?

1. **No 401 handling in the reveal-key flow**: If the JWT expires between page load and clicking "Get License Key", the user gets a generic error instead of being redirected to login. The `handleSyncWithPaddle` has the same gap, but for a security-sensitive key reveal, this matters more.

2. **No "hide key after timeout" behavior**: Once revealed, the license key stays visible indefinitely until page reload. For a security-sensitive credential, an auto-hide after N minutes would be prudent.

3. **No key invalidation on license change**: As detailed above, SSE-driven license refreshes don't clear the revealed key. If the license is revoked server-side, the key remains displayed client-side.

4. **No confirmation dialog before revealing**: The key is revealed with a single click. No "Are you sure?" or re-authentication step. For a credential that grants access to the product, this is a low barrier.

5. **No rate limit feedback in UI**: The 429 error message says "Too many requests. Please wait a moment" but doesn't tell the user how long to wait. The backend's `Retry-After` header value is not extracted or displayed.

6. **No audit log for failed attempts**: The backend only logs successful key reveals. If `license` is null (no active license), no log entry is written. A security audit trail should also log denied access attempts.

---

## Failure Mode Analysis

### Failure Mode 1: Stale License Key After Revocation

- **Trigger**: User reveals key, then their license is revoked/expired while page is open (via Paddle webhook, admin action, or expiration)
- **Symptoms**: The user continues to see the old license key displayed in the UI, even though SSE events fire and update the license status
- **Impact**: HIGH -- User may attempt to use a revoked key, or worse, share it believing it is still valid
- **Current Handling**: The `refreshLicenseData()` method updates `license` signal but does NOT clear `licenseKey`, `showLicenseKey`, or `copiedToClipboard` signals
- **Recommendation**: In `refreshLicenseData()`, when the new license data status is not 'active', clear the `licenseKey` signal: `this.licenseKey.set(null)`. Also clear on any license refresh to force re-reveal.

### Failure Mode 2: Clipboard Write Failure With No User Feedback

- **Trigger**: User clicks "Copy" button in a context where `navigator.clipboard.writeText()` throws: insecure context (HTTP), permission denied, browser extension blocking clipboard access, or older browser
- **Symptoms**: Nothing visible happens. No "Copied!" feedback, no error message. User doesn't know if copy worked.
- **Impact**: MEDIUM -- User may paste old clipboard content into their VS Code extension, causing a confusing "invalid license" error
- **Current Handling**: `async copyLicenseKey()` has no try/catch around `navigator.clipboard.writeText(key)`
- **Recommendation**: Wrap in try/catch. On failure, fall back to `document.execCommand('copy')` with a textarea, or at minimum show an error toast.

### Failure Mode 3: Unsubscribed HTTP Observable on Component Destruction

- **Trigger**: User clicks "Get License Key", then immediately navigates away (clicks browser back, clicks another route)
- **Symptoms**: The HTTP response arrives after component destruction. Signal `.set()` calls execute on orphaned component signals. No crash, but wasted request and potential memory leak if Angular retains references.
- **Impact**: LOW-MEDIUM -- Memory leak per navigation, no user-visible symptom
- **Current Handling**: No `takeUntil(this.destroy$)` on the `handleRevealLicenseKey()` subscription, unlike the SSE listeners which properly use `takeUntil`
- **Recommendation**: Pipe the HTTP observable through `takeUntil(this.destroy$)` consistent with the rest of the component's pattern.

### Failure Mode 4: HTTP 200 for "No Active License" Bypasses Error Monitoring

- **Trigger**: User with no active license clicks "Get License Key"
- **Symptoms**: Backend returns `{ success: false, message: "No active license found" }` with HTTP 200. The frontend correctly shows the error message. However, any server-side monitoring that watches for non-2xx responses will not flag these.
- **Impact**: LOW -- Functional behavior is correct, but observability is reduced
- **Current Handling**: Frontend handles correctly via `response.success` check
- **Recommendation**: Consider returning HTTP 404 for "no active license" to align with REST conventions and enable standard HTTP monitoring. This would also make the frontend error handling cleaner (the `error` callback handles it, not the `next` callback).

### Failure Mode 5: Race Condition Between Reveal Button and Rate Limit

- **Trigger**: User reveals key successfully (1 request). License changes via SSE (but key not cleared -- FM1). User clicks "Get License Key" again 2 more times (total 3 within 60s). On the 4th click they get 429.
- **Symptoms**: User sees "Too many requests" error after successfully having the key, potentially confusing if the key is still shown
- **Impact**: LOW -- Cosmetic confusion, not a data integrity issue
- **Current Handling**: Button is only disabled during in-flight requests, not after success
- **Recommendation**: Once a key is successfully revealed, hide the "Get License Key" button (which it does via `@if (licenseKey())` guard). The real concern is FM1 clearing the key and re-exposing the button.

### Failure Mode 6: No Audit Log on Denied Access

- **Trigger**: A user with no active license (or an attacker with a stolen JWT for a deactivated account) repeatedly hits the reveal-key endpoint
- **Symptoms**: No server-side log entry. The audit trail only captures successful reveals.
- **Impact**: MEDIUM -- Security audit gap. Failed access attempts are often more interesting for security than successful ones.
- **Current Handling**: `this.logger.log()` is only called after the `if (!license)` early return
- **Recommendation**: Add a `this.logger.warn()` call inside the `if (!license)` block before returning.

### Failure Mode 7: 401 Not Handled in Frontend

- **Trigger**: User's JWT expires between page load (which succeeded) and clicking "Get License Key" minutes later
- **Symptoms**: The reveal endpoint returns 401. Frontend hits the `error` callback but only checks for `error.status === 429`. The 401 falls into the `else` branch which shows "Failed to retrieve license key. Please try again." -- the user retries but it keeps failing because their session is expired.
- **Impact**: MEDIUM -- User is stuck with no clear path forward. No redirect to login.
- **Current Handling**: Generic error message for all non-429 errors
- **Recommendation**: Check for `error.status === 401` and redirect to login, or show "Your session has expired. Please log in again."

---

## Critical Issues

### Issue 1: Stale License Key Persists After License Status Change

- **File**: `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\profile\profile-page.component.ts:290-305`
- **Scenario**: License is revoked/expired while user has profile page open. SSE triggers `refreshLicenseData()`. License signal updates with `status: 'none'` or `status: 'expired'`, but the `licenseKey` signal retains the old (now-invalid) key value.
- **Impact**: User sees and can copy a revoked license key. Security risk -- key that should be hidden remains exposed.
- **Evidence**:

```typescript
// refreshLicenseData() only updates license signal:
private refreshLicenseData(): void {
  this.http.get<LicenseData>('/api/v1/licenses/me').subscribe({
    next: (data) => {
      this.license.set(data);  // <-- Updates license
      // MISSING: this.licenseKey.set(null) when status changes
    },
  });
}
```

- **Fix**: After setting license data, check if status is no longer 'active' and clear the key:

```typescript
next: (data) => {
  this.license.set(data);
  if (data.status !== 'active') {
    this.licenseKey.set(null);
    this.showLicenseKey?.set(false); // also clear child state
  }
};
```

### Issue 2: Unhandled Clipboard API Rejection

- **File**: `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\profile\components\profile-details.component.ts:375-381`
- **Scenario**: `navigator.clipboard.writeText()` rejects due to permission denial, insecure context, or browser incompatibility. The `async` method has no try/catch, producing an unhandled promise rejection.
- **Impact**: User gets no feedback that copy failed. In strict environments, unhandled rejections may log to console or be reported by error tracking. User may paste stale clipboard content into their VS Code extension.
- **Evidence**:

```typescript
public async copyLicenseKey(): Promise<void> {
  const key = this.licenseKey();
  if (key) {
    await navigator.clipboard.writeText(key);  // No try/catch!
    this.copiedToClipboard.set(true);
    setTimeout(() => this.copiedToClipboard.set(false), 2000);
  }
}
```

- **Fix**: Wrap in try/catch. Consider adding a `copyError` signal or reusing `revealKeyError`.

---

## Serious Issues

### Issue 3: No Audit Logging for Denied License Key Access

- **File**: `D:\projects\ptah-extension\apps\ptah-license-server\src\license\controllers\license.controller.ts:252-257`
- **Scenario**: User or attacker with valid JWT but no active license attempts to retrieve a key. The endpoint returns `{ success: false }` but writes no log entry.
- **Impact**: Security audit gap. Failed access attempts are not tracked.
- **Evidence**:

```typescript
if (!license) {
  return {
    // <-- Returns immediately
    success: false,
    message: 'No active license found',
  };
}

this.logger.log(
  // <-- Only reached on success
  `License key revealed: userId=${user.id}...`
);
```

- **Fix**: Add `this.logger.warn(`License key reveal denied: userId=${user.id}, reason=no_active_license`)` before the return.

### Issue 4: HTTP Subscription Not Cleaned Up on Component Destroy

- **File**: `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\profile\profile-page.component.ts:407-438`
- **Scenario**: User clicks "Get License Key" and navigates away before response arrives. The HTTP subscription completes after component destruction.
- **Impact**: Subscription leak. Signal `.set()` calls on orphaned component. Not a crash, but inconsistent with the component's own pattern (SSE listeners use `takeUntil(this.destroy$)`).
- **Evidence**:

```typescript
// SSE listeners properly cleaned up:
this.sseService.licenseUpdated$
  .pipe(takeUntil(this.destroy$))      // <-- Proper cleanup
  .subscribe(...)

// But HTTP call is NOT:
this.http.post<...>('/api/v1/licenses/me/reveal-key', {})
  .subscribe({...});                    // <-- No takeUntil
```

- **Fix**: Add `.pipe(takeUntil(this.destroy$))` before `.subscribe()` in `handleRevealLicenseKey()`. Note: same issue exists in `handleSyncWithPaddle()` and `handleManageSubscription()` (pre-existing).

### Issue 5: No 401 Handling Causes Dead-End UX

- **File**: `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\profile\profile-page.component.ts:425-436`
- **Scenario**: JWT expires between page load and clicking "Get License Key" (plausible if user leaves tab open for hours)
- **Impact**: User repeatedly sees "Failed to retrieve license key. Please try again." with no indication that re-authentication is needed.
- **Evidence**:

```typescript
error: (error) => {
  this.isRevealingKey.set(false);
  if (error.status === 429) {
    // Rate limit handled
  } else {
    // 401 falls here - generic message, no login redirect
    this.revealKeyError.set(
      error.error?.message || 'Failed to retrieve license key. Please try again.'
    );
  }
},
```

- **Fix**: Add explicit `error.status === 401` handling that either redirects to login or shows "Session expired. Please log in again."

### Issue 6: License Key Error Display Visible Even When Key Row is Hidden

- **File**: `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\profile\components\profile-details.component.ts:193-205`
- **Scenario**: User has `status: 'none'` (no active license). The License Key row is hidden by `@if (license()?.status !== 'none')`. However, the **error block** at lines 193-205 is OUTSIDE that conditional -- it is within the `divide-y` container but NOT guarded by the status check.
- **Impact**: If a user somehow triggers an error (e.g., race condition where status changes to 'none' mid-request), the error message "No active license found" would display in the Account Details card without the context of the License Key row.
- **Evidence**:

```html
<!-- License Key row - guarded -->
@if (license()?.status !== 'none') {
<div class="px-6 py-4 flex justify-between items-center">...</div>
}

<!-- Error block - NOT guarded by status check -->
@if (revealKeyError()) {
<div class="px-6 py-3 flex items-center gap-2 bg-error/10 text-error">...</div>
}
```

- **Fix**: Wrap the error block inside the same `@if (license()?.status !== 'none')` guard, or clear the error when license status changes.

---

## Moderate Issues

### Issue 7: Masking Logic Fragile for Non-Standard Key Formats

- **File**: `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\profile\components\profile-details.component.ts:385-389`
- **Scenario**: A legacy key or malformed key shorter than 16 characters would produce overlapping substrings, revealing nearly the entire key.
- **Impact**: Low probability given standard format `ptah_lic_{64 hex}` (73 chars), but defensive code should handle it.
- **Evidence**:

```typescript
public getMaskedKey(): string {
  const key = this.licenseKey();
  if (!key) return '';
  return key.substring(0, 12) + '...' + key.substring(key.length - 4);
  // For a 10-char key: shows chars 0-9 + '...' + chars 6-9 = almost the whole key
}
```

- **Fix**: Add a length check: if key is shorter than 20 chars, mask everything except first 4 chars.

### Issue 8: Error State Not Auto-Cleared

- **File**: `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\profile\profile-page.component.ts:405`
- **Scenario**: User gets a rate-limit error. The error message persists indefinitely until the user clicks the button again (which clears the error at line 405). Unlike `syncError` (which auto-clears after 5 seconds in some paths), `revealKeyError` has no auto-clear timeout.
- **Impact**: Minor UX issue -- persistent error banner even after the rate limit window has passed.
- **Fix**: Add a `setTimeout(() => this.revealKeyError.set(null), 10000)` after setting the error, similar to `syncSuccess` timeout pattern.

### Issue 9: `select-all` CSS Class on Masked Key Exposes Full Key in Selection

- **File**: `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\profile\components\profile-details.component.ts:140`
- **Scenario**: The `<code>` element has `class="select-all"`. When the key is masked, clicking the code element selects the DOM text content -- which is the masked version (safe). However, the `select-all` class combined with right-click > "Copy" would only copy the masked display text, not the real key. This is not a bug, but it could confuse users who try to copy via text selection rather than the Copy button.
- **Impact**: Minor UX confusion -- users who select-all and copy get the masked version, not the real key.
- **Fix**: Consider removing `select-all` class, or only applying it when `showLicenseKey()` is true.

---

## Data Flow Analysis

```
User clicks "Get License Key" button
  |
  v
ProfileDetailsComponent.revealKeyRequested.emit()
  |
  v
ProfilePageComponent.handleRevealLicenseKey()
  |-- Sets isRevealingKey(true)
  |-- Sets revealKeyError(null)
  |
  v
POST /api/v1/licenses/me/reveal-key  (with ptah_auth cookie)
  |
  v
NestJS Throttle Guard (3 req/min)
  |-- FAIL: 429 -> Frontend error callback -> shows rate limit message
  |
  v
JwtAuthGuard.canActivate()
  |-- FAIL: 401 -> Frontend error callback -> shows GENERIC message [GAP: no login redirect]
  |
  v
revealMyLicenseKey()
  |-- Prisma findFirst(userId, status: 'active', orderBy: createdAt desc)
  |   |-- FAIL (DB error): Unhandled -> NestJS 500 -> Frontend generic error
  |   |-- No license: Returns {success: false} [GAP: no audit log]
  |
  v
Returns {success: true, licenseKey, plan}
  |-- Logger.log() audit entry [OK]
  |
  v
Frontend next callback
  |-- Sets isRevealingKey(false)
  |-- Sets licenseKey signal
  |
  v
ProfileDetailsComponent re-renders
  |-- Shows masked key + Eye toggle + Copy button
  |   |-- Copy button -> navigator.clipboard.writeText() [GAP: no try/catch]
  |
  [Meanwhile, SSE events can fire]
  |
  v
SSE licenseUpdated$ / subscriptionStatus$
  |-- refreshLicenseData() -> updates license signal
  |-- [GAP: does NOT clear licenseKey signal if license status changes]
```

### Gap Points Identified:

1. `licenseKey` signal not cleared when license status changes via SSE refresh
2. `navigator.clipboard.writeText()` has no error handling
3. HTTP subscription not cleaned up on component destruction
4. No audit logging for denied access attempts
5. No 401-specific error handling (expired JWT)
6. Error display block not scoped to the same visibility guard as the key row

---

## Requirements Fulfillment

| Requirement                          | Status   | Concern                                      |
| ------------------------------------ | -------- | -------------------------------------------- |
| JWT authentication required          | COMPLETE | Working via JwtAuthGuard                     |
| Rate limiting (3 req/min)            | COMPLETE | Via @Throttle decorator                      |
| POST method (no URL caching)         | COMPLETE | Correctly uses POST                          |
| Audit logging on key access          | PARTIAL  | Only logs successes, not denied attempts     |
| Return key + plan for active license | COMPLETE | Correct response shape                       |
| Return error for no active license   | COMPLETE | Returns {success: false, message}            |
| Frontend loading state               | COMPLETE | Spinner shown during fetch                   |
| Frontend error display               | COMPLETE | Error banner shown, 429 handled specifically |
| Masked key display                   | COMPLETE | First 12 + last 4 chars shown                |
| Show/hide toggle                     | COMPLETE | Eye/EyeOff icon toggle works                 |
| Copy to clipboard                    | PARTIAL  | Missing error handling for clipboard API     |
| "Copied!" feedback (2s)              | COMPLETE | setTimeout clears after 2000ms               |
| Only visible for active license      | COMPLETE | `@if (license()?.status !== 'none')` guard   |
| ARIA labels on buttons               | COMPLETE | All interactive elements have aria-labels    |
| Follow parent-child event pattern    | COMPLETE | input/output/signal pattern matches codebase |

### Implicit Requirements NOT Addressed:

1. **Clear revealed key on license status change** -- When license is revoked/expired, the UI should stop showing the old key
2. **Handle 401 (session expiry)** -- Users with expired sessions need a path to re-authenticate, not a generic error
3. **Clipboard API error handling** -- Browser clipboard can fail, needs fallback or error feedback
4. **Audit logging for denied attempts** -- Security best practice for sensitive endpoints
5. **Auto-hide key after inactivity** -- Security best practice for displayed credentials

---

## Edge Case Analysis

| Edge Case                                 | Handled | How                                                               | Concern                                              |
| ----------------------------------------- | ------- | ----------------------------------------------------------------- | ---------------------------------------------------- |
| Null licenseKey input                     | YES     | `@if (licenseKey())` guard, `if (!key) return ''` in getMaskedKey | None                                                 |
| User with no active license clicks reveal | YES     | Backend returns {success: false}, frontend shows error            | Error block visible outside key row guard            |
| Rapid clicks on "Get License Key"         | PARTIAL | Button disabled during request, but re-enabled after success      | User can waste rate-limited requests                 |
| Tab switch / navigation mid-request       | NO      | HTTP subscription not cleaned up                                  | Orphaned signal writes                               |
| Network failure (offline)                 | YES     | Falls to error callback, shows generic message                    | Could be more specific about offline state           |
| JWT expired mid-session                   | PARTIAL | Error callback fires, shows message                               | No 401-specific handling, no login redirect          |
| Rate limit (429)                          | YES     | Specific error message shown                                      | Does not display Retry-After duration                |
| License key shorter than 16 chars         | NO      | getMaskedKey assumes long key                                     | Overlapping substrings reveal most of key            |
| License revoked while page open (SSE)     | NO      | SSE updates license signal but not licenseKey                     | Stale key remains displayed                          |
| Clipboard permission denied               | NO      | No try/catch on navigator.clipboard                               | Unhandled promise rejection, no user feedback        |
| Multiple active licenses for same user    | PARTIAL | findFirst with orderBy createdAt desc                             | Returns newest, may not be expected one              |
| Component destroyed during setTimeout     | MINIMAL | setTimeout on copiedToClipboard fires after destroy               | Signal set on destroyed component, no crash but leak |

---

## Integration Risk Assessment

| Integration              | Failure Probability             | Impact                | Mitigation                                  |
| ------------------------ | ------------------------------- | --------------------- | ------------------------------------------- |
| Prisma DB query          | LOW                             | 500 error to frontend | NestJS default exception filter returns 500 |
| JwtAuthGuard             | LOW-MED (JWT can expire)        | 401, user stuck       | MISSING: No 401 redirect in frontend        |
| Throttle guard           | LOW (normal use)                | 429 shown to user     | OK: Handled with specific message           |
| navigator.clipboard      | MED (varies by browser/context) | Silent failure        | MISSING: No try/catch                       |
| SSE real-time updates    | MED (connection can drop)       | Stale UI              | Pre-existing: SSE reconnection not in scope |
| Signal state consistency | MED (multiple async sources)    | Stale key displayed   | MISSING: Key not cleared on refresh         |

---

## Verdict

**Recommendation**: NEEDS_REVISION
**Confidence**: HIGH
**Top Risk**: Stale license key remaining visible after license revocation, combined with no clipboard error handling. The stale key issue is a security concern that should be addressed before this ships.

## What Robust Implementation Would Include

A bulletproof version of this feature would additionally have:

- **Key invalidation on license change**: `refreshLicenseData()` should clear `licenseKey` when status changes away from 'active', or unconditionally clear it on every refresh to force re-reveal
- **Clipboard error handling**: try/catch around `navigator.clipboard.writeText()` with fallback to `document.execCommand('copy')` and visible error feedback
- **Subscription cleanup**: All HTTP calls in handler methods piped through `takeUntil(this.destroy$)` to prevent orphaned subscriptions
- **401 handling**: Specific check for expired session with redirect to login
- **Failed access audit logging**: `logger.warn()` for denied key reveal attempts (no active license, rate limited)
- **Auto-hide timer**: Clear the displayed key after 5 minutes of inactivity
- **Retry-After extraction**: Parse the 429 response's `Retry-After` header and show countdown to user
- **Defensive masking**: Guard against short keys in `getMaskedKey()` to prevent over-exposure
- **Error scoping**: Wrap the error display block inside the same visibility guard as the key row
- **HTTP status codes**: Return 404 for "no active license" instead of 200 with `success: false` for better REST alignment and monitoring

The core logic is correct for the happy path and the implementation follows established codebase patterns well. The issues identified are primarily around edge cases, error handling completeness, and state lifecycle management -- areas where the difference between "works in demo" and "works in production" becomes apparent.
