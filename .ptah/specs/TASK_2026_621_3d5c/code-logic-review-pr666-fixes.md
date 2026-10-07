# Code Logic Review - PR #666 fixes (commit 9724c2525), TASK_2026_621

Scope: all production diffs and specs in the commit, plus whole-file reads of boot-scan-runner.ts (run + retryFailures), boot-scan-failure-ledger.ts, memory-trigger.service.ts (rekeySession, flushSessionEnd, invokeCurate), memory-retention.service.ts (run).

Test evidence:
- `npx nx run degradation-audit:lint` -> "Successfully ran target lint for project degradation-audit" (passes).
- `npx nx test memory-curator --testPathPatterns="boot-scan|memory-trigger|memory-retention"` -> "Successfully ran target test for project @ptah-extension/memory-curator" (exit success; the tail did not include the Jest totals line).

## Per-item status

### 1. degradation-audit markers - CLOSED
- All five ledger catches (boot-scan-failure-ledger.ts:129 record, :153 list, :179 list-given-up, :195 give-up, :210 remove) call `this.warn(...)` (line 216-222), which logs via `logger.warn`, so "reported" is accurate. The audit lint now passes.
- Fail-soft is correct: record() returns null, so the runner stops below the session and the watermark does not pass it (runner :302-312). list() returns [] (no retries this boot, rows kept). give-up and remove return false and leave the row for a later boot. A ledger failure never throws into the scan, and no session is silently dropped.
- The new `listGivenUp` catch returns [], which defers changed-generation recovery to the next boot. That is acceptable.

### 2. Stuck-row count on row-budget - CLOSED
- memory-retention.service.ts:401 now reads `stop === null || stop === 'row-budget'`. `stop` is only set to 'row-budget' at :369, and hard stops come from `budget.hardStop()` (:365) or `waitForGovernor` (:372), so those still skip the count.
- The lifecycle step already used the same predicate (:411), so the two are now consistent.
- Both retention specs were updated to expect the count (50 and 200). They failed before the fix, which returned null on row-budget.

### 3. Re-admit changed given_up generation - CLOSED, with one gap (finding 1)
- Admission is at boot-scan-runner.ts:210-227. Query: ledger.listGivenUp (ledger :66-70, :160-183). A row is admitted when the file's current mtime is a number, differs from the stored `session_mtime_ms`, and the id is not already eligible (dedupe by `knownEligible`).
- A deleted file makes `sessionMtime` return 'missing', and a stat error returns null. Neither is a number, so the session is skipped with no run, no throw, and the row stays terminal.
- No infinite loop. If the admitted run fails, `recordFailure` (ledger :44-55) takes the given_up + different-mtime branch and reopens the row as pending with attempt_count 1 and the new mtime. It then gets at most BOOT_SCAN_MAX_ATTEMPTS and returns to given_up with the new mtime, so it is not re-admitted again. A success calls `remove` (runner :328). Stalled and break paths do not move the watermark. Items at or below the watermark cannot raise `maxMtime`, which is guarded at :351.
- Bound: at most 20 rows per boot (BOOT_SCAN_RETRIES_PER_BOOT). Because `eligible` is sorted ascending, these items run first. `retryAllowed` now sees `eligible.length > 0`, so pending retries still yield the last curate slot to the scan, and the given_up items count as scan work. The scan is not starved, but readmitted items consume curate budget ahead of newer sessions (finding 4).
- Spec "admits a changed given_up generation..." fails without the fix. The file mtime is `now-5000` against watermark `now`, so before the fix it was never eligible and `run` was never called.

### 4. failedPasses cleared after session-end settles - CLOSED, with gaps (findings 2, 3, 5)
- Race with rekey: `endingSessions` holds a mutable `{sessionId}` token. `rekeySession` re-points it (memory-trigger.service.ts:373-378), and the settle callback deletes both the original id and `ending.sessionId` (:502-503). It removes the map entry only if it still holds the same token (:504). This handles rekey before settle, and rekey after settle is a no-op. The new spec covers this. Without the fix `invokeCurate` writes `failedPasses['s1']` after the rekey, and nothing clears it, so the spec fails.
- Curate rejection: `invokeCurate` catches everything inside its own try and `finally`, so `.finally` always runs. See finding 5 for the one path that can still reject.
- The `endingSessions` entry is removed on settle. No leak on the normal paths.

