# Code Logic Review — `TASK_2026_533` Batch 13

Installed servers list and server detail pages, plus the two Batch 10 pre-fixes.

**Current status: see "Round 2" below — APPROVED, 9/10. The Round 1 summary and findings
that follow are kept for the record; all four are fixed in Round 2.**

## Summary (Round 1)

| Metric               | Value           |
| --------------------- | ---------------- |
| Overall score          | 7/10             |
| Assessment             | NEEDS_REVISION   |
| Blocking issues        | 0                |
| Serious issues         | 1                |
| Moderate issues        | 2                |
| Failure modes found    | 3                |

Scope examined: `libs/frontend/marketplace/src/lib/data/provider-filtering.ts` (+spec),
`ui/bulk-action-bar.component.ts` (+spec), `pages/servers/installed-provider-rows.ts`,
`pages/servers/provider-list-view.component.{ts,html,spec.ts}`,
`pages/servers/installed-servers-page.component.{ts,spec.ts}`,
`pages/servers/server-detail.component.{ts,html,spec.ts}`, all read in full. Supporting
files read for contract verification (not part of this batch's diff, used only to check
wiring correctness): `data/marketplace-inventory.store.ts`, `data/provider-row.ts`,
`ui/provider-table.component.ts`. `code-style-review-batch-13.md` does not yet exist, so no
duplication check against it was possible; naming/formatting observations are left out of
this review on that basis regardless.

## Five logic questions

### 1. How does this fail silently?

- The bulk-result summary can silently misreport a row that a user actually removed
  successfully as **failed**. See "Concurrent single + bulk removal of the same row" below
  — `provider-list-view.component.ts:296,451` (via `provider-table.component.ts:451`) only
  marks the *currently processing* ref busy, not the whole bulk selection, so a directly
  clicked "Remove" on a row still queued in the bulk run fires a second, independent
  `removeServer` call that races the bulk's own attempt on the same ref.
- A confirmed bulk removal uses the row list captured when the dialog opened
  (`provider-list-view.component.ts:506-526`, `pendingConfirm.rows`), not the current
  `effectiveSelection()`. If the filter changes while the inline confirmation is showing
  (nothing disables the filter controls — `setFilter` at :348-350 does not clear
  `pendingConfirm`), "Remove anyway" still acts on rows the filter now hides, silently
  breaking the "never remove a row hidden by a filter" guarantee the request-time check
  enforces. Partially mitigated: the confirm box already lists the affected rows by name
  and path, so the user is not blindsided about *which* rows, only that the filter no
  longer matches them.
