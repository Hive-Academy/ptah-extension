# Code Logic Review (Delta) — `TASK_2026_453_1eb4` Batch 1, revise round 1

Reviewed as an independent lane, read-only (no e2e/perf/jest/nx runs, no git writes). Read in
full: `b1-code-logic-review.md` (base review), the "## Revise round 1" section of
`b1-codex-report.md`, `git status --short`, `git diff --stat`, the full current
`tile-open-longtask-budget.perf.spec.ts` (602 lines), the full current `perf-page-capture.ts`
(385 lines), the new `perf-measurement-report.ts` (186 lines), the full current
`perf-session-fixture.ts` (259 lines), the `perf-diagnostics.ts` diff, and the
`test-report-b22.md` diff.

## Summary

| Metric              | Value                                |
| -------------------- | ------------------------------------ |
| Overall score        | 8/10                                 |
| Assessment            | APPROVED                             |
| Blocking issues       | 0                                     |
| Serious issues        | 0                                     |
| Moderate issues       | 1                                     |
| Failure modes found  | 1 (residual, non-blocking)            |

All three base-review findings are closed with file:line evidence (below). The refactor that
split the spec below 700 lines did not change any measured behaviour I could find. One
process-evidence gap remains: the revise-round skip proof produced no Playwright rows before
exiting 0, which is weaker evidence than the base review's original skip proof, and the
team-leader should decide whether to require a clean re-run before merge (see Verdict).

## Five logic questions

### 1. How does this fail silently?

Same residual as the base review, not reopened by this round: `writeDiagnostics`
(`perf-measurement-report.ts:43-61`) and `writeCpuProfile` (`:64-81`) still swallow write errors
into `console.warn` and continue — correct per AC-12, but a CI run with an unwritable
`PTAH_PERF_OUT_DIR` still produces a "green" (or correctly-failing) test with no diagnostics
artifact and only a buried warning. Not a new defect from this round.

### 2. What user action produces unexpected behaviour?

The base review's Failure mode 2 (`PTAH_PERF_TRACE=1` contaminating the gate) is closed: the
gating test now hard-codes `const traceCapture = null;`
(`tile-open-longtask-budget.perf.spec.ts:231`) exactly as the rAF wrapper is hard-disabled via the
literal `false` passed to `captureOptionalDiagnostics(page, traceCapture, false)` at line 255. No
env var can turn tracing on inside the asserting test any more — `TRACE_ENABLED` is read only in
the three diagnostic tests (`:376`, `:451`, `:530`). I did not find a remaining path to the
gate for either flag.

### 3. What input data produces a wrong answer?

The base review's Failure mode 1 (30 s marker-search timer racing the settle window) is closed:
`afterMarkerScan` now clears `markerTimeoutId` and enters the settle window in the same tick
that `remaining.size` reaches 0 —
`perf-page-capture.ts:271-274`:
```
if (remaining.size === 0 && settleCapId === undefined) {
  clearTimeout(markerTimeoutId);
  beginSettleWindow();
}
```
This runs before the 30 s deadline (`perf-page-capture.ts:314-317`) can fire once markers are
found, so a slow *settle* phase now can only resolve through `beginSettleWindow`'s own 10 s cap
(`perf-page-capture.ts:250`, `finish(true, false, false)`), which still reports `settled: false`
and still throws `"measurement unusable: tiles did not settle within 10 s"`
(`perf-measurement-report.ts:146-150`). `finish()`'s own `clearTimeout(markerTimeoutId)` at
`perf-page-capture.ts:212` is now redundant on this path (harmless — `clearTimeout` on an
already-cleared handle is a no-op) rather than the sole guard. I checked for a
re-introduced race (e.g., `afterMarkerScan` firing on a mutation record processed after
`finish()` already ran) and found none: `scanMutations` returns via `resetQuietTimer()` once
`remaining.size === 0` (`perf-page-capture.ts:278-281`) and never re-enters `afterMarkerScan` after
that point, and `finish()`'s `finished` guard makes any residual call a no-op.

### 4. What happens when a dependency fails?

Unchanged from the base review: `startTraceCapture` still has no try/catch around the CDP calls
(`perf-page-capture.ts:130-153`), but it is no longer reachable from the gating test at all
(see Q2), so a CDP/Electron mismatch during tracing can now only fail a diagnostic test, not the
budget gate. This narrows, rather than reopens, the base review's Q4 finding.

