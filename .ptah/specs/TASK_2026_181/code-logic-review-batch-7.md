# Code Logic Review — TASK_2026_181, Batch 7 (Phase 4b — filter bar, sorting, filtered-empty state)

## Review Summary

| Metric                     | Value                          |
| -------------------------- | ------------------------------ |
| Overall Score              | 8/10                           |
| Assessment                 | **APPROVED**                   |
| Critical Issues            | 0                              |
| Serious Issues             | 0                              |
| Moderate Issues            | 0                              |
| Minor / Non-blocking       | 2                              |
| Failure Modes Investigated | 5 (all discharged — see below) |

**Scope reviewed**: uncommitted working-tree diff against `34cf9e75b` — 12 files, 1022
insertions / 31 deletions (`libs/shared/task-filter.ts` + spec, `tasks-store.service.ts` +
spec, `tasks-view.component.ts` + spec, `task-board/task-column/task-card.component.ts` +
one card spec, `tasks-ui/index.ts`, `tasks-rpc.handlers.spec.ts`), plus the untracked
`libs/frontend/tasks-ui/src/lib/components/filter/` (bar component + spec). Independently
re-established via `git diff --stat 34cf9e75b` and matched the developer's own inventory
exactly, file for file, line for line.

**A process note, not a finding**: partway through this review a concurrent process (almost
certainly gate verification doing the documented `git stash` cycle from the Batch 6 report)
stashed the tracked half of this diff mid-session. I did not touch git state to fix it — I
read the remaining files straight out of the stash object (`git diff stash@{0}^1 stash@{0} --
<path>`, read-only) and waited for the working tree to return to the pushed state before
running the gate. No source was modified by this review.

## The 5 Paranoid Questions

### 1. How does this fail silently?

The one place a silent divergence could hide is the childrenOf/rollup equivalence: if
`matchesChildrenOf` and `TaskGraph.children`/`rollup` ever read parentage through two
different code paths, the badge could say "1 / 3" while the click leaves 2 or 4 cards, and
nothing would error — it would just be a number a user stops trusting. Traced to source
(`task-graph.ts:329-358`): `children` and `rollup` are built by iterating `effectiveParent`
from `analyzeParentage`, and `matchesChildrenOf` (`task-filter.ts:380-387`) reads the exact
same `graph.effectiveParent` map. There is one source of truth, not two agreeing by
construction. `task-filter.spec.ts`'s `'returns exactly as many tasks as the parent rollup
counts'` pins this with a direct assertion, and a second test (`'ignores a parent claim the
graph refused'`) exercises the divergence case named in my brief — a `dangling_parent`
carrier, where the declared `parent` field and the honoured `effectiveParent` disagree — and
confirms `childrenOf` follows the honoured value, not the declared one, and agrees with
`parentage: ['standalone']` for the same task. `parent_cycle` and `parent_depth_exceeded` are
not separately exercised for `childrenOf`, but they cannot diverge from the tested case: all
three exclusion reasons converge on the same code path (skip the `effectiveParent.set` call),
so testing one is testing the mechanism, not the label.

### 2. What user action causes unexpected behavior?

Clicking a second rollup after a first one narrows to the second parent only, discarding the
first — `showChildrenOf` writes `childrenOf: [parentId]` as a single-element array, replacing
any prior `childrenOf` selection while leaving every other facet untouched. This is a
deliberate, documented, tested choice (`'showChildrenOf keeps the rest of the filter rather
than resetting it'`), and it is the only sane semantics for a single-click affordance — an
accumulating multi-parent selection from repeated clicks would need its own UI to undo, which
this batch does not build. Not a defect.

Clicking the rollup button does not also open the card, which is the failure mode a naïve
`stopPropagation`-less implementation would have — verified by both a component-level test
(`'emits the PARENT id from the rollup, and does not open the card'`) and a view-level test
that clicks the real rendered button and asserts on `TasksStore` state.

### 3. What data makes this produce wrong results?

