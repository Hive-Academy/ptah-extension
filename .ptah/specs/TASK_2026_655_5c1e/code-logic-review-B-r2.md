# Code Logic Review — TASK_2026_655 Batch B (host), round 2

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 8/10 |
| Verdict | APPROVED |
| Blocking | 0 |
| Serious | 0 |
| Moderate | 0 |
| Minor (new) | 4 |

Scope: read in full `chat-stream-delivery-coordinator.service.ts`, `live-message-projection.ts`,
`stream-delta-coalescer.ts` (barrier), `session-history-reader.service.ts:205-285`,
`chat-session.service.ts:943-1111`, `history-block-owners.ts`, the consumer rule at
`stream-flush-scheduler.service.ts:48-58`, the new tests, and the unchanged reproduction spec.
No jest/nx was run (reserved for the orchestrator), so the test claims below come from reading
assertions against the old code, not from execution.

Score separation: 8 rather than 9 because the per-rule pending-anchor drops have no direct test and
the `publishTerminal` guard is more conservative than needed (both minor). It is not lower because
every round 1 defect is closed by a mechanism I could trace, and I found no loss or duplication path.

## Round 1 resolution

| # | Round 1 defect | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Resync `toSequence` could equal an already applied number and be dropped by the scheduler | RESOLVED | `coordinator:313` `if (state.resyncRequired) state.lastSequence = ++this.sequence;` runs before `fromSequence`/`toSequence` are read (`:314,:321`). Tail is always empty when `resyncRequired` (`retain` returns at `:287`; `updateViewport` clears at `:210`; overflow clears at `:295`), so `fromSequence == toSequence == F`. Every later publish uses `++this.sequence` (`:137`), so it is greater than F. A non-resync snapshot uses the tail's own sequences (all published after the previous `clearHidden`, so greater than the last applied `toSequence`) or `lastSequence` with `events: []`, which the scheduler may drop at `scheduler:53` with nothing to lose. A recreated state starts at the global counter (`:274`), which is never below an earlier `toSequence` for that tab. Per-tab `appliedSnapshots` (`scheduler:22`) plus a global monotonic counter keeps ordering across tabs. |
| 2 | Post-await delete/clear in `reveal` and `publishTerminal` could destroy hidden state | RESOLVED | `reveal:345-355` deletes only if the state is the same object, the tab is visible, and there is no terminal, resync flag, tail, projection or pending anchor. A hide during the await leaves state intact for the next reveal (test at spec `:377`). `publishTerminal:240-250` clears only if the generation is unchanged and the tab is still visible. No permanent leak: a skipped delete is retried at the next reveal or terminal, and `dispose` (`:254`) always removes it. A skipped delete cannot drop a needed one, because the guard checks everything that would make the state worth keeping. |
| 3 | Opted-in empty or unloaded read lost the owner metadata | RESOLVED | `chat-session.service.ts:1095-1107` always emits `historyBlockOwners` (`{}` when the map is absent) and `historySyntheticToolResults` (`[]`) when `params.historyBlockOwners === true`. `selectDelivered*` return `{}` / `[]` for empty input (`history-block-owners.ts:20,34`). The reader also returns empty collectors on the `!loaded` branch (`reader:249-254`). Non-opted: `collector` is undefined and the spread is `{}`, so the reply shape is unchanged (asserted at `chat-session-history-page.spec.ts:151-153`). |
| 4 | Pending-anchor housekeeping O(anchors x contexts) per publish | RESOLVED | Projection records dropped IDs at the only two removal points: `drop` (`projection:178`) and `clearContexts` (`:183`). Every removal rule routes through them: tool_result (`:69`), message_start replacement (`:73`), message_complete close (`:102`, `:120`), turn_state idle/failed (`:58`), awaiting-background/sleeping close (`:63`), compaction_complete (`:51`). `publish:144-146` drains and deletes only those IDs. The list is drained after every observe and observe is only called from `publish`, so it cannot grow. Behaviour matches the old `hasMessage` sweep because pending anchors only come from live contexts (`buildSeed`). Coordinator-local rules at `:150-159` are unchanged. |
| 5 | Projection suffix ignored the `turn_state` barrier | RESOLVED | `projection:56` calls `context.suffix.barrier()` on every open suffix; `coalescer:117-119` clears `lastByMessage`, so post-turn deltas append as a new entry with their own sequence. The seed is sorted by sequence (`:139`), and the single latest turn_state is spliced in at its own sequence, giving before / turn / after. Only the latest turn_state is kept, which was already so. |
| 6 | State leak for unknown requested tab | RESOLVED | `updateViewport:202-207` stores an unknown hidden request as a marker in `pendingUnknownResyncTabIds` with no `TabDeliveryState`. The marker is consumed by `getState` (`:277`), so a later hidden publish, hidden terminal or reveal gets `resyncRequired` (`:307-308`). It is pruned on the next viewport that neither shows nor requests the tab (`:192-196`) and by `dispose` (`:257`), so it is bounded by the request window. A tab that already has state still gets `resyncRequired` and a tail clear (`:208-211`). |
| 7 | Surface-mode events retained without their flag (pre-existing) | UNCHANGED, as intended | `retain` (`:286`) still drops the flag. Not re-assessed. |

## Test strength (round 1 defects against the old code)

