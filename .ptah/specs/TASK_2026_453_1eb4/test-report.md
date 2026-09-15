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
