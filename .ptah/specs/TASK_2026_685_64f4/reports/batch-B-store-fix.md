# Batch B store review fix

## Files written

- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat-streaming\src\lib\subagent-execution.store.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat-streaming\src\lib\subagent-execution.store.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat-streaming\src\lib\subagent-execution-ownership.ts` (new)
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat-streaming\src\lib\subagent-execution-retention.ts` (new)
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat-streaming\src\lib\subagent-execution-history-merge.ts` (new)
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat-streaming\src\lib\history-message-builder.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat-streaming\src\lib\history-message-builder.service.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat-streaming\src\index.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat-routing\src\lib\stream-router.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\.ptah\specs\TASK_2026_685_64f4\reports\batch-B-store-fix.md`

## Evidence and risk handling

- M1: The store observes `AgentMonitorStore.subagents()` and syncs changed records, including terminal statuses. The root Task result already calls `AgentMonitorStore.onTaskToolResult` through `accumulator-core.service.ts:459`; the dead claimed `tool_result` finalization was removed. A new spec flushes a terminal monitor record. Last release removes an empty retain-only entry, and empty root entries can be spill candidates.
- M2: `abort` removes the key's single-flight promise, and `ensureHistory` checks entry eligibility before returning an active load. Specs cover release/reopen during a pending response and abort after page two starts.
- M3: History replay ownership is kept by session across `accumulate` calls, and each event with `parentToolUseId` registers its message. A two-chunk spec verifies the later child delta stays out of tab state. The no-op `historyEventsSeen` seam was removed.
- M4: The history collector keeps at most 10,000 events and marks discarded data truncated. Merge reports when the 2,000-event state cap drops snapshot events. Paging has a 100-page limit and visited-cursor cycle guard.
- M5: Specs now cover 10,800 live events spilling under the 10,000 total cap, 4,001 owner IDs, two-page abort, reopen/retry during load, spill during load, and an owned accumulation exception. Evicted message IDs remain tombstoned until their entry is removed, so late parentless events are consumed rather than entering the tab.
- B5a: A loaded entry with `truncated=true` may reload on a subsequent `ensureHistory` call; a spec checks a second RPC.
- Style: Ownership, retention selection and history merge are separate sibling files. `entries` is a private writable signal with a public readonly signal and entry view. Constants name event, page, owner and retention caps. Stream-router session agent cleanup uses one helper at both sites; the history replay branch has a named method.

## Decisions

- **Record finalization:** React to the monitor signal. Existing `onTaskToolResult` changes the monitor record on the parent tab path, and an effect covers other terminal transitions. Reversible: yes.
- **Owned event exception:** Log it, mark the entry truncated and consume it. Returning it to the tab after ownership or state mutation risks mixing subagent content into the parent transcript. Reversible: yes.
- **Owner eviction:** Keep ID-only tombstones until entry removal. This preserves routing for late parentless events after the 4,000 active-owner cap. Reversible: yes; tombstone memory grows with message IDs in a long session.
- **Public type compatibility:** Kept the legacy `SubagentExecutionEntry` type export because current component specs, including a transcript spec owned by another lane, import and construct it. The new `SubagentExecutionEntryView` and `entries` signal are readonly. Reversible: yes, once those specs migrate.

## Verification

No tests, lint, build, typecheck, package command or git command was run, per lane instructions. Scoped `ptah_get_diagnostics` reported no errors in the changed store, its spec, new helper files, routing source, index and consumer source. It reported an existing `history-message-builder.service.spec.ts:66` missing `isCollapsed` property and unrelated sibling-spec errors. One larger diagnostic call timed out; narrower calls completed.

## Deferred

- The exported legacy entry type still exposes internal fields to keep forbidden component specs compiling. The store still copies its map on publish, and its pre-existing dense sections have not been fully hand formatted.
- No separate focused specs were created for the extracted pure ownership/retention/merge helpers; coverage is through store specs. The owner tombstone map is unbounded until entry removal. The replay ownership map likewise lives for the builder's lifetime; a session-clear seam should release it.
- Full test execution and review of runtime behavior belong to the team leader's verification pass.
