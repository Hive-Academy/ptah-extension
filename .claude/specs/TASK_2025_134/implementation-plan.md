# Implementation Plan - TASK_2025_134

## Get License Key Button on Profile Page

### Summary

Add a "Get License Key" button to the profile page Account Details section that allows authenticated users to securely retrieve their license key. Requires a new dedicated backend endpoint (separate from `/me` which intentionally excludes the key) and frontend UI changes to display the key with show/hide toggle and copy-to-clipboard functionality.

---

## Codebase Investigation Summary

### Libraries and Patterns Discovered

- **NestJS License Module**: `D:\projects\ptah-extension\apps\ptah-license-server\src\license\license.module.ts`

  - Controllers: `LicenseController`, `AdminController`
  - Service: `LicenseService`
  - Guards: `JwtAuthGuard` (JWT via `ptah_auth` cookie), `AdminApiKeyGuard`
  - Throttling: `@Throttle` decorator from `@nestjs/throttler` (verified in license.controller.ts:10, admin.controller.ts:2)
  - Logging: `Logger` from `@nestjs/common` (verified in license.service.ts:1, admin.controller.ts:1)

- **Angular Landing Page Profile**: `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\profile\`

  - Orchestrator: `ProfilePageComponent` (fetches data, manages state signals, delegates actions to child components)
  - Child: `ProfileDetailsComponent` (displays account details, emits action events via `output()`)
  - Pattern: Parent fetches data via `HttpClient`, passes to child via `input()`, child emits events via `output()`, parent handles API calls
  - State: Angular `signal()` for all state (no RxJS BehaviorSubject)
  - Icons: Lucide Angular (`lucide-angular`) - Eye, EyeOff, KeyRound, Copy all available (verified in auth-form.component.ts:13-14, social-login-buttons.component.ts:8)
  - Styling: DaisyUI + Tailwind (Anubis theme)
  - Animations: `@hive-academy/angular-gsap` ViewportAnimationDirective

- **Security Architecture**:

  - `GET /api/v1/licenses/me` explicitly excludes `licenseKey` (license.controller.ts:93 comment: "NEVER includes licenseKey in response - security risk")
  - Admin endpoint also excludes key from response (admin.controller.ts:98-99)
  - License key format: `ptah_lic_{64 hex characters}` (license.service.ts:410)
  - JWT auth via `ptah_auth` HTTP-only cookie (jwt-auth.guard.ts:45)
  - Global rate limit: 100 req/min, endpoint-specific overrides via `@Throttle` (app.module.ts:43-49)

- **Prisma Schema**: License model has `licenseKey` (unique, indexed), `userId`, `status`, `plan` fields (schema.prisma:60-76)

### Patterns Extracted

**Backend Controller Pattern** (from license.controller.ts):

```typescript
@Get('endpoint')
@UseGuards(JwtAuthGuard)
async method(@Req() req: Request) {
  const user = req.user as { id: string; email: string };
  // Prisma query using user.id
  // Return JSON response
}
```

**Backend Throttle Pattern** (from license.controller.ts:57):

```typescript
@Throttle({ default: { limit: 10, ttl: 60000 } })
```

**Backend Logger Pattern** (from license.service.ts:78, admin.controller.ts:23):

```typescript
private readonly logger = new Logger(ClassName.name);
this.logger.log(`message`);
this.logger.warn(`message`);
```

**Frontend Parent-Child Pattern** (from profile-page.component.ts + profile-details.component.ts):

- Parent: `signal()` state, `HttpClient` calls, passes data via template bindings
- Child: `input()` for data, `output()` for events, emits on button click
- Parent handles API call in response to child event emission

**Frontend Eye Toggle Pattern** (from auth-form.component.ts:150-161):

```typescript
public readonly showPassword = signal(false);
public togglePasswordVisibility(): void {
  this.showPassword.update((show) => !show);
}
// Template: [img]="showPassword() ? EyeOffIcon : EyeIcon"
```

**Frontend Button Loading Pattern** (from profile-details.component.ts:200-208):

```typescript
@if (isSyncing()) {
  <span class="loading loading-spinner loading-xs"></span>
  Syncing...
} @else {
  Sync with Paddle
}
```

### Integration Points Verified

1. **JwtAuthGuard**: `D:\projects\ptah-extension\apps\ptah-license-server\src\app\auth\guards\jwt-auth.guard.ts` - Populates `req.user` with `{ id, email }` (line 62)
2. **PrismaService**: `D:\projects\ptah-extension\apps\ptah-license-server\src\prisma\prisma.service.ts` - Already injected in LicenseController (line 30)
3. **LicenseData Interface**: `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\profile\models\license-data.interface.ts` - Frontend type contract
4. **Lucide Icons**: `Eye`, `EyeOff` (auth-form.component.ts:13-14), `KeyRound` (social-login-buttons.component.ts:8), `Copy`/`ClipboardCopy` from lucide-angular
5. **HttpClient**: Used by ProfilePageComponent for API calls (profile-page.component.ts:168, 210, 282)

---

## Architecture Design (Codebase-Aligned)

### Design Philosophy

**Chosen Approach**: Dedicated secure endpoint + parent-child event delegation pattern
**Rationale**: The existing `/me` endpoint intentionally excludes the license key for security. A separate endpoint with stricter rate limiting provides controlled access. The frontend follows the established pattern where the parent component handles API calls and the child component emits events.
**Evidence**: Same pattern used for "Sync with Paddle" (profile-page.component.ts:304-352) and "Manage Subscription" (profile-page.component.ts:360-386)

### Component Specifications

---

#### Component 1: Backend Endpoint - `POST /api/v1/licenses/me/reveal-key`

**Purpose**: Secure, authenticated, rate-limited endpoint that returns the user's active license key. Uses POST (not GET) to avoid accidental caching, URL logging, and browser history exposure of sensitive data.

**Pattern**: NestJS controller method with JwtAuthGuard + Throttle decorator
**Evidence**: Same pattern as `GET /me` endpoint (license.controller.ts:96-200) and verify endpoint (license.controller.ts:57-61)

**Responsibilities**:

- Authenticate user via JWT (ptah_auth cookie)
- Rate limit to 3 requests per minute (stricter than standard endpoints)
- Find user's active license via Prisma
- Return the license key (masked + full) with plan info
- Log the access event for audit trail
- Return appropriate error if no active license exists

**Implementation Pattern**:

```typescript
// Pattern source: license.controller.ts:96-200 (getMyLicense method)
// Throttle pattern: license.controller.ts:57 (verify endpoint)
// Guard pattern: license.controller.ts:97 (UseGuards)

