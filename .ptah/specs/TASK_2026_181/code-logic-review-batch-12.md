# Code Logic Review — TASK_2026_181, Batch 12 (Phase 7b: Bulk status, frontend)

## RE-REVIEW (round 2) — all seven items

### Mutation window, round 2

**OPENED** before the first `Edit` in this section, with a clean baseline run
(`npx nx test tasks-ui` → 17 suites / 470 tests, on the untouched tree) and a
SHA256 hash taken on each file before it was mutated. Every mutation below was
applied with `Edit`, exercised with a scoped `npx nx test tasks-ui
--testFile=... -t ...`, reverted with a matching `Edit`, and re-hashed before
the next mutation started. All restorations matched byte-for-byte.
**CLOSED** after: two independent **uncached** (`--skip-nx-cache`) runs of
`npx nx test tasks-ui`, both 17/470; a clean `typecheck` and `lint`; uncached
confirmation runs for `shared` (628), `task-specs` (380) and `rpc-handlers`
(1634); and a final hash check on all three files I mutated, matching the
round-2 baseline exactly. `git status`/`git diff --stat` on the whole
`tasks-ui` tree matches the developer's fixed state with no residue from my
mutations. `visual-reviewer` was asked to hold static analysis only for this
round too; I observed no test runs from it during the window.

### 1. Serious finding — bulk-bar output wiring — FIXED, and the fix's own shape verified

`wires every bulk-bar output to its own store method`
(`tasks-view.component.spec.ts:1173`) now exists. Reproduced **Mutation 18**
exactly as given: swapped `(cancelRun)="store.cancelBulk()"` for
`(cancelRun)="store.clearSelection()"` at `tasks-view.component.ts:289` and
ran the test — **`Expected number of calls: 1, Received number of calls: 0`**,
verbatim match. Reverted; hash matched.

Went further to check whether the "no other method fired" half is load-bearing
or decorative, since a plain swap is already caught by the "expected method
fired" half alone (the wrong spy never reaches 1, so that half alone would
already fail on Mutation 18). Constructed the case that half is actually
_for_: an **extra** call alongside the correct one —
`(cancelRun)="store.cancelBulk(); store.selectAllMatching()"`. Result: the
"expected method ran once" assertion **passed** (`cancelBulk` did fire once),
and the test failed specifically on
`expect(spy).not.toHaveBeenCalled()` for `selectAllMatching` —
**`Expected number of calls: 0, Received number of calls: 1`**. This proves
the second half catches a distinct defect class (an accidental extra/leftover
call) that the first half cannot, so it is genuinely load-bearing, not
decorative. Reverted both mutations; hashes matched.

The seventh assertion (`bar.statusPicked.emit('in_review')` →
`expect(spies.requestBulkStatus).toHaveBeenCalledWith('in_review')`,
`:1233-1235`) closes the one gap counting-only assertions leave open (a
binding that drops or hardcodes the emitted value); did not additionally
mutate this since its shape is a standard `toHaveBeenCalledWith` and needs no
further proof.

**Verdict: closed.**

### 2. Moderate finding — third suppression front — FIXED, guard and control both verified

The developer's own words ("I asserted a limitation instead of trying it")
match what I found in round 1. `ignores a focus event that arrives mid-run`
(`tasks-store.service.spec.ts:2169`) and its control,
`still reconciles on focus outside a run` (`:2203`), now exist.

**Mutation 19** — removed `if (this._bulk() !== null) return;` from
`setupVisibilityReconcile`'s `reconcile()` (`tasks-store.service.ts:1887`).
`ignores a focus event that arrives mid-run` failed with
**`Expected: 0, Received: 1`** — verbatim match. Reverted; hash matched.

Then checked whether the control test itself is necessary — i.e. whether
`ignores a focus event that arrives mid-run` could pass **vacuously** if
`reconcile()` were simply broken outright, rather than under-guarded.
Replaced the whole body of `reconcile()` with an unconditional `return;`
(`:1877`). Result: `ignores a focus event that arrives mid-run` **passed**
(0 board calls during the run — for the wrong reason, since reconcile never
fires under any condition), while `still reconciles on focus outside a run`
correctly **failed** (`Expected length: 1, Received length: 0`). This
confirms the control is load-bearing exactly as designed: without it, a
totally dead `reconcile()` would read as "suppression is working." Reverted;
hash matched.

