# Development Tasks - TASK_2025_134

**Total Tasks**: 4 | **Batches**: 2 | **Status**: 2/2 complete

---

## Plan Validation Summary

**Validation Status**: PASSED

### Assumptions Verified

- JwtAuthGuard populates `req.user` with `{ id: string; email: string }`: VERIFIED (license.controller.ts:99)
- Throttle decorator syntax `{ default: { limit: N, ttl: N } }`: VERIFIED (license.controller.ts:57)
- PrismaService already injected in LicenseController constructor: VERIFIED (license.controller.ts:30)
- Logger import from `@nestjs/common`: VERIFIED (license.service.ts:1)
- ProfileDetailsComponent uses `input()`/`output()` pattern: VERIFIED (profile-details.component.ts:257-266)
- ProfilePageComponent uses `signal()` state + HttpClient pattern: VERIFIED (profile-page.component.ts:177-184, 304-352)
- LicenseData interface does NOT include licenseKey (separate endpoint): VERIFIED (license-data.interface.ts)
- License status includes `'none'` for conditional rendering: VERIFIED (license-data.interface.ts:64)

### Risks Identified

| Risk                                               | Severity | Mitigation                                                                 |
| -------------------------------------------------- | -------- | -------------------------------------------------------------------------- |
| Logger not currently imported in LicenseController | LOW      | Add Logger to existing `@nestjs/common` import in Task 1.1                 |
| Copy icon from lucide-angular needs verification   | LOW      | Developer must verify `Copy` export; fallback to `ClipboardCopy` if needed |

### Edge Cases to Handle

- [x] User has no active license (status is 'none') -> Hide License Key row entirely (Task 2.2) -- VERIFIED
- [x] Rate limit hit (429 response) -> Show user-friendly retry message (Task 2.1) -- VERIFIED
- [x] Network error during key retrieval -> Show generic error with retry option (Task 2.1) -- VERIFIED
- [x] Clipboard API unavailable -> Acceptable for modern browser target (Task 2.2) -- VERIFIED

---

## Batch 1: Backend - License Key Reveal Endpoint COMPLETE

**Developer**: backend-developer
**Tasks**: 2 | **Dependencies**: None

### Task 1.1: Add Logger and reveal-key endpoint to LicenseController COMPLETE

**File**: `D:\projects\ptah-extension\apps\ptah-license-server\src\license\controllers\license.controller.ts`
**Spec Reference**: implementation-plan.md: Components 1 and 2 (lines 111-196)
**Pattern to Follow**: Same file, `getMyLicense` method at lines 96-200, `verify` method at lines 57-61

**Quality Requirements**:

- Must add `Logger` to the `@nestjs/common` import (line 1-9)
- Must add `private readonly logger = new Logger(LicenseController.name)` as class property
- Must add `Post` to imports if not already present (it IS already imported at line 3)
- Must use `@Throttle({ default: { limit: 3, ttl: 60000 } })` for strict rate limiting (3 req/min)
- Must use `@Post('me/reveal-key')` route
- Must use `@UseGuards(JwtAuthGuard)` for authentication
- Must extract user from `req.user as { id: string; email: string }`
- Must query `this.prisma.license.findFirst()` with `where: { userId: user.id, status: 'active' }` and `orderBy: { createdAt: 'desc' }`
- Must log the access event: `this.logger.log(...)` with userId, licenseId, plan
- Must return `{ success: true, licenseKey: license.licenseKey, plan: license.plan }` on success
- Must return `{ success: false, message: 'No active license found' }` when no license exists

**Validation Notes**:

- Logger is NOT currently in the controller imports -- must be added to the existing `@nestjs/common` import block
- `Post` is already imported (line 3) -- no need to add it
- PrismaService is already injected (line 30) -- use `this.prisma`
- Place the new method AFTER the existing `getMyLicense` method (after line 200)

**Implementation Details**:

- Imports: Add `Logger` to `@nestjs/common` import at line 1
- Class property: `private readonly logger = new Logger(LicenseController.name);` after constructor
- New method: `revealMyLicenseKey(@Req() req: Request)` with Throttle, Post, UseGuards decorators
- Query: Same Prisma pattern as getMyLicense lines 121-129
- Return: JSON with success boolean, licenseKey, plan

---

### Task 1.2: Verify endpoint works with existing guards and throttling COMPLETE

**File**: `D:\projects\ptah-extension\apps\ptah-license-server\src\license\controllers\license.controller.ts`
**Dependencies**: Task 1.1

**Quality Requirements**:

- Verify the new method compiles without TypeScript errors
- Verify the route does not conflict with existing routes (`verify`, `me`)
- Verify the Throttle decorator is correctly placed (before the method decorator)
- Verify the method signature matches the established pattern

**Validation Notes**:

- This is a verification task -- the developer should read the final file state and confirm correctness
- Route `me/reveal-key` is a sub-path of the `v1/licenses` controller prefix, so full path is `POST /api/v1/licenses/me/reveal-key`
- No conflict with `GET /api/v1/licenses/me` because different HTTP method and sub-path

---

**Batch 1 Verification**:

- File exists at path: `D:\projects\ptah-extension\apps\ptah-license-server\src\license\controllers\license.controller.ts`
- Build passes: `npx nx build ptah-license-server`
- code-logic-reviewer approved
- Logger added and used for audit trail
- Throttle set to 3 req/min (stricter than default 10)

