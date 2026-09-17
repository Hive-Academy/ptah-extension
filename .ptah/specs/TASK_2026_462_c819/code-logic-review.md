# Code Logic Review — `TASK_2026_462_c819` (Batch B frontend)

## Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 4/10           |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 0              |
| Serious issues      | 5              |
| Moderate issues     | 3              |
| Failure modes found | 8              |

The project test, typecheck, and lint targets pass (258 tests; zero typecheck/lint errors), but the tests do not exercise several required failure paths. The implementation is not ready to accept because explicit selection can exceed 50, URL state is not canonicalized as specified, an out-of-range page strands the user on an empty view, stale detail requests can render the wrong person, and approval results omit the required per-entry outcomes.

## Five logic questions

### 1. How does this fail silently?

- Invalid `stage`, `sortBy`, `sortOrder`, `page`, `pageSize`, and source values are normalized in memory, but the canonicalization effect only runs when legacy `tab` exists. The page appears to work while the address bar retains a non-canonical URL (`libs/web/admin/src/lib/waitlist/waitlist-query-state.ts:203`, `libs/web/admin/src/lib/waitlist/waitlist-pipeline.ts:219`).
- The approval result view iterates aggregate tally lines but never iterates `result.results`, so row-specific `failed`, `not_found`, and skip outcomes disappear behind a success-looking aggregate response (`libs/web/admin/src/lib/components/approve-waitlist-modal/approve-waitlist-modal.html:24`).
- The stats boundary accepts responses missing `pending`, `new`, `invited`, or `approved`, masking server/client contract drift rather than rejecting it (`libs/web/admin/src/lib/services/admin-api.service.ts:378`).

### 2. What user action produces unexpected behaviour?

- Selecting eligible rows across pages, or selecting a full page after prior selections, can raise the selection above 50. The modal then refuses submission even though the UI allowed the invalid selection to be built (`libs/web/admin/src/lib/waitlist/waitlist-selection.state.ts:70`, `libs/web/admin/src/lib/waitlist/waitlist-selection.state.ts:106`).
- Opening a deep link to a page beyond `totalPages` renders the stage's ordinary empty state and hides pagination, leaving no route back to the last valid page (`libs/web/admin/src/lib/waitlist/waitlist-pipeline.ts:183`, `libs/web/admin/src/lib/waitlist/waitlist-pipeline.html:125`).
- Opening details for one row and quickly opening another can let the first, slower response overwrite the second row's drawer (`libs/web/admin/src/lib/waitlist/waitlist-details-drawer.ts:68`, `libs/web/admin/src/lib/waitlist/waitlist-details-drawer.ts:100`).

### 3. What input data produces a wrong answer?

- Query values such as `page=2junk` are accepted as page 2 because `parseInt` accepts prefixes, instead of being treated as invalid and canonicalized to page 1 (`libs/web/admin/src/lib/waitlist/waitlist-query-state.ts:236`).
- Malformed `createdFrom`/`createdTo` values pass through unchanged and are sent to the API, unlike other normalized URL fields (`libs/web/admin/src/lib/waitlist/waitlist-query-state.ts:221`, `libs/web/admin/src/lib/services/admin-api.service.ts:753`).
- A malformed eligible-id response containing more than 50 IDs passes Zod validation and is installed wholesale as the selection (`libs/web/admin/src/lib/waitlist/waitlist-query-state.ts:102`, `libs/web/admin/src/lib/waitlist/waitlist-selection.state.ts:131`).

### 4. What happens when a dependency fails?

- Detail calls map 404 and other failures to safe states, but overlapping calls are neither cancelled nor correlated with the current ID; a late success or failure can replace newer state (`libs/web/admin/src/lib/waitlist/waitlist-details-drawer.ts:100`).
- Export and approval failures can surface arbitrary transport/server strings directly to the template instead of a fixed safe client message (`libs/web/admin/src/lib/waitlist/waitlist-pipeline.ts:395`, `libs/web/admin/src/lib/components/approve-waitlist-modal/approve-waitlist-modal.ts:189`).
- Direct HTTP subscriptions in the pipeline, drawer, and modal have no destruction teardown, so slow requests can continue and write state after their component is destroyed (`libs/web/admin/src/lib/waitlist/waitlist-pipeline.ts:235`, `libs/web/admin/src/lib/waitlist/waitlist-details-drawer.ts:104`, `libs/web/admin/src/lib/components/approve-waitlist-modal/approve-waitlist-modal.ts:174`).

