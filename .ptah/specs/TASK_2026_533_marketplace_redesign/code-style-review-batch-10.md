# Code Style Review — `TASK_2026_533` Batch 10

## Summary

| Metric          | Value                                       |
| ---------------- | ------------------------------------------- |
| Overall score   | 7/10                                        |
| Assessment      | NEEDS_REVISION                              |
| Blocking issues | 0                                           |
| Serious issues  | 2                                           |
| Minor issues    | 3                                           |
| Files reviewed  | 12 (6 components + 6 specs), read in full   |

Scope: all 12 new files in worktree `task533-b10`
(`provider-table`, `provider-card-list`, `provider-filters`, `stat-card`,
`needs-attention`, `coverage-matrix`). Compared against the Batch 9 siblings
in the same folder (`status-pill`, `target-marks`, `removal-lock-badge`,
`bulk-action-bar`, all read in `code-style-review-batch-9.md`'s scope and
spot-checked again here), `libs/frontend/ui/src/lib/native/dropdown/native-dropdown.component.ts:118-174`,
and the two nearest NativeDropdown+NativeOption consumers elsewhere in the
repo: `libs/frontend/chat/src/lib/components/molecules/chat-input/effort-selector.component.ts`
and `model-selector.component.ts`. Checked
`libs/frontend/ui/src/lib/native/shared/keyboard-navigation.service.ts` (and
its barrel export at `libs/frontend/ui/src/index.ts:23`). Read
`batches.md` Batch 9/10 entries, `implementation-plan.md` §8 (C8), and
`handoff.md` §5-6 for the binding contracts. Ran `ptah_get_diagnostics`
scoped to the six component files: 6 errors, all pre-existing and outside
this batch (`mock-rpc-service.ts:53-68`, `connected-surface.component.spec.ts:99`,
`harness-health.store.spec.ts:672`) — matches the executor's report. Grepped
every reviewed file for `innerHTML` and hex colours: none found.

## Five style questions

### 1. What breaks when requirements change in six months?

