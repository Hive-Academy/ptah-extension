# Revise Round 1 Report — `TASK_2026_462_c819`

## Review Defect Remediation Summary

### Defect 1: Details Drawer Stale Response Race Condition

- **Status**: FIXED
- **File & Lines**: `libs/web/admin/src/lib/waitlist/waitlist-details-drawer.ts:36-38,76-84,102-126`
- **Fix Description**: Injected `DestroyRef`, stored in-flight `fetchSub: Subscription`, unsubscribed previous request before initiating a new fetch, unsubscribed on drawer close and component destruction, and added a guard ignoring responses whose `id !== this.entryId() || !this.open()`.
- **Pinning Test**: `libs/web/admin/src/lib/waitlist/waitlist-details-drawer.spec.ts:231-291` (`handles race condition when row A is slow and row B is fast (drawer shows B)`).

### Defect 2: URL Query State Generic Canonicalization

- **Status**: FIXED
- **File & Lines**:
  - `libs/web/admin/src/lib/waitlist/waitlist-query-state.ts:221-231,292-337`
  - `libs/web/admin/src/lib/waitlist/waitlist-pipeline.ts:97-100,277-291`
- **Fix Description**: Validated `createdFrom` and `createdTo` in `parseWaitlistQuery` via ISO parse validation. Exported `needsWaitlistQueryCanonicalization(rawParams, parsed)` comparing all 9 canonical keys plus legacy `tab`. Bound reactive `rawQueryParams` signal in `WaitlistPipeline` and canonicalized invalid/non-default URL parameters with a single `router.navigate([], { queryParams: serializeWaitlistQuery(q), replaceUrl: true })` without navigation loop.
- **Pinning Test**: `libs/web/admin/src/lib/waitlist/waitlist-pipeline.spec.ts:199-216` (`canonicalizes invalid values in URL using replaceUrl without navigation loop`).

### Defect 3: Debounced Search Navigation History Flooding

- **Status**: FIXED
- **File & Lines**: `libs/web/admin/src/lib/waitlist/waitlist-pipeline.ts:293-305,386-398`
- **Fix Description**: Extended `navigateWithFilters` to support an optional `extras?: { replaceUrl?: boolean }` argument; routed the debounced `searchInput$` subscriber through `navigateWithFilters(..., { replaceUrl: true })` so keystroke updates do not flood browser history.
- **Pinning Test**: `libs/web/admin/src/lib/waitlist/waitlist-pipeline.spec.ts:218-241` (`uses replaceUrl: true for debounced search navigation to avoid flooding history`).

### Defect 4: Selection 50-Item Ceiling & Limit Reached Signal

- **Status**: FIXED
- **File & Lines**:
  - `libs/web/admin/src/lib/waitlist/waitlist-selection.state.ts:41-44,76-88,120-137`
  - `libs/web/admin/src/lib/waitlist/waitlist-pipeline.html:88-92`
- **Fix Description**: Enforced `this.limit = 50` ceiling in `toggleRow` (preventing additions once 50 is reached) and `selectPage` (breaking addition at 50). Exposed `limitReached` (and `selectionLimitReached`) computed signal. Rendered a visible `"Selection limit of 50 reached"` warning badge in `waitlist-pipeline.html` inside the bulk action toolbar when the limit is reached.
- **Pinning Tests**:
  - `libs/web/admin/src/lib/waitlist/waitlist-selection.state.spec.ts:215-252` (`50-row selection limit and limitReached signal`)
  - `libs/web/admin/src/lib/waitlist/waitlist-pipeline.spec.ts:390-413` (`wraps selection toolbar in an aria-live="polite" status region and shows limit message when cap reached`)

### Defect 5: Primary Selection Count Live Announcement

- **Status**: FIXED
- **File & Lines**: `libs/web/admin/src/lib/waitlist/waitlist-pipeline.html:82-117`
- **Fix Description**: Wrapped the selection toolbar container in `waitlist-pipeline.html` (outside read-only `panel-ui`) in `<div aria-live="polite" role="status">...</div>` so that changes to the primary "N row(s) selected" count and the limit reached warning are announced to assistive technologies.
- **Pinning Test**: `libs/web/admin/src/lib/waitlist/waitlist-pipeline.spec.ts:390-413` (`wraps selection toolbar in an aria-live="polite" status region and shows limit message when cap reached`).

### Defect 6: Map 400 INVALID_DATE_RANGE to Filter Bar Slot

