# Code Logic Review — Batch F3 (webview caller wiring) — `TASK_2026_655`

Reviewer: code-logic-reviewer (Claude family). Read-only. No jest/nx run. Files read in full or
in the relevant ranges: `session-loader.service.ts` (helpers `:113-176`, `switchSession`
`:828-970`), `chat-message-handler.service.ts` (`:513-610`), `chat.store.ts` diff,
`compaction-lifecycle.service.ts` (`:536-585`, `:655-736`), the three spec diffs, and
`streaming-handler.service.ts:190-340` for the fan-out rule.

## Verdict

- Score: 6/10
- Recommendation: REVISE (1 Serious, 1 Moderate, 2 Minor, test gaps)
- Confidence: HIGH on the Serious defect (HEAD vs working copy compared line by line).

Why not higher: one A.6 preserve-list item that the addendum marks "must hold" is reversed.
Why not lower: the synchronous claim sites, generation/recency guards, reservation release,
owner/synthetic validation, filter-input ordering, overflow requests, RA-1/3/4/5 conditions and
the handler fan-out all match the spec; I could not break them.

## Defects

### 1. SERIOUS — registry entry is deleted AFTER the claim is released (A.5 / A.6 "must hold" reversed)

- File: `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts:942-945`
  (HEAD had `this._inFlightSessions.delete(loadKey); this.historyReplayer.release(replayClaim);`).
- Current ordering in `finally`: reservation release, `historyReplayer.release(replayClaim)`
  (`:942`), then registry delete (`:943-945`), then `inFlight.resolve()` (`:946`).
- Spec: addendum A.5 "Registry order in `finally` (must hold). For compaction and plain loads,
  delete the registry entry before releasing the claim, as today. Otherwise a
  `compaction_complete` drained by that release is skipped as a duplicate, and the compaction
  reload is lost." A.6 lists it again ("Registry deleted before the claim is released in
  `finally` (non-resync calls)"). Only the resync path takes the plan's order
  (reservation, claim, registry).
- Failure: a compaction (or plain targeted) reload buffers every live chunk from arrival
  (RA-1 makes this the normal case). If a second `compaction_complete` is in that buffer, the
  release at `:942` drains it synchronously, the lifecycle calls `switchSession(compaction)` for
  the same `loadKey`, `:845` finds the entry still registered and skips it
  (`{staleSnapshot:false}`), and that compaction reload never happens. Silent loss of a
  compaction reload; the tab keeps the stale two-stub state.
- Secondary: if `release` ever throws, the entry is never deleted and `inFlight.resolve()` is
  never reached, so the key is stuck and any waiting resync (`await current.settled`,
  `:885`) hangs. HEAD's order was immune to that.
- Correction, exact order in `finally`:
  1. resync only: release reservation (as now);
  2. non-resync: `if (inFlight && this._inFlightSessions.get(loadKey) === inFlight) this._inFlightSessions.delete(loadKey);`
     then `this.historyReplayer.release(replayClaim)`;
  3. resync: `release(replayClaim)` then owner-checked delete (plan order, unchanged);
  4. both: `inFlight?.resolve()` after both, then the `latestResync` / flag logic.
  Keep `claimOverflowed` / `currentAtEnd` reads before `release`, as now.

### 2. MODERATE — `compactionResyncTabs` is read at arrival and cleared by any resync, so the post-compaction gauge seed can be lost

- File: `session-loader.service.ts:842-843` (read), `:952` (delete), `:960` (add), `:1051-1053` (use).
- Spec (A.2 RA-5): "The next resync reload of that tab passes `preserveCompactionContextSeed: true`
  and removes the entry in its `finally`."
- Failure A: a resync R_w is waiting behind a delayed compaction C (D-9 reservation). R_w computed
  `preserveCompactionContextSeed = false` at arrival (`:842`). C finishes and adds the tab
  (`:960`); R_w wakes before the follow-up resync R_new has arrived and runs to its `finally`,
  where `:952` deletes the entry. R_new (arrival after the RPC round trip) then reads `false`, and
  `applyResumeStats` overwrites the post-compaction gauge with the history snapshot, which
  `:1051-1053` exists to prevent.
