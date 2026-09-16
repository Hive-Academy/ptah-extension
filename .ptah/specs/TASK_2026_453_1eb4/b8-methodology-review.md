# Batch 8 Methodology Review — `TASK_2026_453_1eb4`

Scope: `test-report.md` "Batch 8 — scroll re-check (post Batch 7)" (lines 883-1121) and the
`TILE_1`/`TILE_2` correction inserted into the M1 section (lines 505-517). Independent check
against raw evidence in `D:\projects\ptah-453-perf\b8\*.json` and
`D:\projects\ptah-453-perf\b8-*.log`, `batches.md` Task 8.1 (lines 1084-1118), and
`handoff.md` §6 (lines 110-127). No runs, no tests, no edits were made; this document is the
only artifact produced.

## Verdict

**APPROVED.**

The 23 counted attempts are real, match the raw JSON/log evidence line for line, the arithmetic
in every comparison table recomputes exactly, and the `TILE_1`/`TILE_2` correction is verified
against the spec source and the M1-era logs, not just asserted. One point needs a sharper
statement than the report gives it (the discarded attempt's status under the letter of the
Task 8.1 protocol), covered below as a moderate finding — it does not change the PASS verdict,
but the report should have flagged it to the orchestrator as a live decision, not folded it into
the same paragraph as the result.

## 1. The discarded attempt: legitimate exclusion or must it count?

**Finding: legitimate exclusion, but it is outside the protocol's named categories, and the
report should have surfaced that as an open question rather than resolving it unilaterally.**

- Task 8.1 AC 2 defines exactly one discard-and-repeat reason: environment contamination
  (non-zero `jest-worker`/`run-executor` idle check). AC 5 reinforces it: "No retry substitutes
  for a failed attempt in the 23 count," where "failed attempt" in context means a scroll-sanity
  failure.
- The discarded attempt (`b8-cold4.log:205`, verified directly: `Error: worker process exited
unexpectedly (code=3221226505, signal=null)`) is neither. It is a Playwright worker crash at
  0 ms, before Electron launched, with idle `0/0` on both sides (test-report.md:923-925, not
  independently verifiable from the log itself — see Finding 2 below on idle evidence). It
  produced no scroll check, so it is not a scroll-sanity failure by the batch's own definition
  (`checkTileScrollSanity`, `perf-page-capture.ts:349-384`, only runs after the tiles open).
- Because it fits neither named category, treating it as "discard and repeat, retry counts as
  attempt 4" is a judgment call the tester made without protocol cover, and the report says so
  itself (test-report.md:956-961: "not the contaminated → discard → repeat case the protocol
  names ... flagged explicitly for the orchestrator"). That self-flagging is the right instinct,
  but it appears only after the substitution was already made and counted — the report should
  have paused and asked before spending the retry as attempt 4, not disclosed the ambiguity
  after presenting the count as settled.
- On the substance: counting this as a "failure" would be wrong (a crash before any assertion
  ran is not evidence of a scroll defect; it would inflate the failure count with an unrelated
  infrastructure fault). Counting it as one of the 23 "inconclusive" would deflate the sample to
  22 genuine scroll checks, which the report does not do. Excluding it and re-running is the
  substantively correct outcome — the alternative (stopping the whole batch to escalate a
  Playwright-launcher crash) would have been disproportionate — but it is a deviation from
  Task 8.1's literal text, not an application of it.
- **PASS verdict stands.** All 23 counted attempts ran the actual test to completion (confirmed
  below), and 0 of them failed scroll sanity. The crash carries no scroll evidence either way, so
  its exclusion cannot be read as suppressing a failure.

## 2. Idle counts before/after each run

**Finding: not independently verifiable from the retained artifacts (moderate gap, consistent
with M0/M1 practice, not unique to this report).**

The report claims "every check returned `0`, with no exceptions (24 checks before + 24 checks
after)" (test-report.md:924-925). The `b8-*.log` files are Nx/Playwright run transcripts — they
begin with the Nx dependency graph and the `nx run ptah-electron-e2e:e2e` output; none of the 23
counted logs, nor `b8-cold4.log`, contains the idle-check PowerShell invocation or its output.
The idle check is run as a separate shell command outside the `nx run` invocation that produces
these logs, so its result is not captured in any artifact this review can read. This means the
idle claim is asserted by the tester, not evidenced by a retained transcript — the same
limitation applies to M0 and M1's idle claims elsewhere in test-report.md, so this is a
pre-existing convention gap, not something Batch 8 introduced. It does not by itself undermine
the PASS verdict (the JSON evidence for wall-clock/DOM numbers is independently verifiable and
matches exactly — see Finding 3), but a stricter methodology would save the idle-check stdout
per attempt the way the diagnostics JSON is saved per attempt.

