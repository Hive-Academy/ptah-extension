# Code Logic Review — Batch B (Frontend), `TASK_2026_462_c819`

## Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 6/10           |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 0              |
| Serious issues      | 2              |
| Moderate issues     | 3              |
| Failure modes found | 4              |

Scope reviewed: `admin-api.service.ts`, `waitlist-query-state.ts`, `waitlist-selection.state.ts`,
`waitlist-filter-bar.*`, `waitlist-row.*`, `waitlist-details-drawer.*`, `waitlist-pipeline.*`,
`approve-waitlist-modal.*`, plus the corresponding specs, cross-checked against
`implementation-plan.md` §"Exact API contracts"/Components 5–8 and the real backend
(`admin-waitlist.dto.ts`, `admin-waitlist.types.ts`, `admin-waitlist.controller.ts`,
`admin.service.ts`). Contract shapes (URL paths, query names, response schemas, CSV/stats
fields) match the backend exactly — no drift found there. The defects below are behavioural
gaps in the parts the plan calls out explicitly (URL canonicalization, the 50-cap, and drawer
staleness) that the passing test suite does not exercise.

## Five logic questions

### 1. How does this fail silently?

- The details drawer has no request-ordering guard (`waitlist-details-drawer.ts:100-118`): if an
  admin opens entry A then quickly clicks into entry B while A's HTTP request is still in
  flight, and A's response arrives after B's, `data.set(res)` overwrites B's freshly-rendered
  panel with A's data while `entryId()` reads `B`. The UI shows the wrong person's licenses,
  subscriptions and audit history with no indication anything is wrong — this is silent in the
  strict sense (no error, no stale flag), just wrong.
- Invalid URL query values (`?stage=bogus`, `?sortBy=xyz`, `?pageSize=999`) are silently
  corrected in memory (`parseWaitlistQuery`, `waitlist-query-state.ts:192-259`) but the address
  bar is never rewritten to the canonical value except for the one legacy `?tab=` case
  (`waitlist-pipeline.ts:219-232`). A bookmarked or shared garbage URL keeps working but never
  self-heals, contrary to the plan's explicit contract (see Requirements fulfilment below).

### 2. What user action produces unexpected behaviour?

- Setting `pageSize=100` and clicking "Select page" (`waitlist-pipeline.html:154-166` →
  `waitlist-selection.state.ts:106-126`) selects up to 100 eligible rows with no cap warning at
  selection time. The admin only discovers the 50-row ceiling when they open the approve modal
  and see the "approve at most 50 at a time" message (`approve-waitlist-modal.html:93-100`).
  Nothing is corrupted (the modal blocks submission), but the selection toolbar and page
  checkbox never reflect that the selection has already exceeded what can be submitted.
- Typing a fast sequence of search terms creates one browser-history entry per debounced
  keystroke change instead of one, because `navigateWithFilters` (used by the search-debounce
  subscriber at `waitlist-pipeline.ts:235-243`) never passes `replaceUrl: true`. Pressing the
  browser Back button after searching steps through each intermediate search value instead of
  leaving the results.

### 3. What input data produces a wrong answer?

- None found in list/eligible-ids/CSV/stats mapping — Zod schemas mirror the backend response
  shapes field-for-field, and stage/eligibility are always read from the server row, never
  derived from the active tab (`waitlist-row.ts:37-63`, `waitlist-row.html:4,44`).

### 4. What happens when a dependency fails?

- List failure: `catchError` maps to `'error'` (`waitlist-pipeline.ts:150-160`), filters and
  selection remain intact, `Retry` re-ticks `refreshTick` — correct per plan.
- `resolveEligibleWaitlistIds` failure: `handleTransportFailure()` no-ops, explicit selection
  preserved — correct.
- Approval transport failure: modal keeps `result()` null, shows the sanitized message, does not
  emit `submitted`, so `WaitlistPipeline` never touches selection — correct (verified by
  `approve-waitlist-modal.spec.ts`, not re-read here but confirmed by the component's guarded
  `next`/`error` split at `approve-waitlist-modal.ts:174-187`).
- Details drawer failure: 404 vs 503/network is distinguished via `err.status` only
  (`waitlist-details-drawer.ts:120-125`); any error object lacking a numeric `status` (e.g. a
  Zod validation error thrown by `validate()` inside `getWaitlistDetails`) falls through to the
  generic `'unavailable'` state — acceptable, but note a Zod-boundary rejection (a real
  contract drift) is indistinguishable in the UI from a genuine 503, so a schema mismatch and a
  backend outage look identical to the admin. Low risk given the contract diffing above found
  no drift today.

