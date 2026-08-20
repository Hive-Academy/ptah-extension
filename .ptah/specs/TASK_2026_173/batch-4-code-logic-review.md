# Code Logic Review — Batch 4, TASK_2026_173

## Review Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall Score       | 8/10     |
| Assessment          | APPROVED |
| Critical Issues     | 0        |
| Serious Issues      | 0        |
| Moderate Issues     | 2        |
| Failure Modes Found | 4        |

This review does not take the executor's report at face value. Every product-code claim was checked against `git diff` of the actual working tree, not the report's prose, and the drag/tree/service specs were re-run live (not assumed green from the report). All claims below were independently reproduced.

## Verification method

- Read `git-status.service.ts`, `file-tree-node.component.ts`, `editor-panel.component.ts` in full.
- Ran `git diff` on all three files against HEAD to see exactly what changed, line by line — not just the report's excerpts.
- Ran the actual test suites live:
  - `nx test @ptah-extension/editor --testPathPatterns=editor-panel.component` → **15/15 passed**, confirming the 10 B5 drag specs + 5 N1/B1 specs pass **unmodified** (the spec file has zero diff — `git status` confirms it isn't even in the changed-files list).
  - `nx test @ptah-extension/editor --testPathPatterns="git-status.service|file-tree-node.component|perf-m2"` → **33/33 passed**.
  - `nx run @ptah-extension/editor:lint --max-warnings=-1` → 0 errors, 14 warnings, all in files this batch never touched (`branch-picker-dropdown.component.spec.ts`, `code-editor.component.spec.ts`, `git-status-bar.component.ts`, `editor-workspace.spec.ts`).
  - `nx run @ptah-extension/editor:typecheck` → clean.
- Confirmed the footprint with `git status --porcelain`: exactly the six modified files plus the one new spec file plus `measurements.md`/`tasks.md` in the task folder. No stray edits.

## The 5 Paranoid Questions

### 1. How does this fail silently?

The `changedDirPrefixes` computed silently returns an empty/stale set if `_files()` never updates — but that's an existing contract (`equal: filesEqual`), not new risk. The one genuinely silent-failure-shaped change is the defensive `cleanupDragListeners()` call added at the top of `startDragTracking`: if it ever _did_ fire on a live drag (see Failure Mode 3), the interrupted drag's last pointer position is dropped with no error, no restore-to-original, and no visual signal — the pane simply stops moving at whatever the last-applied frame left it at. This is a no-op in every path I could construct from real single-pointer mouse input, so I'm not blocking on it, but it is the one place in this batch where "fails silently" is structurally possible.

### 2. What user action causes unexpected behavior?

A user holding the left mouse button down on the terminal resize handle while simultaneously right-clicking on the sidebar handle would fire a second `mousedown` DOM event mid-drag (browsers dispatch `mousedown` per button, not per "drag session"). See Failure Mode 3. Outside of that two-button edge case, I found no reachable user action that behaves differently than before the refactor — the 10 drag specs plus my own read of the diff confirm bit-identical clamp arithmetic, delta orientation, and setters per surface.

### 3. What data makes this produce wrong results?

- A `GitFileStatus` entry with `path === ''` after separator normalization (e.g., a literal `"\\"` or `"/"` payload) hits the `if (!path) continue;` guard and is correctly dropped — no `''` pollutes the set. Verified by reading the code; not separately spec'd, but low risk (backend never emits this).
- A path that is simultaneously a `??` directory AND has a segment beginning with a path separator artifact (e.g. double slashes `src//app`) would produce an extra empty-ish prefix — the `if (i > 0)` guard only protects the leading position, not internal double separators. This is a real but pre-existing and vanishingly unlikely input shape (git does not emit doubled separators), not something this diff introduced or needs to fix.

### 4. What happens when dependencies fail?

- `GitStatusService.changedDirPrefixes` depends only on `_files()`, an in-memory signal — no RPC, no I/O in the computed itself, so there's no failure mode to inject here beyond what already exists in `fetchGitInfo`/`applyGitInfo` (unchanged by this batch).
- `startDragTracking`'s only "dependency" is the browser's `requestAnimationFrame`/`cancelAnimationFrame` and DOM listener APIs — unchanged surface area from before the refactor. `ngOnDestroy` still unconditionally calls `cleanupDragListeners()`, verified structurally to cancel the frame and null all four fields.

### 5. What's missing that the requirements didn't mention?

Nothing new introduced by this batch. The pre-existing `event.target` (mousedown target, not per-frame mousemove target) quirk in the terminal's `[role="main"]` lookup survives verbatim — it was already load-bearing behavior (the original code used the same outer-closure `event`, confirmed by diff), so it is correctly preserved, not silently perpetuated as a _new_ defect.

## Failure Mode Analysis

### Failure Mode 1: Untracked-directory double indicator (the §7 reviewer's call)

- **Trigger**: An entirely-untracked directory (git reports it as one `?? path/` entry, `isDirectory: true`).
- **Symptoms**: The directory node now renders both its existing `U` badge (from `nodeGitStatus()`, unchanged) **and** the new "contains changes" warning dot (from `hasChangedChildren()`).
- **Impact**: Cosmetic only — both indicators land in the same `ml-auto` slot, sitting adjacent. No functional or data-integrity impact.
- **Current handling**: Intentional — `if (file.isDirectory) prefixes.add(path);` in `changedDirPrefixes`.
- **My decision**: **Keep it.** AC3's literal text is "every directory that transitively contains a changed file SHALL be marked." An untracked directory, by construction, contains at least one untracked file (git does not emit a bare `?? dir/` entry for an empty directory), so the directory _does_ transitively contain a changed file — git simply declines to enumerate it for performance. Dropping the branch would produce a directory that _is_ itself the entire git-reported change and yet shows no "contains changes" indicator, which is the more defensible reading of an AC3 violation. The visual redundancy with the `U` badge is a UX nuance, not a logic defect, and the plan explicitly prescribed keeping the branch conditional on the field's existence, which it does. This is a correct call, not a punt.

### Failure Mode 2: `isDirectory` semantics assumption

- **Trigger**: Someone later changes the backend to also set `isDirectory: true` for a _staged_ or _tracked_ directory-shaped entry (currently only `??` sets it, verified at `git-info.service.ts:1428-1441`).
- **Symptoms**: `changedDirPrefixes` would still behave correctly (adds the path as its own prefix), so no regression — this is a non-issue, included here only because I checked it adversarially and it holds.
- **Impact**: None today.
- **Current handling**: Correct — the frontend computed doesn't care _why_ `isDirectory` is true, only that it is.

### Failure Mode 3: Concurrent drag re-entry via a second `mousedown`

- **Trigger**: While one resize drag is in progress (left button held on, say, the terminal handle), a second `mousedown` DOM event fires on a _different_ handle before the first drag's `mouseup`/`blur`/`Escape`. Standard single-pointer left-button dragging cannot produce this (the `mousemove` listener is on `document`, so it keeps tracking regardless of what's under the cursor, and a second `mousedown` requires a button-press transition that a held button doesn't generate) — but holding the left button while pressing the right button over a different handle, or a synthetic/programmatic `mousedown` dispatch (assistive tech, automated tooling), does produce it.
- **Symptoms**: `startDragTracking`'s new defensive `this.cleanupDragListeners()` at entry tears down the first drag's listeners and cancels its armed frame **without** applying its last computed value or restoring its `original`. The first surface silently freezes at whatever its last committed frame left it at; the second surface then starts cleanly.
- **Impact**: Low — the scenario requires two simultaneous mouse buttons or synthetic events, and the result (a stale-but-consistent size, not a crash or corrupted signal) is a minor UX surprise, not data loss.
- **Current handling**: The report calls this "a no-op at runtime" in every reachable flow. That's true for ordinary single-button dragging, but not unconditionally true — the two-button/synthetic-dispatch case is reachable, just rare. I verified this is **strictly safer than the pre-refactor behavior**: the old code, on the same double-mousedown input, would have registered a _second, independent_ listener quartet on top of the first (each `onXResizeStart` unconditionally assigned and re-registered its own fields with no teardown), leaving two live listener sets racing over the single shared `_dragFrame` field — a strictly worse outcome (both surfaces fighting over one frame handle) than the new code's "first surface freezes, second proceeds cleanly."
- **Recommendation**: No action required for this batch. Worth a one-line follow-up note if a future task ever wires pointer capture (`setPointerCapture`) for these handles, which would make this scenario structurally impossible rather than merely improved.

### Failure Mode 4: M2 scaling-probe flakiness

- **Trigger**: The new `perf-m2-indicator-scaling.spec.ts` asserts `shippedGrowth < 3` (a wall-clock ratio) on a shared/loaded CI machine.
- **Symptoms**: A sufficiently noisy CI run could theoretically push the 300-file measurement's `shippedMs` low enough (through timer-resolution quantization at sub-millisecond scale) to make the ratio spike, even though the underlying operation is genuinely O(1).
- **Impact**: Low — this is a perf regression guard, not a correctness gate; a flake here fails a build, not the product. The 3x threshold against an expected ~1x is generous headroom, and the harness already includes JIT warm-up passes specifically to reduce this kind of noise (I confirmed this reasoning by reading the warm-up code, not just trusting the comment).
- **Current handling**: Acceptable as shipped. Flagging only so a future flake isn't mysterious — the mitigation, if it ever flakes, is to widen the threshold or increase `REPETITIONS`, not to weaken the assertion's intent.

## Critical Issues

None found.

## Serious Issues

None found.

## Data Flow Analysis

```
git:status-update push
        |
        v
GitStatusService._files (signal, equal: filesEqual)
        |
        +--> fileStatusMap (computed, unchanged)     -- still used by nodeGitStatus (badges)
        |
        +--> changedDirPrefixes (computed, NEW)
                |  for each file: normalize \->/, strip trailing /
                |  if isDirectory: add path itself
                |  for each '/' at i>0: add path.slice(0,i)   (ancestor chain)
                v
        ReadonlySet<string>  (workspace-relative dir paths, no trailing slash)
                |
                v
FileTreeNodeComponent.hasChangedChildren (computed)
        normalize node.path -> strip workspace root -> strip \->/
        .has(relativeDirPath)   <-- single O(1) lookup, replaces old O(files) scan
                |
                v
        template: warning dot on directory nodes
```

Gap points checked and found closed:

1. **Trailing-slash boundary** (old scan compared `dir + '/'` as a prefix; new set stores bare dir paths) — verified both sides normalize consistently; spec `hasChangedChildren (B3)` pins the off-by-one-segment case (`src/app` must not light up `src/app-legacy`) and it passes.
2. **Multi-root leak** — `_files()` is already workspace-partitioned upstream of `changedDirPrefixes`; a spec pushes a second workspace's files and confirms zero leakage.
3. **Revert-clears-parent** — no mutable caching; `computed` + `equal: filesEqual` gives this for free, and a spec exercises push-then-empty-push.

No gap points found where data can be lost, corrupted, or become inconsistent across this data flow.

## Requirements Fulfillment

| Requirement                                      | Status                               | Concern                                                                                                                                                                                                          |
| ------------------------------------------------ | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B3 AC1 (M2 target)                               | **SHORTFALL, explicitly flagged**    | Out of scope for this verdict per the dispatch instructions (B0 AC4 permits flagging). Diagnosis is sound (see below).                                                                                           |
| B3 AC2 (constant-time)                           | COMPLETE                             | Structural spy-based spec (zero `fileStatusMap.keys()` calls) + empirical scaling probe (0.66–0.82x growth on 10x files). Both independently reproduced by me.                                                   |
| B3 AC3 (both directions)                         | COMPLETE                             | Verified by direct code trace + specs; the `isDirectory` branch is a deliberate, defensible inclusion, not a defect (Failure Mode 1).                                                                            |
| B3 AC4 (multi-root)                              | COMPLETE                             | Holds structurally via `_files()` partitioning; spec confirms.                                                                                                                                                   |
| B3 AC5 (mixed separators, Windows primary)       | COMPLETE                             | Insert-side and lookup-side normalization both verified by reading the code and by dedicated specs (including a literal `C:\ws\src\app` lookup test).                                                            |
| B3 AC6 (revert clears dots)                      | COMPLETE                             | Free from `computed` semantics; spec confirms.                                                                                                                                                                   |
| B5 AC1 (≤1 CD pass/frame)                        | COMPLETE, preserved                  | Unmodified spec passes; M4 re-run shows no run exceeding its own frame count.                                                                                                                                    |
| B5 AC2 (release position never lost)             | COMPLETE, preserved                  | Verified by reading `endDrag`/`applyLatest` order (`cancelDragFrame()` then `applyLatest()` synchronously) — matches the pre-refactor logic exactly, confirmed by diff. Spec `:419` (width 346) reproduced live. |
| B5 AC3 (no stray listener/frame on interruption) | COMPLETE, preserved                  | `cleanupDragListeners()` is the single exit path for every teardown route; `ngOnDestroy` unconditional call confirmed.                                                                                           |
| B5 AC4 (all three surfaces behave identically)   | COMPLETE, now closed by construction | One implementation, three call sites — structurally can no longer diverge.                                                                                                                                       |
| B5 AC5 (layout visually identical)               | COMPLETE                             | Clamp values, delta orientation, and setters are byte-identical per the diff; 10 pre-existing drag specs pass with zero spec-file changes — the strongest evidence available short of a live visual diff.        |

### Implicit requirements NOT addressed (acceptable to leave alone)

- Multi-touch/pointer-capture hardening for the double-mousedown edge case (Failure Mode 3) — not part of this batch's stated scope, and the new code is no worse than, and arguably safer than, the pre-refactor state on this input.

## Edge Case Analysis

| Edge Case                                                     | Handled   | How                                                                                 | Concern                                                        |
| ------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Root-level changed file                                       | YES       | Loop doesn't execute when no `/` present                                            | None                                                           |
| Untracked directory entry                                     | YES       | `isDirectory` branch, deliberate                                                    | Cosmetic double-indicator (Failure Mode 1), decided as correct |
| Trailing slash on directory entry                             | YES       | `while (path.endsWith('/'))` strip                                                  | None                                                           |
| Mixed `\`/`/` on insert and lookup                            | YES       | Normalize both sides independently                                                  | None                                                           |
| Sibling name-prefix collision (`src/app` vs `src/app-legacy`) | YES       | Segment-boundary slicing via `indexOf('/')`, not substring match                    | None                                                           |
| Multi-root workspace leak                                     | YES       | `_files()` pre-partitioned                                                          | None                                                           |
| Mouseup with a queued mousemove                               | YES       | `cancelDragFrame()` then synchronous `applyLatest()`                                | None — reproduced by live test run                             |
| Destroy mid-drag                                              | YES       | `ngOnDestroy` unconditional `cleanupDragListeners()`                                | None                                                           |
| Two simultaneous mousedowns on different surfaces             | PARTIALLY | New `cleanupDragListeners()` guard drops the interrupted drag's last frame silently | Low-probability, safer than pre-refactor; not blocking         |

## Integration Risk Assessment

| Integration                                                          | Failure Probability                           | Impact                                    | Mitigation                                              |
| -------------------------------------------------------------------- | --------------------------------------------- | ----------------------------------------- | ------------------------------------------------------- |
| `changedDirPrefixes` -> `hasChangedChildren` trailing-slash boundary | LOW                                           | Off-by-one-segment false marks            | Spec-pinned, verified passing                           |
| `startDragTracking` shared listener quartet under double-mousedown   | LOW (needs two buttons or synthetic dispatch) | Stale-but-consistent size, no crash       | Acceptable as-is; strictly safer than pre-refactor      |
| M2 scaling probe timing flakiness on loaded CI                       | LOW                                           | False build failure, not a product defect | Generous 3x threshold + warm-up passes already mitigate |

## M2 diagnosis and scaling-evidence audit (explicitly requested, not gating the verdict)

I read `perf-m2-indicator-scaling.spec.ts` in full rather than trusting the report's summary. The methodology holds up:

- It re-implements the **pre-B3 reference scan** (not a strawman) directly in the spec, with the same short-circuit-on-first-hit semantics as the original `hasChangedChildren` loop.
- The directory mix (50 changed / 50 untouched) is correctly identified as load-bearing — the reference scan's worst case is an _untouched_ directory (full walk of every changed-file key), and a real expanded tree is mostly untouched directories, so this mix is the right one to expose the multiplicative term.
- Warm-up passes before each timed measurement are a legitimate JIT-noise control, not a device to massage the numbers — they run _both_ strategies, and only the timed loops afterward are asserted on.
- The two strategies are cross-checked for agreement (`expect(marked).toBe(referenceMarked)`) before their timings are trusted, which rules out the scaling numbers reflecting silently-divergent behavior.
- The claimed result (shipped 0.66–0.82x "growth" i.e. flat-to-improving, reference 2.14–3.86x growth, not a clean 10x) is exactly what's asserted and logged — the report does not round the reference's sub-10x growth up into a stronger claim than the data supports.

This is genuine evidence that B3's real (asymptotic) property holds, independent of the M2 median miss. I'm satisfied the diagnosis is sound and the scaling evidence is not massaged.

## Verdict

**Recommendation**: **APPROVE**
**Confidence**: HIGH
**Top Risk**: The double-mousedown edge case in `startDragTracking` (Failure Mode 3) — real but low-probability, and demonstrably not a regression versus pre-refactor behavior.

Every load-bearing claim in the executor's report was independently verified against the actual diff and live test runs, not accepted on the report's word: the drag refactor is byte-identical in clamp arithmetic, delta orientation, and setters per surface; the `[role="main"]` lookup still resolves per-frame using the original mousedown-target closure (a preserved pre-existing quirk, not a new defect); `compute` runs outside the zone and only `commit` re-enters it; the mouseup path cancels the armed frame and applies the final value synchronously (AC2); TASK_2026_176's blur/Escape teardown is untouched; the `changedDirPrefixes`/`hasChangedChildren` pair is correct in both directions including the trailing-slash boundary and mixed-separator normalization; and the `isDirectory` branch is a defensible, AC3-literal reviewer's call to keep, not a defect to revert. The M2 miss is honestly flagged per B0 AC4 and the scaling evidence genuinely supports B3's asymptotic claim.

## What robust implementation would additionally include

Not required for this batch, but worth naming for a future pass: pointer capture (`element.setPointerCapture`) on the three resize handles would make the double-mousedown edge case (Failure Mode 3) structurally impossible rather than merely "safer than before," and would be the natural place to also unify `mousemove`/`mouseup` onto the captured element instead of `document`. This is scope creep for Batch 4 and should not block approval.