- **Status**: FIXED
- **File & Lines**:
  - `libs/web/admin/src/lib/waitlist/waitlist-pipeline.ts:62-101,201-220`
  - `libs/web/admin/src/lib/waitlist/waitlist-pipeline.html:71`
- **Fix Description**: Added `isInvalidDateRangeError` and `extractDateErrorMessage` helpers to classify 400 `INVALID_DATE_RANGE` responses in the pipeline's `response$` stream. Mapped such failures to `dateRangeError` signal while leaving `loadError` false (bypassing the generic list-error banner). Bound `[invalidDateError]="dateRangeError()"` to `<ptah-admin-waitlist-filter-bar>` in `waitlist-pipeline.html`.
- **Pinning Test**: `libs/web/admin/src/lib/waitlist/waitlist-pipeline.spec.ts:415-444` (`maps 400 INVALID_DATE_RANGE list response to filter bar input instead of generic load error banner`).

### Defect 7: Component-Scoped Injectable for WaitlistSelectionState

- **Status**: FIXED
- **File & Lines**: `libs/web/admin/src/lib/waitlist/waitlist-selection.state.ts:24-25`
- **Fix Description**: Removed `providedIn: 'root'` to keep `WaitlistSelectionState` component-scoped to `WaitlistPipeline`, with `@angular-eslint/use-injectable-provided-in` suppression comment following the established codebase pattern in `course-player.store.ts`.
- **Pinning Test**: `npx nx run-many -t lint -p web-admin` verified clean with 0 errors.

### Defect 8: Overview Dashboard waitlistUninvited Derivation Drift

- **Status**: FIXED
- **File & Lines**: `libs/web/admin/src/lib/overview/overview.ts:66-75`
- **Fix Description**: Updated `AdminOverview.waitlistUninvited` computed signal to read the authoritative server fields `s.attention?.waitlistUninvited ?? s.waitlist.new ?? 0` rather than the old `total - notified` formula that overcounted approved rows. Updated doc comment.
- **Pinning Test**: `libs/web/admin/src/lib/overview/overview.spec.ts:47-68` (`uses attention.waitlistUninvited from server rather than total - notified`, `falls back to waitlist.new when attention block is absent`).

### Defect 9: Approval Claim Loss Concurrency Race Outcome

- **Status**: FIXED
- **File & Lines**: `libs/api/marketing/src/lib/waitlist/waitlist.service.ts:272-290`
- **Fix Description**: When conditional `updateMany` returns `count: 0` in `claimForApproval`, re-read `approvedAt`/`convertedAt` via `tx.waitlist.findUnique` inside the active transaction. If the row vanished, returns `not_found`; if `convertedAt !== null`, returns `already_paid`; otherwise returns `already_approved`.
- **Pinning Test**: `libs/api/marketing/src/lib/waitlist/waitlist.service.spec.ts:347-396` (`handles payment race: row read unconverted, update count 0, re-read shows converted → already_paid`, `handles vanished row on claim loss: row read initially, update count 0, re-read shows null → not_found`).

### Defect 10: Date Range Validation Redundancy in AdminWaitlistService

- **Status**: FIXED
- **File & Lines**: `libs/api/admin/src/lib/admin-waitlist.service.ts:151-157,520-536`
- **Fix Description**: Added `validateDateRange` helper in `AdminWaitlistService` called once per `list()` request. Reused `where` for `countWhere` when `stage === 'all'` or unset, eliminating redundant reversed-date checking between page `where` and stage-count `countWhere`.
- **Pinning Test**: `libs/api/admin/src/lib/admin-waitlist.service.spec.ts:337-355` (`validates date range once and throws BadRequestException INVALID_DATE_RANGE when createdFrom > createdTo`).

---

## Verification Results

### Typecheck & Test (`npx nx run-many -t typecheck,test -p api-admin api-marketing web-admin`)

- **Projects**: 3 (`api-admin`, `api-marketing`, `web-admin`)
- **Typecheck**: 3/3 projects passed (0 errors)
- **Test Suites**: 29 passed, 29 total
  - `api-admin`: 5 passed, 5 total (128 tests passed)
  - `api-marketing`: 1 passed, 1 total (20 tests passed)
  - `web-admin`: 23 passed, 23 total (267 tests passed)
- **Total Tests**: 415 passed, 415 total (0 failed)

### Lint (`npx nx run-many -t lint -p web-admin`)

- **Project**: `web-admin`
- **Status**: PASSED (0 errors, 8 pre-existing warnings in untouched files)
