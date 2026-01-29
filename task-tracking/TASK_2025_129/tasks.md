# Development Tasks - TASK_2025_129: Authentication Settings Improvements

**Total Tasks**: 9 | **Batches**: 2 | **Status**: 2/2 complete

---

## Plan Validation Summary

**Validation Status**: PASSED

### Assumptions Verified

- `ProOnlyFeature` type union at feature-gate.service.ts:29-35 contains `openrouter_proxy`: VERIFIED
- `PRO_ONLY_FEATURES` array at feature-gate.service.ts:59-66 contains `openrouter_proxy`: VERIFIED
- `PRO_ONLY_METHOD_PREFIXES` at rpc-handler.ts:83-88 contains `openrouter:`: VERIFIED
- Community plan features at plans.config.ts:18-25 does NOT contain `openrouter_proxy`: VERIFIED
- Prisma query at license.service.ts (server):101-113 already includes `user` with subscriptions: VERIFIED
- Return block at license.service.ts (server):212-222 does NOT include user data: VERIFIED
- `LicenseStatus` at license.service.ts (vscode-core):62-85 has no `user` field: VERIFIED
- `LicenseGetStatusResponse` at rpc.types.ts:575-598 has no `user` field: VERIFIED
- `mapLicenseStatusToResponse` at license-rpc.handlers.ts:179-196 does not forward user: VERIFIED
- Settings component signals pattern at settings.component.ts:74-95 uses Angular signals: VERIFIED
- Settings component fetchLicenseStatus at settings.component.ts:218-246 populates signals from RPC: VERIFIED
- Settings HTML License Status Card at settings.component.html:51-161 has tier badge ending at line 84: VERIFIED

### Risks Identified

| Risk                                                          | Severity | Mitigation                                                                                  |
| ------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------- |
| ProOnlyFeature type removal could break downstream references | LOW      | Grep confirmed no external code references `'openrouter_proxy'` as a ProOnlyFeature literal |
| Server `license.user` could theoretically be null             | LOW      | Prisma query has `include: { user }` on a required FK; add defensive `license.user ?` check |
| Community users without license key see empty profile section | EXPECTED | Template `@if (userEmail())` guard hides section when no user data                          |

### Edge Cases to Handle

- [ ] Community users (no license key) must not see user profile section -> Handled in Task 2.5 (template guard)
- [ ] Users with no first/last name should show email as display name -> Handled in Task 2.5 (computed signal fallback)
- [ ] Server null-safety for license.user -> Handled in Task 2.1 (defensive check)

---

## Batch 1: Remove OpenRouter Pro Gating -- COMPLETE

**Developer**: backend-developer
**Tasks**: 3 | **Dependencies**: None

### Task 1.1: Remove openrouter_proxy from feature gate type and array -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\vscode-core\src\services\feature-gate.service.ts`
**Spec Reference**: implementation-plan.md: Changes 1a, 1b, 1c, 1d

**Quality Requirements**:

- Remove `'openrouter_proxy'` from the `ProOnlyFeature` type union (line 32)
- Remove `'openrouter_proxy'` from the `PRO_ONLY_FEATURES` array (line 62)
- Update JSDoc at lines 18-27 to document openrouter_proxy as a Community feature
- Update `isProTier()` method JSDoc (lines 200-210) to remove "OpenRouter Proxy" from Pro-only list

**Implementation Details**:

- Type union: Remove `| 'openrouter_proxy'` line
- Array: Remove `'openrouter_proxy',` entry
- JSDoc: Add "Community features" section mentioning openrouter_proxy with TASK_2025_129 reference
- isProTier JSDoc: Remove "OpenRouter Proxy" bullet point

---

### Task 1.2: Remove openrouter: from RPC Pro-only method prefixes -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\vscode-core\src\messaging\rpc-handler.ts`
**Spec Reference**: implementation-plan.md: Changes 2a, 2b, 2c, 2d, 2e

**Quality Requirements**:

- Remove `'openrouter:'` from `PRO_ONLY_METHOD_PREFIXES` array (line 87)
- Update JSDoc block for `PRO_ONLY_METHOD_PREFIXES` (lines 65-82) to document openrouter as community
- Update class JSDoc at line 129 to remove `openrouter:*` from Pro-only methods list
- Update inline comment at line 382 to remove `openrouter:*`
- Update `isProOnlyMethod()` JSDoc (lines 420-428) to document openrouter as community

**Implementation Details**:

- Array: Remove `'openrouter:', // openrouter_proxy feature` line
- JSDoc (lines 65-82): Move `openrouter_proxy -> openrouter:` to a "Community features with RPC endpoints" section
- Line 129: Change `(setup-*, wizard:*, openrouter:*)` to `(setup-*, wizard:*)`
- Line 382: Change comment to remove `openrouter:*`
- isProOnlyMethod JSDoc: Add "Community methods (TASK_2025_129)" section

---

### Task 1.3: Add openrouter_proxy to community plan features -- COMPLETE

