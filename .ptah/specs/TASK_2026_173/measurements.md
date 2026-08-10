# Performance Measurements — TASK_2026_173 (Batch 0 + Batch 2 Task 2.14)

**Status**: M1, M2, M3, M4 baselines all captured. M1 was deliberately deferred until Batch 2 landed (see below) and was captured by Task 2.14.
**Machine**: Windows 11 Home 10.0.26200, single-processor listing (see `systeminfo`), Node v24.15.0.
**Captured**: 2026-08-03 (M2/M3/M4 in Batch 0; M1 in Batch 2 Task 2.14, same day).

All four B0 harnesses (M1–M4) exist and execute end-to-end (Batch 0 AC1). Per
task instructions, single-shot numbers are not acceptable (B0 AC3) — every
row below reports **median AND max** over the specified sample count, with
enough method detail for a third party to reproduce (B0 AC1–AC3).

---

## M1 — diff-tab re-display latency

**Status: BASELINE CAPTURED (Task 2.14), post-Batch-2 / pre-Batch-3 code.**
Batch 2 rewrote the diff fetch path end to end — `openDiff`, the single
`git:diffFile` RPC, `DiffTabState` — so the Batch-0 harness-proof figure
against the OLD two-RPC `git:showFile` + `editor:openFile` mechanism was
never a baseline and is not apples-to-apples with this one (kept below for
reference only, per the header note that flagged it as such at the time).
This is now the baseline of record for Batch 3's B1 AC2 target ("median

> =70% below baseline AND <=100ms absolute").

- **Harness**: `apps/ptah-electron-e2e/src/specs/editor/perf-m1-diff-redisplay.spec.ts`. Updated for Task 2.14 to mock `git:diffFile` (the RPC `EditorDiffSplitHelper.openDiff` now actually calls) instead of the retired `git:showFile` + worktree-read pair. `editor:openFile` stays mocked because the harness still opens a plain FILE tab first (round-trip step 1 switches to it); that tab is unrelated to the diff mechanism and outside Batch 2's scope.
- **M1 baseline (post-Batch-2, `git:diffFile` mechanism)**: 10 round trips, **median = 262.95ms, max = 366.60ms**. Samples (ms): `[366.6, 337.3, 259.2, 266.7, 203.5, 298.6, 267.6, 199.6, 247.9, 210.6]`.
- **Reference only — NOT a baseline, NOT comparable** (pre-Batch-2 two-RPC mechanism, Batch-0 harness-proof run): median = 123.00ms, max = 188.30ms. Samples (ms): `[188.3, 128.7, 133.3, 117.2, 118.8, 143.5, 121.3, 124.5, 108.7, 121.5]`. The two figures are not "before/after" of the same thing: the pre-Batch-2 run measured a two-RPC mock returning smaller synchronous payloads under a different code path, not a slowdown introduced by Batch 2. Any apparent regression between the two numbers is a mechanism/harness-mock difference, not a product regression — Batch 2 did not touch diff-tab _re-display_ (remount) behaviour at all, only the fetch/revalidation path; that is Batch 3's B1/N1 territory, which is what the post-Batch-2 baseline above exists to be compared against.

### ⚠️ THE RECORDED BASELINE ABOVE WAS MEASURED AGAINST A STALE RENDERER — corrected 2026-08-03 (Batch 3)

Discovered while capturing the Batch-3 after-figure, reported rather than quietly worked around:

`nx e2e ptah-electron-e2e` depends on `ptah-electron:copy-renderer`, whose Nx
cache key does **not** include the webview build output it copies. A cache
entry stored at 20:46 on 2026-08-03 (a **pre-Batch-2** dev build) was being
restored on every subsequent e2e run, overwriting a freshly-copied renderer.
Evidence: `dist/apps/ptah-electron/renderer/chunk-OW4X6VPX.js` contained
`isDiff:!0 ... originalContent ... diffRelativePath` — the tab record Batch 2
**deleted** — and the shipped bundle contained no `diffTabLabel` output at all.
Corroborating: the spec's tab locator still read `Switch to big-file.ts (diff)`,
a label that has not existed in the source since Batch 2 (post-Batch-2 it is
`big-file.ts (working tree)`), and it matched.

**Consequence**: the 262.95ms / 366.60ms figure recorded as the Task 2.14 M1
baseline is a measurement of **pre-Batch-2 renderer code**, not of the
`git:diffFile` mechanism it claims to measure. It is retained above as the
number of record, but it is NOT the honest pre-Batch-3 comparison point.

**Corrected pre-Batch-3 baseline** — same harness, same machine, product code at
`61628f623` (Batch 2 tip), renderer forced fresh (`nx e2e ... --skip-nx-cache`),
locator corrected to the real post-Batch-2 tab label:
**median = 227.90ms, max = 351.30ms**. Samples (ms):
`[351.3, 256.8, 271.2, 226.4, 181.9, 207.9, 206.6, 229.4, 245, 186.4]`.

