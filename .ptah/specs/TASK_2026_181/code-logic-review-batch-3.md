# Code Logic Review — TASK_2026_181, Batch 3 (Phase 1: B read path)

## Review Summary

| Metric              | Value                  |
| ------------------- | ---------------------- |
| Overall Score       | 8/10                   |
| Assessment          | APPROVED WITH CONCERNS |
| Critical Issues     | 0                      |
| Serious Issues      | 0                      |
| Moderate Issues     | 2                      |
| Failure Modes Found | 4                      |

**Scope verified**: `git status`/`git diff` against the working tree confirms the uncommitted
set is exactly `libs/frontend/tasks-ui/**` — 10 modified files + 1 new file
(`task-relations.component.ts`). No foreign paths (license-server, community, forum,
`tsconfig.base.json`) touched. `npx nx run tasks-ui:typecheck/test/lint` all pass green
(82/82 tests, lint clean) — reproduced independently, not taken on trust.

---

## Adjudication of the three overridden requirements

### 1. Task 3.6's prescribed fix (`track issue.field + '|' + issue.code + '|' + (issue.ref ?? $index)`) — developer's override is CORRECT, verified independently

**Angular behaviour, verified by reading the installed source, not by trusting the claim.**
`node_modules/@angular/core/fesm2022/_debug_node-chunk.mjs` (installed `@angular/core@21.2.6`)
confirms NG0955 is raised only from `reconcile()`, via `console.warn(formatRuntimeError(-955, ...))`
gated behind `if (ngDevMode)` — not a throw. More importantly, the duplicate-key bookkeeping
(`recordDuplicateKeys`) is called only _inside_ the two `while` loops that walk both the live
and the new collection simultaneously (`liveStartIdx <= liveEndIdx && liveStartIdx <= newEndIdx`,
and the iterator variant). On first render `liveCollection.length === 0`, so `liveEndIdx = -1`
and that condition is false from the first check — the loop body (and thus
`recordDuplicateKeys`) never executes. First-render items are all created via the tail loop
(`createOrAttach`), which never touches `duplicateKeys`. **NG0955 is structurally unreachable
on first render and fires only on reconcile.** The developer's claim is correct.

