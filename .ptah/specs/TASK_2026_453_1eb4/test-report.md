# Test Report - TASK_2026_453_1eb4 (M0 baseline, Batch 2 / Task 2.1)

## Scope

- User request: measure the AC-11 baseline (M0) before any Stage 1 code (C1-C5) lands — open 3
  canvas tiles on ~2,000-event sessions, no renderer long task > 200 ms, total blocked time
  <= 1,500 ms, settle-inclusive window (`implementation-plan.md` AC-11; `batches.md` Task 2.1).
- Criteria tested: AC-11 exactly as written, using the Batch 1 harness
  (`tile-open-longtask-budget.perf.spec.ts` + `perf-page-capture.ts` + `perf-session-fixture.ts` +
  `perf-measurement-report.ts` + `perf-diagnostics.ts`), unmodified.
- Regressions covered: none (measurement-only batch, no code change).
- Review findings covered: none new; this is the first M0 run of the Batch 1 harness.
- Deliberately not tested: the M0-cv content-visibility-delta run (see "M0-cv" below — skipped,
  reason given); Stage 1 code (Batches 3-5, not yet built).

## Environment

- Worktree: `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks`, branch
  `perf/task-453-tile-open-long-tasks`.
- `git log --oneline -1`: `49b436256 test(electron-e2e): measure tile opens through settle and
exclude pre-window long tasks` — matches the required Batch 1 commit exactly.
- `git status --short`: `M .ptah/specs/TASK_2026_453_1eb4/batches.md` only (the team-leader's own
  in-progress status edit, present before this task started and untouched by this run). No
  product or spec file was modified for this measurement.
- Build: `ptah-electron` dev configuration (`build-main --configuration=development` +
  `copy-renderer-dev`) for every run except the one production-configured run, which used
  `build-main --configuration=production` + `copy-renderer` (no `project.json` edit), then the
  dev build was restored and confirmed via a second `build-main --configuration=development` +
  `copy-renderer-dev` pass (both exited 0; `git status --short` after restore still shows only
  `batches.md`, confirming no tracked file changed by either build).
- **Shared-machine condition affecting this baseline**: for roughly 50 minutes before the first
  run, the idle check (`Get-CimInstance Win32_Process ... jest-worker|run-executor`) returned a
  non-zero count continuously — a mix of short jest-worker bursts from other sessions and one
  long-lived `node.exe run-executor.js` process (PID 36040, created 2026-09-15 22:42:31, observed
  consuming CPU time continuously from ~11,220s to ~11,782s across two checks ~40 minutes apart,
  i.e. actively running, not hung-idle). The count first reached 0 at 02:23:47. The orchestrator
  separately reported that a peer session stopped that process (PID 36040, described as an
  orphaned Nx run) and held its own remaining verification passes until this M0 set finished; I
  did not independently verify that attribution (which process supervisor or command ended
  PID 36040) — the only thing measured directly here is the idle-check transition itself. Every
  run in this report was launched after that transition (all diagnostics-JSON timestamps
  1789514716165 onward, all later than the 02:23:47 idle confirmation), so none needed to be
  discarded on that basis. No run in this report was started, nor in progress, while the idle
  check showed non-zero immediately before it.
- Idle check command (per `handoff.md` §8 rule 4 / `batches.md` "Common rules"):
  `powershell -NoProfile -c "(Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | ? { $_.CommandLine -match 'jest-worker|run-executor' }).Count"`.
  Checked immediately before and immediately after every run below; every pair reported `0`/`0`.
  No run in this report was discarded (all first attempts were clean).
- Diagnostics directory: `D:\projects\ptah-453-perf\m0` (outside the repo, per instruction).
  Console logs of each run: `D:\projects\ptah-453-perf\m0-run1.log`, `m0-run2.log`, `m0-run3.log`,
  `m0-warm1.log`, `m0-warm3.log`, `m0-prod-cold.log`, `m0-raf-attribution.log`,
  `m0-trace-500.log`, `m0-trace-2000.log`.

## Suites

### AC-11 perf harness — end-to-end (Playwright + real Electron app)

- Requirement: no renderer long task > 200 ms; total long-task blocked time <= 1,500 ms across a
  settle-inclusive window opening 3 canvas tiles of ~2,000-event sessions.
- Cases run (all from the existing, unmodified Batch 1 spec file): the gating cold 3-tile test
  (asserting), the non-gating diagnostic cold 3-tile test (flags), warm 1-tile, warm 3-tile.
- Files (unmodified, read-only for this batch):
  `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\apps\ptah-electron-e2e\src\specs\chat\tile-open-longtask-budget.perf.spec.ts`,
  `...\src\support\perf-page-capture.ts`, `perf-session-fixture.ts`, `perf-measurement-report.ts`,
  `perf-diagnostics.ts`.

## Execution

### Idle checks

Every idle check below used the exact command in "Environment". Format: `before / after`.

| #   | Run                                           | Before | After |
| --- | --------------------------------------------- | ------ | ----- |
| 1   | Cold 3-tile dev, run I                        | 0      | 0     |
| 2   | Cold 3-tile dev, run J                        | 0      | 0     |
| 3   | Cold 3-tile dev, run K                        | 0      | 0     |
| 4   | Warm 1-tile                                   | 0      | 0     |
| 5   | Warm 3-tile                                   | 0      | 0     |
| 6   | Production build (build-main + copy-renderer) | 0      | 0     |
| 7   | Production cold 3-tile                        | 0      | 0     |
| 8   | Dev build restore                             | 0      | 0     |
| 9   | rAF-attribution cold diagnostic               | 0      | 0     |
| 10  | Trace cold diagnostic, 500 events             | 0      | 0     |
| 11  | Trace cold diagnostic, 2,000 events           | 0      | 0     |

No run was discarded; every pair above was clean on the first attempt.

### Run command pattern

`npx nx run ptah-electron-e2e:e2e -- src/specs/chat/tile-open-longtask-budget.perf.spec.ts --reporter=list -g "<title>"`
with `PTAH_PERF_SPECS=1`, `PTAH_PERF_OUT_DIR=D:\projects\ptah-453-perf\m0`, and the run's specific
flag(s) set in the same PowerShell process (unset otherwise). The production run invoked
`npx playwright test --config=playwright.config.ts ... --grep "cold: opening 3 tiles"` directly
from `apps/ptah-electron-e2e`, bypassing the `e2e` target's dev-build dependency chain, per
`test-report-b22.md`'s procedure.

### Cold 3-tile dev runs (asserting test, ×3) — the AC-11 gate

Command: `-g "cold: opening 3 tiles"`. All three FAILED the budget — this is the expected M0
outcome (AC-11 was NOT MET before this task; Batch 22/FU-22d already established this on an
earlier commit, and this is the first measurement on `49b436256`), not a harness failure. Every
run has `settled: true` (no "measurement unusable" throw), so all three are usable data points.

| Run | Wall (ms) | Long tasks | Max (ms) | Total (ms) | preWindowExcluded | DOM (replaying / settled) | Settled |
| --- | --------- | ---------- | -------- | ---------- | ----------------- | ------------------------- | ------- |
| I   | 8,822.80  | 15         | 1,926    | 6,941      | 2 tasks / 149 ms  | 21,113 / 4,980            | true    |
| J   | 7,158.80  | 17         | 1,326    | 5,463      | 2 tasks / 186 ms  | 20,931 / 5,935            | true    |
| K   | 5,923.70  | 11         | 1,062    | 4,077      | 2 tasks / 135 ms  | 20,881 / 4,904            | true    |

Per-tile buckets (click order; format count/max ms/total ms):

- Run I: TILE_0 1/255/255; TILE_1 1/112/112; TILE_2 13/1,926/6,574.
- Run J: TILE_0 1/125/125; TILE_1 1/74/74; TILE_2 15/1,326/5,264.
- Run K: TILE_0 1/117/117; TILE_1 1/95/95; TILE_2 9/1,062/3,865.

Per-marker buckets (Run I shown; J and K show the same shape — see the diagnostics JSON for full
detail): before-first-marker 4/1,816/2,254; TILE_0 4/1,926/3,340; TILE_1 5/498/1,212;
TILE_2 2/77/135. **Every run agrees: TILE_2 (the last tile clicked) carries 88-95% of the run's
total blocked time and produces the budget-busting max task, matching the FU-22d/Batch 22 finding
exactly** (`test-report-b22.md` "Verdict" point 2).

Diagnostics JSON: `D:\projects\ptah-453-perf\m0\ac11-perf-cold-3tile-1789514716165.json` (run I),
`...-1789514797099.json` (run J), `...-1789514867049.json` (run K).

### Warm-up diagnostics (not gated)

| Scenario    | Wall (ms) | Long tasks | Max (ms) | Total (ms) | DOM (replaying / settled) |
| ----------- | --------- | ---------- | -------- | ---------- | ------------------------- |
| Warm 1-tile | 1,837.90  | 5          | 179      | 474        | 2,482 / 1,952             |
| Warm 3-tile | 8,328.30  | 19         | 1,400    | 6,486      | 21,366 / 5,286            |

Warm 1-tile passes both budgets comfortably. Warm 3-tile per-tile (click order): WARM_TILE_0
1/100/100; WARM_TILE_1 1/58/58; WARM_TILE_2 17/1,400/6,328 — the same TILE_2-dominant,
concurrency-not-cold-start shape as the cold runs, confirming the Batch 22 conclusion still holds
on this commit.

Diagnostics JSON: `...\ac11-perf-warm-1tile-1789514932417.json`,
`...\ac11-perf-warm-3tile-1789515004612.json`.

### Production-configured cold run (×1)

Built via `npx nx run ptah-electron:build-main --configuration=production` then
`npx nx run ptah-electron:copy-renderer` (production resolves by default; no `project.json`
change), invoked directly with Playwright (bypassing `e2e`'s dev-build `dependsOn`), then restored
to dev via `build-main --configuration=development` + `copy-renderer-dev` (both exit 0;
`git status --short` after restore unchanged from before — only `batches.md`).

| Wall (ms) | Long tasks | Max (ms) | Total (ms) | preWindowExcluded | DOM (replaying / settled) |
| --------- | ---------- | -------- | ---------- | ----------------- | ------------------------- |
| 6,531.40  | 17         | 1,201    | 4,767      | 2 tasks / 122 ms  | 20,954 / 6,024            |

Per-tile: TILE_0 1/96/96; TILE_1 1/55/55; TILE_2 15/1,201/4,616. FAILS both budgets (max 6.0× over,
total 3.2× over) — smaller than every dev run but not close to passing, consistent with
`test-report-b22.md`'s production finding (max 973 ms / total 4,657 ms there; the P1-P3 scroll
work + C4 harness fix that landed since then account for the difference — see "Comparison" below).

Diagnostics JSON: `...\ac11-perf-cold-3tile-1789515097003.json`.

### rAF-attribution cold diagnostic (×1, `PTAH_PERF_RAF_ATTRIBUTION=1`)

Uses the non-gating "diagnostic: cold 3 tiles" test (the gating test hard-disables this flag, per
spec :230-231). Result: wall 6,755.80 ms (informational, not asserted), max 1,138, total 5,029,
settled true.

**rAF call-site histogram** (1,517 total captured calls), mapped to the plan's P3 table lines:

| Rank | Call site                                                                             | Count | Share | Plan ref                                                                       |
| ---- | ------------------------------------------------------------------------------------- | ----- | ----- | ------------------------------------------------------------------------------ |
| 1    | `scheduleFrame` (`execution-node.component.ts`)                                       | 1,339 | 88.3% | **E17**                                                                        |
| 2    | `chunk-7RUTJTPU.js:17766:7` (unattributed minified frame, same chunk as #4)           | 76    | 5.0%  | unresolved — see below                                                         |
| 3    | `_ChatTranscriptComponent.scheduleStickToBottom`                                      | 53    | 3.5%  | **E27**                                                                        |
| 4    | `scheduleCallbackWithRafRace` (confirmed in `@angular/core` source, `fesm2022/*.mjs`) | 30    | 2.0%  | **E26**                                                                        |
| 5    | `chunk-7RUTJTPU.js:17885:5` (unattributed minified frame)                             | 6     | 0.4%  | unresolved                                                                     |
| 6    | `_BatchedUpdateService.scheduleUpdate`                                                | 6     | 0.4%  | **E11**                                                                        |
| 7    | `eval` (Playwright's own injected evaluate context)                                   | 3     | 0.2%  | harness, not app                                                               |
| 8    | `_ChatTranscriptComponent.restoreScrollOnActivation`                                  | 3     | 0.2%  | **E27**                                                                        |
| 9    | `ResizeObserver.<anonymous>` (`main.js`)                                              | 1     | 0.1%  | unresolved (native observer callback, not a named rAF site in the plan's list) |

**A2 verdict: A2 is CONFIRMED, more specifically than assumed.** The plan's A2 hypothesis
("`FireAnimationFrame` dominated by execution-node rAF + Angular `animate.enter/leave`") named
`execution-node` `scheduleFrame` (E17) as one of five candidate sites; this measurement shows it
is not just a contributor but the overwhelming majority (88.3%) of every rAF call captured. This
directly **updates, not just confirms, the FU-22d attribution spike's finding** — that spike
(`fu22d-attribution-spike-report.md` §3d) read `execution-node.component.ts`'s own doc comment as
ruling `scheduleFrame` out, because its gating effect takes the synchronous `publishNow` branch
"for a resumed/finalized session (this fixture's entire content)". That reasoning does not hold
for this AC-11 harness: `SessionHistoryReplayer` (Batch 20) replays a resumed session's events in
chunks with `yieldToMacrotask` between them, so each execution node genuinely **streams** during
replay (`isNodeStreaming()` is true chunk-by-chunk, not resolved-and-finalized instantly) — the
rAF-gated path in `scheduleFrame`'s effect is exactly the one taken, once per node per streamed
chunk. E27 (transcript scroll-stick) and E26 (Angular's own zoneless rAF-race scheduler,
confirmed in `@angular/core`'s bundled source) are both present but minor (3.5% and 2.0%
respectively); E11 (`BatchedUpdateService.scheduleUpdate`) is present but negligible (0.4%). E23
(Angular `animate.enter`/`animateLeaveClassRunner`) does not appear as a distinct rAF call site in
this list at all — Angular's animation callbacks may route through `scheduleCallbackWithRafRace`
(counted under E26) rather than calling `requestAnimationFrame` directly from user-visible
animation-runner code, so this measurement cannot separately confirm or refute E23's own rAF
usage; it can only confirm E26 fires 30 times. The two unattributed minified frames (82 calls,
5.4% combined) are a residual gap — they sit in the same bundle chunk (`chunk-7RUTJTPU.js`) as the
confirmed `scheduleCallbackWithRafRace` frame and are plausibly more Angular-internal scheduler
code, but this measurement cannot name them without de-minifying that chunk or resolving source
maps, which was out of scope for this run.

Diagnostics JSON: `...\ac11-perf-diagnostic-cold-3tile-2000-1789515190816.json`.

### Trace captures (`PTAH_PERF_TRACE=1`), 500 and 2,000 events

Both use the non-gating diagnostic test with `PTAH_PERF_EVENTS` overriding the per-session count
(diagnostic-only; the asserting test always uses 2,000 and never trace).

| Events | Wall (ms) | Max (ms) | Total (ms) | Settled | DOM (replaying / settled) |
| ------ | --------- | -------- | ---------- | ------- | ------------------------- |
| 500    | 3,053.20  | 325      | 1,394      | true    | 5,578 / 3,912             |
| 2,000  | 6,666.60  | 1,688    | 4,755      | true    | 21,060 / 4,908            |

**Trace summary, main-thread-only categories, both sizes** (durations in ms; the trace's own
`totalMs` sums every distinct event name and is not a clean denominator because `RunTask` and
similar wrapper events nest around the others — shares below are each row's own duration as a
percentage of that run's wall-clock window, the same convention `fu22d-attribution-spike-report.md`
used):

| Category                          | 500 events (count / ms / % of wall) | 2,000 events (count / ms / % of wall) | Δ count   |
| --------------------------------- | ----------------------------------- | ------------------------------------- | --------- |
| **FireAnimationFrame**            | 448 / 229.30 / 7.5%                 | 1,386 / 1,257.53 / 18.9%              | **×3.09** |
| UpdateLayoutTree                  | 115 / 495.08 / 16.2%                | 114 / 1,007.90 / 15.1%                | ×0.99     |
| Layout                            | 49 / 226.84 / 7.4%                  | 65 / 542.84 / 8.1%                    | ×1.33     |
| Layerize                          | 27 / 152.06 / 5.0%                  | 31 / 109.35 / 1.6%                    | ×1.15     |
| Paint                             | 561 / 149.92 / 4.9%                 | 1,367 / 243.56 / 3.7%                 | ×2.44     |
| PrePaint                          | 354 / 107.65 / 3.5%                 | 485 / 253.44 / 3.8%                   | ×1.37     |
| HitTest                           | 23 / 19.23 / 0.6%                   | 30 / 59.41 / 0.9%                     | ×1.30     |
| Commit                            | 27 / 25.26 / 0.8%                   | 31 / 54.61 / 0.8%                     | ×1.15     |
| **Layout/Paint/GPU family total** | — / 1,176.04 / 38.5%                | — / 2,211.70 / 33.2%                  | —         |
| RunMicrotasks                     | 411 / 492.57 / 16.1%                | 1,242 / 2,090.88 / 31.4%              | ×3.02     |
| FunctionCall                      | 1,634 / 844.22 / 27.7%              | 4,493 / 1,800.05 / 27.0%              | ×2.75     |
| TimerFire                         | 359 / 559.71 / 18.3%                | 890 / 426.42 / 6.4%                   | ×2.48     |
| MajorGC + MinorGC                 | 4 / 33.05 / 1.1%                    | 8 / 106.65 / 1.6%                     | —         |

No `GPUTask` row was reported by either capture (this build/GPU path did not surface it as a
named trace event under the categories collected — unlike the FU-22d spike's Electron/Chromium
build, which did report it at ~682 ms; not investigated further here, out of scope for M0).

**FireAnimationFrame scaling verdict**: count goes from 448 (500 events) to 1,386 (2,000 events) —
a **3.09× increase for a 4× increase in events**, i.e. sub-linear but clearly scaling with event
volume, not flat. Combined with the rAF-attribution histogram showing `scheduleFrame` (E17) as
88.3% of all rAF calls, **this is direct, source-cited evidence that `FireAnimationFrame`'s
dominant caller is per-node/per-chunk** (execution-node `scheduleFrame`, driven by
`SessionHistoryReplayer`'s chunked replay creating one streaming update per node per chunk), not a
fixed per-tile-open cost and not, per the FU-22d spike's own already-measured finding, primarily
`@formkit/auto-animate`. This closes the FU-22d spike's largest open item ("What remains unknown"
#1) with a specific, named source rather than leaving it as a ruled-out-by-elimination residual.

Diagnostics JSON: `...\ac11-perf-diagnostic-cold-3tile-500-1789515270688.json`,
`...\ac11-perf-diagnostic-cold-3tile-2000-1789515342074.json`.

### DOM node counts (all runs, replaying vs settled)

Every cold/warm 3-tile run's "replaying" sample (taken at the first marker's appearance, per the
harness's own doc) is **4-4.3× the settled count** (e.g. run I: 21,113 replaying vs 4,980 settled;
2,000-event trace run: 21,060 vs 4,908). The single 500-event run shows a smaller ratio (5,578 vs
3,912, ~1.4×), consistent with less total content in flight at the sampling instant. Warm 1-tile
(the only case where `allMarkersPresent: true` at the replaying sample) shows 2,482 vs 1,952
(~1.27×). **This is the M0 baseline against which Batch 5 (C5)'s own acceptance criterion — "DOM
node count per tile during replay is at most 2× the post-finalize count" — must be judged in M1**:
at M0, the 3-tile cold/warm cases sit at roughly 4×, well above the 2× ceiling C5 targets, which is
consistent with (not proof of, without per-tile breakdown) the FU-22d spike's Step 4 finding that
the always-mounted tail's nested execution-node trees are not virtualized.

### M0-cv (content-visibility delta) — SKIPPED

Not run. Reasoning per the plan's own instruction (`implementation-plan.md` :509-516): this run is
optional and only worth doing "if cheap." The cheapest path (C4 ready before the scroll work
merges) does not apply — the scroll work (PR #519) already merged and removed `.chat-msg-cv`
before this task started, so the only remaining path is a temporary local re-add of the removed
CSS rule and class, one measured run, then a byte-for-byte restore confirmed by `git status`/`git
diff` — the FU-22d-precedent path this repo has used before for exactly this kind of one-off
diagnostic patch. That path requires editing product CSS/template files (even temporarily) and a
renderer rebuild before _and_ after, on top of the 9 runs already completed under a
tightly-contended shared machine. Given this task's already-large run set and that the scroll
work's `content-visibility` removal is orthogonal to the AC-11 miss this baseline is measuring
(the miss is dominated by `scheduleFrame`/layout-paint work, not by content-visibility), this was
judged not cheap enough to justify under this session's time budget, and is left for whoever picks
up Stage 2 sizing (or a dedicated follow-up) if it is later judged necessary.

## Comparison with the old Batch 22 / FU-22d window numbers

| Metric          | Batch 22 rev. 4 (older commit, cold 3-tile mean of 3) | FU-22d spike (same base, replicated) | **This M0 (commit `49b436256`)**     |
| --------------- | ----------------------------------------------------- | ------------------------------------ | ------------------------------------ |
| Max (ms)        | 1,520 (mean of 1,493/1,705/1,864)                     | 1,165 / 988 (2 replication runs)     | 1,926 / 1,326 / 1,062 (this run set) |
| Total (ms)      | 5,745 (mean of 5,404/6,193/5,639)                     | 6,292 / 4,195                        | 6,941 / 5,463 / 4,077                |
| Production cold | max 973, total 4,657                                  | not re-run                           | **max 1,201, total 4,767**           |

**Why the numbers differ, not just that they do**: this M0 run is on `49b436256`, which sits
_after_ PR #518 (scroll fixes) and PR #519 (transcript-scroll-fighting fix) landed on `main`, and
after this task's own Batch 1 (C4: the settle-inclusive window, pre-window exclusion, and the
click-timestamp-before-dispatch fix) replaced the harness those older reports used. The older
reports' own numbers are themselves not directly comparable to each other either (Batch 22's
harness excluded Playwright-locator noise; the FU-22d spike reused that same harness unmodified).
Two concrete, source-backed differences this task's harness makes over Batch 22's:

1. **Settle-inclusive window** (Task 1.1, AC 5): the window here stays open until 1,000 ms of DOM
   quiet after the last marker, whereas Batch 22's window closed at the last marker itself. This
   measures additional post-marker settling work (continued animation, scroll-restore, etc.) that
   Batch 22's numbers did not include, which plausibly explains why this M0's totals sit at the
   higher end of Batch 22's own 3-run spread rather than below it, even on a codebase carrying
   two additional bug-fix PRs since.
2. **Click-timestamp-before-dispatch and pre-window exclusion** (CodeRabbit 3 and 1, Task 1.1):
   this harness's `windowStartMs` is recorded strictly before the first click and long tasks
   starting earlier are excluded and reported separately (`preWindowExcluded`, 2 tasks / 122-186 ms
   in every run above) rather than silently folded into the asserted total, which the older
   harness did not do explicitly.

Both changes make this M0 measurement **methodologically stricter/more complete**, not more
lenient, than the numbers it is being compared against — a reader should not read this run set's
larger totals as a regression in the product; it is at least partly a wider, more honest window.
The _shape_ of the finding is unchanged and reconfirmed on this commit: TILE_2 (last-clicked)
dominance, warm-3-tile not smaller than cold-3-tile, and production smaller-but-still-failing.

## M0 conclusion — the gap to AC-11

**AC-11 is NOT MET on `49b436256`, in dev build (3/3 clean cold runs) and in production build
(1/1 clean run).**

| Metric               | Budget      | Dev cold runs (I / J / K) | Production cold | Gap (production, the best case) |
| -------------------- | ----------- | ------------------------- | --------------- | ------------------------------- |
| Max single long task | <= 200 ms   | 1,926 / 1,326 / 1,062 ms  | 1,201 ms        | **6.0× over**                   |
| Total blocked time   | <= 1,500 ms | 6,941 / 5,463 / 4,077 ms  | 4,767 ms        | **3.2× over**                   |

- The miss remains concentrated in whichever tile is opened last (TILE_2: 88-95% of blocked time
  in every run), matching Batch 22/FU-22d exactly — **this is not new information, but it is
  reconfirmed on the current commit, which is the point of an M0 baseline.**
- **New finding this M0 run set adds beyond FU-22d**: the rAF call-site histogram + the
  500-vs-2,000-event `FireAnimationFrame` scaling (3.09× count for 4× events) together identify
  `execution-node.component.ts`'s `scheduleFrame` (E17) as the confirmed dominant rAF caller
  (88.3% of all captured calls), correcting the FU-22d spike's "ruled out" reading of that same
  site — the spike's reasoning assumed a resumed/finalized session takes the synchronous
  `publishNow` branch, but `SessionHistoryReplayer`'s chunked replay makes every node stream
  chunk-by-chunk, so the rAF-gated branch is the one actually exercised during a tile open.
  **This directly supports Batch 4's C1 (motion gate: `historyReplaying` suppresses
  `animate.enter`/`leave` and, by the same `isFinalizing` signal already threaded through
  `execution-node.component.ts:127,362-364`, the `scheduleFrame` rAF path too)** — C1 was already
  scoped to gate exactly this kind of per-node rAF scheduling during replay, and this M0 evidence
  is now a direct, named justification for why it should help, rather than an inference from an
  ambiguous CPU-profile bucket.
- DOM node counts confirm the FU-22d Step 4 hypothesis's directional shape at the whole-canvas
  level (replaying ≈ 4× settled for the 3-tile cases) without yet isolating it per tile — Batch 5
  (C5)'s own M1 acceptance criterion (per-tile replaying <= 2× settled) is the right place to
  re-measure this with per-tile granularity once C5 lands.
- Main-thread trace shares at 2,000 events: Layout/Paint/GPU family ~33.2% of wall time,
  `FireAnimationFrame` ~18.9%, `RunMicrotasks` (chunked-replay yields + Angular's own microtask
  drain) ~31.4%, `FunctionCall` (generic native/JS boundary, not attributable further by name
  alone) ~27.0% — these overlap (nested wrapper events), so they do not sum to 100%; they are
  reported as each category's own share of the wall-clock window, matching the FU-22d spike's own
  convention, not as a clean partition.
- **Nothing here changes the Stage 1 expectations already recorded in `implementation-plan.md`**:
  C1 (replay motion gate, including the newly-confirmed `scheduleFrame` rAF path), C2 (one
  replay-and-finalize at a time), C3 (canvas request queue), and C5 (render-window fence,
  DOM-volume reduction during replay) remain the planned Stage 1 batches. This M0 baseline gives
  Batch 6 (M1) a same-commit-lineage, same-harness set of numbers to diff against, and gives C1 a
  more specific rAF target (E17's `scheduleFrame`, not a blend of five candidate sites) than the
  plan had before this measurement.

## Verdict

- Criteria proven: the Batch 1 harness runs unmodified on `49b436256`; every run in this report
  passed both idle checks (before AND after); no run threw "measurement unusable"; the required
  run set (cold ×3, warm ×2, production ×1, rAF-attribution ×1, trace ×2) is complete; diagnostics
  JSON exists for every run at `D:\projects\ptah-453-perf\m0`; the dev build was restored and the
  restore verified.
- Criteria not proven: AC-11 itself — confirmed NOT MET (see table above); this was expected going
  into M0 and is the reason Stage 1 (Batches 3-5) exists.
- Risks a reader should know about:
  - This M0 baseline was captured on a machine that was heavily contended for about 50 minutes
    immediately before the first run (see "Environment"); every recorded run's own idle check was
    clean, but a reader relying on this report to reproduce identical wall-clock numbers on a
    different machine load profile should expect variance in `wall` even though `max`/`total`
    (which come from `PerformanceObserver('longtask')`, not wall-clock polling) are the harness's
    own claim to be load-independent within the measured window.
  - The two minified rAF call sites (5.4% combined) remain unattributed; resolving them would need
    source-map de-minification not attempted here.
  - `GPUTask` did not appear in this build/Electron version's trace capture, unlike the FU-22d
    spike's own trace — not investigated further; if a future measurement needs GPU-process cost
    specifically, this is a known gap.
  - M0-cv (content-visibility delta) was skipped as not cheap enough this session — see the
    "M0-cv" section above for the specific reasoning, so a reader can decide whether to still want
    it before Stage 2 sizing.
  - DOM node ratios (replaying vs settled) are whole-canvas totals across all 3 tiles, not
    per-tile; Batch 5/M1 needs its own per-tile measurement to check against the <= 2× target.

---

# M1 — post-Stage-1 measurement (Batch 6 / Task 6.1)

## Scope

- User request: re-measure AC-11 after C1 (replay motion gate), C2 (one replay-and-finalize at a
  time), C3 (canvas request queue) and C5 (render-window fence) all landed, and return an AC-11
  verdict. Measurement only — no product or spec code was changed to produce this section.
- Criteria tested: AC-11 exactly as written, using the Batch 1 harness, unmodified since M0.
- Regressions covered: none fixed here (this is a measurement batch); a NEW functional regression
  was found and is reported below (scroll sanity), not fixed.
- Review findings covered: Batch 5's A8 residual (scheduleFrame share on the new, smaller rAF
  total) and its scroll tail-shift residual risk are both addressed by direct measurement below.
- Deliberately not tested: per-tile DOM breakdown could not be produced — see "Known measurement
  gap" below; Stage 2 code (none written, per the task's own gate).

## Environment

- Worktree: `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks`, branch
  `perf/task-453-tile-open-long-tasks`.
- `git log --oneline -1` before AND after every run in this section: `0149adef8 docs(task-specs):
  record the TASK_2026_453 batch 5 commit hash` — the required Batch 5 commit, unchanged throughout.
- `git status --short`: clean (no output) before the first run and after the last run of this
  section. No product, spec or harness file was modified to produce M1.
- Build: `ptah-electron` dev configuration for every run except the one production-configured run
  (`build-main --configuration=production` + `copy-renderer`), which was restored to dev afterward
  (`build-main --configuration=development` + `copy-renderer-dev`, both exit 0) and re-confirmed
  clean via `git status --short` and via the subsequent dev-mode runs (rAF attribution, both trace
  runs) succeeding against the restored dev build.
- Idle check command (identical to M0):
  `powershell -NoProfile -c "(Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | ? { $_.CommandLine -match 'jest-worker|run-executor' }).Count"`.
  Checked immediately before and immediately after every run below (13 attempts total, including
  the 2 retries described under "Scroll sanity" — reconciled with the idle-check table below and
  the M1 Verdict section, both of which list 13; an earlier draft of this sentence said 11, which
  undercounted the 2 retries themselves as attempts); every check returned `0`. The machine was
  otherwise idle for this entire session — unlike M0, there was no contended-machine period to
  report. No run was discarded for idle contamination (the only two runs not used as clean
  perf data points failed a functional assertion inside the test itself, not the idle gate — see
  "Scroll sanity" below, which is a distinct failure mode from contamination and is not silently
  re-run-and-hidden).
- Diagnostics directory: `D:\projects\ptah-453-perf\m1` (outside the repo). Console logs:
  `D:\projects\ptah-453-perf\m1-run1.log`, `m1-run2.log`, `m1-run3.log` (scroll-sanity failure),
  `m1-run3b.log` (clean retry used as the 3rd cold data point), `m1-warm1.log`, `m1-warm3.log`,
  `m1-prod-build-main.log`, `m1-prod-copy-renderer.log`, `m1-prod-cold.log`,
  `m1-raf-attribution.log`, `m1-trace-500.log`, `m1-trace-2000.log` (scroll-sanity failure),
  `m1-trace-2000b.log` (clean retry used as the trace-2000 data point).

## Idle checks

| # | Run | Before | After |
| - | --- | ------ | ----- |
| 1 | Cold 3-tile dev, run 1 | 0 | 0 |
| 2 | Cold 3-tile dev, run 2 | 0 | 0 |
| 3 | Cold 3-tile dev, run 3 (scroll sanity FAILED — no measurement written) | 0 | 0 |
| 3b | Cold 3-tile dev, run 3 retry (clean; used as the 3rd cold data point) | 0 | 0 |
| 4 | Warm 1-tile | 0 | 0 |
| 5 | Warm 3-tile | 0 | 0 |
| 6 | Production build (build-main + copy-renderer) | 0 | 0 |
| 7 | Production cold 3-tile | 0 | 0 |
| 8 | Dev build restore | 0 | 0 |
| 9 | rAF-attribution cold diagnostic | 0 | 0 |
| 10 | Trace cold diagnostic, 500 events | 0 | 0 |
| 11 | Trace cold diagnostic, 2,000 events (scroll sanity FAILED — no measurement written) | 0 | 0 |
| 11b | Trace cold diagnostic, 2,000 events retry (clean) | 0 | 0 |

No run was discarded for idle contamination. Two runs (#3, #11) hit a genuine functional assertion
inside the test (scroll sanity) before the perf measurement was computed or written, so they carry
no `max`/`total`/DOM numbers of their own; each was retried once, cleanly, immediately after (same
idle-0 condition), and the retry supplies that slot's perf data point. The scroll-sanity failures
themselves are reported in full below — they are a finding, not noise to discard.

**Disclosed bias risk on the AC-11 sample (added on methodology review)**: the retry substitution
could not recover what the failed attempt's own long-task numbers would have been — `m1-run3.log`
and `m1-trace-2000.log` (the two failed attempts) contain no `[AC-11 perf] wall=...` or `[AC-11
perf]   long task at ...` lines at all (checked directly: `grep -in "long task"` on both files
matches only the Playwright test-title string, not a measurement line), because `assertScrollSanity`
throws before `summarizeMeasurement`/`writeDiagnostics` runs. Scroll-sanity failure is **not proven
independent of long-task severity**: `scheduleStickToBottom` is the single largest rAF call site in
this M1 run set (38.1% of all captured rAF calls, see "rAF-attribution cold diagnostic" below), and
a scroll-sanity failure is by definition a run where that same scroll-correction machinery
misbehaved. It is plausible, not certain, that a run where scroll-stick logic is visibly
malfunctioning also does more corrective layout/rAF work than the clean retries that replaced it in
the cold-dev table below. **The reported 3-run cold-dev sample should therefore be read as a lower
bound on the true AC-11 gap, not a symmetric, unbiased sample** — this matters directly for sizing
the Stage 2 decision below.

## Scroll sanity (every run)

`assertScrollSanity` runs before the perf measurement is computed, so a failure here pre-empts
that run's diagnostics write entirely (confirmed by reading
`apps/ptah-electron-e2e/src/specs/chat/tile-open-longtask-budget.perf.spec.ts:281-289`, `:354-381`,
`:502-541`: `assertScrollSanity` is called before `summarizeMeasurement`/`writeDiagnostics` in all
three tests it appears in).

| Run | Result | Detail |
| --- | ------ | ------ |
| Cold dev run 1 | PASS | — |
| Cold dev run 2 | PASS | — |
| Cold dev run 3 | **FAIL** | `TILE_1` 132 px from bottom (budget 120 px) |
| Cold dev run 3 retry | PASS | — |
| Warm 1-tile | PASS | — |
| Warm 3-tile | PASS | — |
| Production cold | PASS | — |
| rAF-attribution cold | PASS | — |
| Trace cold, 500 events | PASS | — |
| Trace cold, 2,000 events | **FAIL** | `TILE_2` 31,155 px from bottom (budget 120 px) |
| Trace cold, 2,000 events retry | PASS | — |

**This is a new functional finding, not present at M0** (M0 had no scroll-sanity failures in its
9 runs, though M0 predates C5, which is the component that introduced tail-shift placeholder
mounting during replay). **2 of 11 attempts (18%) failed scroll sanity**, both on the
last-clicked/still-replaying tile, with wildly different magnitudes (132 px vs 31,155 px — the
second is not a rounding-level miss, it is the tile scrolled to nowhere near its own content).

**Correction (Batch 8)**: "both on the last-clicked/still-replaying tile" above is wrong for the
132 px case. `TILE_1` (cold dev run 3, row above) is the **middle** tile, not the last-clicked one
— `TILE_2` is the last-clicked tile. Both `TILE_1` and `TILE_2` had a replay queued behind C2's
admission, which is why both were susceptible; only the "last-clicked" label was misapplied. The
original numbers (132 px, 31,155 px) are unchanged. See `scroll-regression-analysis.md` F5.

This matches exactly the residual risk `batches.md` recorded for Task 5.1 ("the tail-shift case ...
is timing dependent and jsdom has no layout, so it cannot be proven by a unit spec. It is covered
by the C4 post-window scroll sanity check in M1. If that check fails, the fix stays inside C5").
**Per this task's own instruction, no fix is made here** — this is reported as a blocking
functional regression for the orchestrator/architect to route, not sized into a Stage 2 perf
option. It is orthogonal to the AC-11 perf verdict below but must not be read as "AC-11 nearly
passed" without also reading this.

## Cold 3-tile dev runs (asserting test) — the AC-11 gate

| Run | Wall (ms) | Long tasks | Max (ms) | Total (ms) | preWindowExcluded | DOM (replaying / settled) | Ratio | Settled |
| --- | --------- | ---------- | -------- | ---------- | ------------------ | -------------------------- | ----- | ------- |
| 1  | 4,868.10 | 33 | 220 | 3,226 | 2 tasks / 219 ms | 1,790 / 4,900 | 0.365× | true |
| 2  | 6,965.40 | 40 | 337 | 4,927 | 2 tasks / 280 ms | 1,798 / 7,308 | 0.246× | true |
| 3 retry | 3,876.00 | 25 | 185 | 2,169 | 2 tasks / 167 ms | 1,794 / 5,912 | 0.303× | true |

All three FAIL the total budget (>1,500 ms); run 3-retry alone passes the max budget (185 <= 200);
runs 1 and 2 fail both. No run threw "measurement unusable" — all three are usable data points.
Run 3's original attempt (scroll-sanity failure, no perf data) is reported separately above and
not counted toward this table or the verdict.

Per-tile buckets (click order; count/max ms/total ms):

- Run 1: TILE_0 1/162/162; TILE_1 2/117/168; TILE_2 30/220/2,896.
- Run 2: TILE_0 1/240/240; TILE_1 2/124/188; TILE_2 37/337/4,499.
- Run 3-retry: TILE_0 1/114/114; TILE_1 1/70/70; TILE_2 23/185/1,985.

Per-marker buckets (count/max ms/total ms):

- Run 1: before-first-marker 5/220/671; TILE_0 3/107/294; TILE_1 17/142/1,696; TILE_2 8/117/565.
- Run 2: before-first-marker 5/332/896; TILE_0 15/257/1,767; TILE_1 15/337/1,636; TILE_2 5/243/628.
- Run 3-retry: before-first-marker 4/165/406; TILE_0 4/81/262; TILE_1 12/185/1,127; TILE_2 5/126/374.

**TILE_2 (last-clicked) still carries the large majority of blocked time** (e.g. run 1: 2,896 of
3,226 ms = 89.8%), so the shape of the M0 finding is unchanged even though the magnitude has
dropped sharply — Stage 1 reduced the per-node rAF cost underneath that shape, it did not change
which tile pays for admission-queue ordering (expected: C2 serializes replay-and-finalize FIFO, so
the last-admitted tile's own marker always arrives after the other two have fully replayed).

Per-tile wall time (C2 admission latency cost — click timestamp to that tile's own marker):

| Run | TILE_0 (ms) | TILE_1 (ms) | TILE_2 (ms) |
| --- | ----------- | ----------- | ----------- |
| 1 | 808.1 | 1,070.6 | 2,735.5 |
| 2 | 1,074.9 | 2,778.4 | 4,587.7 |
| 3 retry | 534.2 | 760.4 | 1,985.4 |
| Production | 582.3 | 776.8 | 783.4 |
| rAF-attribution | 646.5 | 918.6 | 2,626.8 |

This is the visible cost of C2's FIFO admission: TILE_2 (admitted last) waits for TILE_0 and
TILE_1's replay-and-finalize to fully vacate the admission slot before its own chunks can run, so
its own click-to-marker latency is consistently 2-5× TILE_0's. The production run is the outlier
with a nearly flat TILE_1/TILE_2 latency (776.8 vs 783.4 ms) — consistent with production's overall
much lower per-chunk cost leaving less queue time to accumulate.

Diagnostics JSON: `D:\projects\ptah-453-perf\m1\ac11-perf-cold-3tile-1789576078004.json` (run 1),
`...-1789576178284.json` (run 2), `...-1789576362929.json` (run 3 retry). Run 3's original,
scroll-sanity-failing attempt wrote no diagnostics JSON (the throw happens before the write).

## Warm-up diagnostics (not gated)

| Scenario | Wall (ms) | Long tasks | Max (ms) | Total (ms) | preWindowExcluded | DOM (replaying / settled) | Ratio |
| -------- | --------- | ---------- | -------- | ---------- | ------------------ | -------------------------- | ----- |
| Warm 1-tile | 1,760.60 | 4 | 85 | 279 | 5 tasks / 458 ms | 2,772 / 2,018 | 1.374× |
| Warm 3-tile | 5,400.20 | 36 | 382 | 3,330 | 4 tasks / 357 ms | 1,830 / 8,680 | 0.211× |

**Correction (methodology review)**: warm 1-tile's `preWindowExcluded` is not "n/a" — the raw JSON
(`ac11-perf-warm-1tile-1789576438127.json`) records `{"count": 5, "totalMs": 458}`, i.e. **5 long
tasks totalling 458 ms were excluded before the measured window opened, which is larger than the
run's own in-window total of 279 ms**. This does not change the verdict (warm scenarios are not
gated), but it means most of this scenario's long-task activity happened before the window this
report measures, which a reader comparing it to the gated cold runs (2 tasks / ~150-280 ms
pre-window each) should know.

Warm 1-tile passes both in-window budgets comfortably (as at M0), though see the pre-window
correction above. Warm 3-tile is not gated but its shape is unchanged: WARM_TILE_2 (click order)
carries 33 of 36 long tasks and 3,121 of 3,330 ms total (93.7%) — the same TILE_2-dominant pattern
as the cold runs, at much lower absolute magnitude than M0's warm-3-tile (max 1,400 / total 6,486
ms there vs 382 / 3,330 ms here).

Diagnostics JSON: `...\ac11-perf-warm-1tile-1789576438127.json`,
`...\ac11-perf-warm-3tile-1789576512443.json`.

## Production-configured cold run (×1)

| Wall (ms) | Long tasks | Max (ms) | Total (ms) | preWindowExcluded | DOM (replaying / settled) | Ratio | Settled |
| --------- | ---------- | -------- | ---------- | ------------------ | -------------------------- | ----- | ------- |
| 2,465.90 | 11 | **166** | **985** | 2 tasks / 202 ms | 1,786 / 4,884 | 0.366× | true |

**PASSES both budgets** (max 166 <= 200; total 985 <= 1,500) — the first clean production pass in
this task's history (M0 production: max 1,201 / total 4,767, both failing). Per-tile: TILE_0
1/108/108; TILE_1 1/90/90; TILE_2 9/166/787 (79.9% of the run's total). Per-marker:
before-first-marker 4/166/434; TILE_0 1/96/96; TILE_1 1/66/66; TILE_2 5/104/389.

Diagnostics JSON: `...\ac11-perf-cold-3tile-1789576579026.json`.

## rAF-attribution cold diagnostic (×1, `PTAH_PERF_RAF_ATTRIBUTION=1`)

Wall 4,625.60 ms (informational), max 307, total 2,866, settled true. DOM 1,798 / 7,608 (0.236×).

**rAF call-site histogram** (139 total captured calls — down from M0's 1,517, a **10.9× reduction
in the number of rAF calls made at all** during the same scenario):

| Rank | Call site | Count | Share (M1) | M0 count | M0 share | Plan ref |
| ---- | --------- | ----- | ---------- | -------- | -------- | -------- |
| 1 | `_ChatTranscriptComponent.scheduleStickToBottom` | 53 | **38.1%** | 53 | 3.5% | E27 |
| 2 | `scheduleCallbackWithRafRace` (`@angular/core`) | 40 | 28.8% | 30 | 2.0% | E26 |
| 3 | unattributed minified frame (`chunk-5TA74SBW.js:17766:7`) | 14 | 10.1% | 76 | 5.0% | unresolved |
| 4 | `_BatchedUpdateService.scheduleUpdate` | 10 | 7.2% | 6 | 0.4% | E11 |
| 5 | `scheduleFrame` (`execution-node.component.ts`) | **7** | **5.0%** | **1,339** | **88.3%** | **E17** |
| 6 | unattributed minified frame (`chunk-5TA74SBW.js:17885:5`) | 6 | 4.3% | 6 | 0.4% | unresolved |
| 7 | Playwright's own injected evaluate context | 3 | 2.2% | 3 | 0.2% | harness |
| 8 | `_ChatTranscriptComponent.restoreScrollOnActivation` | 3 | 2.2% | 3 | 0.2% | E27 |
| 9 | unattributed minified frame (`chunk-TWWQF5SG.js:14413:19`) | 2 | 1.4% | — | — | unresolved (new site, not in M0's list) |
| 10 | `ResizeObserver.<anonymous>` | 1 | 0.7% | 1 | 0.1% | unresolved |

**A8 verdict: CONFIRMED — `scheduleFrame` (E17) drops from 88.3% of 1,517 calls to 5.0% of 139
calls, i.e. an absolute count drop from 1,339 to 7 (a 191× reduction), and its new share (5.0%) is
below the ~10% threshold the residual check asked for, on a total that is itself 10.9× smaller.**
This is direct confirmation that C1 (motion gate) + C5 (render-window fence) together removed the
per-node/per-chunk rAF cost that M0 identified as the dominant contributor: with C5, a replayed
node's text renders via the synchronous `publishNow` path (not streaming) because it is outside the
render window's streaming boundary, so `scheduleFrame`'s rAF-gated branch is very rarely taken
during replay now. The remaining rAF traffic is dominated by `scheduleStickToBottom` (E27, scroll
work — unrelated to this task and untouched by it) and Angular's own `scheduleCallbackWithRafRace`
(E26) — both were minor absolute contributors at M0 too (53 and 30 calls) and are now a larger
*share* only because the total pie shrank around them, not because either grew. `E23`
(`animate.enter`/`animateLeaveClassRunner`) still does not appear as a distinct site, same as M0.

Diagnostics JSON: `...\ac11-perf-diagnostic-cold-3tile-2000-1789576658910.json`.

## Trace captures (`PTAH_PERF_TRACE=1`), 500 and 2,000 events

| Events | Wall (ms) | Max (ms) | Total (ms) | preWindowExcluded | Settled | DOM (replaying / settled) | Ratio |
| ------ | --------- | -------- | ---------- | ------------------ | ------- | -------------------------- | ----- |
| 500 | 2,156.80 | 130 | 537 | 2 tasks / 159 ms | true | 1,122 / 2,900 | 0.387× |
| 2,000 | 3,806.80 | 193 | 2,129 | 2 tasks / 152 ms | true | 1,790 / 6,644 | 0.269× |

(`preWindowExcluded` added on methodology review — this closes the gap `batches.md`'s Batch 2
outcome item 5 flagged, which M0 had also omitted from its trace table; the field is present in
both raw JSON files and was simply not carried into this table in the first draft.)

(The 2,000-event data point above is from the clean retry; the first 2,000-event attempt failed
scroll sanity before writing diagnostics — see "Scroll sanity".)

**`FireAnimationFrame` count, M1 vs M0:**

| Events | M1 count | M1 ms | M0 count | M0 ms | M1/M0 count ratio |
| ------ | -------- | ----- | -------- | ----- | ------------------ |
| 500 | 49 | 144.18 | 448 | 229.30 | **0.109× (9.1× fewer)** |
| 2,000 | 86 | 402.44 | 1,386 | 1,257.53 | **0.062× (16.1× fewer)** |

**FireAnimationFrame scaling verdict**: M1's own count goes 49 → 86 for a 4× increase in events —
a **1.76× scaling factor**, well below M0's 3.09×. Combined with the rAF histogram (`scheduleFrame`
now 5.0% of a much smaller total), this is consistent, source-cited confirmation that C1+C5 cut the
per-node/per-chunk `FireAnimationFrame` cost that M0's `SessionHistoryReplayer`-chunked-replay
finding identified, at both event sizes, not just in aggregate.

**Main-thread trace shares** (each row's own duration as % of that run's wall-clock window, same
convention as M0 and `fu22d-attribution-spike-report.md`):

| Category | 500 events (count / ms / % of wall) | 2,000 events (count / ms / % of wall) | M0 2,000-events % | Δ vs M0 |
| -------- | ------------------------------------ | --------------------------------------- | ------------------- | ------- |
| **FireAnimationFrame** | 49 / 144.18 / 6.69% | 86 / 402.44 / **10.57%** | 18.9% | down 8.3 pts |
| UpdateLayoutTree | 100 / 277.86 / 12.88% | 163 / 696.55 / 18.30% | 15.1% | up 3.2 pts |
| Layout | 39 / 145.61 / 6.75% | 68 / 265.02 / 6.96% | 8.1% | down 1.1 pts |
| Layerize | 29 / 38.93 / 1.81% | 45 / 174.00 / 4.57% | 1.6% | up 3.0 pts |
| Paint | 249 / 87.30 / 4.05% | 561 / 189.26 / 4.97% | 3.7% | up 1.3 pts |
| PrePaint | 155 / 55.86 / 2.59% | 389 / 140.49 / 3.69% | 3.8% | down 0.1 pts |
| HitTest | 15 / 9.32 / 0.43% | 30 / 49.20 / 1.29% | 0.9% | up 0.4 pts |
| Commit | 29 / 17.58 / 0.82% | 45 / 68.79 / 1.81% | 0.8% | up 1.0 pts |
| **Layout/Paint/GPU family total** | — / 354.60 / 16.44% | — / **886.76 / 23.29%** | 33.2% | down 9.9 pts |
| RunMicrotasks | 142 / 179.33 / 8.31% | 298 / 345.00 / 9.06% | 31.4% | **down 22.3 pts** |
| FunctionCall | 451 / 600.71 / 27.85% | 984 / 1,525.53 / 40.08% | 27.0% | up 13.1 pts |
| TimerFire | 180 / 418.56 / 19.41% | 426 / 1,015.51 / 26.67% | 6.4% | up 20.3 pts |
| MajorGC + MinorGC | 2 / 23.22 / 1.08% | 6 / 62.86 / 1.65% | 1.6% | ~flat |

Row sums checked by hand: 145.61+87.30+38.93+55.86+9.32+17.58 = 354.60 (500-events family total,
matches); 265.02+189.26+174.00+140.49+49.20+68.79 = 886.76 (2,000-events family total, matches).
No `GPUTask` row again, same as M0, same non-investigated gap.

**Reading the shift**: the Layout/Paint/GPU family and `FireAnimationFrame` shares both fell
(consistent with less DOM churn and fewer rAF-scheduled paints during replay), while
`FunctionCall` and `TimerFire` shares rose. This is expected and not a new cost: the wall-clock
window itself shrank far more than these categories' absolute durations did (2,000-event wall went
from ~6,667 ms at M0 to 3,807 ms at M1, roughly half), so categories whose absolute cost did not
shrink as much as the window (generic V8/native call overhead, `yieldToMacrotask`/paint-yield
timers introduced by C2's admission hand-off) now make up a larger fraction of a smaller total.
`RunMicrotasks`' large drop (31.4% -> 9.06%) is consistent with C5 removing most of the
`yieldToMacrotask` chunk-by-chunk drain that dominated it at M0 (fewer streamed chunks now that
most content renders via the synchronous path).

Diagnostics JSON: `...\ac11-perf-diagnostic-cold-3tile-500-1789576738580.json`,
`...\ac11-perf-diagnostic-cold-3tile-2000-1789576876945.json` (clean retry; the failing first
attempt at `1789576??????` wrote no file).

## DOM node counts (all runs, replaying vs settled, whole-canvas — see AC 2 status below)

**AC 2 status: PARTIAL.** Task 6.1 AC 2 asks for DOM count during replay `<= 2×` the settled count
**per tile**. The raw diagnostics JSON was checked directly for a per-tile field
(`node -e "console.log(Object.keys(require(...).domNodes))"` against every M1 JSON) and carries
only `domNodes.replaying.count` (a single scalar) and `domNodes.settled` (a single scalar) — there
is no per-tile breakdown anywhere in the harness's output to compute from. The table below is
therefore a **whole-canvas** measurement, not the per-tile one AC 2 asks for, and every "yes" in it
answers the whole-canvas question only. This is marked PARTIAL rather than a trailing caveat under
a table of nine "yes" rows, per methodology review, so a reader does not come away thinking AC 2 is
cleanly met.

| Run | Replaying (whole-canvas) | Settled (whole-canvas) | Ratio | <= 2× (whole-canvas)? |
| --- | --------- | ------- | ----- | ------ |
| Cold dev 1 | 1,790 | 4,900 | 0.365× | yes |
| Cold dev 2 | 1,798 | 7,308 | 0.246× | yes |
| Cold dev 3 retry | 1,794 | 5,912 | 0.303× | yes |
| Warm 1-tile | 2,772 | 2,018 | 1.374× | yes |
| Warm 3-tile | 1,830 | 8,680 | 0.211× | yes |
| Production cold | 1,786 | 4,884 | 0.366× | yes |
| rAF-attribution | 1,798 | 7,608 | 0.236× | yes |
| Trace 500 | 1,122 | 2,900 | 0.387× | yes |
| Trace 2,000 retry | 1,790 | 6,644 | 0.269× | yes |

**Every run is well inside the <= 2× budget at whole-canvas granularity** (worst case is warm
1-tile at 1.374×; every 3-tile case is under 0.4×) — a dramatic reversal from M0's whole-canvas
~3.5-4.3×, and evidence (not proof) that C5's render-window fence is doing what it was built to do
(only the tail of 6 plus observer-reported ids mount during replay, instead of every streamed
node).

**Known measurement gap (carried from Batch 2's item 5, still not closed at M1)**: producing a
genuine per-tile ratio would require changing `perf-page-capture.ts`
(`document.querySelectorAll('[data-testid="canvas-tile"] *').length` at :207/:241/:355 samples
across the whole canvas, with no per-tile-scoped `querySelectorAll`) to sample per-tile counts,
which this task's own instruction forbids ("Measurement only — no product or spec code change").
Given the whole-canvas ratio sits at 0.21-0.39× for every 3-tile case (5-9× under the 2× ceiling),
it is very unlikely any single tile individually exceeds 2×, but **this is an inference from the
aggregate, not a measurement of the thing AC 2 asks for** — a future measurement batch (or a small,
separate harness-improvement task) must add the per-tile breakdown before AC 2's DOM clause can be
marked COMPLETE rather than PARTIAL.

## M0 vs M1 comparison

| Metric | Budget | M0 dev cold (I/J/K) | M1 dev cold (1/2/3-retry) | M0 production | M1 production |
| ------ | ------ | -------------------- | -------------------------- | -------------- | -------------- |
| Max single long task (ms) | <= 200 | 1,926 / 1,326 / 1,062 | 220 / 337 / **185** | 1,201 | **166** |
| Total blocked time (ms) | <= 1,500 | 6,941 / 5,463 / 4,077 | 3,226 / 4,927 / 2,169 | 4,767 | **985** |
| Settled | — | true / true / true | true / true / true | true | true |
| DOM ratio (replaying/settled, whole-canvas) | <= 2× (per-tile target) | ~3.5-4.3× | 0.365× / 0.246× / 0.303× | ~3.48-3.7× | 0.366× |
| Scroll sanity | — | not checked at M0 (harness gained it in Batch 1, no failures observed at M0) | 2 of 11 attempts FAILED (132 px, 31,155 px) | n/a | PASS |

| Metric | M0 (2,000 events) | M1 (2,000 events) | Change |
| ------ | ------------------- | -------------------- | ------ |
| rAF calls captured (attribution) | 1,517 | 139 | 10.9× fewer |
| `scheduleFrame` (E17) share of rAF calls | 88.3% (1,339) | 5.0% (7) | 191× fewer absolute calls |
| `FireAnimationFrame` count | 1,386 | 86 | 16.1× fewer |
| `FireAnimationFrame` scaling, 500->2,000 events | 3.09× | 1.76× | more sub-linear |
| Layout/Paint/GPU family share of wall | 33.2% | 23.29% | down 9.9 pts |
| Wall-clock window (2,000-event trace run) | ~6,667 ms | ~3,807 ms | ~43% shorter |

**Max improved 5.4-8.8× and total improved ~2.1-2.6× across the three dev cold runs; production's
max improved 7.2× and total improved 4.8×, moving production from clearly failing to cleanly
passing both budgets.** This is a large, real improvement, source-attributable to C1+C5 removing
the dominant per-node rAF cost that M0 identified. It is not enough to meet AC-11's "all three cold
dev runs" clause, and it surfaced a new functional regression (scroll sanity) that M0 could not
have shown because C5 did not exist yet.

## M1 verdict

**AC-11 is NOT MET.** Per Task 6.1 AC 3, MET requires all 3 cold dev runs AND the production cold
run to have `max <= 200` and `total <= 1,500` with `settled: true`.

| Run | Max (ms) | Max <= 200? | Total (ms) | Total <= 1,500? | Settled |
| --- | -------- | ----------- | ---------- | ----------------- | ------- |
| Cold dev 1 | 220 | NO (1.1× over) | 3,226 | NO (2.15× over) | true |
| Cold dev 2 | 337 | NO (1.69× over) | 4,927 | NO (3.28× over) | true |
| Cold dev 3 (retry) | 185 | yes | 2,169 | NO (1.45× over) | true |
| Production cold | 166 | yes | 985 | yes | true |

The remaining gap: **every dev cold run still exceeds the total-blocked-time budget** (best case
run 3-retry, 2,169 ms vs a 1,500 ms budget — a **1.45× / 669 ms** overage; worst case run 2, 4,927
ms — a **3.28× / 3,427 ms** overage). Two of three dev runs also exceed the per-task max (run 2's
337 ms is the worst single long task, 1.69× / 137 ms over budget). Production alone clears both
budgets cleanly with margin (166 ms of 200; 985 ms of 1,500).

**Task 6.1 AC status**:

| AC | Status | Reason |
| --- | --- | --- |
| AC 1: same run set + protocol as Task 2.1, plus scroll sanity on every run | COMPLETE | All runs executed, idle-checked, and scroll-sanity-checked; the 2 scroll-sanity failures are disclosed above, not hidden |
| AC 2: per-tile wall time + DOM <= 2× settled | **PARTIAL** | Per-tile wall time delivered (see "Per-tile wall time" table). DOM <= 2× is measured whole-canvas only — the harness has no per-tile DOM field — so the per-tile half of AC 2 is not proven, only argued as unlikely to fail from the aggregate |
| AC 3: AC-11 MET only if all cold + production clear both budgets | COMPLETE | Verdict logic applied exactly as specified; NOT MET is the correct conclusion from the numbers above |

**User decision recorded (2026-09-16)**: the user chose **Stage 2 option (ii), tail-paged
history**, for the remaining AC-11 gap sized above, and separately decided the scroll-sanity
regression goes to **"architect then C5 fix"** — i.e. the architect scopes the fix first, and the
implementation lands inside C5 (consistent with `batches.md`'s own residual-risk note that
anticipated this exact failure mode and pre-assigned it there). Neither decision is implemented in
this task; both are recorded here so the next batch does not have to re-derive them from a
Stage 2 planning conversation held outside this document.

**Data for the Stage 2 decision** (`implementation-plan.md` Stage 2 options (iii-b) / (ii) / (i)
— no option is chosen here and no Stage 2 code was written):

- The remaining blocked time is concentrated exactly where M0 found it: TILE_2 (last-clicked, last
  admitted by C2) — 89.8%/91.3%/91.5% of each dev run's total in the three cold runs above (run 1
  2,896/3,226; run 2 4,499/4,927; run 3-retry 1,985/2,169). C1+C5 cut the *per-node* rAF cost
  inside each tile's replay; they did not change that TILE_2's replay-and-finalize is still
  serialized behind TILE_0 and TILE_1's by C2's admission queue, so TILE_2 still pays for three
  tiles' worth of sequential work inside one long-task-observed window.
- The rAF histogram and trace shares (above) show the remaining cost is no longer dominated by one
  named call site the way `scheduleFrame` was at M0 — the largest single rAF site now
  (`scheduleStickToBottom`, 38.1%) is scroll-work code this task must not touch, and the trace's
  largest generic categories (`FunctionCall` 40.08%, `TimerFire` 26.67% at 2,000 events) are not
  attributable to one component by name alone. A further per-node budget (Stage 2 option (iii-b))
  would need to target whatever is still running per-node/per-chunk inside the replay loop itself,
  since the rAF-specific culprit is gone; a tail-paged-history approach (option (ii) or (i)) would
  instead reduce the number of chunks TILE_2 has to wait through by changing how much of a session
  replays before the tile is considered "open," which is a different lever than anything Stage 1
  touched.
- Per-tile wall time (this report, "Per-tile wall time") quantifies C2's admission-queue cost
  directly: TILE_2's click-to-marker latency is 2-5× TILE_0's across the cold/rAF runs. Any Stage 2
  option that changes admission ordering or overlap should be sized against these numbers.
- **The scroll-sanity regression (2 of 11 attempts, "Scroll sanity" above) is a separate, blocking
  finding that is not a Stage 2 sizing input** — it is a functional correctness defect (a tile can
  render up to 31,155 px from its own content) that `batches.md`'s own residual-risk note already
  anticipated and assigned to "the fix stays inside C5." This needs the architect's attention before
  or independently of any Stage 2 perf decision, since a user could hit it today (i.e., on the
  currently-committed Batch 5 code) at either 500-mid-flight event volumes or under the same timing
  window that CDP tracing perturbed here.

## Verdict

- Criteria proven: the Batch 1 harness runs unmodified on `0149adef8`; every one of the 13 attempted
  runs had a clean idle check (0 before, 0 after); no run threw "measurement unusable"; the required
  clean run set (cold ×3, warm ×2, production ×1, rAF-attribution ×1, trace ×2) is complete via 2
  retries after 2 scroll-sanity failures; diagnostics JSON exists for every clean run at
  `D:\projects\ptah-453-perf\m1`; the dev build was restored and the restore verified (`git status
  --short` clean, HEAD unchanged at `0149adef8` throughout); A8 (scheduleFrame share on a smaller
  total) is confirmed; the FireAnimationFrame scaling verdict and the DOM-ratio <= 2× check (at
  whole-canvas granularity) are both confirmed with source-cited numbers.
- Criteria not proven: AC-11 itself — confirmed NOT MET (dev cold runs fail total blocked time in
  all 3 cases and max in 2 of 3; production passes cleanly). AC 2's DOM <= 2× clause is **PARTIAL**,
  not proven per-tile — per-tile DOM breakdown could not be produced with the existing harness — see
  "Known measurement gap" and the "Task 6.1 AC status" table above.
- Risks a reader should know about:
  - **Scroll-sanity regression** (above) — the most important new finding in this section. Treat as
    a defect to route, not a perf number to size against. User decision recorded: architect scopes
    the fix, implementation lands in C5.
  - **The 3-run cold-dev sample may understate the true AC-11 gap.** Two attempts (run 3, trace-2000)
    failed scroll sanity and were replaced by clean retries; those failed attempts produced zero
    long-task data (confirmed: neither `m1-run3.log` nor `m1-trace-2000.log` contains an `[AC-11
    perf] wall=...` or long-task line), so the retry substitution could not recover what those
    runs' own numbers would have been. Because `scheduleStickToBottom` is the largest single rAF
    call site in this run set (38.1%) and scroll-sanity failure is by definition a case where that
    same scroll-correction logic misbehaved, it is plausible that the excluded runs would have shown
    worse long-task numbers than the clean retries that replaced them. Read the reported 3-run
    spread as a lower bound on the true AC-11 gap, not a symmetric sample.
  - Dev cold run 2 (max 337, total 4,927) is meaningfully worse than runs 1 and 3-retry (220/3,226
    and 185/2,169) on the same commit and same idle-0 machine — this task's own run-to-run variance
    is still large enough that a single run should not be read as "the" number; the 3-run spread is
    the honest picture, same caution as M0's report gave.
  - The two unattributed minified rAF call sites (14.4% combined at M1, versus 5.4% at M0 — a
    larger *share* though a smaller absolute count, 20 calls vs 82) remain unresolved; same
    de-minification gap as M0.
  - `GPUTask` still does not appear in this build/Electron version's trace capture, same known gap
    as M0.
  - DOM node ratios are still whole-canvas, not per-tile (Known measurement gap above) — this is
    the second time this gap has been carried forward (Batch 2's item 5, now this report); closing
    it needs a small harness change that is out of this task's scope.
  - This M1 measurement was taken on an idle, uncontended machine for its entire duration, unlike
    M0's ~50-minute contended period before its first run — the two measurement sessions' wall-clock
    numbers are not perfectly apples-to-apples for that reason, though `max`/`total` (long-task
    observer based, not wall-clock polling) should be comparable regardless per the same reasoning
    M0's report gave.

## Batch 8 — scroll re-check (post Batch 7)

### Scope

- User request: `scroll-regression-analysis.md` §2.5's 23-attempt Electron re-check of the Batch 7
  scroll-retention fix (`906c30440 fix(chat): keep replayed transcript mounts monotonic so tiles
  stay pinned`), plus the M1 `TILE_1`/`TILE_2` correction above. Measurement only — no product or
  spec code was changed to produce this section.
- Criteria tested: `batches.md` Batch 8 / Task 8.1 pass rule — 0 scroll-sanity failures across the
  same 23-attempt run set (10 cold asserting, 10 cold diagnostic with `PTAH_PERF_TRACE=1
  PTAH_PERF_EVENTS=2000`, 3 warm 3-tile) defined in `scroll-regression-analysis.md` §2.5.
- Regressions covered: verifies the Batch 7 fix against the exact 132 px (H1-shaped) and 31,155 px
  (H1-shaped) misses recorded at M1.
- Deliberately not tested: A1/A2 slot-height readings (optional per Task 8.1 AC 6) were not taken —
  not cheap to add without touching the forbidden-file list under this measurement-only task, and
  the 0-failure result made the discriminating check unnecessary. AC-11 itself is not re-verdicted
  here (per Task 8.1 AC 4, "not a new AC-11 verdict unless the orchestrator asks") — numbers are
  reported beside M1 for comparison only.

### Environment

- Worktree: `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks`, branch
  `perf/task-453-tile-open-long-tasks`.
- `git log --oneline -1` before AND after all 23 runs: `906c30440 fix(chat): keep replayed
  transcript mounts monotonic so tiles stay pinned` — the required Batch 7 commit, unchanged
  throughout.
- `git status --short` before the first run and after the last run: `M
  .ptah/specs/TASK_2026_453_1eb4/batches.md` and `?? .ptah/specs/TASK_2026_453_1eb4/leftovers-inventory.md`.
  Both are **pre-existing/concurrent changes from another session**, not written by this task: this
  session never opened `batches.md` for writing and never created `leftovers-inventory.md`. Neither
  is a product or spec file (both are task-folder docs), and `git diff --stat batches.md` shows only
  Batch 18 planning prose being added — nothing in the scroll-retention or perf-harness files. No
  product, spec or harness file was modified by this task.
- Build: `ptah-electron` dev configuration for every run, via `nx run ptah-electron-e2e:e2e`, which
  depends on `ptah-electron:build-dev` + `ptah-electron:copy-renderer-dev` (same dependency chain
  M0/M1 used manually). The first run in the set built `ptah-extension-webview` and `build-main`
  fresh (not cache-served); every later run served all upstream tasks from the Nx cache, confirming
  no file changed mid-run-set.
- Idle check command (identical to M0/M1):
  `powershell -NoProfile -c "(Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | ? { $_.CommandLine -match 'jest-worker|run-executor' }).Count"`.
  Checked immediately before and immediately after every run below, including the one discarded
  attempt: **every check returned `0`, with no exceptions** (24 checks before + 24 checks after, for
  23 counted attempts plus 1 discarded). This session did not itself run any other Nx target
  concurrently with a perf run, so "excluding my own run" reduces to: the idle-check filter already
  excludes Playwright's own worker processes (`Name='node.exe'` matched against
  `jest-worker|run-executor` command lines — Playwright's `npx playwright test` process and the
  Electron app it drives do not match either substring), and no other jest-worker/run-executor
  process was ever observed running.
- **Peer hold**: this report does not independently confirm the orchestrator requested or released a
  peer hold with the `continue-task` session (that coordination happens outside this task-folder
  edit). What this session can state directly: all 24 idle checks before every run and all 24 idle
  checks after every run returned `0`, so no contention from any peer session was observed at any
  point during this run set, whether or not a hold was explicitly requested.
- `PTAH_PERF_OUT_DIR`: `D:\projects\ptah-453-perf\b8` (outside the repo). Console logs:
  `D:\projects\ptah-453-perf\b8-cold1.log` .. `b8-cold10.log` (cold asserting, `b8-cold4.log` is the
  discarded crash, `b8-cold4-retry.log` is its replacement counted as attempt 4),
  `b8-diag1.log` .. `b8-diag10.log` (cold diagnostic, trace + 2,000 events), `b8-warm1.log` ..
  `b8-warm3.log` (warm 3-tile).
- Run command pattern (same as M0/M1): `npx nx run ptah-electron-e2e:e2e -- \
  src/specs/chat/tile-open-longtask-budget.perf.spec.ts --reporter=list -g "<title>"`, with
  `PTAH_PERF_SPECS=1` and `PTAH_PERF_OUT_DIR` set in the same shell invocation; diagnostic runs added
  `PTAH_PERF_TRACE=1 PTAH_PERF_EVENTS=2000`. Titles used: `"cold: opening 3 tiles"` (spec `:191`),
  `"diagnostic: cold 3 tiles"` (spec `:354`), `"diagnostic: warm 3 tiles"` (spec `:502`).

### Discarded attempt

One attempt (the first try at cold-asserting slot 4) was discarded and repeated, per the batch
instruction's contamination-is-the-only-reason-to-repeat rule extended to this one case: the
Playwright **worker process itself crashed at 0 ms**, before Electron ever launched
(`Error: worker process exited unexpectedly (code=3221226505, signal=null)`, `b8-cold4.log:205`).
The idle check was `0`/`0` around it (not machine contention), and no scroll check, perf measurement,
or diagnostics JSON was produced — it is evidence of nothing, not a scroll-sanity result, so it is
reported here as a discarded/repeated attempt rather than folded into either the pass or fail count.
It was retried immediately (`b8-cold4-retry.log`) under the same idle-0 condition, and that retry is
counted as attempt 4 of the 23 below. This is flagged explicitly for the orchestrator: it is not the
"contaminated → discard → repeat" case the protocol names (that case is a busy machine), so if a
stricter reading is wanted, this attempt should be treated as inconclusive infrastructure noise, not
as satisfying any part of the 23-attempt count on its own — either way, the 23 counted attempts below
are all attempts that ran the actual test to completion.

### 23-attempt scroll-sanity result

Per-tile distance is only captured by the harness on a **failure** (`checkTileScrollSanity`,
`perf-page-capture.ts:373-380`, only pushes `distanceFromBottom` into the failure list it returns);
a passing tile's exact distance is not logged anywhere, matching the convention M1's own table used
(PASS rows show "—"). Idle was `0`/`0` for every attempt.

| # | Run | Idle before/after | Scroll result | Wall (ms) | Max (ms) | Total (ms) | Long tasks | preWindowExcluded | Settled | DOM (replaying/settled) |
| - | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Cold asserting 1 | 0/0 | PASS | 2,171.60 | 143 | 435 | 5 | 2 / 121 ms | true | 1,794 / 4,972 |
| 2 | Cold asserting 2 | 0/0 | PASS | 3,145.00 | 223 | 1,432 | 14 | 2 / 195 ms | true | 1,790 / 5,908 |
| 3 | Cold asserting 3 | 0/0 | PASS | 5,431.20 | 399 | 3,825 | 31 | 2 / 208 ms | true | 1,786 / 4,900 |
| 4 | Cold asserting 4 (retry after discarded crash) | 0/0 | PASS | 3,395.60 | 267 | 1,862 | 17 | 2 / 154 ms | true | 1,802 / 6,208 |
| 5 | Cold asserting 5 | 0/0 | PASS | 3,170.40 | 232 | 1,557 | 16 | 2 / 183 ms | true | 1,790 / 6,632 |
| 6 | Cold asserting 6 | 0/0 | PASS | 2,445.20 | 184 | 1,075 | 12 | 2 / 152 ms | true | 1,798 / 4,924 |
| 7 | Cold asserting 7 | 0/0 | PASS | 3,409.20 | 238 | 1,848 | 17 | 2 / 191 ms | true | 1,798 / 6,296 |
| 8 | Cold asserting 8 | 0/0 | PASS | 2,857.00 | 217 | 1,251 | 13 | 2 / 186 ms | true | 1,798 / 4,912 |
| 9 | Cold asserting 9 | 0/0 | PASS | 3,035.70 | 177 | 1,409 | 17 | 2 / 151 ms | true | 1,794 / 4,964 |
| 10 | Cold asserting 10 | 0/0 | PASS | 3,235.90 | 175 | 1,524 | 18 | 2 / 161 ms | true | 1,782 / 4,876 |
| 11 | Diagnostic cold 1 | 0/0 | PASS | 3,505.30 | 318 | 1,929 | 17 | 2 / 159 ms | true | 1,786 / 7,315 |
| 12 | Diagnostic cold 2 | 0/0 | PASS | 3,571.90 | 233 | 2,159 | 20 | 2 / 291 ms | true | 1,782 / 6,352 |
| 13 | Diagnostic cold 3 | 0/0 | PASS | 3,332.20 | 230 | 1,668 | 17 | 2 / 166 ms | true | 1,794 / 4,908 |
| 14 | Diagnostic cold 4 | 0/0 | PASS | 4,261.60 | 293 | 2,720 | 26 | 2 / 186 ms | true | 1,786 / 5,931 |
| 15 | Diagnostic cold 5 | 0/0 | PASS | 4,642.90 | 547 | 3,100 | 22 | 2 / 335 ms | true | 1,790 / 7,648 |
| 16 | Diagnostic cold 6 | 0/0 | PASS | 3,768.60 | 470 | 2,266 | 18 | 2 / 217 ms | true | 1,786 / 7,464 |
| 17 | Diagnostic cold 7 | 0/0 | PASS | 3,426.60 | 213 | 1,855 | 20 | 2 / 151 ms | true | 1,794 / 5,920 |
| 18 | Diagnostic cold 8 | 0/0 | PASS | 2,370.80 | 146 | 622 | 7 | 2 / 126 ms | true | 1,794 / 4,916 |
| 19 | Diagnostic cold 9 | 0/0 | PASS | 2,835.20 | 259 | 1,277 | 13 | 2 / 124 ms | true | 1,794 / 7,876 |
| 20 | Diagnostic cold 10 | 0/0 | PASS | 2,049.80 | 125 | 452 | 6 | 2 / 128 ms | true | 1,790 / 4,904 |
| 21 | Warm 3-tile 1 | 0/0 | PASS | 2,931.00 | 193 | 1,125 | 15 | 4 / 276 ms | true | 2,172 / 6,301 |
| 22 | Warm 3-tile 2 | 0/0 | PASS | 2,165.90 | 131 | 368 | 5 | 4 / 278 ms | true | 2,176 / 5,290 |
| 23 | Warm 3-tile 3 | 0/0 | PASS | 2,898.90 | 201 | 1,057 | 13 | 5 / 418 ms | true | 2,176 / 7,310 |

**Result: 0 scroll-sanity failures in 23 counted attempts.** Every attempt's scroll check ran to
completion and passed (either an explicit `1 passed`, or — for the budget-failing cold asserting
runs below — a printed `[AC-11 perf] wall=...` line, which per the spec's own control flow
(`tile-open-longtask-budget.perf.spec.ts:281-289`) only prints after `assertScrollSanity` at `:286`
has already returned with no failures). **No H1 or H2 classification applies — there is nothing to
classify.** Per Task 8.1 AC 5 / `batches.md` "Batch 8 verification": PASS. Scroll regression closed;
Stage 2 may start.

Budget outcome of each cold-asserting run (recorded for completeness, not part of the scroll
verdict, per Task 8.1 AC 3 "a long-task budget failure in the asserting test is NOT a scroll
failure"):

| # | Max <= 200? | Total <= 1,500? | Which assertion failed (if any) |
| - | --- | --- | --- |
| 1 | yes (143) | yes (435) | none — AC-11 MET this run |
| 2 | NO (223) | yes (1,432) | `expect(maxDuration)` |
| 3 | NO (399) | NO (3,825) | `expect(maxDuration)` (then total would also fail) |
| 4 | NO (267) | NO (1,862) | `expect(maxDuration)` |
| 5 | NO (232) | NO (1,557) | `expect(maxDuration)` |
| 6 | yes (184) | yes (1,075) | none — AC-11 MET this run |
| 7 | NO (238) | NO (1,848) | `expect(maxDuration)` |
| 8 | NO (217) | yes (1,251) | `expect(maxDuration)` |
| 9 | yes (177) | yes (1,409) | none — AC-11 MET this run |
| 10 | yes (175) | NO (1,524) | `expect(totalDuration)` (max assertion passed first) |

Jest/Playwright evaluates `expect(maxDuration)...` before `expect(totalDuration)...`
(`tile-open-longtask-budget.perf.spec.ts:350-351`), so a run failing only the max budget reports that
assertion; run 10 is the only run whose max passed and total alone failed, confirmed directly against
its own numbers (175 <= 200, 1,524 > 1,500).

### Asserting-run max/total vs M1

| Metric | M1 (3 runs) | Batch 8 (10 runs) |
| --- | --- | --- |
| Max values (ms) | 220, 337, 185 | 143, 223, 399, 267, 232, 184, 238, 217, 177, 175 |
| Max mean (ms) | 247.3 | 225.5 |
| Max min / max max (ms) | 185 / 337 | 143 / 399 |
| Total values (ms) | 3,226, 4,927, 2,169 | 435, 1,432, 3,825, 1,862, 1,557, 1,075, 1,848, 1,251, 1,409, 1,524 |
| Total mean (ms) | 3,440.7 | 1,621.8 |
| Total min / max (ms) | 2,169 / 4,927 | 435 / 3,825 |
| Runs meeting AC-11 (max<=200 AND total<=1,500) | 0 of 3 | **3 of 10** (attempts 1, 6, 9) |
| Scroll-sanity failures | 2 of 11 (18%) | **0 of 23 (0%)** |

Arithmetic check (Batch 8 max mean): 143+223+399+267+232+184+238+217+177+175 = 2,255; 2,255/10 =
225.5. Arithmetic check (Batch 8 total mean): 435+1,432+3,825+1,862+1,557+1,075+1,848+1,251+1,409+
1,524 = 16,218; 16,218/10 = 1,621.8.

**Yes, 3 of the 10 Batch 8 asserting runs met AC-11 in full** (attempts 1, 6 and 9 — max and total
both within budget, `settled: true`), a result M1's 3-run sample (0 of 3) did not show. This is
consistent with M1's own disclosed caution that "a single run should not be read as 'the' number" —
Batch 8's larger 10-run sample shows both a new best case (143 ms max / 435 ms total, run 1) and a
new worst case (399 ms max / 3,825 ms total, run 3) that both sit outside M1's narrower 3-run range,
so run-to-run variance is confirmed to be large, not resolved. **This is reported for comparison
only and is not a new AC-11 verdict** — Task 8.1 AC 4 does not ask for one, and a 10-run sample
still is not the "all 3 cold dev runs" gate Task 6.1 AC 3 defines; if the orchestrator wants a formal
re-verdict it should be sized against a fresh 3-run set drawn the same way M0/M1 did, not against
this diagnostic 10-run spread.

### Diagnostic (trace, 2,000 events) vs M1

| Metric | M1 trace-2000 (1 run, clean retry) | Batch 8 diagnostic (10 runs) |
| --- | --- | --- |
| Max (ms) | 193 | 125, 146, 213, 230, 233, 259, 293, 318, 470, 547 (mean 283.4) |
| Total (ms) | 2,129 | 452, 622, 1,277, 1,668, 1,855, 1,929, 2,159, 2,266, 2,720, 3,100 (mean 1,804.8) |
| Scroll sanity | FAIL first attempt (31,155 px), PASS retry | PASS, all 10 |

Arithmetic check (max mean): 318+233+230+293+547+470+213+146+259+125 = 2,834; 2,834/10 = 283.4.
Arithmetic check (total mean): 1,929+2,159+1,668+2,720+3,100+2,266+1,855+622+1,277+452 = 18,048;
18,048/10 = 1,804.8. M1's single clean data point (193/2,129) sits inside the Batch 8 spread, not at
either extreme — consistent with the same high variance seen in the asserting runs, not a new
finding.

### Warm 3-tile vs M1

| Metric | M1 warm-3tile (1 run) | Batch 8 warm-3tile (3 runs) |
| --- | --- | --- |
| Max (ms) | 382 | 193, 131, 201 (mean 175.0) |
| Total (ms) | 3,330 | 1,125, 368, 1,057 (mean 850.0) |
| Scroll sanity | PASS | PASS, all 3 |

All three Batch 8 warm runs are well below M1's single warm-3tile sample on both max and total; not
gated either way (warm scenarios are diagnostic-only per the spec's own header comment), reported
for completeness only.

### Diagnostics JSON paths read

`D:\projects\ptah-453-perf\b8\ac11-perf-cold-3tile-1789584213533.json` (attempt 1),
`...-1789584301518.json` (attempt 2), `...-1789584373526.json` (attempt 3),
`...-1789584524022.json` (attempt 4, retry), `...-1789584590298.json` (attempt 5),
`...-1789584659150.json` (attempt 6), `...-1789584725837.json` (attempt 7),
`...-1789584791203.json` (attempt 8), `...-1789584854061.json` (attempt 9),
`...-1789584918230.json` (attempt 10),
`D:\projects\ptah-453-perf\b8\ac11-perf-diagnostic-cold-3tile-2000-1789584985957.json` (attempt 11),
`...-1789585066450.json` (attempt 12), `...-1789585136058.json` (attempt 13),
`...-1789585204961.json` (attempt 14), `...-1789585281016.json` (attempt 15),
`...-1789585364531.json` (attempt 16), `...-1789585469351.json` (attempt 17),
`...-1789585539205.json` (attempt 18), `...-1789585601292.json` (attempt 19),
`...-1789585661176.json` (attempt 20),
`D:\projects\ptah-453-perf\b8\ac11-perf-warm-3tile-1789585728282.json` (attempt 21),
`...-1789585789490.json` (attempt 22), `...-1789585851336.json` (attempt 23).
The discarded crash attempt (`b8-cold4.log`) wrote no diagnostics JSON (crashed at 0 ms, before the
app launched).

### Batch 8 verdict

- **PASS: 0 scroll-sanity failures in 23 counted attempts.** Idle was `0`/`0` before and after every
  one of the 23 counted attempts and the 1 discarded attempt (24 checks each side). `git log
  --oneline -1` was `906c30440` before and after every run; `git status --short` showed only an
  unrelated, not-self-caused `batches.md`/`leftovers-inventory.md` change from another session, no
  product/spec/harness diff.
- H1/H2 classification: **not needed** — there were no failures to classify. The Batch 7 fix
  (replay mount retention in `TranscriptRenderWindow`) holds against both the 132 px and 31,155 px
  failure shapes recorded at M1, across 10 repetitions of the exact run shape that produced the
  132 px miss and 10 repetitions of the exact run shape (trace + 2,000 events) that produced the
  31,155 px miss, plus 3 warm-3-tile repetitions.
- Per `batches.md` Batch 8 verification: **Stage 2 (Batches 9-17) may start.**
- Risk carried forward, not closed by this result: `scroll-regression-analysis.md` F1 (a live event
  growing content below during the single rAF/50 ms release window can still recreate the H1 shape
  "at lower probability") is a probabilistic risk that 23 clean attempts make less likely, not
  impossible — the analysis's own math (2/11 ≈ 18% observed rate → ~2% chance of 20 clean attempts by
  luck) means this result is strong evidence, not proof. The `onScroll` anchoring-aware fix
  (`scroll-regression-analysis.md` §2.3) remains available as U1 if a future run reproduces either
  shape.
- One process anomaly (the discarded worker crash, cold-asserting attempt 4's first try) is flagged
  above for the orchestrator's attention as an infrastructure item, separate from the scroll verdict.

# M2 — post-Stage-2 measurement (Batch 15 / Task 15.1)

## Scope and environment

- Measurement and report only. No product, spec, or harness code was changed.
- Worktree: `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks`;
  branch `perf/task-453-tile-open-long-tasks`.
- Build/commit identity before the first run and after the last run:
  `5b8e664b8 test(electron-e2e): page the perf mock like the backend and cover loading older history`.
- `git status --short` was empty before the first run and after the last measurement run. After this
  section was written, the report itself is the only worktree modification.
- Dev runs used `npx nx run ptah-electron-e2e:e2e --
  src/specs/chat/tile-open-longtask-budget.perf.spec.ts --reporter=list -g "<title>"` with
  `PTAH_PERF_SPECS=1` and `PTAH_PERF_OUT_DIR=D:\projects\ptah-453-perf\m2`. The production app was
  built with `npx nx run ptah-electron:build-main --configuration=production` followed by
  `npx nx run ptah-electron:copy-renderer`; its cold gate ran directly from
  `apps/ptah-electron-e2e` with `npx playwright test --config=playwright.config.ts ...`, bypassing
  the dev-build dependency chain. The dev build was then restored with
  `build-main --configuration=development` plus `copy-renderer-dev` before the diagnostic runs.
- The orchestrator-provided peer hold was in effect for the run set. First run started
  **2026-09-17 16:12:33.6879762 +03:00**; last run ended
  **2026-09-17 16:24:29.7034338 +03:00**.
- Idle command: `powershell -NoProfile -c "(Get-CimInstance Win32_Process -Filter
  \"Name='node.exe'\" | ? { $_.CommandLine -match 'jest-worker|run-executor' }).Count"`.
  Every before/after count was persisted to
  `D:\projects\ptah-453-perf\m2\idle-checks.log`.

## Idle checks and discarded runs

| Run | Before | After |
| --- | ---: | ---: |
| Cold dev 1 | 0 | 0 |
| Cold dev 2 | 0 | 0 |
| Cold dev 3 | 0 | 0 |
| Warm 1-tile | 0 | 0 |
| Warm 3-tile | 0 | 0 |
| Production build | 0 | 0 |
| Production cold | 0 | 0 |
| Dev build restore | 0 | 0 |
| rAF-attribution cold | 0 | 0 |
| Trace 500 | 0 | 0 |
| Trace 2,000 | 0 | 0 |
| Load-older functional suite | 0 | 0 |

**Discarded runs: none.** No after-count was non-zero, no Playwright worker crashed, no run reported
`measurement unusable`, and every perf run produced a diagnostics JSON. The repeated Nx warning
that the AI-agent configuration is outdated and Node's `MaxListenersExceededWarning` are existing
infrastructure warnings; neither interrupted a run or affected the zero idle counts.

## M2 run results beside M1

The whole-canvas DOM columns are the harness's replaying sample and settled sample. M1 comparison
columns reproduce the corresponding M1 values above; warm and diagnostic runs remain
informational. All M2 runs were `settled: true`; all eight runs whose spec includes scroll sanity
passed it (the warm 1-tile spec does not perform that check).

| Run | M2 wall (ms) | M2 tasks | M2 max (ms) | M2 total (ms) | M2 pre-window excluded | M2 whole DOM replaying / settled (ratio) | Settled | M1 max / total (ms) |
| --- | ---: | ---: | ---: | ---: | --- | --- | --- | --- |
| Cold dev 1 | 5,070.0 | 6 | **144** | **550** | 2 / 149 ms | 740 / 2,734 (0.271×) | true | 220 / 3,226 |
| Cold dev 2 | 2,092.8 | 9 | **136** | **677** | 2 / 170 ms | 988 / 2,622 (0.377×) | true | 337 / 4,927 |
| Cold dev 3 | 2,157.9 | 8 | **129** | **643** | 2 / 151 ms | 988 / 2,618 (0.377×) | true | 185 / 2,169 |
| Warm 1-tile | 1,661.9 | 1 | 65 | 65 | 4 / 367 ms | 908 / 1,162 (0.781×) | true | 85 / 279 |
| Warm 3-tile | 1,932.8 | 7 | 109 | 515 | 4 / 356 ms | 1,370 / 2,944 (0.465×) | true | 382 / 3,330 |
| Production cold | 2,043.1 | 7 | **95** | **477** | 2 / 125 ms | 988 / 2,622 (0.377×) | true | 166 / 985 |
| rAF-attribution cold | 2,060.4 | 7 | 131 | 568 | 2 / 162 ms | 992 / 2,626 (0.378×) | true | 307 / 2,866 |
| Trace 500 | 1,968.9 | 6 | 110 | 498 | 2 / 146 ms | 988 / 2,622 (0.377×) | true | 130 / 537 |
| Trace 2,000 | 1,995.6 | 6 | 106 | 448 | 2 / 148 ms | 992 / 2,622 (0.378×) | true | 193 / 2,129 |

Cold dev 1's 5,070.0 ms wall time is an outlier against the other eight M2 runs' 1,661.9-2,157.9
ms range: its JSON records `windowStartMs = 774.2` and `windowEndMs = 5844.2`, including 3,813 ms
between the final marker and window close. The cause was not captured; its 144 ms max and 550 ms
total remain within budget, so the outlier does not affect the AC-11 verdict.

### Per-tile wall time

Wall time is each tile's own click timestamp to its own marker timestamp. `Solo` applies only to
the warm 1-tile run.

| Run | Tile 0 / Solo (ms) | Tile 1 (ms) | Tile 2 (ms) |
| --- | ---: | ---: | ---: |
| Cold dev 1 | 375.3 | 322.7 | 238.5 |
| Cold dev 2 | 401.0 | 381.6 | 433.5 |
| Cold dev 3 | 447.0 | 504.8 | 489.0 |
| Warm 1-tile | 139.8 | — | — |
| Warm 3-tile | 265.0 | 310.8 | 303.9 |
| Production cold | 333.3 | 322.1 | 341.0 |
| rAF-attribution cold | 398.3 | 438.7 | 424.5 |
| Trace 500 | 362.4 | 372.7 | 371.9 |
| Trace 2,000 | 336.7 | 370.3 | 383.3 |

## Per-tile DOM — AC 2 verdict

The harness takes one per-tile "replaying" sample only after the last marker has been found. The
JSON `markerTimes` show Tile 2 is last-marked in every three-tile run; the single-tile run's Solo
tile is necessarily last-marked. Those last-marked tiles were sampled mid-replay, so their ratios
verify AC 2 and are **MET**. Tiles 0 and 1 had already reached their markers when the shared sample
ran: their ratios do not contradict the 2× limit, but AC 2 is **NOT PROVEN** for them because an
earlier transient replay peak would be invisible. Closing AC 2 for every tile requires a follow-up
harness measurement at each tile's own marker instant. This evidence limitation does not affect
AC-11, whose gate is max/total/settled/scroll. Whole-canvas values remain in the run table above;
per-tile samples are scoped differently and are not expected to sum to the whole-canvas sample.

AC 2 per-tile re-measure moved to TASK_2026_468_a0e4 (user decision 2026-09-17).

| Run | Tile | Replaying | Settled | Ratio | Sample state | AC 2 |
| --- | --- | ---: | ---: | ---: | --- | --- |
| Cold dev 1 | 0 | 776 | 758 | 1.024× | post-marker | NOT PROVEN (not contradicted) |
| Cold dev 1 | 1 | 758 | 758 | 1.000× | post-marker | NOT PROVEN (not contradicted) |
| Cold dev 1 | 2 | 452 | 762 | 0.593× | mid-replay | MET (verified mid-replay) |
| Cold dev 2 | 0 | 758 | 758 | 1.000× | post-marker | NOT PROVEN (not contradicted) |
| Cold dev 2 | 1 | 818 | 702 | 1.165× | post-marker | NOT PROVEN (not contradicted) |
| Cold dev 2 | 2 | 452 | 706 | 0.640× | mid-replay | MET (verified mid-replay) |
| Cold dev 3 | 0 | 758 | 758 | 1.000× | post-marker | NOT PROVEN (not contradicted) |
| Cold dev 3 | 1 | 710 | 702 | 1.011× | post-marker | NOT PROVEN (not contradicted) |
| Cold dev 3 | 2 | 448 | 702 | 0.638× | mid-replay | MET (verified mid-replay) |
| Warm 1-tile | Solo | 448 | 702 | 0.638× | mid-replay | MET (verified mid-replay) |
| Warm 3-tile | 0 | 754 | 698 | 1.080× | post-marker | NOT PROVEN (not contradicted) |
| Warm 3-tile | 1 | 822 | 706 | 1.164× | post-marker | NOT PROVEN (not contradicted) |
| Warm 3-tile | 2 | 444 | 698 | 0.636× | mid-replay | MET (verified mid-replay) |
| Production cold | 0 | 758 | 758 | 1.000× | post-marker | NOT PROVEN (not contradicted) |
| Production cold | 1 | 822 | 706 | 1.164× | post-marker | NOT PROVEN (not contradicted) |
| Production cold | 2 | 818 | 702 | 1.165× | mid-replay | MET (verified mid-replay) |
| rAF-attribution cold | 0 | 762 | 762 | 1.000× | post-marker | NOT PROVEN (not contradicted) |
| rAF-attribution cold | 1 | 818 | 702 | 1.165× | post-marker | NOT PROVEN (not contradicted) |
| rAF-attribution cold | 2 | 452 | 706 | 0.640× | mid-replay | MET (verified mid-replay) |
| Trace 500 | 0 | 758 | 758 | 1.000× | post-marker | NOT PROVEN (not contradicted) |
| Trace 500 | 1 | 448 | 702 | 0.638× | post-marker | NOT PROVEN (not contradicted) |
| Trace 500 | 2 | 452 | 706 | 0.640× | mid-replay | MET (verified mid-replay) |
| Trace 2,000 | 0 | 762 | 762 | 1.000× | post-marker | NOT PROVEN (not contradicted) |
| Trace 2,000 | 1 | 448 | 702 | 0.638× | post-marker | NOT PROVEN (not contradicted) |
| Trace 2,000 | 2 | 448 | 702 | 0.638× | mid-replay | MET (verified mid-replay) |

The Batch 14 per-tile sampler guard was re-checked in the four gating JSON files:
`perTileHarnessTaskMaxDurationMs` was 6.9 ms, 2.9 ms, 2.9 ms, and 2.2 ms for Cold dev 1, Cold dev
2, Cold dev 3, and Production cold respectively, all below the 50 ms rejection threshold. No
equivalent whole-macrotask field is present in these JSON files.

## Paging diagnostics

Every tile resumed through paging with `historyPage.maxEvents = 250`; every run therefore remained
usable. Cells are `requested maxEvents / replayed-event count`.

| Run | Tile 0 / Solo | Tile 1 | Tile 2 |
| --- | --- | --- | --- |
| Cold dev 1 | 250 / 248 | 250 / 247 | 250 / 247 |
| Cold dev 2 | 250 / 242 | 250 / 248 | 250 / 247 |
| Cold dev 3 | 250 / 246 | 250 / 245 | 250 / 247 |
| Warm 1-tile | 250 / 243 | — | — |
| Warm 3-tile | 250 / 242 | 250 / 249 | 250 / 242 |
| Production cold | 250 / 245 | 250 / 247 | 250 / 241 |
| rAF-attribution cold | 250 / 250 | 250 / 247 | 250 / 249 |
| Trace 500 | 250 / 245 | 250 / 247 | 250 / 245 |
| Trace 2,000 | 250 / 250 | 250 / 246 | 250 / 245 |

## Volume independence and attribution

| Metric | Trace 500 | Trace 2,000 | 2,000 / 500 | Verdict |
| --- | ---: | ---: | ---: | --- |
| Long-task total (ms) | 498 | 448 | 0.900× | Flat within run noise; 2,000 is lower |
| Max long task (ms) | 110 | 106 | 0.964× | Flat |
| Long-task count | 6 | 6 | 1.000× | Flat |
| Trace-summary total (ms) | 2,988.04 | 2,924.66 | 0.979× | Flat |
| `FireAnimationFrame` count | 46 | 48 | 1.043× | Flat despite 4× event volume |
| `FireAnimationFrame` duration (ms) | 120.13 | 127.22 | 1.059× | Flat |

**AC 5 verdict: volume independent.** The 2,000-event trace does not have a materially higher
blocked total, trace-summary total, or `FireAnimationFrame` count. The renderer does not still pay
event volume in this measured tail-paged path.

Top trace shares use the same duration / measurement-wall convention as M1:

| Category | 500 count / ms / wall share | 2,000 count / ms / wall share |
| --- | --- | --- |
| RunTask | 814 / 1,047.11 / 53.18% | 856 / 1,027.68 / 51.50% |
| FunctionCall | 448 / 724.82 / 36.81% | 424 / 670.63 / 33.61% |
| TimerFire | 183 / 315.10 / 16.00% | 179 / 325.39 / 16.31% |
| UpdateLayoutTree | 86 / 265.73 / 13.50% | 96 / 259.51 / 13.00% |
| FireAnimationFrame | 46 / 120.13 / 6.10% | 48 / 127.22 / 6.38% |
| Layout | 34 / 126.12 / 6.41% | 38 / 122.56 / 6.14% |
| Paint | 263 / 72.03 / 3.66% | 283 / 69.22 / 3.47% |
| PrePaint | 158 / 48.95 / 2.49% | 167 / 45.09 / 2.26% |
| Layerize | 23 / 28.37 / 1.44% | 27 / 35.63 / 1.79% |

The rAF-attribution run captured 65 calls: `scheduleStickToBottom` 24 (36.9%), unattributed
`chunk-VXIB2F7N.js:17766:7` 13 (20.0%), Angular `scheduleCallbackWithRafRace` 12 (18.5%),
unattributed `chunk-VXIB2F7N.js:17885:5` 6 (9.2%), Playwright evaluate 3 (4.6%),
`restoreScrollOnActivation` 3 (4.6%), `BatchedUpdateService.scheduleUpdate` 3 (4.6%), and
`ResizeObserver` 1 (1.5%). `scheduleFrame` did not appear.

## Scroll sanity and load-older functional result

| Perf run | Scroll result | Failure detail / classification |
| --- | --- | --- |
| Cold dev 1 | PASS | — |
| Cold dev 2 | PASS | — |
| Cold dev 3 | PASS | — |
| Warm 1-tile | n/a (not checked by the spec) | — |
| Warm 3-tile | PASS | — |
| Production cold | PASS | — |
| rAF-attribution cold | PASS | — |
| Trace 500 | PASS | — |
| Trace 2,000 | PASS | — |

Result: **0 scroll failures in 8 checked perf runs**. No H1/H2 classification applies. For those
eight runs, a diagnostics write occurs only after `assertScrollSanity` returns; Warm 1-tile wrote
diagnostics without that call. M1 carried the same warm-1 coverage gap by labeling it PASS even
though its spec did not perform the check.

The functional `tile-load-older-history.spec.ts` suite also passed all five cases. Its measured
anchor deltas were 0.50 px at `scrollTop === 0` and 0.38 px at non-zero `scrollTop`, both within
the 2 px limit; the pinned prepend finished 0.00 px from the bottom. Stale-cursor handling and the
legacy no-`historyPage` response case also passed.

Literal Playwright summaries (ANSI colour removed, wording otherwise unchanged):

| Log | Summary |
| --- | --- |
| `m2-cold-dev-1.log` | `1 passed (23.9s)` |
| `m2-cold-dev-2.log` | `1 passed (19.8s)` |
| `m2-cold-dev-3.log` | `1 passed (18.1s)` |
| `m2-warm-1tile.log` | `1 passed (17.6s)` |
| `m2-warm-3tile.log` | `1 passed (18.4s)` |
| `m2-production-cold.log` | `1 passed (17.5s)` |
| `m2-raf-attribution.log` | `1 passed (18.7s)` |
| `m2-trace-500.log` | `1 passed (19.7s)` |
| `m2-trace-2000.log` | `1 passed (21.9s)` |
| `m2-load-older-history.log` | `5 passed (1.4m)` |

## Evidence paths (AC 9)

Diagnostics JSON:

- `D:\projects\ptah-453-perf\m2\ac11-perf-cold-3tile-1789650808699.json`
- `D:\projects\ptah-453-perf\m2\ac11-perf-cold-3tile-1789650878615.json`
- `D:\projects\ptah-453-perf\m2\ac11-perf-cold-3tile-1789650931012.json`
- `D:\projects\ptah-453-perf\m2\ac11-perf-warm-1tile-1789651008845.json`
- `D:\projects\ptah-453-perf\m2\ac11-perf-warm-3tile-1789651061535.json`
- `D:\projects\ptah-453-perf\m2\ac11-perf-cold-3tile-1789651126109.json` (production)
- `D:\projects\ptah-453-perf\m2\ac11-perf-diagnostic-cold-3tile-2000-1789651213423.json`
  (rAF attribution)
- `D:\projects\ptah-453-perf\m2\ac11-perf-diagnostic-cold-3tile-500-1789651278549.json`
- `D:\projects\ptah-453-perf\m2\ac11-perf-diagnostic-cold-3tile-2000-1789651336217.json`

Console and protocol logs:

- `D:\projects\ptah-453-perf\m2\m2-cold-dev-1.log`
- `D:\projects\ptah-453-perf\m2\m2-cold-dev-2.log`
- `D:\projects\ptah-453-perf\m2\m2-cold-dev-3.log`
- `D:\projects\ptah-453-perf\m2\m2-warm-1tile.log`
- `D:\projects\ptah-453-perf\m2\m2-warm-3tile.log`
- `D:\projects\ptah-453-perf\m2\m2-production-build.log`
- `D:\projects\ptah-453-perf\m2\m2-production-cold.log`
- `D:\projects\ptah-453-perf\m2\m2-dev-build-restore.log`
- `D:\projects\ptah-453-perf\m2\m2-raf-attribution.log`
- `D:\projects\ptah-453-perf\m2\m2-trace-500.log`
- `D:\projects\ptah-453-perf\m2\m2-trace-2000.log`
- `D:\projects\ptah-453-perf\m2\m2-load-older-history.log`
- `D:\projects\ptah-453-perf\m2\idle-checks.log`

## AC-11 verdict

| Gating run | Max <= 200 ms | Total <= 1,500 ms | Settled | Scroll |
| --- | --- | --- | --- | --- |
| Cold dev 1 | MET (144 ms) | MET (550 ms) | true | PASS |
| Cold dev 2 | MET (136 ms) | MET (677 ms) | true | PASS |
| Cold dev 3 | MET (129 ms) | MET (643 ms) | true | PASS |
| Production cold | MET (95 ms) | MET (477 ms) | true | PASS |

**AC-11: MET.** All three dev cold runs and the production cold run meet the unchanged 200 ms max
and 1,500 ms total budgets, settled successfully, and passed scroll sanity. The fallback verdict
`MAX ONLY` does not apply, so conditional Batches 16-17 are not needed. There is no max, total,
settling, paging, or scroll gap in the AC-11 gate to return for a user decision; the separate
per-tile DOM evidence limitation is documented above and requires a follow-up harness measurement.

### M2 revise round 1

- Corrected per-tile DOM interpretation: last-marked tiles are verified mid-replay; earlier tiles
  are post-marker and not contradicted, but AC 2 is not proven for them by this harness.
- Corrected scroll coverage: Warm 1-tile is not checked by the spec; 0 failures occurred in 8
  checked perf runs, not 9.
- Flagged Cold dev 1's 5,070 ms wall-time outlier with its measurement-window timestamps; AC-11's
  max/total verdict is unaffected.
- Re-checked the Batch 14 sampler guard across all four gating JSON files; every recorded sampler
  span was below 50 ms.