---

## Batch 2: Frontend - Profile Page License Key UI COMPLETE

**Developer**: frontend-developer
**Tasks**: 2 | **Dependencies**: Batch 1

### Task 2.1: Add license key state management and API handler to ProfilePageComponent COMPLETE

**File**: `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\profile\profile-page.component.ts`
**Spec Reference**: implementation-plan.md: Component 3 (lines 199-278)
**Pattern to Follow**: Same file, `handleSyncWithPaddle` method at lines 304-352

**Quality Requirements**:

- Must add 3 new state signals after existing sync signals (after line 184):
  - `public readonly licenseKey = signal<string | null>(null);`
  - `public readonly isRevealingKey = signal(false);`
  - `public readonly revealKeyError = signal<string | null>(null);`
- Must add `handleRevealLicenseKey()` method following the same pattern as `handleSyncWithPaddle`
- Must handle 429 status with user-friendly message: "Too many requests. Please wait a moment and try again."
- Must handle generic errors with: `error.error?.message || 'Failed to retrieve license key. Please try again.'`
- Must clear error state before new request: `this.revealKeyError.set(null)`
- Must update template bindings on `<ptah-profile-details>` to pass new signals and bind new event:
  - `[licenseKey]="licenseKey()"`
  - `[isRevealingKey]="isRevealingKey()"`
  - `[revealKeyError]="revealKeyError()"`
  - `(revealKeyRequested)="handleRevealLicenseKey()"`

**Validation Notes**:

- The HTTP call uses `POST` (not GET) to `/api/v1/licenses/me/reveal-key` with empty body `{}`
- Response type: `{ success: boolean; licenseKey?: string; message?: string; plan?: string }`
- Follow exact same subscribe pattern as handleSyncWithPaddle (next/error callbacks)
- The `withCredentials` is handled by Angular's HttpClient interceptor for same-origin cookies

**Implementation Details**:

- Imports: No new imports needed (HttpClient and signal already imported)
- State signals: 3 new signals after line 184
- Handler method: `handleRevealLicenseKey()` placed after `handleManageSubscription()` (after line 386)
- Template: Update `<ptah-profile-details>` bindings at lines 105-112

---

### Task 2.2: Add License Key row UI to ProfileDetailsComponent COMPLETE

**File**: `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\profile\components\profile-details.component.ts`
**Spec Reference**: implementation-plan.md: Component 4 (lines 282-430)
**Pattern to Follow**: Same file, Email row at lines 94-105, Sync button at lines 200-208, Eye toggle from auth-form.component.ts:150-161
**Dependencies**: Task 2.1

**Quality Requirements**:

- Must add new icon imports: `Eye`, `EyeOff`, `KeyRound`, `Copy` from `lucide-angular`
- Must add icon class properties: `EyeIcon`, `EyeOffIcon`, `KeyRoundIcon`, `CopyIcon`
- Must add 3 new inputs: `licenseKey`, `isRevealingKey`, `revealKeyError`
- Must add 1 new output: `revealKeyRequested`
- Must add local state signals: `showLicenseKey = signal(false)`, `copiedToClipboard = signal(false)`
- Must add methods: `toggleLicenseKeyVisibility()`, `copyLicenseKey()`, `getMaskedKey()`
- Must add `signal` to `@angular/core` import
- Template: License Key row inserted AFTER the Plan row (after line 118) and BEFORE Plan Description (line 121)
- Template: Error row for `revealKeyError()` after the License Key row
- Row only visible when `license()?.status !== 'none'`
- Key masked by default showing first 12 chars + '...' + last 4 chars
- Eye toggle to show/hide full key
- Copy button with 2-second "Copied!" feedback using CheckCircle icon (already imported)
- Loading spinner when `isRevealingKey()` is true
- All buttons must have `aria-label` attributes for accessibility

**Validation Notes**:

- `CheckCircle` and `AlertCircle` are already imported (lines 19-20) -- reuse for feedback
- `signal` is NOT currently imported in this file -- must be added to `@angular/core` import
- The `Copy` icon from lucide-angular -- developer must verify the exact export name; if `Copy` is not available, use `ClipboardCopy` or `Clipboard`
- `navigator.clipboard.writeText()` is available in all modern browsers (landing page target)
- Template uses `@if` control flow (Angular 17+ syntax already used in this file)

**Implementation Details**:

- Imports: Add `Eye`, `EyeOff`, `KeyRound`, `Copy` to lucide-angular import; add `signal` to `@angular/core` import
- Icon properties: 4 new readonly properties after line 254
- Inputs: 3 new inputs after line 262
- Output: 1 new output after line 266
- Local state: 2 new signal properties
- Methods: 3 new methods (toggleLicenseKeyVisibility, copyLicenseKey, getMaskedKey)
- Template: ~40 lines of new template code inserted after Current Plan row

---

**Batch 2 Verification**:

- All files exist at paths
- Build passes: `npx nx build ptah-landing-page`
- code-logic-reviewer approved
- New inputs/outputs correctly wired between parent and child
- License Key row only visible for active licenses
- Eye toggle, copy, and loading states all functional
- Accessibility: aria-labels on all interactive elements
- Edge cases from validation handled (429, no license, clipboard)