### 5. What is missing that the requirements never mentioned?

The base review's two "implicit requirements" (a documented interaction rule for combining
diagnostic flags with the gating test, and unit coverage for the three new pure
`perf-diagnostics.ts` functions) are addressed for the first (CLAUDE.md now states the gating test
ignores trace/rAF unconditionally) but not the second — still no Jest target on
`ptah-electron-e2e` and still no test file for `bucketByTime`/`findRendererMainThread`/
`summarizeTraceEvents`. Not a regression; still a residual gap.

## Failure modes

### 1. Revise-round skip proof is weaker evidence than the original

- Trigger: the team-leader (or a future reader) treats the revise-round's own skip-proof run as
  sufficient standalone evidence that `PTAH_PERF_SPECS` unset still skips all four tests.
- Symptom: `b1-codex-report.md`'s "Revise-round verification" table and its "Deviations" note
  both record that `npx nx run ptah-electron-e2e:e2e -- ... --reporter=list` with the flag
  unset exited 0 after 127.6 s but printed **no Playwright list rows** — only Node
  listener/color warnings. Exit 0 with no rows is consistent with "all four skipped" but is also
  consistent with the runner never reaching Playwright's reporter output (e.g., a config/build
  step swallowing an error before test collection, though nothing in the deviations note suggests
  that occurred).
- Evidence: `b1-codex-report.md:107` (revise-round table row), `:114` (deviations bullet).
- Current handling: the codex report leans on the *original* Batch 1 skip-proof run (same command,
  same flag state, which did print `Running 4 tests using 1 worker` / `4 skipped`) as the
  corroborating evidence, and states the spec's file-level `test.skip(!PERF_ENABLED, ...)` line is
  unchanged by this round — true, `tile-open-longtask-budget.perf.spec.ts:195-199` is byte-identical
  in shape to what the base review read at its old line numbers.
