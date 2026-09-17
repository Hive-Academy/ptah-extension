# Batch 15 (M2) Methodology Review — `TASK_2026_453_1eb4`

Scope: `test-report.md` "M2 — post-Stage-2 measurement (Batch 15 / Task 15.1)" (lines 1122-1375).
Cross-checked against raw evidence in `D:\projects\ptah-453-perf\m2\*.json` and
`D:\projects\ptah-453-perf\m2\*.log`, `D:\projects\ptah-453-perf\m2\idle-checks.log`,
`batches.md` Batch 15 / Task 15.1 (lines 1893-1941) and Task 14.1 AC 4 (lines 1784-1820), the M1
section and Batch 8 section of `test-report.md`, `b6-m1-methodology-review.md`,
`b8-methodology-review.md`, `b14-code-logic-review.md`, and the harness source
(`perf-page-capture.ts`, `tile-open-longtask-budget.perf.spec.ts`). No runs, tests, builds, or
edits were made; this document is the only artifact produced.

## Summary

| Metric              | Value                                 |
| -------------------- | ------------------------------------- |
| Overall score        | 6/10                                  |
| Verdict               | NEEDS_REVISION (report text only — the AC-11 numeric verdict itself stands) |
| Blocking findings     | 0                                      |
| Serious findings      | 2                                      |
| Moderate findings     | 2                                      |
| Minor findings        | 1                                      |

The core deliverable — the AC-11 max/total/settled gate on the 3 dev cold runs plus production
cold — is accurately transcribed from the raw JSON, correctly compared against the unchanged 200
ms / 1,500 ms budgets, and correctly concludes **MET**. That verdict is not in question. Two
secondary claims in the same report overstate what was actually measured: the AC 2/4a per-tile DOM
"MET for every tile" claim, and the scroll-sanity table's "9 checked perf runs" framing. Both are
explained below with file:line/JSON evidence.

## 1. Run set (AC 3) — MET

Verified directly from `diagnosticFlags`/`scenario` in the JSON, not only the report's own table:

| Run | `scenario` | `diagnosticFlags` | Matches AC 3? |
| --- | --- | --- | --- |
| Cold dev 1/2/3 | `cold-3tile` | trace:false, rafAttribution:false, eventCountOverride:null | yes |
| Warm 1-tile | `warm-1tile` | trace:false, rafAttribution:false, eventCountOverride:null | yes |
| Warm 3-tile | `warm-3tile` | trace:false, rafAttribution:false, eventCountOverride:null | yes |
| Production cold | `cold-3tile` | trace:false, rafAttribution:false, eventCountOverride:null | yes (same asserting test, run against the production build) |
| rAF-attribution cold | `diagnostic-cold-3tile` | trace:false, rafAttribution:**true**, eventCountOverride:null (default 2,000) | yes |
| Trace 500 | `diagnostic-cold-3tile` | trace:**true**, rafAttribution:false, eventCountOverride:**500** | yes |
| Trace 2,000 | `diagnostic-cold-3tile` | trace:**true**, rafAttribution:false, eventCountOverride:**2000** | yes |

Console-log test titles corroborate: `m2-cold-dev-*.log`/`m2-production-cold.log` all show
`...spec.ts:273:7 › ... › cold: opening 3 tiles ...`; `m2-warm-1tile.log:` `...:506:7 › diagnostic:
warm 1 tile ...`; `m2-warm-3tile.log:` `...:590:7 › diagnostic: warm 3 tiles ...`;
`m2-raf-attribution.log`/`m2-trace-500.log`/`m2-trace-2000.log` all show `...:438:7 › diagnostic:
cold 3 tiles with optional attribution flags ...`. `m2-load-older-history.log` shows `5 passed
(1.4m)`, matching the report. Run set is complete and matches M1's set exactly (`test-report.md`
M1 section headers: cold ×3, warm ×2, production ×1, rAF-attribution ×1, trace ×2).

## 2. Production cold run — MET, with one framing gap