### 5. What is missing that the requirements never mentioned?

- The implementation needs a deterministic policy for selection attempts after 50 (ignore, disable, or replace), including an accessible announcement. Currently it allows the invalid state and defers rejection to the modal (`libs/web/admin/src/lib/waitlist/waitlist-selection.state.ts:73`).
- The drawer needs request identity/cancellation semantics for rapid row changes and close/reopen cycles, not just loading/error states (`libs/web/admin/src/lib/waitlist/waitlist-details-drawer.ts:104`).
- The parent needs a focus fallback when refresh/filtering removes the original row before the drawer closes; it currently calls `focus()` on the stored element without checking that it remains connected (`libs/web/admin/src/lib/waitlist/waitlist-pipeline.ts:451`).

## Failure modes

### Explicit selection exceeds the approval cap

- Trigger: Select eligible rows across enough pages, or select 50 matching and then toggle another eligible row.
- Symptom: The selection count becomes 51+ and the approval modal blocks an action the page allowed the admin to construct.
- Evidence: `libs/web/admin/src/lib/waitlist/waitlist-selection.state.ts:70`, `libs/web/admin/src/lib/waitlist/waitlist-selection.state.ts:106`
- Current handling: IDs are appended without comparing the resulting set size to `limit`; only the modal rejects `> 50` later.
- Recommendation: Enforce the cap inside every selection mutator, select only remaining capacity for page selection, and announce when rows were not added.

### Malformed eligible response bypasses the cap

- Trigger: The eligible-IDs dependency returns 51 IDs or inconsistent `selected`, `eligibleMatching`, and `truncated` fields.
- Symptom: The client accepts an impossible contract shape and creates an oversized or misleading matching selection.
- Evidence: `libs/web/admin/src/lib/waitlist/waitlist-query-state.ts:102`, `libs/web/admin/src/lib/waitlist/waitlist-selection.state.ts:131`
- Current handling: The schema checks primitive types and literal `limit: 50` only; state trusts `ids` and ignores `selected`/`truncated` consistency.
- Recommendation: Add `.max(50)`, integer/non-negative checks, and a schema refinement tying `selected` to `ids.length`, `eligibleMatching >= selected`, and `truncated` to the counts; defensively slice/reject in state.

### Invalid URLs remain non-canonical

- Trigger: Open a URL with invalid stage/source/sort/pagination values but no legacy `tab` parameter.
- Symptom: Defaults are used internally, while the invalid URL remains visible and shareable; malformed dates instead produce a failed list request.
- Evidence: `libs/web/admin/src/lib/waitlist/waitlist-query-state.ts:203`, `libs/web/admin/src/lib/waitlist/waitlist-query-state.ts:221`, `libs/web/admin/src/lib/waitlist/waitlist-pipeline.ts:219`
- Current handling: The effect replaces the URL only when `tab` is present.
- Recommendation: Parse into both normalized state and a canonicalization flag, validate complete numeric/date strings, and perform one equality-guarded `replaceUrl` navigation for any non-canonical query.

### Page beyond the result set strands the user

- Trigger: Open `?page=99` when the filtered result has fewer pages.
- Symptom: The page shows the normal empty-stage message and no pagination controls instead of moving to the last valid page.
- Evidence: `libs/web/admin/src/lib/waitlist/waitlist-pipeline.ts:183`, `libs/web/admin/src/lib/waitlist/waitlist-pipeline.html:125`, `libs/web/admin/src/lib/waitlist/waitlist-pipeline.html:181`
- Current handling: Response metadata is exposed but never used to canonicalize `page`.
- Recommendation: After a successful response, replace-navigate to `max(1, totalPages)` when requested page is beyond the final page, guarded to avoid a navigation loop.

### Stale detail response renders the wrong entry

- Trigger: Open entry A, then entry B before A's request completes; A completes last.
- Symptom: The drawer title and body show A while the parent still considers B active.
- Evidence: `libs/web/admin/src/lib/waitlist/waitlist-details-drawer.ts:68`, `libs/web/admin/src/lib/waitlist/waitlist-details-drawer.ts:100`
- Current handling: Each ID change creates an independent subscription, and every response writes `data`/`error` unconditionally.
- Recommendation: Drive requests from an ID/open observable with `switchMap`, or retain a request token and ignore responses not matching the current open ID; cancel on close/destroy.

### Approval hides row-specific outcomes

