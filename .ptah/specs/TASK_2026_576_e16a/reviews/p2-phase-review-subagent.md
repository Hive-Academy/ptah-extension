# P2 Phase Review (cross-side logic) - TASK_2026_576_e16a

Scope: Batch 17 (git-review-reader.service.ts + spec), Batch 19 (diff-tabs.service.ts + spec). Read whole files; diffs vs origin/main. Did not run tests.

Verdict: APPROVED WITH FIXES
Score: 7/10

Batch 17 is sound. Batch 19 meets its three stated behaviours and the tests prove them, but the scoped refresh narrows silently when the status payload is degraded, which is the failure mode the rest of this task is about.

## Findings

1. SERIOUS - diff-tabs.service.ts:553-564 (mergePendingRefreshScope). A `git:status-update` with `statusUnavailable` set (e.g. `output-too-large`, shared type rpc-git.types.ts:146) carries an empty `files` list that does not mean clean. With a `['workspace']` cause the scoped branch collects nothing from the current set, and line 564 then overwrites `previousStatusPaths` with the empty set. Scenario: a big checkout makes status output too large, the user edits or reverts a file, and its open diff is not re-read; the following scoped event has no previous set to match either. Result is a stale diff presented as fresh, with no error. Fix: if `statusUnavailable` is present (pass it through `onGitStatusUpdate`), treat it as refresh-all and do not replace `previousStatusPaths`. Add a spec.

2. MODERATE - diff-tabs.service.ts:541-564. `causes` present but `files` absent or non-array (malformed or older-backend payload; the code already tolerates this per-entry) takes the scoped branch and refreshes only the previous set. The contract for unknown scope is "refresh everything" (the file's own doc at lines 92-98). Fix: when `files` is not an array, set `pendingRefreshAllDiffs = true`.

3. MODERATE - diff-tabs.service.ts:665-669 and 813-817. When a response is dropped because the workspace changed or a newer `requestId` exists, the tab can be left at status `refreshing` (workspace-switch case never resets it). This predates the batch, but the new rerun path makes the dropped-response case more common, and no spec covers it. Also `dispose()` does not clear `previousStatusPaths` or `inFlightDiffRefreshes`, and `previousStatusPaths` is not reset on workspace switch, so a stale set from another workspace over-refreshes (harmless but untidy). Fix: reset `previousStatusPaths` on workspace change and in `dispose()`; reset the `refreshing` status on the workspace-mismatch drop.

4. MODERATE - diff-tabs.service.ts:633-638. `runDiffTabRefresh` has no try/finally around `readDiffTabOnce`. If `rpcCall` ever rejects rather than returning `{success:false}`, the rerun marker stays in the set and the next unrelated refresh runs one phantom trailing pass. `inFlightDiffRefreshes` is protected by its own finally, so no deadlock. Fix: `finally { this.rerunRequestedDiffRefreshes.delete(key) }` on the throw path, or wrap in try/catch that maps to the `stale` state.

5. MINOR (tests) - diff-tabs.service.spec.ts. Claims proved: scoped 1-of-3, rename origPath, previous-set revert, index = all, one trailing run for a burst of three, failed refresh keeps content. Not covered: `statusUnavailable` payload (finding 1), absent `files` (finding 2), tab closed while a rerun is queued (code returns early at 642-643, looks right but is unproven), workspace switch during a queued rerun, `refs`/`initial`/absent-causes branch of `causesRefreshEverything` (only `index` is asserted), a `refs-stash`-only cause. The `drain(12)` microtask count is brittle against added awaits.

6. MINOR (backend) - git-review-reader.service.spec.ts. Both too-large tests mock the buffer runner to throw `GitOutputLimitError` directly, so they prove the mapping and the `cat-file -s` fallback, not that the real `execGitBuffer` stops git at the cap and surfaces the error. No spec covers a blob of exactly 2 MiB (passes, `>` check) or a size probe returning a value <= cap (code returns the cap; correct, untested). The real-git seam is assigned to the Component 13 spec in the plan; confirm it exists before closing P2.

## Batch 17 evidence

- git-review-reader.service.ts:385-394: `maxOutputBytes: GIT_DIFF_MAX_SIDE_BYTES` is passed to `git show`; the 64 MiB default is gone. exec-git.ts:859-860 aborts with `GitOutputLimitError` when output exceeds the limit. OK.
- :396 delegates to `classifyBlobBytes`, so the binary, LFS and too-large rules are shared with the git-info path rather than duplicated. OK.
- :417-426 catch maps `GitOutputLimitError` to `too-large`; `blobSize` (:441-459) uses `cat-file -s`, returns the cap as an honest lower bound when git fails, and never throws. The `size > atLeast` guard prevents a bogus smaller size. OK.
- Non-limit errors still go to `gitReadError`, so no failure is turned into a success-looking result.
- Residual uncertainty: the cap applies to combined stdout/stderr bytes as counted by exec-git (not read in full); only matters for error output, which is small.

No blocking issues in either batch.

## Five logic questions (short)

1. Silent failure: finding 1 (degraded status narrows the scope), finding 2.
2. User action: re-selecting a hunk after a queued rerun is covered by the snapshot-token check; no new issue.
3. Wrong answer: stale diff after `statusUnavailable` (finding 1).
4. Dependency failure: a transport failure on refresh keeps previous content with status `stale` (verified at :671-679); rpcCall rejection is not guarded (finding 4).
5. Missing: workspace-switch cleanup and `refreshing` reset (finding 3).