Hostile label text (`<img src=x onerror="boom">`) as a chip value: rendered as text, verified
by a spec that asserts no `<img>` element exists in the chip DOM and that the raw hostile
string appears as `textContent`. Regex metacharacters as a text-filter needle
(`'(a+)+$'`): asserted to arrive at the store verbatim as data, never compiled — matches
`String.includes` in the predicate, no `RegExp` anywhere in the diff (`git diff … | grep
RegExp` — zero hits). Duplicate label values in a filter spec (two labels folding to the same
`labelKey`, or literally the same string twice): chip `track` keys are qualified by facet +
position (`chips.length` at push time), not by value, so duplicates render without a
`NG0955`-class collision — this is exactly the binding-rule concern about "filter chips derive
from user-authored labels" and it is both implemented correctly and has a dedicated test
(`'renders duplicate values without a track collision'`).

### 4. What happens when dependencies fail?

Nothing in this batch issues an RPC on a filter/sort change, so there is no network failure
mode to handle here — that absence is the contract, and it is asserted at both layers: the
store spec drains the microtask queue twice after touching every facet, every sort field, a
`showChildrenOf`, and a `clearFilter`, then reads every derived signal the board/bar/columns
read, and asserts `rpcCall` was never called; the view spec separately asserts
`rpcCall.mockClear()` → `setFilter` → `fixture.whenStable()` → not called. Both are real
assertions against a spy, not an absence of a positive assertion.

### 5. What's missing that the requirements didn't mention?

Per-column empty-state copy ("`N hidden by the filter`", `data-testid="task-column-empty"`)
and the `Math.max(0, …)` clamp in `TaskColumnComponent.hidden()` have no dedicated
`task-column.component.spec.ts` (none exists for this component, before or after this batch)
and no test asserts that exact string. The "done" column in the view-spec fixture does exercise
this branch at render time (0 of 1 after a label filter), but the test only checks the header
count array, not the column body text. Not a logic defect — the interpolation is trivial and
the underlying `hidden`/`total` values are covered indirectly — but it is real, if minor,
under-coverage for a piece of UI copy this task's own plan called out (§6, `TaskColumnComponent`
"filtered count in the header"). See Minor Issue 1.

## Failure Mode Analysis

### Failure Mode 1: Badge/card-count drift on a refused parent claim

- **Trigger**: a carrier declares `parent: X` where X is dangling, cyclic, or two levels deep.
- **Symptoms**: none observed — this is exactly the case this review was asked to stress.
- **Impact**: would have been silent UI dishonesty (a rollup badge count not matching the
  cards a click reveals) had it existed.
- **Current handling**: `matchesChildrenOf` and `children`/`rollup` share one map
  (`effectiveParent`); structurally cannot diverge. Tested for the dangling case.
- **Recommendation**: none — discharged.

### Failure Mode 2: A second, drifting predicate

- **Trigger**: any new `.filter()` over tasks that duplicates a comparison `filterTasks`
  already owns.
- **Symptoms**: board and `tasks:list`/CLI/MCP would eventually disagree on what matches.
- **Impact**: would be a direct FR-C1.5 violation.
- **Current handling**: independently re-searched — exactly two production callers of
  `filterTasks` (`task-index.store.ts:145`, `tasks-store.service.ts:434`), and the sole
  `.filter(` over tasks in the batch's diff (`tasks-store.service.ts:459`) is Set-membership
  partitioning against `filteredIds()`, not a second predicate — it never reads a task field
  that `TaskFilterSpec` describes.
- **Recommendation**: none — discharged.

### Failure Mode 3: NFR-10 coupling — a filter keystroke rebuilding the whole graph

- **Trigger**: any read of a filter/sort signal inside the `graph` computed, or a cycle back
  through `board`/`filtered`.
- **Symptoms**: a 1 000-task board would rebuild parentage/inverse-relation maps on every
  keystroke, well past a 16 ms frame budget.