@Throttle({ default: { limit: 3, ttl: 60000 } })  // 3 req/min - strict for sensitive data
@Post('me/reveal-key')
@UseGuards(JwtAuthGuard)
async revealMyLicenseKey(@Req() req: Request) {
  const user = req.user as { id: string; email: string };

  // Find user's active license (same query pattern as getMyLicense)
  const license = await this.prisma.license.findFirst({
    where: {
      userId: user.id,
      status: 'active',
    },
    orderBy: {
      createdAt: 'desc',
    },
  });

  if (!license) {
    return {
      success: false,
      message: 'No active license found',
    };
  }

  // Audit log
  this.logger.log(
    `License key revealed: userId=${user.id}, licenseId=${license.id}, plan=${license.plan}`
  );

  return {
    success: true,
    licenseKey: license.licenseKey,
    plan: license.plan,
  };
}
```

**Quality Requirements**:

- Must require JWT authentication (JwtAuthGuard)
- Must rate limit to 3 requests per minute per IP
- Must log every access for audit trail
- Must only return keys for the authenticated user's own licenses
- Must return appropriate response when no active license exists

**Files Affected**:

- `D:\projects\ptah-extension\apps\ptah-license-server\src\license\controllers\license.controller.ts` (MODIFY - add revealMyLicenseKey method)

---

#### Component 2: Backend - Add Logger to LicenseController

**Purpose**: The LicenseController currently lacks a Logger instance (unlike LicenseService and AdminController which both have one). Adding a logger is required for audit logging of key reveal events.

**Pattern**: NestJS Logger pattern
**Evidence**: LicenseService (license.service.ts:78), AdminController (admin.controller.ts:23)

**Implementation Pattern**:

```typescript
// Pattern source: admin.controller.ts:23
private readonly logger = new Logger(LicenseController.name);
```

**Files Affected**:

- `D:\projects\ptah-extension\apps\ptah-license-server\src\license\controllers\license.controller.ts` (MODIFY - add Logger import and instance)

---

#### Component 3: Frontend - ProfilePageComponent Enhancements

**Purpose**: Add license key retrieval state management and API call handling to the parent orchestrator component. Follows the established pattern where the parent handles all HTTP calls and manages state signals.

**Pattern**: Same pattern as handleSyncWithPaddle and handleManageSubscription
**Evidence**: profile-page.component.ts:304-352 (handleSyncWithPaddle), profile-page.component.ts:360-386 (handleManageSubscription)

**Responsibilities**:

- Add state signals for license key retrieval (licenseKey, isRevealingKey, revealKeyError)
- Add handler method `handleRevealLicenseKey()` that calls the backend endpoint
- Pass state down to ProfileDetailsComponent via input bindings
- Handle loading/error/success states

**Implementation Pattern**:

```typescript
// Pattern source: profile-page.component.ts:177-184 (signal state)
// Pattern source: profile-page.component.ts:304-352 (handleSyncWithPaddle)

