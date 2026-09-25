# Code Logic Review — `TASK_2026_533` Batch 10

Scope: 12 new files under `libs/frontend/marketplace/src/lib/ui/` in worktree
`D:\projects\ptah-extension\.claude-worktrees\task533-b10` (branch `task533-b10`,
base `bff852d26`): `provider-table.component.ts`, `provider-card-list.component.ts`,
`provider-filters.component.ts` (incl. `ProviderFilterSelectComponent`),
`stat-card.component.ts`, `needs-attention.component.ts`, `coverage-matrix.component.ts`,
and their six `.spec.ts` files. All six components are read in full; the collaborator
data files they consume (`data/provider-row.ts`, `data/provider-filtering.ts`,
`data/attention.ts`, `data/coverage.ts`, `status-pill.component.ts`,
`shell/marketplace-route-url.ts`, `core/marketplace-route.ts`) and the executor's
`batch-10-report.md` are read to check every claimed deviation against the code.
`npx nx run @ptah-extension/marketplace:test` was re-run against this worktree:
40 suites / 915 tests pass, matching the report.

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 8/10 |
| Assessment | APPROVED |
| Blocking issues | 0 |
| Serious issues | 0 (1 pre-existing, out-of-scope, tracked below) |
| Moderate issues | 2 |
| Failure modes found | 3 (all pre-existing in files Batch 10 does not own) |

Batch 10's own six components are internally consistent, presentational, and honest
about their states (loading/error/empty), and every deviation the executor claimed is
verified against the code below. The two out-of-scope observations the executor raised
are real defects in already-committed files from other batches; neither should be fixed
inside Batch 10, and one is Serious enough to need a tracked follow-up before the pages
that depend on it (Batch 13/15/16) ship search to users.

## Five logic questions

### 1. How does this fail silently?

- No silent failure inside the six Batch 10 components themselves: every data
  component (`ProviderTableComponent`, `ProviderCardListComponent`,
  `NeedsAttentionComponent`, `CoverageMatrixComponent`, `StatCardComponent`) takes
  explicit `state: 'loading'|'ready'|'error'` and renders a distinct branch for each —
  there is no default-to-ready-with-empty-data path that could mask a failed load.