- Failure B: R1 consumes the entry, overflows (D-10) and requests R2; R2 reads `false`.
  The spec's literal wording allows this, but the same gauge regression follows.
- Correction: evaluate the flag where it is used, not at arrival, e.g.
  `const preserve = preserveCompactionContextSeed || this.compactionResyncTabs.has(targetTabId)` at
  `:1049`, and delete the entry only on the path that actually applied stats (or on non-stale
  completion), not in the unconditional `finally` of a call that returned early as stale
  (`:880`, `:888`, `:916`). When a resync requests a fresh resync (`:958-961`) and
  `preserveCompactionContextSeed` was true, re-add the tab.

### 3. MINOR — seed event elements are never shape-checked, and the loader dereferences them inside `finally`

- Files: `chat-message-handler.service.ts:593-595` (only `Array.isArray`),
  `session-loader.service.ts:966` (`opts?.liveSeed?.events.some((event) => event.eventType === ...)`).
- A `null`/non-object element in `liveSeed` throws a `TypeError` from the `finally`. That replaces
  the call's result or error, and skips the `reconcileTab` call that follows it at `:967`.
  The host is trusted IPC, so likelihood is low, but this is the one boundary the batch declares
  hand-validated.
- Correction: in `parseStreamSnapshot` require `liveSeed.every(e => e !== null && typeof e === 'object' && typeof (e as {eventType?: unknown}).eventType === 'string')`
  (drop the snapshot, as for a non-array), or use `event?.eventType` at `:966`.

### 4. MINOR — `session:load` failure after an early resync claim applies the seed onto an un-reset tab

- File: `session-loader.service.ts:924-930` (throw), `:942` (release applies seed + buffered events).
- On a resync the tab has not been reset at this point (reset is `:960`), and
  `cleanupSessionDeduplication` has not run (`:976`). The release applies the snapshot seed
  (including the in-flight `message_start`) on top of the pre-resync state, which already holds
  part of that message. The plan accepts "tab shows the live message even when history failed"
  for `chat:resume` failure (reset already done), but not explicitly for this earlier throw.
  User-visible risk: duplicated streamed content in a failure path.
- Correction (choose one): on `!loadResult.success` for a resync, discard the seed without applying
  it (a replayer release variant that drops the seed), or reset the tab before releasing.
  If left as is, record it as an accepted trade-off in the plan.

## Checked and found correct (no action)

- Sync before first await: no-wait resync, resync-takes-over-resync and RA-1 compaction all reach
  `claim` (`:895-899`) with no await in between. `prefixMark`, `retirePersistedFilter`,
  `latestResync.set` are at `:838-841`, before any await.
- Reservation is the first statement inside the `try` (`:874-877`); released at claim join
  (`:900-904`) and in `finally` (`:935-938`); the stale-return, tab-closed throw and wait-loop
  exits all release it.
- Recency: checked at every loop turn (`:879`), after the loop (`:887`) and via
  `isCurrent` after `session:load` (`:915`) and after `chat:resume` (`:1008`); stale calls write
  nothing and do not request resyncs (`latestAtEnd && currentAtEnd`, `:958-959`).
- Overflow: before reset returns without reset or `chat:resume` (`:918-922`); after reset
  requests a fresh resync in `finally`; RA-3 requires `reachedCompactionReset` and `currentAtEnd`
  (`:954-957`); one shared `freshResyncNeeded`, one request per call.
- `historyBlockOwners` and synthetic validation (`:127-176`): plain-object prototype, decimal
  in-range keys, non-empty string values, distinct in-range indices naming `tool_result`; any
  malformed entry returns `null` (not partial). Converted to event-object keys against the same
  `events` array passed to `replay`. `setPersistedFilterInputs` precedes `replay` (`:1067-1076`).
  `prefixMark` is non-null only for a resync with a `liveSeed` object; compaction passes null.
- `historyBlockOwners: true` is sent only when a claim exists for resync or compaction (`:984-986`).
- RA-5 marker is set only at the three delayed sites; the in-order site stays unmarked
  (`compaction-lifecycle.service.ts:562`, `:703`, `:727`). No other compaction behaviour changed.
  The resync reason can never trigger RA-3/RA-5 (`opts.reason === 'compaction'` gates both).
