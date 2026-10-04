# Code Logic Re-review: `TASK_2026_597_ab22` S4-a fix round

Scope: commit `746601373`, excluding `.ptah`. I only checked whether S1, S2, M1 and M2 from `reviews/s4a-code-logic-review.md` are closed, and whether the fixes add any new Blocking or Serious issues. I read the diff one file at a time. I read the spec diffs but did not run them.

## Summary

| Metric                         | Value    |
| ------------------------------ | -------- |
| Overall score                  | 8/10     |
| Assessment                     | APPROVED |
| New blocking issues            | 0        |
| New serious issues             | 0        |
| New moderate or minor issues   | 3        |
| Findings resolved              | 4 of 4   |

## Status of each finding

| Finding | Status | Evidence |
| --- | --- | --- |
| S1 `ptah_run_check` checks the wrong tree | RESOLVED | `protocol-dispatcher.ts:1365-1376` (HTTP): the check now goes through `resolveRunCheckRoot` and no longer uses `resolveSpoolRoot`. `protocol-dispatcher.ts:3416-3445`: the root resolves only in three cases: the declared root is an open folder; it is a real directory strictly inside an open folder (`findDirectoryInsideKnownFolder`, `:3451-3482`); or the call comes from off the request path and exactly one folder is open. Every other case returns an error that names the declared root and the open folders, and nothing runs. `run-check.tool.ts:309` prints `Ran in: <cwd>`, and `structured.cwd` is set on every outcome (`:178-185`, `:266-273`). The not-found and spawn-failed errors name the root too (`:191`, `:239`). The stdio surface keeps the launching process's cwd (`agent-tool.dispatcher.ts:791-803`). That cwd is the lane's own directory, so it was never the multi-root hazard. stdio now reports `cwd` on both success and error. |
| S2 the `fresh` decision is invisible | RESOLVED | `agent-process-manager.service.ts:389-427`: `gateResume` returns `resumeDecision` on both branches, with `sessionKnown = lane.length > 0`. `:571` puts it on the `SpawnAgentResult`. `trackSdkHandle` is synchronous (`:678-683`), so spreading its result is safe. `mcp-response-formatter.ts:1823-1855` renders a `fresh` decision as "NOT resumed ... give it complete instructions". When the host holds no record of the session, it adds a line that says so. HTTP (`protocol-dispatcher.ts:1166`) and stdio (`agent-tool.dispatcher.ts:385`) both use the shared `formatAgentSpawn`, so the two surfaces show the same thing. The fix surfaces an unrecorded fresh resume instead of refusing it. The original review left that choice open ("Consider ..."). |
| M1 original task lost on chained handoffs | RESOLVED | `agent-process-manager.service.ts:410-411`: `originalTask = first.originalTask ?? first.task`. `:427` passes it through, and `:493` stores it on the fresh lane's record (`agent-process.types.ts`, new `originalTask`). A second fresh handoff from that lane now carries the task the chain started with, not the follow-up message. |
| M2 curator watermark stamped too early, and manual compaction coalesced | RESOLVED | `memory-curator.service.ts:289`: the watermark is stamped only when `stats.outcome === 'ran'`. A thrown, stalled or deferred pass leaves it untouched, so the next PreCompact retries. `:320`: `trigger === 'manual'` is never coalesced. `coalescePreCompact` is now read-only, and `stampPreCompact` (`:344-349`) skips a blank session id. |

## New issues from the fixes (none Blocking or Serious)

- **Moderate: worktrees outside every open folder cannot use `ptah_run_check` over HTTP.** `protocol-dispatcher.ts:3466-3480` accepts a directory only if it is strictly inside an open folder. Worktrees under `<repo>/.claude-worktrees/` work. A sibling worktree such as `D:\projects\ptah-extension-wt` gets an honest refusal, not a verdict. This is the fail-closed behaviour S1 asked for, and the error text names the cause. The tool description at `run-check.tool.ts:131` says "(worktrees too)" without this limit, so callers may be surprised.
- **Moderate: a worktree without its own `node_modules/nx` now gets "Nx was not found ... (<root>)"** (`run-check.tool.ts:188-194`). Before the fix, the same lane got a false verdict from the main tree. The new behaviour is correct and the message is explicit. Orchestrators should expect this error from worktree lanes that skipped the install step.
- **Minor: auto PreCompacts that arrive while a pass is running are no longer stopped by the watermark.** The stamp now lands after the pass (`memory-curator.service.ts:250-289`), so a second hook gets through. The per-key `inFlight` join (`:404-437`) stops a duplicate concurrent pass. `this.running` (`:251`) is still overwritten by the second hook. That reassignment pattern existed before this fix.
- **Minor: a fresh handoff from an unrecorded session stores no `originalTask`** (`:427` sets it only when it is non-empty). If that lane is later handed off fresh again, the brief's "Original task" shows the previous handoff brief, which itself contains `(unknown ...)`. The resulting brief is less clear, but no data is lost.

## Checks performed

- HTTP callers that declare a root: SDK sessions declare `/workspace/{cwd}` (`sdk-query-runner.service.ts:652`), and CLI lanes declare their working directory (`ptah-mcp-url.ts:57`). The new rule that refuses a request with no declared root therefore does not hit the normal callers (`http-server.handler.ts:302-310`, `:394`).
- `isMcpRequestInFlight` (`mcp-request-context.ts:105`) is true only inside `runWithMcpRequestContext` (`protocol-dispatcher.ts:302`). The fallback to a single open folder is therefore reachable only from internal, non-MCP calls, as intended.
- `structuredContent` is added after `createToolSuccessResponse`, in place, so the budget-outcome identity is kept (`protocol-dispatcher.ts:3485-3497`).

Residual uncertainty: I did not run the specs, and I did not check whether `originalTask` survives a host restart if lane records are persisted.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: worktree lanes outside an open folder, or without installed dependencies, now get explicit `run_check` refusals. That is correct, but orchestrators may not expect it.
- Follow-ups (non-blocking): state the "inside an open folder" limit in the `ptah_run_check` description; consider realpath'ing the open folders before the prefix comparison, so a folder opened through a junction still matches.