**File**: `D:\projects\ptah-extension\apps\ptah-license-server\src\config\plans.config.ts`
**Spec Reference**: implementation-plan.md: Change 3a

**Quality Requirements**:

- Add `'openrouter_proxy'` to the community plan's features array (after line 24)
- Keep `'openrouter_proxy'` in the pro plan features as well (no change needed there)
- Add inline comment referencing TASK_2025_129

**Implementation Details**:

- Add `'openrouter_proxy', // TASK_2025_129: Available to all users` after `'basic_workspace_context'` in community.features array
- Pro plan already has `'openrouter_proxy'` at line 38 -- no change needed

---

**Batch 1 Verification**:

- All 3 files exist at specified paths
- Type check passes: `npx nx typecheck vscode-core`
- Lint passes: `npx nx lint vscode-core` and `npx nx lint ptah-license-server`
- code-logic-reviewer approved
- `openrouter:*` RPC methods no longer blocked for Community users
- `setup-status:*`, `setup-wizard:*`, `wizard:*` remain Pro-gated

---

## Batch 2: Add User Profile Display in Settings -- COMPLETE

**Developer**: backend-developer
**Tasks**: 6 | **Dependencies**: Batch 1 complete

### Task 2.1: Add user field to server LicenseVerificationResponse -- COMPLETE

**File**: `D:\projects\ptah-extension\apps\ptah-license-server\src\license\services\license.service.ts`
**Spec Reference**: implementation-plan.md: Changes 1a, 1b (Batch 2 section)

**Quality Requirements**:

- Add optional `user` field to `LicenseVerificationResponse` interface (after line 34)
- Include `user` data in the valid license return block (lines 212-222)
- Add defensive null check for `license.user`
- No new Prisma query needed (user already included at line 101-113)

**Validation Notes**:

- Prisma query at line 101 already includes `user: { include: { subscriptions } }`
- The `license.user` object has `email`, `firstName`, `lastName` fields (verified from controller)
- Every license has a required `userId` FK, so `license.user` should always exist for valid licenses

**Implementation Details**:

- Interface: Add `user?: { email: string; firstName: string | null; lastName: string | null; }` with JSDoc
- Return block: Add `user: license.user ? { email: license.user.email, firstName: license.user.firstName, lastName: license.user.lastName } : undefined`

---

### Task 2.2: Add user field to extension LicenseStatus interface -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\vscode-core\src\services\license.service.ts`
**Spec Reference**: implementation-plan.md: Change 2a (Batch 2 section)

**Quality Requirements**:

- Add optional `user` field to `LicenseStatus` interface (after line 84)
- No changes to `verifyLicense()` method needed (response auto-parsed via `response.json()`)

**Validation Notes**:

- Server response is parsed with `const status: LicenseStatus = await response.json();` at line 260
- Adding optional `user` field is backwards-compatible (old responses without user still valid)
- Community fallback paths will correctly not have a `user` field

**Implementation Details**:

- Add `user?: { email: string; firstName?: string; lastName?: string; }` with JSDoc comment referencing TASK_2025_129

---

### Task 2.3: Add user field to LicenseGetStatusResponse RPC type -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc.types.ts`
**Spec Reference**: implementation-plan.md: Change 3a (Batch 2 section)

**Quality Requirements**:

- Add optional `user` field to `LicenseGetStatusResponse` interface (after line 597)
- Use same shape as vscode-core LicenseStatus.user but with optional firstName/lastName

**Implementation Details**:

- Add `user?: { email: string; firstName?: string; lastName?: string; }` with JSDoc comment referencing TASK_2025_129

---

### Task 2.4: Forward user data in license RPC handler mapping -- COMPLETE

**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\license-rpc.handlers.ts`
**Spec Reference**: implementation-plan.md: Change 4a (Batch 2 section)
**Dependencies**: Task 2.2, Task 2.3

**Quality Requirements**:

- Forward `status.user` to response in `mapLicenseStatusToResponse()` method (lines 179-196)
- Add defensive null check (`status.user ? { ... } : undefined`)
- Maintain existing return structure with user appended

**Implementation Details**:

- Add `user: status.user ? { email: status.user.email, firstName: status.user.firstName, lastName: status.user.lastName } : undefined` to the return object
- Add inline comment referencing TASK_2025_129

---

### Task 2.5: Add user profile signals and computed to settings component -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\settings\settings.component.ts`
**Spec Reference**: implementation-plan.md: Changes 5a, 5b, 5c (Batch 2 section)
**Dependencies**: Task 2.3

**Quality Requirements**:

- Add 3 user profile signals: `userEmail`, `userFirstName`, `userLastName` (after line 95)
- Add 2 computed signals: `userDisplayName`, `userInitials` (after line 143)
- Populate user signals in `fetchLicenseStatus()` success block (after line 233)
- Follow existing signal pattern exactly (signal<type>(initial))

**Validation Notes**:

- Edge case: Users with no first/last name -> `userDisplayName` falls back to email
- Edge case: Users with no email (impossible for valid licenses, but defensive) -> `userInitials` returns '?'