**The `liftRelationArray` collision, verified by reading `task-frontmatter.ts:180-213`.** For
`relates_to: [X, X]` where `X` is dangling and `X !== folderName`, the loop iterates both
occurrences of `X`; each fails the `knownFolders.has(entry)` check and pushes a
`{ field: yamlKey, code: 'dangling_relation', message: <identical text>, ref: X }` issue.
Both pushed objects are identical in `(field, code, ref)` — the prescribed key
`issue.field + '|' + issue.code + '|' + (issue.ref ?? $index)` collides on this input, and
FR-B4.8 (batches.md line 287: "Duplicate entries inside one relation array are not rewritten
out of the file") makes this input legitimate, not a corrupt-data edge case. Confirmed.

**The shipped key** (`task-detail.component.ts`, the `@for` on `validationIssues`):
`issue.code + '|' + issue.field + '|' + (issue.ref ?? '') + '|' + $index` — `$index` is
unconditional, so uniqueness holds by construction regardless of `ref`/`code`/`field`
collisions. Correct and strictly stronger than the spec.

**The regression pin genuinely bites.** `task-detail.component.spec.ts`'s
`'validation issues with a colliding track key'` block drives a real reconcile (2 issues → 3
→ 1, via `fixture.componentRef.setInput` + `fixture.detectChanges()`) under a
`jest.spyOn(console, 'warn')` and asserts no NG0955-tagged message appears, plus three
row-count assertions covering the identical-`(field,code,ref)` case, the no-`ref` case, and
the ordinary two-distinct-entries case. This is exactly the reconcile-path pin the developer
claimed to have built, not a first-render-only check. Verdict: **override correct, evidence
independently reproduced.**

### 2. Pixel-identity baseline changed `main` → `HEAD` — CORRECT

Verified by git history, not by trusting the batch note: `git log --oneline main -- .../task-card.component.ts`
shows `main`'s last touch predates this branch entirely (`9cc2da7fb`, `2db8146e1`, `f2b61f0a0`
are the only history — none of them are the cited commits). `git diff --stat main HEAD -- .../task-card.component.ts`
shows a 93-line diff (59 insertions / 34 deletions) between `main` and the branch tip _before_
any Batch-3 change, confirming `main`'s card is a materially different file. `git show --stat
3e93069fd -- libs/frontend/tasks-ui` (Batch 1's commit) shows exactly one file touched,
`task-presentation.ts`, 76 insertions, 0 deletions — Batch 1 did not touch the card. So the
divergence from `main` predates this task, and plan §6.7 / §5.2 and batches.md's own edge-case
table (line 156: "pixel-identical to **today's card**") both use "today's card," not "main" —
the "main" wording appears only in the Batch 3 gate checklist line (batches.md:633), which is
an internal inconsistency in `batches.md` against its own stated source of truth
(`implementation-plan.md`). **`HEAD` is the correct baseline; the override is correct**, and
the golden-DOM structural assertions in `task-card.component.spec.ts` (`.card-body` child
count === 4, all five `data-testid`s absent, no "unestimated"/"add label" text) are a
legitimate, verifiable proxy for "unchanged" given no actual `main` snapshot exists to diff
against.

### 3. `withRelationArrays` defensive normalization — ACCEPT, but the stated justification is factually wrong and should be corrected

Independent investigation (traced `ClaudeRpcService`, the VS Code/Electron webview-hosting
code, `task-index.store.ts`'s `rowToSummary`/`parseJsonArray`, and `VSCodeService.getState`)
found:

- `ClaudeRpcService` performs **zero** runtime/Zod validation on RPC response `data` — the
  `TaskSpecSummary` type is a compile-time-only guarantee once data crosses the
  extension-host ↔ webview postMessage bridge.
- The specific scenario the code comment names — _"a host that predates the metadata
  contract sends payloads without the last three [fields]"_ — **does not occur in this
  codebase's shipping model**. The webview HTML is regenerated fresh from the currently
  installed extension on every panel creation (`webview-html-generator.ts`); Electron bundles
  main + preload + webview into one artifact and updates as a whole-installer swap. There is
  no mechanism by which an old webview bundle talks to a new host or vice versa — they always
  ship and update atomically.
- Every actual producer of `TaskSpecSummary` already guarantees the four fields are arrays:
  `rowToSummary`'s `parseJsonArray` (`Array.isArray(parsed) ? … : []`), the `0031` migration's
  `NOT NULL DEFAULT '[]'` columns (which SQLite applies to pre-existing rows on read, not just
  new inserts), and `parseTaskFile`'s Zod-plus-manual-lift defaulting. `InMemoryTaskIndexStore`
  relies on the same parse boundary. So today, no code path in this repository can hand
  `toSlice` a `TaskSpecSummary` missing these fields.

So, judged against the project's "do not add fallbacks for scenarios that cannot happen"
standard: the _named_ scenario is impossible, and citing it is factually inaccurate.
**However**, `toSlice` is genuinely the one place in `TasksStore` that receives raw,
unvalidated data across the actual system boundary (the postMessage bridge), `ClaudeRpcService`
provides no validation of its own, and the function sits directly beside the pre-existing
`readExcludedFolders` (same file, same boundary, same defensive-parse style) — so this is
consistent with, not a deviation from, the file's established convention for this exact
chokepoint. `buildTaskGraph` also iterates the four fields unconditionally with no internal
guard, so a violation here would crash the entire board on render, not degrade gracefully.
On balance this is defensible boundary-hardening at a boundary with no other runtime check,
not defensive code for an internal invariant — but its doc comment invents a plausible-sounding
but false trigger instead of stating the real one (zero runtime validation elsewhere on this
wire). Recommend fixing the comment before or in the next batch; **not blocking** for this
review since the code itself is correct, cheap (no-op on the well-formed path, confirmed by
the identity check `if (Array.isArray(...) × 4) return task;`), and tested
(`'survives a host payload that predates the metadata contract'` in
`tasks-store.service.spec.ts`).

---

## Binding rules verification

| Rule                                                                                                              | Status   | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Zero writes on any render path (FR-B3.2)                                                                          | **PASS** | `git diff` shows no new `this.rpc.call(...)` site; the six existing call sites (`tasks:get/updateStatus/create/reindex/generateRegistry/board`) are untouched. `graph`/`allTasks`/`knownLabels` are pure `computed()`s. Store spec `'issues no RPC at all while the graph is being read'` asserts `rpcCall` uncalled after clearing the mock — reproduced (test passes).                                                        |
| `OnPush` on every component, signals + `computed()` + `inject()`, no `[innerHTML]`                                | **PASS** | `task-relations.component.ts` declares `ChangeDetectionStrategy.OnPush`; `task-card`/`task-detail` keep it. No `[innerHTML]` anywhere in the diff; labels and relation ids are rendered via `{{ }}` interpolation only (confirmed in both `task-card.component.ts:246` and `task-detail.component.ts`), and a hostile-label test (`'renders label text verbatim as text, never as markup'`) proves the DOM contains no `<img>`. |
| One `computed` for the graph, invalidated only by the board payload (NFR-10)                                      | **PASS** | `graph = computed(() => buildTaskGraph(this.allTasks()))` depends only on `_columns` (written once per `loadBoard()`/push). No filter/sort/selection signal exists yet in Batch 3 to leak into it. Store spec proves memoization by reference identity (`toBe`) across repeated reads and invalidation only after a second `loadBoard()`.                                                                                       |
| Absent ⇒ render nothing (§6.7)                                                                                    | **PASS** | All five affordances (`labels`, `estimate`, `duplicates`, `parent` breadcrumb, `relatesTo`-derived groups) are behind `@if`. Golden-DOM spec asserts all five `data-testid`s absent and exactly 4 `.card-body` children for a bare task, including against a populated `graph()` for _other_ tasks.                                                                                                                             |
| Authored vs derived visually distinct; derived affordance navigates or is disabled with a stated reason (FR-B4.9) | **PASS** | `task-relations.component.ts` disables (`[disabled]="!entry.navigable"`) with a title/aria-label reason when `graph` is `null`; when present, every rendered id already resolved via `graph.byId`, so it is always navigable. Test `'disables relation chips with a stated reason when no graph is supplied'` and `'emits the id when a relation chip is opened'` both pass.                                                    |
| R11: no `tasks-ui → editor` edge                                                                                  | **PASS** | `grep -r '@ptah-extension/editor' libs/frontend/tasks-ui/src` — zero hits. (Note: the `no-editor-dependency.spec.ts` ratchet itself is Batch 10 scope, not Batch 3 — correctly absent here.)                                                                                                                                                                                                                                    |
| BR-8: `TaskStartService` untouched, no run affordance                                                             | **PASS** | Not in the changed-file set; the only two tasks-ui hits for `task-start.service` are `index.ts` and `tasks-view.component.ts` (both pre-existing, unmodified by this diff — `tasks-view.component.ts`'s diff is 3 lines, both `[graph]`/`(openTask)` wiring).                                                                                                                                                                   |
| BR-7: no per-task filename literal / forbidden path strings                                                       | **PASS** | `grep` for `task-tracking/`, `.ptah/tasks/`, `specs/TASK_2025_`, `TASK_2025_` across the diffed tree — zero hits. All fixture ids in the two spec files are `TASK_2026_*`.                                                                                                                                                                                                                                                      |
| TS strict, no `any`, no `@ts-ignore`, no stubs/TODOs                                                              | **PASS** | `nx run tasks-ui:typecheck` green; `grep` over the diff additions for `any`/`@ts-ignore`/`TODO`/`FIXME`/`stub`/`placeholder` found no code hits (only prose false-positives, e.g. "any wording").                                                                                                                                                                                                                               |

---

## The 5 paranoid questions

### 1. How does this fail silently?

If a future refactor of `rowToSummary` (or a new producer of `TaskSpecSummary`, e.g. the MCP
`ptah_task_get` `derived` block mentioned in the plan for Batch 4) ever forgets to default one
of the four relation arrays, `withRelationArrays` masks it completely — the board renders with
that task's relations silently empty instead of surfacing a visible defect. This is the
double-edged nature of the accepted normalization in item 3 above: it protects the render path
but also removes the one signal (`TypeError`) that would otherwise catch a real regression at
the boundary. Not blocking (there's no error channel this could report through today), but
worth noting for whoever owns the RPC boundary going forward.

### 2. What user action causes unexpected behavior?

A `relates_to`/`duplicates` array containing an id that resolves to a task with the exact same
id as an already-processed id but through a _different_ path shows no issue — `buildTaskGraph`
de-duplicates via `Map`/`byId.has`, so this is fine. The one genuine near-miss: `parentCrumb`'s
fallback reason (`` `The parent claim '${parent}' was not honoured...` ``) fires only if
`task.validationIssues` has **no** entry with `field === 'parent'`. Given `deriveCrossFileIssues`
and `analyzeParentage` always attach a `parent` issue whenever `effectiveParent` disagrees with
the declared value (confirmed by reading `task-graph.ts:243-291`), this fallback string is
believed unreachable on real data — but it is silent, un-tested dead-looking code (no spec
exercises it) and there's no assertion pinning that the parser and the graph never disagree.
Non-blocking; flag for awareness only.

### 3. What data makes this produce wrong results?

Two tasks with **identically-cased-different** labels that also collide in `labelKey` but
render in two different components (card vs. detail) get the same colour in both — correct by
design (R9), confirmed by the `'gives case- and whitespace-variant labels the same chip colour'`
test. No wrong-result path found for label rendering. The `@for (label of task().labels; track
$index)` in the card (`task-card.component.ts:240`) tracks by index, not value — functionally
correct (labels aren't required unique, so tracking by value could reintroduce an NG0955-style
collision on `['x','x']`), but it means Angular cannot preserve per-chip DOM identity across a
reorder. Since chips are stateless spans this is invisible today; flagged only because it's the
same class of key-collision risk Task 3.6 exists to fix, applied here via the more conservative
`$index` route rather than a compound key. Not a defect.

### 4. What happens when dependencies fail?

`TaskGraph` being `null` (card/detail rendered standalone, e.g. in a host that hasn't wired
`[graph]`) degrades every derived affordance correctly: `childRollup` → `null` (no rollup shown,
since `graph()?.rollup` short-circuits), `parentCrumb` → non-navigable with an explicit
"board index is not available" reason, relation groups → authored-only entries, all disabled
with the same stated reason. No crash path found; every `graph()` read in the diff is guarded
with `?.` or a `null` check before use.

### 5. What's missing that the requirements didn't mention?

Nothing found beyond the two items already raised (the fallback-reason string, and the
`withRelationArrays` comment's inaccurate rationale). The manual R15 contrast gate (palette
colours in both VS Code themes) is not independently re-verifiable by a code review — it is
recorded as a computed table in the code comment, not re-measured here; flagged as an
unverified manual gate, not a code defect.

---

## Failure Mode Analysis

### Failure Mode 1: Silent masking of a future RPC-boundary regression

- **Trigger**: A later batch (e.g. Batch 4's MCP `derived` block, or any new `TaskSpecSummary`
  producer) ships a payload missing one of the four relation arrays.
- **Symptoms**: The board renders fine, but that task's chips/relations are silently empty —
  no error, no log line, nothing distinguishing "genuinely empty" from "malformed payload."
- **Impact**: Low today (no known producer violates the invariant); moderate going forward as a
  debugging cost if it ever does.
- **Current handling**: Silently coerced to `[]` by `withRelationArrays`.
- **Recommendation**: Non-blocking. If this pattern is kept as boundary hardening, consider a
  one-time `console.warn`/telemetry event when coercion actually triggers, so a real regression
  is at least visible in dev tools instead of indistinguishable from empty data.

### Failure Mode 2: Untested fallback string in `parentCrumb`

- **Trigger**: `task.parent` is set, the graph did not honour the claim, but no
  `validationIssues` entry has `field === 'parent'` — currently believed impossible given
  `analyzeParentage` always attaches one, but nothing pins that invariant from the frontend
  side.
- **Symptoms**: The card would show a generic invented sentence instead of the backend's
  specific one — a UX regression, not a crash.
- **Impact**: Low; the plan's design decision (d) explicitly wants the backend's message
  preferred, and this is the safety net for that preference, not the primary path.
- **Current handling**: Silent fallback string, never exercised by a test.
- **Recommendation**: Non-blocking. Optional: a test with a graph that rejects a parent claim
  but an empty `validationIssues` array, to document the fallback is intentional dead code
  rather than an oversight.

### Failure Mode 3: `TASK_RELATION_GROUP_ORIGIN` is dead, drift-prone data

- **Trigger**: None at runtime — this is a static-analysis finding, not a runtime failure.
- **Symptoms**: `task-presentation.ts` exports `TASK_RELATION_GROUP_ORIGIN`, a
  `Record<TaskRelationGroup, TaskRelationOrigin | 'mixed'>` documenting which side authors each
  relation group. `task-relations.component.ts` never reads it — it hardcodes the same five
  origin values inline at each `push(...)` call site instead. Grep confirms `TASK_RELATION_GROUP_ORIGIN`
  has exactly one producer site and one re-export site (`index.ts`); zero internal consumers.
- **Impact**: Low — it's exported publicly (a real, if unused, part of the surface), and it's
  a second source of truth for the authored/derived mapping that nothing cross-checks against
  the component's hardcoded literals. If a future batch edits one and not the other, they
  silently disagree with no test to catch it.
- **Current handling**: None — both copies are independently correct today by inspection, not
  by construction.
- **Recommendation**: Non-blocking simplification. Either have `task-relations.component.ts`'s
  `push()` calls read origin from `TASK_RELATION_GROUP_ORIGIN[group]` instead of passing it as a
  literal, or drop the exported constant if it has no external consumer yet. Minor; does not
  affect Batch 3's correctness.

### Failure Mode 4: `withRelationArrays`'s doc comment cites an impossible trigger

- **Trigger**: None — this is a documentation-accuracy finding covered fully in the item-3
  adjudication above.
- **Symptoms**: A future reader trusts the comment, concludes cross-version host skew is a real
  concern in this codebase, and starts defending against it elsewhere unnecessarily (or, worse,
  removes this function because the cited scenario turns out to be false, losing the actual
  — different — justification for keeping it).
- **Impact**: Low, documentation only.
- **Current handling**: N/A.
- **Recommendation**: Reword the comment to cite "no runtime validation exists between
  `rowToSummary`/`parseTaskFile` and this consumer" rather than "a host that predates the
  metadata contract." Non-blocking.

---

## Data Flow Analysis

```
tasks:board RPC response (untyped over postMessage, ClaudeRpcService: NO runtime validation)
        │
        ▼