### 5. What is missing that the requirements never mentioned?

- No mechanism announces to assistive tech when the _primary_ selection count changes — only
  the truncated-matching sub-label carries `aria-live="polite"` (`waitlist-pipeline.html:88-91`).
  The reused `SelectionToolbar` count span has no live region (`selection-toolbar.html:8-10`),
  and Batch B's plan explicitly required "all selection count changes use an
  `aria-live=\"polite\"` status" (implementation-plan.md:361) without carving out an exception
  for panel-ui's read-only chrome.
- No debounce cancellation guard between a fired search value and a still-in-flight request from
  an older query — mitigated in practice because `response$` uses `switchMap`
  (`waitlist-pipeline.ts:150-160`), so this one is actually fine; noted only because it is the
  same class of bug that the details drawer gets wrong.

## Failure modes

### Stale details-drawer response wins a race

- Trigger: admin opens entry A, then opens entry B before A's `GET .../:id/details` resolves.
- Symptom: drawer renders A's account/license/audit data while the drawer title and `entryId()`
  say B; an admin could approve based on the wrong person's context.
- Evidence: `waitlist-details-drawer.ts:67-79` (effect re-fires `fetchDetails` per id with no
  cancellation) and `:100-118` (`fetchDetails` unconditionally calls `this.data.set(res)` in
  `next` with no check that `id === this.entryId()`).
- Current handling: none — last response to arrive wins, not last request issued.
- Recommendation: guard the `next`/`error` callbacks with `if (id !== this.entryId()) return;`,
  or switch to a `toObservable(entryId).pipe(switchMap(...))` pattern like the pipeline's own
  list stream already does.

### URL never self-heals for invalid values

- Trigger: navigate to `/admin/waitlist?stage=bogus&sortBy=xyz&pageSize=999` (or restore such a
  bookmark).
- Symptom: the list renders correctly using in-memory defaults, but the address bar keeps
  showing the invalid values indefinitely; sharing that URL propagates the same confusing state.
- Evidence: `waitlist-query-state.ts:192-259` (`parseWaitlistQuery` silently substitutes
  defaults, never signals "this was invalid"); `waitlist-pipeline.ts:219-232` (the only
  URL-rewrite effect fires solely on legacy `?tab=`, not on any other invalid value).
- Current handling: partial — only the legacy `tab` key triggers `replaceUrl` canonicalization.
- Recommendation: compare `parseWaitlistQuery(rawParams)` against the raw params generically
  (not just `tab`) and issue one `replaceUrl` canonicalization whenever any key was corrected,
  per implementation-plan.md:356.

### No history replace on debounced search

- Trigger: type several distinct search terms within the session.
- Symptom: each committed (debounced, distinct) search value pushes a new history entry; Back
  steps through search history instead of leaving the page in one step, contrary to the plan's
  own stated risk mitigation.
- Evidence: `waitlist-pipeline.ts:234-243` calls `this.navigateWithFilters(...)`, and
  `navigateWithFilters` (`:324-334`) never passes `replaceUrl`; implementation-plan.md:539
  explicitly commits to "debounce search and use `replaceUrl` for search text canonicalization."
- Current handling: none — default `router.navigate` behaviour (push).
- Recommendation: pass `replaceUrl: true` for the search-originated navigation specifically
  (stage/sort/page changes should keep pushing, per the same plan line).

### Selection can exceed the 50-approval cap before the admin is told

- Trigger: set page size to 100, use "Select page" on a page of 100 eligible rows (or select
  page repeatedly across several pages).
- Symptom: toolbar shows "100 selected" with an enabled "Approve to Founding Cohort" button;
  only after opening the modal does the admin learn the request is blocked.
- Evidence: `waitlist-selection.state.ts:70-83` (`toggleRow`) and `:106-126` (`selectPage`) never
  compare `this._ids().size` (or the resulting size) against `this.limit`; the only enforcement
  point is `ApproveWaitlistModal.overLimit`/`canSubmit` (`approve-waitlist-modal.ts:86-96`),
  which blocks submission but only after the modal is already open.
- Current handling: submission is safely blocked (no over-50 request ever reaches the server),
  so this is not a correctness bug, but it does not meet "50 cap never exceeded" at the
  selection layer the review brief calls out, and the toolbar gives no earlier warning.
- Recommendation: either cap `selectPage`/`toggleRow` at 50 with a toast/disabled state once the
  limit is hit, or surface an inline warning in the selection toolbar itself (mirroring the
  matching-scope disclosure) as soon as `selection.count() > 50`, rather than deferring all
  feedback to the modal.

