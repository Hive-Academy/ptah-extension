# Code Logic Review, batch T round 2 (TASK_2026_674_fa33 + 675_b720 + 676_a876)

Reviewer: Claude (code-logic). Read-only; nothing was run (no nx, jest, build). Based on the uncommitted diffs of the files below plus surrounding code.

Files read: `session-history-replayer.service.ts` (diff + :330-460), `session-history-replayer.service.spec.ts` (diff), `session-loader.resync-live-seed.spec.ts` (diff), `message-finalization.service.ts` (:40-135, :150-380), `message-finalization.service.spec.ts` (diff), `chat-types.ts` (:60-70, :150-200), `accumulator-core.service.ts` (:545-600), `streaming-handler.service.ts` (:415-480, :535-560), `tab-persistence.ts` (streamingState handling).

## Summary

| Metric        | Value                                                     |
| ------------- | --------------------------------------------------------- |
| Assessment    | APPROVED                                                  |
| Score         | 8/10                                                      |
| Blocking      | 0                                                         |
| Serious       | 0                                                         |
| Moderate      | 0                                                         |
| Minor (new)   | 3 (none block merge)                                      |

Score rationale: every round-1 finding is resolved with a matching spec, and the 675 decision is implemented as decided. Not 9: the multi-owner repair still handles only intervening USER roots (not a non-owner assistant row between owners), and one edge falls back silently.

## Per-finding status

| Finding | Resolved | Evidence |
| ------- | -------- | -------- |
| B1 owner-missing spec | YES | `session-history-replayer.service.spec.ts` spies on the injected `LoggingService.warn` and asserts `('SessionHistoryReplayer', 'seeded subagent history owner not found', { parentToolUseId: 'toolu_T' })`. Matches the call shape in `session-history-replayer.service.ts:~366` (`this.logger.warn(tag, msg, { parentToolUseId })`). Lane reports the file's suite passing (not re-run by me). |
| M1 two-owner misorder | YES | Replayer keeps user roots located strictly between the first and last owner in `messageIds` (`session-history-replayer.service.ts` ~:398-404), so the tree builder cannot merge the two assistant roots. `session-loader.resync-live-seed.spec.ts` "keeps two seeded Task owners live" asserts `roots` ids `['first-start','second-start']`, `messages` `['between-users']`, and after `finalizeCurrentMessage` the transcript order `['first-start','between-users','second-start']`. Order is asserted, not just count. |
| M2 time-based placement on shared path | YES | `message-finalization.service.ts:81-83`: `if (!firstAnchor) placed = [...existing, ...newMessages]` is the main-branch behaviour. No timestamp comparison anywhere in `placeFinalizedTrees`. Spec "appends a normal turn even when a frozen row has a later timestamp" (`message-finalization.service.spec.ts` ~:341) pins it. |
| M3 anchor branch appends owner late | YES | Recorded placement is applied after BOTH branches (`message-finalization.service.ts:~99-115`), only for ids present in `state.resyncOwnerPredecessors`. Normal turns have `undefined` map, so `predecessor === undefined` -> `continue`. Specs ~:352-385 cover no-anchor (`['before','start-owner','after']`) and anchor (`['before','start-owner','after','prompt','start-reply']`). |
| M4 unresolved owner silent | YES | Per-seed `resolved` flag, `logger.warn(..., { parentToolUseId })` when unresolved, even if other seeds resolve (`session-history-replayer.service.ts` ~:351-370). Warn carries only a tool id, no path/secret. |
| Minor: stale doc comment | YES | `message-finalization.service.ts:50-54` now says ordinary turns append; resync owner uses recorded predecessor. |
| Minor: TodoWrite timestamp tie | YES | `latestTodo` loop over `filteredEvents.values()` uses `>=`, so the last of equal timestamps wins (`session-history-replayer.service.ts` ~:414-419), matching `recordLatestTodoWrite`. |
| Minor: empty `input` fallback | YES | `...(todoInput && Object.keys(todoInput).length ? { input: todoInput } : {})` (~:428-433). |
| Minor: `currentMessageId` first-in-seed-order | YES | `orderedOwners = historyState.messageEventIds.filter(owners.has)`, `currentMessageId: orderedOwners.at(-1) ?? null` (~:423, :443). |
| Minor: O(messages x starts) filter | YES | `ownerStarts` Set; filter is `!ownerStarts.has(message.id)` (~:445). |
| Minor: remaining console calls in replayer | OPEN, accepted | Eight pre-existing `console.warn/error` remain; existing specs spy on console. Lane documents it (`batch-T.md` "Open after fix round 1"). Reasonable to leave. |

## 675 decision check

