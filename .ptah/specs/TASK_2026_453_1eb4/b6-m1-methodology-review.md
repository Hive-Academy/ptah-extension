# Methodology Review — M1 section, `test-report.md` (Batch 6 / Task 6.1)

Reviewer: independent methodology check, not the senior-tester who wrote the report.
Scope: M1 section only (`test-report.md:392-809`). M0 section and its own prior team-leader
verification (`batches.md:439-459`) are read for context/precedent, not re-litigated.

## Verdict: NEEDS_REVISION

The AC-11 verdict itself, the scroll-sanity finding, and the overwhelming majority of the
arithmetic in M1 are correct and recompute cleanly from the raw diagnostics JSON and logs —
this is a well-executed measurement. But the report contains one factual data error in a
published table cell, one internal count contradiction, and an unstated bias risk on the
AC-11 sample that a reader relying on this report for the Stage 2 decision needs disclosed.
None of these change the AC-11 NOT-MET conclusion, but they need fixing before this section
is final evidence.

---

## 1. Table-number recomputation

Recomputed directly from the raw JSON in `D:\projects\ptah-453-perf\m1\*.json` (not from the
report's own prose), for every table in the M1 section:

- Cold dev runs 1/2/3-retry: `wallMs`, `longTaskCount`, `maxDurationMs`, `totalDurationMs`,
  `settled`, `domNodes`, `preWindowExcluded`, `perClick`, `perMarker` all match the report
  exactly, verified against
  `ac11-perf-cold-3tile-1789576078004.json` (run 1),
  `...-1789576178284.json` (run 2), `...-1789576362929.json` (run 3-retry).
  Per-tile and per-marker bucket totals sum to each run's `totalDurationMs` and
  `longTaskCount` (run 1: 162+168+2896=3226, count 1+2+30=33; run 2: 240+188+4499=4927,
  count 1+2+37=40; run 3-retry: 114+70+1985=2169, count 1+1+23=25 — all correct).
- TILE_2 share of total: run 1 2,896/3,226 = 89.77% (report: 89.8% ✓); run 2 4,499/4,927 =
  91.31% (report: 91.3% ✓); run 3-retry 1,985/2,169 = 91.51% (report: 91.5% ✓).
- Per-tile wall time (click-to-marker), recomputed from `clickTimes`/`markerTimes` in
  `ac11-perf-cold-3tile-1789576078004.json`: TILE_0 1474.4-666.3=808.1, TILE_1
  1885.4-814.8=1070.6, TILE_2 3727.5-992=2735.5 — matches the report's "Per-tile wall time"
  table row 1 exactly (`test-report.md:530`).
- Production cold, warm 1-tile, warm 3-tile, trace 500/2000: `wallMs`/`max`/`total`/`settled`/
  `domNodes` all match `ac11-perf-cold-3tile-1789576579026.json`,
  `ac11-perf-warm-1tile-1789576438127.json`, `ac11-perf-warm-3tile-1789576512443.json`,
  `ac11-perf-diagnostic-cold-3tile-500-1789576738580.json`,
  `ac11-perf-diagnostic-cold-3tile-2000-1789576876945.json` respectively.
- DOM ratios: every one of the 9 rows in "DOM node counts" (`test-report.md:672-682`)
  recomputes correctly to 3 decimal places (e.g. cold dev 2: 1798/7308=0.2461→0.246× ✓; warm
  1-tile: 2772/2018=1.374× ✓).
- rAF histogram (`ac11-perf-diagnostic-cold-3tile-2000-1789576658910.json`): 10 rows sum to
  139 total calls exactly; every row's share recomputes correctly (e.g.
  `scheduleStickToBottom` 53/139=38.13%→**38.1% confirmed correct**;
  `scheduleFrame` 7/139=5.04%→5.0% confirmed correct). M0-side comparison numbers (1,517
  total, 1,339/1,517=88.27%→88.3%) also recompute correctly.
- `FireAnimationFrame` scaling: M1 49→86 for 4x events = 1.755×→1.76× (report ✓); M0
  448→1,386 = 3.094×→3.09× (report ✓).
- Main-thread trace shares, both event sizes: every category's ms/wall% recomputes correctly
  against `ac11-perf-diagnostic-cold-3tile-2000-1789576876945.json`'s `traceSummary.byName`
  (e.g. 2,000-events `FunctionCall` 1525.53/3806.80=40.079%→40.08% ✓; `TimerFire`
  1015.51/3806.80=26.671%→26.67% ✓). Family-total row sums recompute as the report's own
  hand-check states (354.60 and 886.76 — both confirmed independently). No `GPUTask` row is
  present in either raw trace file, confirming the report's claim.

