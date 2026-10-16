# Code Logic Review, batch T (TASK_2026_674_fa33 + 675_b720 + 676_a876)

Reviewer: Claude (code-logic). Implementer lane: codex. Read-only review; nothing was run (no nx, jest or build). Findings come from reading the diffs and the surrounding code.

Files read in full around the change:
- `libs/frontend/chat/src/lib/services/chat-store/session-history-replayer.service.ts`
- `libs/frontend/chat-streaming/src/lib/message-finalization.service.ts`
- `libs/frontend/chat/src/lib/services/chat-store/session-loader.resync-live-seed.spec.ts`
- Cross-read: `chat-types.ts` (`recordLatestTodoWrite`), `compact-session-metrics.ts` (`summarizeTodos`), `execution-tree-builder.service.ts` (merge loop), both `mergeByTime` copies, `logging.service.ts`, `session-history-replayer.service.spec.ts`, `message-finalization.service.spec.ts`.

## Summary

| Metric          | Value                                                               |
| --------------- | ------------------------------------------------------------------- |
| Assessment      | NEEDS_FIXES                                                         |
| Score           | 6/10                                                                |
| Blocking        | 1 (an existing spec that the acceptance requires to pass now fails) |
| Serious         | 0                                                                   |
| Moderate        | 4                                                                   |
| Minor           | 5                                                                   |

Score rationale: the three fixes address their stated reproductions, and the new specs would fail on the old code. That keeps the score above 5. One existing spec breaks, which the acceptance explicitly forbids. The multi-owner path also has a persistent ordering defect that the spec hides. Both keep the score below 7.

## Blocking

### B1. The owner-missing spec in `session-history-replayer.service.spec.ts` now fails

- Code: `session-history-replayer.service.ts:367` replaced `console.warn('[SessionHistoryReplayer] seeded subagent history owner not found')` with `this.logger.warn('SessionHistoryReplayer', '...not found')`.
- Spec: `session-history-replayer.service.spec.ts:887` asserts `expect(consoleWarn).toHaveBeenCalledWith('[SessionHistoryReplayer] seeded subagent history owner not found')`.
- Why it fails: the spec uses the real `LoggingService` (`providedIn: 'root'`, not mocked in the TestBed at :106-122). `LoggingService.logToConsole` (`logging.service.ts:257-275`) calls `console.warn('[<iso>] [WARN] SessionHistoryReplayer:', message, '')`. That is three arguments with a different prefix, so the single-string assertion cannot match.
- Impact: the 674 acceptance says "the existing A-2 and owner-missing specs still pass". The lane ran only the resync spec (7 passed), not this file.
- Fix: update that assertion to the logger call shape, or spy on `LoggingService.warn`. Then run `npx jest -c libs/frontend/chat/jest.config.ts session-history-replayer.service.spec.ts --coverage=false --maxWorkers=2`.

## Moderate

### M1. Two-owner repair still misorders the second owner (674)