- Recommendation: this is enough to *not* block on its own, since the skip predicate itself did not
  change and the original run already demonstrated the skip path with visible rows. But because the
  600-line refactor moved substantial code between files (including the `test.describe`/`test.skip`
  wiring's neighbors), a team-leader that wants first-party (not read-only-review) confidence should
  ask for one clean re-run of the skip proof that actually prints the `4 skipped` line before
  merging, since this review cannot run it either (read-only constraint).

## Blocking issues

None found.

## Serious issues

None found. The one Serious issue from the base review (`PTAH_PERF_TRACE` contaminating AC-11) is
closed — see Q2.

## Moderate and minor issues

- Moderate — revise-round skip proof produced no visible Playwright rows (exit 0 after 127.6 s);
  see Failure mode 1. Not a defect in the reviewed code, but a gap in the evidence trail for this
  specific verification run. `b1-codex-report.md:107,114`.
- Minor (residual, not new) — no unit coverage for the three pure `perf-diagnostics.ts` functions;
  same gap the base review named. `perf-diagnostics.ts:71-118, 146-197` (post-refactor line
  numbers within the unchanged module).
- Minor (residual, not new) — diagnostics/`.cpuprofile` write failures still swallowed to
  `console.warn`; correct per AC-12, same as base review. `perf-measurement-report.ts:43-61,
  64-81`.

## Data flow

1. `installLongTaskObserver` → unchanged, now in `perf-page-capture.ts:40-68`. OK.
2. `openTilesWithinPage` (`perf-page-capture.ts:184-339`) — window start/end capture, click
   timestamp-before-dispatch, and marker scan are unchanged from the base review's read. OK.
3. Marker hunt closes when `remaining.size === 0` → `afterMarkerScan` now clears the 30 s marker
   timeout **and then** calls `beginSettleWindow()` (`:264-275`), closing base Failure mode 1. OK
   — this is the one behavioural change in the capture module, and it is the fix the base review
   asked for, applied at the recommended location.
4. `beginSettleWindow` re-scopes the observer to canvas-tile subtrees, arms the 1 s quiet timer and
   the 10 s cap (`:237-251`). Unchanged. OK.
5. `finish()` resolves once via the `finished` guard, still idempotent, still clears both settle
   timers plus the (now often already-cleared) marker timeout (`:208-230`). OK.
6. Spec/`perf-measurement-report.ts`: `summarizeMeasurement` (moved out of the spec, logic
   byte-equivalent to what the base review read: same `startTime < windowStartMs` pre-window
   exclusion, same click/marker bucketing calls) — `perf-measurement-report.ts:84-119`. OK.
7. `assertUsableMeasurement` (`perf-measurement-report.ts:139-151`) — same two-stage
   `!ok` / `!settled` gate order the base review verified, just relocated. OK.
8. Gating test (`tile-open-longtask-budget.perf.spec.ts:201-362`): trace hard-disabled at `:231`,
   rAF hard-disabled via the literal `false` at `:255`, both effective values recorded in the
   written diagnostics JSON at `:328-333` (`trace: false, rafAttribution: false`). OK — closes base
   Serious #1.
9. Diagnostic tests (`:364-428`, `:430-510`, `:512-601`) each record all four effective flag values
   (`trace`, `rafAttribution`, `profile`, `eventCountOverride`) in their own diagnostics JSON at
   `:400-406`, `:482-488`, `:573-579`. OK.
10. `test-report-b22.md`: the two previously-unpointed passages (`15.7%` bucket claim, `fast-growing
    DOM` claim) now each carry the one-line FU-22d pointer immediately after them, at lines 122 and
    150 respectively, matching the original pointer's wording pattern already at line 110. OK —
    closes base Failure mode 3.

## Requirements fulfilment

| Requirement                                                              | Status   | Gap                                                                 |
| -------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------- |
| `PTAH_PERF_TRACE` diagnostic-only, cannot reach the AC-11 gate            | COMPLETE | Hard-disabled at spec `:231`; effective value recorded in JSON.     |
| Marker-search timeout does not race a legitimate settle phase             | COMPLETE | `afterMarkerScan` clears it before entering settle (`:271-274`).    |
| Task 1.4 superseded-claim pointer applied to every qualifying passage     | COMPLETE | Two remaining passages now pointed at lines 122, 150.               |
| Spec below the 700-line soft ceiling via facade-consistent extraction     | COMPLETE | Spec now 602 lines; `perf-measurement-report.ts` (186) is nameable, not a `helpers`/`utils` dump. |
| Refactor did not change window/budget/gating behaviour                    | COMPLETE | Traced end to end above; no behavioural delta found beyond the deliberate marker-timeout fix. |
| Clean, reproducible skip-proof evidence for this round                    | PARTIAL  | Revise-round run exited 0 but printed no rows; original run's rows are the actual evidence (Failure mode 1). |

Implicit requirements not addressed: unit coverage for the three pure `perf-diagnostics.ts`
functions (residual, pre-existing gap, not introduced by this batch).

## Edge cases

| Case                                                             | Handled | How                                                              | Concern                                             |
| -------------------------------------------------------------------- | ------- | -------------------------------------------------------------------- | ---------------------------------------------------- |
| Marker found right as the 30 s deadline would fire                  | YES     | Timeout cleared synchronously in `afterMarkerScan`, same tick as settle begins | None — race eliminated, not narrowed.               |
| `PTAH_PERF_TRACE=1` set with no `-g` filter on the gating test       | YES     | `traceCapture` hard-coded `null`, flag ignored                       | None.                                                |
| Reader of `test-report-b22.md` lands on any of the three passages    | YES     | All three now carry the pointer                                     | None.                                                |
| Skip proof re-run after the 600-line refactor                        | PARTIAL | Ran, exited 0, but no visible rows this round                       | Team-leader should get one clean re-run before merge (Failure mode 1). |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: none in the reviewed logic; the only open item is process evidence, not code —
  the revise-round skip-proof invocation did not print Playwright rows, so the "still skips
  cleanly after the refactor" claim currently rests on the original Batch 1 run rather than a
  rerun against the final 602-line file. This is a judgment call for the team-leader on whether
  to require one more skip-proof run before commit; it does not indicate a defect in the code.
- What a robust implementation would add: nothing further for correctness. For process rigor, a
  clean re-run of `PTAH_PERF_SPECS` unset against the final file tree, showing `4 skipped` in the
  output, before this batch is treated as fully verified.
