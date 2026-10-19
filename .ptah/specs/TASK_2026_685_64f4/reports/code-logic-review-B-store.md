# Code Logic Review - TASK_2026_685_64f4, phase B-store (B3a/B3b/B4 + 1a79a9a66)

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 6/10 |
| Assessment | NEEDS_REVISION |
| Blocking issues | 0 |
| Serious/Moderate issues | 5 Moderate |
| Minor | 7 |

Scope read in full: `subagent-execution.store.ts` (all 408 lines), the B4 diffs (streaming-handler, history-message-builder, stream-router), `accumulator-core` message_start / skipStoreEffects paths, `EventDeduplicationService` message-start dedup, `session-history-replayer.replayOlderPage`, `subagent-history-page.ts` placeholder code and the cursor guard. Ran `subagent-execution.store.spec.ts`: 14/14 pass (that only proves the paths the spec exercises). Not run: other specs, typecheck.

## Verified correct

- Ownership rules 1-5 (`store.ts:130-152`): root `agent_start` opens the entry and returns false (`:135-144`), so the tab keeps its agent node; nested `agent_start` (owned tool id) is claimed; store-only types are never claimed (`:131`).
- Hot path: `claim()` for an unclaimed event is one `Set.has` plus 2-3 `Map.get`/`has` calls, no allocation. Called once per event (`streaming-handler.service.ts:211`), before tab resolution and fan-out; claimed events return `null`, so no tab state is minted.
- Late events after finalize: `messageOwner`/`toolOwner` survive `finalize` (only `remove` drops them), so a late delta is still claimed. `seedContinuation` (`:190-205`) re-feeds the saved start. The shared dedup is state-based (`findMessageStartEvent(state)`), so the seeded start is not dropped as a duplicate. Seeds are bounded (`:242-243`, 2000 per key) and released in `remove` (`:284-285`).
- Merge steps 1-6: `skipStoreEffects: true` plus a private `EventDeduplicationService` (`:359-360`). Every store call site in the accumulator (`:452`, `:506`, `:550`, `:606-626`) honours the flag. `sessionManager.registerAgent` is also guarded (`:511`).
- Generation abort: checked before each page request (`:319`) and after each await (`:324`, `:340`). A late first response after `clearSession` is ignored.
- Cursor guard (`:337`) works for a repeated cursor and sits after the `done` check, so it cannot fire on the last page. The placeholder fix in `subagent-history-page.ts` does keep the required fields (`blockIndex`, `toolCallId`) for text/thinking/tool_delta/tool_start/tool_result.
- `clearSession` is wired in both stream-router sites (`:296`, `:961`).

## Five logic questions

1. **Silent failure.** `loadHistory` returns `'loaded'` with `truncated=false` after the merge FIFO-evicted most of a snapshot (M4). A claim exception returns false after partial mutation, so the event is processed again by the tab (Minor).
2. **Unexpected user action.** Open a view, close it during an in-flight history RPC, reopen it: the view gets a promise that discards its result and stays `idle` (M2).
3. **Wrong answer from valid data.** A sub-agent message whose `message_start` and later events fall in different replay chunks or pages leaks the later events into the tab state (M3).
4. **Dependency failure.** The RPC rejection, `!isSuccess` and non-ok status paths all end in an explicit state (`:325-331`, `:348-354`). The paging loop has no page cap or cycle guard beyond A-to-A repeats (Minor).
5. **Missing, unmentioned.** Nothing calls `syncRecord` or `retain`/`release`; there are no store specs at real scale (M1).

## Moderate

### M1. Finalization and retention are unreachable in production at this commit
- `syncRecord` has no caller outside the spec (grep over `libs`/`apps`). The only other finalize trigger, `store.ts:170` (`tool_result.toolCallId === key`), is effectively dead. The foreground Task `tool_result` carries the tab's `messageId` and has no `parentToolUseId`, so `claim` returns false for it at `:146-152`. A nested `tool_result` has `toolCallId !== key`.
- Result: no entry ever finalizes, so the 20-entry LRU never engages. Only the 10k spill bounds memory. `live` entries are never evicted, so root `agent_start` entries (`:138`) and `retain()`-created entries (`:256`) live until `clearSession`.
- Fix: wire `syncRecord` from `AgentMonitorStore` record transitions (confirm the following batch does this), and finalize on the root Task `tool_result` in the tab path, or drop `:170`.