TasksStore.toSlice(data)  ──► withRelationArrays(task) per row  [Gap point 1: only guard on this wire]
        │
        ▼
_columns signal  ──► allTasks() computed (flatten, TASK_STATUSES order)
        │
        ▼
graph = computed(buildTaskGraph(allTasks()))   [pure, zero I/O — FR-B3.2 structural, confirmed]
        │
        ├──► TaskBoardComponent [graph] ──► TaskColumnComponent [graph] ──► TaskCardComponent [graph]
        │          renders: labels, estimate badge, child rollup, parent breadcrumb, duplicate marker
        │
        └──► TaskDetailComponent [graph] ──► TaskRelationsComponent [task, graph]
                   renders: 5 relation groups, authored vs derived, disabled-with-reason
```

### Gap points identified

1. `toSlice` is the single point where an unvalidated wire payload is trusted; `withRelationArrays`
   is the only guard here (see Failure Mode 1/4 — accepted, but justification should be corrected).
2. `parentCrumb`'s fallback string path is unreachable-by-design but untested (Failure Mode 2).
3. No state is lost or corrupted anywhere in this flow — it is strictly read-only end to end,
   confirmed by the absence of any new RPC call site in the diff.

---

## Requirements Fulfillment

| Requirement                                      | Status                     | Concern                                                                                                                    |
| ------------------------------------------------ | -------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Task 3.1 Presentation helpers                    | COMPLETE                   | `taskEstimateBadge`, `LABEL_CHIP_CLASSES`, `labelChipClass`, `TASK_RELATION_GROUP_LABELS` all present, documented, tested. |
| Task 3.2 Store graph computed                    | COMPLETE                   | Single `computed`, memoized, zero RPC on read — verified.                                                                  |
| Task 3.3 Card renders five fields                | COMPLETE                   | All five behind `@if`; zero-metadata golden-DOM spec passes.                                                               |
| Task 3.4 Relation groups (read-only)             | COMPLETE                   | Five groups, authored/derived distinction is textual + visual, no write affordance present.                                |
| Task 3.5 Zero-metadata golden-DOM spec + exports | COMPLETE                   | `index.ts` exports match component surface; spec asserts absence of all five affordances plus structural child count.      |
| Task 3.6 Fix duplicate `@for` track key          | COMPLETE, IMPROVED ON SPEC | Override independently verified correct (see adjudication 1); shipped key is objectively safer than the prescribed one.    |

### Implicit requirements not explicitly addressed (non-blocking)

1. No telemetry/log signal if `withRelationArrays` ever actually coerces a malformed payload —
   see Failure Mode 1.
2. `TASK_RELATION_GROUP_ORIGIN` has no consumer and no test cross-checking it against the
   component's hardcoded origins — see Failure Mode 3.

---

## Edge Case Analysis

| Edge Case                                                 | Handled                                                  | How                                                                                                    | Concern                                                                                                                                                          |
| --------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `relates_to` with two distinct dangling entries           | YES                                                      | Renders 2 `<li>` rows, no NG0955 (test passes, reconcile-driven)                                       | None                                                                                                                                                             |
| `relates_to` with the same dangling entry twice (FR-B4.8) | YES                                                      | Renders 2 `<li>` rows via the `$index` fallback                                                        | None                                                                                                                                                             |
| Validation issues with no `ref` at all                    | YES                                                      | `$index` fallback keeps keys unique                                                                    | None                                                                                                                                                             |
| Zero-metadata task, real graph present                    | YES                                                      | Golden-DOM spec: still renders nothing                                                                 | None                                                                                                                                                             |
| Parent claim honoured vs refused                          | YES                                                      | Button (navigable) vs static text + "not linked" + title reason                                        | None                                                                                                                                                             |
| No graph supplied (`graph` input `null`)                  | YES                                                      | Card shows non-navigable parent with a stated reason; relations disabled with a stated reason          | None                                                                                                                                                             |
| Hostile label text (`<img onerror=...>`)                  | YES                                                      | Rendered as text via interpolation; no `<img>` in DOM                                                  | None                                                                                                                                                             |
| Relation target not on the board                          | YES                                                      | Group omitted entirely (not rendered as a dead link); surfaces via `dangling_relation` warning instead | None                                                                                                                                                             |
| Payload missing relation arrays (pre-Batch-1 host)        | YES, but scenario is not actually reachable today        | `withRelationArrays` coerces to `[]`                                                                   | See adjudication 3 / Failure Mode 4                                                                                                                              |
| Terminal (done/cancelled) task card structure             | Not explicitly asserted for the 4-child golden-DOM count | Footer branch differs (`@else` block)                                                                  | Low — same `@if` gating applies; not a real gap, just untested by the specific structural-count test (which only exercises the default `backlog`-status fixture) |

---

## Integration Risk Assessment

| Integration                                                        | Failure Probability                                | Impact                                                                                                                                    | Mitigation                                                           |
| ------------------------------------------------------------------ | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `ClaudeRpcService` → `TasksStore.toSlice`                          | LOW (no live producer violates the contract today) | Board-wide crash if violated and `withRelationArrays` were absent                                                                         | `withRelationArrays` present; comment inaccurate but code correct    |
| `TaskGraph` construction over a large board                        | LOW                                                | Perf, not correctness (out of Batch 3 scope — NFR-10 covers filter recompute, not graph build cost, which is unchanged from Batch 2)      | Already proven O(N) in Batch 2's review                              |
| Card/Detail/Relations `graph` input wiring (board → column → card) | LOW                                                | A missed `[graph]` forwarding site would silently degrade to `null`-graph behaviour (still correct, just less informative), never a crash | Confirmed complete: board, column, detail, tasks-view all forward it |

---

## Verdict

**Recommendation**: APPROVE.
**Confidence**: HIGH — all three overridden requirements were independently re-derived from
primary sources (installed Angular source, `task-frontmatter.ts`, `git log`/`git diff` against
`main`), not taken on the developer's word; typecheck/test/lint were re-run and reproduced
green; the diff was read in full, not sampled.
**Top risk**: None blocking. The two moderate findings (`TASK_RELATION_GROUP_ORIGIN` dead data,
and `withRelationArrays`'s inaccurate doc comment) are both low-impact and low-effort to fix in
a follow-up; neither affects correctness of the shipped Batch 3 behaviour.

## What a more robust implementation would additionally include

- A single coercion-detected telemetry hook in `withRelationArrays`, so if the "impossible"
  scenario ever does happen (e.g. a future Batch 4 MCP producer regresses), it is visible in
  dev tools instead of silently indistinguishable from a genuinely empty task.
- A test pinning `parentCrumb`'s fallback-reason string as intentionally-dead code, or removing
  it in favour of an assertion that `analyzeParentage` always attaches a `parent` issue when a
  claim is refused (closing the loop between the two independently-written pieces of logic).
- Wiring `task-relations.component.ts`'s origin literals through `TASK_RELATION_GROUP_ORIGIN`
  instead of duplicating them, so the exported map is either load-bearing or removed.

None of these block Batch 3; all are candidates for a fast-follow, not a re-review gate.