- Trigger: Submit a mixed approval result containing failures, not-found IDs, or already-paid rows.
- Symptom: The admin sees totals but cannot tell which entry had which outcome, undermining identification and retry.
- Evidence: `libs/web/admin/src/lib/components/approve-waitlist-modal/approve-waitlist-modal.html:24`, `libs/web/admin/src/lib/components/approve-waitlist-modal/approve-waitlist-modal.ts:102`
- Current handling: The result UI renders `outcomeLines()` derived only from `tally`; it never renders `results`.
- Recommendation: Render each response result with email/ID, outcome, and safe warning/error code, while keeping the aggregate tally.

### Raw error strings reach administrators

- Trigger: Export or approval fails with an unexpected client, proxy, or malformed server error object.
- Symptom: Technical or sensitive dependency text may be displayed verbatim.
- Evidence: `libs/web/admin/src/lib/waitlist/waitlist-pipeline.ts:395`, `libs/web/admin/src/lib/components/approve-waitlist-modal/approve-waitlist-modal.ts:189`
- Current handling: Both paths prefer arbitrary `.message` strings over a fixed safe message.
- Recommendation: Map only allowlisted API error codes to fixed copy; use a generic fallback for all other shapes and log diagnostics outside the template.

### Async work outlives component instances

- Trigger: Navigate away while debounce, stats, eligible-ID, export, details, or approval work is pending.
- Symptom: Requests/timers continue and callbacks can mutate destroyed component state; rapid remounts can also perform redundant work.
- Evidence: `libs/web/admin/src/lib/waitlist/waitlist-pipeline.ts:235`, `libs/web/admin/src/lib/waitlist/waitlist-details-drawer.ts:104`, `libs/web/admin/src/lib/components/approve-waitlist-modal/approve-waitlist-modal.ts:174`
- Current handling: Direct subscriptions do not use `takeUntilDestroyed`; timeout handles are not cancelled.
- Recommendation: Apply `takeUntilDestroyed(inject(DestroyRef))` to component-owned streams/requests and clear scheduled timers during destruction.

## Blocking issues

None. The modal and server boundary still prevent an oversized approval mutation, so the selection-cap defect is serious rather than data-corrupting.

## Serious issues

### 1. The 50-ID cap is not enforced by selection state

- File: `libs/web/admin/src/lib/waitlist/waitlist-selection.state.ts:70`
- Scenario: Cross-page row/page selection, or editing a 50-ID matching selection, grows the set past 50.
- Impact: A normal workflow reaches an invalid state and approval is blocked only after the user opens the modal.
- Fix: Enforce `limit` atomically in `toggleRow`, `selectPage`, and `selectMatching`.

### 2. URL normalization is incomplete and accepts numeric prefixes

- File: `libs/web/admin/src/lib/waitlist/waitlist-pipeline.ts:219`
- Scenario: Invalid query values without `tab`, or values such as `page=2junk`, are opened directly.
- Impact: The address bar does not describe the actual view; malformed dates can fail the entire list.
- Fix: Strictly parse every query field and replace-navigate whenever serialized normalized state differs from the raw supported query state.

### 3. Out-of-range pages are not canonicalized

- File: `libs/web/admin/src/lib/waitlist/waitlist-pipeline.ts:183`
- Scenario: Result counts shrink or a deep link requests a page beyond the final page.
- Impact: A non-empty result set appears empty and offers no pagination escape.
- Fix: Use response `page`/`totalPages` to replace the requested page with the last valid page after a successful response.

### 4. Drawer requests race

- File: `libs/web/admin/src/lib/waitlist/waitlist-details-drawer.ts:100`
- Scenario: The active entry changes before the previous HTTP call completes.
- Impact: The drawer can show the wrong person's account, entitlements, and audit data.
- Fix: Cancel stale requests with `switchMap` or ignore callbacks whose ID is no longer active.

### 5. Per-entry approval outcomes are absent

- File: `libs/web/admin/src/lib/components/approve-waitlist-modal/approve-waitlist-modal.html:24`
- Scenario: A batch returns mixed results.
- Impact: Failed/not-found rows are retained internally but are not identifiable to the admin for informed retry.
- Fix: Render `r.results` with the safe fields from the exact response contract.

## Moderate and minor issues

