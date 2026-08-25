# Batch 4 Dispatch Brief — TASK_2026_173

**Issued**: 2026-08-10 by team-leader (MODE 2)
**Executor**: `frontend-developer` sub-agent (single, sequential pass)
**Batch**: 4 — Tree & Drag Performance (B3 + B5) — resuming a PARTIAL batch
**Live tasks**: 4.1, 4.2, 4.3, 4.5 — **4.4 is CLOSED, do not touch**
**Task folder**: `D:\projects\ptah-extension\.ptah\specs\TASK_2026_173\`
**Batch commit**: NOT yours. Team-leader commits after `code-logic-reviewer` returns APPROVED.

---

## 0. Read this first — the batch is half-landed and the plan text lies about line numbers

Batch 4 was partially executed out of order. `16da79d2f` (2026-08-03) landed requirement **B5's behavior** but not Task 4.3's **deliverable**. Every line number printed in `tasks.md` Task 4.3's body (`:832-858`, `:879-903`, `:921-949`) predates that commit and **no longer resolves**. The corrected coordinates are in §2 below. Trust this brief over the line numbers embedded in `tasks.md` and `implementation-plan.md`.

Residue re-verified against the working tree on 2026-08-10 by the team-leader (audit, not agent report):

| Task                           | State                                           | Evidence                                                                                                                                                                        |
| ------------------------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4.1 `changedDirPrefixes`       | **NOT STARTED**                                 | Symbol occurs exactly once in the repo, inside a comment: `libs\frontend\editor\src\lib\file-tree\perf-m2-status-update.spec.ts:61`. It is absent from `git-status.service.ts`. |
| 4.2 `hasChangedChildren` O(1)  | **NOT STARTED**                                 | `file-tree-node.component.ts:284-304` still runs the per-node linear scan (`for (const key of this.gitStatus.fileStatusMap().keys())` at `:300`).                               |
| 4.3 `startDragTracking`        | **behavior shipped, extraction NOT done**       | `startDragTracking` does not exist anywhere in `libs/frontend/editor`. The rAF pattern is copy-pasted into three `runOutsideAngular` blocks: `:921`, `:1015`, `:1109`.          |
| 4.4 drag interruption teardown | **CLOSED — out of scope**                       | Shipped under TASK_2026_176 (`e82dc9802`). The blur/Escape/restore paths are live in the file today.                                                                            |
| 4.5 M2 + M4 after-measurements | **NOT STARTED (M2)** / **re-run required (M4)** | `measurements.md:249-263` already carries a B5 after-figure captured 2026-08-03; `measurements.md:252` records the M2 after-figure as still PENDING. See §5.                    |

**Net**: 4.4 ✅ · 4.3 behavior ✅ / extraction ⏸️ · 4.1, 4.2, 4.5 ⏸️.

### Task 4.4 — do NOT re-implement

The blur/Escape interruption teardown is already in the file. You will read `endDrag(restore)`, `_resizeBlurHandler`, `_resizeKeydownHandler` and the `originalHeight`/`originalWidth`/`originalPercent` restore values while doing Task 4.3. **That is finished work from another task.** Preserve it exactly. Adding a second teardown mechanism, or dropping the restore-on-interrupt semantics during the extraction, is a batch failure.

---

## 1. Tasks 4.1 + 4.2 — B3, the directory-indicator scan (NOT STARTED, do these first)

Two edits, one dependency: 4.2 consumes what 4.1 produces. Do 4.1 first.

### Task 4.1 — `changedDirPrefixes` computed in `GitStatusService`

**File**: `D:\projects\ptah-extension\libs\frontend\editor\src\lib\services\git-status.service.ts`
**Where**: beside `fileStatusMap`, which is now at **`:142-153`** (the plan says `:141-152`; it drifted by one line post-C1 — read the file, do not trust the offset).
**Requirement**: B3 AC3, AC4, AC5, AC6.

Shape from the plan (adapt to the real `GitFileStatus` type in the file; verify whether `isDirectory` actually exists on it before using it — if it does not, drop that branch rather than inventing a field):

```ts
readonly changedDirPrefixes = computed<ReadonlySet<string>>(() => {
  const set = new Set<string>();
  for (const f of this._files()) {
    const p = f.path.replace(/\\/g, '/');
    if (f.isDirectory) set.add(p);
    for (let i = p.indexOf('/'); i !== -1; i = p.indexOf('/', i + 1)) set.add(p.slice(0, i));
  }
  return set;
});
```

Notes carried from validation:

- Build cost is O(total path segments), once per status update. `_files` already carries `equal: filesEqual` (`:97`), so the computed only recomputes on a genuine change — do not add your own memoization on top.
- **AC4 (multi-root) holds for free** because `_files()` is already the active workspace's slice. Do not add workspace keys to the set.
- **AC5 (mixed separators): normalize on insert, and reuse the node's existing normalization on lookup.** Windows is the primary development platform here. Both `\` and `/` inputs must produce correct indicators.
- **AC6**: when a file's change is reverted, the next status update must clear the parent dots. A `computed` over `_files()` gives this for free — do not cache the set in a mutable field.

### Task 4.2 — `hasChangedChildren` → O(1) lookup

**File**: `D:\projects\ptah-extension\libs\frontend\editor\src\lib\file-tree\file-tree-node.component.ts`
**Where**: **`:284-304`** (verified current).
**Requirement**: B3 AC1, AC2, AC3, AC5, AC6.

Replace the loop at `:299-303`:

```ts
const dirPrefix = relativeDirPath + '/';
for (const key of this.gitStatus.fileStatusMap().keys()) {
  if (key.startsWith(dirPrefix)) return true;
}
return false;
```

with `this.gitStatus.changedDirPrefixes().has(relativeDirPath)`.

**Keep the existing normalization block at `:285-298` intact** — it already handles the workspace-root strip and the `\`→`/` conversion, and it is what makes AC5 hold on the lookup side. Note the trailing-slash asymmetry: the old code compares `relativeDirPath + '/'` as a _prefix of file keys_; the new set stores directory paths _without_ a trailing slash. Get this boundary right or every indicator is off by one segment.

**AC2** is the load-bearing one: evaluation must be effectively constant-time with respect to the number of changed files. **AC3** requires correctness in both directions — every directory transitively containing a changed file is marked, and no directory without one is marked.

### Specs required for 4.1 + 4.2

- `git-status.service.spec.ts` — `changedDirPrefixes` contents for nested paths, mixed separators, revert-clears-parent (AC6), and that an unrelated workspace's files do not leak in (AC4).
- `file-tree-node.component.spec.ts` — O(1) lookup, mixed separators, both directions of AC3 (marked when it should be, **and not marked when it should not**).
- `perf-m2-status-update.spec.ts` already exists as the M2 harness and carries a regression-guard assertion. Do not weaken its bounds. Its comment at `:61` names `changedDirPrefixes` as the thing it was built to measure — after 4.1/4.2 that comment describes reality; update the tense if it reads as forward-looking.

---

## 2. Task 4.3 — extract `startDragTracking` (USER DECISION: extract, do not accept three copies)

**File**: `D:\projects\ptah-extension\libs\frontend\editor\src\lib\editor-panel\editor-panel.component.ts`

### Corrected coordinates (verified 2026-08-10)

| Element                                             | Line                                                 |
| --------------------------------------------------- | ---------------------------------------------------- |
| `onTerminalResizeStart` → `runOutsideAngular` block | `:915` → `:921-977`                                  |
| `cleanupResizeListeners` (terminal)                 | `:983-1001`                                          |
| `onSidebarResizeStart` → `runOutsideAngular` block  | `:1008` → `:1015-1069`                               |
| `cleanupSidebarResizeListeners`                     | `:1071`                                              |
| `onSplitResizeStart` → `runOutsideAngular` block    | `:1101` → `:1109-1167`                               |
| `cleanupSplitResizeListeners`                       | `:1169`                                              |
| Per-surface listener fields (3 × 4)                 | `:528-531`, `:534-538`, `:541-545`                   |
| Shared `_dragFrame` handle                          | **`:1196`** (`tasks.md` says `:1190`; it is `:1196`) |
| `cancelDragFrame` / `cancelAnimationFrame`          | `:1203-1210` (`cancelAnimationFrame` at `:1207`)     |
| `ngOnDestroy` calling all three cleanups            | `:572-578`                                           |

### Framing — this is a refactor, not an improvement

`16da79d2f` applied the pattern inline three times. B5 **AC1, AC2 and AC5 are already satisfied in behavior**; **AC4 is not** — it was specified to "fall out of having a single implementation", and there are three. The user chose to close AC4 properly rather than accept the duplication.

**The bar: the existing drag specs stay green and layout is bit-identical. Treat any behavioral drift as a failure, not an improvement.** You are folding working code together on a path that currently works. No opportunistic cleanups, no clamp-value "fixes", no changing which element the width binding lands on.

### What to fold and what to keep per-surface

Fold into one private `startDragTracking({ onMove, onCommit, onCancel })` (or an equivalent single implementation — the exact signature is yours provided all three surfaces route through it):

- the `runOutsideAngular` wrapper
- `latestEvent` capture + `if (this._dragFrame === null) this._dragFrame = requestAnimationFrame(applyLatest)`
- the `applyLatest` frame body's shared skeleton (`this._dragFrame = null; const e = latestEvent; if (!e) return; latestEvent = null;`)
- `endDrag(restore)` semantics: `cancelDragFrame()` → restore-or-apply-latest → cleanup listeners
- the four `addEventListener` registrations (`mousemove`/`mouseup` on `document`, `blur` on `window`, `keydown` on `document`) and their symmetric removal
- **the three near-identical listener-field quartets at `:528-545` and the three near-identical cleanup methods (`:983`, `:1071`, `:1169`) — collapsing these is the substance of the de-duplication.** If you extract the frame loop but leave three copies of the listener bookkeeping, AC4 is still not closed.

Keep **per-surface, copied verbatim**:

- the clamping arithmetic — terminal `Math.max(100, Math.min(newHeight, maxHeight))` with `maxHeight` from the `[role="main"]` ancestor × 0.6 (default 600); sidebar `Math.max(160, Math.min(480, newWidth))`; split `Math.max(20, Math.min(80, newPercent))` over `container.clientWidth`
- the delta orientation — terminal is `startY - e.clientY` (inverted); sidebar and split are `e.clientX - startX`
- the setter each surface calls, and the restore value each captures at mousedown (`originalHeight` / `originalWidth` / `originalPercent`)
- the split surface's early `if (!container) return;` guard before any listener is attached

Keep intact:

- the shared `_dragFrame` field and `cancelDragFrame()` — its doc comment at `:1189-1195` explains why one handle is correct (single pointer, one drag at a time). That reasoning survives the extraction.
- `ngOnDestroy`'s teardown. If three cleanup methods become one, update `:575-577` accordingly and make sure destroy-during-drag still cancels the armed frame.
- **all TASK_2026_176 behavior**: blur restores and ends the drag; `Escape` calls `preventDefault()` then restores and ends the drag; mouseup commits the release position.

### B5 acceptance criteria (verbatim, `task-description.md:203-209`)

1. GIVEN a pane splitter is being dragged, WHEN pointer movement occurs, THEN change detection SHALL run at most once per animation frame, not once per pointer event. Verification per M4.
2. GIVEN a drag is in progress, WHEN the user releases, THEN the final pane size SHALL exactly match the release position — coalescing SHALL NOT lose the last update.
3. GIVEN a drag is interrupted (pointer leaves the window, ESC, window blur), WHEN the drag ends, THEN no stray listener or pending frame callback SHALL remain.
4. GIVEN all three drag surfaces in the editor panel, WHEN each is exercised, THEN all three SHALL behave per AC1–AC3.
5. GIVEN a drag is performed, WHEN it completes, THEN the resulting layout SHALL be visually identical to current behaviour — this is a performance fix with no intended UX change.

AC2 remains the subtle one: mouseup must cancel the pending frame **and** apply the final value synchronously.

### The regression net you must not break

`editor-panel.component.spec.ts:283-585` — `describe('EditorPanelComponent — resize drags coalesce to one update per frame (B5)')`, 11 specs:

`:391` one frame per burst (sidebar) · `:419` mouseup cancels frame and applies release position · `:440` 160/480 clamp preserved · `:453` frame cancelled on destroy · `:467` terminal coalesces · `:485` split coalesces · `:509` blur restores sidebar width · `:525` Escape restores sidebar width · `:539` blur restores terminal height · `:559` Escape restores split percentage.

All eleven must pass **unmodified**. If a spec reaches into a private field you renamed, prefer keeping the field name over editing the spec; if you must adjust a spec, say so explicitly in your report with the reason — a silently edited assertion in a "no behavior change" refactor is a review rejection.

---

## 3. Batch 4 Acceptance Criteria (verbatim from `tasks.md:614-620`)

- B3 AC1–AC6; **M2 target met or shortfall flagged**; mixed-separator correctness proven on Windows
- B5 AC1–AC5; **M4 target met or shortfall flagged**; layout visually identical to before
- Updated `git-status.service.spec.ts` (`changedDirPrefixes`), `file-tree-node.component.spec.ts` (O(1) + mixed separators), `editor-panel.component.spec.ts` (drag coalescing)
- `measurements.md` carries M2 and M4 after-figures with median + max
- Standing gates 1–7 pass

### B3 acceptance criteria (verbatim, `task-description.md:178-185`)

1. GIVEN ≥300 changed files and ≥100 expanded directory nodes, WHEN a `git:status-update` arrives, THEN handling SHALL meet target M2.
2. GIVEN any number of changed files, WHEN a single directory node evaluates whether it has changed children, THEN that evaluation SHALL be effectively constant-time with respect to the number of changed files.
3. GIVEN a git status update, WHEN it is processed, THEN directory indicator dots SHALL be correct — every directory that transitively contains a changed file SHALL be marked, and no directory without one SHALL be marked.
4. GIVEN a multi-root workspace, WHEN a status update arrives for one workspace, THEN indicators for other workspaces SHALL NOT be affected.
5. GIVEN paths with mixed separators (Windows `\` and POSIX `/`), WHEN indicators are computed, THEN they SHALL be correct on both. Windows is the primary development platform for this project.
6. GIVEN a file's change is reverted, WHEN the next status update arrives, THEN the parent directory indicators SHALL clear.

---

## 4. Task 4.5 — M2 and M4 after-measurements

**Artifact**: `D:\projects\ptah-extension\.ptah\specs\TASK_2026_173\measurements.md`
**Requirement**: B0 AC1–AC4.

### M2 — genuinely missing, capture it

- **Baseline to beat**: median **3.034 ms**, max **5.161 ms**, 10 iterations (`measurements.md:146-147`).
- **Harness**: `libs\frontend\editor\src\lib\file-tree\perf-m2-status-update.spec.ts`.
- **Run**: `npx nx test @ptah-extension/editor --testPathPatterns=perf-m2-status-update`
- **Same workload, same machine, same method** — 300 `GitFileStatus` entries × 100 real `FileTreeNodeComponent` fixtures, 10 iterations, median + max, samples listed.
- **Target**: median ≥80% below baseline, **AND cost must not grow multiplicatively with (directories × changed files)**. The second half is the real B3 claim; a single median is not evidence for it. Demonstrate the scaling property (for example, a second sample point at a larger directory count showing the growth is not multiplicative) or state plainly that you did not.
- The Electron spot-check (`perf-m2-electron-spotcheck.spec.ts`) is confirmation only, never the reported figure — the B0 AC5 deviation is already documented at `measurements.md:155-165`; do not re-litigate it, just stay consistent with it.

### M4 — an after-figure already exists; re-run to prove the refactor did not drift

`measurements.md:249-274` already records a B5 after-figure from `16da79d2f`. Your extraction must not move it.

- **Harness**: `apps\ptah-electron-e2e\src\specs\editor\perf-m4-drag-cd.spec.ts`
- **Run**: `npx nx e2e ptah-electron-e2e -- editor/perf-m4-drag-cd.spec.ts`
- **Target**: ≤1 CD pass per animation frame; median ≥50% below baseline (baseline: style-mutations median 121, max 223 over 5 × 2 s runs).
- Read the FINDING at `measurements.md:218-247` before interpreting your numbers: this harness structurally under-represents the pathology, so **the criterion actually met is the ratio (no run exceeding its own frame count), not a large absolute drop.** Do not claim an absolute drop the harness cannot support.
- Record the post-extraction run as a distinct row/section labelled as the post-`startDragTracking` confirmation, alongside the existing 2026-08-03 figures. Do not overwrite the existing rows.

**B0 AC4 governs the whole of 4.5: any shortfall is flagged explicitly, never reported as a pass.** An honest "target missed, here is why" is an acceptable outcome; a massaged number is not. If the Electron e2e cannot run in your environment, say so and stop — do not synthesize a figure.

---

## 5. Standing gates (all seven apply, `tasks.md:74-92`)

1. **NFR-1 cross-project test invariant** — `nx test ptah-electron` ≥135 passed / ≤4 skipped **AND** `nx test rpc-handlers` ≥1410 passed / ≤2 skipped; the **sum must never decrease** (floor 1545). Converting a failing test to skipped is a regression, not a fix. Batch 4 touches neither project's sources, so both should be untouched — run them anyway.
2. **Typecheck** — `nx typecheck` clean for every changed project.
3. **Lint, standalone per project** — `nx lint @ptah-extension/editor` individually. Do **not** rely on a batched `nx run-many -t lint`; a `run-many` under parallel load previously masked a real `@nx/dependency-checks` error in this repo.
4. **Affected unit tests** — `nx test @ptah-extension/editor`, plus `nx test ptah-extension-webview` if anything you touch is re-exported through it.
5. **Three-runtime build** — not required: Batch 4 touches neither `libs/shared` nor `libs/backend`.
6. **Scope discipline (NFR-9)** — see §6.
7. **NFR-2** — `ChangeDetectionStrategy.OnPush` on every component touched; signals + `inject()`; new state workspace-partitioned.

### Pre-existing failure you must NOT chase

`nx affected --target=lint` currently **FAILS on this branch** because of concurrent in-progress work for TASK_2026_177 in `apps/ptah-license-server/**`, `libs/api/**`, `libs/api-contracts/**` and `tsconfig.base.json`. **That failure is pre-existing and is not Batch 4's to fix.** Run `nx lint @ptah-extension/editor` scoped, not `affected`. If you see lint or type errors originating outside `libs/frontend/editor/**`, report them and move on — per NFR-9, failures outside this task's scope are reported, never fixed opportunistically.

---

## 6. Scope and concurrency constraints — hard

- The repo is on branch `ak/license-server-validation-pipe` and **another session is concurrently editing** `apps/ptah-license-server/**`, `libs/api/**`, `libs/api-contracts/**` and `tsconfig.base.json`. Batch 4 is file-disjoint from that work.
- **Touch only** `libs\frontend\editor\**` and `.ptah\specs\TASK_2026_173\**`.
- **Do NOT** run `git add -A`, `git add .`, `git commit`, `git stash`, `git checkout --`, `git restore`, or any repo-wide formatter. **You do not commit at all** — the team-leader stages and commits after review. Staging or reverting anything outside your scope will destroy another session's work.
- `--no-verify` is forbidden.
- Use complete absolute Windows paths for every Read/Write.
- Four files are the expected footprint plus specs:
  - `libs\frontend\editor\src\lib\services\git-status.service.ts`
  - `libs\frontend\editor\src\lib\file-tree\file-tree-node.component.ts`
  - `libs\frontend\editor\src\lib\editor-panel\editor-panel.component.ts`
  - `.ptah\specs\TASK_2026_173\measurements.md`
  - specs: `git-status.service.spec.ts`, `file-tree-node.component.spec.ts`, `editor-panel.component.spec.ts`, and the tense fix in `perf-m2-status-update.spec.ts`

---

## 7. Order of work

1. **4.1** — `changedDirPrefixes` in `GitStatusService` + its spec.
2. **4.2** — `hasChangedChildren` O(1) + its spec. (Depends on 4.1.)
3. **4.3** — extract `startDragTracking`; the 11 existing drag specs must pass unmodified.
4. Run gates 1–4 and 7.
5. **4.5** — M2 after-figure (new) and M4 re-run (drift check); write both into `measurements.md` with median + max + samples + method.
6. Mark Tasks 4.1, 4.2, 4.3, 4.5 in `tasks.md` as `🔄 IMPLEMENTED` — `Edit` the individual status lines only. **Never `Write` `tasks.md`; it is ~970 lines and holds nine batches.**

## 8. Return format

```
BATCH 4 IMPLEMENTATION COMPLETE (tasks 4.1, 4.2, 4.3, 4.5)

- Files created/modified: [absolute paths]
- Tasks marked 🔄 IMPLEMENTED in tasks.md: 4.1, 4.2, 4.3, 4.5
- B3 AC1-AC6: [how each is satisfied / evidence]
- B5 AC1-AC5: [AC4 now closed by extraction; AC1/2/3/5 preserved unchanged]
- Drag specs: 11/11 passing, unmodified [or: list every spec you changed and why]
- M2 after: median X ms, max Y ms vs baseline 3.034 / 5.161 — target met | SHORTFALL: <reason>
- M4 after: mutations median X, max Y vs baseline 121 / 223 — no drift | DRIFT: <reason>
- Gates: nx lint @ptah-extension/editor [pass], nx typecheck [pass], nx test @ptah-extension/editor [n passed],
  nx test ptah-electron [n passed], nx test rpc-handlers [n passed]
- Out-of-scope failures observed and NOT fixed: [list, or "none"]
- No git operations performed.
```

Do not create a summary `.md` report file. Return the report as your final message.

---

## 9. What happens next (for the orchestrator, not the executor)

On return: team-leader verifies files → returns `NEEDS REVIEW` → orchestrator spawns `code-logic-reviewer` → verdict returns to team-leader → APPROVED means team-leader stages **only** `libs/frontend/editor/**` and the task folder and commits → Batch 5.

**Batch 5 is already unblocked.** Task 5.0's decision gate is RESOLVED as **Option B** (two named sets behind one shared predicate, `TREE_HIDDEN_DIRS ⊆ WATCH_IGNORED_DIRS`; the file tree keeps showing `node_modules` and `dist`). Recorded in `tasks.md` under Task 5.0. Do not re-open it. Batch 5's recommended executor is `backend-developer`, sequential.

**CLI agent delegation is DISABLED for this entire task** (user decision, Checkpoint 0.1, `tasks.md:7`). Sub-agents only, for every remaining batch.
