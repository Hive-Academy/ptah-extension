# Code Logic Review F2 — TASK_2026_655 (webview services)

Reviewer: code-logic-reviewer (Claude family; implementer was codex). Read-only. No jest or nx was run.

Scope read in full:

- `libs/frontend/chat/src/lib/services/chat-store/session-history-replayer.service.ts` (805 lines)
- `libs/frontend/chat/src/lib/services/chat-store/session-liveness-reconciler.service.ts`
- `libs/frontend/chat/src/lib/services/stream-viewport-controller.service.ts`
- the three diffs against their specs, and the replayer spec's new `snapshot seed and persisted delivery` block (`session-history-replayer.service.spec.ts:771-1203`)
- `persisted-content-filter.ts:1-260` (to check API use only) and `history-tool-result-patch.ts`
- `message-finalization.service.ts:281-303` (finalize is synchronous)
- spec chunks: plan 805-923, 924-987; addendum 184-330, 411-470, 1202-1297, 1443-1514

## Verdict

| Metric | Value |
| --- | --- |
| Score | 7/10 (sound, with real but bounded gaps) |
| Verdict | APPROVED, with two Moderate hardening items (D1, D2) recommended before merge |
| Blocking | 0 |
| Serious | 0 |
| Moderate | 3 (D1, D2, D3) |
| Minor | 2 (D4, D5) |

Why 7 and not 8-9. The ordering core (seed, then ordered drain, RA-2 hand-over, reservation, overflow record, arrival mark) matches the spec and I could not construct a lost-or-duplicated-content trace through it. What holds the score down:

- Every call into `PersistedContentFilter` fails closed. A throw loses content or strands a fence.
- A filter has no deterministic retirement path for closed tabs and idle sessions.
- Many seed-specific variants the plan lists have no test.

## Defects

### D1. Moderate: filter registration can strand the fence

`session-history-replayer.service.ts:673` (`registerPersistedFilter`) runs outside the `try/catch` that starts at `:676`. It also runs before `heldFences.delete` (`:695`) and `leaveFence` (`:696`).

Exact ordering today:

1. `closeFence` starts.
2. `registerPersistedFilter` throws. Possible causes: a malformed seed event in the `for` at `:708-716`, or a throwing filter constructor.
3. The throw leaves `closeFence`. `heldFences` and the fence holder are never cleaned up.
4. `replay()` rethrows to the loader.
5. The loader's `finally` calls `release`, which calls `closeFence` again and throws again at the same line. `claims.delete` (`:231-233`) never runs.

Result: the fence stays open for the session. Live events buffer until the 2000 bound, then bypass. The tab's claim is never released, so the tab is stuck as claimed.

Correction. Put `registerPersistedFilter` inside its own `try/catch` that logs with `console.error` and continues (no filter means the seed and live events are unfiltered, so duplicates but no loss). Do this before `seeds.delete`. `heldFences.delete` and `leaveFence` must run on every path. A `try/finally` around the whole body after the guard is the simplest form.

### D2. Moderate: a throwing filter call drops content (fail-closed)

Three sites:

1. Seed path. `:680-689` computes `kept` inside the same `try` as `seed.apply`. If `filter.decide` throws for one seed event, the `catch` at `:691` logs and skips `apply` for the whole seed. The whole in-flight message is lost, which is the original bug. Correction: wrap `decide` per event and keep the event on error. Alternatively, on a throw, fall back to `seed.apply(seed.events)`. Retire the filter with `retire(false)` so held content is released.
2. Buffered path. `deliverOne` (`:772-781`) calls `exclusions()` (which calls `decide`) inside its `try`. A `decide` throw jumps to the `catch`, so `entry.deliver()` is never called. The live event is dropped for every tab, siblings included. Correction: catch inside `exclusions` around `decide`. On error, retire the filter (`retire(false)`), delete it from the map, treat the decision as `keep`, and log once.
3. After-close path. `deliverAfterClose` (`:611-620`) has no guard. A `decide` throw propagates into `deferLiveEvent`'s caller and the event is never delivered. Same correction as (2).

