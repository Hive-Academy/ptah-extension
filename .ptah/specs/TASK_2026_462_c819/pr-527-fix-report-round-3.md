# PR 527 fix report — round 3

## Finding 1 — FIXED

**Reason:** The debounced search subscription is now bound to the component lifecycle with `takeUntilDestroyed(this.destroyRef)`, preventing a queued debounce from navigating after destruction. The existing `ngOnDestroy` remains responsible for cancelling matching selection work.

**File:** `libs/web/admin/src/lib/waitlist/waitlist-pipeline.ts:156`, `libs/web/admin/src/lib/waitlist/waitlist-pipeline.ts:354`

**Pinning test:** `libs/web/admin/src/lib/waitlist/waitlist-pipeline.spec.ts:254` enters a search term, destroys the fixture before 300 ms, advances the fake timer, and asserts that `router.navigate` was not called.

## Finding 2 — FIXED

**Reason:** The complex ISO expression was split into module-level date-only and date-time patterns while retaining the `Date.parse` validity check and the accepted input behavior.

**File:** `libs/web/admin/src/lib/waitlist/waitlist-query-state.ts:56`, `libs/web/admin/src/lib/waitlist/waitlist-query-state.ts:247`

**Pinning test:** `libs/web/admin/src/lib/waitlist/waitlist-query-state.spec.ts:32` covers a valid date-time with an offset and a valid date-time with milliseconds plus `Z`.

## Finding 3 — FIXED

**Reason:** Both previously untyped fenced prose blocks now use the `text` info string; no fenced content was changed.

**File:** `.ptah/specs/TASK_2026_462_c819/pr-527-feedback-round-2.md:18`, `.ptah/specs/TASK_2026_462_c819/pr-527-feedback-round-2.md:92`

**Pinning check:** A fence audit found two opening fences, both tagged `text`, with their two closing fences unchanged. A standalone markdownlint executable is not installed in the workspace.

## Verification

Command: `npx nx run-many -t typecheck,test,lint -p web-admin`

- Tests: 24 suites passed; 294 tests passed; 0 failed; 0 snapshots.
- Typecheck: 1 target passed; 0 errors.
- Lint: 1 target passed; 0 errors and 8 warnings. All 8 warnings are pre-existing and occur in unrelated `admin-detail.html`, `delete-user-modal.ts`, and `issue-comp-license-modal.ts` files.
