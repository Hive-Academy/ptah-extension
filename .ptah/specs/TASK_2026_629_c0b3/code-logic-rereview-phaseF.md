# Code Logic Re-review (Phase F fix round) — TASK_2026_629_c0b3

Scope: `git show 94484635a`, plus reads of chat-view.component.ts, compact-session-metrics.ts, session-git-stats.store.ts, change-set.store.ts, canvas-session-details.component.ts, compact-session-card.component.ts. No tests or nx commands run (orchestrator results taken as given).

## Fixed-item status

| Item | Status | Evidence |
| --- | --- | --- |
| S1 resume / resume-all / budget wrap-up bypass the cap guard | FIXED | chat-view.component.ts:1438-1442 (`handleResumeAgent`), :1461-1465 (`handleResumeAllAgents`), :1480-1484 (`onBudgetWrapUp`). Each calls `_sessionStartGuard?.()` and, on a reason, calls `showActionError(reason, _sessionContext?.() ?? null)`, so it lands on the right tab. It returns before `sendOrQueueMessage` / `sendWrapUp`, so the agent list and budget banner entries are not consumed. With the token absent (`inject(..., {optional:true})`, :262) the optional call yields `undefined`, so behaviour is unchanged. Resume-all with one agent delegates to `handleResumeAgent`, so the guard runs once. The wrap-up path returns a resolved promise, so callers that await it still work. |
| M2 older todo list shown after a compacted turn finalizes | FIXED, with one edge case (see N1) | compact-session-metrics.ts:126-132. The `lastCompactionAt` cutoff stops the scan with `unknown`. Both sides are in ms: `lastCompactionAt = Date.now()` (tab-manager.service.ts:2186) and message timestamps come from `createExecutionChatMessage` (a ms epoch). A tab with no compaction gives `?? 0` (card :235, details :131), and `timestamp < 0` is never true, so there is no behaviour change. Compaction resets `messages: []` (tab-manager.service.ts:2180), so a post-compaction message always has a timestamp at or after the cutoff and its valid list is not hidden. |
| M3 details column recompute cost | PARTIAL | The spread is gone: `summarizeTodos` iterates `streaming.events.values()` directly (metrics.ts:113). The details `todos` computed (canvas-session-details.component.ts:125-135) still has no sampling or throttle and still re-runs on every `tab()` change. The cost is now O(events) with no allocation, not O(1). Acceptable, but the sampling part of the original finding was not done. |
| M4 git state equality | FIXED | `sameGitState` (metrics.ts:30-45) is null-safe, compares every field of `known` and `reason` of `unknown`, and `none` compares equal. `setState` skips the write when equal (session-git-stats.store.ts:296-300), and `readAt` is still updated by the caller, so freshness logic is intact. The card and details `gitStats` computeds use `equal: sameGitState` (card :267, details :156). |
| m3 gitTitle distinguishes unavailable from failed | FIXED | metrics.ts shared `gitTitle` returns "Could not read git status" for failed and "Git changes unavailable" for unavailable. The details column uses it (details :155). |
| m4 `?.` on a missing method | FIXED | details :140 now calls `findTabByIdAcrossWorkspaces(this.tabId())?.workspacePath`. The `?.` is on the result, which is legitimate. |
| Shared `workspace-root.ts` helper | FIXED, equivalent | The old ChangeSetStore `trimTrailingSlashes` loop and the new `/\/+$/` strip the same thing (all trailing `/` after backslash conversion), and the drive-letter case fold is identical. Behaviour is unchanged. `sameWorkspaceRoot` is used at the same three call sites. `trimTrailingSlashes` is still used at change-set.store.ts:160, so the function was correctly kept. |
| Style 2, 3 and minors | Not assessed (logic re-review only) | |

## New defects introduced

None Serious. Moderate and minor only.

- N1 (Moderate, narrow). metrics.ts:128 returns `unknown` when any message, user messages included, has `timestamp < lastCompactionAt`, before the role check. Scenario: a tab where `lastCompactionAt` is set and `messages` holds older messages. That happens if history or older pages are loaded after compaction (`olderHistoryCursor` is reset to undefined at :2179, but a later history rebuild with original timestamps is possible), or a message that is created with a historical timestamp and appended after the cutoff. The card then shows `unknown` where `none` or an older valid list would be correct. This is conservative, not wrong data, and I did not find a code path that triggers it today. Fix: scope the cutoff to assistant messages that carry `streamingState`, and let the tail of the list decide.
- N2 (Minor). change-set.store.ts:~124: the doc comment `/** Forward slashes, no trailing slash, drive paths case-folded. */` is now orphaned directly above the `mergeChangeSets` doc comment. This is cosmetic and misleading, and it belongs to the style reviewer. Remove it.
- N3 (Minor). The details `todos` computed has no `equal`. The downstream computeds yield primitives, so there is no render churn, but one object is allocated per tab change.

## Do-not-reraise items (decisions rows 37-38)

Not made worse by the fix.

## Verdict

PASS. S1, M2, M4, m3, m4 and the shared helper are fixed with correct semantics. M3 is partly done (allocation removed, sampling not added). N1 is a narrow, conservative edge case and does not block.
