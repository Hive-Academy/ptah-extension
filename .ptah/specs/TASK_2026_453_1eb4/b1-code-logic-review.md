# Code Logic Review — `TASK_2026_453_1eb4` Batch 1 (C4 perf harness + PR #518 CodeRabbit fixes)

Reviewed as an independent lane (codex CLI implemented; this review is Claude, per D3). Read in
full: `batches.md` (Common rules, Batch 1, Assumptions/Risks), `implementation-plan.md` C4
(:358-409), `b1-codex-report.md`, and every changed/created file in full —
`tile-open-longtask-budget.perf.spec.ts` (855 lines), `perf-page-capture.ts` (391 lines),
`perf-session-fixture.ts` (146 lines), `perf-diagnostics.ts` (416 lines), `apps/ptah-electron-e2e/CLAUDE.md`,
`.ptah/specs/TASK_2026_437_0778/test-report-b22.md` diff. No test/e2e/nx command was run (read-only
constraint); the codex report's own verification table is accepted as evidence, not re-verified.

## Summary

| Metric              | Value                                |
| -------------------- | ------------------------------------ |
| Overall score        | 6/10                                 |
| Assessment            | NEEDS_REVISION                       |
| Blocking issues       | 0                                     |
| Serious issues        | 1                                     |
| Moderate issues       | 2                                     |
| Failure modes found  | 3                                     |

The core, highest-risk piece of this batch — the settle-inclusive window and the three CodeRabbit
boundary fixes — is implemented correctly, and the boundary-exclusion design (drop entries with
`startTime < windowStartMs` entirely rather than clip them) turns out to be provably safe, not a
judgment call, because of JS's single-threaded execution model (detailed below). The gaps are in
flag isolation between the diagnostic and gating tests, one timer race that can misreport why a
run failed, and an incomplete documentation fix in Task 1.4.

## Five logic questions

### 1. How does this fail silently?

- `perf-page-capture.ts:498` (`const traceCapture = TRACE_ENABLED ? await startTraceCapture(page) : null;`
  in the gating "cold" test) lets `PTAH_PERF_TRACE=1` add CDP trace-collection overhead
  (10 kHz sampling, `Tracing.start`/`dataCollected` IPC) *inside* the budget-asserted window with
  no record of this in the written diagnostics JSON (`tile-open-longtask-budget.perf.spec.ts:605-632`
  never writes whether `TRACE_ENABLED` was set) and no console warning. A reader comparing three
  "cold" runs where one had `PTAH_PERF_TRACE=1` set would have no way to tell from the artifact
  that one run's numbers include trace overhead the others don't. This is not a success-looking
  failure (the assert would more likely FAIL, not pass, under the extra load — see Serious #1
  below), but it is a silent contamination of the measurement's comparability.
- `writeDiagnostics` (`tile-open-longtask-budget.perf.spec.ts:330-345`) and the `.cpuprofile` write
  (`:532-545`) both swallow write errors into a `console.warn` and continue — correct per AC12
  ("the guard logs and continues, it does not return a sentinel"), but worth naming: a CI run whose
  `PTAH_PERF_OUT_DIR` is unwritable produces a fully "green" (or correctly failing) test with zero
  diagnostics artifact and only a warning buried in the log.

### 2. What user action produces unexpected behaviour?

Running `PTAH_PERF_SPECS=1 PTAH_PERF_TRACE=1 npx playwright test tile-open-longtask-budget.perf.spec.ts`
without a `-g` filter runs all four discovered tests, including the gating "cold" test
(`:470-636`). That test does not restrict `TRACE_ENABLED` (unlike `RAF_ATTRIBUTION_ENABLED`, which
is hard-coded to `false` at `:522` inside the gating test regardless of the env var). The operator
gets a "cold" run whose `max`/`total` include CDP tracing overhead, mixed in with the actual AC-11
budget assertion (`:634-635`), with nothing in the CLAUDE.md ("Perf specs" section) or the console
output telling them the gating number is now unreliable. `implementation-plan.md:381-383`
("Quality requirements: ... the rAF wrapper and tracing are diagnostic-only") is explicit that
tracing should not run inside the gate; the code only enforces this for the rAF wrapper.