- One real (but out-of-scope) silent-failure risk: `provider-table.component.ts:390`
  and `provider-card-list.component.ts:178` compute `[checked]` as
  `isSelectable(row) && selected().has(row.ref)`. If a page ever adds an
  unselectable ref to its `selected` signal (e.g. a row transitions from selectable
  to `blocked` while selected), the checkbox silently renders unchecked with no
  warning, and `selectionChange` is never emitted to reconcile the stale ref out of
  the page's own signal — the page's selection count could stay wrong until the next
  explicit toggle. This is defensive by design (the docs even say "the page owns the
  selection"), so it's Minor, not Serious, but it is worth a one-line note for the
  page authors in Batch 13.

### 2. What user action produces unexpected behaviour?

- Typing a status word into the search box that is visible on a status pill —
  "Pending" or "Needs input" — does not find matching rows, because the search
  haystack is built from a different vocabulary than what the pill shows (see
  Serious observation 2b below). This is real, user-facing, and reproducible, but it
  is not caused by any file Batch 10 owns.
- Inside Batch 10 itself: pressing Enter/Space on a closed
  `ProviderFilterSelectComponent` trigger does nothing (`provider-filters.component.ts:219-226`
  returns early when `!this.isOpen()`), so the only way to open the dropdown with the
  keyboard is ArrowUp/ArrowDown — Enter/Space are documented ARIA-combobox openers too.
  This is a Minor a11y gap, not a correctness defect (the dropdown is still fully
  keyboard-operable via arrows), and the executor's own doc comment only promises
  "ArrowUp/ArrowDown open the list", so this is not a requirements miss, just worth
  a note.

### 3. What input data produces a wrong answer?

- `coverage-matrix.component.ts:353-359` (`rowViews` computed): `cells[index] ?? 'none'`
  guards a mismatch between `columns.length` and `cells.length`, but
  `buildCoverageMatrix()` (`data/coverage.ts:127-134`) always builds `cells` aligned
  1:1 with `columns`, so this branch is unreachable with the real model — correctly
  defensive, not a live bug.
- `stat-card.component.ts:202-208` (`hasValue`): a `value` of empty string `''` or
  whitespace-only string renders "—" and hides the unit, matching the documented
  contract ("a missing, blank or NaN value shows '—'"); `NaN` explicitly falls into
  `!Number.isFinite(value)` → "—". Verified correct for both numeric and string
  inputs, including negative and zero numbers (`0` is finite, so `hasValue` is `true`
  and `0` displays, which is correct — a stat of zero is a real answer, not a missing
  one).
- The status-word mismatch above (question 2) is the clearest "wrong answer" case in
  the whole batch's dependency surface, but again, it lives in a file Batch 10 does
  not touch.

### 4. What happens when a dependency fails?

- All five data components take a `retryRequested` output and a page-supplied
  `errorMessage`; none of them call a service or store directly (no injection
  anywhere in the batch — verified: no `inject()` call in any of the six files), so
  there is no dependency for these components themselves to fail against. The
  failure-handling contract is entirely the page's responsibility, which matches the
  plan's "presentational, no store injection" requirement (C8) and the batch's own
  claim.
- `ProviderFilterSelectComponent` depends on `NativeDropdownComponent`/`NativeOptionComponent`
  (`@ptah-extension/ui`). Its `isOpen`/`panelRole`/`closed` usage was checked against
  `native-dropdown.component.ts:118-174` and matches the documented contract exactly
  (required `isOpen` input, `panelRole: null` to suppress the native `role="listbox"`
  the dropdown would otherwise add — since the component supplies its own
  `role="listbox"` on the `content` slot — and a `closed` output that flips
  `isOpen` to `false`).

### 5. What is missing that the requirements never mentioned?

- `ProviderFilterSelectComponent` is a second component declared inside
  `provider-filters.component.ts` (deviation 4). This is disclosed and matches
  plan C8's grouping ("Both use `ptah-provider-filter-select`, a small second
  component in the same file") — not a gap.
- `NeedsAttentionComponent`'s empty state has no CTA output (deviation 5), which the
  executor argues is the honest choice since "nothing needs attention" has no action.
  Plan C8 says "every data component has explicit... `empty` (with a
  call-to-action output)... states", so this is a literal deviation from the plan
  text, correctly flagged as such rather than silently dropped, and the reasoning
  (there is genuinely nothing to click) is sound. Accepted.
- Nothing in the batch's own files is stubbed, TODO'd, or fabricated; every output
  is wired to a real emit, and the five data components all implement all three
  required states end to end.

## Failure modes

### FM-1 (out of scope, Serious): search does not find rows by their visible status word

- Trigger: a user reads a `ptah-status-pill` showing "Pending" or "Needs input" (from
  `statusPresentation()`, `status-pill.component.ts:53,48-52`) and types that word into
  `ProviderFiltersComponent`'s search box.
- Symptom: the page's `filterProviderRows()` (`data/provider-filtering.ts:118-131`)
  builds its search haystack from `providerStatusLabel(row.status)`
  (`STATUS_LABELS`, `provider-filtering.ts:76-87`), which uses **different words**
  for the same two statuses: `pending` → "Starting" (not "Pending"), `needs-input` →
  "Needs setup" (not "Needs input"). The row silently does not match; there is no
  error, just an empty result the user has no way to explain.
- Evidence: `status-pill.component.ts:48-53` (`'needs-input': { label: 'Needs input' }`,
  `pending: { label: 'Pending' }`) vs. `provider-filtering.ts:79,83`
  (`'needs-input': 'Needs setup'`, `pending: 'Starting'`); haystack construction at
  `provider-filtering.ts:118-131` (`matchesTerms`, line 123:
  `providerStatusLabel(row.status)`).
- Current handling: none — `providerStatusLabel` and `statusPresentation` are two
  independent vocabularies with no shared source.