**Two exceptions found** (see Blocking-adjacent findings below): the warm-1-tile
`preWindowExcluded` cell is factually wrong, and the idle-attempt count is internally
inconsistent.

## 2. Retry policy (scroll-sanity failure → clean retry fills the AC-11 slot)

Confirmed from `apps/ptah-electron-e2e/src/specs/chat/tile-open-longtask-budget.perf.spec.ts:277-351`
(asserting test) and `:378-381` (diagnostic test): `assertScrollSanity` runs strictly before
`summarizeMeasurement`/`writeDiagnostics` in both tests. Confirmed from
`D:\projects\ptah-453-perf\m1-run3.log` and `m1-trace-2000.log`: both failing attempts throw
`[AC-11 functional] scroll sanity failed: ...` immediately after the marker/tile-count
assertions and **before** any `[AC-11 perf] wall=...` line is logged, and no diagnostics JSON
exists for either failed attempt. So the report's claim "the throw happens before the write"
is correct, and there is no discarded long-task data being hidden — the failed attempts
genuinely produced zero perf numbers.

Given that, retrying is the only way to fill the slot, and doing so is not "cherry-picking a
nicer number" in the naive sense (there was no number to compare against). **However, the
report does not address a real and plausible bias**: `scheduleStickToBottom` (scroll-stick
scheduling) is the single largest rAF call site in M1 (38.1% of all captured rAF calls,
`test-report.md:583`), and a scroll-sanity failure is, by definition, a run where that same
scroll-correction machinery misbehaved (a tile 132px or 31,155px from where it should have
settled). It is plausible — not certain, but plausible enough to require disclosure — that a
run where scroll-stick logic is visibly malfunctioning also does more corrective layout/rAF
work than the clean retries that replaced it in the AC-11 table. If so, the reported 3-run
cold-dev spread (`test-report.md:497-501`) is a survivorship-biased sample that could
understate the size of the true AC-11 gap, which matters directly for the Stage 2 sizing
decision this report exists to inform (`test-report.md:746-767`).