- Normal turns: identical to main. No-anchor branch is the original `[...existing, ...newMessages]`; anchor branch body is the original logic (merely re-indented into an `else`). The post-pass is a no-op when `resyncOwnerPredecessors` is missing, and `deepCopyStreamingState` passes `undefined` through (`message-finalization.service.ts:~353-354`).
- Resync owner: recorded placement is used only when present, in both branches. Predecessor not found in `placed` -> `continue`, so the owner stays where the branch put it (no loss, no duplicate; `placed.splice(currentIndex, 1)` then reinsert keeps exactly one copy). `insertedOwners` plus the skip loop keeps two owners with the same predecessor in order.
- Traces: `[A, O, B]` frozen, no anchor -> O moved to just after A. With a mid-stream prompt -> `placed=[A,B]` then O after A, prompt/reply after. First-row owner (`predecessor === null`) -> index 0.

## StreamingState field handling

- `chat-types.ts:65-66`: `readonly resyncOwnerPredecessors?: ReadonlyMap<string, string | null>;` with a doc line. Optional, readonly, documented. The doc is one line and does not say "undefined outside a resync repair"; acceptable.
- Not initialised by `createEmptyStreamingState()` (correct: absent means normal turn).
- Copy sites searched in `libs/frontend/chat*`, `chat-routing`, `harness-builder`, `mcp-apps-page`, `canvas`:
  - `deepCopyStreamingState` (`message-finalization.service.ts:351-354`): copies the map. This is the only field-by-field copier; the finalize path reads the field off the copy (`placeFinalizedTrees(..., stateCopy, ...)` at :~330), so omitting it would have silently disabled the fix. Handled.
  - Replayer `liveState = {...historyState, resyncOwnerPredecessors, ...}`: sets it.
  - `accumulator-core.service.ts:574-576` (`compaction_complete`): builds `createEmptyStreamingState()` and carries only `latestTodoWrite`. The new field is dropped, which is correct: the owner's events are gone with the replaced state, so there is nothing left to place. Not stale.
  - `streaming-handler.service.ts:423,434,540`: empty/ephemeral states only; the real state is mutated in place, so the field survives event processing.
  - `applyFinalizedTurn` / `clearStreamingForLoaded` null `streamingState` (`tab-manager.service.ts` ~:2229); `tab-persistence.ts` nulls it on persist, so the Map is never serialized.
  - Only `deepCopyStreamingState` needed an update; no other spread/reset site exists. The field cannot go stale after finalize because the state itself is discarded.
- Pre-existing, not introduced here: `deepCopyStreamingState` does not copy `latestTodoWrite`/`structuralRevision`. The finalize path therefore builds trees from a copy without the marker. Out of scope; not a regression.

## New findings

### N1 (Minor). Only intervening USER roots are retained between owners
`session-history-replayer.service.ts` ~:398-404 adds `start.role === 'user'` roots only. A non-owner ASSISTANT root frozen between two owners (assistant-assistant adjacency with no user prompt between them) is still dropped from the live state, so the tree builder can merge the two owners. Real transcripts alternate user/assistant, so this is unlikely. The predecessor map does not rescue it because a merged node mints one message. No action needed; note for follow-up if it appears.

### N2 (Minor). `currentMessageId` falls to `null` if no owner id is in `historyState.messageEventIds`
`orderedOwners.at(-1) ?? null` (~:443) and `Math.min(...ownerPositions)` on an empty array (-> `Infinity`, harmless slice) happen when owners exist but none is in `messageEventIds` (cap eviction of the owner start). `finalizeCurrentMessage` then returns early on `!messageId` (`message-finalization.service.ts:~169`) and the live state would not finalize. The owner row has already been removed from `tab.messages` at that point. Very unlikely (owners come from the same history that built `messageEventIds`); a guard that skips the repair when `ownerPositions` is empty would make it safe.

### N3 (Minor, informational). Compaction while a resynced owner is live
`compaction_complete` replaces the state (`accumulator-core.service.ts:574`), so a repaired owner removed from `tab.messages` is lost. Same class of behaviour as any live root on compaction; not new risk beyond the repair design. Leave.

No `any`, no unchecked casts, no new `console.*`, and no unbounded loops in the diff: the root walk has a `visited` set; the insertion `while` advances `insertionIndex` and is bounded by `placed.length`; the `changed` closure loop is pre-existing and monotonic.

## Five logic questions (delta)

1. Silent failure: unresolved placement degrades to append (loses order, not data); N2 is the only no-signal path.
2. User action: mid-stream prompt after resync is covered by the anchor-branch spec.
3. Wrong-answer input: assistant-assistant adjacency between owners (N1).
4. Dependency failure: predecessor row deleted between resync and finalize -> falls back to branch placement, no crash.
5. Missing: no spec for equal-predecessor owners in the finalization service directly (the loader spec covers two owners end to end).

## Verdict

APPROVED, 8/10, confidence HIGH on the read paths (MEDIUM that specs pass: not run by me; the lane reports 67 + 53 passed). Merge-blocking items: none. Optional: add the N2 guard.