`m2-production-build.log` confirms `nx run ptah-electron:build-main:production` followed by `nx
run ptah-electron:copy-renderer` (not `copy-renderer-dev`), which per
`apps/ptah-electron-e2e/CLAUDE.md` ("the plain `copy-renderer` target always resolves production
and is used only by `package`") pulls `ptah-extension-webview:build:production` — confirmed in the
log line `> nx run ptah-extension-webview:build:production [local cache]`. `m2-production-cold.log`
then shows a normal Electron boot (DI verify, membership resolution) and the *same* asserting test
title as the dev cold runs, passing with the production-configured renderer in place. This is a
real production-renderer measurement, not a silently-dev-rebuilt one — matches how M1 built
production (`test-report.md:1136-1140` describes the identical build-main/copy-renderer sequence).

`m2-dev-build-restore.log` then shows `build-main:development [local cache]` +
`copy-renderer-dev`, rebuilding the webview with `--configuration=development` before any further
diagnostic run. Sequence order from `idle-checks.log` timestamps: production-build (16:18:00-15),
production-cold (16:18:25-46), dev-build-restore (16:18:55-19:11), rAF-attribution (16:19:21+) —
the restore lands strictly between the production gate and every later run, so no diagnostic run
after it measured the wrong renderer.

**Gap**: the between-step idle checks (all `0`) only rule out `jest-worker`/`run-executor` node
processes; they do not positively confirm the on-disk renderer bundle matches the intended
configuration at each step (e.g. a hash/mtime check on `dist/apps/ptah-electron/renderer`). This is
the same convention gap `b8-methodology-review.md` Finding 2 raised for idle evidence generally —
not new to this report, and not sufficient to doubt the result given the build logs are internally
consistent and Nx reports fresh/cached outputs at each step correctly.

## 3. Idle rule (AC 2) — MET, and an improvement over Batch 8

`idle-checks.log` records 12 before/after pairs (24 checks), all `0`. Unlike `b8-methodology-review.md`
Finding 2 (idle evidence "not independently verifiable from the retained artifacts" because the
idle-check invocation wasn't captured in any log), this report **persists the idle-check output to
its own file**, closing that gap. **Discarded runs: none** — `test-report.md:1166-1169` states no
after-count was non-zero and every run produced a diagnostics JSON; this is consistent with there
being exactly 9 perf-run JSON files plus the functional suite log, with no orphaned/duplicate
timestamps in the directory.

## 4. Cold dev 1 wall-time outlier (5,070 ms vs ~2,100 ms) — plausible, not fully explained

`ac11-perf-cold-3tile-1789650808699.json`: `windowStartMs: 774.2`, final marker (`TILE_2`) at
`2031.2`, `windowEndMs: 5844.2` — i.e. **3,813 ms elapsed between the last marker and window close**,
far more than the ~1,000 ms quiet window used elsewhere (the other 8 runs' wall times cluster at
1,662-2,158 ms). The long-task numbers for this run (max 144 ms, total 550 ms) are the *best* of
the three cold-dev runs, so whatever kept the mutation observer busy for those extra ~3.8 s did not
manifest as additional PerformanceObserver-reported long tasks — it does not change the AC-11
verdict either way (passes on both metrics regardless of wall time, matching the task's own
framing). The report does not surface this outlier or offer a hypothesis; the orchestrator's own
question 4 hypothesis (first-run OS/disk-cache effect, since this is the very first Electron launch
of the whole M2 session while dev cold 2/3 are separate but *later* launches) is plausible but
unverified by any artifact here (no OS-level or process-start-time evidence was captured). **M1 did
not show a comparably isolated single outlier**: M1's own three wall times were 4,868 / 6,965 /
3,876 ms (`test-report.md:523-525`) — all in a similar high range, so M1 offers no clean baseline to
say M2's cold-dev-1 is unusual *relative to M1*; it is only unusual relative to M2's own other 8
runs. This is a **moderate** gap: worth a sentence in the report, not a reason to distrust the
verdict.

## 5. Per-tile DOM sampling (AC 4a) — MET is numerically true but not evidence of what AC 2 asks for two of three tiles per run (Serious)

`perf-page-capture.ts:375-412` (`afterMarkerScan`) takes the **single** "replaying" per-tile DOM
sample (`replayingPerTile = samplePerTileDom()`) only once, gated on `remaining.size === 0` — i.e.
only after **every** tile's marker has appeared, in a `setTimeout(0)` fired from the point the
*last* tile's marker was found. There is no per-tile sample timed to that tile's *own* marker
appearance for the tiles that finish earlier.

Direct evidence from `ac11-perf-cold-3tile-1789650808699.json` (Cold dev 1):

- `markerTimes: [1149.5, 1250.5, 2031.2]` (Tile 0, Tile 1, Tile 2).
- The one global replaying sample fires essentially at `2031.2` ms (immediately after Tile 2's
  marker, via `setTimeout(0)`).
- Tile 0: `domReplaying: 776`, `domSettled: 758` — sampled **~882 ms after its own marker**, by
  which point it had already reached (and, on this run, slightly overshot) its final settled count.
- Tile 1: `domReplaying: 758`, `domSettled: 758`, **ratio exactly 1.000** — sampled ~781 ms after
  its own marker; it had already reached its exact final DOM count.
- Tile 2: `domReplaying: 452`, `domSettled: 762`, ratio 0.593 — sampled essentially at its own
  marker time, genuinely mid-replay.

This pattern repeats across the full run table (`test-report.md:1213-1239`): Tile 0's ratio is
1.000-1.024× in 8 of 9 runs (exactly 1.000× in 6 of them: cold dev 2/3, production, trace 500,
trace 2,000, and effectively rAF-attribution/1.000×), Tile 1 ranges 1.000-1.165×, while Tile 2 is
consistently 0.593-0.640× — the one tile whose sample timing genuinely coincides with an
in-progress replay. A ratio of exactly `758/758 = 1.000` is not "DOM stayed under 2× while
replaying" — it is "the tile had already finished replaying, and settling removed nothing," which
tells a reader nothing about whether that tile's DOM ever exceeded budget *during* its own replay
window (e.g. an early transient overshoot that resolves back down before the global sample would be
invisible here, and would still report MET).

The report's own line, "**AC 2 is MET for every measured tile**" (`test-report.md:1206-1211`), is
true as a numeric statement (no ratio exceeds 2×) but overstates the evidentiary weight for Tile 0
and, in most runs, Tile 1: those are "not contradicted" results (the sample simply doesn't probe the
replay-in-progress state for those tiles), not "verified" ones in the sense AC 2 intends. Only
Tile 2's row per run is a genuine mid-replay observation. `batches.md:1234-1235` states "M2 (Task
15.1) then requires the per-tile DOM ratio, so M1 AC 2 PARTIAL closes at M2" — that closure is only
solid for one of three tiles per run; the report should disclose this timing limitation rather than
present a uniform "MET for every measured tile."

This is not a fabricated finding — the numbers in the table match the JSON exactly (spot-checked
against `ac11-perf-cold-3tile-1789650808699.json` above) — the concern is entirely about what a
single global sample point, anchored to the last-finishing tile, can and cannot prove for the
other tiles.

**Secondary note (also asked)**: per-tile settled counts do not sum to the whole-canvas settled
count (e.g. Cold dev 1: 758+758+762 = 2,278 vs whole-canvas `settled: 2734`), which the report
correctly attributes to per-tile samples being scoped to `ptah-chat-transcript` while the
whole-canvas count (`domCount()`, `perf-page-capture.ts:229-230`) queries all of
`[data-testid="canvas-tile"] *` (toolbar/header/other chrome included). This is disclosed
(`test-report.md:1173-1175`) and is not a defect.

## 6. Scroll sanity (AC 6) — checked runs all pass; the report's own coverage count is inflated (Serious)

`assertScrollSanity` is called in exactly three tests in
`tile-open-longtask-budget.perf.spec.ts`: the asserting cold-3tile test (`:372`), the
diagnostic-cold-3tile test (`:468`), and the warm-3tile test (`:632`). It is **not** called in the
warm-1-tile test (`:506-588` — confirmed by reading the full test body: it ends at
`waitForTileMarker(page, real.marker)` and goes straight to `writeDiagnostics`, no
`assertScrollSanity` anywhere in that block). That means, of the 9 perf-run rows in the M2 "Scroll
sanity" table, only 8 (cold dev ×3 via cold-3tile, rAF-attribution/trace 500/trace 2,000 via
diagnostic-cold-3tile, warm-3tile, and production cold via the same cold-3tile test) actually
executed the check; **Warm 1-tile did not**.