// New state signals
public readonly licenseKey = signal<string | null>(null);
public readonly isRevealingKey = signal(false);
public readonly revealKeyError = signal<string | null>(null);

// Handler for child event
public handleRevealLicenseKey(): void {
  this.isRevealingKey.set(true);
  this.revealKeyError.set(null);

  this.http
    .post<{ success: boolean; licenseKey?: string; message?: string }>(
      '/api/v1/licenses/me/reveal-key',
      {}
    )
    .subscribe({
      next: (response) => {
        this.isRevealingKey.set(false);
        if (response.success && response.licenseKey) {
          this.licenseKey.set(response.licenseKey);
        } else {
          this.revealKeyError.set(response.message || 'Failed to retrieve license key');
        }
      },
      error: (error) => {
        this.isRevealingKey.set(false);
        if (error.status === 429) {
          this.revealKeyError.set('Too many requests. Please wait a moment and try again.');
        } else {
          this.revealKeyError.set(
            error.error?.message || 'Failed to retrieve license key. Please try again.'
          );
        }
      },
    });
}
```

**Template additions** (inside `<ptah-profile-details>` binding):

```html
<ptah-profile-details [license]="license()" [isSyncing]="isSyncing()" [syncError]="syncError()" [syncSuccess]="syncSuccess()" [licenseKey]="licenseKey()" [isRevealingKey]="isRevealingKey()" [revealKeyError]="revealKeyError()" (syncRequested)="handleSyncWithPaddle()" (manageSubscriptionRequested)="handleManageSubscription()" (revealKeyRequested)="handleRevealLicenseKey()" />
```

**Quality Requirements**:

- Must handle 429 (rate limit) error with user-friendly message
- Must handle network errors gracefully
- Must clear error state before new request
- Must follow existing signal-based state management pattern

**Files Affected**:

- `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\profile\profile-page.component.ts` (MODIFY)

---

#### Component 4: Frontend - ProfileDetailsComponent License Key UI

**Purpose**: Add "License Key" row to the Account Details card with reveal/hide toggle, copy-to-clipboard, and loading state. Only visible when user has an active license (status is not 'none').

**Pattern**: Existing row pattern from Account Details card + Eye toggle from auth-form.component.ts
**Evidence**:

- Row layout: profile-details.component.ts:94-105 (Email row pattern)
- Eye toggle: auth-form.component.ts:150-161 (showPassword toggle)
- Button loading: profile-details.component.ts:200-208 (Sync button loading)
- Icons: Eye/EyeOff (auth-form.component.ts:13-14), KeyRound (social-login-buttons.component.ts:8)

**Responsibilities**:

- Accept new inputs: `licenseKey`, `isRevealingKey`, `revealKeyError`
- Emit new output: `revealKeyRequested`
- Display "License Key" row after "Current Plan" row
- Before key is fetched: show "Get License Key" button
- While loading: show spinner
- After key is fetched: show masked key (dots) with Eye toggle to reveal, plus Copy button
- Show error messages when retrieval fails
- Show "Copied!" feedback after clipboard copy
- Only show the row when user has an active license (`license()?.status !== 'none'`)

**Implementation Pattern**:

```typescript
// New inputs (pattern: profile-details.component.ts:257-263)
public readonly licenseKey = input<string | null>(null);
public readonly isRevealingKey = input<boolean>(false);
public readonly revealKeyError = input<string | null>(null);