## New findings

1. SERIOUS (starvation of the recovery path) - boot-scan-runner.ts:213-227 with boot-scan-failure-ledger.ts:66-70.
   `listGivenUp` is `ORDER BY last_failed_at, session_id LIMIT 20` with no filter on the file generation. The mtime comparison is applied after the LIMIT. Once a workspace has 20 or more terminal rows whose files are unchanged, deleted or unreadable (exactly the permanent poison sessions), they always occupy the 20-row window. A changed given_up session beyond the 20th is never re-admitted, so the stated guarantee "re-admitted when its generation changed" fails silently. Deleted-file rows are never pruned from the window either. Fix: page through the rows (or drop the LIMIT to a larger cap), or exclude them in SQL. At minimum, order so that rows that have not been checked rank first. Also consider pruning given_up rows whose files are missing.

2. MODERATE (premature clear of counts a live pass still needs) - memory-trigger.service.ts:497-507 with :726-731.
   `tryEpisodeCurate` returns `Promise.resolve()` when coalesced because another pass is in flight, when the buffer is empty, when held by network backoff, or when rate-limited. In each case the `.finally` runs immediately and deletes `failedPasses` for the session. For the coalesced case that deletes the count that the still-running pass is accumulating. If that pass then fails, it records 1 instead of N+1. The retry cap, MAX_FAILED_PASS_RETRIES, is reset for the session. If the pass settles after the clear, it can also write a fresh entry for the ended session, so the leak the fix targets is not fully closed. Fix: clear only when this call actually started a pass. For example, have `tryEpisodeCurate` return a promise only in that case and `undefined`/`null` otherwise.

3. MODERATE - memory-trigger.service.ts:497 with :789-800.
   When the session-end pass fails, `invokeCurate` reattaches the detached episode (:906-908, :920-925) after `flushSessionEnd` has already called `episodes.reset` (:509). The ended session's episode buffer is therefore re-created and never reset or forgotten. This predates the commit, but the commit's "settle clears state" intent leaves this entry in place. The related curator state that `forgetSession` already cleared is not touched again. Suggestion: on a session-end source, skip the reattach, or reset the episode in the settle callback.

4. MINOR - boot-scan-runner.ts:219-227 with the sort at :229.
   The admitted items are processed ahead of newer sessions, and a given_up session that keeps throwing (not returning 'failed') in `options.run` is caught at :331-337. In that case the row is never updated, so it is retried once every boot. This is not an infinite loop, since it is one attempt per boot, but it is unbounded in lifetime. Handling the throw as 'failed' via recordFailure would converge.

5. MINOR - memory-trigger.service.ts:495-507.
   The derived promise from `.finally` is dropped with `void`. If `invokeCurate` rejects before its try block (`observationQueue.drainForSession` is outside the try, at about :912), the result is an unhandled rejection. That path previously also rejected without a handler, but `inFlightCurates` is not cleaned up there either. If `tryEpisodeCurate` throws synchronously, the `endingSessions` entry set at :495 is leaked. Add a `.catch` and set the entry only after the call succeeds.

6. MINOR (test gap).
   There is no spec that an unchanged-mtime given_up row is not re-admitted, that a missing file is skipped, or that the window limit (finding 1) holds. The `stop !== null`/hard-stop case of item 2 also has no test.

## Counts
Blocking: 0. Serious: 1. Moderate: 2. Minor: 3.

## Verdict
REVISE. All four items are closed against the CodeRabbit comments, the CI failure and the specs. Finding 1 means the re-admission fix can silently fail for exactly the workspaces that need it, and finding 2 leaves the failedPasses clear incorrect for the coalesced path.