| Defect | Test | Would it fail on old code? |
| --- | --- | --- |
| 1 | spec `:341` and `:365` assert `snapshots[1].toSequence > snapshots[0].toSequence` | Yes. Old code reused `lastSequence` or `this.sequence` unchanged, giving equal numbers. |
| 2 | spec `:377`, `:412` hide and publish a terminal inside a gated send, then assert the second snapshot and the deferred terminal arrive | Yes. Old code deleted or cleared the state after the await, so the second reveal would send no snapshot or terminal. |
| 3 | `chat-session-history-page.spec.ts:139` (reply layer, with a mock read lacking the maps) and `session-history-reader.service.spec.ts:235` | Yes for both: old code omitted the fields. |
| 4 | spec `:448` makes any `hasMessage` call throw | Yes, because the old publish called it. It is a spy on a method that no longer exists, so it only guards against that exact name (see M2). |
| 5 | `live-message-projection.spec.ts:131` expects two separate deltas in order `start, delta, turn_state, delta` | Yes. Old code merged them into `beforeafter`. |
| 6 | spec `:472` asserts `states.has(TAB_ID) === false` after an unknown hidden request, then a resync snapshot after a later publish | Yes. Old code allocated state immediately. |

The reproduction spec `chat-stream-delivery-coordinator.ws-switch-resync.spec.ts` is unmodified (untracked in the
tree, 48 lines, read in full). It still exercises the original path. Note it passes through delta
coalescing, since 257 same-block deltas merge into one tail entry, so it does not hit the overflow resync.
The overflow branch is covered by the existing overflow test in the main spec.

## Defects (new, introduced or left by the fixes)

No Blocking, Serious or Moderate defects. Four Minor items:

### M1. Minor: `publishTerminal` generation guard skips a safe delete

- File: `chat-stream-delivery-coordinator.service.ts:240-250`
- Ordering: tab is visible and a terminal send is in flight. Any viewport update arrives that keeps the tab
  visible (for example a focus change among visible tabs). `generation !== this.viewportGeneration`, so
  `clearHidden` and the empty-state delete are skipped.
- Effect: a small, empty `TabDeliveryState` lingers until the next terminal, reveal or `dispose`. Bounded
  per tab. No content, ordering or duplication effect, because a visible tab has no tail, terminal or
  resync flag.
- Correction: drop the generation condition and rely on `states.get(tabId) === state` plus the visibility check
  (the same guard `reveal` uses).

### M2. Minor: the O(1) anchor housekeeping has no behavioural test per drop rule

- File: `chat-stream-delivery-coordinator.service.spec.ts:448-470`, `:304-324`
- The cost test spies on `hasMessage`, a method the class no longer has, so it also passes vacuously for any
  new scan under another name. The only anchor-cleanup behaviour test (`:304`) is satisfied by the
  coordinator's own message_complete rule (`:154-158`), not by the dropped-ID path.
- Correction: add cases where a pending anchor is cleared by turn_state `idle`, `compaction_complete`, a
  tool_result for a subagent context, and a replacing `message_start`. Assert the next
  `updateViewport` resync does not seed the stale anchor.

### M3. Minor: an aborted reveal can leave a resync-flagged state for a tab that is no longer wanted

- File: `chat-stream-delivery-coordinator.service.ts:208-212`, `:303-306`
- Ordering: a viewport shows unknown tab T and requests a resync for it, so `getState` creates state. The
  reveal returns early at `:303-306` because a newer viewport superseded it and no longer lists T. State for T
  persists with `resyncRequired = true` and no marker pruning.
- Effect: one small object until `dispose` or a later reveal. It is also correct if T streams, since it will
  be revealed with a resync. Tab ids come from the webview and the set is bounded by tab count.
- Correction (optional): when the early return fires and the state is empty, delete it.

### M4. Minor: `compaction_start` barrier not mirrored in the projection suffix

- File: `live-message-projection.ts:54-67` versus `stream-delta-coalescer.ts:88-93`
- The hidden tail barriers on `compaction_start`; the projection suffix does not, so root deltas around a
  `compaction_start` still merge in the seed. No content is lost, because `compaction_complete` clears the
  contexts anyway. The effect is limited to ordering fidelity during a compaction window.
- Correction: if "agree exactly" is a hard requirement, call `suffix.barrier()` for `compaction_start` too.

## Five logic questions (re-check)

1. Silent failure: `send` still swallows a failed snapshot or terminal transport error after
   `clearHidden` (`:338-341`, `:364-373`). Pre-existing and logged. No new silent path.
2. Unexpected user action: workspace switch and return with no new events now produces a fresh sequence, so
   the seed is applied. A hide during an in-flight reveal or terminal no longer destroys state.
3. Wrong answer from input: no case found where a snapshot's `toSequence` is at or below an applied one while
   carrying unseen content.
4. Dependency failure: transport rejection is logged and does not strand the visibility flags.
5. Missing: M2 test coverage; M1 and M3 housekeeping.

## Verdict

- Recommendation: APPROVE
- Confidence: MEDIUM-HIGH (tests not executed by this reviewer)
- Top risk: M2. The anchor-drop rules are only protected by a name-specific spy, so a later change to a drop
  rule could leave a stale anchor, and a stale anchor can inject an anchor-only message later.
- User goal check: no content lost (fresh resync sequence, guarded deletes, owner metadata always present on
  opt-in); none shown twice (seed plus `liveSeedBlocks` dedupe unchanged; resync tail still cleared); old peers
  unaffected (non-negotiated path at `:124-134` and the non-opted reply are unchanged).