- RA-4 probe condition (`:963-968`): compaction reset, stale snapshot or fresh resync; resync
  probe only without a `turn_state` seed event and without a fresh-resync request.
- Handler: `deliver(excludeTabIds)` excludes only listed tab ids, applies to every active tab bound
  to the session with `{ fanOut: false }`, routes once; empty/undefined set keeps the old path
  (`chat-message-handler.service.ts:518-530`). The tab set matches the streaming handler's
  active-tab fan-out (`streaming-handler.service.ts:314-330`). Snapshot parser: `liveSeed`
  non-array or without `resyncRequired` drops the snapshot; malformed `liveSeedBlocks` warns and
  is treated as absent while keeping the snapshot. Seed `apply` applies exactly the given list.
- `ChatStore.resyncStream` now catches and warns; `processStreamEvent` and
  `deferLiveStreamEvent` pass the new `options` / `deliver` type through unchanged otherwise.
- Preserve list: all items intact except the registry/release order in Defect 1 (compacted
  transcript stays visible, stale-snapshot containment, `hasLiveSession` bypass, duplicate
  compaction skip before the early claim, `requireTargetTab` re-check, `clearPendingUpdates`
  position, post-compaction context seed on in-order compaction, lifecycle retry/late-boundary).

## Missing tests

1. A test that fails on Defect 1: a compaction reload whose buffer contains a
   `compaction_complete` closure that calls `switchSession(compaction)` for the same tab; assert
   the second call is not skipped (spy on rpc `session:load` count, or on `switchSession`'s
   result). The current suite would still pass with the reversed order.
2. Resync seedless status probe: no test asserts `reconcileTab` is called for a resync without a
   seed, nor that it is NOT called when the seed has a `turn_state` event or when a fresh resync
   was requested (the report admits this one is open).
3. RA-4 stale branch: a compaction returning `staleSnapshot: true` must call `reconcileTab` and
   must not call `requestStreamResync`.
4. Resync overflow before the reset: assert no `chat:resume` is sent, no reset, one
   `requestStreamResync`, and no probe. Also resync overflow after the reset (during
   `chat:resume`/replay): one `requestStreamResync`, completed replay.
5. Stale call exit paths: an older resync waiting behind a compaction that is superseded by a newer
   one releases its reservation (assert `deferLiveEvent` buffering stops / buffer delivers once),
   and a tab closed during the wait releases the reservation and delivers buffered chunks.
6. `compactionResyncTabs`: nothing asserts `preserveCompactionContextSeed` reaches
   `applyResumeStats` for the follow-up resync, that the entry is cleared, or Defect 2's
   interleavings. R-A2 passes `stats: null`, so the gauge path is not exercised.
7. RA-5 negative: an in-order compaction (no `compactionDelayed`) that reaches its reset with no
   overflow must NOT call `requestStreamResync`; a delayed compaction that returns stale must not
   either.
8. Handler: a snapshot with only `liveSeedBlocks` (no `liveSeed`) passes `events: []`; non-plain
   object, array and empty-key `liveSeedBlocks` variants; `liveSeedBlocks` on a non-resync
   snapshot. The one existing malformed case (`{ message: -1 }`) covers only the count branch.
9. Handler exclusion: a case where every bound tab is excluded (no `processStreamEvent`, one
   `routeStreamEvent`) and a case where `sessionId` is omitted and `event.sessionId` is used.
10. R-A2 and R-A1 would fail on the wrong implementation (claim after `session:load`, or no
    `compactionDelayed`), so they are adequate for those two rules; the "newest waiting resync"
    test would fail if recency were dropped. The malformed-owner test only covers the combined
    case; add one case per field so each validator branch can fail on its own.

## Notes

- Resync `finally` keeps the plan's order (claim release, then registry delete). A compaction
  closure drained by a resync's release is therefore skipped by D-9. That is the specified
  behaviour; the follow-up probe or a later compaction covers it. Not a defect.
- `ChatStore.resyncStream` returns silently when `TabId`/`SessionId.safeParse` fails
  (`chat.store.ts:228-230`), which now also discards a carried seed. This predates the batch and
  matches the old seedless behaviour.
- `git diff` of the loader spec warns of CRLF in the working copy; normalise line endings before
  commit to avoid a whole-file diff.
- No source or spec files were edited and no checks were run.