- **Impact**: would be a real perf regression under NFR-10's own stated gate.
- **Current handling**: traced the dependency graph directly — `graph = computed(() =>
buildTaskGraph(this.allTasks()))` reads only `allTasks()`, which reads only `_columns()`.
  `_filter`/`_sort` are read by `filtered`/`board`, never by `graph` or `allTasks`. Angular's
  `computed()` only recomputes on a change to a signal it actually read, so a filter-only
  change cannot mark `graph` dirty. The perf test's own identity assertion
  (`expect(store.graph()).toBe(warmGraph)`) is a runtime witness of the same structural fact,
  not a substitute for it.
- **Recommendation**: none — discharged. (The warm-before-clock-starts framing is honest: a
  real board already has a rendered graph before the first keystroke, so timing only the
  filter/sort/board recompute matches the actual UX cost, not a first-build cost a user does
  pay once at load, separately.)

### Failure Mode 4: The `23 of 181` asymmetry silently "fixed" into agreement

- **Trigger**: a future edit making the header counters read `filtered`/`matchedCount` instead
  of `_columns` directly, which would make "23 of 181" unsayable.
- **Symptoms**: none — checked directly.
- **Impact**: would have collapsed the stated FR-C1.2 contract.
- **Current handling**: `totalCount`, `statusCounts`, `doneCount`, `activeCount` still read
  `_columns()` (unchanged); `board[status].total` and `matchedCount`/`totalIndexed` are the new
  filtered/indexed pair. One test (`'narrows the columns while the header counters stay
INDEXED'`) asserts both halves in the same assertion block, which is what the task
  specifically asked me to verify was pinned rather than merely true today.
- **Recommendation**: none — discharged.

### Failure Mode 5: A rejected `childrenOf` value reaching the predicate

- **Trigger**: a hostile string (`'C:'`, `'..'`, an ADS colon, a path separator) placed into
  `filter.childrenOf` over the wire (saved view, agent, hand-crafted RPC call).
- **Symptoms**: would be a guard gap on a value nothing joins onto a path _today_, but per
  `task-view.types.ts`'s own doc comment, that is exactly the property a shared guard exists
  to hold for callers added later.
- **Impact**: low today (structurally unreachable — nothing in this batch joins the value onto
  a filesystem path), but this is precisely the class of guard GATING NOTE G3 exists to keep
  from drifting.
- **Current handling**: `childrenOf: z.array(TaskIdRefSchema)...` — the shared schema, not a
  re-derived one. Seven representative rejection cases are tested locally in
  `task-filter.spec.ts` (traversal, padded traversal, whitespace, both separators, drive
  prefix, ADS colon) plus one acceptance case. This is a subset of the canonical 12-row table
  (missing an embedded-NUL case and the bare `.` case) but it is testing the SAME schema
  function the 12-row tables already exhaust elsewhere — not a second, incompletely-guarded
  implementation. See Minor Issue 2.
- **Recommendation**: none blocking.

## The `childrenOf` facet decision — adjudicated

**Extending the committed shared spec was the right call.** The two alternatives named in the
brief are both worse: a bespoke `.filter()` beside the rollup handler is exactly the second
predicate FR-C1.5 exists to prevent (and BR-14/G3's own logic — one guard, one place — applies
here by the same reasoning), and it would leave `tasks:list`/the CLI unable to express "just
this parent's children" at all, which is a real capability gap FR-B3.3 asks this batch to
close, not defer. A dedicated new method is not needed either; the facet composes with every
existing facet through the one predicate, for free, with no new RPC surface.

The reach-back into `task-filter.ts` (a Batch 6 committed file) is additive, not just in the
sense of "no deletions" but in the load-bearing sense: `EMPTY_TASK_FILTER` gained one field
that every existing construction site already spreads over, `isTaskFilterActive` gained one
`||` clause, and the new facet is checked last in `filterTasks`'s AND chain — none of these
touch behavior for a spec that doesn't set `childrenOf`. Confirmed by running the actual gate
rather than trusting the diff shape: `nx run-many -t typecheck,test,lint -p shared tasks-ui
rpc-handlers --skip-nx-cache` exits 0, with `shared` at **614/614** (597 + 17, matching the
new test count in `task-filter.spec.ts` exactly), `tasks-ui` at **192/192** (168 + 24, matching
the sum of new tests across `task-card`, `tasks-view`, `tasks-store.service.spec.ts`, and the
new `task-filter-bar.component.spec.ts`), and `rpc-handlers` at **1580 total** (1549 passed +
31 skipped — matching the stated `1578 → 1580` delta from the one added parity case exactly).
No suite shrank, which is the specific failure mode the batch's own report flags awareness of
(the Batch 6 `EPERM`/collection-failure precedent).