Trigger today is only a filter bug. The cost is exactly the user's stated failure, lost streamed content. The fix is a few lines.

### D3. Moderate: filters are retired only lazily, and can outlive their purpose

Retirement paths that exist:

- terminal `turn_state` and `compaction_complete` (`:798-801`)
- a new claim for the tab (`:196`)
- `retirePersistedFilter` for F3 to call at resync arrival (`:269`)
- tab binding mismatch, checked only inside `exclusions` (`:789-794`)

Gaps:

- **Tab closed or rebound with no later event for that session.** `exclusions` skips filters whose `sessionId` differs from the event's (`:788`) and runs only when an event arrives. A resynced tab that is then closed leaves its `PersistedContentFilter` (the `history` map, `historyToolResults`, `seedBlockKeys`, held queues) in `persistedFilters` for the life of the webview. The leak grows by one filter per closed or rebound resynced tab. It is bounded per tab but not over a long session.
- **Idle session.** A resync or compaction reload of an idle session (empty seed) registers a filter (`:673`, condition `:702-703` passes whenever `prefixMark !== null`). It stays until some later turn's terminal. During that whole next turn every `chat:chunk` for the session goes through `exclusions` and `decide`, with D2's failure exposure.
- **Registration with no live turn.** The plan's "Lifetime" section defines the lazy discard as the only tab-close path. It does not say a filter must survive a seed whose turn state is terminal. A seed `turn_state` is never passed to `decide` (`:683`), so it cannot retire the filter.

Correction.

1. When `closeFence` builds a filter and the seed's last `turn_state` (or the snapshot status) is terminal or absent, do not register one. Alternatively, expose `retirePersistedFilter` to the tab-close/rebind hook that already exists in the chat store. (I did not find one wired in this batch, so call it out to F3.)
2. At minimum, sweep `persistedFilters` for tabs that no longer resolve whenever `registerPersistedFilter` runs. The cost is O(filters), a handful.

### D4. Minor: inconsistent session key when filtering overflow deliveries

`leaveFence` filters with `held.sessionId` (`:750`). `deliverAll` filters with `entry.event.sessionId` (`:768`). Both overflow paths use `deliverAll`: `:604` and `:757`. `exclusions` matches `filter.sessionId === sessionId` (`:788`).

If an event's own `sessionId` differs from the fence's key, which is possible when it was matched through the tab's held fence (`findFence :628-629`), the filter is skipped on the overflow drain only. That produces a possible duplicate, never a loss.

Correction: `deliverAll(deliveries, sessionId)` should pass `fence.sessionId` through.

### D5. Minor: spurious warning, and the filter never learns a no-op reconcile succeeded

`reconcileHistoryToolResult` (`:730-740`) warns and returns `false` when `patchHistoryToolResult` returns the same array. That happens when the history node already carries exactly the live result's fields, for example a synthetic-flagged result that happens to equal the live one. The filter then does not update its `toolResults` entry (`persisted-content-filter.ts:145-149`). Each later identical result repeats the warn. No data harm. Treat an unchanged-but-present node as success, or downgrade the log.

## Checks asked for, and what I found