### 3. What input data produces a wrong answer?

A run where the app is slow enough that total elapsed time from the first click to "all markers
found" pushes past ~29–30 s (default `timeoutMs = 30_000`, `perf-page-capture.ts:196` and
`:321-324`) produces a misleading verdict, not a correct one — see Failure mode 1 below. The 30 s
absolute deadline is armed once at function entry and is never disarmed once the settle phase
legitimately begins; only `finish()`'s own guard (`:216-218`) decides which of the two independent
timers "wins."

### 4. What happens when a dependency fails?

`startTraceCapture` (`perf-page-capture.ts:130-153`) has no try/catch around
`page.context().newCDPSession(page)` or `session.send('Tracing.start', …)`; a CDP/Electron version
mismatch throws and fails the whole test, even though tracing is documented as diagnostic-only.
This is an acceptable "fail loud rather than silently degrade" choice for an opt-in diagnostic flag
and is not flagged as a defect, but it does mean a CDP tracing failure takes down the gating test
too if `PTAH_PERF_TRACE=1` was left on for the assert run (compounding the Serious #1 gap).

### 5. What is missing that the requirements never mentioned?

- No unit-level test coverage exists (or is required to exist, given `ptah-electron-e2e` has no
  jest `test` target — confirmed via `project.json`'s target list) for the new pure functions
  `bucketByTime`, `findRendererMainThread`, `summarizeTraceEvents` (`perf-diagnostics.ts:71-119`,
  `:146-197`). The module's own header comment (`:1-13`) says these are "safe to import from a
  Jest/Node context too if a future spec wants to unit-test the classification logic directly" —
  an invitation nobody acted on. Not a Batch 1 regression (the pre-existing `bucketByClick`/
  `summarizeCpuProfile` have the same gap), but worth naming since Batch 1 added three more
  untested pure functions to the pile.
- No documented interaction rule for combining `PTAH_PERF_TRACE`/`PTAH_PERF_PROFILE` with the
  actual gating run (see Serious #1).

## Failure modes

### 1. Marker-search timeout race with a legitimately-settling run

- Trigger: total wall time from `openTilesWithinPage`'s start to "all markers found" approaches the
  default 30 s `timeoutMs` (e.g. a slow CI host, or a future larger fixture), while the settle
  phase (1 s quiet, capped at 10 s — `perf-page-capture.ts:242`, `:258`) is still legitimately
  running.
- Symptom: `markerTimeoutId` (armed at `:321-324` for the whole 30 s from function entry, cleared
  only inside `finish()` at `:220`) can fire and call `finish(false, true, false)` **after** all
  markers were already found and the settle window had legitimately begun — even though
  `remaining.size === 0` at that point. `assertUsableMeasurement` (`tile-open-longtask-budget.perf.spec.ts:411-417`)
  then throws `"tiles did not all render their markers within the window (timedOut=true)"`, which
  is simply false: the tiles did render, and the run was failing for an unrelated reason (a slow
  settle, or a slow machine).
- Evidence: `perf-page-capture.ts:216-238` (`finish` sets `ok`/`timedOut`/`settled` from whichever
  caller wins the race), `:321-324` (30 s timer, never cancelled once markers are all found),
  `:240-259` (`resetQuietTimer`/`beginSettleWindow`, the settle machinery that races it).
- Current handling: whichever timer fires first inside `finish()`'s idempotent guard wins; no
  cross-cancellation between "all markers found" and the original marker-search deadline.
- Recommendation: clear `markerTimeoutId` as soon as `remaining.size` reaches 0 (inside
  `afterMarkerScan`, alongside the `beginSettleWindow()` call), so a slow *settle* phase after
  markers are found is reported through the correct `settled: false` / 10 s-cap path
  (`"measurement unusable: tiles did not settle within 10 s"`) instead of the marker-search path.
  This does not change pass/fail (both paths throw "unusable"), but it stops misreporting *why*.

### 2. `PTAH_PERF_TRACE` is not test-scoped like `PTAH_PERF_RAF_ATTRIBUTION`

- Trigger: `PTAH_PERF_SPECS=1 PTAH_PERF_TRACE=1`, no `-g` filter, so the gating "cold" test runs
  with tracing on.
- Symptom: the AC-11 budget assertion (`max <= 200`, `total <= 1500`,
  `tile-open-longtask-budget.perf.spec.ts:634-635`) is evaluated against a run that also carries
  CDP trace-collection overhead, contrary to `implementation-plan.md:381-383`'s explicit
  requirement that tracing be diagnostic-only. `RAF_ATTRIBUTION_ENABLED` gets exactly this
  protection (hard-coded `false` at `:522` for the gating test); `TRACE_ENABLED` does not.
- Evidence: `tile-open-longtask-budget.perf.spec.ts:498` (`TRACE_ENABLED ? startTraceCapture : null`
  inside the gating test) vs `:522` (`false` literal for `rafEnabled` in the same test).
- Current handling: none — the flag is honoured unconditionally in every test in the file.
- Recommendation: hard-code `traceCapture = null` in the gating test the same way `rafEnabled` is
  hard-coded to `false`, or explicitly document (CLAUDE.md + a console warning) that
  `PTAH_PERF_TRACE` is ignored there. M0's own run list (`batches.md` Task 2.1 item 2) implies the
  trace runs are meant for the *diagnostic* cold test (since it also needs the 500-event variant,
  which only the diagnostic test supports) — so the gating test accepting the flag serves no
  intended use case and is pure risk.

### 3. Task 1.4's superseding pointer is incomplete

- Trigger: a reader of `test-report-b22.md` after Batch 1 reaches the "Verification the fix works"
  or "Two things worth being precise about" sections rather than the "Attribution categories were
  re-split" bullet.
- Symptom: `test-report-b22.md:117-118` ("The remaining ... bucket (15.7%) is very likely mostly
  `@formkit/auto-animate`'s own cost") and `:141-142` ("autoAnimate reacting to a fast-growing DOM")
  both restate the same auto-animate-specific causal claim the FU-22d spike superseded, as fact,
  with no pointer — even though Task 1.4's own AC1 says: "Keep lines 101, 114-115, 139 unchanged
  unless they assert the same superseded claim as fact; if so add a one-line pointer to the same
  note." Only the bullet at `:99-108` (original line ~101-108) got the pointer
  (`:110-111`, "The later FU-22d attribution spike supersedes the auto-animate-specific
  interpretation").
- Evidence: `test-report-b22.md:110-111` (pointer added once) vs `:117-120` and `:136-145`
  (unpointed restatements of the same claim).
- Current handling: partial — the AC was applied to one of (at least) three qualifying passages.
- Recommendation: add the same one-line pointer at `:117-120` and near `:141-142`, or a single
  pointer at the top of the "Verification the fix works" section covering both, since both fall
  inside that section already flagged by the AC's own line numbers (114-115, 139).

## Blocking issues

None found.

## Serious issues

### `PTAH_PERF_TRACE` can contaminate the AC-11 gate

- File: `apps/ptah-electron-e2e/src/specs/chat/tile-open-longtask-budget.perf.spec.ts:498`
- Scenario: operator sets `PTAH_PERF_TRACE=1` alongside `PTAH_PERF_SPECS=1` without a test filter.
- Impact: the actual pass/fail budget assertion runs with added CDP tracing overhead inside the
  measured window, contrary to `implementation-plan.md`'s explicit "tracing are diagnostic-only"
  quality requirement, and the artifact carries no record that this happened. Direction of harm is
  most likely a false FAIL (extra CPU work inflates `max`/`total`), which is the safe direction for
  a budget gate, but it is still a real deviation from the plan's stated contract and is
  undetectable after the fact from the JSON.
- Fix: see Failure mode 2 above.

## Moderate and minor issues

- Moderate — marker-search 30 s timeout races the settle window and can misreport the failure
  reason; see Failure mode 1. `perf-page-capture.ts:216-238`, `:321-324`.
- Moderate — Task 1.4 AC1 partially applied; two of at least three qualifying passages in
  `test-report-b22.md` still assert the superseded auto-animate claim as fact with no pointer; see
  Failure mode 3. `test-report-b22.md:117-120`, `:141-142`.
- Minor — `PageContext`/`CDPSession` type aliases are independently redeclared in both
  `tile-open-longtask-budget.perf.spec.ts:34-36` and `perf-page-capture.ts:8-9`; harmless
  duplication, not worth a shared export given each is two lines, but flagged for style-reviewer
  awareness (may already be tracked there).
- Minor — three new pure functions in `perf-diagnostics.ts` (`bucketByTime`,
  `findRendererMainThread`, `summarizeTraceEvents`) have no unit test, matching a pre-existing gap
  in this module (`bucketByClick`, `summarizeCpuProfile` are likewise untested) rather than a new
  regression.

## Data flow

1. `installLongTaskObserver` (`perf-page-capture.ts:40-68`) — installs a `PerformanceObserver` with
   `buffered: true` before any click. OK: buffering is intentional; exclusion happens downstream.
2. `openTilesWithinPage` (`:192-346`) — records `windowStartMs` immediately before the first
   `btn.click()` (`:331-334`), clicks natively with timestamp-before-dispatch (CodeRabbit 3, fixed),
   scans for markers via a `MutationObserver` plus a redundant whole-body scan after each click's
   rAF yield. OK: entirely inside one `page.evaluate`, no Node↔renderer round trips, matching the
   documented no-Playwright-work invariant.
3. Marker hunt closes when `remaining.size === 0` → `beginSettleWindow()` (`:245-259`) re-scopes the
   observer to `[data-testid="canvas-tile"]` subtrees and arms a 1 s quiet timer plus a 10 s cap
   from that moment. OK, matches the settle-inclusive design; races against the un-disarmed 30 s
   marker timer (Failure mode 1 — gap, not a data-loss bug).
4. `finish()` (`:216-238`) resolves once, records `windowEndMs`, `wallMs`, `clickTimes`,
   `markerTimes`, DOM samples. OK — idempotent via the `finished` guard.
5. Spec reads `collectLongTasks` (post-close, observer now disconnected) and filters entries by
   `windowStartMs`/`windowEndMs` (`tile-open-longtask-budget.perf.spec.ts:356-368`). OK and
   provably lossless at both boundaries: because JS execution on a page is single-threaded and
   `windowStartMs`/`windowEndMs` are each read synchronously from *inside* the one long-running
   `page.evaluate` call, no `longtask` entry (which is only reported once fully complete) can have
   started before and still be "in flight" across either boundary — the exclusion-by-`startTime`
   approach is exactly equivalent to clipping here, not an approximation that can silently drop
   in-window cost. This resolves the review brief's specific concern about a task straddling the
   window start.
6. `summarizeMeasurement` buckets by click and by marker (`:369-391`), both written to diagnostics.
   OK.
7. `assertUsableMeasurement` (`:411-422`) gates on `ok`/`settled` before any further work. OK order
   of operations, but see Failure mode 1 for the message-accuracy gap upstream of this gate.
8. Scroll sanity (`checkTileScrollSanity`, `perf-page-capture.ts:355-391`) runs strictly after the
   window closed and long tasks were read. OK, matches "not a perf result" separation.
9. Optional diagnostics (`captureOptionalDiagnostics`, `:440-461`) — RAF hard-disabled in the
   gating test, trace not disabled (Serious #1).

## Requirements fulfilment

| Requirement                                                     | Status  | Gap                                                             |
| ----------------------------------------------------------------- | ------- | ---------------------------------------------------------------- |
| Split spec into fixture + capture support files, spec shorter    | COMPLETE | Spec is 855 lines (was 923); files created as specified.         |
| CodeRabbit 1: pre-window long tasks excluded, recorded             | COMPLETE | Provably correct given single-threaded JS (see Data flow §5).    |
| CodeRabbit 2: marker in the true final turn                        | COMPLETE | `turnSize`/`isFinalTurn` logic verified against the loop's own exit condition. |
| CodeRabbit 3: click timestamp before dispatch                      | COMPLETE | `perf-page-capture.ts:333-334`.                                  |
| Settle-inclusive window, 10 s cap → unusable                      | COMPLETE | Marker-search timer race is a reporting-accuracy gap, not a pass/fail correctness gap (Failure mode 1). |
| Per-tile buckets by click and by marker, both written             | COMPLETE | `bucketByClick`/`bucketByMarker` both logged and in every diagnostics JSON. |
| DOM node counts (replaying + settled)                              | COMPLETE | `perf-page-capture.ts:272-278`, `:236`.                          |
| `PTAH_PERF_RAF_ATTRIBUTION` diagnostic-only                        | COMPLETE | Hard-coded `false` in the gating test.                           |
| `PTAH_PERF_TRACE` diagnostic-only                                  | PARTIAL  | Not restricted in the gating test, contrary to the plan's quality requirement (Serious #1). |
| `PTAH_PERF_EVENTS` diagnostic-only, gating test always 2,000       | COMPLETE | `diagnosticEventCount()` only called from diagnostic tests; gating test hard-codes `TARGET_EVENTS_PER_SESSION`. |
| `PTAH_PERF_OUT_DIR`, remove `BACKUP_DIR`/stale doc path            | COMPLETE | Grep confirms no `BACKUP_DIR`/`ptah-437-backup` remains.         |
| Scroll sanity check on cold + warm-3-tile                          | COMPLETE | Also added (harmlessly) to the diagnostic-cold test.             |
| Budgets unchanged (200/1,500), skip w/o `PTAH_PERF_SPECS`          | COMPLETE | Verified in source and by the codex report's skip-proof output.  |
| `summarizeTraceEvents` + shared bucketing loop, no duplication     | COMPLETE | `bucketByTime` shared by both delegates.                         |
| CLAUDE.md documents new flags                                      | COMPLETE | Flags, settle window, and diagnostic-only scope documented (though the trace/gating interaction is not called out — same gap as Serious #1). |
| test-report-b22.md superseded-note (Task 1.4)                     | PARTIAL  | Applied once; two further qualifying passages left unpointed (Failure mode 3). |
| Audit TOTAL recorded                                                | UNVERIFIED | Report claims `TOTAL 303`; not independently re-run (read-only review). |

Implicit requirements not addressed: a documented interaction rule for combining diagnostic flags
with the gating test; unit coverage for the three new pure `perf-diagnostics.ts` functions.

## Edge cases

| Case                                                        | Handled | How                                                     | Concern                                                        |
| -------------------------------------------------------------- | ------- | --------------------------------------------------------- | ------------------------------------------------------------------ |
| Tile never settles (continuous mutation)                     | YES     | 10 s cap → `settled: false` → throws                     | None.                                                           |
| Marker never appears                                          | YES     | 30 s `timeoutMs` → `ok: false, timedOut: true` → throws   | Correct on its own, but can misfire post-settle (Failure mode 1). |
| Long task straddling window-start boundary                    | YES     | Excluded via `startTime < windowStartMs`                  | Provably correct given single-threaded JS (Data flow §5), not a race. |
| `PTAH_PERF_OUT_DIR` unwritable                                 | YES     | try/catch, `console.warn`, no sentinel substituted        | Diagnostics silently absent from CI logs beyond the warn line.  |
| `PTAH_PERF_TRACE` + gating test combined                       | NO      | Flag honoured unconditionally                             | Serious #1.                                                      |
| CDP session/tracing throws mid-capture                         | PARTIAL | Propagates uncaught, fails the whole test                 | Acceptable for an opt-in diagnostic, but compounds Serious #1.   |
| Warm tests: earlier warm-up tile still in `beginSettleWindow`'s scope | YES | Re-queried selector includes it; static, harmless extra observation target | None material.                                                  |

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Top risk: `PTAH_PERF_TRACE` can silently run inside the AC-11 gating test, contrary to the plan's
  own "diagnostic-only" requirement, with no artifact trail showing it happened.
- What a robust implementation would add: hard-disable tracing in the gating test the same way the
  rAF wrapper is disabled; disarm the 30 s marker-search timeout once all markers are found so a
  slow settle reports through the correct (already-implemented) "did not settle" path; finish the
  Task 1.4 superseding-note pointer at the two remaining passages that restate the auto-animate
  claim as fact.