**What the report must say**: state explicitly, next to the retry policy, that the retry
substitution could not recover what the failed attempt's own long-task numbers would have
been, that scroll-sanity failure is not proven independent of long-task severity (both
plausibly share a root cause in C5's replay-tail behaviour), and that the 3-run cold-dev
sample should be read as a lower bound on the true miss, not a symmetric, unbiased sample.
This is a moderate-severity gap in the report's own honesty section, not a fatal flaw in the
underlying data.

## 3. "Not present at M0" / C5 attribution for the scroll-sanity regression

Confirmed via `git log -p --follow -- apps/ptah-electron-e2e/src/support/perf-measurement-report.ts`:
`assertScrollSanity`/`checkTileScrollSanity` were introduced in commit `49b436256` — the exact
Batch 1 / M0 commit — so the check was live and running during every M0 run, not added later.
Confirmed via `grep -in "scroll" D:\projects\ptah-453-perf\m0-*.log`: **zero matches across all
9 M0 log files.** Since `assertScrollSanity` only produces output on failure (throws; logs
nothing on pass — `perf-measurement-report.ts:153-166`), zero matches is exactly what a clean
pass on every M0 run looks like, not silence-by-omission.

So the claim "M0 had no scroll-sanity failures in its 9 runs" is **proven**, not merely
inferred, because the identical unmodified check ran at both M0 and M1 on the identical
harness (`git status --short` confirms the worktree has only `test-report.md` modified;
`git log --oneline -1` is `0149adef8` throughout M1). The **attribution specifically to C5**
(as opposed to C1/C2/C3, all of which also landed between M0 and M1) is correctly hedged by
the report itself — it says "M0 predates C5" and cites `batches.md`'s own prior Task 5.1
residual-risk note rather than asserting proof, and it does not claim to have isolated which
Stage-1 batch caused the regression. That is the right level of confidence: **plausible and
well-cited, not proven** — no bisection across C1/C2/C3/C5 was run, and the report does not
claim one. No finding needed here beyond noting that a bisection is the natural follow-up.

## 4. DOM ratio: sampling moment and per-tile requirement

Confirmed via `perf-page-capture.ts:206-230,266-271`: `replayingDom` is captured once, inside
`afterMarkerScan`, the first time a marker is found (`if (found && replayingDom === null)`) —
this is the same "first marker's appearance" moment at both M0 and M1, on unmodified code, so
the two datasets are taken at a comparable instant. Confirmed.

**Not per-tile**, and the report says so itself (`test-report.md:689-700`, "Known measurement
gap"): `domCount()` at `perf-page-capture.ts:206-207` is
`document.querySelectorAll('[data-testid="canvas-tile"] *').length` — a single count across
every tile's subtree, not scoped per tile. Task 6.1 AC 2 reads "Per-tile wall time ... and DOM
count during replay ≤ 2× the settled count" (`batches.md:798`); read together with the M0
section's own framing ("Batch 5 (C5)'s own M1 acceptance criterion (per-tile replaying ≤ 2×
settled)", `test-report.md:263-264`) and `batches.md:424-425` ("C5/M1 needs its own per-tile
breakdown"), the DOM-count half of AC 2 is very likely meant to be per-tile too. The report's
own "yes" column in the DOM table (`test-report.md:672-682`) answers a whole-canvas question,
not the per-tile one AC 2 asks. This is disclosed, but disclosed as a footnote under a table
that otherwise reads as "yes" nine times in a row — a reader skimming the table would come
away thinking AC 2 is cleanly met, when the more specific per-tile form of AC 2 is **not
measured at all**, only argued to be "very unlikely" to fail. Recommend elevating this from a
trailing paragraph to an explicit "PARTIAL" marker on the AC-2 line itself.

## 5. Verdict logic, TILE_2 explanation, `scheduleStickToBottom` 38.1%

- **AC-11 verdict vs Task 6.1 AC 3**: AC 3 requires all 3 cold dev runs AND the production
  cold run to have `max<=200` and `total<=1500` with `settled:true`
  (`batches.md:799-802`). The report's own table (`test-report.md:733-738`) shows cold dev 1
  and 2 fail both budgets, cold dev 3-retry fails total only, production passes both — so "NOT
  MET" is the only conclusion the stated rule permits. Verdict logic is correctly applied.
- **"TILE_2 pays for serialized work"**: supported by the per-tile wall-time table
  (`test-report.md:530-533`, verified against raw `clickTimes`/`markerTimes` in section 1
  above) — TILE_2's click-to-marker latency is 2,735.5/1,070.6=2.55× TILE_0's in run 1 and
  similarly elevated in runs 2 and rAF-attribution; this is a direct, non-inferred measurement
  of admission-queue serialization, not an assumption.
- **`scheduleStickToBottom` = 38.1% of rAF**: confirmed correct in section 1 (53/139=38.13%).

## 6. Idle protocol evidence

Confirmed present for every run: `test-report.md:436-452` gives a Before/After pair per
attempt, all `0`/`0`, and no run's log contains any indication of a discarded/contaminated
attempt. However:

- **No timestamps.** The task's own instruction (and `handoff.md` §6 rule 4) requires the idle
  check "immediately before AND after" each run; the M1 report's table records only the 0/0
  outcome, with no wall-clock timestamp per check and no captured command output in any of the
  13 `m1-*.log` files (the idle check is a separate PowerShell invocation, not part of the
  Playwright run, so it leaves no artifact at all). This means the "immediately
  before/after" timing claim is entirely self-reported with no audit trail — the same
  limitation M0 carried (M0's table has the identical 0/0-only format), so this is not a
  regression, but it is a real gap against what this review was asked to check. Minor
  severity: no evidence of contamination exists either way, but the claim cannot be
  independently verified from any artifact in `D:\projects\ptah-453-perf`.
- **Count contradiction.** `test-report.md:422-424` states "Checked immediately before and
  immediately after every run below (**11 attempts total**, including the 2 retries described
  under 'Scroll sanity')", but the idle-check table immediately below it
  (`test-report.md:438-452`) lists 13 distinct rows (1 through 11, plus `3b` and `11b`). The
  M1 Verdict section later says "every one of the **13** attempted runs had a clean idle
  check" (`test-report.md:778`), which matches the table but contradicts the Environment
  section's "11 attempts total" sentence one page earlier. One of these two numbers is wrong;
  the table (13) is the one that reconciles with the listed runs, so the Environment-section
  sentence needs the fix.

## Other findings

### Finding: warm-1-tile `preWindowExcluded` cell is factually wrong (Serious)

- File: `test-report.md:550` — "| Warm 1-tile | 1,760.60 | 4 | 85 | 279 | (n/a, single tile) |
  2,772 / 2,018 | 1.374× |"
- Evidence: `D:\projects\ptah-453-perf\m1\ac11-perf-warm-1tile-1789576438127.json` →
  `"preWindowExcluded": { "count": 5, "totalMs": 458 }`.
- Impact: the table tells the reader there is no pre-window exclusion to consider for warm
  1-tile ("n/a"), but the raw JSON records **5 long tasks totalling 458 ms excluded before the
  window opened** — a number larger than the reported in-window total itself (279 ms). This is
  not a rounding slip; it is a materially different fact than what the table states, on a run
  the report elsewhere calls a clean pass "comfortably" (`test-report.md:553`). It does not
  change the AC-11 verdict (warm scenarios are not gated), but it is exactly the kind of
  number a reader would want when judging how much pre-window activity this scenario carries
  compared to the gated cold runs (which show 2 tasks / ~200 ms each). The warm-3-tile row two
  lines below it (`4 tasks / 357 ms`) correctly reports the same field from its own JSON, so
  this is an isolated transcription error on one row, not a systemic misunderstanding of the
  field.
- Fix: replace "(n/a, single tile)" with "5 tasks / 458 ms" and, if "single tile" was meant to
  argue something else (e.g. no *inter-tile* pre-window contention), state that separately
  rather than in the `preWindowExcluded` cell.

### Finding: idle-attempt count contradiction (Minor)

- File: `test-report.md:422-424` ("11 attempts total") vs `test-report.md:438-452` (13 rows)
  vs `test-report.md:778` ("13 attempted runs").
- Impact: does not affect any perf conclusion, but undermines confidence in the "every X was
  checked" framing that this section leans on for its idle-protocol claim.
- Fix: correct "11 attempts total" to "13 attempts total" in the Environment section.

### Finding: Batch-2 item 5's trace-table gap only partially closed (Moderate)

- `batches.md:450-452` (Batch 2 outcome, item 5) told M1 to report `preWindowExcluded` in the
  warm and trace tables, which M0 had omitted. M1's warm table now includes the column
  (`test-report.md:548-551`) — good, modulo the warm-1-tile error above — but the **trace
  table** (`test-report.md:611-617`) still has no `preWindowExcluded` column, even though the
  raw JSON carries the field for both trace runs (500-events: 2 tasks/159 ms; 2,000-events: 2
  tasks/152 ms, confirmed by direct JSON read). The gap batches.md asked to be closed is only
  half-closed.

## Data flow (idle check → run → measurement → write → report), annotated

1. Idle check (PowerShell CIM query) before run — OK, but no artifact retained (see §6).
2. Playwright run launches Electron, opens tiles, observer records long tasks — OK, confirmed
   unmodified harness (git status).
3. `assertUsableMeasurement` → `assertScrollSanity` gate, before measurement write — OK,
   confirmed ordering in spec source; confirmed via logs that failures here produce zero
   downstream data (no silent partial write).
4. `summarizeMeasurement` → `writeDiagnostics` → JSON on disk — OK, every referenced JSON
   exists and its fields were independently recomputed against the report's tables (§1).
5. Idle check after run — OK, same no-artifact caveat as step 1.
6. Report authoring: transcription from JSON into markdown tables — **one factual error**
   (warm-1-tile `preWindowExcluded`) and **one internal count inconsistency** (11 vs 13 idle
   attempts) found at this step; everything upstream of it (steps 1-5) is sound.
7. Verdict synthesis (AC-11 NOT MET, Stage 2 framing) — OK, correctly derived from the
   (correct) cold/production numbers; the retry-substitution bias in step 3 is not carried
   forward into this synthesis as a caveat, which is the section's main omission (§2).

## Requirements fulfilment (Task 6.1 AC 1-3)

| AC | Status | Gap |
| --- | --- | --- |
| AC 1: same run set + protocol as Task 2.1, plus scroll sanity on every run | COMPLETE | Idle-check timestamps not captured as artifacts (same as M0); retry substitution's bias risk on the AC-11 sample is not disclosed |
| AC 2: per-tile wall time + DOM ≤ 2× settled | PARTIAL | Per-tile wall time delivered and verified correct; DOM ≤2× check is whole-canvas only, not per-tile, disclosed only as a trailing note rather than marked PARTIAL on the AC line itself |
| AC 3: AC-11 MET only if all cold + production clear both budgets | COMPLETE | Verdict logic correctly applied and independently reproduced from raw JSON |

## Verdict

- Recommendation: REVISE (methodology and data are sound; two concrete report-authoring
  defects and one undisclosed bias risk need fixing before this section stands as final
  evidence for the Stage 2 decision).
- Confidence: HIGH — every claim above was checked against the raw JSON/log files, not the
  report's own prose.
- Top risk: the retry-substitution bias (§2) is silent in the report and could make the
  reported AC-11 gap look smaller than the true population gap, which is the exact number
  Stage 2 sizing will be anchored to.
- What the report should add before commit: (1) fix the warm-1-tile `preWindowExcluded` cell,
  (2) reconcile "11" vs "13" idle attempts, (3) add `preWindowExcluded` to the trace table, (4)
  mark AC 2's DOM check as PARTIAL (whole-canvas, not per-tile) rather than a trailing caveat,
  (5) add one sentence disclosing that the scroll-sanity retry substitution could bias the
  cold-dev sample toward under-stating the AC-11 gap.

## Delta

Re-read the current M1 section of `test-report.md` (report-only edits since the review above;
`git diff --numstat` confirms only `test-report.md` changed, no runs). Checked each of the 5
findings against the raw JSON/logs directly, not against the report's own new prose.

1. **Warm-1-tile `preWindowExcluded` (Serious) — CLOSED.** `test-report.md:567` now reads "5
   tasks / 458 ms", matching `ac11-perf-warm-1tile-1789576438127.json` →
   `preWindowExcluded: {count:5, totalMs:458}` exactly. A correction note at `:570-576`
   explains the number is larger than the in-window total (279 ms) — accurate, and it no
   longer tells the reader "n/a" where real data exists.
2. **Idle-attempt count contradiction (Minor) — CLOSED.** `test-report.md:422-424` now says
   "13 attempts total," matching the 13-row idle-check table (`:440-454`) and the Verdict
   section's "13 attempted runs" (`:833`). Re-examined the apparent "2 of 11 attempts (18%)
   failed scroll sanity" wording still present at `:501` and in the comparison table (`:749`)
   — this is a **different, correct** denominator (11 actual Playwright perf-spec invocations
   subject to `assertScrollSanity`), distinct from the 13 idle-checked events (which also
   count the two non-test build steps, "Production build" and "Dev build restore," rows 6 and
   8 in the idle table, that never call `assertScrollSanity`). The two counts describe
   different populations and are both internally consistent now — no residual contradiction.
3. **Trace table missing `preWindowExcluded` (Moderate) — CLOSED.** `test-report.md:637-640`
   now has the column with "2 tasks / 159 ms" (500 events) and "2 tasks / 152 ms" (2,000
   events), matching `ac11-perf-diagnostic-cold-3tile-500-1789576738580.json` and
   `...-2000-1789576876945.json` (`preWindowExcluded: {count:2, totalMs:159}` and
   `{count:2, totalMs:152}` respectively, confirmed by direct JSON read) exactly.
4. **AC 2 DOM check reported as unqualified per-tile pass (Moderate) — CLOSED.** The DOM
   section now opens with "**AC 2 status: PARTIAL**" (`:702-710`), the summary table's status
   column is relabelled "<= 2× (whole-canvas)?" so a "yes" no longer implies the per-tile
   question was answered, and the AC-status table (`:790`) and final Verdict
   ("Criteria not proven," `:841-844`) both carry PARTIAL through consistently. Matches the
   underlying fact (no per-tile field exists in the harness's JSON output, confirmed in the
   original review).
5. **Undisclosed retry-substitution bias (Moderate) — CLOSED.** New paragraph at `:462-475`
   ("Disclosed bias risk on the AC-11 sample") and a matching bullet in the Verdict section
   (`:849-857`) state the risk plainly: the two scroll-sanity-failed attempts produced no
   long-task data, `scheduleStickToBottom` is the largest single rAF site (38.1%), and the
   reported 3-run cold-dev sample should be read as a lower bound, not a symmetric sample. The
   report's own supporting claim — "neither `m1-run3.log` nor `m1-trace-2000.log` contains an
   `[AC-11 perf] wall=...` or long-task line" — was re-verified directly:
   `grep -in "long task" m1-run3.log` matches only the Playwright test-title string (3 hits, no
   measurement line); the same grep against `m1-trace-2000.log` returns zero matches; neither
   file contains `AC-11 perf.*wall=`. The claim is accurate.

**New content not requested by the 5 findings**: a "User decision recorded (2026-09-16)"
paragraph was added at `test-report.md:793-799` (Stage 2 option (ii) chosen; scroll-sanity fix
routed to "architect then C5"). This is process/decision narrative, not a measurement claim,
so it is outside this delta's JSON/log-verification scope — flagging only so the coordinator
is aware the diff is not limited to the 5 findings, not because it contains an error.

**No new errors found.** Spot-checked the surrounding tables that were touched to carry the
fixes (cold-dev, production, rAF histogram, trace shares) against the same raw JSON re-read
for the original review — all numbers are unchanged and still correct.

**Verdict: APPROVED.**