The badge-count/card-count equivalence claim is not just asserted, it is **structurally true**:
`TaskGraph.children`/`rollup` and `matchesChildrenOf` both read `effectiveParent` and nothing
else, so there is no code path on which they could disagree — confirmed by reading
`task-graph.ts:329-358` directly, not by trusting the doc comment. The specific divergence case
this review was asked to stress (a refused parent claim) is exercised by name in
`task-filter.spec.ts` (`'ignores a parent claim the graph refused'`), which checks both that
`childrenOf` matches nothing for the dangling parent AND that the same task shows up under
`parentage: ['standalone']` — i.e., it directly cross-checks against Batch 2's precedence table
rather than merely asserting a return value.

## Other Adjudications (from the brief)

1. **Task 7.3 focus/selection forwarding deliberately deferred** — sound. No speculative
   `focusedTaskId`/selection input was added to `TaskColumnComponent` or `TaskCardComponent` in
   this diff; the only new input/output pair (`total`, `filterChildren`) has a real consumer
   (the store) wired end to end. This does not leave Batches 10/12 with a harder job — adding
   an input alongside the component that reads it is strictly less risky than adding it now and
   hoping the shape guessed correctly matches what roving-tabindex/bulk-selection actually need.
2. **`showChildrenOf` merges, replacing only the `childrenOf` facet** — sound, and tested from
   both directions (a prior facet survives the click; the click itself is undoable via a
   removable chip).
3. **`estimateBuckets` counts over the indexed set** — correct, and matches how the equivalent
   status/type facets already behave (menus are not self-collapsing). Tested directly
   (`'counts estimate buckets over the INDEXED set, not the filtered one'`).
4. **`total` added to `TaskBoardColumn`** — legitimate; it is what makes the per-column
   `N of M` / `N hidden by the filter` sayable at all, and it defaults to `tasks().length` in
   `TaskColumnComponent` so a caller that doesn't pass it (any future standalone use) is
   unchanged.
5. **The `23 of 181` asymmetry** — confirmed pinned by one test asserting both halves in the
   same block (see Failure Mode 4). Nothing in this diff "fixes" the header counters to read
   the filtered set.

## Binding Rules — checked, not assumed

- **BR-10**: `grep RegExp` across the full diff returns zero hits; the free-text needle is
  compared with `String.includes` inside the shared predicate (unchanged by this batch); a
  test types regex metacharacters into the filter box and asserts they arrive as literal data.
- **`track` on every `@for`, duplicate-safe**: every new `@for` in `task-board.component.ts`
  and `task-filter-bar.component.ts` carries a `track`; the chip/facet-option keys are
  position-qualified specifically because label text can repeat, and a dedicated test proves
  it (`'renders duplicate values without a track collision'`).
- **BR-14 / P1**: `childrenOf` is typed with the imported `TaskIdRefSchema` from
  `task-view.types.ts`, not a re-derived containment check.
- **Batch 5 private-member exception not generalized**: searched both new/changed spec files
  for `as any`/`(store as unknown as …)`/bracket access into a `_private` field — none found;
  all new assertions go through the public store API (`setFilter`, `showChildrenOf`,
  `clearFilter`, the readonly computed signals).
- **OnPush / signals / `inject()` / no backend imports / R11**: confirmed by direct grep —
  `ChangeDetectionStrategy.OnPush` on every component touched or added; no
  `@ptah-extension/editor` import anywhere under `tasks-ui/src`.
