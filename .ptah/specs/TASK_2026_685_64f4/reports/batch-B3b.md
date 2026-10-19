# Batch B3b report

## Files

- Created `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat-streaming\src\lib\subagent-execution.store.ts`.
- Created `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat-streaming\src\lib\subagent-execution.store.spec.ts`.
- Modified `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat-streaming\src\index.ts`.
- Created `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\.ptah\specs\TASK_2026_685_64f4\reports\batch-B3b.md`.

## Task B3b.1

Added a root-provided signal store keyed by Task tool call ID. It tracks message and tool ownership, uses the shared accumulator for claimed live events, builds independent execution trees, finalizes terminal entries, and exposes `retain`, `release`, `ensureHistory`, `historyEventsSeen`, and `clearSession`. History paging merges a snapshot with live events using a merge-local deduplicator and `skipStoreEffects`.

Added focused specs for root and nested ownership, store-only events, concurrent agents, late events, finalization, finalized LRU and pins, history merge with live events during loading, tool-ID aliasing and an unmatched text-only message, repeated deltas, empty and error states, single flight, and cancellation on clear or last release.

## Task B3b.2

Exported `SubagentExecutionStore`, `SubagentExecutionEntry`, and `SubagentHistoryState` from the chat-streaming barrel.

## Risks and verification

- Live payload: each state has `eventCap = 2000`; total live events above 10,000 spill the oldest eligible entry. An abandoned running entry is marked spilled first. Pinned entries are excluded from spill and eviction.
- Finished payload: each finalized root passes through `capFinalizedTree`; finalized entries use a 20-entry read LRU. Owner IDs are FIFO-bounded to 4,000 per entry and cleared with entries.
- History races: generation guards check after every RPC and before merge. Clear, eviction, spill, and last release during loading invalidate the generation; an in-flight response is ignored. RPC timeout is supplied by `ClaudeRpcService.call` per plan assumption A5.
- Merge identity: same message ID or shared SDK tool-use ID can match; text and timing never create aliases. Snapshot blocks replace streamed prefixes; unmatched live blocks and complete-source replacements remain. A separate deduplicator and `skipStoreEffects` prevent merge replay from changing monitor usage or agent registrations (A2, A3, A8).
- Claim exceptions: caught and logged through `LoggingService`, then returned as `false` so the existing tab path can handle the event.
- Scoped `ptah_get_diagnostics` reported no errors in the three changed source/spec files. It reported 131 errors in sibling files outside this batch. No test, typecheck, lint, build, serve, or package command was run, as required by the lane rules.

## Decisions

- **Entry publication:** expose a readonly-map signal while retaining a private mutable map. Options were per-key signals or a map signal. The plan requires entries exposed through signals, and nearby stores use Angular signals; the map choice is reversible.
- **History API:** `syncRecord` takes the existing `SubagentRecord` and `ensureHistory` uses its `parentSessionId`. Options were a separate session argument or record-derived session. The plan explicitly names `record.parentSessionId`; reversible.
- **History replay:** `historyEventsSeen` leaves payload out of this store. Options were retaining replay events or on-demand loading. The plan explicitly requires on-demand reload; reversible if the product changes replay policy.

## Remaining verification

The team leader should run the scoped chat-streaming test, typecheck, and lint gates. The new spec does not yet exercise the 10,000-event spill and 4,000-owner limits with full-size fixtures or every listed two-page abort variant; those boundaries are implemented in the store and remain a coverage gap.

## Check fix

The team-leader test found that a `text_delta` received after `finalize` was lost. `EventDeduplicationService.isMessageAlreadyFinalized` remembers the message ID for the session and rejects a delta when the new state has no matching `messageEventIds` entry. The store now saves bounded `message_start` and lightweight `tool_start` metadata at finalization, then seeds a fresh state when a late event refers to one of those finalized messages or tools. The accumulator consequently accepts and retains the late delta, and the tree builder has a message root for it. These start maps are limited to 2,000 IDs per entry and removed on entry eviction or session clear; retained tool starts exclude input and prompt payloads.

The regression spec now checks that the fresh state holds the start plus late delta, that the text accumulator contains the late text, and that `treeFor` builds from the fresh state. Scoped `ptah_get_diagnostics` found no errors in the changed files (the same 131 sibling-file errors remain). Per lane rules, no tests, typecheck, lint, build, or package command was run; the team leader should rerun the scoped chat-streaming test.