// New output (pattern: profile-details.component.ts:265-266)
public readonly revealKeyRequested = output<void>();

// Local state for show/hide toggle (pattern: auth-form.component.ts:291)
public readonly showLicenseKey = signal(false);
public readonly copiedToClipboard = signal(false);

// Toggle visibility (pattern: auth-form.component.ts:332-334)
public toggleLicenseKeyVisibility(): void {
  this.showLicenseKey.update((show) => !show);
}

// Copy to clipboard
public async copyLicenseKey(): Promise<void> {
  const key = this.licenseKey();
  if (key) {
    await navigator.clipboard.writeText(key);
    this.copiedToClipboard.set(true);
    setTimeout(() => this.copiedToClipboard.set(false), 2000);
  }
}

// Mask key for display
public getMaskedKey(): string {
  const key = this.licenseKey();
  if (!key) return '';
  // Show first 12 chars, mask the rest
  return key.substring(0, 12) + '...' + key.substring(key.length - 4);
}
```

**Template pattern** (inserted after Plan row, before Plan Description):

```html
<!-- License Key Row -->
@if (license()?.status !== 'none') {
<div class="px-6 py-4 flex justify-between items-center">
  <span class="text-neutral-content flex items-center gap-2">
    <lucide-angular [img]="KeyRoundIcon" class="w-4 h-4" aria-hidden="true" />
    License Key
  </span>

  @if (licenseKey()) {
  <!-- Key revealed - show with toggle and copy -->
  <div class="flex items-center gap-2">
    <code class="text-xs font-mono bg-base-300 px-2 py-1 rounded select-all max-w-[200px] truncate"> {{ showLicenseKey() ? licenseKey() : getMaskedKey() }} </code>
    <button type="button" (click)="toggleLicenseKeyVisibility()" class="btn btn-xs btn-ghost" [attr.aria-label]="showLicenseKey() ? 'Hide license key' : 'Show license key'">
      <lucide-angular [img]="showLicenseKey() ? EyeOffIcon : EyeIcon" class="w-3.5 h-3.5" aria-hidden="true" />
    </button>
    <button type="button" (click)="copyLicenseKey()" class="btn btn-xs btn-ghost" aria-label="Copy license key">
      @if (copiedToClipboard()) {
      <lucide-angular [img]="CheckCircleIcon" class="w-3.5 h-3.5 text-success" aria-hidden="true" />
      } @else {
      <lucide-angular [img]="CopyIcon" class="w-3.5 h-3.5" aria-hidden="true" />
      }
    </button>
  </div>
  } @else {
  <!-- Key not yet fetched - show reveal button -->
  <button class="btn btn-sm btn-ghost" [disabled]="isRevealingKey()" (click)="revealKeyRequested.emit()">
    @if (isRevealingKey()) {
    <span class="loading loading-spinner loading-xs"></span>
    Retrieving... } @else { Get License Key }
  </button>
  }
</div>
}