1. **Moderate — response schemas are looser than the authoritative contract.** Stats stage fields are optional, and eligible IDs have no maximum or consistency refinement (`libs/web/admin/src/lib/services/admin-api.service.ts:378`, `libs/web/admin/src/lib/waitlist/waitlist-query-state.ts:102`). Make the new stats fields required and validate eligible response invariants.
2. **Moderate — error mapping displays arbitrary strings.** Export and approval use raw `.message` values (`libs/web/admin/src/lib/waitlist/waitlist-pipeline.ts:395`, `libs/web/admin/src/lib/components/approve-waitlist-modal/approve-waitlist-modal.ts:189`). Map known codes to fixed safe messages.
3. **Moderate — the passing tests overstate required coverage.** The invalid-URL test checks only the API arguments, not the replaced URL (`libs/web/admin/src/lib/waitlist/waitlist-pipeline.spec.ts:175`); the “50-of-N” test selects only two IDs (`libs/web/admin/src/lib/waitlist/waitlist-pipeline.spec.ts:272`); the modal test asserts tally labels but no per-entry result (`libs/web/admin/src/lib/components/approve-waitlist-modal/approve-waitlist-modal.spec.ts:70`); and the drawer suite has no overlapping-request case (`libs/web/admin/src/lib/waitlist/waitlist-details-drawer.spec.ts:94`). Add the missing behavioral assertions before relying on the green suite.

## Data flow

1. Router query params → `parseWaitlistQuery`: **GAP** — permissive numeric parsing, no date validation, and no general canonicalization (`libs/web/admin/src/lib/waitlist/waitlist-query-state.ts:192`).
2. Normalized query → `listWaitlist` HTTP params: **OK** — the specified parameter names and route are used (`libs/web/admin/src/lib/services/admin-api.service.ts:746`).
3. HTTP response → Zod → list/count signals: **PARTIAL** — list shape is validated, but numeric invariants are permissive (`libs/web/admin/src/lib/waitlist/waitlist-query-state.ts:92`).
4. Server `approvalEligible` → row, page, drawer controls: **OK** — eligibility is not derived from the active tab (`libs/web/admin/src/lib/waitlist/waitlist-row.html:4`, `libs/web/admin/src/lib/waitlist/waitlist-details-drawer.html:211`).
5. Row/page/matching inputs → selection set: **GAP** — explicit paths and malformed matching responses can exceed 50 (`libs/web/admin/src/lib/waitlist/waitlist-selection.state.ts:70`).
6. Selection → approval modal → POST: **PARTIAL** — 0/>50 submission is blocked and transport failure preserves selection, but row-specific results are not shown (`libs/web/admin/src/lib/components/approve-waitlist-modal/approve-waitlist-modal.ts:90`, `libs/web/admin/src/lib/components/approve-waitlist-modal/approve-waitlist-modal.html:24`).
7. Approval response → selection/list/count refresh: **OK** — failed/not-found IDs are retained and authoritative data refreshes (`libs/web/admin/src/lib/waitlist/waitlist-selection.state.ts:150`, `libs/web/admin/src/lib/waitlist/waitlist-pipeline.ts:430`).
8. Filters → CSV → object URL: **PARTIAL** — filters and revocation work on the normal path, but error copy is not safely mapped (`libs/web/admin/src/lib/waitlist/waitlist-pipeline.ts:373`, `libs/web/admin/src/lib/waitlist/waitlist-pipeline.ts:393`).
9. Drawer ID → details response → projected drawer: **GAP** — complete display/error states exist, but stale requests are not cancelled (`libs/web/admin/src/lib/waitlist/waitlist-details-drawer.ts:100`).

## Requirements fulfilment

| Requirement                                | Status   | Gap                                                                                                                   |
| ------------------------------------------ | -------- | --------------------------------------------------------------------------------------------------------------------- |
| Exact routes/query vocabulary/Zod boundary | PARTIAL  | Routes and names match, but stats and eligible-ID schemas do not enforce the exact response invariants.               |
| Server-owned eligibility                   | COMPLETE | Row, page selection logic, and drawer use `approvalEligible`.                                                         |
| Selection capped at 50                     | MISSING  | Explicit and page selection can exceed the cap.                                                                       |
| 50-of-N disclosure                         | PARTIAL  | Matching disclosure exists, but malformed/oversized responses are trusted and tests use only two selected IDs.        |
| Partial approval retention                 | COMPLETE | `failed` and `not_found` stay selected; success/skip outcomes are removed.                                            |
| Transport failure preserves selection      | COMPLETE | No `submitted` event is emitted on approval transport failure.                                                        |
| URL-owned restorable state                 | PARTIAL  | Valid deep links restore; invalid values are not generally canonicalized and last-valid-page handling is absent.      |
| Narrowing resets page/selection            | COMPLETE | Stage/search/source/date/sort paths reset page and selection.                                                         |
| Clear retains stage                        | COMPLETE | Optional filters and defaults reset while stage is retained.                                                          |
| Debounced search                           | COMPLETE | Search navigation is debounced by 300 ms.                                                                             |
| CSV export and URL revocation              | PARTIAL  | Happy-path URL revocation works; safe error mapping is incomplete.                                                    |
| Drawer loading/404/retry/focus             | PARTIAL  | States and focus return exist; rapid ID changes race and detached opener fallback is absent.                          |
| Approval per-entry outcomes                | MISSING  | Only aggregate tallies are rendered.                                                                                  |
| Angular component rules                    | PARTIAL  | Components are standalone/OnPush/signal-driven and contain no innerHTML; component-owned subscriptions lack teardown. |