`provider-filters.component.ts:56-245` defines a second, fully independent
component (`ProviderFilterSelectComponent`) inside the file that is supposed
to hold `ProviderFiltersComponent`. Its own listbox, keyboard handling and
`FilterSelectOption` contract live nowhere the filename promises. A future
change to either component (say, giving the dropdown a multi-select mode, or
reworking the filter bar's layout) has to first discover that the file holds
two units before it can reason about which one it is touching — and any grep
for "components in `ui/`" that expects file-count to equal component-count
(a safe assumption everywhere else in this batch and in Batch 9) will miss
`ProviderFilterSelectComponent` entirely.

### 2. What would a new team member misread?

Reading `provider-filters.component.ts` top to bottom, a newcomer hits 245
lines of `ProviderFilterSelectComponent` (selector, doc comment, its own
`@Component`, its own keyboard contract) before reaching the section comment
`// ── Filters bar` that marks where the file's namesake component actually
starts (`:247`). The section comment helps once you know to look for it, but
the file's own name and the plan's C8 component list (`implementation-plan.md:429-436`,
which names `ProviderFiltersComponent` and `StatCardComponent` for this task
and nothing else) give no signal that a second, unlisted component lives
here.

### 3. What does this cost to maintain?

Two costs, both real:

- `provider-filters.component.ts` is 543 lines for what the plan scoped as
  one component; splitting the 190-line `ProviderFilterSelectComponent` out
  would leave `ProviderFiltersComponent` itself under 360 lines and restore
  the one-file-one-component shape every other reviewed file (this batch and
  Batch 9) follows without exception.
- `provider-filters.component.ts:161-238` hand-rolls arrow-key/Home/End/
  Enter/Escape handling with a local `activeIndex` signal. The identical
  NativeDropdown+NativeOption composition already has a shared, tested
  implementation of exactly this — `KeyboardNavigationService`
  (`libs/frontend/ui/src/lib/native/shared/keyboard-navigation.service.ts`),
  exported from the `@ptah-extension/ui` barrel and used by both
  `effort-selector.component.ts:102,228,276` and
  `model-selector.component.ts` via `providers: [KeyboardNavigationService]`.
  A future fix to that service (say, RTL-aware arrow keys) will not reach
  `ProviderFilterSelectComponent`, and a bug in the hand-rolled version
  (there is none found in this review — the logic is correct and spec-tested)
  will not be caught by the service's own tests.

### 4. Where is this inconsistent with the rest of the repository?

Two points, both already surfaced above:

- Every other `@Component`-bearing file under `libs/frontend/marketplace/src/lib/`
  and `libs/frontend/ui/src/lib/` holds exactly one component (confirmed by
  grep across both trees: zero files with more than one `@Component` before
  this batch). `provider-filters.component.ts` is the first file in either
  library to hold two.
- `effort-selector.component.ts` and `model-selector.component.ts` are the
  two closest siblings that compose `NativeDropdownComponent` +
  `NativeOptionComponent` into a listbox with arrow-key navigation, and both
  reach for `KeyboardNavigationService` rather than writing their own
  key-index arithmetic. `ProviderFilterSelectComponent` does not.

This second point is tempered by a real constraint the first point is not:
`implementation-plan.md:429` scopes C8 as "presentational, OnPush, inputs and
outputs only, **no injection**". `KeyboardNavigationService` is an
`@Injectable()` that both siblings pull in via `inject()` plus a
component-scoped `providers` array — exactly the shape C8's contract rules
out. Batch 9 already carved one narrow exception to "no injection"
(`copy-command-button.component.ts`'s `inject(DestroyRef)` for timer
cleanup, accepted in `code-style-review-batch-9.md`'s "Five style questions
§4"), so a second, similarly-scoped exception here would not have been
unprecedented — but the executor's report does not name
`KeyboardNavigationService`, weigh the trade-off, or say why the hand-rolled
version was chosen over it. The report is otherwise careful to call out every
other deviation from an established pattern (its own "Deviations and
decisions" section has six entries); this one is not among them.

### 5. What would you have done differently?

Split `ProviderFilterSelectComponent` into its own file
(`provider-filter-select.component.ts`, matching the selector
`ptah-provider-filter-select`) before landing this batch, and either (a) name
the `KeyboardNavigationService` trade-off explicitly in the report as a
documented, accepted deviation the way item 6 (lucide colour wrapper) and
item 2 (harness link) are documented, or (b) use the service via a
component-scoped `providers` array the way `effort-selector.component.ts`
does, treating it as the same class of narrow exception Batch 9 already
established for `DestroyRef`.

## Blocking issues

None. Diagnostics are clean for all six files in scope; every data component
implements loading/error/empty states; no `innerHTML`, no hex colours; every
input/output uses signal `input()`/`output()` with explicit `public`/
`protected` accessibility, matching `libs/frontend/marketplace/eslint.config.mjs`'s
`explicit-member-accessibility` rule and the Batch 9 precedent.

## Serious issues

### A second component lives inside `provider-filters.component.ts`

- File: `libs/frontend/marketplace/src/lib/ui/provider-filters.component.ts:56-245`
- Problem: `ProviderFilterSelectComponent` — its own `@Component`, selector
  `ptah-provider-filter-select`, `FilterSelectOption` contract, and 6 inputs/
  outputs — is defined inside the file whose name and plan entry
  (`implementation-plan.md:429-436`) promise only `ProviderFiltersComponent`.
  No other file in `libs/frontend/marketplace/src/lib/` or
  `libs/frontend/ui/src/lib/` holds more than one `@Component` (verified by
  grep across both trees). `ProviderFilterSelectComponent` is also not named
  anywhere in the plan's C8 component inventory — it is a new, unplanned unit
  whose file location was never decided by the architect.
- Impact: the file is 543 lines for what was scoped as one component; a
  reader or a future grep for "one file, one component" (true everywhere
  else in this batch and Batch 9) is wrong here without warning.
- Fix: extract `ProviderFilterSelectComponent` (lines 31-245, plus the
  `FilterSelectOption` interface and `nextFilterSelectId` counter it uses) to
  `provider-filter-select.component.ts` + its own `.spec.ts` (currently it
  has none in isolation — see Minor issues), and import it into
  `provider-filters.component.ts` the way `RemovalLockBadgeComponent` imports
  `CopyCommandButtonComponent`.

### Keyboard navigation is reimplemented instead of reusing `KeyboardNavigationService`

- File: `libs/frontend/marketplace/src/lib/ui/provider-filters.component.ts:161-238`
- Problem: `ProviderFilterSelectComponent.onKeydown()` hand-rolls
  ArrowUp/ArrowDown/Home/End/Enter/Escape/Tab handling over a local
  `activeIndex = signal(0)`. The identical composition —
  `NativeDropdownComponent` + `NativeOptionComponent` with arrow-key
  navigation — already has a shared implementation,
  `KeyboardNavigationService` (`libs/frontend/ui/src/lib/native/shared/keyboard-navigation.service.ts`,
  exported at `libs/frontend/ui/src/index.ts:23`), used by
  `effort-selector.component.ts:102,228,276` and `model-selector.component.ts`
  for exactly this purpose.
- Tradeoff: C8's own contract (`implementation-plan.md:429`) says "no
  injection" for this kit, and `KeyboardNavigationService` is `@Injectable()`
  — so reaching for it here is not a free choice the way it is for the chat
  components. But Batch 9 already accepted one narrow injection exception
  (`copy-command-button.component.ts`'s `DestroyRef`) for a comparable
  reason, and the report does not raise or resolve this tension for
  `ProviderFilterSelectComponent`; it is simply absent, unlike the report's
  other five named deviations.
- Recommendation: either inject `KeyboardNavigationService` via a
  component-scoped `providers: [KeyboardNavigationService]` (mirroring
  `effort-selector.component.ts` and Batch 9's `DestroyRef` precedent), or
  keep the hand-rolled version but add one line to the batch report naming
  the trade-off, so the next reader does not have to rediscover that the
  duplication was a choice and not an oversight.

## Minor issues

- `provider-filters.component.ts`: `ProviderFilterSelectComponent` has no
  spec of its own — `provider-filters.component.spec.ts` only exercises it
  through `ProviderFiltersComponent`'s DOM (`provider-filter-target`,
  `provider-filter-status` test ids). Once split into its own file (see
  Serious issues), it should get its own `.spec.ts` the way every other
  component in this batch and Batch 9 does.
- `provider-filters.component.ts:440-458`: `statusChoices()` maps over
  `this.options().statuses` but only uses each entry's `value` and `count`,
  discarding the `label` the data layer computed
  (`providerFilterOptions()`/`providerStatusLabel`, `data/provider-filtering.ts:90`)
  in favour of `statusPresentation(status.value).label`. This is the correct
  behaviour per the Batch 9 binding rule ("status words come only from
  `statusPresentation()`", `batches.md:605`) and is not a bug, but it means
  `ProviderFilterOptions.statuses[].label` is dead weight for this consumer —
  worth a one-line note in a future pass on `data/provider-filtering.ts`
  (already flagged as a Batch 8 follow-up in the executor's report, not
  introduced here).
- `provider-table.component.ts` and `coverage-matrix.component.ts` differ on
  whether the table `<caption>` is visually hidden (`provider-table.component.ts:286`,
  `class="sr-only"`) or visible (`coverage-matrix.component.ts:170-176`). Both
  are individually correct — `ProviderTable` sits under a page heading and
  filter bar that already gives sighted users context, while `CoverageMatrix`
  has no other heading of its own — but it is worth a one-line doc comment on
  one of the two components noting the difference is deliberate, since a
  future component copying "the caption pattern" from whichever file it
  reads first will get only half the story.

## File-by-file

### provider-table.component.ts

9/10 — 0B, 0S, 0M. 616 lines, under the 700-line cap. Exported row helpers
(`isProviderRowSelectable`, `providerRowCheckboxLabel`,
`providerRemovalAction`, `providerRowFixCommand`, `providerRowLockReason`,
`providerRowKindLabel`, `withRefSelected`) are cleanly separated from the
table component by a section comment and correctly reused, not duplicated,
by `provider-card-list.component.ts:17-25`. `nextProviderSort` is pure and
exported per plan. Correct `aria-sort`/`scope="col"` structure; blocked/
`manage-link` rows render `ptah-removal-lock-badge`, never a paragraph
(`:469-475`), matching the Batch 9 binding rule.

### provider-card-list.component.ts

9/10 — 0B, 0S, 0M. Imports its shared helpers from
`provider-table.component.ts` rather than re-deriving them — correct reuse,
matching the plan's "compact equivalent" framing. `role="list"` on the `<ul>`
with the documented WebKit rationale (`:39`); hover-lift disabled under
`motion-reduce` (`:163`), matching `stat-card.component.ts`'s identical
treatment.

### provider-filters.component.ts

5/10 — 0B, 2S, 2M. See Serious and Minor issues above. The
`ProviderFiltersComponent` half (lines 247-543) is itself clean: radiogroup
roving-tabindex is correctly implemented (`:319-336`, `:498-523`), "filters
are not navigation" is honoured (no `<a>`/router import), and
`statusPresentation()` reuse is correct. The score reflects the embedded
second component, not this half.

### stat-card.component.ts

9/10 — 0B, 0S, 0M. `tabular-nums` on the value, `toLocaleString()` for
numbers, `—` fallback for missing/blank/NaN values, and the lucide
tone-wrapper workaround consistent with the pattern Batch 9's style review
already accepted (`status-pill`, `bulk-action-bar`'s out-of-scope note). One
`ng-content` gated to the `ready` branch only, matching the plan.

### needs-attention.component.ts

9/10 — 0B, 0S, 0M. `needsAttentionLink()` is a pure, exported function built
on `marketplaceRouteLink` (`shell/marketplace-route-url.ts`) rather than the
page reaching into the router or shell directly — correct import direction
(`ui/` → `shell/marketplace-route-url.ts`, not `ui/` → `shell/` component
code). The `harness` → Skills route deviation is discussed and reasoned in
the doc comment itself (`:24-34`), not just the report, which is the right
place for it.

### coverage-matrix.component.ts

9/10 — 0B, 0S, 0M. `coverageCellPresentation()` and `CELL_PRESENTATION` are
exported and total over `CoverageCell`, matching the `statusPresentation()`
shape from Batch 9. The merged-cell `colspan` correctly falls back to `1`
when there are no target columns (`spanColumns()`, `:341-343`), with a
placeholder "CLI targets" header keeping the table structurally valid.

## Pattern compliance

| Repository rule or nearby convention | Status | Evidence |
| --- | --- | --- |
| One `@Component` per file | FAIL | `provider-filters.component.ts:56` and `:281` (two `@Component` decorators); zero other files in `libs/frontend/marketplace` or `libs/frontend/ui` do this |
| Standalone + OnPush on every component | PASS | all six files |
| Signals-only inputs/outputs | PASS | grep found zero `@Input`/`@Output` decorators |
| C8 "no injection" | PASS (with a caveat) | no `inject()` call in any of the six files; the caveat is the hand-rolled keyboard nav that exists because injection is disallowed (Serious issue 2) |
| `explicit-member-accessibility: 'explicit'` | PASS | `public readonly`/`protected readonly` throughout |
| Status words only from `statusPresentation()` | PASS | `provider-table.component.ts:439-442`, `provider-filters.component.ts:446-457`; `providerStatusLabel` from `data/provider-filtering.ts` is computed but discarded in favour of the pill's words |
| CLI targets through `ptah-target-marks`; locks through `ptah-removal-lock-badge` | PASS | `provider-table.component.ts:429`,`470`; `provider-card-list.component.ts:209`,`246`; `coverage-matrix.component.ts:194` |
| No "Last used" column | PASS | absent from `provider-table.component.ts` headers (`:295-365`) and its spec |
| No hex colours, no `innerHTML` | PASS | grepped all six files, zero matches |
| Files ≤700 lines | PASS | largest is `provider-table.component.ts` at 616 |
| Reuse over duplication for row-selection helpers | PASS | `provider-card-list.component.ts` imports from `provider-table.component.ts` rather than redefining |
| Reuse over duplication for dropdown/listbox keyboard handling | FAIL | `provider-filters.component.ts:161-238` reimplements `KeyboardNavigationService`'s logic rather than using it, unlike `effort-selector.component.ts`/`model-selector.component.ts` |

## Maintenance debt

- Introduced: five clean, single-purpose presentational components (table,
  card list, stat card, needs-attention, coverage matrix) with strong test
  coverage (86 new tests) and correct reuse of Batch 9 primitives; one
  component (`ProviderFilterSelectComponent`) that works correctly but sits
  in the wrong file and duplicates ~40 lines of already-centralized keyboard
  logic.
- Retired: nothing (net-new files).
- Net: positive overall, with one localized structural debt
  (`provider-filters.component.ts`) that should be paid down before this
  batch is treated as a pattern for Batch 13/14/15/16's own filter or
  dropdown needs.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Key concern: `provider-filters.component.ts` bundles an unplanned second
  component into one file — the only such file in either library — and that
  component reimplements keyboard-navigation logic the repository already
  centralizes. Neither is a functional defect (tests pass, diagnostics are
  clean), but both set a precedent later marketplace batches building their
  own dropdowns could copy.
- What a 10/10 version would do differently: split
  `ProviderFilterSelectComponent` into `provider-filter-select.component.ts`
  with its own spec, and either reuse `KeyboardNavigationService` through a
  component-scoped provider (as `effort-selector.component.ts` does) or
  document the "no injection" trade-off explicitly in the batch report the
  way the other five deviations already are.

---

## Round 2 (revise round 1)

Re-review of the same worktree (`task533-b10`) after the executor's fixes,
recorded as "Revise round 1" in `batch-10-report.md`. Verified by reading the
new and changed files in full: `provider-filter-select.component.ts` (272
lines), `provider-filter-select.component.spec.ts` (274 lines, 16 tests),
the reduced `provider-filters.component.ts` (317 lines, was 543) and its
trimmed `.spec.ts`. Also re-read
`libs/frontend/ui/src/lib/native/shared/keyboard-navigation.service.ts` and,
this time, the *full* source of both cited siblings
(`effort-selector.component.ts`, `model-selector.component.ts`) rather than
grepping only for the keys the report claimed they handled. Re-ran
`ptah_get_diagnostics` scoped to the three touched files: same 6 pre-existing
errors as round 1, all outside this batch (`mock-rpc-service.ts:53-68`,
`connected-surface.component.spec.ts:99`, `harness-health.store.spec.ts:672`)
— zero new errors. Re-grepped every `@Component`-bearing file in
`libs/frontend/marketplace/src/lib/ui/` in the worktree: no file now holds
more than one component.

### Fix 1 — split into its own file: VERIFIED

`ProviderFilterSelectComponent` and `FilterSelectOption` now live entirely in
`provider-filter-select.component.ts` (272 lines); `provider-filters.component.ts`
holds only `ProviderFiltersComponent` and the private `withHeldValue()`
helper (317 lines, down from 543). `provider-filters.component.ts:17-20`
imports the new file the same way `removal-lock-badge.component.ts` imports
`CopyCommandButtonComponent` in Batch 9. The extracted component has its own
spec (`provider-filter-select.component.spec.ts`, 16 tests, including the
`does not use innerHTML` source check every other component in this kit
carries). The Serious "second component in one file" finding is fully
resolved; the file-count == component-count invariant holds again across
both libraries.

### Fix 2 — reuse `KeyboardNavigationService`: VERIFIED, and better than the cited precedent

`provider-filter-select.component.ts:73` adds `providers: [KeyboardNavigationService]`
and `:153` injects it, matching the shape `effort-selector.component.ts:102`
and `model-selector.component.ts:38,174` use. `activeIndex` now comes from
the service (`:178`), `handleKeyDown()` drives ArrowUp/ArrowDown/Home/End
(`:241`), and a constructor `effect()` + `untracked()` keeps the service's
`itemCount` and active option in step with the `options()` input as it
changes, re-applying the current value after each `configure()` call (which
otherwise resets the active index to `0`) and closing the list if it becomes
`inactive()` while open (`:200-213`). This is a correct, idiomatic use of the
signal-effect pattern — no infinite-loop risk (the `untracked()` wrapper
means writes to `keyboardNav`'s internal signal don't re-trigger the effect)
and it is exercised by `provider-filter-select.component.spec.ts`'s
"keeps the active option in range when the options shrink" (`:253-265`) and
"closes an open list when it becomes disabled" (`:234-242`) tests.

One correction to the round-1 review and to the component's own doc comment
(`provider-filter-select.component.ts:40-45`, "Keyboard follows the ui
selectors... This component adds only what the service does not cover") and
to `batch-10-report.md`'s "revise round 1" note ("That split matches the ui
selectors, which also handle Enter/Escape themselves"): on inspection, full
in this pass, **neither cited sibling actually wires keyboard events through
the service**. `effort-selector.component.ts` and `model-selector.component.ts`
inject `KeyboardNavigationService` and read `activeIndex()` for highlighting,
but neither has a `(keydown)` handler on its trigger, and neither calls
`handleKeyDown()` or `configure()` anywhere in the file — `setActiveIndex()`
is called only from `onHover()`. Their `NativeOptionComponent` children also
carry `tabindex="-1"` with no keydown wiring of their own
(`native-option.component.ts:64`), so arrow-key navigation does not
currently work in either sibling; only mouse hover moves `activeIndex`. This
is a pre-existing gap in `libs/frontend/chat`, out of scope for this batch
and not something to hold this review against — but it means
`ProviderFilterSelectComponent` is not merely matching its cited precedent,
it is the first of the three to make the service do what its own doc comment
promises (`keyboard-navigation.service.ts:1-27`: "Native keyboard navigation
for list-based components"). The round-1 "Serious" framing (a real cost
because a future fix to the service wouldn't reach the hand-rolled version)
is now moot in the opposite direction: this component's keyboard handling is
real and centralized, and the two "siblings" turn out to be the ones with
the gap.

### New in this round

- `disabled` input (`provider-filter-select.component.ts:165`, not in round
  1): a plain boolean input, default `false`, folded into `inactive()`
  alongside "no options" (`:181-183`). Consistent with the input-naming and
  default-documentation style used throughout this kit (`@default false` /
  `@default 'ready'` comments on every other component's inputs). Not wired
  up by `ProviderFiltersComponent` yet (neither target nor status select
  passes `disabled`, matching the report's note that the filters bar always
  has an "Any" option) — a page-level consumer is free to use it later
  without a further change here.
- The doc-comment/report overstatement above is a Minor finding, not a
  Serious one: it does not change any behaviour, and the fix is a one-line
  correction to a comment, not a code change.

### Updated pattern compliance

| Repository rule or nearby convention | Round 1 | Round 2 | Evidence |
| --- | --- | --- | --- |
| One `@Component` per file | FAIL | PASS | `provider-filter-select.component.ts` (1), `provider-filters.component.ts` (1); grep across `libs/frontend/marketplace/src/lib/ui/` in the worktree finds none with 2 |
| Reuse over duplication for dropdown/listbox keyboard handling | FAIL | PASS | `provider-filter-select.component.ts:73,153,178,208,241` uses `KeyboardNavigationService.handleKeyDown/configure/setActiveIndex` instead of hand-rolled index arithmetic |

All other rows from the round-1 table are unaffected by this round's changes
and remain PASS.

### Round 2 summary

| Metric          | Value                                       |
| ---------------- | ------------------------------------------- |
| Overall score   | 9/10                                        |
| Assessment      | APPROVED                                    |
| Blocking issues | 0                                           |
| Serious issues  | 0                                           |
| Minor issues    | 2 (carried/updated, both documentation-only) |
| Files reviewed  | 14 (12 from round 1, re-verified, + 2 new)  |

Minor issues carried into round 2 (both documentation-only, no code change
required to ship):

1. The doc comment on `ProviderFilterSelectComponent`
   (`provider-filter-select.component.ts:40-41`) and `batch-10-report.md`'s
   "revise round 1" note both claim parity with `effort-selector.component.ts`/
   `model-selector.component.ts` on keyboard handling. Neither sibling
   actually implements it (see above) — the comment should say this
   component completes the pattern the siblings only partly established,
   not that it "follows" them.
2. From round 1, still open and still genuinely minor: the visible-vs-hidden
   `<caption>` difference between `provider-table.component.ts` and
   `coverage-matrix.component.ts` has no doc-comment note explaining it is
   deliberate.

### Round 2 verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Key concern: none blocking or serious remains; the one item worth a follow-up
  is correcting the doc comment's overstated comparison to
  `effort-selector.component.ts`/`model-selector.component.ts`, which in fact
  do not wire keyboard events through `KeyboardNavigationService` at all.
- What a 10/10 version would do differently: word the doc comment as "this
  component wires the service's `handleKeyDown`/`configure`, which
  `effort-selector`/`model-selector` inject but do not yet call" instead of
  "follows the ui selectors," so a future reader does not go looking for
  matching keydown logic in those two files and come up empty.
