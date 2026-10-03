# P2 Phase Re-review, Round 1 - TASK_2026_576_e16a

Scope: `git show c9a316661` on diff-tabs.service.ts and its spec; whole refresh path (lines 455-780, 862-885) read. Tests not run.

Verdict: APPROVED

No blocking or serious issues. Three moderate and two minor notes below; none needs a re-spin before P2 closes.

## Per-finding table

| # | Original | Status | Evidence |
| - | -------- | ------ | -------- |
| 1 | SERIOUS: `statusUnavailable` narrows scope and wipes previous set | RESOLVED | `onGitStatusUpdate` forwards `payload?.statusUnavailable` (:272-276); `mergePendingRefreshScope` sets `pendingRefreshAllDiffs` when `statusDegraded` (:584-590) and only replaces `previousStatusPaths` when `hasFileSet && !statusDegraded` (:600). Spec "a statusUnavailable push refreshes ALL tabs and keeps the previous file set". |
| 2 | MODERATE: causes present, files absent/non-array scoped | RESOLVED | `!hasFileSet` in the refresh-all condition (:587). Spec "absent or malformed files list refreshes every open tab". |
| 3 | MODERATE: `refreshing` parked on drop; previous set not reset on workspace change or dispose | RESOLVED with a caveat (see N1) | Restore on workspace-switch drop guarded by `diff.requestId === requestId` (:722-732); `previousStatusWorkspace` clear (:476-480); `dispose()` clears `previousStatusPaths`, `previousStatusWorkspace`, `inFlightDiffRefreshes` (:882-884). The newer-request-dropped branch (:734) never overwrote status, so the newer run owns it: correct. |
| 4 | MODERATE: no try/finally, phantom trailing pass on rpcCall reject | RESOLVED | try/catch/finally in `runDiffTabRefresh` (:675-692); the marker is consumed in `finally`, and the catch moves the tab off `refreshing`. `inFlightDiffRefreshes` is already released by the inner `finally` (:715-718). Spec "a rejected rpcCall clears the rerun marker". |
| 5 | MINOR: spec gaps | PARTIAL | Added: statusUnavailable, absent/malformed files, rpc reject. Still unproven: workspace-switch restore and the requestId guard, `previousStatusWorkspace` clear, tab closed while a rerun is queued, `refs`/`initial`/`refs-stash`-only causes, `drain(12)` brittleness. |
| 6 | MINOR: Batch 17 real-git cap coverage | NOT BLOCKING, see below | |

## Finding 6 (real-git coverage of the 2 MiB cap)

grep of `*.real-git.spec.ts` for `GIT_DIFF_MAX_SIDE_BYTES` / `too-large` hits only `libs/backend/vscode-core/src/services/git-info.service.operation.real-git.spec.ts` (:282-321: 3 MiB worktree diff, 3 MiB committed side of a staged diff, apply-hunks refusal). That drives `GitInfoService.diffFile`, i.e. the shared `classifyBlobBytes` rules. No real-git spec references `git-review-reader` / `GitReviewReader`, so the reader's own `git show` with `maxOutputBytes` -> `GitOutputLimitError` -> `too-large` + `cat-file -s` path is still only mock-tested. Not blocking: the classification rules and the exec-git abort are covered elsewhere, no behaviour is silently wrong, and the plan assigns the seam to the Component 13 spec. Keep it as an open follow-up there; also still missing is an exactly-2 MiB (passes) boundary case.

## New findings

N1. MODERATE - diff-tabs.service.ts:722-732. The workspace-switch drop restores `previousStatus`, which is usually `'fresh'`. The refresh was triggered because the content may have changed, and its result was discarded. The tab therefore returns to `fresh` with unverified content, where before it showed `refreshing` (honest, if stuck). Scenario: edit file, status push triggers refresh, user switches workspace during the read, then switches back: diff shows "fresh" but may predate the edit (unless something re-runs refreshAll on switch back; I found no such hook in this file). Fix: restore to `'stale'` (or leave `previousStatus` only when it was already `'stale'`/`'error'`).

N2. MODERATE - diff-tabs.service.ts:679-686. The catch patches unconditionally by key, with no `requestId` or workspace guard, unlike the drop path it mirrors. Tab closed: harmless (`patchDiff` maps over a missing key, :1039-1049). Workspace switched before the reject: marks the tab stale with the transport message, which is acceptable. A newer owner cannot exist concurrently because runs per key are serialised by `inFlightDiffRefreshes`, so the "newer request overwritten" scenario does not occur today. But the catch also wraps `toDiffState` / `applyFreshDiff` (:743-755), so a programming error there is reported to the user as a git transport failure and its cause is dropped (no log). Fix: capture the error and log it; scope the catch to the `requestDiff` await.

N3. MINOR - diff-tabs.service.ts:476-480. When `active` is null, `target = workspaceRoot ?? ''`. Payloads that alternate between carrying and omitting `workspaceRoot` flip `target` between `''` and the root, clearing `previousStatusPaths` each time and defeating the revert-to-clean match (RC11) in that mixed case. Only reachable with an older backend plus no active workspace; low likelihood.

N4. MINOR - diff-tabs.service.ts:688-691. The trailing run in `finally` after a throw is correct: it re-enters `runDiffTabRefresh`, which has its own try/catch, so it cannot throw out or loop (the marker is consumed once). If the catch's own `patchDiff` threw, the finally would still run and the error would propagate; not realistic.

N5. MINOR - diff-tabs.service.ts:884. `dispose()` clearing `inFlightDiffRefreshes` while a read is pending is safe (the pending `finally` deletes an absent key), but a refresh arriving after dispose and before that read settles will start a second concurrent read for the key. Teardown-only; ignore.

## Residual uncertainty

Whether the switch-back path refreshes tabs (N1) is outside this file. `rpcCall` rejection behaviour was not traced into the transport layer; the catch is correct either way.