Implicit requirements not addressed: selection-cap feedback, stale-request identity, and a focus fallback when the original row is removed.

## Edge cases

| Case                            | Handled | How                                           | Concern                                                                                               |
| ------------------------------- | ------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Empty result                    | YES     | Stage-specific empty state                    | Out-of-range pages are indistinguishable from genuinely empty results.                                |
| Null source/timestamps          | YES     | `Unknown` / `Not recorded`                    | None observed.                                                                                        |
| Approved/converted row          | YES     | Server eligibility hides checkbox and Approve | Page-level checkbox remains visible even when a page has no eligible rows, though it selects nothing. |
| 50 explicit IDs                 | YES     | Modal accepts exactly 50                      | State can add a 51st ID.                                                                              |
| More than 50 matches            | PARTIAL | Matching label discloses selected vs matching | Client does not validate or defend against an oversized dependency response.                          |
| Mixed approval outcomes         | PARTIAL | Selection retention and tally work            | Per-entry identification is absent.                                                                   |
| Transport failure               | PARTIAL | Approval selection survives                   | Error text is not safely allowlisted.                                                                 |
| Malformed URL                   | NO      | Some fields default in memory                 | URL is not canonicalized; dates pass through.                                                         |
| Page beyond final page          | NO      | Server returns empty data and metadata        | UI strands user on empty state.                                                                       |
| Rapid drawer ID change          | NO      | Independent subscriptions race                | Older response can overwrite newer details.                                                           |
| Component destroyed mid-request | NO      | No teardown on direct subscriptions           | Late callbacks and unnecessary requests remain possible.                                              |

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Top risk: A stale drawer request can display one waitlist member's account and audit details while the UI is nominally focused on another member.
- What a robust implementation would add: cap-aware selection mutations and response validation; complete URL canonicalization including last-valid-page handling; switch-mapped drawer requests; per-entry approval result rendering; fixed safe error mapping; teardown for component-owned async work; and regression tests that assert those behaviors rather than only happy-path calls.

---

# Code Logic Review — `TASK_2026_462_c819` (Batch A backend)

## Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 5/10           |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 0              |
| Serious issues      | 3              |
| Moderate issues     | 1              |
| Failure modes found | 4              |

The exact routes, DTO bindings, stage predicates, list/count reuse, CSV quoting rules, sanitized service errors, module registration, and normal converted-row approval path match the plan. Scoped diagnostics report zero errors/warnings, and the four requested backend test targets pass from cache (350 tests). The batch still needs revision because the approval race named in the plan returns the wrong outcome, the existing Overview consumer continues to display the obsolete overlapping count, audit metadata values are not runtime-projected to the promised safe types, and an export can silently truncate at the 50,000-row boundary.

## Five logic questions

### 1. How does this fail silently?

- The export counts first, then performs a separately committed `findMany({ take: 50_000 })`; a matching row inserted between those reads turns an allowed 50,000-row export into a silent first-50,000 export rather than the required 413 (`libs/api/admin/src/lib/admin-waitlist.service.ts:307`, `libs/api/admin/src/lib/admin-waitlist.service.ts:325`).
- The Overview ignores the corrected `attention.waitlistUninvited` supplied by the backend and recomputes the old `total - notified` value, so the server response is correct while the user still sees the original bug (`libs/web/admin/src/lib/overview/overview.ts:70`).

### 2. What user action produces unexpected behaviour?