<!-- License Key Error -->
@if (revealKeyError()) {
<div class="px-6 py-3 flex items-center gap-2 bg-error/10 text-error">
  <lucide-angular [img]="AlertCircleIcon" class="w-4 h-4" aria-hidden="true" />
  <span class="text-sm">{{ revealKeyError() }}</span>
</div>
}
```

**New Lucide icon imports needed** (verify from lucide-angular package):

- `KeyRound` - Already used in codebase (social-login-buttons.component.ts:8)
- `Eye` - Already used in codebase (auth-form.component.ts:13)
- `EyeOff` - Already used in codebase (auth-form.component.ts:14)
- `Copy` - Available in lucide-angular (standard icon)

**Quality Requirements**:

- License key must be masked by default after retrieval
- Copy-to-clipboard must use `navigator.clipboard.writeText()` (browser standard)
- Must show "Copied!" feedback for 2 seconds
- Must handle missing/null license key gracefully
- Row must only appear when user has an active license
- Accessibility: All buttons must have `aria-label` attributes

**Files Affected**:

- `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\profile\components\profile-details.component.ts` (MODIFY)

---

## Integration Architecture

### Data Flow

```
User clicks "Get License Key"
  --> ProfileDetailsComponent emits revealKeyRequested
    --> ProfilePageComponent.handleRevealLicenseKey()
      --> POST /api/v1/licenses/me/reveal-key (with ptah_auth cookie)
        --> LicenseController.revealMyLicenseKey()
          --> JwtAuthGuard validates JWT
          --> Throttle checks rate limit (3/min)
          --> Prisma query for user's active license
          --> Logger records audit event
          --> Returns { success: true, licenseKey, plan }
      --> ProfilePageComponent updates licenseKey signal
    --> ProfileDetailsComponent receives key via input()
      --> Displays masked key with Eye toggle + Copy button