The report's own summary line — "**0 scroll failures in 9 checked perf runs**"
(`test-report.md:1307-1309`) — is therefore inaccurate by one: it should read 8 checked runs (plus
Warm 1-tile as not-applicable), not 9. Task 15.1 AC 6 itself is worded carefully ("0 failures across
all runs with the check"), and AC 3's instruction is "scroll sanity on every run that has it" — both
correctly anticipate that not every run has the check. The report's table does not reflect that
distinction: Warm 1-tile is listed as "PASS" in the same column as genuinely-checked runs, with no
"n/a"/"not applicable" marker, so a reader cannot tell from the table alone that one of the nine
rows was never tested. This is the same shape of gap M1 carried (M1's own scroll table,
`test-report.md:485-497`, also lists "Warm 1-tile | PASS" despite M1's own text
(`test-report.md:479-483`) stating `assertScrollSanity` "is called ... in all three tests it
appears in" — i.e. M1 already knew and stated the count was three, yet still tabulated Warm 1-tile
as a pass). Neither `b6-m1-methodology-review.md` nor `b8-methodology-review.md` flagged this
inherited inaccuracy, so it has passed two prior reviews uncorrected.

This does not put a real defect at risk of going unnoticed — a solo-tile scenario has no
multi-tile admission-queue contention, which is the mechanism the M1 scroll regression was
attributed to — but the report's own coverage claim should say 8, not 9, and the table should mark
Warm 1-tile "n/a (no scroll-sanity call in this test)" rather than "PASS".

## 7. AC 5 — volume independence — MET

Trace 500 vs Trace 2,000 (both `diagnostic-cold-3tile`, `trace:true`, `eventCountOverride` 500 vs
2000 — confirmed cold, same test/shape): long-task total 498→448 ms (0.900×), max 110→106 ms
(0.964×), count 6→6, `FireAnimationFrame` count 46→48 (1.043× despite 4× event volume). All flat
within run-to-run noise, correctly concluded volume-independent. Paging diagnostics confirm both
runs paged identically (`requestedMaxEvents: 250` on every tile in both), so the comparison is
apples-to-apples on the paged tail, not on differently-sized replay payloads.

## 8. Functional load-older suite and AC-11 verdict logic — MET

`m2-load-older-history.log` shows `5 passed (1.4m)`, matching the report's "five cases" claim.
Every gating-run JSON (`ac11-perf-cold-3tile-1789650808699/…78615/…931012.json` and the production
run) carries `"budgets": {"maxMs": 200, "totalMs": 1500}` — the budget was not loosened. The AC-11
table (`test-report.md:1362-1374`) correctly requires all 4 gating runs (3 dev cold + production
cold) to jointly clear max, total, `settled`, and scroll, and correctly concludes MET since every
cell in that table is MET/true/PASS. The fallback "MAX ONLY" rule (AC 8) does not apply because no
gating run's max exceeds 200 ms; Batches 16-17 are correctly left uninvoked. This numeric verdict is
sound and independent of the two Serious findings above (neither DOM ratio nor scroll-sanity
coverage feeds AC-11's own gate).

## Failure modes

### AC 4a per-tile DOM sample timed to the wrong tile

- Trigger: any run where an early-clicked tile (Tile 0, often Tile 1) fully finishes replaying and
  settles before the last-clicked tile's marker appears.
- Symptom: the report shows a "replaying" DOM sample equal (or near-equal) to the "settled" sample
  for that tile and marks AC 2 "MET," implying the DOM count was checked mid-replay when it was
  actually checked post-settle.
- Evidence: `perf-page-capture.ts:375-412`; `ac11-perf-cold-3tile-1789650808699.json`
  (`markerTimes`, `domNodes.perTile`).
- Current handling: none — the harness takes one global sample regardless of when each tile
  individually finished.
- Recommendation: sample each tile's "replaying" DOM count at that tile's own marker-found instant
  (inside `recordMarkers`/`afterMarkerScan`, per-marker rather than once globally), or explicitly
  caveat in the report which tiles' MET verdicts are "not contradicted" vs. "verified mid-replay."

### Scroll-sanity coverage table conflates checked and unchecked runs

- Trigger: reading the M2 (or M1) scroll-sanity table without also reading the prose noting only
  three of the spec's tests call `assertScrollSanity`.
- Symptom: a reader concludes all 9 (M2) / 11 (M1) rows were scroll-checked; only 8 (M2) / 10 (M1,
  excluding the retry-replaced failures) actually were.
- Evidence: `tile-open-longtask-budget.perf.spec.ts:372,468,506-588,632`; `test-report.md:1293-1309`,
  `:479-497`.
- Current handling: the summary line states a checked-run count one higher than the source
  supports; the table has no "n/a" row.
- Recommendation: mark Warm 1-tile "n/a" in the table and correct "9 checked perf runs" to "8."

## Blocking issues

None found. The AC-11 gating numbers (max/total/settled) are transcribed correctly from the raw
JSON in every gating run checked, the budgets are unchanged, and the verdict logic is applied
exactly as `batches.md` Task 15.1 AC 7 specifies.

## Serious issues

### AC 2/4a "MET for every measured tile" overstates two-thirds of the per-tile samples

- File: `test-report.md:1206-1211`, `1213-1239`; `perf-page-capture.ts:375-412`.
- Scenario: any reader treating M2 as proof the per-tile DOM count never exceeds 2× while genuinely
  replaying, for Tile 0/Tile 1 specifically.
- Impact: the M1 AC 2 PARTIAL closure this batch was built to deliver
  (`batches.md:1234-1235`) is only actually delivered for Tile 2 per run; Tiles 0/1's "MET" is an
  artifact of sample timing, not evidence of DOM behavior during their own replay.
- Fix: report text should distinguish "verified mid-replay" (Tile 2, every run) from "not
  contradicted, sampled post-settle" (Tile 0, and Tile 1 in most runs) — or the harness should be
  changed to sample each tile at its own marker time in a future measurement task.

### Scroll-sanity coverage overstated by one run

- File: `test-report.md:1293-1309`; `tile-open-longtask-budget.perf.spec.ts:506-588`.
- Scenario: a reader relying on "0 scroll failures in 9 checked perf runs" as coverage evidence.
- Impact: Warm 1-tile was never scroll-checked; the true count is 8/9, inherited unnoticed from M1
  and not caught by either prior methodology review.
- Fix: relabel Warm 1-tile "n/a" in the table and correct the summary count to 8.

## Moderate and minor issues

- Moderate: Cold dev 1's 5,070 ms wall time (vs 1,662-2,158 ms for the other 8 runs) is not
  explained or even flagged in the report; the long-task numbers are unaffected, but a future reader
  comparing wall times across runs has no signpost that this one is an outlier (`ac11-perf-cold-3tile-1789650808699.json` `windowStartMs`/`windowEndMs`).
- Moderate: `b14-code-logic-review.md:102,112` flagged that the per-tile sampler's macrotask guard
  covers only its own measured span, not the full enclosing macrotask — a theoretical contamination
  risk for the long-task sum. Empirically this did not manifest in M2 (`perTileHarnessTaskMaxDurationMs:
  6.9` in the sampled JSON, far under the 50 ms threshold), but the report doesn't mention re-checking
  this PARTIAL finding from Batch 14 before relying on the sampler for the AC-11 gate.
- Minor: `idle-checks.log` is a genuine improvement over Batch 8's unrecorded idle checks
  (`b8-methodology-review.md` Finding 2) — noted for credit, not a defect.

## Data flow

1. `openTilesWithinPage` clicks all 3 tile buttons, installs a `MutationObserver` — OK.
2. Per-marker DOM scan finds each marker's text and timestamps it — OK, confirmed against
   `markerTimes` in the JSON.
3. Once the **last** marker is found, one `setTimeout(0)` fires `samplePerTileDom()` for the
   "replaying" sample, then starts the settle window — gap: this single global timing point is not
   representative of each tile's own replay-in-progress state (Serious finding above).
4. Quiet timer (1,000 ms no mutation) or 10 s cap closes the window and takes the "settled" sample —
   OK.
5. `assertScrollSanity` runs post-window in the three tests that call it — OK where called; not
   called at all in warm-1-tile — gap (Serious finding above), silently absent rather than marked
   n/a in the report.
6. Diagnostics JSON is written per run, verified byte-for-byte against the report's tables for
   every field checked in this review — OK.
7. AC-11 verdict is computed from the 4 gating runs' max/total/settled — OK, correctly applied.

## Requirements fulfilment

| Requirement (Task 15.1 AC) | Status | Gap |
| --- | --- | --- |
| AC 1 build/commit/env identity | COMPLETE | — |
| AC 2 idle rule | COMPLETE | Idle-check output now persisted (improvement over Batch 8) |
| AC 3 run set matches M1 | COMPLETE | — |
| AC 4 per-run table completeness | COMPLETE | — |
| AC 4a per-tile DOM MET/NOT MET | PARTIAL (evidentiary, not numeric) | MET is numerically correct for every tile, but only Tile 2 per run is a genuine mid-replay sample; Tile 0 (and usually Tile 1) are sampled post-settle |
| AC 5 volume independence | COMPLETE | — |
| AC 6 scroll 0 failures across runs with the check | COMPLETE for the runs actually checked | Report's own "9 checked" count should be 8; Warm 1-tile is not scroll-checked and should be marked n/a |
| AC 7 AC-11 verdict logic | COMPLETE | — |
| AC 8 fallback rule | COMPLETE (not triggered; correctly so) | — |
| AC 9 evidence paths listed | COMPLETE | Spot-checked several JSON/log paths; all exist and match |

Implicit requirements not addressed: none identified beyond the two Serious findings above.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Tile finishing replay before the global DOM sample fires | NO (as a distinct case) | Single global sample regardless of individual tile timing | Early tiles' "replaying" sample is really a post-settle sample (Serious) |
| Run with no scroll-sanity call at all | Partially | Spec simply omits the call for warm-1-tile | Report doesn't mark it n/a, inflates the checked-run count (Serious) |
| Contaminated/discarded run | YES | Idle check + `measurement unusable` guard; none triggered this session | — |
| Production build silently reusing dev renderer | YES | `copy-renderer` (not `-dev`) always resolves production; verified in build log | — |
| Volume (500 vs 2,000 events) skewing comparison | YES | Both cold, same test, only `eventCountOverride` differs | — |

## Verdict

- Recommendation: REVISE (the report text, not the measurement) — correct the AC 4a "MET for every
  measured tile" framing and the AC 6 "9 checked perf runs" count before this document is treated as
  the final, closing record for M1's AC 2 PARTIAL and for scroll-sanity coverage. No re-run of the
  perf suite is required — both corrections are textual/interpretive, not new measurements.
- **AC-11 MET verdict stands.** Neither Serious finding touches the long-task max/total/settled
  gate; Batches 16-17 correctly remain uninvoked.
- Confidence: HIGH — every numeric claim spot-checked against the raw JSON/log matched exactly; the
  two Serious findings are about what the numbers can be said to prove, not about transcription
  accuracy.
- Top risk: a future reader cites "M2 proved per-tile DOM stays under 2× during replay for all three
  tiles" when the harness only actually observed that for the last-clicked tile per run.
- What a robust remeasurement would add: (1) sample each tile's DOM at its own marker-found instant
  rather than once globally; (2) mark scroll-sanity "n/a" for tests that never call
  `assertScrollSanity`, and correct the checked-run count; (3) one sentence noting the cold-dev-1
  wall-time outlier and that it does not affect the long-task verdict.