**Verdict: closed.** The guard at `tasks-store.service.ts:1887` is correct,
and both the reproduction and its control discriminate genuinely.

### 3. The visual half reaching store logic — `untouched`, invariant, and per-card outcomes

Read `BulkUntouched`/`TaskBulkOutcome`/`BulkSummary.untouched`
(`tasks-store.service.ts:248-305`), `settleBulk`
(`:1487-1537`) and `lastRunOutcomes` (`:588-601`). Confirmed structurally
there is exactly **one producer** of `untouched`
(`settleBulk:1508`, built fresh from the full original `ids` list on every
run) and no second, independently-maintained counter anywhere in the diff
(`grep` for `.untouched` outside spec files hits only the one producer and
two read-only consumers: the summary template and `lastRunOutcomes`) — so
"untouched" cannot drift from a remainder computed elsewhere because nothing
else computes it.

Verified this empirically at the exact scale the coordinator asked about.
Wrote and ran a probe (`120` tasks, cancel triggered after the **second**
chunk lands, so `attempted = 40`) — not present in the shipped diff, added
and removed for this check only:

```
expect(summary?.requested).toBe(120);
expect(summary?.attempted).toBe(40);
expect(summary?.succeeded).toBe(40);
expect(summary?.failures).toEqual([]);
expect(summary?.untouched).toHaveLength(80);
expect(succeeded + failures.length + untouched.length).toBe(120);
```

**Passed as written** against the real implementation. Reverted (removed the
probe entirely); hash matched.