```

### Request/Response Contract

**Request**: `POST /api/v1/licenses/me/reveal-key`

- Headers: Cookie `ptah_auth=<jwt_token>` (automatic via HttpOnly cookie)
- Body: `{}` (empty - user identity from JWT)

**Response (success)**:

```json
{
  "success": true,
  "licenseKey": "ptah_lic_abc123...def456",
  "plan": "pro"
}
```

**Response (no license)**:

```json
{
  "success": false,
  "message": "No active license found"
}
```

**Response (rate limited)**: HTTP 429 with Retry-After header

**Response (unauthenticated)**: HTTP 401

---

## Quality Requirements (Architecture-Level)

### Functional Requirements

- Authenticated users can retrieve their own active license key
- License key is displayed masked by default with toggle to reveal
- Users can copy the key to clipboard with visual confirmation
- Feature is only visible to users with an active license
- Rate limiting prevents abuse (3 requests per minute)

### Non-Functional Requirements

- **Security**: Key retrieval requires JWT auth; POST method prevents URL/cache leakage; rate limiting prevents brute-force enumeration; audit logging for compliance
- **Performance**: Single Prisma query with indexed fields (userId + status); response < 200ms target
- **Accessibility**: All buttons have aria-labels; keyboard navigable; screen reader compatible
- **UX**: Loading spinner during fetch; clear error messages; 2-second "Copied!" feedback; masked key by default

### Pattern Compliance

- Backend follows NestJS controller pattern with JwtAuthGuard + Throttle (verified at license.controller.ts:57-97)
- Frontend follows parent-child event delegation pattern (verified at profile-page.component.ts:304-386)
- Frontend uses Angular signal() state management (verified at profile-page.component.ts:177-184)
- Frontend uses input()/output() for component communication (verified at profile-details.component.ts:257-266)
- Icons use Lucide Angular pattern (verified across multiple components)
- Styling uses DaisyUI + Tailwind (verified throughout profile components)

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: Both (backend-developer for endpoint, frontend-developer for UI)

**Rationale**:

- Backend work: NestJS controller modification, rate limiting, audit logging
- Frontend work: Angular component modifications, signal state management, UI layout, clipboard API
- Both scopes are relatively contained and can be worked in parallel or sequentially

### Complexity Assessment

**Complexity**: LOW-MEDIUM
**Estimated Effort**: 2-4 hours

**Breakdown**:

- Backend endpoint: ~30 min (single method addition to existing controller)
- Frontend ProfilePageComponent: ~45 min (state signals, handler method, template bindings)
- Frontend ProfileDetailsComponent: ~1.5 hours (new row UI, icon imports, show/hide toggle, copy functionality, error display)
- Testing and verification: ~30 min

### Files Affected Summary

**MODIFY** (4 files):

1. `D:\projects\ptah-extension\apps\ptah-license-server\src\license\controllers\license.controller.ts` - Add `revealMyLicenseKey` method with Logger, JwtAuthGuard, Throttle
2. `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\profile\profile-page.component.ts` - Add state signals, handler method, template bindings
3. `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\profile\components\profile-details.component.ts` - Add License Key row UI with inputs/outputs, toggle, copy
4. `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\profile\models\license-data.interface.ts` - No changes needed (key comes from separate endpoint, not `/me`)

**NO NEW FILES REQUIRED** - All changes fit within existing file structure.

### Critical Verification Points

**Before Implementation, Developer Must Verify**:

1. **All imports exist in codebase**:

   - `JwtAuthGuard` from `../../app/auth/guards/jwt-auth.guard` (license.controller.ts:14)
   - `Throttle` from `@nestjs/throttler` (license.controller.ts:10)
   - `Logger` from `@nestjs/common` (license.service.ts:1)
   - `PrismaService` from `../../prisma/prisma.service` (license.controller.ts:15)
   - `Eye`, `EyeOff` from `lucide-angular` (auth-form.component.ts:13-14)
   - `KeyRound` from `lucide-angular` (social-login-buttons.component.ts:8)
   - `Copy` from `lucide-angular` (verify available in lucide-angular package)

2. **All patterns verified from examples**:

   - Controller method with guards: license.controller.ts:96-200
   - Throttle decorator usage: license.controller.ts:57
   - Signal state management: profile-page.component.ts:177-184
   - Parent-child event pattern: profile-page.component.ts:105-112 (template), 304-386 (handlers)
   - Eye toggle pattern: auth-form.component.ts:150-161, 291, 332-334
   - Button loading state: profile-details.component.ts:200-208

3. **Library documentation consulted**:

   - `D:\projects\ptah-extension\apps\ptah-license-server\CLAUDE.md`
   - `D:\projects\ptah-extension\apps\ptah-landing-page\CLAUDE.md`

4. **No hallucinated APIs**:
   - `@UseGuards(JwtAuthGuard)` verified: license.controller.ts:97
   - `@Throttle({ default: { limit: N, ttl: N } })` verified: license.controller.ts:57
   - `Logger` verified: license.service.ts:1,78
   - `this.prisma.license.findFirst()` verified: license.controller.ts:121-129
   - `input()` / `output()` verified: profile-details.component.ts:257-266
   - `signal()` verified: profile-page.component.ts:177-184
   - `navigator.clipboard.writeText()` is browser standard API (landing page runs in browser)

### Architecture Delivery Checklist

- [x] All components specified with evidence
- [x] All patterns verified from codebase
- [x] All imports/decorators verified as existing
- [x] Quality requirements defined
- [x] Integration points documented
- [x] Files affected list complete
- [x] Developer type recommended
- [x] Complexity assessed
- [x] No step-by-step implementation (that is the team-leader's job)
- [x] Request/response contract defined
- [x] Security considerations addressed (rate limiting, audit logging, JWT auth, POST method)
- [x] Error handling specified (429, 401, no-license, network errors)