**Reproduce M1 correctly**: always pass `--skip-nx-cache`, e.g.
`npx nx e2e ptah-electron-e2e --skip-nx-cache -- editor/perf-m1-diff-redisplay.spec.ts`.
Without it the app under test may be an arbitrarily old renderer. **Follow-up
(out of scope for this task)**: give `copy-renderer` an input that tracks
`ptah-extension-webview:build`'s outputs (`dependentTasksOutputFiles`), so the
cache cannot serve a stale renderer to any e2e run.

### AFTER — B1 + B2 + N1 + D3 (Batch 3), captured 2026-08-03/04

Same harness, same machine, renderer forced fresh. Two independent executions,
both reported:

| Run                                             | median     | max        |
| ----------------------------------------------- | ---------- | ---------- |
| Baseline of record (stale renderer — see above) | 262.95     | 366.60     |
| **Corrected pre-Batch-3 baseline**              | **227.90** | **351.30** |
| After, execution 1                              | **201.25** | 294.00     |
| After, execution 2                              | **196.10** | 324.00     |

After execution 1 samples (ms): `[294, 239.7, 231, 187.3, 184.1, 198, 215.6, 192.6, 204.5, 182.3]`.
After execution 2 samples (ms): `[324, 217.1, 239.1, 202, 210.8, 177.8, 190.2, 173.2, 176.5, 176]`.

#### ❌ B1 AC2 IS NOT MET — flagged explicitly per B0 AC4

B1 AC2 requires the median to be **>=70% below baseline AND <=100ms absolute**.
Observed: **~13% below** the corrected baseline (~25% below the stale number of
record), at ~198ms. **This is not a pass and is not reported as one.**

**Honest read of why.** B1 removes diff-editor _construction_ from the return
switch, and that removal is real and independently verified —
`diff-view-state.spec.ts` brands the live `IStandaloneDiffEditor` object and
finds the same brand after a round trip, so no editor is rebuilt, and the model
pair is reused rather than recreated. But construction was never the dominant
term in this window. What remains, and what B1 does not touch:

1. **Monaco recomputes the whole 500-line diff on `setModel`**, off-thread, and
   the harness's clock only stops once the rendered line count settles.
2. **~500 view lines are re-rendered and re-tokenized** from an empty editor.
3. The harness deliberately waits for **two stable animation frames** (~32ms of
   pure settle time) before resolving.

**The remaining lever, identified but deliberately NOT taken.** The largest
remaining cost is that switching away calls `setModel(null)`, so returning pays
a full diff recompute + re-render. Because the diff view is now permanently
mounted and merely hidden, it could instead KEEP the pair attached while
hidden, making a return switch a pure visibility change. That would plausibly
reach AC2's absolute target. It was not done here because
`implementation-plan.md` §4.2 explicitly prescribes `diffTab() -> null =>
setModel(null)` ("no throw, no stale diff", B1 AC6), and quietly inverting a
stated design decision to improve one's own headline number is exactly the
failure mode this task's honesty requirement guards against. **Recommended as a
scoped follow-up with its own AC6 argument**, not smuggled in here.