## 3. Raw JSON/log cross-check

All 23 rows in the "23-attempt scroll-sanity result" table (test-report.md:970-994) were
recomputed directly from the JSON files in `D:\projects\ptah-453-perf\b8\` (`maxDurationMs`,
`totalDurationMs`, `wallMs`, `settled`, `longTaskCount`, `preWindowExcluded`, `domNodes`) sorted
by embedded timestamp. Every field in every row matches the report exactly, with no
transcription errors found.

For the 7 cold-asserting runs whose overall Playwright test failed on budget (runs 2, 3, 4, 5, 7,
8, 10), the report's claim that the `wall=` console line only prints after `assertScrollSanity`
already passed (test-report.md:996-999, citing spec `:281-289`) was checked against the logs
directly: each of `b8-cold2.log`, `b8-cold3.log`, `b8-cold5.log`, `b8-cold7.log`, `b8-cold8.log`,
`b8-cold10.log`, `b8-cold4-retry.log` prints its `[AC-11 perf] wall=...` line and then fails with
`1 failed` (the Playwright `expect(maxDuration)`/`expect(totalDuration)` budget assertion, not a
scroll-sanity assertion) — confirming the report's inference that these are genuine scroll
PASSes wrapped in a budget FAIL, not scroll failures hidden by a swallowed error.

The 23 JSON files plus 1 crashed log account for all 24 attempts claimed; file count, timestamp
monotonicity, and log/JSON naming are all consistent with the "Diagnostics JSON paths read"
list (test-report.md:1080-1097).

## 4. Arithmetic recompute — asserting-run max/total table and means/ranges

Recomputed independently in Node from the raw values, not from the report's own arithmetic-check
paragraph:

| Metric                | Report      | Recomputed  |
| --------------------- | ----------- | ----------- |
| Cold max mean         | 225.5       | 225.5       |
| Cold max min/max      | 143 / 399   | 143 / 399   |
| Cold total mean       | 1,621.8     | 1,621.8     |
| Cold total min/max    | 435 / 3,825 | 435 / 3,825 |
| Diagnostic max mean   | 283.4       | 283.4       |
| Diagnostic total mean | 1,804.8     | 1,804.8     |
| Warm max mean         | 175.0       | 175.0       |
| Warm total mean       | 850.0       | 850.0       |

All four means and both min/max ranges recompute exactly. No error found.

## 5. "3 of 10 asserting runs met AC-11" claim

Recomputed against the AC-11 budget (max <= 200 ms AND total <= 1,500 ms) using the report's own
per-run figures:

- Run 1: 143/435 — MET.
- Run 6: 184/1,075 — MET.
- Run 9: 177/1,409 — MET.
- Run 10: 175/1,524 — max meets, total (1,524 > 1,500) fails — NOT met. Matches the report's own
  budget-outcome table (test-report.md:1008-1019), including the note that run 10 is the only run
  whose max passes and total alone fails.
- All other runs (2, 3, 4, 5, 7, 8) fail on max already.

Count is exactly 3 (runs 1, 6, 9). The claim is correct.

## 6. M1 `TILE_1`/`TILE_2` correction

**Finding: accurate, and independently verifiable against both the spec source and the
still-present M1-era logs — not just an assertion.**

- Original text-report.md:501 said both scroll failures were "on the last-clicked/still-replaying
  tile." The correction (test-report.md:505-509) states `TILE_1` (the 132 px failure) is the
  **middle** tile, not the last-clicked one, and `TILE_2` is the actual last-clicked tile.
- Verified against the spec source: `tile-open-longtask-budget.perf.spec.ts:196-198` builds
  `sessions` as `['0','1','2'].map(label => makeSessionFixture('TILE_${label}', ...))`, and
  `buttonHandles`/`openTilesWithinPage` click them in that same array order (`for (const btn of
buttons)`, `perf-page-capture.ts:326-333`). `TILE_0` is clicked first, `TILE_1` second (the
  middle click), `TILE_2` third and last. This makes `TILE_1` unambiguously the middle-clicked
  tile and `TILE_2` the last-clicked one — exactly the correction's claim.
- Verified against the surviving M1-era logs: `m1-run3.log:282` reads `Error: [AC-11 functional]
scroll sanity failed: [{"marker":"PTAH_E2E_AC11_TILE_1_MARKER", ...,
"distanceFromBottom":132}]`, and `m1-trace-2000.log:279` reads `... "marker":
"PTAH_E2E_AC11_DIAG_COLD_TILE_2_MARKER", ..., "distanceFromBottom":31155`. Both match the
  original numbers (132 px, 31,155 px) exactly, and the marker names confirm which tile failed in
  each case. `scroll-regression-analysis.md:14` (finding F5) cites the same two log lines and
  states the same correction; the test-report.md correction is consistent with it.
- The correction changes only the tile-role attribution, not the numbers, the pass/fail history,
  or any verdict — consistent with what it claims to do.

## Evidence read

- `test-report.md` full "Batch 8" section (883-1121) and M1 scroll-sanity section (477-531).
- `batches.md` Batch 8 / Task 8.1 (1071-1126), Batch 8-dependency notes (1131-1133).
- `handoff.md` §6 operating rules (110-127), §7 next steps (154-159).
- `scroll-regression-analysis.md` F5 finding (line 14) and its magnitude-check paragraph (line 32).
- All 23 JSON files in `D:\projects\ptah-453-perf\b8\` (fields diffed against the report table).
- `b8-cold4.log` (crash), `b8-cold2/3/5/7/8/10.log`, `b8-cold4-retry.log` (wall-line-then-fail
  pattern), `b8-cold1.log`, `b8-diag5.log`, `b8-warm3.log` (spot checks for per-tile marker
  buckets and console shape).
- `m1-run3.log:282`, `m1-trace-2000.log:279` (M1-era scroll-failure evidence for the correction).
- `apps/ptah-electron-e2e/src/support/perf-page-capture.ts:300-384` (`checkTileScrollSanity`,
  click-order construction).
- `apps/ptah-electron-e2e/src/specs/chat/tile-open-longtask-budget.perf.spec.ts:191-239`
  (session/tile ordering, marker assignment).
- `git log --oneline -1` and `git status --short` in the worktree, cross-checked against the
  report's environment claims (test-report.md:906-915) — matches: HEAD `906c30440`, working tree
  shows only `batches.md` (concurrent, pre-existing) and `leftovers-inventory.md` (untracked,
  pre-existing) plus `test-report.md` itself as the report's own edit.

## Residual uncertainty

- Idle-check evidence (Finding 2) cannot be verified from any retained artifact; it rests on the
  tester's assertion alone. This is a standing gap in the perf-measurement convention, not
  specific to Batch 8.
- The peer-hold protocol (handoff.md §6 rule 4) — whether the orchestrator actually requested and
  released a hold with the `continue-task` session — is explicitly disclosed by the report itself
  as unconfirmed from inside this task (test-report.md:931-935). This review has no way to check
  it either; it is out of scope for a task-folder-only methodology check.
- This review does not re-verify AC-11's product-code perf verdict (M0/M1's own conclusions) —
  only the Batch 8 methodology and the M1 correction were in scope, per Task 8.1 AC 4's own
  statement that Batch 8 is "not a new AC-11 verdict unless the orchestrator asks."