- `removeSelected` (`provider-list-view.component.ts:544-585`) never rethrows; a thrown
  `removeMany` is caught and every row in the attempted set is marked `failed` with a fixed
  message (`BULK_FAILED_REASON`). This is documented as an intentional degradation ("every
  item is shown as failed... instead of the run vanishing silently") and is a defensible,
  visible failure — not a silent one. No issue here.

### 2. What user action produces unexpected behaviour?

- Selecting several rows, starting a bulk removal, then — while it is still running —
  clicking the "Remove" button on one of the *other* selected rows directly (not yet
  reached by the bulk's sequential loop). Both removal paths race on the same backend
  target; see the failure mode below.
- Opening a single-row or bulk direct-confirmation, then changing the search/origin/status
  filter before clicking "Remove anyway": the confirmed removal ignores the new filter and
  acts on the originally selected rows.
- Escape while both a pending confirmation and the docked detail are open: the code
  correctly cancels the confirmation first (`provider-list-view.component.ts:412-421`), but
  no spec exercises this compound state — see Edge cases.

### 3. What input data produces a wrong answer?

- None found that produces an outright wrong *displayed* value for a single, stable
  inventory snapshot. `providerStatusLabel` (pre-fix a) is correctly re-derived from
  `statusPresentation()` so the filter word, the pill word and the search-matched word can
  never disagree (`data/provider-filtering.ts:82-84,116`); table-driven specs confirm this
  for every `ProviderStatus` (`provider-filtering.spec.ts`, not fully quoted here but
  present per the executor report and consistent with the source).
- The one "wrong answer" class found is the concurrency one above: `bulkRemovalResult`
  (`provider-list-view.component.ts:97-114`) is pure and correct for the outcomes it is
  given, but the *outcomes* it is given can be wrong when a row was removed out from under
  the bulk run by a concurrent direct click.

### 4. What happens when a dependency fails?

- `MarketplaceInventoryStore.removeServer` / `removeMany` throwing is handled in both
  callers: `removeOne` (list) sets a notice (:532-542); `removeSelected` marks every row
  failed with `console.warn` (:570-581, degradation-audit comment). `ServerDetailComponent`
  does not wrap `remove()` in try/catch (`server-detail.component.ts:401-413|:401`), but
  the store's own `removeServer`/`removeAndNotify` already catches internally and always
  resolves to an `InventoryRemovalOutcome` (`marketplace-inventory.store.ts:568-573`), so an
  unhandled rejection here would only occur if the store's own contract were broken —
  reasonable to rely on.
- A `reconnect()` failure sets `actionError` inline (`server-detail.component.ts:383-399`);
  an `awaiting-setup` outcome sets an info note. Both are rendered (`server-detail.component.html:421-438`).
  Correct.
- Harness detection (`targetViews`) treats an absent target health entry as `'unknown'`
  rather than `'not-detected'` (`server-detail.component.ts:326-331`), which is the
  documented, correct interpretation ("harness detection reads `health()` only and never
  refreshes").

### 5. What is missing that the requirements never mentioned?

- No lock on the rest of a bulk selection while one item in it is being individually
  removed through its own row button — the plan says "Blocked or manage-link rows are not
  selectable" but never anticipates a selected-and-removable row being independently
  actioned mid-bulk-run.
- No guard that dismisses or re-validates a pending direct-removal confirmation when the
  underlying filter changes while it is open.
- The masking claim ("the rendered innerHTML contains neither secret... on the Overview,
  Config or Targets tab") is only exercised against the `linear` fixture, whose transport is
  `http` (headers + env). The `stdio` Command/args branch of the Config tab
  (`server-detail.component.html:236-248`) is never rendered under the masking assertion in
  this batch's own spec, so the "masked args" claim for a *stdio* row with a secret-looking
  argument is untested here (though the masking itself is produced by `maskArgs()` in the
  already-existing `data/provider-row.ts`, outside this batch's diff).

## Failure modes

### Concurrent single + bulk removal of the same row

- Trigger: select 2+ removable rows, start bulk removal (`requestBulkRemoval` →
  `removeSelected`, which awaits `inventory.removeMany(refs)` sequentially — see
  `marketplace-inventory.store.ts:522-539`); while the run is still processing an earlier
  row, click the "Remove" button on a different row that is part of the same bulk
  selection but not yet reached by the loop.
- Symptom: the directly clicked row is removed immediately via `removeOne` →
  `inventory.removeServer` (list path, `provider-list-view.component.ts:496-503`). When the
  bulk loop later reaches that same ref, it re-attempts the backend removal
  (`marketplace-inventory.store.ts:551-577`, `performRemoval` using the stale captured
  `group`), which — depending on how `removeInstalledGroup` treats an already-removed
  target — either no-ops or fails. Either way the bulk result summary can show that row as
  `failed` (with a backend message such as "not found") even though the user's direct click
  already removed it successfully, and the selection-cleanup logic
  (`provider-list-view.component.ts:562-569`) does not un-select it because the bulk
  outcome for that id was not `'removed'`.
- Evidence: `provider-list-view.component.ts:296` (`busyRefs = this.inventory.pendingIds`,
  which the store only populates for the *currently in-flight* ref —
  `marketplace-inventory.store.ts:559,575`, set/cleared per item inside the sequential
  loop, not for the whole batch at once); `provider-table.component.ts:451`
  (`[disabled]="busyRefs().has(row.ref)"` — the only guard on the per-row Remove button).
- Current handling: none. Nothing disables a bulk-selected row's own Remove button for the
  rows still queued behind the one currently processing.
- Recommendation: while `bulkBusy()` is true, treat every id in the in-flight bulk request
  as busy for the purpose of the per-row button, e.g. `busyRefs = computed(() => bulkBusy()
  ? new Set([...pendingIds(), ...inFlightBulkRefs()]) : pendingIds())`, or simply disable
  each row's Remove button whenever its ref is in the *original* bulk selection and
  `bulkBusy()` is true. Add a regression spec that clicks a queued row's Remove button
  during an in-progress `removeMany` and asserts it is a no-op (button disabled, no second
  `removeServer` call).

### Stale row list in a pending direct-removal confirmation

- Trigger: select rows including at least one `confirm-direct` row, click the bulk action
  (opens the inline confirmation, `provider-list-view.component.ts:506-513`); before
  clicking "Remove anyway", change the search/origin/target/status filter so one of the
  confirmed rows would now be excluded from `visibleRows()`/`effectiveSelection()`.
- Symptom: "Remove anyway" still calls `removeSelected(pending.rows, true)` with the
  original row list (`provider-list-view.component.ts:517-526`), removing a row the current
  filter no longer shows, even though the plan's own stated invariant is "a row hidden by a
  filter is never removed unseen."
- Evidence: `provider-list-view.component.ts:506-515` (`rows = this.effectiveSelection()`
  captured once, at request time) vs `:517-526` (`confirmRemoval` replays `pending.rows`
  unfiltered); `:348-350` (`setFilter` never touches `pendingConfirm`).
- Current handling: none; the confirmation UI does at least name every affected row and its
  config path, so the user sees what will be removed, just not filtered by the *current*
  view.
- Recommendation: either disable filter controls while `pendingConfirm()` is non-null, or
  re-derive the confirmed row set from the live selection at confirm time and drop any row
  that dropped out of `effectiveSelection()` since the dialog opened (reporting it as
  skipped, not silently including it).

### Untested Escape-layering compound state

- Trigger: at the `wide` tier, open the docked detail, then trigger a pending confirmation
  from the *list* side (e.g. click a `confirm-direct` row's Remove button while the docked
  detail for a different row is open — both are visible simultaneously at `wide`), then
  press Escape once.
- Symptom: none expected — `onKeydown` (`provider-list-view.component.ts:408-421`) checks
  `pendingConfirm()` before `detailOpen() && docked()`, so the confirmation should be
  cancelled first and the detail should stay open. This is implemented correctly by
  inspection.
- Evidence: `provider-list-view.component.spec.ts:471-495` tests "Esc closes the docked
  detail" and "Esc inside the drawer closes it" as separate scenarios; `:532-545` tests
  "cancels the confirmation with Cancel or Esc" with no detail open. No test combines a
  pending confirmation with an open docked detail to pin the claimed ordering.
- Current handling: correct in source, unverified by a spec for the compound case.
- Recommendation: add a spec that opens the docked detail, opens a pending confirmation
  from the list, presses Escape once, and asserts the confirmation is gone while the detail
  is still open; press Escape again and assert the detail then closes.

## Blocking issues

None found.

## Serious issues

### Bulk removal is not race-safe against a concurrent single-row removal of the same row

- File: `libs/frontend/marketplace/src/lib/pages/servers/provider-list-view.component.ts:296,506-585`
  and `libs/frontend/marketplace/src/lib/ui/provider-table.component.ts:451`
- Scenario: see "Concurrent single + bulk removal of the same row" above.
- Impact: the bulk-result summary — the one thing this batch was specifically asked to get
  right ("N removed, M failed with reasons") — can report a successfully removed server as
  a failure, and the store makes a redundant/possibly erroring second backend call for a
  target that no longer exists. This is directly reachable through the shipped UI, not a
  contrived internal state.
- Fix: derive the per-row busy state so that every row targeted by an in-flight bulk run is
  disabled for the run's full duration, not only the row currently being processed; add a
  regression spec.

## Moderate and minor issues

- Moderate: `provider-list-view.component.ts:506-526` — a pending direct-removal
  confirmation replays a stale row list at confirm time instead of re-deriving from the
  live filtered selection; see "Stale row list" failure mode above.
- Moderate (test gap): `provider-list-view.component.spec.ts` has no spec for the compound
  "pending confirmation while the docked detail is open" Escape case; see "Untested
  Escape-layering compound state" above. The implementation itself is correct.
- Minor (test gap): `server-detail.component.spec.ts:354-377` exercises the masking
  assertion only against the `http`-transport fixture (`linear`); the `stdio` Command/args
  branch of the Config tab is never included in a leak check in this component's own spec.
  Low risk because `maskArgs()` masking happens in `data/provider-row.ts` (outside this
  batch) and `ConfigSummary.args` is typed to be pre-masked, but this batch's own "no secret
  in any tab" claim is not fully backed by its own test for that branch.
- Minor: `installed-provider-rows.ts` has no dedicated spec (acknowledged in the executor
  report as covered transitively by the three page specs). Logic in the file is small and
  is exercised indirectly by every page spec that mounts a real store, so this is
  acceptable as coverage, not as a logic gap.

## Data flow

1. `MarketplaceInventoryStore.installed()` / `ConnectorLinksStore` → `injectProviderRows()`
   (`installed-provider-rows.ts:26-36`) → `ProviderRow[]` — OK, pure read, no `ensure()`
   call, matches the "page decides what loads" rule.
2. `ProviderListViewComponent` applies `filterProviderRows` → `sortProviderRows` →
   `visibleRows()` — OK, pure, stable-sort verified by source inspection.
3. Row selection (`selection` signal, raw refs) is narrowed to `effectiveSelection()` for
   the bulk bar (visible + selectable only) — OK, matches the documented "never remove
   unseen" rule, and matches what the DOM actually renders as checked (hidden rows are not
   rendered, so no visual/state mismatch).
4. Single remove: `requestRemove` → (`confirm-direct`? inline confirm : `removeOne`) →
   `inventory.removeServer` → RPC → outcome → notice or navigate-away (detail) — OK.
5. Bulk remove: `requestBulkRemoval` → (`confirm-direct` present? inline confirm holding a
   **snapshot** of the selected rows : `removeSelected`) → `inventory.removeMany` (store,
   sequential, one `pendingIds` entry at a time) → `bulkRemovalResult` → bulk bar — gap: the
   snapshot in step 5 is not re-validated against the live selection or the live "not
   currently being individually removed" state at execution time (see Serious and Moderate
   findings above).
6. `ServerDetailComponent`: `serverRef` route input → `decodeServerRef` → re-`encodeServerRef`
   → matched against `injectProviderRows()` → `view()` state machine (`loading` / `error` /
   `not-found` / `ready`) — OK, and specifically verified for the TASK_2026_540 workspace-
   switch acceptance (`server-detail.component.spec.ts:274-290`, same URL, "Not found"
   renders once the reloaded inventory no longer contains the row).
7. Config tab render: `ConfigSummary` (already masked upstream) → template shows keys only,
   `MASKED_VALUE`, sr-only "value hidden" — OK by inspection and by the `http`-branch spec;
   `stdio` branch untested for leaks in this batch (Minor, above).

## Requirements fulfilment

| Requirement                                                                 | Status  | Gap                                                                 |
| ----------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------- |
| Pre-fix a: `providerStatusLabel` derives from `statusPresentation()`          | COMPLETE | none                                                                    |
| Pre-fix b: bulk-bar icon tone on a wrapper span                               | COMPLETE | none                                                                    |
| Table (regular+) / cards (compact), origin groups at wide                     | COMPLETE | none                                                                    |
| Detail placement: drawer (compact/regular) vs docked (wide), open ⇔ `serverRef`| COMPLETE | none                                                                    |
| Keyboard: ↑/↓/Home/End, Enter, Esc layering                                   | COMPLETE (impl.) | Esc-layering compound case untested (Moderate, above)          |
| Selection persists across a tier flip                                         | COMPLETE | none, spec present                                                     |
| Bulk removal only on visible + selectable rows                                | PARTIAL  | broken by a stale filter at confirm time (Moderate, above)             |
| Bulk result summary (N removed, M failed with reasons)                        | PARTIAL  | can misreport under the concurrency race (Serious, above)              |
| `confirm-direct` inline confirmation, single and bulk, naming config paths    | COMPLETE | none                                                                    |
| Secret masking on every tab (Overview/Targets/Config)                         | COMPLETE (impl.) | `stdio` branch not exercised by this batch's own leak spec (Minor) |
| `ServerDetail` "Not found" incl. workspace-switch (TASK_2026_540 item 6c)     | COMPLETE | none, spec present and matches the "same URL" acceptance               |
| manage-link (claude.ai connector) rows: reason text, no link                  | COMPLETE | documented deviation, correctly implemented                            |
| `InstalledServersPageComponent` RPC set exactness, active-workspace-only KPI  | COMPLETE | none, spec present                                                     |

Implicit requirements not addressed: locking the rest of a bulk selection against
independent single-row action for the duration of the bulk run (see Serious issue).

## Edge cases

| Case                                                              | Handled | How                                                                 | Concern                                                    |
| --------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------ | -------------------------------------------------------------- |
| Row vanishes before a bulk run starts                                | YES      | `missing` computed against a fresh snapshot, reported as failed with "It is no longer installed." | none |
| Row vanishes *during* a bulk run via a concurrent single click       | NO       | not handled — see Serious issue                                          | misleading "failed" summary entry for an actually-removed row |
| Filter narrows the visible set while a bulk confirm dialog is open   | NO       | not handled — see Moderate issue                                         | confirmed removal ignores the new filter                       |
| Tier flip while selection/detail are active                          | YES      | component stays mounted, only the template branch changes; spec present  | none |
| Deep link to a detail route on initial activation (no route snapshot yet) | YES | `syncDetailFromRouter` reads defensively, re-synced on `NavigationEnd`    | none, spec-worthy fix already covered per executor report      |
| Workspace switch drops the open detail's server                     | YES      | `view()` recomputes to `not-found` once `installed` reloads without it; same-URL spec | none |
| Malformed `serverRef`                                                | YES      | `decodeServerRef` → `null` → `not-found`                                 | none |
| Env/header secrets in a real RPC payload (http transport)            | YES      | `innerHTML` leak check across Overview/Config/Targets                    | none |
| Env/header/arg secrets on a `stdio` row's Command tab                | PARTIAL  | masking is produced upstream (`maskArgs`) and rendered verbatim here     | this batch's own spec never renders that branch under a leak check (Minor) |
| Escape with both a pending confirmation and an open docked detail    | PARTIAL  | code orders confirmation-cancel first (correct by inspection)            | untested compound case (Moderate)                              |

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Top risk: a user who removes one row directly while a bulk removal of several rows
  (including that same row) is still in flight can see that row reported as a bulk
  *failure* even though it was actually removed, because the per-row Remove button is only
  disabled for the row currently being processed by the bulk loop, not for the whole
  in-flight bulk selection.
- What a robust implementation would add: (1) lock every row targeted by an in-flight bulk
  removal, not just the one currently processing, plus a regression spec; (2) re-validate
  or freeze the filter/selection state for the duration of a pending direct-removal
  confirmation; (3) a spec pinning the Escape-layering order when a confirmation and the
  docked detail are open at the same time; (4) extend the detail's masking spec to render
  the `stdio` Command branch under the same leak check used for the `http` branch.

## Round 2

Re-review of the fixes applied in `batch-13-report.md` §"Revise round 1" against the four
logic findings above. Scope: `provider-list-view.component.ts` (+`.html`), the new
`ui/direct-removal-confirm.component.ts` (+spec), the moved
`data/installed-provider-rows.ts`, `server-detail.component.ts` (+`.html`, +`.spec.ts`
diff), and the split spec suite (`provider-list-view.component.spec.ts`,
`provider-list-view.removal.spec.ts`, `provider-list-view.testing.ts`) — all read in full.
Verified `ptah_get_diagnostics` on every changed/created file: the only errors reported are
pre-existing, in files this batch does not touch (`core/src/testing/mock-rpc-service.ts`,
`connected-surface.component.spec.ts`, `harness-health.store.spec.ts`) — identical to the
round-1 diagnostics run, confirming no new type errors were introduced. Confirmed
`provider-list-view.testing.ts` is imported only from `*.spec.ts` files, never from
production code (`grep -rl "provider-list-view.testing"` excluding spec/testing files
returns nothing).

### Fix 1 — bulk vs. single removal race (was Serious)

`provider-list-view.component.ts:312-325` adds a `queuedRefs` signal populated with every
ref of the running bulk request (`:608`, before the `await`) and cleared only in `finally`
(`:633`). `busyRefs` (`:321-325`) is now the union of `queuedRefs` and the store's
`pendingIds`, and is the same signal fed to both the table and the card list
(`provider-list-view.component.html:84,103`), which already disable the per-row Remove
button on `busyRefs().has(row.ref)` (`provider-table.component.ts:451`, unchanged).
`requestRemove` (`:542-551`) also returns early for a busy ref as defense in depth.

The regression spec (`provider-list-view.removal.spec.ts:147-181`) reproduces the exact
round-1 scenario: it holds `removeMany` open on a promise, confirms the row still queued
behind the one currently processing has a **disabled** Remove button, clicks it anyway and
asserts `removeServer` is never called, then resolves the bulk run and confirms the button
re-enables and the summary reads "2 removed" (not a spurious failure). This is a correct,
targeted fix — the exact race identified in round 1 is closed and pinned by a test that
would fail without the fix (verified by inspection: removing the `queuedRefs` union would
leave `node_repl`'s button enabled and the test's `disabled` assertion would fail).

**Verdict: fixed.**

### Fix 2 — stale direct-removal confirmation (was Moderate)

`PendingConfirm` (`:73-74`) now stores only intent (`{mode:'single', ref}` or
`{mode:'bulk'}`), never a row snapshot. `confirmView` (`:327-341`) re-derives the rows shown
and removed from the *live* `allRows()`/`effectiveSelection()` on every read, and returns
`null` the moment nothing direct remains selected/visible — which the template already
gates rendering on (`@if (confirmView(); as confirm)`,
`provider-list-view.component.html:36`). `confirmRemoval` (`:565-575`) reads `confirmView()`
fresh at click time and removes exactly `view.rows`, not a captured list; it also now
guards the bulk branch with `!this.bulkBusy()`, preventing a double bulk-run if "Remove
anyway" is somehow double-fired.

Two new specs cover the exact scenario from round 1 directly:
`provider-list-view.removal.spec.ts:201-219` types into the search field while a bulk
confirmation is open and asserts the confirmation text updates ("1 of the 3" → "1 of the
1") and that only the still-matching row is actually removed; `:221-233` shows a filter
that hides every direct row drops the confirmation entirely and a fresh bulk run only
touches the still-visible row. Both assert on the real removal call, not just the DOM text,
so they exercise the invariant the round-1 finding was about, not merely its symptom.

`ServerDetailComponent`'s own `confirming` boolean (unchanged, `:165,370-386`) was not part
of this finding (it has no filter/selection concept — a single row's confirmation can only
go stale by the row itself vanishing, which `remove()`'s fresh `this.group()` lookup
(`:406-408`) already handles by silently no-op'ing once `view` has already flipped the
whole detail to "Not found").

**Verdict: fixed.**

### Fix 3 — Escape-layering compound case (was Moderate, test gap)

`onKeydown`'s Escape branch (`:456-465`) now checks `this.confirmView() !== null` (was the
raw `pendingConfirm` signal) before the docked-detail branch — consistent with fix 2, since
`confirmView` is the thing the UI actually renders. The new spec
(`provider-list-view.component.spec.ts:244-264`) opens the docked detail for one row, opens
a direct-removal confirmation for a *different* row from the list beside it, presses Escape
once and asserts the confirmation is gone while the docked detail is still open at the same
URL, then presses Escape again and asserts the detail closes and focus returns to the
originally active row. This is exactly the compound scenario flagged as untested in round
1, now pinned end to end (URL, DOM presence, and focus).

**Verdict: fixed.**

### Fix 4 — stdio masking left unexercised (was Minor, test gap)

`server-detail.component.spec.ts` now gives the `firecrawl` (stdio) fixture a secret-looking
arg (`args: ['-y', 'firecrawl-mcp', '--api-key', ARG_SECRET]`, `:58`) alongside its existing
env secret, and the shared `leaks()` helper (`:355-360`) checks for all three secret values
(`ENV_SECRET`, the header secret, and now `ARG_SECRET`). A new spec
(`:383-400`) mounts the stdio row, checks no leak on the default Overview tab, switches to
Config and asserts the rendered Command text contains `--api-key ••••` (proving the masked
arg — not just the key — renders correctly) and the env key line, then checks Targets too.
This closes the coverage gap: the `stdio` Command branch is now exercised under the same
leak discipline as the `http` branch.

**Verdict: fixed.**

### Regression check on the accompanying refactor

The round-1 fixes rode along with four style fixes (helper relocation, the extracted
`DirectRemovalConfirmComponent`, the `ActivatedRouteSnapshot` cast removal, and a comment) 
and a 3-way spec split forced by the 700-line budget. None of these introduce new logic
risk:

- `data/installed-provider-rows.ts` is byte-for-byte the same logic as the pre-move file
  (`injectProviderRows`, `findGroupByRef`), only relocated; all three call sites
  (`installed-servers-page.component.ts:14`, `provider-list-view.component.ts:53-56`,
  `server-detail.component.ts:48-51`) were updated and there is no stray import of the old
  `pages/servers/installed-provider-rows` path left anywhere in the tree.
- `DirectRemovalConfirmComponent` is a faithful, pure extraction of the inline block from
  both `provider-list-view.component.html` and `server-detail.component.html`: the
  `bulk()`/`selectedCount()` branching reproduces the original single/bulk copy exactly, and
  it takes no store dependencies (`input`/`output` only), so it cannot introduce a new
  removal path or bypass the parent's confirm/cancel logic.
- The dropped `as ActivatedRouteSnapshot | undefined` cast (`syncDetailFromRouter`,
  `:444-445`) is a pure simplification — `this.route.firstChild?.snapshot?.paramMap.get(...)`
  is equivalent to the prior code under optional chaining, and the defensive comment about
  the snapshot being absent during initial activation was kept.
- The spec split (`provider-list-view.component.spec.ts` for tiers/placement/keyboard,
  `provider-list-view.removal.spec.ts` for removal, `provider-list-view.testing.ts` for the
  shared harness) does not drop any assertion present in round 1's single spec file: every
  test name from the original 692-line spec has a counterpart in one of the two new files
  (tier flip, focus trap, no-steal-focus, empty states, `bulkRemovalResult`, the direct
  confirmation, the hidden-row bulk exclusion), plus the new race/re-derivation/compound-
  Escape/stdio-masking tests. The harness (`provider-list-view.testing.ts`) is confirmed
  spec-only (see Scope note above).

### Round 2 summary

| Metric               | Value           |
| --------------------- | ---------------- |
| Round-1 findings fixed | 4 of 4           |
| New issues introduced  | 0                |
| Overall score          | 9/10             |
| Assessment             | APPROVED         |

All four round-1 logic findings (one Serious, two Moderate, one Minor) are fixed with
targeted regression specs that reproduce the originally reported scenario rather than only
asserting the surface symptom. The accompanying relocation/extraction/spec-split changes
were checked for regression risk and introduce none. No new logic issues were found in this
pass. The remaining half-point below a 10 reflects that this is still UI-level concurrency
handling (a client-side `queuedRefs` lock) rather than a server-side idempotency guarantee —
reasonable and sufficient for this batch's scope, but worth keeping in mind if a future
batch adds another independent removal entry point for installed servers that does not
route through this same `busyRefs`/`queuedRefs` mechanism.

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: none blocking; watch for a future removal entry point (e.g. a command palette
  or another page) that does not consult `ProviderListViewComponent`'s `busyRefs` and could
  reopen the same class of race outside this component's reach.