- Code: `session-history-replayer.service.ts:404` keeps the owners' `message_start` ids but drops every user root between them. `ExecutionTreeBuilderService.buildTree` merges consecutive assistant roots into one node (`execution-tree-builder.service.ts:~400-435`). The live state then renders as one merged node.
- Scenario: history `[first-root, between-users, second-root]`, with both Tasks seeded (exactly the spec at :381-418).
  - Both owner rows are removed from `tab.messages`.
  - The merged node (at `first-root`'s `startTime`) carries `second-root`'s Task and live tail.
  - During streaming the second owner's content paints above `between-users`.
  - On finalize it is minted as one message at the first owner's position, so the misorder persists.
- Spec cover: the two-owner spec asserts `roots` `toHaveLength(1)` (:~393), which encodes the merge and passes. It never checks order or finalization.
- Impact: nothing is lost or duplicated, but content shows under the wrong turn. The same happens with any non-owner assistant row between owners.
- Fix: keep the frozen root boundaries in the live state. For example, retain user `message_start` ids that fall between owners in `messageEventIds` and in `events` so the merge breaks. Alternatively, restrict the repair to contiguous owners and leave non-contiguous owners on the seed-only path. Add an order assertion to the spec.

### M2. 675: time-based placement on the shared path (`message-finalization.service.ts:80-88`)

`placeFinalizedTrees` runs for every live turn. Its no-anchor branch is the common case, because anchors exist only after a mid-turn prompt boundary. The old branch always appended. The new branch inserts before the first frozen row with a strictly later timestamp.

Traced cases:
- Normal turn: the user row is stamped `Date.now()` at send (`message-sender.service.ts:425`). The assistant start is stamped `Date.now()` in the backend transformer, so the user row is earlier and the turn is appended. OK.
- Equal timestamps: `>` is strict, so it appends. OK.
- Missing or NaN timestamps: comparisons are false, so it appends. OK.
- The existing no-anchor service specs have no timestamps on frozen rows, so they still append. I read that these are unaffected, but did not run them.
- Idle-sent or queued prompt landing before finalization: the turn is now placed above it. This is chronologically right, and matches the streaming `mergeByTime`.

Remaining concerns:
- (a) Clock skew between webview and extension host (VS Code Remote / WSL) puts a reply above its own prompt after finalize. `mergeByTime` (`chat-transcript.component.ts:115`) already orders by time while streaming, so streaming shows the same flip. The change is therefore consistent, but it adds a clock dependency to every non-resync turn.
- (b) The scan runs from index 0 and takes the FIRST later row. One non-monotonic row (a stamped-late synthetic row, a history/live clock mismatch) drags the whole turn up behind it. Scanning back from the tail would bound the damage.
- (c) The behaviour change has no direct unit spec in `libs/frontend/chat-streaming`. Only the chat-level resync spec covers it. Nothing pins the equal-timestamp, missing-timestamp or skew behaviour.
- (d) With several `newMessages` of mixed provenance (one with an evicted start event, so `Date.now()` finalize time), a later message can land after the frozen row that the earlier one was inserted before. This is edge, but it is the same hazard.
- Fix: scope the rule to rows that are provably later (for example scan from the tail, or skip when the later row precedes the user prompt that triggered the turn), or pass an explicit `preferTime` flag from the resync owner path only. Add `message-finalization.service.spec.ts` cases for equal, missing and skewed timestamps.

### M3. 675: the anchor branch still appends the owner after earlier frozen rows

- Code: `message-finalization.service.ts:90-104` (unchanged).
- Scenario: after a resync, the user sends a mid-stream follow-up. `recordUserPromptBoundary` adds a user root, so `firstAnchor` is set. `placed = existing.slice(0, anchorIndex)` already contains the later frozen rows `[user-1, user-2, assistant-2]`, and the owner row is pushed after them. The result is `[user-1, user-2, assistant-2, O, prompt]`. This is the original 675 symptom, still reachable when a mid-stream prompt exists.
- Impact: moderate. It needs resync plus a follow-up prompt while the subagent runs.
- Fix: apply the same timestamp insertion to new messages that are not placed by `rootOrder` position. Alternatively, record O's frozen index on the live state.

### M4. 674: an unresolved owner is silently dropped when others resolve

- Code: `session-history-replayer.service.ts:351-366`. Each seed that fails the walk (missing tool, missing start, or root not in `tab.messages`) is skipped with no signal. The warn at :366 fires only when `owners` is empty.
- Impact: with two seeded owners where one is unmaterialized, that tail is applied to a state with no root. It paints nothing, which is the original bug, and nothing is logged.
- Fix: log per unresolved seed (`this.logger.warn(..., { parentToolUseId })`).

## Minor

- `message-finalization.service.ts:50-52` doc says "Without an anchor this is the plain append". That is no longer true (it is now time-ordered). Update it.
- `session-history-replayer.service.ts:394` sorts descending by timestamp, and the sort is stable. On equal timestamps it picks the EARLIEST TodoWrite. `recordLatestTodoWrite` uses `>=`, so the last one wins. Two TodoWrites in one history message commonly share a timestamp. Use a reduce with `>=`, or iterate in insertion order and keep the last.
- `session-history-replayer.service.ts:401-402`: when the old marker does not match, `input` falls back to `latestTodo.toolInput`, which can be `{}`. The original marker code stores an input only when it has keys. Mirror that check.
- `session-history-replayer.service.ts:414`: `currentMessageId: [...owners][0]` is the first owner in SEED order, not the most recent history order. With several owners, `finalizeCurrentMessage` reads `message_complete`/stats for that id. Prefer the last owner in `messageEventIds` order.
- `session-history-replayer.service.ts:416-417`: the row filter is O(messages x starts). Use a Set of the owners' start ids. The file also still has seven `console.warn/error` calls (:540, :688, :773, :801, :811, :871, :913, :938), so the Logger migration is partial.

## Per-bug acceptance check

### 674

- Ancestry walk (`:351-365`):
  - It walks seed parent tool -> tool_start -> its message_start -> that start's `parentToolUseId` -> outer tool, until a start with no parent. This reaches the materialized root for nested Tasks of any depth.
  - A `visited` set stops cycles. A missing link breaks out with no loop.
  - Root ownership requires a `tab.messages` row with `id === start.id`. That is correct, because parented starts have no row.
- Several owners: `owners` is a Set, and the closure loop (:372-386) works from the union.
- Duplicate rendering: the owner row is removed once per owner (:416). It is rendered only from the live state, and the seed appends to that state, so a delta is painted once. OK.
- PARTIAL: the two-owner ordering (M1) and the silent partial drop (M4).
- Spec check:
  - The nested spec asserts the root is absent from `messages`, that the tree has a single root `nested-root-start`, and that the text occurs once. On the old code the owner lookup hit a parented start, so no live state was installed and the root assertion fails. It would fail on the old code.
  - The two-owner spec would fail on the old code, because only the first owner is installed. It does not test order or finalization (M1).

### 675

- The target reproduction is satisfied. `[user-1, O, user-2, assistant-2]` finalizes with O inserted before `user-2`, because O's `message_start` timestamp precedes it. On the old code O was appended, so the spec fails there. The spec uses explicit timestamps, and O appears once.
- Concerns: M2 (shared-path risk, no direct spec) and M3 (anchor branch).
- A-2 (O is the last row): no later frozen row exists, so it appends as before. OK.

### 676

- The recompute takes top-level (`!parentToolUseId`) `TodoWrite` `tool_start` from the FILTERED events and clears the marker when none exists. This matches `recordLatestTodoWrite` except for the timestamp tie-break (Minor).
- It is type-correct: `StreamingState.latestTodoWrite` is `{toolCallId, timestamp, input?: Readonly<Record<string, unknown>>}`. `toolInput` is `Record<string, unknown> | undefined`, and neither `exactOptionalPropertyTypes` nor `noUncheckedIndexedAccess` is set.
- With the marker undefined, `summarizeTodos` falls back to the finalized messages. This is correct.
- Spec check: the `latestTodoWrite` `toBeUndefined()` assertion fails on the old code, which copied the marker. The `summarizeTodos` assertion alone would not discriminate, because the old marker carried `input` from the start event. The "unknown" case (input only in the accumulator) is not exercised.
- Edge: if a TodoWrite exists inside the owner AND in a later frozen row, the retained marker points at the older owner write. This is unlikely.

## Five logic questions

1. Silent failure: M4 (unresolved owner dropped with no log). B1 (the logger change silently alters console output that a spec pins).
2. Unexpected user action: switch workspace, then send a follow-up while the resynced subagent runs. The owner lands after earlier frozen rows (M3).
3. Wrong-answer input: a non-contiguous multi-owner history misorders (M1). Skewed timestamps flip a reply above its prompt (M2a). Equal-timestamp TodoWrites pick the wrong one (Minor).
4. Dependency failure: events missing from the history index (an evicted start) fall back to the append path and `Date.now()`. They are handled, but not tested.
5. Missing: no `message-finalization` unit spec for the new branch. No finalized-order assertion in the two-owner spec. No test of the unmaterialized-root path with partial resolution.

## Verdict

NEEDS_FIXES. Fix B1 before merge, since it is a plain red spec in the touched file. Fix M1 and M3 or record them as accepted limits. Add direct specs for M2. Strict TS and Logger usage are clean in the new code: no `any` and no casts beyond `as const`, and the new warns use `LoggingService`. The partial migration is noted under Minor.
