# Batch 4 Implementation Report — TASK_2026_173

**Executor**: `frontend-developer` sub-agent
**Date**: 2026-08-10
**Batch**: 4 — Tree & Drag Performance (B3 + B5), tasks 4.1, 4.2, 4.3, 4.5
**Verdict headline**: All four tasks implemented; B3 and B5 acceptance criteria met;
**the M2 performance target is MISSED and flagged, not rounded up** (B0 AC4).
**No git operations performed.**

---

## 1. Files created / modified (absolute paths)

Product code:

- `D:\projects\ptah-extension\libs\frontend\editor\src\lib\services\git-status.service.ts` — Task 4.1
- `D:\projects\ptah-extension\libs\frontend\editor\src\lib\file-tree\file-tree-node.component.ts` — Task 4.2
- `D:\projects\ptah-extension\libs\frontend\editor\src\lib\editor-panel\editor-panel.component.ts` — Task 4.3

Specs:

- `D:\projects\ptah-extension\libs\frontend\editor\src\lib\services\git-status.service.spec.ts` — added `describe('GitStatusService.changedDirPrefixes (B3)')`, 7 specs
- `D:\projects\ptah-extension\libs\frontend\editor\src\lib\file-tree\file-tree-node.component.spec.ts` — added `changedDirPrefixes` to the `GitStatusService` stub + `describe('hasChangedChildren (B3)')`, 7 specs
- `D:\projects\ptah-extension\libs\frontend\editor\src\lib\file-tree\perf-m2-status-update.spec.ts` — comment tense fix only, no code, bounds untouched
- `D:\projects\ptah-extension\libs\frontend\editor\src\lib\file-tree\perf-m2-indicator-scaling.spec.ts` — **NEW** (see §6, deviation from the brief's expected footprint, deliberately flagged)

Task folder:

- `D:\projects\ptah-extension\.ptah\specs\TASK_2026_173\measurements.md` — M2 after-figure + scaling evidence + M4 post-extraction rows
- `D:\projects\ptah-extension\.ptah\specs\TASK_2026_173\tasks.md` — four status lines edited individually (never rewritten)
- `D:\projects\ptah-extension\.ptah\specs\TASK_2026_173\batch-4-report.md` — this file

**NOT modified**: `editor-panel.component.spec.ts`. The 10 existing drag specs pass
untouched across the Task 4.3 refactor, which is the strongest available evidence
that the extraction is behavior-preserving.

Tasks marked `🔄 IMPLEMENTED` in `tasks.md`: **4.1, 4.2, 4.3, 4.5**.

---

## 2. Task 4.1 — `changedDirPrefixes`

Added beside `fileStatusMap` in `GitStatusService` (the symbol is now at
`git-status.service.ts:155-190`; `fileStatusMap` was at `:142-153` as the brief
predicted). Implementation follows the plan's shape with three adaptations, each
justified below.

```ts
readonly changedDirPrefixes = computed<ReadonlySet<string>>(() => {
  const prefixes = new Set<string>();
  for (const file of this._files()) {
    let path = file.path.replace(/\\/g, '/');
    while (path.endsWith('/')) path = path.slice(0, -1);
    if (!path) continue;
    if (file.isDirectory) prefixes.add(path);
    for (let i = path.indexOf('/'); i !== -1; i = path.indexOf('/', i + 1)) {
      if (i > 0) prefixes.add(path.slice(0, i));
    }
  }
  return prefixes;
});
```

Adaptations vs the plan snippet:

1. **`isDirectory` branch KEPT.** The brief said to verify the field exists before
   using it. It does: `GitFileStatus.isDirectory?: boolean`
   (`libs\shared\src\lib\types\rpc\rpc-git.types.ts:14`), set by
   `libs\backend\vscode-core\src\services\git-info.service.ts:1434-1440` for an
   untracked directory, which git reports as ONE entry with the trailing slash
   already stripped. See §7 for the one intentional behavior delta this creates.
2. **Trailing-slash strip added.** `git-info.service.ts` strips it, but the strip
   lives in one parser and the set's contract ("stored without a trailing slash")
   should not depend on that. One `while` loop makes a `src/newdir/` payload land
   in the same bucket as `src/newdir`. Covered by a spec.
3. **`if (i > 0)` guard added** so a leading-slash path could never insert `''`
   into the set (an empty entry is unreachable from any node lookup, but an empty
   string in a "directory has changes" set is a trap for a future reader).

No memoization added on top — `_files` already carries `equal: filesEqual`
(`:97`), and a spec asserts the computed hands back the **same set instance** for
a byte-identical payload.

---

## 3. Task 4.2 — `hasChangedChildren` → O(1)

`file-tree-node.component.ts`: the normalization block (workspace-root strip +
`\`→`/`) is **unchanged**; only the final scan was replaced.

```ts
// before
const dirPrefix = relativeDirPath + '/';
for (const key of this.gitStatus.fileStatusMap().keys()) {
  if (key.startsWith(dirPrefix)) return true;
}
return false;

// after
return this.gitStatus.changedDirPrefixes().has(relativeDirPath);
```

The trailing-slash asymmetry the brief warned about is handled: the old code
matched `relativeDirPath + '/'` as a _prefix of file keys_, the set stores
directory paths _without_ a trailing slash, so the lookup uses the bare
`relativeDirPath`. A spec pins the off-by-one-segment failure mode directly
(`src/app` in the set must not light up `src/app-legacy`).

---

## 4. B3 acceptance criteria — how each is satisfied

| AC                                                                   | Status                 | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC1** — ≥300 files + ≥100 nodes meets M2                           | **SHORTFALL, FLAGGED** | `perf-m2-status-update.spec.ts`, 3 executions: median 2.605 / 3.512 / 3.658 ms vs baseline 3.034. Target (≥80% below = ≤0.607 ms) **missed**. Full analysis in §8 and in `measurements.md`.                                                                                                                                                                                                                                            |
| **AC2** — evaluation effectively constant-time in changed-file count | **PASS**               | Two independent proofs. Structural: `file-tree-node.component.spec.ts` "evaluates in constant time" — with 50,000 prefix entries and 50,000 status-map entries, evaluation makes **exactly one `Set.has('src/app')` and zero `fileStatusMap.keys()` calls** (both spied). Empirical: `perf-m2-indicator-scaling.spec.ts` — 10x more changed files gives **0.82x / 0.66x** cost (flat), asserted `< 3x`.                                |
| **AC3** — correct in BOTH directions                                 | **PASS**               | Positive: ancestors of `src/a/b/c.ts` are exactly `src`, `src/a`, `src/a/b`; node `src/app` is marked when present. Negative: file paths are never added; a root-level file adds nothing; `src/app-legacy` is not marked by `src/app`; `vendor` (absent) is not marked; a file node never returns true. The scaling probe additionally asserts exactly 50 of its 100 directories are marked, over the same data the timings came from. |
| **AC4** — multi-root isolation                                       | **PASS**               | Holds structurally: the computed derives from `_files()`, which `applyGitInfo` only writes when the payload's `workspaceRoot` matches the active workspace. Spec: a push for `/ws/b` while `/ws/a` is active leaves the active set byte-identical and does not introduce `other`. No workspace keys were added to the set.                                                                                                             |
| **AC5** — mixed separators, Windows primary                          | **PASS**               | Insert side: `src\win\deep\file.ts` produces `src`, `src/win`, `src/win/deep`, and no entry contains a `\`. Lookup side: node path `C:\ws\src\app` resolves against workspace root `C:/ws` and matches `src/app`. Both directions specced.                                                                                                                                                                                             |
| **AC6** — revert clears parent dots                                  | **PASS**               | Spec: push `src/a/b/c.ts` (set has `src/a`), then push `[]` → set size 0. Free from `computed` semantics; nothing is cached in a mutable field.                                                                                                                                                                                                                                                                                        |

---

## 5. Task 4.3 — `startDragTracking` extraction

### What was folded

One private generic method now owns the entire drag loop:

```ts
private startDragTracking<T>(surface: {
  readonly original: T;                    // restored on blur / Escape
  compute: (event: MouseEvent) => T;       // pointer -> value; runs OUTSIDE the zone
  commit: (value: T) => void;              // runs INSIDE the zone
}): void
```

Folded into it (previously 3 copies each): the `runOutsideAngular` wrapper,
`latestEvent` capture + frame arming, the `applyLatest` skeleton, `endDrag`
semantics, all four `addEventListener` registrations and their symmetric removal.

**The listener bookkeeping was collapsed too** — the brief called this "the
substance of the de-duplication":

- 3 × 4 listener fields (`:528-545`) → **one quartet** (`_dragMouseMove`,
  `_dragMouseUp`, `_dragBlur`, `_dragKeydown`).
- 3 cleanup methods (`cleanupResizeListeners`, `cleanupSidebarResizeListeners`,
  `cleanupSplitResizeListeners`) → **one** `cleanupDragListeners()`.
- `ngOnDestroy` now calls that one method (was three calls).

The three drag block bodies went from ~285 lines to ~175 including the new
doc comments; the duplicated logic itself went 3 copies → 1.

### What stayed per-surface, copied verbatim

- Terminal: `startY - e.clientY` (inverted), `maxHeight` from the `[role="main"]`
  ancestor × 0.6 with a 600 default, `Math.max(100, Math.min(newHeight, maxHeight))`.
  The `(event.target as HTMLElement).closest('[role="main"]')` lookup still happens
  **inside** the per-frame computation, exactly as before — the mousedown `event`
  is captured by the closure, not pre-resolved.
- Sidebar: `e.clientX - startX`, `Math.max(160, Math.min(480, newWidth))`.
- Split: `e.clientX - startX`, `(deltaX / containerWidth) * 100`,
  `Math.max(20, Math.min(80, newPercent))`, and the early
  `if (!container) return;` guard **before** any listener is attached.
- Each surface's restore value (`originalHeight` / `originalWidth` /
  `originalPercent`) is now the `original` field; each surface's setter is `commit`.

`compute` runs outside the zone and only `commit` re-enters it, which preserves
the original placement of the arithmetic relative to `ngZone.run()` exactly.

### What stayed intact

- The shared `_dragFrame` handle and `cancelDragFrame()`, with their doc comment
  reasoning (single pointer, one drag at a time) — that reasoning now also
  justifies the single listener quartet, and the field comment says so.
- **All TASK_2026_176 behavior, untouched and NOT re-implemented**: `blur`
  restores and ends the drag; `Escape` calls `preventDefault()` then restores and
  ends the drag; `mouseup` commits the release position. Restore is expressed as
  `commit(original)`, which is the same call the old code made
  (`setTerminalHeight(originalHeight)` / `sidebarWidth.set(originalWidth)` /
  `splitLeftPercent.set(originalPercent)`). No second teardown mechanism exists.
- Destroy-during-drag still cancels the armed frame: `cleanupDragListeners()`
  begins with `cancelDragFrame()`, and `ngOnDestroy` calls it unconditionally.

### One added line, called out for review

`startDragTracking` begins with a defensive `this.cleanupDragListeners()`. With
three separate field quartets an unexpected second `mousedown` could only leak
one surface's listeners; with a single shared quartet it would orphan them
entirely. In every reachable flow the previous drag has already torn itself down,
so this is a no-op at runtime (no armed frame, all four fields `null`) — it is
insurance for the consolidation, not a behavior change. It is the only
non-mechanical addition in the whole task.

### B5 acceptance criteria

| AC                                                           | Status                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC1** — ≤1 CD pass per animation frame                     | **PASS, preserved.** Single `requestAnimationFrame` arm; verified by spec (`rafSpy` called once for a 4-event burst) and by M4 (§9).                                                                                                                                        |
| **AC2** — release position never lost                        | **PASS, preserved.** `endDrag(false)` calls `cancelDragFrame()` **and then** `applyLatest()` synchronously. Spec `:419` pins it: after `moveTo(150); moveTo(190); releaseMouse()`, `cancelAnimationFrame` fired, `frames.size === 0`, and width is 346 (= 256 + 190 − 100). |
| **AC3** — no stray listener or pending frame on interruption | **PASS, preserved.** Every exit path routes through the one `cleanupDragListeners()`, which cancels the frame and removes all four listeners. Specs `:453`, `:509`, `:525`, `:539`, `:559`.                                                                                 |
| **AC4** — all three surfaces behave per AC1–AC3              | **NOW CLOSED BY CONSTRUCTION.** This was the one unmet criterion. There is exactly one implementation; the three call sites supply only clamp arithmetic and a setter. It can no longer be true of one surface and false of another.                                        |
| **AC5** — layout visually identical                          | **PASS.** Clamp arithmetic, delta orientation, setters, and the elements the bindings land on are byte-identical; only the loop around them moved. The 10 existing drag specs, including the 160/480 clamp assertion, pass **unmodified**.                                  |

### Drag specs: 10/10 passing, file unmodified

`npx nx test @ptah-extension/editor --testPathPatterns=editor-panel.component`
→ **15 passed** (10 in the B5 describe + 5 in the N1/B1 describe). Zero spec
files in `editor-panel/` were edited — confirmed by `git status`.

**Discrepancy against the brief, reported not forced**: the brief says "11
specs" and then lists 10 line numbers (`:391, :419, :440, :453, :467, :485,
:509, :525, :539, :559`). The file contains **10** `it()` blocks in that
`describe` (counted mechanically). The count of 11 appears to be an off-by-one
in the brief; every listed spec exists and passes. `measurements.md:286` also
said "6 tests", written before TASK_2026_176 folded the four interruption specs
in; I corrected that number to 10 while writing the M4 section.

---

## 6. Deviation from the expected footprint — one new spec file

The brief listed four product files plus named specs. I added a fifth spec file:

`libs\frontend\editor\src\lib\file-tree\perf-m2-indicator-scaling.spec.ts`

**Why it was necessary.** The brief's M2 requirement has two halves: a median,
**and** "cost must not grow multiplicatively with (directories × changed files)
— the second half is the real B3 claim; a single median is not evidence for it.
Demonstrate the scaling property … or state plainly that you did not." The
existing M2 harness measures one workload size and cannot demonstrate scaling.
Adding a second `it` to it would have forced every run through its 100-fixture
`beforeEach`, which is irrelevant to the probe and would have muddied the
harness that reports the headline figure. A separate, clearly-labelled file
keeps the reported harness clean.

It is inside `libs/frontend/editor/**`, adds no product code, and does not touch
`perf-m2-status-update.spec.ts`'s bounds (which remain 500 ms / 1000 ms —
**not** tightened; only its stale forward-looking comment was updated to past
tense, as the brief asked).

---

## 7. Intentional behavior delta in B3 — one, disclosed

**Untracked directories are now marked with a "contains changes" dot.**

Git reports an untracked directory as a single entry (`src/newdir`,
`isDirectory: true`) rather than listing the files inside it. Under the old
scan, node `src/newdir` compared key `src/newdir` against prefix `src/newdir/`
→ no match → no dot. With the `isDirectory` branch the directory is added in its
own right → dot.

- **Why kept**: B3 AC3 says "every directory that transitively contains a changed
  file SHALL be marked". An untracked directory does contain changed (untracked)
  files — git just does not enumerate them. The plan prescribed this branch, and
  the brief's only stated condition for dropping it (field does not exist) is not
  met.
- **Visible consequence**: such a node already renders a `U` badge from
  `nodeGitStatus()`; it will now render the badge **and** the warning dot. Both
  use `ml-auto`, so they sit adjacent. This is the only visual change in B3.
- **Reviewer's call**: if this is judged undesirable, deleting the single line
  `if (file.isDirectory) prefixes.add(path);` reverts it exactly, and the spec
  "marks an untracked directory entry in its own right (AC3)" is the one that
  would need to change. Flagging rather than deciding unilaterally.

Everything else in B3 is behavior-identical to the old scan for
file-derived paths.

---

## 8. Task 4.5 — M2 after-figure: TARGET MISSED (B0 AC4 flag)

**Reported (Jest, same harness / workload / method / machine as the baseline):**

| Execution                 | median (ms) | max (ms) |
| ------------------------- | ----------- | -------- |
| **Baseline (2026-08-03)** | **3.034**   | 5.161    |
| After, execution 1        | **2.605**   | 5.265    |
| After, execution 2        | **3.512**   | 7.236    |
| After, execution 3        | **3.658**   | 7.725    |

Samples for all three executions are recorded in `measurements.md`.

**Target**: median ≥80% below baseline → ≤ **0.607 ms**.
**Result**: 2.605 / 3.512 / 3.658 ms — between **14% below** and **21% above**
baseline. **MISSED, by roughly 4–6x.** The three executions straddle the
baseline, so the honest statement is that **this harness shows no measurable
change at all**. Nothing here is rounded up into a pass.

**Why (diagnosis, not excuse):**

1. The harness total is dominated by Angular change detection across 100
   `FileTreeNodeComponent` fixtures. At 300 files × 10 directory nodes, the scan
   that B3 removed is ~3,000 `startsWith` calls — a fraction of a millisecond
   inside a ~3 ms budget. An asymptotic fix cannot move a median whose cost lives
   elsewhere.
2. The 80% target was set against the wrong cost model. B3's actual claim is
   AC2 (constant-time per node) plus no multiplicative growth — properties a
   single median at one workload size cannot evidence in either direction.
3. Machine noise exceeded the effect: a concurrent TASK_2026_177 build/lint
   session was live on this branch throughout, and executions 1 and 3 differ by
   40% on identical code.

**The scaling property WAS demonstrated** (the brief's alternative to stating I
did not). With directory count held constant and changed files grown 10x
(300 → 3000):

|                                                         | 300 files        | 3000 files       | growth                   |
| ------------------------------------------------------- | ---------------- | ---------------- | ------------------------ |
| **Shipped** (`changedDirPrefixes().has`)                | 0.891 / 0.925 ms | 0.730 / 0.608 ms | **0.82x / 0.66x — flat** |
| **Reference** (pre-B3 scan, re-implemented in the spec) | 36.8 / 86.0 ms   | 141.8 / 183.8 ms | 3.86x / 2.14x            |

(100 directories × 50 passes; two executions; warm-up passes included — without
them the first measurement runs interpreted and the second JIT-optimized, which
alone moved the reference figure ~6x and would have understated the very growth
the probe exists to show.)

The multiplicative term is gone: shipped cost does not respond to file count,
and is ~194x cheaper in absolute terms at the larger workload. **Honest caveat**:
the reference column grows 2.1–3.9x for 10x files, not 10x — fixed per-directory
`Map.keys()` iterator overhead dominates at 300 files and damps the ratio. A
clean 10x on the reference is not claimed.

**Electron spot-check**: not re-run. It is confirmation-only per the existing
B0 AC5 deviation at `measurements.md:155-165`, which I did not re-litigate.

---

## 9. Task 4.5 — M4 re-run: NO DRIFT

`npx nx e2e ptah-electron-e2e -- editor/perf-m4-drag-cd.spec.ts`, run twice
post-extraction. Recorded as new rows alongside the 2026-08-03 figures; nothing
was overwritten.

| Run                           | mutations median | mutations max | frames median | frames max |
| ----------------------------- | ---------------- | ------------- | ------------- | ---------- |
| Baseline                      | 121              | **223**       | 121           | 122        |
| After (rAF) 2026-08-03 exec 1 | 63               | 76            | 123           | 123        |
| After (rAF) 2026-08-03 exec 2 | 101              | 118           | 121           | 122        |
| **Post-extraction exec 1**    | 120              | 121           | 121           | 121        |
| **Post-extraction exec 2**    | 120              | 121           | 121           | 121        |

Per the FINDING at `measurements.md:218-247`, the criterion this harness can
support is the **ratio**, not an absolute drop:

- **No run exceeded its own frame count in either execution** (worst pairing
  121 vs 121 = 1.00x). The baseline's signature — 223 vs 122 (1.83x) and 218 vs
  120 (1.82x) on 2 of 5 runs — remains absent. B5 AC1 holds after the refactor.
- Max collapsed 223 → 121; spread (max − median) is 1 versus 102 at baseline.

**Flagged honestly**: the absolute median (120) is higher than the 2026-08-03
after-figures (63 and 101) and equal to the baseline median (121). This is not
presented as an improvement and was not tuned away. Reading, consistent with the
variance already documented in that section: under coalescing the mutation count
is _capped_ at one per frame, so 120 mutations across 121 frames is the ceiling
of correct behavior — these two runs spent almost none of the 2 s window
saturated against the 480 px clamp (a saturated write is a no-op and emits no
mutation, which is what produced the lower August medians). The two executions
being near-identical (120/121 both times) supports a saturation-timing
explanation rather than a change in update frequency. **What would indicate real
drift — a run writing more often than once per frame — does not occur.**
No absolute drop the harness cannot support is claimed.

---

## 10. Gates

| Gate                         | Command                                                    | Result                                                                                                                                                                                                                                               |
| ---------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3. Lint (scoped, standalone) | `npx nx run @ptah-extension/editor:lint --max-warnings=-1` | **PASS** — 0 errors, 14 warnings, **all pre-existing** and none in a file I touched (they are in `branch-picker-dropdown.component.spec.ts`, `code-editor.component.spec.ts`, `git-status-bar.component.ts`, `editor-workspace.spec.ts`).            |
| 2. Typecheck                 | `npx nx run @ptah-extension/editor:typecheck`              | **PASS**                                                                                                                                                                                                                                             |
| 4. Unit tests (editor)       | `npx nx test @ptah-extension/editor --skip-nx-cache`       | **PASS — 192 passed / 192, 14 suites** (was 191 / 13 before; +14 new B3 specs, +1 scaling spec, and the perf-m2 harness still counts as 1)                                                                                                           |
| 4. Unit tests (webview)      | `npx nx test ptah-extension-webview`                       | **PASS — 25 passed / 25** (run because `GitStatusService` is re-exported through the editor lib's public API)                                                                                                                                        |
| 1. NFR-1 (ptah-electron)     | `npx nx test ptah-electron`                                | **PASS — 142 passed, 4 skipped** (floor: ≥135 passed / ≤4 skipped)                                                                                                                                                                                   |
| 1. NFR-1 (rpc-handlers)      | `npx nx test rpc-handlers`                                 | **1718 passed, 31 skipped** — passed-count far above the ≥1410 floor; **skipped-count of 31 exceeds the gate's "≤2 skipped"**. See §11.                                                                                                              |
| 1. NFR-1 (sum)               | —                                                          | **1860** vs floor 1545 — **PASS**, did not decrease.                                                                                                                                                                                                 |
| 5. Three-runtime build       | —                                                          | **N/A** per the brief: Batch 4 touches neither `libs/shared` nor `libs/backend`.                                                                                                                                                                     |
| 6. Scope discipline (NFR-9)  | `git status --porcelain`                                   | **PASS** — my changes are confined to `libs/frontend/editor/**` (6 modified + 1 new) and `.ptah/specs/TASK_2026_173/**`.                                                                                                                             |
| 7. NFR-2                     | code review                                                | **PASS** — both touched components keep `ChangeDetectionStrategy.OnPush`; signals + `inject()` throughout; the new `changedDirPrefixes` state derives from `_files()`, which is already workspace-partitioned, so no new state escapes partitioning. |

`nx affected --target=lint` was **not** run, per the brief — it fails on this
branch from concurrent TASK_2026_177 work, which is not Batch 4's to fix.

---

## 11. Out-of-scope observations — reported, NOT fixed

1. **`rpc-handlers` reports 31 skipped tests, against a stated gate of "≤2
   skipped".** I made no changes anywhere in `libs/backend/**` (confirmed by
   `git status`), so this is pre-existing on `ak/license-server-validation-pipe`
   — either drift since the gate figure was written, or a stale figure. The
   passed-count (1718) and the cross-project sum (1860) are both comfortably
   above their floors, and nothing was converted from failing to skipped by me.
   Per NFR-9 I report and move on.
2. **Both `nx test ptah-electron` and `nx test rpc-handlers` print "A worker
   process has failed to exit gracefully"** — pre-existing teardown leaks in
   those suites, unrelated to this batch.
3. **The brief's "11 specs" for the B5 describe is 10** in the actual file
   (§5). The brief itself lists only 10 line numbers.
4. **`measurements.md:286` claimed the B5 describe had "6 tests"** — written
   before TASK_2026_176 added four interruption specs. Corrected to 10 while
   editing the adjacent M4 section; this is inside my task folder, not code.

---

## 12. Git

**No git operations were performed.** No `add`, `commit`, `stash`, `checkout`,
`reset`, or `restore`. All work is left in the working tree for the team-leader
to stage after `code-logic-reviewer` returns a verdict. A temporary log file I
created while capturing M4 (`.m4-run.log`) was deleted; nothing else was added
to the task folder beyond `batch-4-report.md` and the two edited documents.
No CLI agent delegation was used (disabled for this task).