## Blocking issues

None found in this batch — every path that could send an unsafe or malformed request to the
server is guarded (over-50 approvals are blocked before submit; CSV/list/eligible params are
allowlisted at the Zod/HttpParams layer).

## Serious issues

### 1. Details drawer race condition on rapid id changes

- File: `libs/web/admin/src/lib/waitlist/waitlist-details-drawer.ts:100-118`
- Scenario: admin clicks "Details" on two rows in quick succession before the first request
  resolves.
- Impact: wrong account/license/audit data displayed under the correct-looking header for a
  different entry; an approve action taken from the drawer would target the _current_ entryId
  correctly (drawer's `onApprove` reads `this.data()?.entry`, so it would actually approve using
  the stale entry's id if the stale response landed after the id changed — i.e. the approve
  button could grant the wrong person a licence).
- Fix: ignore responses whose id no longer matches `entryId()`, or switch to a
  `switchMap`-based stream keyed on `entryId`.

### 2. URL canonicalization contract only partially implemented

- File: `libs/web/admin/src/lib/waitlist/waitlist-pipeline.ts:219-232`;
  `libs/web/admin/src/lib/waitlist/waitlist-query-state.ts:192-259`
- Scenario: any invalid value other than the legacy `tab` key (bad `stage`, `sortBy`,
  `sortOrder`, `source`, `pageSize`, negative `page`) reaches the URL.