**Mutation 20** — collapsed the group by deleting
`untouched.push({ taskId, title: ... })` at `:1508` while leaving
`nextSelection.add(taskId)` in place (so the card would still look selected,
but the run's own bookkeeping would go silent about why). Ran the existing
40-task cancel test, the new per-card-outcome test, and my 120-task probe
together:

- `stops between chunks, leaving un-attempted tasks selected and uncounted`
  (`:1958`) — `Expected length: 20, Received length: 0`.
- `reports failed and untouched as distinct per-card outcomes` (`:2005`) —
  `Expected: "untouched", Received: undefined`.
- my 120-task probe — `Expected length: 80, Received length: 0`.

All three failed, confirming the claim ("two store tests plus the card
distinction test") and extending it to the exact 120/40/80 scale asked about.
Reverted; hash matched.

**Verdict: sound.** `untouched` is a single-producer, structurally
drift-proof list, and the invariant holds at both the 40-task and 120-task
cancel scale.

### 4. Accuracy items — both independently confirmed corrected

- `tasks-store.service.ts:1673` (test docblock) now reads "differ by one task"
  and frames the payload-order answer as a subset rather than a different
  span. Matches what I computed by hand in round 1.
- `handleMessage` is at `:806` in the current tree (re-confirmed this round:
  `grep -n "public handleMessage" tasks-store.service.ts` → `806:`). No
  hardcoded line number needed changing anywhere in source per the developer's
  note — checked for stray `:NNN`-style line references added elsewhere in
  this batch's docblocks and found none, consistent with "only `{@link}`
  symbols."

### 5. Process note — the backtick-in-template sweep

Searched for the described sweep ("across every `*.component.ts` template in
the lib") as a persisted asset: `grep -rn "backtick"` across the whole repo
(excluding `.nx`/`dist`/`node_modules`), `grep` for `readFileSync`/
`readdirSync`/`globSync` inside `libs/frontend/tasks-ui/src/lib` (the only
hit is the pre-existing, unrelated `no-editor-dependency.spec.ts`, which
checks import boundaries, not template syntax), and a check of `git status`
for any new script/tool file in this batch's diff.

**Found nothing.** No lint rule, no spec, no script, no CI step anywhere in
the tree implements a sweep over component templates for stray backticks.

This doesn't mean the fix is wrong — the three occurrences the developer hit
were already parse errors, and Angular's own template compiler reliably turns
a broken backtick into a build failure (confirmed indirectly: this round's
`npx nx run tasks-ui:typecheck` is clean, and `ngc` parses every inline
template as part of that pass). But nothing in the repository **persists**
the sweep the developer describes ("which now reports clean" implies a
repeatable check, not a one-off command whose output was read and discarded).
As written, the claim that this "is now the thing standing between that
mistake and a fourth occurrence" is not evidenced by anything checked in —
if the sweep was a manual `grep` run once in a terminal, there is nothing
stopping a fourth occurrence except the same typecheck step that already
existed before this batch and that a developer can skip locally before
commit.

**Non-blocking, but flagged**: recommend either committing the sweep as a
spec (e.g. extend `no-editor-dependency.spec.ts`'s pattern — read every
`*.component.ts` under `src/lib`, regex for an unescaped `` ` `` inside a
`template:` string) or accepting that `typecheck` is the actual safeguard and
retiring the claim that a separate sweep exists.

### Round-2 totals — verified live, matching the claim

| Project      | Claimed          | Measured (uncached)                               | Match |
| ------------ | ---------------- | ------------------------------------------------- | ----- |
| tasks-ui     | 452 → 470 (+18)  | **470**, 17 suites, two independent uncached runs | ✓     |
| shared       | 628 (unchanged)  | **628**                                           | ✓     |
| task-specs   | 380 (unchanged)  | **380** (357 passed, 23 skipped)                  | ✓     |
| rpc-handlers | 1634 (unchanged) | **1634** (1603 passed, 31 skipped)                | ✓     |

`typecheck` and `lint` both clean on `tasks-ui`.

### Round-2 verdict

**APPROVED.** All seven items hold up under live mutation, including two
that went beyond the coordinator's literal reproduction case: the bulk-bar
wiring test's "no other method" half is confirmed load-bearing against an
extra-call defect the first half cannot see, and the visibility-reconcile
control is confirmed necessary against a fully-dead `reconcile()` that would
otherwise read as working suppression. The `untouched` three-way split is
structurally single-producer and was verified correct at the exact 120/40/80
cancel scale this round asked about, not just the 40/20/20 scale from the
original test. The two accuracy corrections are confirmed. The one
open item is process, not logic: the backtick sweep the developer describes
as protection against a fourth occurrence is not present anywhere in the
repository as a persisted check — `typecheck` (already relied on, already
clean) is the only thing currently doing that job.

**No blocking issues.** The Phase 7 pair gate can close on this batch.

**Confidence**: HIGH on every mutation-reproduced claim in this round (all
ten round-1 mutations plus five round-2 mutations directly observed as
pass/fail transitions, all restorations hash-verified). HIGH on totals
(measured uncached, twice, for tasks-ui). MEDIUM on the backtick-sweep
finding — a repo-wide grep can miss a sweep implemented as an ad hoc
already-deleted script; the finding is "not found in the current tree,"
not "proven never to have existed."

---

## Mutation window

**OPENED** before the first `Edit` below, on `tasks-store.service.ts`
(baseline SHA256 `6a9a2773b3f0327354ce75656f02f29df9a37c742f2db748f33f810d2d291931`).
Every mutation in this review was applied with `Edit`, exercised against the real
Jest suite (`npx nx test tasks-ui --testFile=... -t ...`), reverted with a
matching `Edit`, and re-hashed (`certutil -hashfile ... SHA256`) before the next
mutation started. All restorations matched their pre-mutation hash byte-for-byte.
**CLOSED** after a clean confirmation run: `npx nx test tasks-ui` → 17 suites /
452 tests passed, served from the Nx content cache (proof the tree was
byte-identical to the last clean run), plus a clean `typecheck` and `lint`, plus
`git diff --stat` on every file I touched matching the pre-review snapshot
exactly. `visual-reviewer` was told to hold static analysis only; I did not
observe it running tests during the window.

## Review Summary

| Metric                     | Value                                                                                                                   |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Overall Score              | 7/10                                                                                                                    |
| Assessment                 | **APPROVED WITH CONCERNS** — no blocking defect in production code; two verified test-coverage gaps and minor doc drift |
| Critical Issues            | 0                                                                                                                       |
| Serious Issues             | 1                                                                                                                       |
| Moderate Issues            | 1                                                                                                                       |
| Minor Issues               | 2                                                                                                                       |
| Mutations run / reproduced | 10                                                                                                                      |

---

## 1. The plan §6.2 defect — VERIFIED REAL, and the fix is load-bearing

Reproduced by mutation. Replacing `settleBulk`'s "never attempted" branch
(`tasks-store.service.ts:1424-1428`) with the plan's buggy sketch —
`continue` instead of `nextSelection.add(taskId); continue;` — and running
`stops between chunks, leaving un-attempted tasks selected and uncounted`
(`tasks-store.service.spec.ts:1953`) drops `store.selectionCount()` from
**20 to 0**. The 20 un-attempted tasks vanish from the selection exactly as
the plan-defect claim describes. Reverted; hash matched.

The shipped code (`tasks-store.service.ts:1408-1454`, `settleBulk`) keeps
three groups by iterating the full original `ids`, not the `results` list:
`outcomes.get(id) === undefined` → never attempted → stays selected, counted
in neither `succeeded` nor `failures`. This is correct and is the load-bearing
line the mutation above disproves.

## 2. R5 — the ≤ 1 reload guarantee, both fronts reproduced

**Front (a)** — loop must never call `loadBoard`. Inserted
`await this.loadBoard();` at the end of the chunk loop
(`tasks-store.service.ts:1331`, before the mutation). Running
`issues at most ONE tasks:board call for a 50-task bulk with a push after
every chunk` (`:1823`) failed with **`Expected: <= 1 / Received: 4`** —
verbatim match to the developer's claim. Reverted; hash matched.

**Front (b)** — `handleMessage` must short-circuit while a run is in flight.
Changed the guard at `tasks-store.service.ts:809` from
`if (this._bulk() !== null)` to `if (false)`. Both required assertions failed:

- the same `≤ 1` test again shows `Expected: <= 1 / Received: 4`;
- `drops the same push while a run is in flight` (`:2047`) — its
  `boardCallsDuringRun` probe, which is measured **inside** the run before the
  `finally`'s own reload — went from `Expected: 0` to **`Received: 1`**. This
  confirms the "assertion most likely to pass for the wrong reason" is wired
  correctly: it fails via the in-run measurement, not by conflating with the
  end-of-run reload.

Reverted; hash matched.

**Note on the claimed line numbers**: the task brief says `handleMessage` is
"at :576, not :290 as the plan says." Neither is correct against the current
tree — `public handleMessage` is at `tasks-store.service.ts:806`, and
`batches.md:2825` (Task 12.3) still says `:290`. Non-blocking, but worth
correcting so nobody chases the wrong line number later.

## 3. `_missedPush` mutation — reproduced

Hardcoding `const missed = false;` in `reconcileAfterBulk`
(`tasks-store.service.ts:1477`) makes
`refreshes the open detail after the run when a push was dropped` (`:2087`)
fail: `tasks:get` calls go from `Expected length: 1` to **`Received length: 0`**.
The fixture's open task (`TASK_2026_004`) is genuinely outside the run's
selection (only `TASK_2026_000` is toggled), so the board's single reload
cannot cover it — confirms the test isn't accidentally passing because the
board reload also happens to refresh the detail. Reverted; hash matched.

## 4. The two "vacuous test" replacements — both genuinely discriminate

Mutated `selectRangeTo` (`tasks-store.service.ts:1155`) to resolve against
`this.allTasks().map(t => t.id)` (raw payload order) instead of
`this.visibleOrder()` (sorted/filtered). Both replacement tests failed:

- `resolves a range against the SORTED order, not the payload order` (`:1679`)
  — expected `TASK_2026_001` in the result set, got only `{003, 004}`.
- `steps over a filtered-away task inside a range` (`:1722`, the label-hidden
  sibling) — expected `002` excluded, got it included.

`extends a range across the visible, sorted order from the anchor` (`:1651`,
the ordinary case) still passed under the same mutation, which is the correct
control: it shows the two new tests are catching something the pre-existing
test cannot. Reverted; hash matched.

One inaccuracy in the test's own docblock (`:1673-1677`): it says the sorted
and payload-order answers "differ by two carriers." Worked by hand and
confirmed by the mutation's diff output, they differ by exactly **one** task
(`TASK_2026_001` is in the sorted-order answer and not in the payload-order
one; `TASK_2026_003`/`TASK_2026_004` are in both). Cosmetic — the test still
discriminates correctly — but the comment overstates the delta. Minor,
non-blocking.

## 5. Language ban sweep — not vacuous

Injected the word "atomically" into `TaskBulkBarComponent.confirmPrompt`
(`task-bulk-bar.component.ts:228`). `appear nowhere in the bulk bar
(awaiting confirmation)` (`task-bulk-summary.component.spec.ts:254`) failed
immediately, catching the word in the swept `textContent`. Reverted; hash
matched.

Separately grepped the whole batch diff for `atomic|transactional|
all-or-nothing` (case-insensitive) — the only source hit outside the test
file itself is `tasks-store.service.ts:923` ("...it has no way to make
atomic"). Confirmed via `git show HEAD:...` that this line is **pre-existing
from Batch 7**, not touched by Batch 12, and describes the single-task
`applyMetadata` write funnel, not the bulk path. Out of scope for this gate;
noted for completeness, not a finding against this batch.

## 6. `_bulkRequest` / palette routing ("mutation 11") — reproduced

`tasks-view.component.ts:825` routes the palette's `bulkSetStatus` action
through `store.requestBulkStatus(action.status)` — the same entry point the
bulk bar's `<select>` uses (`:286`). Changed it to
`void this.store.bulkUpdateStatus(action.status)` (bypassing confirmation) and
ran `routes a palette bulk action through the same confirmation`
(`tasks-view.component.spec.ts:1169`): `store.bulkRequest()` went from
`'done'` to `null` — the test catches the bypass. Reverted; hash matched.
Judgement call 5 (adding `_bulkRequest` beyond Task 12.1's named list) is
justified: the shared signal is what makes FR-C6.7 structural rather than a
review-time promise, and the mutation shows the alternative wiring really is
one line away and really is caught.

## 7. FINDING (Serious, non-blocking) — bulk bar's output wiring is untested

`tasks-view.component.ts:286-291` binds all six `TaskBulkBarComponent`
outputs to store methods:

```
(statusPicked)="store.requestBulkStatus($event)"
(confirmRequest)="store.confirmBulkRequest()"
(cancelRequest)="store.cancelBulkRequest()"
(cancelRun)="store.cancelBulk()"
(selectAllMatching)="store.selectAllMatching()"
(clearSelection)="store.clearSelection()"
```

I swapped three of these to other same-signature (`(): void`) store methods —
`(cancelRun)` → `cancelBulkRequest()`, `(selectAllMatching)` →
`clearSelection()`, `(clearSelection)` → `selectAllMatching()` — and ran the
full `tasks-ui` suite plus `typecheck`. **452/452 tests still passed, and
typecheck was clean.** Reverted; hash matched, confirmed by `git diff --stat`
returning the pre-review baseline exactly.

**Failure scenario this proves is reachable**: a future edit that
accidentally swaps `(cancelRun)` for `cancelBulkRequest()` — a plausible
typo, since both are zero-arg `void` methods on the same store and the names
are one word apart — ships with a green CI. In production this means: a user
starts a 120-task bulk run, clicks Cancel mid-run, and **nothing happens**,
because `cancelBulkRequest()` only clears a pending confirmation (`_bulkRequest`,
which is `null` once a run is `running`) and does not touch `_bulk.cancelled`.
The Cancel button would render, be clickable, and silently no-op — precisely
the "chunk-granular but at least it stops" contract FR-C4.9 exists to
guarantee, undetected by any test in this batch.

No `task-bulk-bar.component.spec.ts` exists at all; the component's states are
covered for **rendering** (via `task-bulk-summary.component.spec.ts`'s
`it.each` over idle/confirm/running, for the language sweep) and for
**visibility** (via `tasks-view.component.spec.ts`'s "shows no bulk bar until
something is selected" and the palette-routing test), but no test in the
batch clicks Cancel, Select-all-matching, or Clear-selection and asserts which
store method fired.

**Fix**: add either a `task-bulk-bar.component.spec.ts` that mounts the
component standalone and asserts each output fires on the right click (cheap,
~6 assertions), or extend `tasks-view.component.spec.ts`'s `describe('bulk')`
block with click-driven assertions against `jest.spyOn(store, ...)` for at
least `cancelBulk` and `selectAllMatching`/`clearSelection`. The current
production wiring is correct — this is a coverage gap, not a live bug.

## 8. FINDING (Moderate, non-blocking) — the "third suppression front" IS testable; the developer's exemption is wrong

Judgement call 3 states the visibility/focus reconcile's suppression
(`setupVisibilityReconcile`, `tasks-store.service.ts:1804`,
`if (this._bulk() !== null) return;`) is "not covered by a mutation test
because jsdom does not fire those events here."

That is not correct. The same spec file already has two **passing** tests
that dispatch exactly these events successfully —
`re-fetches the board on window focus after an initial load` (`:284`,
`window.dispatchEvent(new Event('focus'))`) and
`re-fetches on visibilitychange when the document becomes visible` (`:297`,
`document.dispatchEvent(new Event('visibilitychange'))`, relying on jsdom's
default `visibilityState === 'visible'`).

I wrote a probe test using the identical interleaving technique already used
for `drops the same push while a run is in flight` (`:2047`) — dispatch the
events from inside the `tasks:bulkUpdateStatus` mock hook, mid-run — and it:

- **passed** against the real implementation (proving the guard at `:1804`
  already correctly suppresses this third front), and
- **failed** (`Expected: 0 / Received: 1`) when I removed
  `if (this._bulk() !== null) return;` from `setupVisibilityReconcile`,
  proving the probe genuinely discriminates and is not vacuous.

Both the probe test and the source mutation were reverted; hashes matched.

**Assessment**: the production code is correct — this is not a live defect.
But the risk _can_ be pinned with about 15 lines of test code, copy-shaped
from an existing test in the same file, and the "jsdom can't do this" reason
given for skipping it does not hold up — jsdom already does this twice in the
same file. Recommend adding the probe (verified working, above) to
`tasks-store.service.spec.ts` in the "Push suppression (front b)" `describe`
block before this batch is considered closed out, since R5's own framing is
"two fronts, both required" and this is functionally a third front on the
same failure mode that currently has zero regression protection.

## 9. Judgement calls — verdicts

| #   | Call                                                                                                     | Verdict                                                        | Basis                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Filter-hidden selection reported via `hiddenSelectionCount`, not pruned; index-departed tasks ARE pruned | **Sound**                                                      | `pruneSelection` (`:1869`) and `hiddenSelectionCount` (`:663`) are two different signals over two different conditions ("gone from index" vs "hidden by filter"), each with its own passing test (`prunes ids the reloaded board no longer holds` / `keeps a filtered-away selection and counts it as hidden`). No mutation needed; the two code paths are structurally independent.                                                      |
| 2   | Bulk bypasses `enqueueWrite`; overlap reported as `TASK_CONFLICT`                                        | **Sound, and honestly documented**                             | Confirmed `bulkUpdateStatus`/`callBulkChunk` never touch `writeTails`/`enqueueWrite`. The docblock at `:1281-1290` states the tradeoff plainly (no serialization per bulk call, correctness comes from the writer's pre-write re-read) rather than implying safety it doesn't have.                                                                                                                                                       |
| 3   | Third suppression front (visibility/focus) not mutation-tested, jsdom given as reason                    | **Correct in outcome, wrong in stated reason — see Finding 8** | Guard is present and correct; the "can't be tested" justification is disproved by a working probe.                                                                                                                                                                                                                                                                                                                                        |
| 4   | Results resolved by case-folded key, matching backend `dedupeTaskIds`                                    | **Correct**                                                    | `outcomes.set(item.taskId.toLowerCase(), item)` / `outcomes.get(taskId.toLowerCase())` in the store match `dedupeTaskIds` (`tasks-rpc.handlers.ts:184-194`), which folds on `.toLowerCase()` and keeps the first-seen spelling as the result's `taskId`. Two differently-cased selected ids both resolve to the one outcome.                                                                                                              |
| 5   | `_bulkRequest` added beyond Task 12.1's list for structural palette routing                              | **Justified — see §6**                                         | Reproduced via mutation 11.                                                                                                                                                                                                                                                                                                                                                                                                               |
| 6   | Roving tabindex counts 33→36 / 11→12 with checkbox added                                                 | **Correct, invariant intact**                                  | `task-card.component.ts` binds `[attr.tabindex]="rovingTabIndex()"` on the new checkbox identically to every other control (`:116`), so it participates in the existing roving computed. `confines every tab stop on the board to the ONE focused card` (`task-board.component.spec.ts:145-186`) measures `focusableNodes` (36) and `stops` (12) from the DOM rather than asserting from reading, and the full board spec (17/17) passes. |

## 10. Totals — verified against the running tree, not trusted from the report

| Project      | Claimed                   | Measured                           | Match                                                                                                                |
| ------------ | ------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| tasks-ui     | 409 → 452 (+43, +1 suite) | **452 tests, 17 suites** (current) | current figure matches; 409 baseline is the developer's own pre-batch measurement, not independently re-derived here |
| shared       | 628 (unchanged)           | **628**                            | ✓                                                                                                                    |
| task-specs   | 380 (unchanged)           | **380** (357 passed, 23 skipped)   | ✓                                                                                                                    |
| rpc-handlers | 1634 (unchanged)          | **1634** (1603 passed, 31 skipped) | ✓                                                                                                                    |

`npx nx run tasks-ui:typecheck` and `npx nx run tasks-ui:lint` both clean.
Grep for `TODO|FIXME|not implemented|placeholder` and `: any|<any>|as any`
across the batch's changed/new files: no stub markers, no `any` (the only
`placeholder` hits are HTML `placeholder=` attributes on pre-existing form
inputs; the only `any`-substring hits are the words "anywhere"/"anything" in
prose comments).

## 11. Standing rules — checked

- `_selection` independent of `_selectedTaskId`: confirmed by code inspection
  (`toggleSelection`/`clearSelection` never touch `_selectedTaskId`;
  `openTask`/`closeTask` never touch `_selection`) and by
  `opens no detail panel and closes none` (`:1641`).
- Failures stay selected, successes deselect: confirmed in `settleBulk` and by
  `deselects successes and keeps failures selected` (`:1875`).
- No auto-retry ever fires: confirmed — nothing in `bulkUpdateStatus` re-issues
  a failed id; `Retry` is a button (`task-bulk-summary.component.ts:69-76`)
  that re-runs through `requestBulkStatus`, so even a Retry above the
  threshold asks again.
- Confirmation above 10 names count and target status: confirmed —
  `confirmPrompt` (`task-bulk-bar.component.ts:227-229`) interpolates both.
- Cancellation copy verbatim, chunk-granular: confirmed —
  `task-bulk-summary.component.ts:95-99` renders "Cancelled after {{attempted}}
  of {{requested}}. Writes already issued completed and were not reversed."
  matching the plan's stated sentence.
- Failure summary persistent, not a toast: confirmed — `_bulkSummary` is
  cleared only by `clearBulkSummary()`, a new run starting, or a workspace
  switch; no timer.
- No new `text-base-content/NN`: one hit in the diff
  (`task-card.component.ts`, the id `<span>`), but `git show HEAD:...`
  confirms `text-base-content/50` was already present before this batch — only
  `flex-1` was added to that class list. Not a new occurrence.
- No `alert-*` classes: confirmed — the only `alert-*` substrings in the bulk
  components are prose comments explaining their _absence_.
- `tailwind.config.js` untouched: confirmed, empty `git diff`.
- OnPush on both new components: confirmed
  (`task-bulk-bar.component.ts`, `task-bulk-summary.component.ts`).
- `track` on every `@for`: confirmed, all four `@for` blocks across the
  touched files carry `track`.

## 12. Minor / non-blocking notes

1. Test docblock at `tasks-store.service.ts:1673-1677` overstates the
   sorted-vs-payload-order delta as "two carriers" when it is one
   (`TASK_2026_001`). Cosmetic; the test itself discriminates correctly (§4).
2. Task brief's claimed `handleMessage` line (`:576`) matches neither the plan
   (`:290`, per `batches.md:2825`) nor the current source (`:806`). No action
   needed beyond using `:806` going forward.
3. `batches.md:2823` still reads `BULK_CHUNK_SIZE = 20` as if declared
   locally; the developer already flagged this as stale prose in the same
   entry. Confirmed the actual source imports it from
   `libs/shared/.../task-view.types.ts:114` (§ "BULK_CHUNK_SIZE must be
   IMPORTED" — verified, not redeclared).

## Verdict

**APPROVED WITH CONCERNS.** The R5 ≤ 1-reload guarantee (both fronts), the
plan §6.2 defect and its three-group fix, the case-folded outcome resolution,
the palette/bar shared-confirmation structure, the roving-tabindex invariant,
and the banned-language sweep all reproduced exactly as claimed under live
mutation — this is real, load-bearing test coverage, not narrative. The two
items that keep this from a clean APPROVE are both coverage gaps rather than
production defects: the bulk bar's six output bindings have no test that
would catch a swapped method call (Finding 7, Serious), and the third
suppression front's "untestable" justification does not survive a 15-line
probe using a technique already proven elsewhere in the same file
(Finding 8, Moderate). Neither blocks the Phase 7 pair gate on its own, but
both should be closed before Batch 13 builds on this surface.

**Confidence**: HIGH on all mutation-reproduced claims (directly observed
pass/fail transitions with byte-identical restoration). MEDIUM on the totals
row for the 409 tasks-ui baseline (accepted as the developer's own
pre-batch measurement per the task brief, not independently re-derived by
checking out the prior commit).