**Implementation Details**:

- Signals: `readonly userEmail = signal<string | null>(null);` (same pattern for firstName, lastName)
- `userDisplayName` computed: join first+last, fallback to email
- `userInitials` computed: first letter of first+last, fallback to first letter of email, fallback to '?'
- fetchLicenseStatus: Add `this.userEmail.set(data.user?.email ?? null);` etc. after line 233

---

### Task 2.6: Add user profile section to settings HTML template -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\settings\settings.component.html`
**Spec Reference**: implementation-plan.md: Change 6a (Batch 2 section)
**Dependencies**: Task 2.5

**Quality Requirements**:

- Add user profile section inside License Status Card between tier badge (line 84) and trial info (line 86)
- Conditionally display with `@if (userEmail())`
- Show initials avatar circle, display name (if different from email), and email
- Use existing DaisyUI/Tailwind classes consistent with surrounding code
- Must work at VS Code sidebar width (~300px) -- use `truncate` for overflow

**Implementation Details**:

- Wrap in `@if (userEmail()) { ... }` guard
- Avatar circle: `w-6 h-6 rounded-full bg-primary/20 text-primary text-xs font-bold`
- Display name: Show only if `userDisplayName() !== userEmail()`
- Email: Always shown with `text-base-content/50` muted style
- Use `min-w-0` and `truncate` for text overflow handling

---

**Batch 2 Verification**:

- All 6 files exist at specified paths
- Type check passes: `npx nx typecheck vscode-core`, `npx nx typecheck shared`, `npx nx typecheck ptah-extension-vscode`, `npx nx typecheck chat`
- Lint passes: `npx nx run-many --target=lint --projects=vscode-core,shared,chat,ptah-extension-vscode,ptah-license-server`
- code-logic-reviewer approved
- Edge cases from validation handled (null user, no name, community users)
- User profile hidden for Community users without license key

---

## Developer Prompt - Batch 1

```
You are assigned Batch 1 for TASK_2025_129: Remove OpenRouter Pro Gating.

**Task Folder**: D:\projects\ptah-extension\task-tracking\TASK_2025_129\

## Context

OpenRouter authentication is currently gated as a Pro-only feature. Community (free) users cannot use openrouter:* RPC methods because they are blocked by the RPC middleware. This batch removes that gating so OpenRouter is available to ALL users.

## Your Responsibilities

1. Read D:\projects\ptah-extension\task-tracking\TASK_2025_129\tasks.md - find Batch 1 (3 tasks)
2. Read D:\projects\ptah-extension\task-tracking\TASK_2025_129\implementation-plan.md for detailed code snippets
3. Implement ALL 3 tasks IN ORDER
4. Write REAL code (NO stubs, placeholders, TODOs)
5. Update each task status in tasks.md: PENDING -> IMPLEMENTED

## Files to Modify (3 files)

### File 1: D:\projects\ptah-extension\libs\backend\vscode-core\src\services\feature-gate.service.ts
- Remove `'openrouter_proxy'` from `ProOnlyFeature` type union (line 32)
- Remove `'openrouter_proxy'` from `PRO_ONLY_FEATURES` array (line 62)
- Update JSDoc at lines 18-27: move openrouter_proxy to a "Community features" section
- Update `isProTier()` JSDoc (lines 200-210): remove "OpenRouter Proxy" bullet

### File 2: D:\projects\ptah-extension\libs\backend\vscode-core\src\messaging\rpc-handler.ts
- Remove `'openrouter:'` from `PRO_ONLY_METHOD_PREFIXES` array (line 87)
- Update JSDoc for PRO_ONLY_METHOD_PREFIXES (lines 65-82): move openrouter to "Community features with RPC endpoints"
- Update class JSDoc line 129: remove `openrouter:*` from Pro-only list
- Update inline comment at line 382: remove `openrouter:*`
- Update `isProOnlyMethod()` JSDoc (lines 420-428): add Community methods section

### File 3: D:\projects\ptah-extension\apps\ptah-license-server\src\config\plans.config.ts
- Add `'openrouter_proxy'` to community plan features array (after 'basic_workspace_context' at line 24)
- Add inline comment: `// TASK_2025_129: Available to all users`
- Keep openrouter_proxy in pro plan features (no change needed)

## Testing Instructions

After implementing all changes:
1. Run `npx nx typecheck vscode-core` -- must pass with no errors
2. Run `npx nx lint vscode-core` -- must pass
3. Run `npx nx lint ptah-license-server` -- must pass

## CRITICAL RULES

- You do NOT create git commits (team-leader handles that)
- Focus 100% on code quality
- All changes must be REAL implementations, not stubs
- Refer to implementation-plan.md for exact before/after code snippets
- Use absolute Windows paths for all file operations

## Return Format

BATCH 1 IMPLEMENTATION COMPLETE
- Files modified: [list absolute paths]
- All tasks marked: IMPLEMENTED
- Ready for team-leader verification
```