- **Batch 3's zero-metadata pixel proof**: untouched by this diff (`task-card.component.spec.ts`'s
  "a card with none of the five metadata fields" describe block is unmodified), and the rollup's
  `data-testid` is still in the `METADATA_TESTIDS` list that proof iterates, so the new
  `<button>` markup is still covered by "renders nothing when there is nothing to render."
- **Read-only render, zero writes**: nothing in this batch's diff calls an RPC method that
  writes; `setFilter`/`setSort`/`showChildrenOf`/`clearFilter` are pure signal writes, verified
  by the 0-RPC spy tests at both store and view level.

## Minor / Non-blocking Findings

### Minor 1 — Per-column "hidden by the filter" copy is rendered but not directly asserted

- **File**: `libs/frontend/tasks-ui/src/lib/components/board/task-column.component.ts:74-80`
- **Scenario**: the `@empty` branch's `{{ hidden() }} hidden by the filter` text, and the
  `Math.max(0, …)` clamp in the `hidden` computed, have no dedicated
  `task-column.component.spec.ts` (none exists for this component) and no test in
  `tasks-view.component.spec.ts` asserts the exact rendered string, only the header count
  array.
- **Fix**: a small `task-column.component.spec.ts` (or one more assertion in the existing view
  spec against `[data-testid="task-column-empty"]`'s `textContent`) would close this. Not
  blocking — the interpolation is one line and the underlying signals it reads are otherwise
  covered.

### Minor 2 — `childrenOf`'s local rejection table is a subset of the canonical one

- **File**: `libs/shared/src/lib/types/task-filter.spec.ts` (the `it.each` rejecting seven
  shapes)
- **Scenario**: an embedded-NUL value and a bare `'.'.` are in the canonical 12-row tables
  elsewhere (`contract.guard.spec.ts`, `tasks-rpc.handlers.spec.ts`,
  `tasks-namespace.builder.spec.ts`) but not repeated here.
- **Fix**: none required — this is testing the same shared `isSingleTaskPathSegment`
  function those tables already exhaust, not a fourth implementation of the guard. Flagging
  only because the task brief explicitly named the row count.

## Test Quality

Genuinely constrains rather than decorates. Representative examples: the hostile-label test
asserts the ABSENCE of an `<img>` element, not just that text appears; the duplicate-track test
counts rendered `<li>`s rather than trusting `track` silently not to throw; the 0-RPC tests
touch every facet and every derived signal before asserting, not just one; the perf test
warms the graph and then asserts referential identity afterward rather than only asserting a
wall-clock number. Totals reconciled by an independent, uncached gate run in this review
(`--skip-nx-cache`): `shared` 614/614, `tasks-ui` 192/192, `rpc-handlers` 1580 total
(1549 passed / 31 skipped) — all three deltas match the developer's own reported numbers
exactly, and lint/typecheck are clean across all three projects.

## Verdict

**Recommendation**: APPROVE
**Confidence**: HIGH — every structural claim in the brief (single source of truth for
parentage, no second predicate, no graph/filter coupling, the asymmetry pinned, exactly two
production callers of `filterTasks`) was independently re-derived from source, not taken from
the developer's own commentary, and an uncached gate run reproduced the claimed test deltas
exactly.
**Top risk**: none blocking. The two minor items above are coverage gaps on cosmetic surface
area, not logic gaps — safe to land as-is and pick up in a follow-up if desired.

## Phase 4 Gate (§7) — asserted at the end of this pair

- Parity test (Batch 6) still green — confirmed via this run (`rpc-handlers` totals check out
  and the childrenOf parity case is present in `PARITY_CASES`).
- A filter/sort change issues **0** RPC calls — asserted at both store and view level, spy
  cleared and drained.
- 1 000-task recompute **< 16 ms**, graph not rebuilt — asserted with a structural identity
  check, not timing alone.
- Sorting stable, tie-broken by id — unchanged from Batch 6, re-exercised in the store spec.
- `npx nx run-many -t typecheck,test,lint -p shared tasks-ui rpc-handlers` — **EXIT 0**,
  independently re-run in this review, uncached.

**Phase 4 gate: DISCHARGED.**