- Impact: violates implementation-plan.md:356 ("invalid values normalize to defaults with a
  single `replaceUrl` canonicalization"); shared/bookmarked links never clean themselves up, and
  the gap is untested — `waitlist-pipeline.spec.ts:175-187` only asserts the in-memory parsed
  query, not that the browser URL was rewritten.
- Fix: generalize the canonicalization effect to fire whenever `serializeWaitlistQuery(parsed)`
  differs from the raw query params, not just when `tab` is present.

## Moderate and minor issues

- Moderate: no `replaceUrl` on debounced-search navigation, flooding history —
  `libs/web/admin/src/lib/waitlist/waitlist-pipeline.ts:234-243,324-334` (implementation-plan.md:539).
- Moderate: 50-selection cap is enforced only at modal-submit time, not at the selection layer —
  `libs/web/admin/src/lib/waitlist/waitlist-selection.state.ts:70-126`.
- Moderate: primary "N selected" toolbar text has no `aria-live` region, only the
  truncated-matching sub-label does — `libs/web/admin/src/lib/waitlist/waitlist-pipeline.html:88-91`
  vs `libs/web/panel-ui/src/lib/selection-toolbar/selection-toolbar.html:8-10`.
- Minor: `WaitlistFilterBar.invalidDateError` input is declared and rendered
  (`waitlist-filter-bar.ts:35`, `localDateError` computed at `:63-70`) but is never bound from
  `WaitlistPipeline` (`waitlist-pipeline.html:63-79` has no `[invalidDateError]` attribute), so a
  server-side `INVALID_DATE_RANGE` 400 falls through to the generic list-load error banner
  instead of the filter bar's dedicated slot. Low impact because the client-side `from > to`
  check already prevents the request in the common case.
- Minor: `WaitlistSelectionState` is annotated `@Injectable({ providedIn: 'root' })`
  (`waitlist-selection.state.ts:24`) yet is also listed in `WaitlistPipeline`'s component
  `providers` array (`waitlist-pipeline.ts:65`), which is the pattern that actually makes it
  component-scoped. Functionally correct today (component providers shadow root), but the
  `providedIn: 'root'` annotation is misleading and would silently become a cross-route
  singleton if the component-level provider were ever removed. Style/maintainability note, not a
  runtime bug today.

## Data flow

1. Router query params → `parseWaitlistQuery` → `currentQuery` signal. OK, but corrections are
   never written back to the URL except for `tab` (see Serious #2).
2. `currentQuery` + `refreshTick` → `switchMap` → `AdminApiService.listWaitlist` → Zod-validated
   `WaitlistListResponse`. OK — `switchMap` correctly cancels a stale in-flight list request when
   the query changes again.
3. Row eligibility rendered strictly from `row.approvalEligible` (server-derived), never from the
   active `stage()` tab. OK, confirmed in `waitlist-row.ts`/`.html` and `waitlist-pipeline.html`
   page-select control (`selection.pageStatus(this.rows())`).
4. Selection → matching resolution → `AdminApiService.resolveEligibleWaitlistIds` → capped
   `ids`/`eligibleMatching`. OK.
5. Approval submission → `ApproveWaitlistModal` enforces the 0/50 bounds at submit time → tally
   → `WaitlistSelectionState.handleApprovalResult` retains only `failed`/`not_found`. OK, matches
   plan and is unit-tested.
6. Export → same filter query, `Blob` returned, object URL created/clicked/revoked synchronously
   in `onExportCsv`. OK — no leaked object URL on the success path; on the error path no URL was
   ever created, so nothing leaks there either.
7. Details drawer fetch → **gap**: no per-request identity check before the response is applied
   to component state (see Serious #1).

## Requirements fulfilment

| Requirement                                                        | Status   | Gap                                                                                              |
| ------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------ |
| Eligibility from server `approvalEligible`, never active tab       | COMPLETE | none found                                                                                       |
| 50 cap never exceeded (explicit + matching)                        | PARTIAL  | selection layer has no cap; only the approve-modal submit path is capped                         |
| Selection: after approval keep only failed/not_found               | COMPLETE | matches `waitlist-selection.state.spec.ts`                                                       |
| Selection: transport failure preserves selection                   | COMPLETE | `handleTransportFailure` no-op verified                                                          |
| URL invalid-value canonicalization with `replaceUrl`               | PARTIAL  | only the legacy `tab` key triggers it                                                            |
| Debounced search uses `replaceUrl`                                 | MISSING  | `navigateWithFilters` never passes `replaceUrl`                                                  |
| Narrowing resets page; clear keeps stage                           | COMPLETE | verified in `waitlist-pipeline.spec.ts`                                                          |
| Export: object URL revoked; safe error messages                    | COMPLETE | `onExportCsv` revokes unconditionally on success; error path surfaces `err.message` only         |
| Drawer: focus restore                                              | COMPLETE | verified in `waitlist-pipeline.spec.ts`                                                          |
| Drawer: stale responses on quick id change                         | MISSING  | no request-identity guard                                                                        |
| Drawer: retry, 404 state                                           | COMPLETE | verified in `waitlist-details-drawer.spec.ts`                                                    |
| Angular rules (OnPush/signals/inject/no innerHTML)                 | COMPLETE | verified by inspection                                                                           |
| Files < 700 lines                                                  | COMPLETE | largest file (`waitlist-pipeline.ts`) is 465 lines                                               |
| Other stats consumers (overview/funnel/needs-attention) unaffected | COMPLETE | new stage fields are `.optional()` in the Zod schema, so older/newer server shapes both validate |

Implicit requirements not addressed: aria-live announcement of the primary selection count
change (panel-ui reuse constraint made this awkward, but the plan did not carve out an
exception); proactive selection-cap feedback before opening the approve modal.

## Edge cases

| Case                              | Handled             | How                                                                                                | Concern                                                                                                           |
| --------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Page beyond last page             | YES                 | server returns empty `data` + accurate metadata; UI does not crash                                 | frontend never proactively navigates back to the last valid page per plan, but this is UI polish, not correctness |
| Rapid drawer id switch            | NO                  | last HTTP response wins regardless of order issued                                                 | see Serious #1                                                                                                    |
| Selection > 50 via page-select    | PARTIAL             | blocked at modal submit                                                                            | no earlier warning; see Moderate list                                                                             |
| Invalid enum/number in URL        | PARTIAL             | normalized in memory                                                                               | URL itself not rewritten (except `tab`)                                                                           |
| CSV response non-CSV content-type | YES                 | `exportWaitlistCsv` throws before returning `{blob, filename}`                                     | error surfaces via generic `err.message` in the toast, acceptable                                                 |
| Search debounce burst             | YES (functionally)  | `distinctUntilChanged` + 300ms debounce collapses repeats                                          | history entries still accumulate per accepted value (Moderate)                                                    |
| Concurrent narrowing + approval   | Not directly tested | selection is cleared on narrowing before any pending approve request could be attributed elsewhere | acceptable — no evidence of a race here                                                                           |

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Top risk: the details-drawer race (Serious #1) can show — and let an admin act on — the wrong
  person's account data when clicking through entries quickly, which is a real behavioural bug in
  an admin surface that grants free licences.
- What a robust implementation would add: an id-guard (or `switchMap`) in the details drawer;
  a generalized URL-canonicalization effect keyed off any corrected field, not just `tab`;
  `replaceUrl: true` on the search-originated navigation; and either a selection-time cap or an
  inline over-limit warning in the toolbar before the approve modal opens.