- Clicking Approve while Paddle converts the same row between the advisory read and conditional update produces `already_approved`, although the row is converted and the exact contract requires `already_paid` (`libs/api/marketing/src/lib/waitlist/waitlist.service.ts:251`, `libs/api/marketing/src/lib/waitlist/waitlist.service.ts:271`).
- Opening the admin Overview after approved-but-never-notified rows exist shows those rows as “not yet invited,” because the page still derives the queue count from historical notification presence (`libs/web/admin/src/lib/overview/overview.ts:66`, `libs/web/admin/src/lib/overview/overview.html:45`).

### 3. What input data produces a wrong answer?

- A stored audit row with a recognized key but the wrong value type, for example `{ licenseId: { licenseKey: '...' } }`, passes through unchanged because projection checks only key membership. The response then violates `licenseId?: string`, can expose nested data, and is rejected by the frontend Zod boundary (`libs/api/admin/src/lib/admin-waitlist.service.ts:674`, `libs/api/admin/src/lib/admin-waitlist.types.ts:147`).
- An approved row with `notifiedAt = null` makes `total - notified` larger than the true New stage even though the backend correctly reports `waitlist.new` (`libs/web/admin/src/lib/overview/overview.ts:73`).

### 4. What happens when a dependency fails?

- Prisma and audit failures on the new read routes are translated to fixed 503 bodies and the export audit fails closed (`libs/api/admin/src/lib/admin-waitlist.service.ts:344`, `libs/api/admin/src/lib/admin-waitlist.service.ts:655`).
- A malformed audit JSON value is not treated as a dependency-shape failure; it is returned as if it satisfied the wire contract (`libs/api/admin/src/lib/admin-waitlist.service.ts:680`).

### 5. What is missing that the requirements never mentioned?

- The count/read export boundary needs a consistency policy. The present two-query flow has no snapshot or post-read overflow check, so concurrent growth can bypass the advertised cap (`libs/api/admin/src/lib/admin-waitlist.service.ts:307`).
- The claim loser needs an authoritative post-update classification. The pre-update row is adequate for naming the entry, but not for deciding whether the competing writer approved or converted it (`libs/api/marketing/src/lib/waitlist/waitlist.service.ts:230`, `libs/api/marketing/src/lib/waitlist/waitlist.service.ts:276`).

## Failure modes

### Converted-between-read-and-update is misclassified

- Trigger: `claimForApproval` reads an unapproved/unconverted row, Paddle sets `convertedAt`, then the guarded `updateMany` returns `count = 0`.
- Symptom: The approval response reports `already_approved` instead of `already_paid`; no license/cohort/audit/email is written, but the public outcome is false.
- Evidence: `libs/api/marketing/src/lib/waitlist/waitlist.service.ts:251`, `libs/api/marketing/src/lib/waitlist/waitlist.service.ts:266`, `libs/api/marketing/src/lib/waitlist/waitlist.service.ts:276`
- Current handling: The loser classifies from the stale row returned before the competing conversion.
- Recommendation: After `count === 0`, re-read `approvedAt` and `convertedAt` inside the transaction (or use an equivalent returning/locking strategy) and classify with converted precedence. Add the exact converted-between-read-and-update regression; the current race test only varies update counts against a permanently null `convertedAt` (`libs/api/marketing/src/lib/waitlist/waitlist.service.spec.ts:301`).

### Overview still displays the overlapping legacy count

- Trigger: Any approved-without-notified row exists and an admin opens `/admin/overview`.
- Symptom: “Waitlist not yet invited” includes an approved row, recreating the defect this task was meant to remove.
- Evidence: `libs/web/admin/src/lib/overview/overview.ts:66`, `libs/web/admin/src/lib/overview/overview.ts:73`, `libs/web/admin/src/lib/overview/overview.html:46`
- Current handling: The backend emits the correct `attention.waitlistUninvited = newCount`, but the consumer passes its own `total - notified` computation to the queue (`libs/api/admin/src/lib/admin.service.ts:385`).
- Recommendation: Prefer `s.attention?.waitlistUninvited` (or `s.waitlist.new`) and retain `total - notified` only as an explicit old-server compatibility fallback. Add an approved-without-notified Overview regression.

### Known audit keys can carry unsafe values

- Trigger: A legacy, malformed, or compromised audit row stores an object/array/number under a recognized metadata key.
- Symptom: Arbitrary nested JSON is serialized through the details endpoint, or the frontend rejects the entire details response because the value is not the promised string/boolean/null type.
- Evidence: `libs/api/admin/src/lib/admin-waitlist.service.ts:674`, `libs/api/admin/src/lib/admin-waitlist.service.ts:682`, `libs/api/admin/src/lib/admin-waitlist.types.ts:147`
- Current handling: Unknown top-level keys are removed, but known-key values are copied without runtime narrowing.
- Recommendation: Project each field with an explicit type guard and omit invalid values; never cast a generic record to `WaitlistDetailsAuditMetadata`. Test malformed values as well as unknown keys.