| Check | Result |
| --- | --- |
| Seed once, only when claim is current and tab still bound | Correct. `closeFence :669-693`. `valid` needs `isCurrent` and `tab.claudeSessionId === held.sessionId` when a seed or inputs exist. The seed is deleted before apply (`:674`), so `replay` plus `release` cannot run it twice (the second `closeFence` returns at `:668`). The guard is side-effect free and does not reuse `canContinueReplay`. |
| Buffered events drained in order after the seed | Correct. `leaveFence` runs after the seed (`:695-696`), in array order. |
| Seed error isolation | Correct for `apply` (`:691-693`). See D2 for the filter part of the same `try`. |
| Supersession (D-5) | Correct. `claim` deletes the previous seed, inputs and index (`:189-195`). A superseded claim never reaches the seed branch (`:668`). `retirePersistedFilter` runs for the tab on every claim (`:196`). |
| Reservation (D-9) | Correct. `reserveFence :237-244` adds a holder with `++claimCounter` and touches neither `claims` nor `heldFences`, so `isCurrent` is unchanged. It is idempotent via `released` (`:247-252`). It is structurally a `HeldFence`, so `leaveFence` accepts it. |
| `overflowedDuring` | Correct. Flagged for every present holder at the bound (`:603`), at join (`openFence :645`, `reserveFence :242`) and at hand-over overflow (`:756`). It is cleared only by `release` or `releaseReservation`, so it survives `closeFence` (the loader reads it before releasing). |
| RA-2 hand-over | Correct. Per-entry delivery, then a check for a new fence for the session (`:749-762`). Whole entries move to the head, so `arrival` survives. The bound is `moved + next.buffered > LIMIT`, which equals the `>= LIMIT` check applied to the combined array. On overflow, the order is moved entries first, then the receiving fence's own entries (`:757`). The claim that opened mid-drain is flagged at `:756`. The `claim` made during drain is flagged at join if the fence had already overflowed. |
| RA-2 bound counting | Matches addendum 239-249. A hand-over to exactly 2000 moves. The next buffered event then trips the normal bound. |
| `arrivalCounter` and `prefixMark` | Correct. `arrival: this.arrivalCounter++` (`:607`), `liveArrivalMark()` returns the next value, so `arrival < mark` is exactly "buffered before the mark". Events delivered unfenced get no arrival and are treated as post-snapshot by `decide`. The event that trips the bound has no arrival either, which is right: it is the newest. |
| H, `historyToolResults`, `historyToolIds` | Built only from events `replay` passed to `processStreamEvent` (`:307-318`, `indexHistoryEvent :335-359`). Identity lookup in `ownerByEvent`. `tool_start` adds to `toolIds` regardless of owner. A missing or `null` `syntheticResults` makes every history result synthetic (`:356`). |
| Filter built and registered before the seed | Yes. `:673` precedes `:675`. The seed reads `persistedFilters.get(tabId)` after registration (`:679`). |
| Seed through the filter | Correct against addendum 1226-1234 and rule O (`:1066-1068`). The plan says a `tool_result` is not "message-scoped" for this purpose, and the code exempts it plus `turn_state`, `compaction_*`, `background_*` and user `message_start` (`:682-685`). Only seed messages in `liveSeedBlocks` are filtered. |
| Filter inputs to the constructor | `seedMessageIds`, `seedBlockKeys` and `seedStartK` come from the seed and match the filter's `blockKey` format (`persisted-content-filter.ts:56-63`). `deliverToTab` is `processStreamEvent(..., { fanOut: false })` without `isReplay`, as specified. No misuse of the filter API found. |
| `deliver(excludeTabIds)`, only this tab excluded | Correct. `exclusions` adds only the deciding tab's id (`:797`). Siblings with no filter are never excluded. `deliverAfterClose` returns `true` after calling `deliver` when a filter was consulted (needed: `decide` is stateful and must not be called twice for one event). |
| Retirement on every path | Terminal and `compaction_complete`: yes. New claim: yes. Resync arrival: API present (`retirePersistedFilter`), caller is F3. Tab close or rebind: lazy only (D3). Overflowed claim builds no filter (`:673`). |
| No leaked filters | Not fully (D3). |
| Reconcile via `patchHistoryToolResult` and `tabManager.setMessages` | Correct for a background-workspace tab. It reads with `findTabByIdAcrossWorkspaces` at call time and writes `setMessages` (`:731-739`). `finalizeSessionHistory` is synchronous (`message-finalization.service.ts:285-300`), so the history node exists before the first live `tool_result`. |
| `SessionLivenessReconcilerService.reconcileTab` | Matches plan 9. It reuses `probe` with `ordered: false`. `TurnStateApplier.apply` itself checks the tab's session against the event's, so a rebinding during the RPC is safe. |
| `StreamViewportController.requestStreamResync` | Matches plan 10. No-op before v2 accepted. It sends immediately, uses `currentViewport ?? deriveViewport()`, records `declaredViewport`, leaves `declarationGeneration` alone, and catches and warns without ids. A pending debounced identical declaration is skipped by the existing `sameViewport` check. |

