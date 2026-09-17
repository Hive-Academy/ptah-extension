# Batch B (Frontend) Report — TASK_2026_462_c819

## Summary

Implemented Components 5–8 of `TASK_2026_462_c819` for the Angular 21 admin panel (`web-admin`), introducing typed Zod boundary validation for the dedicated waitlist API, URL-authoritative filter and sort query state, 50-of-N selection and bulk approval, presentational filter bar and row components, and on-demand account details drawer with opener focus return.

## Files Changed

### Created

- `D:\projects\ptah-extension\libs\web\admin\src\lib\waitlist\waitlist-query-state.ts` — Query types, allowlists, Zod response schemas, and URL query parse/serialize helpers.
- `D:\projects\ptah-extension\libs\web\admin\src\lib\services\admin-api.service.spec.ts` — Unit tests for HTTP parameter serialization, Zod boundary validation, details, CSV download, and stats response schemas.
- `D:\projects\ptah-extension\libs\web\admin\src\lib\waitlist\waitlist-selection.state.ts` — Component-scoped selection state enforcing approval eligibility, cross-page selection, 50-of-N matching scope, and partial approval outcome retention.
- `D:\projects\ptah-extension\libs\web\admin\src\lib\waitlist\waitlist-selection.state.spec.ts` — Unit tests for selection state, eligibility gating, page selection status, 50-of-N disclosure, and transport resilience.
- `D:\projects\ptah-extension\libs\web\admin\src\lib\waitlist\waitlist-filter-bar.ts` — Presentational filter bar component emitting typed changes for search, source, date range, sort, page size, and filter clearing.
- `D:\projects\ptah-extension\libs\web\admin\src\lib\waitlist\waitlist-filter-bar.html` — Accessible template with input controls, ARIA labels, and date-range validation error feedback.
- `D:\projects\ptah-extension\libs\web\admin\src\lib\waitlist\waitlist-filter-bar.spec.ts` — Unit tests for filter controls, date ISO conversions, page-size bounds, and clear emission without stage.
- `D:\projects\ptah-extension\libs\web\admin\src\lib\waitlist\waitlist-row.ts` — Presentational row component displaying stage badges, timestamps, selection checkbox, and trigger buttons.
- `D:\projects\ptah-extension\libs\web\admin\src\lib\waitlist\waitlist-row.html` — Template displaying row lifecycle badges, conditional eligibility checkbox, details trigger, and Approve action.
- `D:\projects\ptah-extension\libs\web\admin\src\lib\waitlist\waitlist-row.spec.ts` — Unit tests ensuring approved/converted rows have no checkbox or Approve button, accessible labels, and opener element propagation.
- `D:\projects\ptah-extension\libs\web\admin\src\lib\waitlist\waitlist-details-drawer.ts` — Component managing on-demand detail retrieval for linked user, licenses, subscriptions, groups, and audit history.
- `D:\projects\ptah-extension\libs\web\admin\src\lib\waitlist\waitlist-details-drawer.html` — Template projecting detail content into shared `DetailDrawer` with safe labeled metadata, empty states, and error retry.
- `D:\projects\ptah-extension\libs\web\admin\src\lib\waitlist\waitlist-details-drawer.spec.ts` — Unit tests for details drawer loading, full/empty graphs, 404, dependency retry, eligible approval action, and close.
- `D:\projects\ptah-extension\libs\web\admin\src\lib\components\approve-waitlist-modal\approve-waitlist-modal.spec.ts` — Unit tests for approve modal bounding (0 and >50 caps), outcome rendering, transport error preservation, and response emission.

### Modified

- `D:\projects\ptah-extension\libs\web\admin\src\lib\services\admin-api.service.ts` — Added `listWaitlist`, `resolveEligibleWaitlistIds`, `getWaitlistDetails`, and `exportWaitlistCsv` methods; updated `adminStatsWaitlistSchema` with `pending`, `new`, and `invited` fields.
- `D:\projects\ptah-extension\libs\web\admin\src\lib\waitlist\waitlist-pipeline.ts` — Updated smart screen coordinator with URL query synchronization, selection state binding, CSV export download/revoke, debounced search, and drawer focus restoration.
- `D:\projects\ptah-extension\libs\web\admin\src\lib\waitlist\waitlist-pipeline.html` — Template integrating `WaitlistFilterBar`, `WaitlistRowComponent`, `WaitlistDetailsDrawer`, `SelectionToolbar`, page selection checkbox, and CSV export action.
- `D:\projects\ptah-extension\libs\web\admin\src\lib\waitlist\waitlist-pipeline.spec.ts` — Comprehensive integration tests for URL deep linking, back/forward, narrowing resets, selection preservation across pages, 50-of-N disclosure, partial approval results, CSV export, and drawer focus return.

## Verification Results

- `npx nx run-many -t test -p web-admin`:
  - Test Suites: 22 passed, 22 total
  - Tests: 258 passed, 258 total (all 6 new/modified test suites pass: `admin-api.service.spec.ts`, `waitlist-selection.state.spec.ts`, `waitlist-filter-bar.spec.ts`, `waitlist-row.spec.ts`, `waitlist-details-drawer.spec.ts`, `approve-waitlist-modal.spec.ts`, `waitlist-pipeline.spec.ts`).
- `npx nx run-many -t typecheck -p web-admin`:
  - 0 errors.
- `npx nx run-many -t lint -p web-admin`:
  - 0 errors (8 pre-existing warnings in unrelated components `admin-detail`, `delete-user-modal`, and `issue-comp-license-modal` remain unchanged).

## Plan Deviations

None. All components, interfaces, Zod schemas, URL conventions, accessibility requirements, and testing specifications matched the implementation plan.

## Known Gaps

None.