### Export can silently omit a concurrent match at the cap

- Trigger: The count returns exactly 50,000, then at least one matching row is inserted before `findMany`.
- Symptom: The response succeeds with 50,000 rows and an audit row even though more than 50,000 rows matched when data was read; the omitted entry is undisclosed.
- Evidence: `libs/api/admin/src/lib/admin-waitlist.service.ts:307`, `libs/api/admin/src/lib/admin-waitlist.service.ts:318`, `libs/api/admin/src/lib/admin-waitlist.service.ts:327`
- Current handling: `take: 50_000` bounds memory but converts concurrent overflow into truncation.
- Recommendation: Read `50_001` rows under a consistent transaction/snapshot and reject when the sentinel row exists, or re-check the count in the same isolation regime before auditing.

## Blocking issues

None. The approval claim still prevents a converted row from receiving a free grant, and export/audit failures on the ordinary paths fail closed.

## Serious issues

### 1. Approval race returns the wrong public outcome

- File: `libs/api/marketing/src/lib/waitlist/waitlist.service.ts:271`
- Scenario: Conversion commits between the advisory read and guarded claim update.
- Impact: The exact five-outcome response lies about why the row was skipped and violates the plan's explicit concurrency requirement.
- Fix: Re-read the loser state after `count === 0` and apply converted-before-approved precedence.

### 2. Existing stats consumer preserves the original counting bug

- File: `libs/web/admin/src/lib/overview/overview.ts:70`
- Scenario: Approved rows have no historical `notifiedAt` stamp.
- Impact: Administrators see approved people in the “not yet invited” work queue despite the corrected server aggregate.
- Fix: Consume `attention.waitlistUninvited`/`waitlist.new`; keep legacy arithmetic only as a compatibility fallback.

### 3. Audit metadata projection validates names but not values

- File: `libs/api/admin/src/lib/admin-waitlist.service.ts:682`
- Scenario: Stored JSON has a known key with an unexpected nested value.
- Impact: The endpoint can expose arbitrary nested metadata or make details unavailable at the frontend validation boundary.
- Fix: Build the response field-by-field with string/boolean/null guards and omit every invalid value.

## Moderate and minor issues

1. **Moderate — the 50,000-row cap is race-prone.** Separate count/read statements plus `take: 50_000` can silently truncate concurrent growth (`libs/api/admin/src/lib/admin-waitlist.service.ts:307`). Use a 50,001 sentinel read under consistent isolation.
2. **Minor — security coverage is narrower than its claim.** The CSV test exercises `=` and doubled quotes but not `+`, `-`, `@`, tab, carriage return, or embedded newline, despite those being explicitly required (`libs/api/admin/src/lib/admin-waitlist.service.spec.ts:425`). Add a table-driven case for every prefix and multiline quoting.
3. **Minor — stats “fixture” tests are partly tautological.** The approved-without-notified and converted-plus-approved tests assert imported predicate constants rather than executing counts against representative rows (`libs/api/admin/src/lib/admin.service.spec.ts:592`, `libs/api/admin/src/lib/admin.service.spec.ts:599`). The pure predicate suite is useful, but these tests do not independently prove `getStats` classification behavior.

## Data flow