### M2. Single flight returns a stale aborted promise
- `ensureHistory` returns `inFlight.get(key)` before any generation check (`:297-298`). `abort()` (`:270-273`, called by `release` to 0, spill and `remove`) bumps `generation` and resets `history` to `'idle'` but leaves the `inFlight` entry in place.
- Scenario: release to 0 while loading, then retain and call `ensureHistory` before the RPC returns (or `clearSession` then a new entry under the same key). The caller awaits the old promise, whose `valid()` is false, so it discards its result. History stays `'idle'` with no error and no retry.
- Fix: in `abort`/`remove`, `inFlight.delete(key)` (and `ensureHistory` should compare the in-flight entry/generation). Add a spec for abort-then-retry during an in-flight RPC.

### M3. History replay claim set is per `accumulate()` call
- `history-message-builder.service.ts:134-146`: `subagentMessageIds` is a local `Set` created on every call. `replayOlderPage` calls `accumulate` once per `REPLAY_CHUNK_SIZE` chunk (`session-history-replayer.service.ts:523`), and pages are separate calls.
- A sub-agent message whose `message_start` is in an earlier chunk or page has its remaining events accumulated into the tab `state`. They are orphans, so the tree is mostly unaffected, but the tab state is polluted and `historyEventsSeen` and the scratch run are skipped for them. This is inconsistent with the live `claim`, which keeps ownership across events.
- Fix: keep the id set across chunks (pass it in or hold it on the page state), and treat events whose `parentToolUseId` is set as sub-agent-owned as well.
- Also: the spec mocks the tree builder (batch-B4.md:26), so no test asserts that the restored tree has agent nodes without sub-agent children.

### M4. Silent truncation in the history merge
- Backend tail is `SUBAGENT_EVENTS_TAIL_LIMIT = 10_000` (`session-history-reader.service.ts:129`), but `merge` builds `fresh` with `eventCap = 2000` (`:358`). With a larger snapshot the oldest events, including `message_start`s, are FIFO-evicted with no `truncated` flag. The `evictsEvent` check exists only in `claim` (`:161-167`).
- `snapshot` is also accumulated unbounded across pages (`:333`), so about 8000 events are downloaded and held for nothing.
- Fix: stop paging at the entry cap (or keep only the tail), set `entry.truncated` when `fresh.events.size` hit the cap, and show clipped state.

### M5. Spec gaps the lanes admitted still hide behaviour
- No full-size 10k spill or 4k owner-cap test (batch-B3b.md:37). Owner eviction (`:110-118`) drops only the oldest composite from the maps, so a late event for an evicted message in a nested/unparented stream falls through to the tab.
- Missing abort variants: abort during page two, release-then-retry, spill mid-load. These are exactly the M2 hole.

## Minor

- `store.ts:68-71`: `publish` copies the whole entries map twice per claimed event (via `onStateChanged` and `:172`). Fine at current sizes, but O(entries) per delta. `enforceLiveCap` `count()` (`:285`) and `evictFinalized` are also O(entries) per event.
- `:287`: spill candidates include entries with no state (`!e.spilled`). They get marked `spilled=true` (UI "Earlier output trimmed") though they never had output. Exclude `state === null`.
- `:337`: the guard detects only an immediate repeat. A cursor cycle A-B-A, or a very long agent, is unbounded. Add a page limit.
- `:175`: fail-open leaves a half-processed event that the tab then processes too. Acceptable per plan, but the owner and state mutation is not rolled back.
- Merge when `entry.finalized` is non-empty and a live state exists (`:371-389`) keeps `finalized` and adds the full snapshot, so messages can appear twice. Same for `:392`.
- `history-message-builder.service.ts`: the dormant `backfillAgentStartToolId` (`accumulator-core:292`, hook-sourced UUID `agent_start`) no longer runs for claimed sub-agent `message_start`s. No backend path emits `source: 'hook'` today, so no live impact. Also, a UUID-keyed root `agent_start` would open an entry under the wrong key (`:138`).
- `subagent-history-page.ts` default placeholder case turns any oversized non-delta event (e.g. `agent_start`) into a `text_delta`. Very unlikely at 96 KB.

## Data flow (live)
event -> `processStreamEvent` -> `claim` (OK, O(1)) -> own ids -> `accumulator.process(entry.state)` -> publish (OK) -> `finalize` only via `syncRecord` (GAP, M1) -> LRU eviction (inert).
History: `ensureHistory` -> pages (OK, no cap, M4) -> `merge` -> commit (M4 truncation) -> `enforceLiveCap`.

## Verdict
- Recommendation: REVISE (score 6/10).
- Top risk: finalization and retention are not wired (M1), and the stale single-flight promise (M2) makes history loading silently unreliable.
- Robust version would add: inFlight cleanup on abort, a chunk-persistent claim set, a cap on paged history, `truncated` from the merge, a real-tree history spec, and full-size spill/owner-cap specs.