**Workload**: synthetic ~500-line TypeScript file (`makeContent()` in the spec), alternating diff-tab <-> file-tab.
**Sample count**: 10 round trips per execution.
**Method**: Playwright drives the Electron app via the existing e2e harness (mocked `editor:getFileTree` / `editor:openFile` / `git:diffFile` RPCs, `git:status-update` push). Each round trip: click the plain file tab (unmounts `<ptah-diff-view>` — today's `@if` chain, N1 fixes this in Batch 3), arm a page-side timer (MutationObserver on `document.body` driving a self-scheduling `requestAnimationFrame` recheck of `.view-line` count under `ptah-diff-view .view-lines`, resolving once the count stabilizes across two frames), then click the diff tab and await the timer. See the spec file's header comment for the documented deviation from a literal "observer directly on `.view-lines`" (that element does not exist until after the click that starts the window).
**Reproduce**: `npx nx e2e ptah-electron-e2e --skip-nx-cache -- editor/perf-m1-diff-redisplay.spec.ts`.

### B1 AC3 / AC4 — view state, verified empirically against the pinned Monaco

Harness: `apps/ptah-electron-e2e/src/specs/editor/diff-view-state.spec.ts` (NEW,
Batch 3). It brands the live standalone diff editor, scrolls the modified side,
performs a tab round trip, and reads the state back off the real editor.
Observed output, both executions: `brand=4173 scrollTop=400 foldingEnabled=false foldingState={}`.

- **B1 AC1 — PASS (empirical).** The brand survives the round trip: the same
  `IStandaloneDiffEditor` instance is reused, so no editor is constructed on a
  return switch.
- **B1 AC3 — PASS (empirical).** `scrollTop` of 400 is restored after the round
  trip via `saveViewState()` / `restoreViewState()` around `setModel`.
- **B1 AC4 (collapsed regions) — SHORTFALL, NOT A PASS.** Risk A-3 said to check
  this empirically and record a shortfall rather than claim a pass. On
  **monaco-editor 0.55.1** the diff editor **hard-disables classic folding on
  both sub-editors** — `clonedOptions.folding = false` in
  `esm/vs/editor/browser/widget/diffEditor/components/diffEditorEditors.js`
  (`_adjustOptionsForSubEditor`). `FoldingController.saveViewState()` therefore
  short-circuits on `!this._isEnabled` and returns `{}` with no
  `collapsedRegions`, which the probe confirms at runtime. **Collapsed regions
  are not preserved because a Monaco diff editor cannot have any** — there is no
  folding affordance in the gutter to collapse with. The per-tab state that does
  exist (both sides' scroll + cursor, plus the diff model's serialized
  hidden-unchanged-region state) is saved and restored. The e2e assertion pins
  `foldingEnabled === false`, so if a future Monaco bump enables folding in diff
  editors the assertion fails and the shortfall is revisited rather than assumed
  still true.

---

## M2 — `git:status-update` handling cost

**Reported figure (Jest)**: median = **3.034ms**, max = **5.161ms**, over 10 iterations.
Samples (ms): `[5.161, 4.39, 3.946, 3.054, 3.014, 3.7, 3.014, 2.39, 2.211, 2.245]`.

- **Harness**: `libs/frontend/editor/src/lib/file-tree/perf-m2-status-update.spec.ts`.
- **Workload**: 300 `GitFileStatus` entries dispatched via a real `window` `message` event carrying `{ type: 'git:status-update', payload }`, against a real (non-mocked) `GitStatusService` instance wired to 100 real `FileTreeNodeComponent` fixtures (90 file nodes across 10 synthetic directories + 10 directory nodes, so both `nodeGitStatus` and `hasChangedChildren` computeds are exercised). `VSCodeService`/`rpcCall` are stubbed; `GitStatusService` and `FileTreeNodeComponent` are real.
- **Sample count**: 10 iterations. Each iteration varies one file's status (M<->A) so the service's custom `equal: filesEqual` signal comparator sees a genuine change and actually propagates (a byte-identical payload would correctly no-op and understate the cost).
- **Method**: `performance.now()` wraps `window.dispatchEvent(new MessageEvent('message', {...}))` + `fixture.detectChanges()` for all 100 fixtures + `TestBed.flushEffects()`. Median/max computed and logged; a generous upper-bound assertion (median < 500ms, max < 1000ms) doubles this file as a permanent regression guard.
- **Reproduce**: `npx nx test @ptah-extension/editor --testPathPatterns=perf-m2-status-update`.

### DEVIATION FROM B0 AC5 — stated explicitly (B0 AC4 requires deviations be flagged)

B0 AC5 names Electron as the reference runtime for every measurement. **M2 is
the one deliberate exception**, per `implementation-plan.md` §7: this cost is
entirely renderer-side (Angular signal propagation + OnPush change detection
over the file tree) and is identical across VS Code, Electron, and the CLI's
webview host — there is no host-specific code on this path. A Jest harness
gives a far more reproducible number than a GPU-scheduled Electron window
(no window compositing, no IPC round trip, no OS scheduling jitter), and it
doubles as a CI-enforced regression guard, which an Electron-only measurement
cannot. **The Jest figure above is the one reported as M2.**

### Electron spot-check (confirmation only, not the reported figure)

- **Harness**: `apps/ptah-electron-e2e/src/specs/editor/perf-m2-electron-spotcheck.spec.ts`.
- **Result**: median = 85ms, max = 665ms, over 5 iterations. Samples (ms): `[200, 85, 665, 46, 52]`.
- **Method**: drives the real Electron renderer with a 100-node mocked file tree, pushes a 300-entry `git:status-update` via the existing e2e IPC bridge, and measures Node-side wall-clock time (`Date.now()`) from the push to `page.waitForFunction` observing the expected git-status badge titles (`Modified`/`Added`) on all 100 nodes.
- **Interpretation**: this number is expected to be, and is, larger than the Jest figure — it additionally includes main-process -> renderer IPC, Electron's real compositor/paint scheduling, and Playwright's polling granularity (the high 665ms outlier is consistent with GC or window-focus scheduling noise, not the underlying handling cost). It confirms the Jest figure is not a jsdom artifact — the DOM does converge quickly (double-digit-to-low-hundreds ms wall clock including IPC) — without being used as the reported number, per the deviation above.

### AFTER — B3 `changedDirPrefixes`, captured 2026-08-10 (Batch 4, Tasks 4.1 + 4.2)

Same harness, same workload (300 entries x 100 fixtures, 10 iterations), same
machine, unchanged measurement path. Only `git-status.service.ts` (new
`changedDirPrefixes` computed) and `file-tree-node.component.ts`
(`hasChangedChildren` → one `Set.has`) changed.

| Execution          | median (ms) | max (ms) | samples (ms)                                                    |
| ------------------ | ----------- | -------- | --------------------------------------------------------------- |
| **Baseline**       | **3.034**   | 5.161    | `[5.161,4.39,3.946,3.054,3.014,3.7,3.014,2.39,2.211,2.245]`     |
| After, execution 1 | 2.605       | 5.265    | `[5.265,3.482,3.165,2.583,2.736,2.627,2.369,2.059,2.003,2.188]` |
| After, execution 2 | 3.512       | 7.236    | `[7.236,4.138,3.593,3.43,3.661,3.744,2.431,2.157,2.173,2.5]`    |
| After, execution 3 | 3.658       | 7.725    | `[7.725,5.481,4.328,3.984,3.332,4.839,2.858,2.928,3.273,2.896]` |

#### SHORTFALL AGAINST THE M2 TARGET — stated explicitly, per B0 AC4

The M2 target is **median ≥80% below baseline**, i.e. ≤ **0.607ms**. The
observed medians are **2.605 / 3.512 / 3.658 ms** — between **14% below** and
**21% above** baseline. **The target is MISSED by a wide margin, and the three
executions straddle the baseline, so the honest reading is that this harness
shows NO measurable change at all.** It is not rounded up into a pass.

Why, and why the fix is still correct:

- **The harness total is dominated by Angular change detection over 100
  `FileTreeNodeComponent` fixtures**, not by the directory-indicator scan. At
  300 changed files x 10 directory nodes the removed scan is ~3,000 `startsWith`
  calls — a fraction of a millisecond inside a ~3ms budget. An asymptotic fix
  cannot move a median whose cost lives somewhere else.
- **The 80% target was therefore set against the wrong cost model.** B3's actual
  claim (`task-description.md:178-185`) is AC2 — evaluation _effectively
  constant-time with respect to the number of changed files_ — and the
  no-multiplicative-growth requirement in `implementation-plan.md` §7. A single
  median at one workload size is not evidence either way for that claim, which
  is why the scaling probe below exists.
- **Run-to-run noise on this machine is larger than the effect being measured**
  (a concurrent build/lint session for TASK_2026_177 was live on this branch
  throughout). Execution 1 vs 3 differ by 40% on identical code.

#### Scaling evidence — the claim the median cannot carry

- **Harness**: `libs/frontend/editor/src/lib/file-tree/perf-m2-indicator-scaling.spec.ts` (new, Task 4.5).
- **Run**: `npx nx test @ptah-extension/editor --testPathPatterns=perf-m2-indicator-scaling`.
- **Method**: against one real `GitStatusService`, 100 directory nodes (50 that
  contain changes, 50 untouched) are evaluated 50 times each by two strategies —
  SHIPPED (`changedDirPrefixes().has(dir)`) and REFERENCE (the pre-B3 scan,
  re-implemented in the spec because it no longer exists in source). Both are
  timed at 300 and 3000 changed files with the directory count held constant,
  after warm-up passes (without warm-up the first measurement runs interpreted
  and the second JIT-optimized, which alone moved the reference figure ~6x).
  The directory mix is load-bearing: the old scan short-circuits on its first
  hit, so its worst case — and the common case in a real tree — is a directory
  with **no** changes, which costs a full walk of every changed-file key.

| Files               | SHIPPED (100 dirs x 50 passes) | REFERENCE (same work, pre-B3 scan) | set build (once per update)         |
| ------------------- | ------------------------------ | ---------------------------------- | ----------------------------------- |
| 300                 | 0.891ms / 0.925ms              | 36.8ms / 86.0ms                    | 2.210ms / 1.099ms                   |
| 3000                | 0.730ms / 0.608ms              | 141.8ms / 183.8ms                  | 7.037ms / 10.801ms                  |
| growth on 10x files | **0.82x / 0.66x**              | 3.86x / 2.14x                      | ~3.2x / ~9.8x (linear, as designed) |

- **AC2 holds.** The shipped lookup does not grow when changed files grow 10x
  (0.82x and 0.66x across two executions — i.e. flat, within noise). The
  (directories x changed files) term is gone. The spec asserts this with a
  generous <3x bound so it fails a reintroduced scan without flaking.
- **Absolute separation at the larger workload is ~194x** (0.73ms vs 141.8ms for
  the identical 5,000 directory evaluations).
- **Honest caveat on the REFERENCE column**: it grows 2.1–3.9x for 10x files,
  not 10x. Fixed per-directory overhead (a fresh `Map.keys()` iterator per
  directory) dominates at 300 files and damps the ratio. The load-bearing
  observation is that SHIPPED is flat while REFERENCE is not, and the absolute
  gap; a clean 10x on the reference is not claimed.
- The set build is O(total path segments) once per status update and does grow
  with the file count, as intended. At 3000 changed files it is ~7–11ms of
  one-time work that replaces per-node scanning; the previous design paid its
  equivalent cost once per directory node instead of once per update.

---

## M3 — `git status` invocations from cache churn

**Recorded baseline**: **25 invocations** over a 60-second window (plan's expectation: ≈30 — same order of magnitude, same mechanism).

- **Procedure**: `apps/ptah-electron-e2e/src/specs/editor/perf-m3-watcher-churn.md` (full detail, including why the live monorepo was rejected as the measurement environment and the exact reproduction steps).
- **Script**: `apps/ptah-electron-e2e/src/specs/editor/perf-m3-watcher-churn.script.mjs` — zero product-code change; replicates `GitWatcherService.watchWorkspaceRoot`'s exact exclusion predicate (`.git/`, `node_modules/`, `dist/` only — NOT `.nx/` or `.angular/`, `git-watcher.service.ts:376-393`) and `WORKSPACE_DEBOUNCE_MS` (2000ms, `:102`) standalone, and shells out the exact `git status --porcelain=v2 --branch` command `GitInfoService.getGitInfo` issues (`git-info.service.ts:54-55`) with `GIT_TRACE=1` on the child env.
- **Workload**: an isolated scratch git repository (one tracked file, empty `.nx/cache` + `.angular/cache`), with synthetic probe-file writes into both cache directories every 2200ms (28 writes total over 60s) — chosen deliberately just above the 2000ms debounce window so writes mostly produce their own separate status call rather than coalescing into one or two, reproducing the "many separate cache-write bursts over a dev-build window" shape a real build produces.
- **Sample count**: one 60-second window (per plan §7: "single 60s window before and after").
- **Method**: count `GIT_TRACE` stderr lines (git emits exactly one per invocation — confirmed empirically: 25 trace lines for 25 invocations, matching plan §7's description precisely) over the window. At the window's midpoint, a real tracked file (`src/file.ts` in the scratch repo) is appended to and reverted, to prove B4 AC3 (a genuine change still fires within the existing debounce window) — **confirmed**: the mid-window edit triggered its own status invocation.
- **Reproduce**: see the procedure doc for exact commands.

### FINDING — the live monorepo is not a usable measurement environment for M3

Before settling on the scratch-repo methodology above, this was run **directly
against this repository** (`D:\projects\ptah-extension`, the real workspace)
with the same script. Result: **0 status invocations** over the full 60s
window, despite 734 qualifying (non-excluded) file-system events. The
2000ms debounce timer never went quiet once across the entire window — this
live dev machine has enough ambient background file-system churn (Nx daemon
activity, editor auto-save, and/or other tooling) outside of any deliberate
"build" that the debounce kept getting re-armed continuously. This is a real
observation, not a bug in the script: it explains why every other spec in
this e2e suite deliberately uses a fictional `C:\ptah-e2e-ws` workspace
rather than the live monorepo. **Recommendation for Task 5.3's after-figure**:
capture it on a quiet machine (or the scratch-repo methodology again with
`.nx`/`.angular` now excluded), not against a live working copy with other
tooling running — a live-repo run could misleadingly report "0" for the
wrong reason (debounce starvation) even before the B4 fix lands.

### AFTER — Batch 5 (B4), captured 2026-08-10

**Result: 1 `git status` invocation over the 60-second window, and that one
invocation was triggered by the deliberate tracked-source-file edit.
Invocations attributable to excluded (cache) paths: 0. Target MET.**

| Metric                                                     | Baseline (pre-B4) | Paired control (pre-B4 predicate, same session) | **After (B4)** |
| ---------------------------------------------------------- | ----------------- | ----------------------------------------------- | -------------- |
| `git status` invocations / 60 s                            | 25                | 26                                              | **1**          |
| GIT_TRACE stderr lines (1 per invocation)                  | 25                | 26                                              | **1**          |
| Qualifying (non-excluded) fs events                        | 734 (live repo)   | 170                                             | **2**          |
| Invocations attributable to `.nx` / `.angular` cache churn | 25                | 26                                              | **0**          |
| Mid-window tracked-file change fired its own status update | Yes               | Yes (latency 2923 ms)                           | **Yes**        |

- **Sample count**: 2 after-runs (60 s each), both returning **1** invocation
  and **2** qualifying events — median 1, max 1, no spread. Plus 1 paired
  control run (60 s) on the same machine, same scratch repo, same session.
- **Why a paired control was added.** The recorded baseline (25) was captured
  in an earlier session under unknown ambient load. Re-running the _old_
  predicate immediately before the after-run, on the same scratch repo and
  machine, removes that confound. The control reproduced **26** against the
  recorded **25** — a 4% delta, confirming the environment is stable and the
  before/after comparison is apples-to-apples. The drop to 1 is therefore
  attributable to the exclusion change, not to a quieter machine.
- **Workload**: identical to the baseline — isolated scratch git repository at
  `C:\temp\ptah-m3-scratch-after` (`git init`, one tracked file `src/file.ts`,
  empty `.nx/cache` + `.angular/cache`), synthetic probe writes into both cache
  directories every 2200 ms (28 writes to each over 60 s), `WORKSPACE_DEBOUNCE_MS`
  unchanged at 2000 ms.
- **Method**: `apps/ptah-electron-e2e/src/specs/editor/perf-m3-watcher-churn.script.mjs`,
  whose exclusion predicate was updated in this batch to mirror the new
  `WATCH_IGNORED_DIRS` / `isExcludedWorkspacePath` from
  `libs/shared/src/lib/constants/workspace-scan.constants.ts`. Counts
  `GIT_TRACE=1` stderr lines, one per invocation.
- **Machine**: same Windows 11 dev workstation as the baseline; the live
  monorepo was deliberately NOT used, per the FINDING above.
- **Reproduce**:
  ```bash
  mkdir -p /c/temp/ptah-m3-scratch-after/src \
           /c/temp/ptah-m3-scratch-after/.nx/cache \
           /c/temp/ptah-m3-scratch-after/.angular/cache
  cd /c/temp/ptah-m3-scratch-after
  git init -q && git config user.email m3@test.local && git config user.name M3
  printf 'export const x = 1;\n' > src/file.ts
  printf '.nx/\n.angular/\n' > .gitignore
  git add -A && git commit -q -m init
  node <repo>/apps/ptah-electron-e2e/src/specs/editor/perf-m3-watcher-churn.script.mjs \
    "C:\temp\ptah-m3-scratch-after" 60000 "src/file.ts"
  ```

#### B4 AC3 — genuine changes still surface (the R-9 mitigation)

This is the half of the measurement that distinguishes a fix from a broken
watcher, and it passes on the strongest available evidence: the **single**
status invocation in the after-window was triggered by the tracked source file,
by name. The script's own invocation log:

```json
"statusInvocations": 1,
"midWindowProbeFired": true,
"midWindowProbeConfirmedByStatusCall": true,
"invocationLog": [
  { "t": 1786368874011, "trigger": "change:src\\file.ts", "traceLineCount": 1 }
]
```

The mid-window edit to `src/file.ts` produced its own `git status` inside the
unchanged 2000 ms debounce window. Nothing else did. An after-figure of "0"
would in fact have been a **failure signal** here, not a better result — it
would have meant the tracked-file edit was swallowed too.

#### Honest caveats

- The after-figure's precision (1, twice, zero spread) comes from the
  controlled scratch repo. It is not a claim about absolute invocation counts
  during a real `nx build` on a busy machine; it is a claim about the
  _mechanism_ — writes under `.nx/` and `.angular/` no longer re-arm the
  debounce timer, and writes under `src/` still do.
- The script's exclusion list is a hand-maintained third copy living in the e2e
  harness (it is `.mjs` run by bare `node` and cannot import the TypeScript
  shared constant without dragging the harness into the build graph). It now
  carries an explicit ⚠️ pointer at `workspace-scan.constants.ts`. Flagged as a
  known follow-up, not silently accepted.

---

## M4 — change-detection passes during sidebar-splitter drag

**Recorded baseline**: style-mutations median = **121**, max = **223**, over 5 runs of a 2-second drag window each. Frame counter (context, same windows): median = 121, max = 122.
Style-mutation samples: `[89, 119, 121, 223, 218]`. Frame samples: `[99, 122, 121, 120, 121]`.

- **Harness**: `apps/ptah-electron-e2e/src/specs/editor/perf-m4-drag-cd.spec.ts`. Zero product-code change.
- **Workload**: `page.mouse.move` in a tight loop (no artificial delay) over the sidebar resize handle (`[role="separator"][aria-label="Resize sidebar"]`, `editor-panel.component.ts:170-175`) for a 2-second window, re-measuring the handle's bounding box every run (it moves as the sidebar widens).
- **Sample count**: 5 runs x 2-second windows.
- **Method**: a `MutationObserver` on the `<aside role="complementary">` element inside `ptah-sidebar` (the `[style.width.px]` binding lives on that inner element, `sidebar.component.ts:38-42` — **not** on the `ptah-sidebar` host itself, an early implementation mistake corrected during this run) counts `style`-attribute layout writes; a parallel self-scheduling `requestAnimationFrame` loop counts frames over the identical window. Both counters reset per run.
- **Reproduce**: `npx nx e2e ptah-electron-e2e -- editor/perf-m4-drag-cd.spec.ts`.

### FINDING — measured ratio is close to 1:1 (mutations:frames), not dramatically higher, under this harness

The plan frames the M4 bug as "many mousemove events per frame" (today's
`onSidebarResizeStart`, `editor-panel.component.ts:879-903`, calls
`ngZone.run()` synchronously on every native `mousemove` with no rAF
coalescing). Under this Playwright-driven synthetic input, the observed
style-mutation count came out close to the frame count (median 121 vs 121
frames) rather than a clear multiple of it, though individual runs did
exceed the frame count by up to ~1.8x (223 mutations vs 122 frames on one
run). Two candidate explanations, reported rather than resolved by adjusting
the workload to force a bigger number:

1. Chromium coalesces `mousemove` dispatch to roughly once per rendering
   frame regardless of the underlying input rate (a well-known browser
   input-coalescing behavior), which would mean a Playwright/Electron/
   Chromium-driven harness structurally under-represents the pathology a
   genuine high-poll-rate mouse or trackpad produces on real hardware.
2. The per-call CDP round-trip latency in the Node-side loop (`await
page.mouse.move(...)`) may itself throttle the effective synthetic input
   rate close to frame rate, independent of any browser-level coalescing.

Both were tested (with and without Playwright's `steps` option to
synthesize sub-moves per call); neither consistently pushed the ratio much
above ~1:1–1.8:1 in this environment. **This is reported as a discrepancy
against the plan's framing, per the honesty requirement, rather than tuned
until it matched.** The harness still proves useful as a regression guard
(Batch 4's after-figure should show mutations staying <= frame count with
tighter clustering, since B5 explicitly coalesces to <=1 update per rAF) —
it may simply show a smaller relative improvement than a native-hardware
measurement would.

### AFTER — B5 drag coalescing (rAF), captured 2026-08-03

**B5 landed standalone, ahead of the rest of Batch 4** (user decision; B3 and
the M2 after-figure remain PENDING in Batch 4). Same harness, same machine,
same workload, unchanged product-measurement path — only
`editor-panel.component.ts`'s three drag handlers changed.

| Run                | style-mutations median | style-mutations max | frames median | frames max |
| ------------------ | ---------------------- | ------------------- | ------------- | ---------- |
| **Baseline**       | 121                    | **223**             | 121           | 122        |
| After, execution 1 | 63                     | 76                  | 123           | 123        |
| After, execution 2 | 101                    | 118                 | 121           | 122        |

Execution 1 samples: mutations `[65, 61, 63, 63, 76]`, frames `[98, 123, 123, 122, 123]`.
Execution 2 samples: mutations `[45, 85, 101, 115, 118]`, frames `[92, 121, 122, 121, 121]`.

**Honest read — the criterion met is the ratio, not the absolute drop.** Per
the FINDING above, this harness structurally under-represents the pathology,
so a large absolute drop was never the thing to look for and is not claimed
here. What did move, and is the signal B5 predicts:

- **Baseline exceeded the frame count on 2 of 5 runs** (223 mutations vs 122
  frames = 1.83x; 218 vs 120 = 1.82x). **After the fix, no run in either
  execution exceeded its own frame count** — worst observed ratio is
  118/122 = 0.97. Writes above frame rate are structurally impossible now,
  which is exactly what "<=1 update per animation frame" buys.
- **Clustering tightened.** Baseline spread (max - median) was 102; after, it
  is 13 and 17. The 223/218 outliers are gone.
- **Run-to-run variance between the two executions is large** (median 63 vs 101) and is a property of the harness, not the fix: the sidebar saturates
  its 480px clamp partway through each 2s window, after which the signal
  write is a no-op and produces no style mutation, so the count depends on
  how much of the window is spent pre-saturation. Both executions are
  reported rather than the flattering one.

### AFTER (2) — post-`startDragTracking` extraction, captured 2026-08-10 (Task 4.3)

Task 4.3 folded the three copy-pasted drag loops into one private
`startDragTracking<T>({ original, compute, commit })` and collapsed the three
listener-field quartets and three cleanup methods into one. **This is a pure
de-duplication of already-shipping behavior (B5 AC4); no behavior was intended
to change.** The rows below exist to prove it did not drift, and are recorded
ALONGSIDE the 2026-08-03 figures above, not in place of them.

| Run                            | style-mutations median | style-mutations max | frames median | frames max |
| ------------------------------ | ---------------------- | ------------------- | ------------- | ---------- |
| **Baseline**                   | 121                    | **223**             | 121           | 122        |
| After (rAF), 2026-08-03 exec 1 | 63                     | 76                  | 123           | 123        |
| After (rAF), 2026-08-03 exec 2 | 101                    | 118                 | 121           | 122        |
| **Post-extraction exec 1**     | 120                    | 121                 | 121           | 121        |
| **Post-extraction exec 2**     | 120                    | 121                 | 121           | 121        |

Post-extraction exec 1 samples: mutations `[96,119,120,121,120]`, frames `[100,121,120,121,121]`.
Post-extraction exec 2 samples: mutations `[97,119,121,120,121]`, frames `[101,121,121,120,121]`.

**Verdict: no drift on the criterion that this harness can actually support.**
Per the FINDING above, that criterion is the ratio, not the absolute count:

- **No run exceeded its own frame count, in either execution** — worst observed
  is 121 mutations against 121 frames (1.00x), and every other pairing is at or
  below frame rate. The baseline's signature pathology (223 vs 122 = 1.83x, and
  218 vs 120 = 1.82x, on 2 of 5 runs) remains absent. B5 AC1 holds.
- **Max collapsed from 223 to 121** and the spread (max − median) is 1, versus
  102 at baseline.

**Flagged honestly: the absolute median is higher than the 2026-08-03
after-figures (120 vs 63 and 101), and equal to the baseline median of 121.**
This is not presented as an improvement and was not tuned away. The reading,
consistent with the variance already documented above: under coalescing the
mutation count is _capped_ at one per frame, so 120–121 mutations across ~121
frames is the ceiling of correct behavior — it means the drag produced a fresh
distinct width on essentially every frame, i.e. these two runs spent almost none
of the 2s window saturated against the 480px clamp (a saturated write is a
no-op and emits no mutation, which is what produced the lower 63/101 medians in
August). The two post-extraction executions are unusually consistent with each
other (120/121 both times), which supports a saturation-timing explanation
rather than a change in update frequency. What would indicate real drift — a run
writing more often than once per frame — does not occur.

The correctness of the fix does not rest on these numbers. `ngZone.run()` once
per native `mousemove` inside a `runOutsideAngular` block is a defect on code
reading alone — the `runOutsideAngular` was doing no work. Unit coverage in
`editor-panel.component.spec.ts` ("resize drags coalesce to one update per
frame (B5)", now 10 tests after TASK_2026_176 folded the blur/Escape
interruption specs in) asserts the invariant directly and framework-version-
proof: N pointer events arm exactly one frame, only the latest position is
applied, mouseup cancels the pending frame yet still applies the release
position, the 160/480 clamp is unchanged, destroy cancels a pending frame, and
all three surfaces (sidebar, terminal, split divider) behave identically. **All
of them passed unmodified across the Task 4.3 extraction** — the spec file was
not touched, which is the strongest available evidence that the refactor is
behavior-preserving.

---

## Reproducibility summary

| Metric                        | File(s)                                                                         | Command                                                                                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1 (baseline + Batch-3 after) | `apps/ptah-electron-e2e/src/specs/editor/perf-m1-diff-redisplay.spec.ts`        | `npx nx e2e ptah-electron-e2e --skip-nx-cache -- editor/perf-m1-diff-redisplay.spec.ts` (the flag is REQUIRED — see the stale-renderer note under M1) |
| B1 AC1/AC3/AC4 view state     | `apps/ptah-electron-e2e/src/specs/editor/diff-view-state.spec.ts`               | `npx nx e2e ptah-electron-e2e --skip-nx-cache -- editor/diff-view-state.spec.ts`                                                                      |
| M2 (reported)                 | `libs/frontend/editor/src/lib/file-tree/perf-m2-status-update.spec.ts`          | `npx nx test @ptah-extension/editor --testPathPatterns=perf-m2-status-update`                                                                         |
| M2 (spot-check)               | `apps/ptah-electron-e2e/src/specs/editor/perf-m2-electron-spotcheck.spec.ts`    | `npx nx e2e ptah-electron-e2e -- editor/perf-m2-electron-spotcheck.spec.ts`                                                                           |
| M2 (scaling / B3 AC2)         | `libs/frontend/editor/src/lib/file-tree/perf-m2-indicator-scaling.spec.ts`      | `npx nx test @ptah-extension/editor --testPathPatterns=perf-m2-indicator-scaling`                                                                     |
| M3                            | `apps/ptah-electron-e2e/src/specs/editor/perf-m3-watcher-churn.{md,script.mjs}` | see procedure doc                                                                                                                                     |
| M4                            | `apps/ptah-electron-e2e/src/specs/editor/perf-m4-drag-cd.spec.ts`               | `npx nx e2e ptah-electron-e2e -- editor/perf-m4-drag-cd.spec.ts`                                                                                      |