- Recommendation: `providerStatusLabel` should derive its label from
  `statusPresentation(status).label` (a one-line change, dropping the separate
  `STATUS_LABELS` map, or keeping only the two words that already agree). This is a
  correctness defect in `data/provider-filtering.ts`, but that file is not in Batch
  10's file list — it was written and committed in Batch 8 (`666a0867c`, per
  `handoff.md` §2) and Batch 10's own components never call `providerStatusLabel`
  (the filters component and status pill both go through `statusPresentation()`
  exclusively, which is the correct choice per plan C8 — "Status words come only from
  `statusPresentation()`"). **Do not fix this inside Batch 10**: editing a Batch 8
  file from a Batch 10 worktree crosses the file-disjoint batch boundary
  (`batches.md` decomposition defaults: "at most 12 files... one lib per batch where
  possible"; Batch 10 is already at its 12-file cap) and risks colliding with Batch
  11, which is being committed into the same Nx project (`@ptah-extension/marketplace`)
  concurrently. **It does need to be fixed before the search feature is real**,
  because Batch 13 (installed-servers page) is the first batch to wire
  `filterProviderRows` behind an actual search box a user can type into — the
  defect is inert today (Batch 10 ships no page), live once Batch 13 lands. Track it
  as a required one-line fix that lands no later than Batch 13, either as its own
  tiny batch or as a first task inside Batch 13.

### FM-2 (out of scope, Moderate-to-Serious, unverified): result-icon tone in `BulkActionBarComponent` may not render

- Trigger: a bulk removal in `BulkActionBarComponent` (Batch 9,
  `bulk-action-bar.component.ts`) finishes and shows its result icon.
- Symptom: the success/error tone (`text-success`/`text-error`) may not reach the
  icon's stroke color.
- Evidence: `bulk-action-bar.component.ts:146-153` binds both a static
  `class="h-3.5 w-3.5 shrink-0"` and a bound `[class]="outcome.failed.length > 0
  ? 'text-error' : 'text-success'"` directly on `<lucide-angular>`. Verified against
  the installed package (`node_modules/lucide-angular/esm2020/lib/lucide-angular.component.mjs:171-172`):
  `LucideAngularComponent` declares `@Input() class?: string`. Angular's compiler
  redirects a `[class]` *property* binding to a matching directive `@Input()` named
  `class` on the target element instead of writing it to the native DOM class
  attribute of the host — this is a documented Angular Ivy caveat, and it is exactly
  why Batch 10's own icon-tone usages (`stat-card.component.ts:90-97`,
  `coverage-matrix.component.ts:245-253,268-277,296-304`,
  `needs-attention.component.ts:176-191`) all put the `[class]` binding on a wrapper
  `<span>` around the icon rather than on `<lucide-angular>` itself, and document why
  in a code comment ("lucide-angular owns its host class; the tone sits on a wrapper
  and reaches the stroke through `currentColor`", `stat-card.component.ts:88-89`).
  `bulk-action-bar.component.ts` predates that pattern and does not follow it.
- Current handling: none; no spec in `bulk-action-bar.component.spec.ts` asserts the
  rendered icon actually carries the tone class (confirmed no such assertion exists
  in the file read for this review).
- Recommendation: wrap the result icon in a tone-classed `<span>`, matching the
  pattern Batch 10 established, and add a spec asserting the rendered class. This is
  a Batch 9 file, not touched by Batch 10 — **do not fix it here**. Unlike FM-1, this
  defect's blast radius is smaller (one icon's color in a result summary that also
  carries text, so the information is not lost, only a visual affordance is
  degraded) and its presence is not proven by a failing test, only by reading the
  Angular/lucide-angular source — hence Moderate rather than Serious pending an
  actual browser/DOM-rendering check. Recommend the team-leader schedule a small
  follow-up against `bulk-action-bar.component.ts` (a two-line template fix plus one
  spec), not a re-open of Batch 9 or Batch 10.

### FM-3 (in scope, Minor): stale selection entry after a row leaves the selectable set

- Trigger: a page keeps a ref selected in its own `selected` signal while the row's
  `removal.kind` transitions to `blocked` or `manage-link` between loads (e.g. after
  a reload the same server is now reported as blocked).
- Symptom: the checkbox silently shows unchecked (`isSelectable(row) &&
  selected().has(row.ref)` short-circuits to `false`), but the page's `selected` set
  still contains the ref, so a bulk-action count derived from `selected().size`
  elsewhere could overcount versus what the UI shows checked.
- Evidence: `provider-table.component.ts:390`, `provider-card-list.component.ts:178`.
- Current handling: display-only guard; no `selectionChange` is emitted to prune the
  stale ref.
- Recommendation: none required for Batch 10 (the components correctly state "the
  page owns the selection" and never claim to reconcile it); worth a one-line note
  for whichever page batch (13/15/16) derives a bulk-action count from the raw
  `selected` set rather than from `selected ∩ visible-selectable`.

## Blocking issues

None.

## Serious issues

None inside the reviewed batch. FM-1 above is Serious in effect but lives entirely
outside Batch 10's file list; see "Failure modes" for why it is not raised as a
blocking issue against this batch and what must happen before it ships to users.

## Moderate and minor issues

- `provider-filters.component.ts:219-226`: Enter/Space on a closed filter-select
  trigger is a no-op; only ArrowUp/ArrowDown open it. Minor a11y completeness gap,
  not a correctness defect, not contradicted by the component's own doc comment.
- FM-3 above (stale selection display vs. page-held selection set) — Minor, informational.
- `stat-card.component.spec.ts` / others: test counts per file sum to 79, not the 86
  the report states; likely a miscount in the report (possibly counting `describe`
  blocks or a stale draft), not a functional issue — flagged only because the report
  is otherwise very precise about numbers. Does not affect the verdict.

## Data flow

1. Page holds `ProviderRow[]`, `ProviderFilter`, `ProviderSort`, `Set<string>`
   selection, `activeRef`, `busyRefs` in signals — OK, verified no component in this
   batch injects a store or mutates an input in place (`withRefSelected` explicitly
   returns a new `Set`, `provider-table.component.ts:124-133`).
2. `ProviderFiltersComponent` emits a whole next `ProviderFilter` on every control
   change (`update()`, `provider-filters.component.ts:471-473`) — OK, no partial
   mutation risk, no missed field.
3. Page (not in this batch) is expected to call `applyProviderView(rows, filter,
   sort)` (`data/provider-filtering.ts:169-175`) to derive the rows it hands to
   `ProviderTableComponent`/`ProviderCardListComponent` — OK by contract, but the
   search half of that pipeline carries FM-1 once a real page wires it (out of
   Batch 10's control).
4. `ProviderTableComponent`/`ProviderCardListComponent` render rows, emit
   `selectionChange`/`sortChange`/`openRequested`/`removeRequested` back to the page
   — OK, every output is wired to a real user action, none is fired speculatively.
5. `NeedsAttentionComponent` takes pre-built `NeedsAttentionItem[]` (the page is
   expected to call `needsAttention()` from `data/attention.ts`) and computes only
   the router-link commands per item via the pure, exported `needsAttentionLink()`
   — OK; every `NeedsAttentionTarget` kind (`server`, `servers`, `smithery`,
   `harness`) is handled, verified exhaustive against `data/attention.ts:38-42`, and
   the `harness → /marketplace/skills` mapping is verified as the only route that
   exists today (`core/marketplace-route.ts:36-40` has no `harness` page) — OK,
   correctly disclosed as a deviation rather than a silent misroute.
6. `CoverageMatrixComponent` takes a pre-built `CoverageMatrix` (page calls
   `buildCoverageMatrix()`) and renders per-target cells or one merged cell — OK;
   verified the `kind === 'merged'` narrowing in `rowViews` (line 348) correctly
   narrows the union so `.cells`/`.label` access on each branch is type-safe, and the
   `cells[index] ?? 'none'` guard (line 358) is defensive against a shape the real
   model cannot currently produce.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| `ProviderTableComponent`: `<th scope="col">`, `aria-sort`, checkbox `aria-label`, active-row styling, no "Last used" column | COMPLETE | none — verified in template and spec `provider-table.component.spec.ts:213` |
| `ProviderCardListComponent`: compact `<ul role="list">`, same contract minus sort | COMPLETE | none |
| Blocked/`manage-link` rows not selectable, disabled checkbox with explanatory label | COMPLETE | none — `providerRowCheckboxLabel` covers both kinds with distinct reasons |
| `ProviderFiltersComponent`: search input, origin radiogroup, target/status dropdowns, "filters are not navigation" | COMPLETE | none — no `<a>`/router use anywhere in the file |
| Status words from `statusPresentation()` only | COMPLETE | the component itself is correct; the sibling search-matching file (`provider-filtering.ts`, out of scope) is not — see FM-1 |
| `StatCardComponent`: `tabular-nums`, skeleton, Retry output, no sparkline | COMPLETE | none |
| `NeedsAttentionComponent`: icon+word severity (never colour alone), title, detail, "Review" `routerLink` | COMPLETE | none |
| `CoverageMatrixComponent`: `<table>` with `<caption>`, check/dash icons with sr-only text, merged "Ptah sessions" cell | COMPLETE | none |
| Every data component: loading, empty (with CTA), error (message + Retry) | PARTIAL | `NeedsAttentionComponent`'s empty state has no CTA — disclosed deviation 5, judged sound (nothing to act on) |
| Presentational, OnPush, no injection | COMPLETE | verified no `inject()` in any of the six files |
| No `innerHTML`; theme tokens only | COMPLETE | verified via each spec's own source-scan test and manual read |

Implicit requirements not addressed: none found beyond what is already listed in
Failure modes (FM-1/FM-2, both outside this batch's files).

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Zero rows (table/cards) | YES | dedicated empty branch with optional CTA | none |
| `state='loading'` with rows still present | YES | `@switch(state())` short-circuits before the rows branch, so stale rows never leak through during a reload | none |
| Selected ref not in visible rows (filtered out) | YES | `selectableRefs` is computed only from `rows()`; `toggleAll` only touches visible refs, preserving hidden ones (`provider-table.component.ts:608-615`) | none |
| Held filter value with zero matching rows | YES | `withHeldValue()` keeps the value listed at count 0 (`provider-filters.component.ts:531-543`) | none |
| Origin the filter holds but no row carries | YES | `originChoices` appends it at count 0 (`provider-filters.component.ts:411-423`) | none |
| `StatCardComponent` value `0`, `NaN`, `''`, `null` | YES | `hasValue`/`displayValue` distinguish `0` (real) from `NaN`/blank/`null` (→ "—") | none |
| Coverage row with zero target columns | YES | placeholder "CLI targets" column, merged cell spans 1 via `Math.max(1, columns.length)` | none |
| `unknown` status with blank `statusText` | YES | `statusPresentation` falls back to "Unknown" (`status-pill.component.ts:79-84`) | none |
| Search word matching a status pill's visible label | NO | `providerStatusLabel` (search) and `statusPresentation` (display) disagree for `pending`/`needs-input` | out of scope — see FM-1; must be fixed before Batch 13 ships real search |
| Bulk-action result icon tone (success/error) | UNVERIFIED | `[class]` bound directly on `<lucide-angular>`, which owns its own `class` `@Input()` | out of scope — see FM-2; needs a DOM-level check, not fixed here |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: none inside Batch 10 itself; the top risk to the overall feature is FM-1
  (search-vs-display vocabulary mismatch in `data/provider-filtering.ts`), which must
  be fixed before or during Batch 13, not because Batch 10 is unsound but because
  Batch 10 correctly avoided the broken vocabulary and the fix has nowhere else to
  land.
- What a robust implementation would add: a shared spec (in whichever batch fixes
  `provider-filtering.ts`) asserting `providerStatusLabel(status) ===
  statusPresentation(status).label` for every `ProviderStatus`, so the two
  vocabularies can never diverge again silently; and one spec in
  `bulk-action-bar.component.spec.ts` asserting the rendered result icon actually
  carries `text-success`/`text-error` in the DOM, to convert FM-2 from "read the
  library source" evidence into a real regression guard.

## Answers to the two direct questions

- **(b) `data/provider-filtering.ts` label mismatch — must it be fixed in this
  batch?** No. It is a real Serious defect (FM-1), but the file is not in Batch 10's
  file list, was committed in Batch 8, and Batch 10's own components correctly avoid
  it by using `statusPresentation()` exclusively. Fixing it here would cross the
  batch's file boundary and risk a conflict with Batch 11, which is being committed
  into the same Nx project concurrently. It must be fixed before Batch 13 (the first
  batch to wire real, user-facing search) ships — as its own tiny follow-up or as
  the first task of Batch 13 — because until then the defect is real but inert (no
  page in the tree calls `filterProviderRows` with user input yet).
- **(a) `bulk-action-bar.component.ts:149-152` `[class]` on `lucide-angular` — does
  it need a fix now?** No, not as part of Batch 10 (different batch's file, not in
  this worktree's scope). It is a plausible, source-verified defect (Angular
  redirects a `[class]` binding to a directive's own `@Input() class` rather than
  the DOM host, and `lucide-angular` declares exactly that input), consistent with
  why Batch 10 itself always routes icon tone through a wrapper `<span>`. Recommend
  a small, separate follow-up against Batch 9's file (two-line template fix, one new
  spec asserting the rendered tone class) rather than reopening Batch 9 or folding
  it into Batch 10.
