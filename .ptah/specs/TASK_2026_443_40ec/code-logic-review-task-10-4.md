# Code Logic Review — TASK_2026_443_40ec, Task 10.4 (delete batch 200 → 100)

Score: 9/10 — APPROVED

Scope reviewed (uncommitted diff, `git diff`, read-only): `memory-retention-config.ts`,
`memory-curator/CLAUDE.md`, `memory-retention.integration.spec.ts`. No file outside
these three changed (`git diff --stat` confirms; the untracked `task-10-4-report.md`
is the prescribed report). Evidence read: `test-report.md` M4 (lines 279-317),
`batches.md` Task 10.3 result / Task 10.4 (lines 1611-1700), `task-10-4-report.md`.

## Findings

1. **Minor — the measurement covers the cap-eviction path only; the constant also
   governs age-delete.**
   - File: `libs/backend/memory-curator/src/lib/retention/memory-retention-config.ts:58-63`
   - The comment's evidence comes from the M4 cap-eviction sweep
     (`test-report.md:287-302`), while M3 (age delete) passed at 200
     (`test-report.md:355-356`) and was not re-measured at 100. The plan's fixed rule
     (`batches.md:1640-1643`) prescribes ONE number for both paths when either fails,
     so this is within spec, and smaller batches are strictly cheaper per call. The
     comment correctly scopes itself to "cap-eviction sweep". No change requested.

2. **Minor — the "133-1730 ms" range merges two attempts of different provenance.**
   - File: `libs/backend/memory-curator/src/lib/retention/memory-retention-config.ts:60`
   - 133 ms is the sweep's own 200-row; 1730 ms is an earlier exploratory outlier
     (`test-report.md:292-294`). The test report's own table row presents the range the
     same way, so the comment does not overstate its source. No change requested.

No blocking, serious or moderate findings.

## Confirmation against the review checklist

1. **Constant and neighbours.** `RETENTION_MEMORY_DELETE_BATCH_SIZE` is 200 → 100
   (`memory-retention-config.ts:63`); the diff hunk touches nothing else. Verified in
   the file: `RETENTION_MAX_ROWS_PER_RUN` 50_000 (:55), `RETENTION_MAX_MEMORY_ROWS_PER_RUN`
   25_000 (:57), `RETENTION_CAP_EVICTION_GRACE_MS` 7 days (:65), `RETENTION_MAX_RUN_MS`
   60_000 (:67), `RETENTION_SLOW_CALL_MS` 120 (:69), `RETENTION_MIN_BATCH_SIZE` 50 (:71),
   and every clamp range (:37-43) are untouched.
2. **Doc comment accuracy.** "200 reached max 133-1730 ms on a 1.18 GB file; 100 passed
   the 120 ms bound" matches `test-report.md:287-302` (200 FAIL on max; 100 max 116 ms,
   p95 58 ms) and the 1.18 GB snapshot figure (`test-report.md:80`). 100 passed both
   bounds, so naming the 120 ms bound is accurate, not overstated.
3. **The sweep supports 100.** 200 FAIL (max 133-1730 ms, p95 83-90 ms) and 100 PASS
   (max 116 ms ≤ 120, p95 58 ms ≤ 100) at `test-report.md:287-302`. The fixed rule asks
   for the largest of {200, 100, 50} that passes; 200 failed, 100 passed, so 100 is the
   answer without testing 50 (the report itself states this, `test-report.md:309-311`).
4. **The 6 spec lines.** All six are in the mid-delete-failure test
   (`memory-retention.integration.spec.ts:679-695`). The test seeds 250 archival rows
   (:671-677) and injects a throw on the SECOND `DELETE FROM memories` call (:664).
   With batch 200 the first batch commits 200 rows, leaving 50; with batch 100 the
   first batch commits 100, leaving 150. The three counts (memories, chunks,
   `memoriesDeleted` on retry) move 50 → 150 = 250 − batchSize, arithmetically forced.
   No assertion was weakened: `toBe` stays `toBe` (exact counts), the 250-row seed, the
   injection point and `fail = false` retry are unchanged. `expect(` count is 159 at
   HEAD and 159 in the worktree. The retry now deletes 150 rows across two batches
   instead of 50 in one, so the case exercises more, not less. The team-leader's empty
   grep was correct — no spec names the constant; the dependency is implicit, which is
   exactly what these six lines are.
5. **No behaviour change.** The diff touches a literal and its comment; no statement,
   predicate or transaction shape changed. The hosts read the limits object by
   spreading `MEMORY_RETENTION_LIMITS` with only `bootDeferralMs` overridden
   (`thoth-runtime/src/lib/start-thoth-cron.spec.ts:862`,
   `cli-engine/src/lib/bootstrap/thoth-runtime.spec.ts:537`), so they inherit 100 with
   no code change; no hardcoded 200 exists in either host.
6. **CLAUDE.md consistency.** "delete batches initially capped at 100"
   (`memory-curator/CLAUDE.md:80`) matches the constant. The halving floor stays 50,
   so a slow batch still halves (100 → 50 in one step; `retention-run-budget.ts:115-118`
   handles any `current > minBatchSize`).
7. **Side effects of the smaller batch.** Worst case rises from 125 to 250 batches per
   25,000-row run — each batch is one transaction plus a `setImmediate` yield and a
   governor wait that already counted against the same 60 s budget. No spec depends on
   the old batch count: the constant grep over `libs/**/*.spec.ts` is empty; the other
   lifecycle specs pass their own explicit `deleteBatchSize: 200` fixtures
   (`memory-lifecycle.service.spec.ts:130`, `retention-run-budget.spec.ts:41`),
   independent of the production default; the backlog test seeds 30 rows and the
   budget test uses `maxMemoryRowsPerRun: 25`, both orthogonal to delete batch size.
   The acceptance grep `batch.*200|200.*batch` over non-spec `memory-curator` source
   returns no stale claim.

## Five logic questions (short form, for a one-constant change)

1. **Silent failure:** none introduced. The one place a failure could hide is doc
   drift between the comment and the measurement — verified against `test-report.md`.
2. **Unexpected user action:** worst case is a user with a large archival backlog
   seeing more yields per run; the run stays inside the same 60 s budget and the
   backlog continuation path is unchanged.
3. **Wrong answer from input data:** not applicable — the constant is not derived
   from input.
4. **Dependency failure:** the adaptive halving path still works with an initial
   size of 100 (one halving step reaches the 50 floor).
5. **Missing from requirements:** finding 1 — the M3 path was not re-measured at 100;
   within the plan's single-number rule and conservative in direction.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: none material; the only residual is that the age-delete path inherits a
  size justified by the cap-eviction sweep alone.
- A robust implementation would add nothing here; re-measuring M3 at 100 would close
  finding 1 but is not required by the plan's rule.