1. Query/path input → explicit `dtoPipe` DTO: **OK** — all new query/param bindings name the required DTO (`libs/api/admin/src/lib/admin-waitlist.controller.ts:69`, `libs/api/admin/src/lib/admin-waitlist.controller.ts:117`).
2. DTO → literal filters/order: **OK** — search OR is nested within the overall AND, unknown source maps to null, reversed ranges throw the exact 400, and sort keys are allowlisted (`libs/api/admin/src/lib/waitlist-query.ts:256`, `libs/api/admin/src/lib/waitlist-query.ts:275`, `libs/api/admin/src/lib/waitlist-query.ts:285`, `libs/api/admin/src/lib/waitlist-query.ts:326`).
3. Filters → page/total/stage counts: **OK** — one policy supplies list and count predicates; stage is omitted only from tab counts (`libs/api/admin/src/lib/admin-waitlist.service.ts:149`).
4. Filters → eligible IDs: **OK** — the same filters are ANDed with both null eligibility guards and capped at 50 (`libs/api/admin/src/lib/admin-waitlist.service.ts:234`).
5. Filters → CSV → audit → controller bytes: **GAP** — quoting and audit-before-return are correct, but count/read concurrency can silently truncate (`libs/api/admin/src/lib/admin-waitlist.service.ts:307`).
6. ID → waitlist/user/audit details → response: **GAP** — nested selects exclude named secrets, but metadata values are trusted after key-only filtering (`libs/api/admin/src/lib/admin-waitlist.service.ts:426`, `libs/api/admin/src/lib/admin-waitlist.service.ts:674`).
7. Approval ID → advisory read → guarded update → grant: **GAP** — both null guards prevent the grant, but a losing update is classified from stale pre-update state (`libs/api/marketing/src/lib/waitlist/waitlist.service.ts:251`).
8. Stage counts → `/stats` → Overview: **GAP** — backend values are disjoint; the existing UI consumer recomputes the legacy overlapping count (`libs/api/admin/src/lib/admin.service.ts:354`, `libs/web/admin/src/lib/overview/overview.ts:70`).

## Requirements fulfilment

| Requirement                                            | Status   | Gap                                                                                                                       |
| ------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------- |
| Exact routes/order/DTO contracts                       | COMPLETE | Four GET routes, static ordering, decorators/defaults, and explicit bindings match the plan.                              |
| Disjoint/exhaustive stage policy                       | COMPLETE | Converted → Approved → Invited → New predicates and per-row derivation agree.                                             |
| Shared list/count/stats/eligible/export/details policy | COMPLETE | All backend read surfaces use the central predicate/derivation module.                                                    |
| Combined filters and safe Prisma keys                  | COMPLETE | AND/OR structure, source null bucket, date error, and sort allowlist are implemented.                                     |
| Safe CSV and audited fail-closed export                | PARTIAL  | Encoding and audit failure behavior match; concurrent overflow can silently truncate.                                     |
| Safe details projection                                | PARTIAL  | Direct secret columns and unknown keys are excluded; known metadata values are not narrowed.                              |
| Converted approval hardening                           | PARTIAL  | Guard prevents mutation and normal converted rows report `already_paid`; conversion racing after the read is misreported. |
| Disjoint stats and existing consumers                  | PARTIAL  | Backend stats are correct; Overview still uses `total - notified`.                                                        |
| Module DI                                              | COMPLETE | `AdminWaitlistService` is registered and `AuditLogService` remains globally resolvable.                                   |
| Structural and behavioral tests                        | PARTIAL  | Route/DTO floors pass; the critical conversion race and several CSV/security cases are absent.                            |

Implicit requirements not addressed: authoritative classification of a failed conditional claim, typed handling of malformed persisted JSON, and a consistency policy at the export limit.

## Edge cases

| Case                                  | Handled | How                                          | Concern                       |
| ------------------------------------- | ------- | -------------------------------------------- | ----------------------------- |
| Empty/beyond-final page               | YES     | Empty data with accurate metadata            | None in Batch A.              |
| Null source                           | YES     | `unknown` filter maps to `source: null`      | None observed.                |
| All eight timestamp combinations      | YES     | Pure derivation/predicate tests              | None observed.                |
| Reversed date range                   | YES     | Exact 400 `INVALID_DATE_RANGE` before Prisma | None observed.                |
| Dependency timeout/error              | YES     | Fixed route-specific 503 body                | Raw cause is logged only.     |
| Converted before approval read        | YES     | `already_paid`, no writes                    | None observed.                |
| Converted between read/update         | NO      | Stale row determines loser outcome           | Returns `already_approved`.   |
| Audit failure during export           | YES     | 503 before controller receives CSV           | None observed.                |
| Malformed audit metadata value        | NO      | Known keys copied without narrowing          | Contract break/data exposure. |
| Exactly 50,000 plus concurrent insert | NO      | Read capped at 50,000                        | Silent partial export.        |
| Approved without notified in Overview | NO      | UI recomputes `total - notified`             | Original visible bug remains. |

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Top risk: A converted row racing the claim is safely skipped but reported with the wrong contractual outcome, while the main Overview continues to show the lifecycle count this task was designed to correct.
- What a robust implementation would add: authoritative loser re-read for approval claims; use of the backend New aggregate in every consumer; typed audit metadata projection; race-safe export overflow detection; and regression tests for each boundary case.