## Missing tests (each would fail on a plausible wrong implementation)

Replayer, from the plan's verification seam (plan 853-871):

1. A superseded claim's seed never runs. Claim A with seed, claim B on the same tab, release A, replay B. Assert A's `apply` was never called.
2. A rebound or closed tab skips the seed (change `tabs[0].claudeSessionId` before `replay`/`release`; assert `apply` not called and the buffer still delivered).
3. The seed runs on `release` after `replay` throws (`finalizeSessionHistory` throwing), and a throwing `apply` is isolated: `console.error` is called and buffered events are still delivered.
4. A reservation keeps the buffer closed across another claim's close, with real assertions. `keeps a reservation across another claim and records overflow for joined holders` (`:811-828`) never asserts buffer state. `R-B2c` (`:887-905`) covers part of it. Also missing: `releaseReservation` with no claim ever made delivers at once; `releaseReservation` after a claim joined does not close the fence.
5. The overflow hand-over branch (`:754-757`), which the F2 report admits is untested. Assert order (moved entries first), the `overflowedDuring` flag on the new claim, and a later event bypassing.
6. Retirement. A new `claim` releases held content through `processStreamEvent` and clears the filter; a stale tab (closed or rebound) is discarded with `retire(true)` and its held content is not delivered; `compaction_complete` retires. Only the terminal case is tested (`:830-847`).
7. Pending-update ordering inside `claim`: `clearPendingUpdates` is called before the old filter releases (decision recorded in the F2 report). No test pins it.
8. An overflowed claim (`overflowedDuring`) builds no filter even with inputs set.
9. Two tabs with the same session, one with a filter and one without. Assert only the filtered tab is in `excludeTabIds` and the sibling's `deliver` still receives the event. No test uses two tabs against filters today.
10. Failure-injection tests for D1 and D2 once fixed: a throwing `decide` (mock the filter) still delivers the event and still applies the seed.

Viewport spec: `requests one immediate resync...` (`stream-viewport-controller.service.spec.ts:80-97`) does not discriminate the "records declaredViewport" requirement. The viewport has not changed between declare and request, so the later `advanceTimersByTime` is a no-op even if `declaredViewport` were never assigned. Add: change the active tab, then call `requestStreamResync` before the 50 ms debounce fires, advance 50 ms, and assert exactly one RPC.

Reconciler spec: the new test asserts that one RPC and one apply happen for the passed tab. The plan's seam ("applies a `generating` answer to that tab only") would additionally want a second tab present, so a wrong implementation that probes all tabs fails. Add a second restored tab to make the test discriminating.

## Notes

- **Seed on an aborted overflowed claim.** In the D-10 path where the loader aborts before the reset, `release` still reaches `closeFence`, and `closeFence` applies the seed (the guards are only `isCurrent` and the tab binding, exactly as the plan states). That applies seed events on top of the unreset tab. The follow-up fresh resync repairs the state, so this is transient, not a loss. If F3 wants to avoid the flash, the loader can `setPersistedFilterInputs`-style signal or skip claim seeds on abort; this is a loader decision, not a replayer defect.
- F3 is not wired in this tree. None of `retirePersistedFilter`, `reserveFence`, `overflowedDuring`, `liveArrivalMark`, `setPersistedFilterInputs`, `requestStreamResync` or `reconcileTab` has a non-spec caller outside the replayer yet. Runtime behaviour of this batch is therefore unproven end to end. The F2 reports also state that no jest, typecheck or lint result exists for this batch.
- The inner loop variable `index` at `session-history-replayer.service.ts:309` shadows the outer `index: HistoryIndex` at `:296`. It is correct today because `indexHistoryEvent` looks the index up by claim number. It is a trap for the next editor (style, not logic).
