# Implementation Plan Addendum - TASK_2026_655

Residual fixes for open questions 2 and 3 of `implementation-plan.md`.
User decision: fix both in this task. The approved plan stays in force; this addendum only adds
to it. Where this addendum changes a plan component or decision, it says so explicitly.

## Revision 1

Answers `implementation-plan-addendum-review.md` (verdict REVISE). Residual B was redesigned.
The count design (per-message record counts, `liveSeedBatches`, `producesCompleteBatch`,
`persisted-block-counts.ts`, the projection counter) is removed.

| Review defect | Resolution |
| --- | --- |
| 1. Block count is not a proven identity | A live block is dropped only after a runtime check: same API `message.id`, same position in that message's block sequence, and an exact signature match (tool: `toolCallId`; text/thinking: the full string). The host sends, per block event of the delivered page, the API `message.id` of its JSONL record. The webview builds the history signatures from the events it replayed. First mismatch: the message passes through (B.2, B.2.3 a). Stream deltas of a block that may be persisted are held until its complete block event decides. A stream event that cannot belong to the persisted block (other tool id, other kind, text not a prefix) releases at once. Bounds: 2000 events, a 5 s timer, release on retirement (B.2.3 a, "Holds"). |
| 2. Subagent counts include unrendered records | Coverage comes only from events present in the delivered `events`. Orphan agents and thinking-only agent records emit no event (`session-replay.service.ts:481-559`), so they have no entry. Live subagent thinking is outside the compared sequence and is never dropped. Tests R-B5, R-B6 and the `agent-sdk` seams. |
| 3. Page edge drops visible content | The host sends owners only for messages whose every block event of the full replay is in the delivered page (B.2.2). A message cut by the page edge has no entry and passes through. Option (a) "accept" is withdrawn. Test R-B4. |
| 4. Filter retires too early | `finished()` is removed. The filter retires only at a terminal `turn_state` or `compaction_complete` that reaches it from the buffer or the live stream, at a new claim or resync arrival for its tab, or when the tab closes or rebinds. Memory is bounded by the delivered page and the hold bound (B.2.3 b). Test R-B3 (first observed after fence close). |
| 5. `liveSeedBatches` cap has no producer bound | `liveSeedBatches` is removed with the count design. RB adds nothing to the snapshot payload or schema. |
| RA-2 bound (decision note) | RA-2 now states that moved entries count against the receiving fence's 2000 bound and reuses the overflow path when the combined buffer would exceed it. |
| Prefix rule depended on A-1 (review audit, B.9 of the first draft) | The window (ii) rule now drops only pre-snapshot stream events of a block the seed itself holds (same message, same block key). It no longer drops complete batches by time (B.2.3 a, rule P). |

Weaker guarantee, stated plainly: a seeded message whose stream start preceded the claim is not
filtered by signature (its position is unknown), so its block persisted in the snapshot-to-read
gap can still show twice. B.10 point 1 gives the option to close it.

## Revision 2

Answers `implementation-plan-addendum-review.md` round 2, defects 1-3 (Residual B only).

| Review defect | Resolution |
| --- | --- |
| 1. Synthetic tool result drops the real result | The host marks synthetic replay results (`historySyntheticToolResults`, :824-829; collector :862-865; helper :880-884). Rule T drops a live result only when the history result is persisted and its output and `isError` are equal; otherwise it keeps the live result (completion signal) and patches the history tool node with the real output, error flag and status through `setMessages`, following the `markAgentsAsInterruptedByToolCallIds` precedent (rule T :972-1001; "Reconcile" :1131-1161; loader validation in (d) :1208+; absent list = all synthetic). Where the result renders and where the history node lives is now verified (B.10 point 6, :1743). Rejected options :1277-1295. Tests: R-B7 (:1511-1542), synthetic then real with changed output and `isError: true`, plus variants. Decision RB-6. |
| 2. Seeded messages still duplicate | B.10 point 1 option (b), with no cap and no omission path: the projection counts each context's complete blocks; every resync snapshot carries `liveSeedBlocks` (contract :830-848; projection and coordinator :892-920). The webview tracks seeded and deferred-anchor messages from `k0` (rule I :1008-1015), passes their seed events through the filter ("Seed through the filter" :1122-1130), and verifies pre-snapshot complete copies (rule P2 :961-971). B.2 scope :763-772, B.4 :1306-1321, B.5 seed and D-8 :1365-1376, B.10 points 1 and 4 (:1697-1712, :1720-1728). Tests: R-B1s (:1543-1573), seeded snapshot-to-read, deferred anchor, P2, mismatch and older-host variants. Decision RB-8 (new), RB-4 updated. |
| 3. Hold expiry duplicate | Expiry release is removed rather than reconciled afterwards. Stream content of a block that is still a verified prefix (tool: same id) is absorbed: never delivered, stored as joined text, discarded on an exact complete match, rebuilt exactly as one merged delta on any mismatch (rule H :1020-1068; "Holds and absorption" :1069-1098). No timer and no 2000-event release, so a late exact complete batch meets a tab that shows only the history copy. The review's "release, then remove one copy" was rejected because neither a live-block removal operation nor a history text-node mapping exists (:1277-1286). Tests: R-B3c rewritten (:1461-1473), late exact complete after 60 s and 2500 deltas, plus a late differing complete. Decision RB-5. |

## Revision 3

Orchestrator edit, approved by the user on 2026-10-14 after the round-3 review
(`implementation-plan-addendum-review.md`, `Verdict: REVISE`, defect 1, Moderate). The review cap
is used; the user chose "apply the fix" with no further document round. Batch F's code review
and the new tests verify it.

| Item | Resolution |
| --- | --- |
| Round-3 defect 1: a byte-cap-truncated seeded context shows its in-flight block twice | The 1 MiB cap clears a context's suffix, so the seed holds none of its blocks and its anchor is deferred (`implementation-plan.md:337-346`). Pre-snapshot fence copies of that message then passed rule P and were never compared. Now: rule P2 no longer needs rule-I tracking (any X in `seedStartK`); new rule P3 absorbs pre-snapshot stream text and thinking of such an X while it is a prefix of a same-kind block of `H(X)`, and drops its history tools by id; rule I starts tracking only on a post-snapshot event; absorbed pre-snapshot blocks become "loose" entries that rule H or S resolves (continue at `ks`, discard on a complete copy, rebuild on mismatch). Test: R-B1s truncated variants (a), (b), (c). Decision RB-9. |
| Edges 2-5 of the approval summary | Accepted by the user on 2026-10-14: rule R turn boundary (B.10 point 3), A-B2 failure (point 2), page edge (round 1, defect 3), older host without `liveSeedBlocks` (point 1). Each can show a block twice; none loses content. |
| Review notes 1-3 | `deliverToTab` wording (B.2.3 b), rule S queue wording, and the single ordered channel premise of `prefixMark` (rule P) are stated. |

## Residual A - OQ2: compaction targeted reload gap

### A.1 Failure sequence

The window is real. Paths below are under `libs/frontend/chat/src/lib/services/`.

**How a compaction reload starts.** It is driven by an in-order live event, not by a snapshot.

- `compaction_complete` is a `chat:chunk` stream event. `ChatStore.processStreamEvent` handles it
  and calls `CompactionLifecycleService.handleCompactionComplete` synchronously
  (`chat.store.ts:397-413`).
- `handleCompactionComplete` marks each fan-out tab idle (`compaction-lifecycle.service.ts:528-532`)
  and calls `switchSession(sid, { reason: 'compaction', targetTabId })` per tab in a synchronous
  loop (`:557-562`). The other two callers are `retryStaleFallbackOnce` (`:700-703`) and
  `reloadWithoutReapplying` (`:722-726`). All three pass `targetTabId`.
- `switchSession` runs synchronously up to its first `await`, which is `session:load`
  (`chat-store/session-loader.service.ts:798`). The claim that opens the fence comes only after it
  resolves (`:824`).

**Is it mid-turn?** Yes, in two ways.

- SDK auto-compaction is on by default. Ptah only writes `autoCompactEnabled: false` when the user
  disables it (`libs/backend/agent-sdk/src/lib/helpers/auto-compact-control.ts:146-186`). An auto
  compaction runs between two API calls of one turn, and the turn then continues with a new
  assistant message (Assumption RA-A1 below).
- Independent of that assumption: a reveal flush applies a non-resync snapshot's events in one
  synchronous loop (`chat-message-handler.service.ts:538-542`). If the hidden tail holds
  `[compaction_complete, message_start M2, text_delta M2 ...]`, the compaction starts on the first
  event and the M2 events are applied in the same loop, before any claim exists.

**Failure sequence (current code; the approved plan leaves this path unchanged, component 7
"Unchanged" list).**

1. `compaction_complete` reaches `processStreamEvent`. The accumulator swaps the tab to a fresh
   empty streaming state (`compaction_complete` returns `replacementState`,
   `libs/frontend/chat-streaming/src/lib/accumulator-core.service.ts:571`).
2. `handleCompactionComplete` calls `switchSession` (`compaction-lifecycle.service.ts:559`). It
   registers the `loadKey` (`session-loader.service.ts:789`) and awaits `session:load` (`:798`).
   No fence exists for the session.
3. During that await (or later in the same snapshot loop), `message_start M2` and the first
   `text_delta M2` arrive. `applyChatStreamEvent` asks `deferLiveStreamEvent`, finds no fence
   (`chat-store/session-history-replayer.service.ts:463-464`) and delivers them
   (`chat-message-handler.service.ts:525-528`). They land in the tab's streaming state.
4. A compaction reload skips the early reset (`session-loader.service.ts:837`), so M2 stays visible
   for now.
5. `session:load` resolves. The claim opens the fence (`:824`). `chat:resume` reads the JSONL
   (`:855-868`). M2 is still streaming, so its open block is not in the JSONL (A-1).
6. Live `text_delta M2` events that arrive now are buffered (`session-history-replayer.service.ts:480`).
7. The verified, non-stale reply reaches the compaction reset
   `applyResumingSession(..., createEmptyStreamingState())` (`session-loader.service.ts:901-908`).
   That sets `messages: []` and a new empty streaming state
   (`libs/frontend/chat-state/src/lib/tab-manager.service.ts:2543-2561`). **M2's `message_start`
   and its first text are wiped.**
8. Replay and finalization run. The fence closes (`session-history-replayer.service.ts:226-227`).
   The buffered M2 deltas are delivered with no `message_start` in the state. They are orphaned
   (plan D-8: `message-node.fn.ts:35-36`). The rest of M2 does not render until reload. This is
   the original bug, reached by a different trigger.
9. Status: `markTabIdle` (`compaction-lifecycle.service.ts:532`) plus the reset (`status:
   'resuming'`, `lastTurnStateRevision: undefined`, `tab-manager.service.ts:2547,2559`) also
   erase the tab's `streaming` status. Only a later `turn_state(generating)` restores it (plan D-3).

**A second path into the same loss: draining a fence.** A `compaction_complete` that was
buffered by another claim's fence is delivered from `leaveFence`. The fence is deleted first
(`session-history-replayer.service.ts:534`), then `deliverAll` calls each stored closure directly
(`:539-550`). Those closures are the `deliver` functions from
`chat-message-handler.service.ts:518-522`, so they never re-check the fence. If the drained
`compaction_complete` starts a compaction that is not skipped, the closures after it in the same
drain bypass the compaction's fence and are wiped at step 7.

- When that happens: the drain comes from `release` in a `finally`, where the registry entry is
  already gone (`session-loader.service.ts:981-982`). Or the drain comes from an untargeted load,
  whose `loadKey` is the bare `sessionId` (`:764`) and so never blocks a targeted compaction.
- A drain at a resync's fence close inside `replay` (`session-history-replayer.service.ts:227`)
  is not affected. The resync is still registered, so the compaction is skipped (plan D-9).

**What is not lost.** Events before `compaction_complete` belong to the pre-compaction
transcript. The post-compaction view shows only records after the last `compact_boundary`
(`libs/backend/agent-sdk/src/lib/session-history-reader.service.ts:556-572`), so wiping them is
correct. On the stale branch (`session-loader.service.ts:887-899`) there is no reset. Pre-claim
events stay applied in order. Nothing is lost there, but `applyResumeFailure` sets the status to
`loaded` (`tab-manager.service.ts:2565-2569`).

**Duplicates today.** Live events buffered after the `:824` claim whose block is already in the
JSONL at the `chat:resume` read show twice. That is the open question 3 class (Residual B).

**Delayed compaction reloads: a third path into the same loss.** The early claim (RA-1) protects
a reload only from the moment it starts. That moment matches the compaction point only when the
reload starts synchronously from the in-order `compaction_complete` chunk
(`chat.store.ts:403-413` → `compaction-lifecycle.service.ts:557-562`). Three callers start
later, from a timer or from a later event. Meanwhile live events are applied to the tab unfenced.

- **(D1) Advisory fallback.** Sequence:
  1. The `session:compactionComplete` push (PostCompact hook) is not a `chat:chunk`.
     `handleCompactionCompleteNotification` schedules an advisory (`compaction-lifecycle.service.ts:662-678`).
  2. The advisory fires `POST_COMPACT_BOUNDARY_WAIT_MS = 250` ms later
     (`compaction-advisory-correlator.service.ts:60,199-225`). It calls
     `handleCompactionComplete({ advisoryFallback: true })` (`compaction-lifecycle.service.ts:672-677`),
     which reaches the reload loop at `:557-562`.
  3. During those 250 ms, a visible tab gets `message_start M2` and deltas with no fence. They are
     applied.
- **(D2) Stale retry.** Sequence:
  1. A fallback reload returns `staleSnapshot: true`. The stale branch keeps the tab state and
     every event applied to it (`session-loader.service.ts:887-899`).
  2. Its claim is released, so later events are applied unfenced.
  3. `onSettle` calls `retryStaleFallbackOnce` (`compaction-lifecycle.service.ts:553-554`). The
     retry runs 250 ms later (`compaction-advisory-correlator.service.ts:237-256`) and calls
     `switchSession` (`compaction-lifecycle.service.ts:700-703`).
- **(D3) Late boundary after a stale fallback.** A real `compaction_complete` arrives after the
  fallback was stale and calls `reloadWithoutReapplying` (`compaction-lifecycle.service.ts:383-388`
  → `:722-726`). This one is triggered by an in-order chunk.
  - By stream order, the events applied before it precede the boundary. They are pre-boundary,
    and wiping them is correct.
  - That holds only if no post-compaction stream event precedes the `compact_boundary` chunk
    (Assumption RA-A2, unverified).
  - The tab also took the D1 fallback reload first, so its state mixes a reset with later live
    events. D3 is therefore treated as delayed too (RA-5).

**The loss (same for D1 to D3), with RA-1 applied:**

1. Events from the gap (`message_start M2`, deltas of M2's open block) sit in the tab's streaming
   state.
2. The delayed `switchSession` claims at arrival (RA-1). Only events after the claim are
   buffered.
3. The verified reply reaches the reset (`session-loader.service.ts:901-908`). M2's
   `message_start` and its applied, unpersisted text are wiped. The JSONL does not have them
   (A-1).
4. At fence close, the buffered M2 deltas are orphaned. This is the original bug.

**Assumption RA-A1.** After an auto `compact_boundary`, the SDK continues the same turn with a
new assistant message. Check: run a turn that crosses the auto-compact window. Log the frontend
event order and confirm `compaction_complete` is followed by `message_start` in the same turn.
The fix does not depend on the answer. When no message follows, the early claim buffers nothing
and costs one fence span.

### A.2 Chosen fix

**Headline:** a compaction reload claims the fence at arrival, synchronously, before its first
`await`. A fence drain hands its remaining events to a fence that opens during the drain. A
delayed compaction reload (D1 to D3) that reaches its reset then requests a fresh resync, whose
`liveSeed` restores the wiped live message.

**Why the in-order reload needs no seed.** This holds only for the reload that starts
synchronously from the in-order `compaction_complete` chunk (`compaction-lifecycle.service.ts:557-562`
with `advisoryFallback` unset), including the RA-2 drain case.

- A resync needs a seed because the hidden tail dropped events (overflow). This reload drops
  nothing: every event after its trigger reaches the webview in order.
- So the reload's state is "JSONL read after the trigger, plus every live event after the
  trigger". That state is complete when the fence holds from the trigger onward, which is what
  the early claim does.
- The delayed reloads (A.1, D1 to D3) start after an unfenced gap. Events from the gap are in
  neither the JSONL nor the buffer once the reset runs. They need the seed path, which is RA-5.

**RA-1. Early claim for compaction** (`session-loader.service.ts`, `switchSession`).

- **Where.** Right after the `loadKey` registration (`:789`), before the first `await`
  (`session:load`, `:798`). The plan's resync early claim sits at the same point (component 7,
  "Claim early"). This is one shared early-claim site with a condition on the reason. A waiting
  resync still claims after its wait, as the plan says.
- **Condition.** `opts?.reason === 'compaction' && targetedTab`. Every compaction caller passes
  `targetTabId` (`compaction-lifecycle.service.ts:559-562,700-703,722-726`). `targetedTab` is
  already resolved synchronously at `:765-767`.
- **Call.** `replayClaim = this.historyReplayer.claim(targetedTab.id, sessionId)`, with no seed
  argument. Use the same `try`/`finally` as today, so `release` (`:982`) runs on every exit.
- **The later claim** at `:824` is skipped when `replayClaim` is already set. Today it is the only
  claim (`:824`); after the plan, the resync skips it as well.
- **Superseded guard (extends the plan's).** Component 7 adds the superseded-resync guard right
  after `session:load` resolves (before `:802`, `:831`, `:837`). It must apply to any call that
  claimed early, so the compaction too: `if (!this.historyReplayer.isCurrent(replayClaim)) return
  { staleSnapshot: false }`. This keeps today's invariant: whoever writes holds the current
  claim. A superseded compaction then does not run `clearPendingUpdates` (`:831`) or overwrite
  `SessionManager` state (`:845-854`) under a newer load. Today the same result comes later, at
  `:883-885`. The compaction lifecycle reads only `staleSnapshot` (`compaction-lifecycle.service.ts:567,704`),
  so a `false` result here means what the `:883-885` exit means today.
- **Unchanged:** `requireTargetTab` re-check (`:817-818`), `clearPendingUpdates` (`:830-832`), the
  stale branch (`:887-899`), the reset (`:901-908`), stats with `preserveCompactionContextSeed`
  (`:921-926`) and replay (`:937-958`).

**RA-2. Drain hand-over** (`session-history-replayer.service.ts`, `leaveFence`/`deliverAll`).

- **Today.** `leaveFence` deletes the fence (`:534`), then `deliverAll` runs every closure
  (`:539-550`).
- **Change.** `leaveFence` delivers its buffer one closure at a time. After each one, it checks
  `this.fences.get(held.sessionId)`. If a fence for the same session now exists, a claim opened
  during that delivery. It moves the remaining closures, in order, to the front of the new fence's
  `buffered` array and stops. The new fence delivers them when its last holder leaves.
- **Rule this keeps.** A claim fences every live event that is applied after it, including
  events still waiting in an older buffer. That rule is general, not compaction-specific.
- **Try/catch per closure is kept** (`:541-548`).
- **Bound.** Moved entries count against the receiving fence's `LIVE_EVENT_FENCE_LIMIT` (2000)
  exactly like its own entries: they sit in the same `buffered` array, so the existing check
  `buffered.length >= LIMIT` in `deferLiveEvent` (`:465-467`) sees the combined size.
  - At hand-over, when `moved + newFence.buffered.length` would exceed the limit, the hand-over
    does not move. It applies the existing overflow behaviour to the receiving fence: mark it
    `overflowed` and deliver, in order, the moved entries and then the receiving fence's own
    entries (`:476-478`). RA-3 then requests a fresh resync for a compaction claim; D-10 does the
    same for a resync claim.
  - Later growth is handled by the same check: when the combined buffer reaches the limit, the
    overflow path marks the fence overflowed and delivers every entry in order, moved entries
    first (`:468-478`). RA-3 / D-10 then apply.
- **The overflow drain is out of this rule** (`:476-478`). There the fence object stays (it is
  not deleted), so a claim made during that drain joins the overflowed fence, and RA-3 covers it.

**RA-3. Fence overflow during a compaction's span → fresh resync** (reuses D-10,
`session-loader.service.ts`).

- **Detection.** Read `historyReplayer.overflowedDuring(replayClaim)` (plan component 8) into a
  local before `release` in the `finally`. A claim that joins an overflowed fence is flagged at
  join time (component 8), which also covers a claim made during an overflow drain.
- **Condition.** The overflow flag is set, the compaction reached its reset (`:901-908`), and the
  claim was not superseded. On the stale branch nothing is wiped, so no request is needed.
- **Action.** After the releases, call `StreamViewportController.requestStreamResync(tabId)`
  (plan component 10) without awaiting it, exactly as the resync path does in D-10. The
  coordinator answers with a `resyncRequired` snapshot whose `liveSeed` comes from its projection.
- **No abort before the reset.** This differs from the resync. The compaction always finishes,
  so its marker, stats and `staleSnapshot` result stay as today.

**RA-5. A delayed compaction reload requests a fresh resync** (reuses D-10 and plan component
10; touches `compaction-lifecycle.service.ts`).

- **How the loader knows the call is delayed.** Add an internal option
  `SwitchSessionOptions.compactionDelayed?: true` next to `reason` and `targetTabId`
  (`session-loader.service.ts:108-112`). It is webview-internal and never crosses an RPC.
  `CompactionLifecycleService` sets it in three places:
  - `handleCompactionComplete`, when `result.advisoryFallback === true`: the reload loop at
    `:557-562` passes it (D1);
  - `retryStaleFallbackOnce` (`:700-703`) (D2);
  - `reloadWithoutReapplying` (`:722-726`) (D3).

  The in-order call (from `chat.store.ts:404`, no `advisoryFallback`) does not set it.
- **Condition in the loader.** `opts.reason === 'compaction' && opts.compactionDelayed === true`.
  The call reached its reset (`:901-908`), and its claim is still current when the `finally`
  runs. The loader records "reset reached" in a local next to the RA-3 flag.
- **Action.** In the `finally`, after the releases, call `requestStreamResync(targetTabId)`
  (component 10) without awaiting it. Call it at most once per call, even when RA-3 also fires
  (one shared `freshResyncNeeded` local).
- **What the coordinator does** (plan 4i, plan lines 427-441):
  - `getState` creates the tab's state if absent, sets `resyncRequired` and clears the tail.
  - A visible tab is re-revealed in that same call. A hidden tab keeps the flag until its next
    reveal.
  - The reveal sends `{ resyncRequired: true, liveSeed }` built from the projection at that moment.
    The projection has observed every negotiated event, visible or hidden (4e). So M2's
    `message_start` and its unpersisted suffix are in the seed, and its persisted blocks are in
    the JSONL the resync reads after the snapshot (A-1).
  - A tab with no live state (the turn ended) gets an empty seed. That means one extra reset plus
    JSONL replay, which is complete after a terminal (4i). That is acceptable for these rare paths.
- **No loop.**
  - The resync path is `reason: 'resync'`, so RA-5 never fires for it.
  - The resync requests another resync only on its own fence overflow (D-10, bounded at the live
    rate divided by 2000).
  - The lifecycle starts each delayed reload at most once per compaction generation: fallback once
    (`compaction-lifecycle.service.ts:661-678`), stale retry once (`:689-714`), late boundary once
    (`:383-391`, it deletes the advisory).
- **Keep the compaction context seed across the resync.** A resync reload calls
  `applyResumeStats` with `preserveCompactionContextSeed: false` (`session-loader.service.ts:921-926`).
  That would replace the post-compaction gauge seed with the history snapshot, which the code says
  must never happen after a compaction (`:1030-1037,1046-1053`).
  - The loader keeps `compactionResyncTabs: Set<string>`. RA-5 and RA-3 add the tab before they
    call `requestStreamResync`.
  - The next resync reload of that tab passes `preserveCompactionContextSeed: true` and removes
    the entry in its `finally`, whatever its outcome.
  - Size is bounded by the number of tabs: one entry per tab, cleared by that tab's next resync.
  - An entry left behind (older host, request failed) only means the next resync of that tab keeps
    the current live model stats. The next live usage frame replaces them (comment at `:1046-1049`).

**RA-4. Status probe after a compaction reload** (reuses plan component 9).

- **When.** In the `finally`, after the releases. Only when the compaction took the stale branch
  (`:895-898`) or reached its reset (`:901-908`) and the claim is still the latest. The probe also
  runs when RA-3 or RA-5 requested a fresh resync.
  - On a v2 host, the resync's reset may erase the probe's result (D-3 evidence,
    `tab-manager.service.ts:2555-2560`). The resync's seed turn state or its own probe then sets
    the status. The two do not conflict, because the probe is revision-safe.
  - On a host without v2, `requestStreamResync` sends nothing (component 10, `v2Accepted`), so
    the probe is the only status repair.
  - This differs from D-10, which skips the probe. The reason is that the loader cannot see
    whether the request was sent.
- **Call.** `SessionLivenessReconcilerService.reconcileTab(tabId, sessionId)` without awaiting
  it. Component 7 already injects this service for the resync status fallback.
- **Reason.** `markTabIdle` (`compaction-lifecycle.service.ts:532`), the reset
  (`tab-manager.service.ts:2547,2559`) and `applyResumeFailure` (`:2565-2569`) erase a mid-turn
  `streaming` status. The probe is revision-safe (plan preserve list, `turn-state-applier.service.ts:20-37,87-139`).
  When the turn has ended, it confirms idle and changes nothing.

**No new contract field.** No RPC, payload or schema changes. `compactionDelayed` is an
in-process option of `switchSession`. Only the plan's `resyncTabIds` (D-10) crosses the wire,
through component 10.

**Files** (all in plan Batch F):

- MODIFY `D:/projects/ptah-extension/.claude-worktrees/fix-workspace-switch-stream-flush/libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts` (RA-1, RA-3, RA-4, RA-5) and its spec.
- MODIFY `D:/projects/ptah-extension/.claude-worktrees/fix-workspace-switch-stream-flush/libs/frontend/chat/src/lib/services/chat-store/session-history-replayer.service.ts` (RA-2) and its spec.
- MODIFY `D:/projects/ptah-extension/.claude-worktrees/fix-workspace-switch-stream-flush/libs/frontend/chat/src/lib/services/chat-store/compaction-lifecycle.service.ts` (RA-5: pass `compactionDelayed: true` at the three delayed call sites) and its spec `compaction-lifecycle.service.spec.ts`.

### A.3 Rejected options

- **Seed the compaction reload from the coordinator projection** (a `liveSeed` for compaction).
  It loses on three counts:
  - The compaction path has no snapshot. It starts from a live event (`chat.store.ts:403-413`).
    A seed would need a new RPC round trip to fetch a projection, plus a new contract.
  - A projection fetched after the trigger overlaps the live events already applied or
    buffered. That double-applies text, because buffered closures carry no sequence to drop.
  - It is not needed. Nothing is dropped before the trigger (A.2, "Why no seed").
- **Reset the tab before `session:load` for a compaction**, the way a resync resets at `:837`.
  This breaks the stale containment. The compacted transcript must stay visible until the
  snapshot is known to be boundary-ready (comment at `:833-836`; spec
  `session-loader.service.spec.ts:2037`).
- **Keep the compaction reset but replay the wiped live events afterwards** (re-apply what was
  delivered between the trigger and `:824`). This needs a second, parallel log of applied
  closures, and it duplicates what the fence already does once it is opened earlier.
- **Claim in `CompactionLifecycleService` before calling `switchSession`.** This splits the claim
  and its `release` across two services and breaks the `try`/`finally` pairing rule
  (`session-history-replayer.service.ts:150-154`). It also needs a second claim API, because
  `switchSession` claims for itself.
- **Early claim without RA-2.** The drain path in A.1 still loses M2: the closures after a
  drained `compaction_complete` are applied before the reset. This is the smaller path, but it is
  the same bug.
- **Skip the compaction when a fence drain triggers it** (extend the D-9 skip). This loses the
  compaction reload (marker refresh, post-boundary transcript, `preserveCompactionContextSeed`
  stats) in cases where it runs correctly today.
- **Leave it as a documented residual** (open question 2's original recommendation). The user
  decided to fix it in this task.
- **Delayed path: request a fresh resync after every compaction reload that reaches its
  reset.** This needs no new option, but every in-order compaction would then reset and replay
  the JSONL twice. That doubles the cost of the common path and makes the tab flicker twice,
  only to cover three rare timer-driven or late paths.
- **Delayed path: detect "live state present" from the tab at claim time** (for example, a
  non-empty `streamingState`). This is fragile. The in-order `compaction_complete` swap can still
  be a queued write at claim time (comment at `session-loader.service.ts:826-829`), and an empty
  state does not prove that nothing was applied and flushed. The lifecycle knows the call is
  delayed for certain, so it should say so.
- **Delayed path: skip the delayed compaction's reset and rely on the resync alone.** This loses
  the compaction-specific handling: stale containment and the retry signal (`:887-899`), and the
  preserved context seed (`:921-926`).
- **Delayed path: fence the tab from the advisory or stale-retry schedule until the delayed
  reload claims.** This adds a fence holder with a 250 ms timer lifetime in the lifecycle, across
  services. It still misses D3, whose gap starts at the earlier fallback reload's release. It
  also stretches the 2000-event bound over timer spans.
- **Delayed path: treat D3 as in-order and leave it to RA-1.** This holds only under the
  unverified RA-A2. Treating D3 as delayed costs one extra reload in a rare path.

### A.4 Compatibility

- **Scope.** RA-1, RA-2 and RA-4 change only `@ptah-extension/chat` webview services. In `apps/`,
  only `apps/ptah-extension-webview` imports `@ptah-extension/chat` (`app.ts`, `app.config.ts`,
  `app.routes.ts`). The webview is shared by the VS Code extension and Electron. The CLI/TUI do not
  load it, so they are unaffected. No host code changes.
- **New webview, old host.** RA-1, RA-2 and RA-4 need nothing from the host. `session:status`
  exists today (plan component 9 reuses the existing probe). RA-3 and RA-5 send `resyncTabIds`
  through component 10. On a host that never accepted v2, `requestStreamResync` sends nothing
  (component 10). The delayed paths D1 to D3 then keep today's outcome (loss of the gap's live
  message until reload), and RA-4 still repairs the status. An older host rejects the field. The webview logs a `console.warn` and keeps
  what rendered, which is the D-10 outcome (plan component 7, failure list). The Electron host
  and webview ship together, so that case is unusual.
- **Old webview, new host.** Nothing changes. The host gains no behaviour that depends on this
  addendum.
- **VS Code panel.** `requireTargetTab` looks in the active set first, then across workspaces
  (`session-loader.service.ts:986-989`). The early claim uses the same tab, so behaviour matches
  on both hosts. Whether a VS Code host serves `resyncTabIds` follows plan component 10; RA-3
  adds no new requirement.

### A.5 Interaction with D-5, D-9, D-10, fence and seed

- **D-5 (resync supersedes resync): unchanged.** `resyncGeneration` and `latestResync` count only
  resync arrivals. A compaction never takes part in resync recency.
- **D-9: the rule stays; two sentences of its text change.**
  - *Resync arrives during a compaction.* Unchanged. The compaction is registered (`:789`)
    before it claims, so the resync sees the entry and waits with a reservation. The only
    difference is that the reservation now joins a fence that the compaction opened at its
    arrival, not at `:824`. Same fence object, same "buffer stays closed while a reservation
    holds it" (`session-history-replayer.service.ts:529-536`).
  - *Compaction arrives during a resync.* Still skipped at the registry check (`:769-775`). That
    check runs before the RA-1 claim, so the skipped compaction never claims and never
    supersedes the resync's claim or seed.
  - *"Why (b) loses."* Re-examined; it still holds. (b) carried the resync's seed into the
    compaction reload. It loses because the compaction's `chat:resume` can read the JSONL before
    the resync's snapshot, so content persisted between that read and the snapshot would be in
    neither the history nor the seed. RA-1 moves only the compaction's claim, not its JSONL read
    relative to the snapshot. Only the second clause, "(b) also changes compaction claim timing,
    which open question 2 keeps out of scope", is now obsolete.
  - *Revised D-9 text* (the orchestrator applies it in `implementation-plan.md`):
    - Replace "the compaction's own claim timing is untouched" (open question 2) with: "A
      compaction reload claims at arrival, before `session:load` (addendum RA-1)."
    - Drop the clause "(b) also changes compaction claim timing, which open question 2 keeps out
      of scope." The JSONL-read argument stays as the reason (b) loses.
  - *"Not queued the other way."* Kept as the rule. See A.10 point 2: with RA-1 and RA-2, a
    queued compaction would no longer wipe a still-live seeded message, but changing the skip is
    out of this residual.
- **D-10: extended, not changed.** RA-3 applies the same remedy (fresh resync through
  `resyncTabIds`) to a compaction whose fence overflowed and that reached its reset.
  - RA-5 applies it to a delayed compaction reload that reached its reset.
  - Both share one request per call and register the tab in `compactionResyncTabs`, so the
    resync keeps the post-compaction context seed.
  - D-10's "skip the status probe" does not carry over: RA-4 probes anyway (A.2, RA-4).
  - The fresh resync arrives after the compaction released its registry entry and claim, so it
    is not skipped by the registry check. Its early claim, the `resyncGeneration` rule and its
    seed apply unchanged (D-5).
  - A second compaction for the tab that arrives while that resync is in flight is skipped
    (D-9). A later one, after the resync, starts a new cycle. Same bounds:
  2000 fence entries, 1 MiB projection. The compaction lifecycle starts at most one compaction
  per tab and `loadKey` (`:769-775`). The fresh resync is requested only after the compaction's
  `finally` released its registry entry, so it is not skipped as a duplicate.
- **Fence.**
  - Every claim still pairs with `release` in the existing `finally` (`:980-983`).
  - RA-2 changes only what happens when a claim opens during a drain: the rest of the drain waits
    behind it. When no claim opens mid-drain, delivery order and timing are as today.
  - The seed order in component 8 is unchanged. `closeFence` runs the closing claim's seed first,
    then `leaveFence` drains. A hand-over can only happen after that seed ran.
- **Seed.** The compaction never carries a seed (`claim` without the third argument). On the
  delayed paths, the seed reaches the tab through the follow-up resync (RA-5), not through the
  compaction's claim. A
  compaction claim that supersedes an older claim on the same tab discards that claim's seed
  (component 8, `claim`). That can only be a plain or untargeted load's claim: a resync's claim
  cannot be superseded by a compaction, because the compaction is skipped while the resync is
  registered (D-9).
- **Registry order in `finally` (must hold).** For compaction and plain loads, delete the
  registry entry before releasing the claim, as today (`:981-982`). Otherwise a
  `compaction_complete` drained by that release is skipped as a duplicate, and the compaction
  reload is lost. The plan's resync `finally` order (reservation, claim, registry) applies only
  to the resync path.

### A.6 Preserve list

| Behaviour | Where today | Kept by |
| --- | --- | --- |
| Compacted transcript stays visible until the snapshot is boundary-ready (no early reset for compaction) | `session-loader.service.ts:833-844` | RA-1 adds a claim only; the `:837` condition is untouched |
| Stale snapshot containment: `applyResumeFailure`, `markTabIdle`, `setStatus('loaded')`, returns `{ staleSnapshot: true }` | `:887-899` | Unchanged. RA-4 probes after it; buffered live events are delivered at release, as today |
| Stale fallback retry once, and the late-boundary reload | `compaction-lifecycle.service.ts:546-556,689-714,717-734` | Unchanged. `staleSnapshot` keeps its meaning; a superseded call still resolves `false` |
| Compaction reset at the verified reply, plus stats with `preserveCompactionContextSeed` | `session-loader.service.ts:901-908,921-926` | Unchanged |
| `clearPendingUpdates` before the reset, against a queued compaction write | `:826-832` | Unchanged position (after `session:load`) |
| `hasLiveSession` short-circuit bypass for compaction | `:779` | Unchanged |
| Duplicate compaction reload on the same tab is skipped | `:769-775`; spec `session-loader.service.spec.ts:2239`, `:2273` | Unchanged; the early claim comes after this check |
| Target disappears during `session:load` → throws before writing | `:817-818`; spec `:2176` | Unchanged. The claim is not a tab write; `finally` releases it |
| Compaction supersedes an in-flight replay and wins the fence | spec `:2592` (B3) | Still passes: the claim now happens earlier, the older replay stops at its next chunk boundary (`session-history-replayer.service.ts:209-224`), and the order `clear` < `finalize` < live holds |
| Deferred live compaction state is discarded before the targeted replay | spec `:3506` | Unchanged |
| Registry deleted before the claim is released in `finally` (non-resync calls) | `session-loader.service.ts:981-982` | Must stay (A.5) |
| Fence bound, warning and in-order early delivery on overflow | `session-history-replayer.service.ts:465-479` | Unchanged; RA-3 reacts afterwards |
| One throwing buffered delivery does not strand the rest | `:539-550` | Kept per closure in RA-2 |
| Lifecycle fan-out, marker, count, `markTabIdle`, stale retry and late-boundary logic | `compaction-lifecycle.service.ts:353-581,689-734` | Unchanged. RA-5 only adds `compactionDelayed: true` to the options object at the three delayed call sites |
| Post-compaction context seed is never displaced by history stats | `session-loader.service.ts:1030-1037,1046-1053` | Kept across the RA-3/RA-5 follow-up resync through `compactionResyncTabs` |
| `compaction-lifecycle.service.spec.ts` | whole file | Passes. In-order expectations stay exact (for example `:425`, `:666-671`, `:730`, `:804`, `:837`, `:930`). Only expectations whose `switchSession` call comes from the advisory fallback, the stale retry or the late-boundary reload gain `compactionDelayed: true`. The candidates are in the PostCompact describes at `:937` and `:1445` (`:1071`, `:1204`, `:1408`, `:1488`, `:1516`, `:1558`, `:1596`). The implementer confirms each one by its trigger and changes nothing else |

### A.7 Regression test

**R-A1: a live message that starts during a compaction reload's `session:load` survives the
reset.**

- **Spec file:**
  `D:/projects/ptah-extension/.claude-worktrees/fix-workspace-switch-stream-flush/libs/frontend/chat/src/lib/services/chat-store/session-loader.service.spec.ts`.
  Put it in the `describe('SessionLoaderService targeted replay with the real streaming state pipeline')`
  block (`:3378`), which uses `configureRealPipeline` (`:3402`) and the `event(...)` helper
  (`:3384-3400`).
- **Setup.**
  - Tab `TAB` is bound to `SESSION`.
  - `rpcCall`: `session:load` returns a promise the test resolves by hand. `chat:resume` returns a
    verified reply (no `staleSnapshot`) with history `[message_start H, text_delta H
    restoredText, message_complete H]`.
  - A helper `live(e)` mimics `applyChatStreamEvent` (`chat-message-handler.service.ts:518-528`):
    `if (!replayer.deferLiveEvent(e, TAB, SESSION, deliver)) deliver()`, where `deliver` calls the
    real `StreamingHandlerService.processStreamEvent(e, TAB, SESSION)`.
- **Steps.**
  1. `const pending = service.switchSession(SESSION, { reason: 'compaction', targetTabId: TAB })`.
     Do not await.
  2. Synchronously: `live(message_start L)` and `live(text_delta L "live-1")`.
  3. Resolve `session:load`, and wait until `chat:resume` has been called.
  4. `live(text_delta L "live-2")`.
  5. `await pending`.
- **Assert.**
  - `pending` resolves `{ staleSnapshot: false }`.
  - The tab's `streamingState.events` contains `L`'s `message_start`.
  - The text accumulator for `L` is `"live-1live-2"`, with nothing missing and nothing doubled.
  - `H`'s restored text is present.
- **Without the fix it fails.** Step 2 is applied unfenced and then wiped by the `:902` reset. The
  tab has no `L` start, and the accumulator holds only `"live-2"` or nothing.

**R-A2: a live message applied before a delayed compaction reload is restored by the follow-up
resync.**

- **Spec file and block:** the same as R-A1. In addition, the TestBed provides a
  `StreamViewportController` mock whose `requestStreamResync` is a `jest.fn()`. Component 7
  injects that service for D-10.
- **Setup.** As R-A1. `chat:resume` returns a verified reply with history H and stats carrying a
  `contextSnapshot`. Before step 1, set the tab's `liveModelStats` to a post-compaction seed
  `P`.
- **Steps.**
  1. With no load in flight: `live(message_start L)`, `live(text_delta L "gap")`. Both are applied
     unfenced, as in the 250 ms advisory gap.
  2. `await service.switchSession(SESSION, { reason: 'compaction', targetTabId: TAB,
     compactionDelayed: true })`. During its `chat:resume`, `live(text_delta L "-buffered")`.
  3. Assert `requestStreamResync` was called exactly once, with `TAB`, after the call settled.
  4. Play the coordinator's answer the way R-F4 does. Call the resync entry
     (`ChatStore.resyncStream` or `switchSession` with `reason: 'resync'`) with seed
     `[turn_state(generating), message_start L, text_delta L "gap-buffered"]`. Its `chat:resume`
     returns history H again. Deliver `live(text_delta L "-after")` during it.
- **Assert.**
  - The tab's `streamingState.events` has `L`'s `message_start`.
  - The text accumulator for `L` is `"gap-buffered-after"`, with nothing missing and nothing
    doubled.
  - The tab `status` is `streaming`.
  - `liveModelStats` is still `P`, so the resync did not displace the compaction seed.
- **Without the fix it fails.** Step 3 fails, because nothing requests a resync. If the spec goes
  on without step 4, the tab has no `L` start after step 2: `"gap"` was wiped by the `:902` reset
  and `"-buffered"` is orphaned.
- **Negative variant.** The same steps without `compactionDelayed` (the in-order call) make no
  `requestStreamResync` call.
- **Lifecycle check** (`compaction-lifecycle.service.spec.ts`). The advisory fallback, the stale
  retry and the late-boundary reload call `switchSession` with `compactionDelayed: true`. The
  in-order `handleCompactionComplete` does not.

**Component seams** (unit level, not the regression tests):

- **RA-2** (`session-history-replayer.service.spec.ts`). Claim A buffers `[d1, d2]`. `d1` calls
  `replayer.claim(TAB, SESSION)`. `release(A)` runs `d1` and not `d2`. Releasing the new claim
  runs `d2` exactly once. A drain that opens no claim delivers both, as today.
- **RA-1 drain variant** (same describe as R-A1). An untargeted load holds the fence. Buffer
  `[compaction_complete via the real ChatStore path, message_start L, text_delta L]`, then finish
  the load. The compaction's reset does not remove `L`.
- **RA-3.** Force `LIVE_EVENT_FENCE_LIMIT + 1` live chunks during a compaction's `chat:resume`.
  Assert `requestStreamResync(TAB)` is called once after it settles. Also assert it is not
  called on the stale branch.
- **RA-4.** `reconcileTab(TAB, SESSION)` is called once after a verified compaction reload,
  once after a stale one, and also when RA-3 or RA-5 fired. It is not called when the claim was
  superseded.
- **RA-3 + RA-5 together.** A delayed reload whose fence also overflowed calls
  `requestStreamResync` once, not twice.
- **`compactionResyncTabs`.** The entry is removed by the next resync of that tab, on success
  and on failure.

### A.8 Batch placement and test commands

- **Batch F** (frontend resync, plan components 5 to 10). Two files are already in Batch F:
  `session-loader.service.ts`(+spec) and `session-history-replayer.service.ts`(+spec). RA-5 adds
  `compaction-lifecycle.service.ts`(+spec) to Batch F. It is in the same project
  (`@ptah-extension/chat`), and no other batch touches it.
- **Order.** RA-3 and RA-5 need component 8's `overflowedDuring` (RA-3 only) and component 10's
  `requestStreamResync`. RA-4 needs component 9's `reconcileTab`. RA-5's lifecycle change
  follows the new `SwitchSessionOptions` field. RA-1's superseded guard extends
  component 7's guard. So implement RA-1, RA-3 and RA-4 together with component 7, after
  components 8, 9 and 10. Implement RA-2 together with component 8.
- **Batches S and B are not touched.**
- **Test commands** (memory-safe; one heavy check at a time; never workspace-wide; no build,
  serve or e2e):
  - Narrow:
    `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/services/chat-store/session-loader.service.spec.ts libs/frontend/chat/src/lib/services/chat-store/session-history-replayer.service.spec.ts libs/frontend/chat/src/lib/services/chat-store/compaction-lifecycle.service.spec.ts --coverage=false --maxWorkers=2`
  - Project: `npx nx test @ptah-extension/chat --parallel=1`, then
    `npx nx lint @ptah-extension/chat --parallel=1`.

### A.9 Dependence on assumption A-1

- **RA-1 and RA-2 (no loss on the in-order reload): independent of A-1.** They use no seed. The fence holds every live
  event from the trigger onward, and the JSONL read happens after the trigger. Loss would need
  an event that is neither delivered live nor in the JSONL, and the fence rules that out
  whenever persistence happens.
- **Duplicates: depend on persistence timing, not on A-1 being true.** A block of the new
  message that reaches the JSONL before the `chat:resume` read is shown twice: once from history,
  once from the buffered live events. This is the open question 3 / Residual B class.
  - The window runs from the trigger to the `chat:resume` read: about one `session:load` round
    trip longer than today's `:824`-to-read window.
  - The next assistant message must first get its first API token and then complete a block
    inside that window. That is unlikely for a local round trip.
  - If A-1 is false in the "persists earlier" direction, the window gets wider. Residual B's fix,
    if any, applies here unchanged.
- **RA-3 (fresh resync): depends on A-1 exactly as D-10 does.** The fresh resync's seed covers
  the chunks that were delivered early only if each chunk is persisted or in the unpersisted
  suffix. No new runtime check: the plan's existing A-1 check (handoff, "record the A-1 and A-2
  checks") covers it.
- **RA-5 (delayed paths): depends on A-1 exactly as D-10 does.**
  - The follow-up resync restores the gap's live message only if each wiped chunk is either in
    the JSONL the resync reads after its snapshot or in the projection's unpersisted suffix.
  - If A-1 is false in the "persists earlier" direction, a block can show twice (A-1's recorded
    outcome). In the "persists later" direction, text in the window between the complete batch
    and the write is missing until reload. Both are A-1's documented outcomes, not new ones.
  - No new runtime check: the plan's A-1 check covers it.
- **RA-4: independent of A-1.**
- **RA-A1** (turn continues after auto-compaction) decides how often the window fires, not
  whether the fix is correct. Record it next to the A-1 check.
- **RA-A2** (no post-compaction stream event precedes the `compact_boundary` chunk) is not
  relied on. D3 is treated as delayed either way (RA-5).

### A.10 Open points

1. **Events buffered before a waiting resync's snapshot are also covered by that resync's seed.**
   - *Cause.* This comes from plan D-9, and RA-1 makes it slightly larger. A compaction's fence
     buffers visible live events. The tab is then hidden, its tail overflows, and on reveal a
     resync reserves the same fence. At the resync's fence close, the seed (projection at
     snapshot S) runs, then the buffer, which still holds the pre-S events of the same in-flight
     message. Text before S shows twice.
   - *Size.* With the plan as written, the window runs from the compaction's `:824` claim to the
     hide. With RA-1 it runs from the trigger to the hide.
   - *Options:*
     - (a) `reserveFence` drops the closures already buffered when the reservation is taken.
       The resync's model is "JSONL read after S + seed at S + live after S", so everything
       live before S is redundant. This is only safe if the projection observes every
       `chat:chunk` kind (plan component 4e).
     - (b) Accept and document it with Residual B.
     - (c) Make a resync supersede a compaction. Rejected: D-9 "Why (c) loses".
   - Resolved by Residual B rule P (B.2.3 a, per block, rebuilt tab only); test R-B2c. See
     B.10 point 5. Pre-snapshot complete batches are kept (B.10 point 1).
   - *Recommendation:* (a), after the team-leader confirms 4e covers every fenced event kind.
     Otherwise (b). This overlaps Residual B, so the orchestrator should place it in one
     section only.
2. **A compaction drained from a resync's fence is skipped (D-9), so its reload never runs.**
   - *Cause.* The drain happens at the resync's fence close inside `replay`
     (`session-history-replayer.service.ts:227`) or at its `release` while still registered.
     The compaction hits `:769-775` and returns. This is today's behaviour, because a resync is
     a registered targeted load today as well.
   - *Effect.* With RA-1 and RA-2, a compaction run after the resync would be safe. The seeded
     message ended before the boundary, and later events would be fenced by the compaction's
     own claim.
   - *Options:*
     - (a) Keep the skip in this task.
     - (b) Queue a compaction drained during a resync and run it after the resync settles.
   - *Recommendation:* (a), with (b) as a follow-up. It is outside OQ2 and changes D-9's skip.

## Residual B - OQ3: two ~1-RTT duplicate windows

### B.1 Failure sequences

All three windows are reachable with the approved plan and RA-1..RA-4 applied. They share one
mechanism. Paths are under `libs/` unless a full path is given.

**Why history and live content never reconcile today.**

- A live assistant event carries `messageId = message.id` of the SDK assistant message, the
  API id (`backend/agent-sdk/src/lib/message-transform/assistant-message.transformer.ts:88`).
  The complete batch uses the same id (`:128-129`, `:143-144`). Its `blockIndex` is the index
  inside that SDK message's `content` (`:119`, `:131`, `:146`), not the API block index.
- The JSONL record keeps both `uuid` and `message.id`
  (`backend/agent-sdk/src/lib/helpers/history/history.types.ts:83-86`).
- History groups assistant records under the **first record's `uuid`**
  (`backend/agent-sdk/src/lib/helpers/history/session-replay.service.ts:219-231`). The replayed
  events never carry `message.id`. So a history node id never equals a live node id.
- The webview's message dedup is keyed by `messageId` per session
  (`frontend/chat-streaming/src/lib/event-deduplication.service.ts:248-258`). Tool dedup is
  limited to the current streaming state (`frontend/chat-streaming/src/lib/accumulator-core.service.ts:370-379`,
  `event-deduplication.service.ts:267-276`). After history finalization the live events build
  a new streaming state, so neither check fires.
- How the duplicate appears: the buffered stream `message_start` opens a live bucket under the
  API id. Stream deltas append (`accumulator-core.service.ts:320-322`). The complete batch's
  duplicate `message_start` arms `pendingTextClear` (`:273-276`), and its `text_delta`
  replaces the block (`:314-319`). The block then renders in the history node (uuid) and in the
  live node (API id) until reload.
- The replayer's own comment leaves this overlap to `EventDeduplicationService`
  (`frontend/chat/src/lib/services/chat-store/session-history-replayer.service.ts:443-446`),
  which cannot match the two ids.

**B.1.1 Window (i): content persisted between the snapshot and the `chat:resume` read.**

1. A hidden tab overflows. Reveal sends `resyncRequired` with `liveSeed` (plan component 4). The
   webview calls `resyncStream` synchronously (`frontend/chat/src/lib/services/chat-message-handler.service.ts:533-536`).
   The resync claims the fence on arrival (plan component 7, "Claim early";
   `session-history-replayer.service.ts:143-157`, `:503-518`).
2. The loader awaits `session:load` (`frontend/chat/src/lib/services/chat-store/session-loader.service.ts:798`),
   then `chat:resume` (`:855-868`, timeout `RESUME_TIMEOUT_MS`).
3. In that span, message M starts (or the seeded message X finishes its current block). Every
   chunk goes `applyChatStreamEvent` → `deferLiveStreamEvent` and is buffered
   (`chat-message-handler.service.ts:518-528`; `session-history-replayer.service.ts:457-481`).
   This includes M's stream `message_start`, its deltas and its complete batch.
4. Claude Code appends the block's record to the JSONL. The host reads the JSONL afterwards
   (`backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:949`; reader
   `backend/agent-sdk/src/lib/session-history-reader.service.ts:433-454`).
5. The reply's `events` hold the block under the record uuid
   (`chat-session.service.ts:1080-1082`). Replay and finalize run
   (`session-history-replayer.service.ts:209-227`).
6. The fence closes: seed first (plan component 8), then the buffer (`:529-550`). The block
   renders twice, as above.
   - For the seeded message X, the seed already holds the block's stream suffix (plan component
     3, "Suffix"), and the buffer holds its complete batch. Both copy content that the history
     now has. The plan's open question 3 names only the brand-new message; the seeded variant is
     the same window.

**B.1.2 Late arrival after the fence closed (same window, longer tail).** A chunk emitted before
the read can reach the webview after the fence closed:

- Visible chunks leave the host through a 16 ms batch timer (plan evidence,
  `stream-batch-buffer.ts:25-33`). The `chat:resume` reply is a separate send.
- A history of at most 250 events replays with no yield (`session-history-replayer.service.ts:199`,
  `:219`). Replay, finalize and fence close then run in one task.
- Such a chunk is delivered live and duplicates the history in the same way. **A filter that
  only runs at fence close is therefore not enough.**

**B.1.3 Window (ii): a second overflow while a resync is in flight.**

1. R1 claims at its snapshot S1. The tab is visible. Chunks in (S1, H2) are sent
   (`backend/rpc-handlers/src/lib/chat/streaming/chat-stream-delivery-coordinator.service.ts:121-130`)
   and buffered by R1's fence.
2. The tab is hidden at H2. The hidden tail overflows. Reveal sends S2 with seed σ2, X's anchor
   plus every stream event since X's last complete batch (plan component 3, "Suffix",
   "Persisted boundary"). σ2 therefore repeats X's deltas that were already sent in (S1, H2)
   when no complete batch came in between.
3. R2 supersedes R1 (plan D-5). R2's claim joins the same session fence. The old hold is left
   only after the new one is in place (`session-history-replayer.service.ts:503-518`), so the
   (S1, H2) buffer stays. R1's seed is discarded (plan component 8).
4. R2 resets, replays H(T_r2) and closes. σ2 builds X's block text. Then the buffered (S1, H2)
   deltas of the same block **append again** (`accumulator-core.service.ts:320-322`). Thinking
   deltas append the same way. Tool input deltas append (`:411-416`) with no replace step.
5. The text heals only when that block's complete batch arrives later (`:273-276`, `:314-319`).
   When the block was persisted by T_r2, its buffered batch heals the live node but also
   duplicates the history node, which is window (i) again.

**B.1.4 Compaction variant (Residual A, RA-1).**

1. `compaction_complete` makes the compaction reload claim at arrival (RA-1).
2. The turn continues with message M (Assumption RA-A1). M's chunks are buffered.
3. The compaction's `chat:resume` reads the JSONL after M's first block was persisted. The
   post-boundary history contains it (`session-replay.service.ts:83-100`).
4. The fence closes, and the buffered M events duplicate it. This is the mechanism of B.1.1.
   - RA-1 lengthens the fenced span by `session:load`. Before RA-1, those events were wiped (A.1
     step 7), so they were lost. With RA-1 they show twice. RB removes the duplicate.

**Plain targeted and untargeted loads** (`:824` claim) have the same class. They are outside
OQ3, and RB leaves them unchanged (B.2, scope).

### B.2 Chosen fix

**Headline:** for the rebuilt tab only, the webview drops a live block only after a runtime check
shows that the history page it just replayed holds the same block: same API `message.id`, same
position in that message's block sequence, same signature. The host adds one opt-in map to the
`chat:resume` reply. For each block event in the delivered page, it names the API `message.id`
of the JSONL record behind it. A mismatch, an unknown position, or a message that the page does
not fully cover makes that message pass through. A seeded resync also drops pre-snapshot stream
events of a block that the new seed itself holds. Every other case keeps the event: a possible
duplicate, never a loss.

**Scope.**

- **Filtered by signature (rules I, H):** a message whose stream `message_start` the filter sees
  in the claim's buffer or later, and that the seed does not name. This covers window (i) for a
  new message M (the case plan OQ3 names), late arrivals (B.1.2), and the compaction variant
  (B.1.4).
- **Filtered by seed coverage (rule P):** the window (ii) stream duplicate (B.1.3 step 4).
- **Filtered by signature from a seeded start (Revision 2, rules I and H):** a message that the
  seed names, or whose host deferred anchor arrives live, when the snapshot's `liveSeedBlocks`
  gives its start position `k0` (B.2.1). Its seed events run through the filter like buffered
  events. This closes the seeded variant of window (i) (B.1.1, last bullet) and the D-8 deferred
  anchor case (B.5).
- **Not filtered:** a message first seen without its stream `message_start` and with no
  `liveSeedBlocks` entry, or any message when the host sent no `liveSeedBlocks` (older host,
  B.4). Its block position is unknown, so it passes through. Only the compatibility path keeps
  the old duplicate; a current host gives every seeded and deferred context an entry with no
  count cap (B.2.1).

**What is compared, and why it is verified at runtime.**

- **Live.** One complete batch per SDK assistant message
  (`backend/agent-sdk/src/lib/message-transform/assistant-message.transformer.ts:44-50,354-363`).
  Each block is one complete-source event that carries the whole block: `thinking_delta` with
  the full thinking (`:121-135`), `text_delta` with the full text (`:136-150`), `tool_start`
  with the `toolCallId` (`:151+`). Its `messageId` is the API id (`:88`).
- **History.** One event per rendered block, in record order: `text_delta` with the full text
  (`backend/agent-sdk/src/lib/helpers/history/session-replay.service.ts:289-299`),
  `thinking_delta` with the full thinking (`:300-310`), `tool_start` with
  `toolCallId = block.id` (`:311-330`, `:419`). Subagent records render text and tools only
  (`:512-559`). History groups a whole turn under the first record's uuid (`:219-231`; reset
  only at `:156-170`), so the events alone cannot name the API id.
- **No record-count assumption.** The CLI writes one JSONL line per content block with a shared
  `message.id` (`backend/agent-sdk/src/lib/session-stats/session-usage-ledger.ts:119-131`). One
  SDK message can therefore map to one record or to several. RB compares block by block, so it
  needs neither mapping.
- **Signature.** `tool` + `toolCallId` (exact; ids are unique). `text` + the full string.
  `thinking` + the full string. Plain string equality. No hash is needed: the webview holds both
  strings.
- **Sequence.** For message X, `H(X)` is the ordered list of signatures of X's block events in
  the delivered page. The filter compares X's k-th compared live block with `H(X)[k]`.
- **Domain.** For a live subagent message (`parentToolUseId` set), thinking blocks are outside
  the compared sequence. They are kept and do not advance k, because subagent history never
  renders thinking (`session-replay.service.ts:512-559`).
- **Fail open.** First mismatch: X passes through for the rest of the filter's life. Its held
  events are released in order, and every absorbed stream prefix is rebuilt exactly (rule H,
  Revision 2). `k >= |H(X)|`: X passes through. X absent from `H`: X passes through.
- **What a drop proves.** The tab's history shows a block of X at the same position with the
  same tool id or exactly the same full text. A wrong drop needs a position shift between the
  two sequences and an identical full text at the shifted position, inside the same API message.
  That content is still on screen. B.10 point 2.

#### B.2.1 Contract (plan Batch S)

- `libs/shared/src/lib/types/rpc/rpc-chat.types.ts`:
  - `ChatResumeParams` (`:245-272`): `historyBlockOwners?: true`. Doc: opt-in. Set only by a
    webview load that holds an early claim and will filter with the answer.
  - `ChatResumeResult` (`:275+`): `historyBlockOwners?: Readonly<Record<string, string>>`.
    - Key: the decimal index of a `text_delta`, `thinking_delta` or `tool_start` event in this
      reply's `events`.
    - Value: the API `message.id` of the JSONL record that produced that event.
    - Only messages whose every block event of the full replay is in `events` appear.
    - Present only when requested and the read succeeded.
    - Size: at most one entry per event in `events`, so it is bounded by the page.
  - `ChatResumeResult.historySyntheticToolResults?: readonly number[]` (Revision 2, defect 1).
    - The decimal indices in this reply's `events` of every `tool_result` that replay
      synthesized because the parent result was not yet in the JSONL
      (`backend/agent-sdk/src/lib/helpers/history/session-replay.service.ts:375-415`; output is
      the agent's last text or `'[Agent completed]'`, `isError` is always `false`, `:405-411`).
    - Sent together with `historyBlockOwners` (same opt-in), possibly empty. Bounded by the page.
- `libs/shared/src/lib/types/messages/payload-map.ts`, `ChatStreamSnapshotPayload`
  (`:254-262`, extended by plan component 1, `implementation-plan.md:210-220`) (Revision 2,
  defect 2): `readonly liveSeedBlocks?: Readonly<Record<string, number>>`.
  - Key: the `messageId` of a context the projection holds at the snapshot, seeded (anchor in
    `liveSeed`) or deferred (anchor injected live later, D-8). Value: the number of complete
    block events of that message that the coordinator published before the snapshot, counted in
    the compared domain (root: `text_delta`, `thinking_delta`, `tool_start`; subagent context:
    `text_delta`, `tool_start`). That is the position `k0` of the message's next block in
    `H(X)`.
  - Valid only with `resyncRequired: true` (same rule as `liveSeed`). It may be present when
    `liveSeed` is omitted, because a context with only a deferred anchor has no seed events
    (`implementation-plan.md:337-339`).
  - Bound: exactly one entry per projection context. Each context already stores its anchor
    inside the projection's 1 MiB budget (`implementation-plan.md:305-309,340-346,467`), so the
    map is bounded by what the projection holds. There is no count cap and no omission path:
    the producer never drops an entry, so no seeded context falls back to the duplicate.
- `libs/shared/src/lib/types/messages/schemas.ts`, `ChatStreamSnapshotPayloadSchema` (`:204-234`):
  `liveSeedBlocks: z.record(z.string().min(1), z.number().int().nonnegative()).optional()`;
  the plan's refine rule for `liveSeed` also rejects `liveSeedBlocks` without
  `resyncRequired === true`. `liveSeedBatches` stays removed (review defect 5).

#### B.2.2 Host (plan Batch B, plus `agent-sdk`, which is new to the plan)

- `libs/backend/agent-sdk/src/lib/helpers/history/session-replay.service.ts`,
  `replayToStreamEvents` (`:83-87`): optional fourth parameter
  `collector?: { blockOwners: Map<FlatStreamEventUnion, string>; syntheticToolResults: Set<FlatStreamEventUnion> }`
  (Revision 2: one collector object instead of a bare map).
  - When given, each `text_delta`, `thinking_delta` and `tool_start` that is pushed for an
    assistant record with a non-empty `message.id` (`history.types.ts:83-86`) is recorded with
    `collector.blockOwners.set(event, record.message.id)`.
  - Main path: `:289-330` and `:419`. Subagent path: `processAgentMessages` (`:481-559`)
    receives the same collector and records `:515-542`.
  - Revision 2 (defect 1): the synthetic `tool_result` pushed at `:405-415` is added to
    `collector.syntheticToolResults`. The persisted result pushed at `:363-374` is not.
  - Absent: output is identical. Event shape, ids and grouping do not change.
- `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts`, `readSessionHistory`
  (`:190-204`): option `includeBlockOwners?: boolean`, default `false`. When true, it creates the
  collector, passes it to `replayToStreamEvents` (`:450-454`) and returns `blockOwners` and
  `syntheticToolResults`. Same parse, same events. Other callers are untouched.
- `libs/backend/rpc-handlers/src/lib/chat/session/chat-history-read.service.ts`, `readForResume`
  (`:67-75`): accepts `{ includeBlockOwners }` and passes it through.
- CREATE `libs/backend/rpc-handlers/src/lib/chat/session/history-block-owners.ts` (+spec): pure
  `selectDeliveredBlockOwners(fullEvents, delivered, blockOwners): Record<string, string>`.
  - Count each owner's events in `fullEvents`.
  - Walk `delivered` by index. Look up the owner by object identity.
  - Keep a message id only when its delivered count equals its full count. Otherwise drop all of
    its entries. This is the page-edge rule (review defect 3).
  - Object identity holds because the page is a slice of `fullEvents`
    (`libs/shared/src/lib/utils/history-page.utils.ts:139`).
  - Revision 2 (defect 1): second pure export
    `selectDeliveredSyntheticResults(delivered, syntheticToolResults): number[]`, the indices of
    `delivered` whose event object is in the set. A synthetic result cut off by the page edge is
    simply absent; the webview then has no history result for that id and rule T keeps the live
    one (B.2.3 a).
- `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts`, `resumeSession`:
  passes `params.historyBlockOwners === true` to `readForResume` (`:949`). After the page step
  (`:1074-1079`) it adds
  `historyBlockOwners: selectDeliveredBlockOwners(fullEvents, page?.events ?? fullEvents, blockOwners)`
  and `historySyntheticToolResults: selectDeliveredSyntheticResults(page?.events ?? fullEvents, syntheticToolResults)`
  to the success result (`:1080-1092`), only on opt-in.
- `libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.schema.ts`, `ChatResumeParamsSchema`
  (`:84-94`): `historyBlockOwners: z.literal(true).optional()`. The schema stays `passthrough`.
- **Revision 2 (defect 2): plan component 3, live message projection**
  (`libs/backend/rpc-handlers/src/lib/chat/streaming/live-message-projection.ts`, created by the
  plan, `implementation-plan.md:379-380`).
  - Each context gains `persistedBlocks: number`, set to 0 at **Open** (`implementation-plan.md:307-309`).
  - `observe` increments it for every event with the context's `messageId` and
    `source === 'complete'` whose type is in the compared domain: `text_delta`,
    `thinking_delta`, `tool_start` for the root context; `text_delta`, `tool_start` for a
    subagent context (the webview's domain rule, B.2 "Domain"). These events are counted, never
    stored (the plan's **Persisted boundary** rule, `:313-314`, still stores no complete event).
  - `buildSeed()` also returns `blockCounts: Record<messageId, number>` with one entry for every
    context it holds, seeded or deferred (`:337-339`). No cap; the entry costs one key and one
    integer per context that the projection already stores.
  - The byte cap (`:340-346`) clears a suffix but not `persistedBlocks`; a truncated context
    keeps its exact count.
  - **Why the count is the position of the next block in `H(X)`.** The coordinator calls
    `projection.observe` for every negotiated publish, visible or hidden, before routing
    (`implementation-plan.md:415-417`), so the count includes every complete block of X the
    host published before the snapshot. The seed suffix holds only stream events after X's last
    complete `message_complete` (`:310-314`), so the seed's first block of X is block `k0` of X.
    `H(X)` lists X's rendered blocks in record order (B.2, "History") and covers X only when the
    page holds all of X (owner rule, review defect 3). Both sides count the same domain. The
    remaining shared premise is A-B2 (the live and the persisted block sequences of one API
    message are equal), on which Revision 1 already rests (B.10 point 2).
- **Revision 2 (defect 2): plan component 4, coordinator**
  (`libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-delivery-coordinator.service.ts`).
  Every place that builds a resync snapshot from `buildSeed()` (4i, `implementation-plan.md:419`;
  the synchronous overflow path, `:435`) also sets `liveSeedBlocks: seed.blockCounts` when that
  map is non-empty. Live chunks themselves are unchanged (`:121-130`).

#### B.2.3 Webview (plan Batch F)

**(a) CREATE `libs/frontend/chat/src/lib/services/chat-store/persisted-content-filter.ts` (+spec).**

- A plain class with no DI, owned by the replayer. Precedent: plan component 3 uses a plain class
  owned by its caller. One instance per rebuilt tab.
- Inputs:
  - `tabId`, `sessionId`;
  - `history: ReadonlyMap<string, readonly BlockSignature[]>` (`H`, may be empty);
  - `historyToolResults: ReadonlyMap<string, { output: unknown; isError: boolean; synthetic: boolean }>`
    (Revision 2, replaces `historyToolResultIds`): per `toolCallId` of a replayed `tool_result`,
    its `output`, its `isError`, and whether the host listed it in
    `historySyntheticToolResults`;
  - `prefixMark: number | null`;
  - `seedMessageIds: ReadonlySet<string>` (every message id in `liveSeed`; host deferred
    anchors are not in the snapshot, `implementation-plan.md:418-425`, see B.5 "D-8");
  - `seedStartK: ReadonlyMap<string, number>` (Revision 2): `liveSeedBlocks` of the claim's
    snapshot, empty when absent;
  - `seedBlockKeys: ReadonlySet<string>` (the block key of every stream content event in the
    seed, defined in rule P);
  - `deliverToTab(event)`;
  - `reconcileHistoryToolResult(event: ToolResultEvent): boolean` (Revision 2, defect 1):
    patches the rebuilt tab's history tool node; see rule T and (e).
  - No timer (Revision 2, defect 3: the 5 s hold timer is removed, see "Holds").
- `decide(event, arrival?): 'keep' | 'drop' | 'hold'`. `drop` and `hold` exclude this tab only.
  "Content event" means the plan's content types (`text_delta`, `thinking_start`,
  `thinking_delta`, `tool_start`, `tool_delta`, `signature_delta`; `implementation-plan.md:316-317`).
  Rules, in order:
  - **P. Pre-snapshot stream copy (window ii).** Applies when `prefixMark !== null`,
    `arrival < prefixMark` and `event.source === 'stream'`. Premise (Revision 3, review note 3):
    the snapshot and the chat chunks reach the webview on one ordered channel (the host batch
    buffer keeps push order), so every entry with `arrival < prefixMark` was published before
    the snapshot. Rules P, P2 and P3 depend on it.
    - A content event whose block key is in `seedBlockKeys` → drop. Block key: `X|text|i`,
      `X|thinking|i` (for `thinking_start`, `thinking_delta`, `signature_delta`), with `i` the
      stream `blockIndex` (`backend/agent-sdk/src/lib/message-transform/stream-event.transformer.ts:51`);
      `X|tool|toolCallId` for `tool_start` and `tool_delta`.
    - A `message_start` of an X in `seedMessageIds` → drop. The seed carries X's anchor.
    - Anything else continues to the next rule. Complete batches are never dropped by rule P.
    - Why no loss: the seed holds X's anchor and every stream event of X since X's last
      complete batch, merged per block. A context that hit the byte cap has no suffix content
      (`implementation-plan.md:337-346`). So a seed content event for block B means the seed
      holds all of B's stream content, and the buffered copy adds nothing.
  - **P2. Pre-snapshot complete copy of a seed-start X (Revision 2, defect 2; Revision 3).**
    Applies when `prefixMark !== null`, `arrival < prefixMark`, `event.source === 'complete'`,
    X is in `seedStartK` and `H` has X. Revision 3: X does not need to be tracked yet (a
    truncated context's anchor is deferred, so rule I has not seen it). Every complete block of
    X published before the snapshot is one of X's blocks `0..k0-1`, and the page holds all of
    them (owner rule).
    - A complete block event whose signature equals some `H(X)[p]` with `p < k0` → drop. Tools
      compare by `toolCallId` (unique); text and thinking by the full string. The content is
      on screen in the history node, so nothing is lost even if `p` is not its exact position.
    - The `message_start` and `message_complete` of a pre-snapshot batch whose block events were
      all dropped → drop; otherwise keep.
    - No match → keep, and X's tracked state (`k`, `ks`, absorbed blocks), when X is tracked, is
      not changed: a pre-snapshot event is never compared at `k0` or later.
    - Revision 3, either outcome: for a complete `text_delta` / `thinking_delta` with string `s`,
      the first entry of `L(X)` (rule P3) of the same kind whose joined text is a prefix of `s`
      is discarded. When dropped, the history node shows `s`; when kept, the kept block renders
      `s` (`accumulator-core.service.ts:314-319` replaces the block text).
  - **P3. Pre-snapshot stream copy of a seed-start X with no seed copy (Revision 3).** Applies
    when `prefixMark !== null`, `arrival < prefixMark`, `event.source === 'stream'`, X is in
    `seedStartK`, `H` has X, and rule P did not drop the event. This is the byte-cap case: the
    projection cleared X's suffix (`implementation-plan.md:344-346`), so the seed holds none of
    X's pre-snapshot stream content and only the fence copy and the history copy exist.
    - "Flush" below means rule H's flush: X's queued non-content events go to `deliverToTab`
      in arrival order; absorbed slots stay absorbed. Every event of X that P2 or P3 keeps is
      preceded by a flush, so X's anchor always reaches the tab before X's content.
    - A `tool_start` / `tool_delta` whose `toolCallId` is a tool block of `H(X)` → drop (unique
      id; the history node shows the tool with its full input). Other tool events → flush,
      then keep.
    - A text or thinking content event (`thinking_start`, `text_delta`, `thinking_delta`,
      `signature_delta`) of block key `b`:
      - `b` is marked passed → flush, then keep.
      - The joined text of `b` (stored text plus this delta) is a prefix of the string of some
        same-kind block of `H(X)`, at any position (as P2) → **absorb**: store it in the
        per-X list `L(X)` with the same record as rule H (joined text, first delta,
        `thinking_start`, last `signature_delta`), and give a new entry a slot in X's queue at
        its first event, as rule H does. A `thinking_start` or `signature_delta` is stored on
        its entry and absorbed.
      - Otherwise → flush, release `b`'s entry rebuilt (rule H, "Mismatch": stored
        `thinking_start`, one merged delta with a fresh id, stored `signature_delta`) to
        `deliverToTab`, remove it from `L(X)` and its slot, keep the event, and mark `b` passed.
    - Other stream events of X (`message_start`, `message_delta`, stream `message_complete`) →
      append to X's queue (rule H, "Holds"). Rule I hands the queue and `L(X)` to the tracked
      or passthrough X (rule I, Revision 3).
    - P2 "keep" of a complete event of X is also preceded by a flush.
    - `L(X)` is bounded: each entry's text is a prefix of a block string in the delivered page,
      and the entry count is bounded by the fence's entry cap
      (`session-history-replayer.service.ts:465-480`).
    - Why no loss: an entry is discarded only when a complete copy that contains it is dropped
      (shown in history) or kept (rendered), when rule H continues it at an exact position, or
      at retirement under the rule H "Retirement" conditions (Revision 3). Every other path
      rebuilds it exactly. The only discard without a verified copy is the B.10 point 2 class:
      text identical to a block that stays on screen.
    - Why no duplicate in the review's two orderings: (a) B completes before the snapshot →
      its stream copy is absorbed here, its complete copy is dropped by P2 and discards the
      entry; (b) B is in flight at the snapshot → its stream prefix is absorbed here, then
      rule I/H continue it at `ks = k0` and drop its exact complete copy.
  - **T. `tool_result` (Revision 2, defect 1).** `h = historyToolResults.get(event.toolCallId)`.
    - Drop only when `h` exists, `h.synthetic === false`, `jsonEqual(h.output, event.output)`
      and `h.isError === event.isError`. The history node already shows exactly this result.
      `jsonEqual` is plain structural equality of JSON values (string, number, boolean, null,
      array, plain object); any false negative falls to the keep path, which is harmless.
    - Otherwise keep. A kept result reaches the live state and fires the Task completion signal
      with the real `isError` (`frontend/chat-streaming/src/lib/accumulator-core.service.ts:422-460`,
      signal at `:449-455`). When `event.toolCallId` is in `historyToolIds` (every `toolCallId`
      of a replayed `tool_start`, main and subagent), the filter also calls
      `reconcileHistoryToolResult(event)` (b, "Reconcile") and then stores
      `{ output: event.output, isError: event.isError, synthetic: false }` for that id, so a
      re-delivered copy is dropped by the first bullet.
    - Why a synthetic history result never hides the real one: replay synthesizes a result
      when an agent file exists but the parent result is not yet in the JSONL; its output is
      the agent's last text or `'[Agent completed]'` and `isError` is always `false`
      (`backend/agent-sdk/src/lib/helpers/history/session-replay.service.ts:375-415`). The real
      result is emitted later as a complete `tool_result` with the SDK's `content` and
      `is_error` (`backend/agent-sdk/src/lib/message-transform/user-message.transformer.ts:57-69`).
      A synthetic `h` is never a drop basis, so the real result is always kept and written into
      the history node.
    - Why the kept result does not render twice: the live tree attaches a result only to a live
      `tool_start` with the same id (`frontend/chat-execution-tree/src/lib/indexes/streaming-indexes.ts:186-188`;
      `frontend/chat-execution-tree/src/lib/builders/tool-node.fn.ts:163-165`). The tool's live
      `tool_start` is dropped (rule H, tool identity), so the result is shown only through the
      patched history node. When X passed through and its tool also shows live, that tool
      duplicate is the existing fail-open case and the live node shows the same real result.
    - Revision 1's "hold the result behind a queued stream `tool_start`" bullet is removed: a
      stream `tool_start` of a history tool is never delivered to this tab (rule H), so there is
      no live tool for the result to precede.
  - **R. Retire events.** A terminal `turn_state` (`isTerminalTurnPhase`,
    `libs/shared/src/lib/types/execution/stream-background.ts:248`) or `compaction_complete`
    → keep, then retire the filter (b, "Lifetime"). Seed events reach `decide` only when they
    are message-scoped (b, "Seed through the filter"), so a seed turn state never retires it.
  - **O. Events without an assistant message scope** → keep. An event is message-scoped
    when it carries the `messageId` of an assistant message and is not a `tool_result` (rule
    T). Turn, session and compaction events, and user-message events, are not.
  - **I. First event of X.** Revision 2 adds the seeded start.
    - X is in `seedStartK` (seed anchor, or a deferred anchor arriving live): when `H` has X
      and `k0 = seedStartK.get(X) < |H(X)|`, X is tracked with `k = ks = k0`; otherwise X
      passes through with no state.
    - Else X passes through, with no state stored, when any holds: X is in `seedMessageIds`
      (older host without `liveSeedBlocks`); the event is not a stream `message_start`; `H` has
      no X. Otherwise X is tracked with `k = ks = 0`.
    - A tracked X starts with an empty queue, no absorbed block and no open batch.
    - Revision 3: an event with `arrival < prefixMark` never starts tracking (rules P, P2 and
      P3 handle it, or it is kept). The `seedStartK` bullet applies to the first event of X
      that is post-snapshot (no `arrival`, or `arrival >= prefixMark`). At that point X's P3
      queue and its `L(X)` entries move to X: tracked or passthrough, the queue becomes X's
      queue and each `L(X)` entry becomes a **loose** absorbed block (no position yet), which
      rule H or rule S resolves.
  - **S. Passthrough X.** Keep, except a `tool_start` / `tool_delta` of a tool in X's history
    set (rule H, "Tool identity") → drop. When X still has a queue (after a full drop, see H;
    the pending queue of rule H's last bullet; or a queue handed over by rule I, Revision 3):
    a content event flushes the queue to `deliverToTab` in order, then is kept;
    any other event of X is appended to the queue.
    - Revision 3, loose blocks of a passthrough X (rule I passed X through because
      `k0 >= |H(X)|`, so X's block at `k0` and later are not in the page):
      - A content event whose block key is a loose block's key → flush, release that block
        rebuilt (rule H, "Mismatch"), then keep. It is the block that was in flight at the
        snapshot, at a position not in the page, so it must show live.
      - A complete `text_delta` / `thinking_delta` of X with string `s` (kept) → discard the
        first loose block of the same kind whose joined text is a prefix of `s`; the kept block
        renders `s`.
      - Retirement → discard loose blocks (rule H, "Retirement").
  - **H. Tracked X** (Revision 2, defect 3: stream content of a verified block is absorbed, not
    held). State: `k` (next complete position), `ks` (next stream position), absorbed blocks
    keyed by stream block key (`text|i`, `thinking|i`, `tool|toolCallId`, as rule P), a queue of
    non-content events in arrival order with one slot per absorbed text or thinking block at its
    first event, and the open batch.
    - **Tool identity.** A `tool_start` (stream or complete) or `tool_delta` of X whose
      `toolCallId` equals a tool block of `H(X)` → drop. Tool ids are unique, so this is the
      same tool that the history node shows with its full input; its subagent events nest
      under that node (B.5, "D-1"). A complete `tool_start` that matches at position `k` also
      advances `k`; a stream one at position `ks` advances `ks`. A tool block of `H(X)` is never
      rebuilt or released.
    - **Stream content, new block** (first event of a stream block key, or Revision 3: the
      first post-snapshot event of a loose block's key): position `pos = ks`. For a loose
      block, the joined text in the checks below is its stored text plus this delta, and on
      absorb the loose block becomes the absorbed block at `pos` (it was in flight at the
      snapshot, so under A-B2 its position is `k0 = ks`).
      - `pos >= |H(X)|`: the block is beyond the persisted page. Flush the queue's non-content
        events to `deliverToTab` in order (absorbed slots stay absorbed); for a loose block,
        release it rebuilt ("Mismatch" form); then keep the event; later events of this block
        are kept. X stays tracked for its absorbed blocks.
      - Kind differs from `H(X)[pos]`, or a stream `tool_start` whose id is not `H(X)[pos]`'s,
        or a first delta that is not a prefix of `H(X)[pos]`'s string → **mismatch**.
      - Otherwise **absorb**: record `pos`, `ks += 1`, store the joined text so far (or the
        `thinking_start` event), exclude this tab.
    - **Stream content, absorbed block:** a `text_delta` / `thinking_delta` whose joined text
      stays a prefix of `H(X)[pos]` → absorb (append to the stored text); otherwise **mismatch**.
      A `signature_delta` → store it on the block (last one wins) and absorb.
    - Subagent stream thinking (outside the domain) → flush the queue's non-content events,
      then keep. Other stream events of X (anchor, `message_delta`, stream `message_complete`)
      → append to the queue (hold).
    - A complete `message_start` → hold as the open batch's head.
    - A complete block event (`text_delta`, `thinking_delta`; tools see "Tool identity"):
      - Subagent thinking (outside the domain) → flush the queue, then keep. `k` unchanged. The
        batch is marked kept.
      - `k >= |H(X)|` → flush the queue (batch head included), then keep; batch marked kept.
      - Signature equals `H(X)[k]` → drop; discard the absorbed block at position `k`, if any
        (its text is a prefix of this exact block, which the history node shows); `k += 1`.
        Revision 3: when no block is absorbed at `k`, discard the first loose block of the same
        kind whose joined text is a prefix of `H(X)[k]` (a block whose complete batch lagged
        the snapshot; the history node shows it).
      - Revision 3: in the two "keep" bullets above, a kept complete text or thinking block
        with string `s` also discards the first loose block of the same kind whose joined text
        is a prefix of `s` (the kept block renders `s`).
      - Otherwise **mismatch**.
    - A complete `message_complete`, or another complete-source event of X inside the open
      batch (for example a Task tool's `agent_start`): when every block event of the batch so
      far was dropped → drop it; at `message_complete` also discard the batch head. Otherwise
      keep it. `message_complete` ends the batch.
    - A complete-source event of X outside an open batch → keep (fail open).
    - **Mismatch** → X passes through (rule S). Release, in arrival order, the queue with every
      absorbed text or thinking slot rebuilt: the stored `thinking_start` (if any), then one
      stream `text_delta` / `thinking_delta` that copies the block's first absorbed delta with
      `delta` = the stored joined text and a fresh event id, then the stored `signature_delta`
      (if any). Then keep the current event. A stream delta is appended to its block
      (`frontend/chat-streaming/src/lib/accumulator-core.service.ts:320-322`), so one merged
      delta renders exactly what the absorbed deltas would have; the plan's projection merges
      deltas the same way for the seed (`implementation-plan.md:310-312`). Nothing absorbed is
      lost. Revision 3: loose blocks hold queue slots (rule P3), so they are rebuilt in the
      same release.
    - When `k == |H(X)|`, `ks == |H(X)|` and no batch is open, X passes through. A queue that
      still holds the anchor without kept content stays as X's pending queue for rule S.
- **Holds and absorption: bounds and release paths** (Revision 2, defect 3).
  - **No expiry release.** The 5 s timer and the 2000-event release of Revision 1 are removed.
    Revision 1 released held content of a block whose stream was still a verified prefix of a
    persisted block; a later exact complete batch was then dropped, leaving the history node
    plus a partial live node (`accumulator-core.service.ts:297-322`). Now no event of a block
    that still matches is ever delivered, at any delay, so no partial live node can exist for
    it. An exact complete block that arrives late, at any time before retirement, is dropped
    against a tab that shows only the history copy.
  - **Why no loss without a timer.** An absorbed block's every character is a prefix of the
    block that the history node shows at the same position of the same API message. If the
    stream ever diverges, or the complete block differs, the mismatch path rebuilds the
    absorbed text exactly. If the turn ends first, the absorbed prefix is discarded at
    retirement while its full block stays on screen in the history node.
  - **Memory.** Absorbed text is at most the length of `H(X)[pos]`, which is in the delivered
    page. Tool blocks keep no text. The queue holds only non-content events: the anchor, a batch
    head, and per SDK message its stream `message_delta` and `message_complete`. A tracked X
    stops queuing at its first block beyond the page (flush). So the queue is bounded by a small
    constant times `|H(X)|`.
    - Assumption RB2-A1: the stream path emits at most one `message_start`, one `message_delta`
      and one `message_complete` per API message. Check: `stream-event.transformer.ts:181-198,290-327`
      (cited by `implementation-plan.md:350`). Defensive bound: a queue longer than
      `4 * |H(X)| + 4` is a malformed producer; the filter logs one `console.warn` and takes the
      mismatch path (a possible duplicate, only for a malformed stream).
  - Retirement: absorbed blocks are discarded (their content is in the history node).
    Revision 3, loose blocks and `L(X)` entries still unresolved at retirement:
    - Only X's **last** pre-snapshot stream block (latest first arrival among all of X's
      pre-snapshot stream blocks, passed ones included) can be in flight; every earlier one
      ended, because the stream sends one block of a message at a time.
    - An earlier block is discarded when its joined text is a prefix of a same-kind `H(X)[p]`
      with `p < k0`: it ended before the snapshot and its complete batch, published while the
      tab was hidden, never reaches the webview, so the history node is its only full copy. An
      ended block whose complete batch lagged the snapshot is resolved by that batch before
      the terminal (the A-1 premise of B.10 point 8). Otherwise it is released rebuilt.
    - The last block is discarded only when its joined text **equals** a same-kind `H(X)[p]`
      with `p < k0` (the history node shows identical text). Otherwise it is released rebuilt
      ("Mismatch" form) before the retiring event: it can be the block in flight at an aborted
      turn, at a position the page may not hold, so it is never lost. The cost is a possible
      partial duplicate when it had in fact ended and been persisted; that needs a truncated
      context and a retirement before any later event of X, and it loses nothing. A queue
    is released in order when X has kept content, and discarded otherwise, so a message with
    nothing kept never gets an empty live bubble (plan D-8, `message-node.fn.ts:44-54`).
  - Release order: per message, the original arrival order. Each released or rebuilt event goes
    to `deliverToTab` only, because siblings already received the originals.

**(b) `session-history-replayer.service.ts`.**

- **Fence entries.** `LiveEventFence.buffered` (`:78`) becomes
  `Array<{ deliver: (excludeTabIds?: ReadonlySet<string>) => void; event: FlatStreamEventUnion; arrival: number }>`.
  `arrival` comes from a private counter, incremented in `deferLiveEvent` when it buffers
  (`:480`). RA-2 moves whole entries, so `arrival` survives the hand-over.
- **Arrival mark.** `liveArrivalMark(): number` returns the counter's current value.
- **Per-claim inputs.** Stored by claim number, like the seed (plan component 8), deleted by
  `release` and by supersede:
  `setPersistedFilterInputs(claim, { ownerByEvent: ReadonlyMap<FlatStreamEventUnion, string> | null, syntheticResults: ReadonlySet<FlatStreamEventUnion> | null, prefixMark: number | null })`.
  The seed's `liveSeedBlocks` is stored with the seed itself (plan component 8), as
  `seedStartK`.
- **History index.** `replay` (`:191-233`) builds `H`, `historyToolResults` and
  `historyToolIds` while it processes events (`:209-218`). An event that `ownerByEvent` names
  appends its signature to `H(owner)`. Each replayed `tool_result` stores
  `{ output, isError, synthetic }`, with `synthetic = syntheticResults === null || syntheticResults.has(event)`
  (Revision 2: a missing or malformed list makes every history result synthetic, so no live
  result is dropped). Each replayed `tool_start` adds its `toolCallId` to `historyToolIds`.
  Only events that replay passes to `processStreamEvent` are indexed.
- **Building the filter.** `closeFence` (plan component 8) builds it when the closing claim is
  current, the tab is still bound (the seed's guard), and `H` is non-empty, `historyToolIds` is
  non-empty, or `prefixMark !== null`. It registers the filter in
  `persistedFilters: Map<tabId, PersistedContentFilter>` before the seed runs. `seedMessageIds`,
  `seedBlockKeys` and `seedStartK` are read from the seed and its snapshot.
- **Seed through the filter (Revision 2, defect 2).** Plan components 5 and 8 apply the seed
  unfiltered. With a filter, `closeFence` first passes each message-scoped seed event of an X
  in `seedStartK` to `decide(event)` (no `arrival`, so rules P and P2 do not apply; the seed is
  post-snapshot). The other seed events, and every seed event when there is no filter or no
  `seedStartK`, are unchanged. `applySeed` is called once with the kept events in seed order;
  absorbed and held seed events follow the rule H release paths. Plan component 5's `applySeed`
  therefore takes the event list to apply (both in Batch F; Assumption RB2-A2: today's plan
  text has it close over the snapshot's `liveSeed`, `implementation-plan.md:511-532`; the
  implementer passes the filtered list instead).
- **Reconcile (Revision 2, defect 1).** `reconcileHistoryToolResult(event)`:
  - Reads the tab with `tabManager.findTabByIdAcrossWorkspaces(tabId)` (the replayer already
    injects `TabManagerService`, `session-history-replayer.service.ts:99`, and uses this lookup
    at `:387`, `:407`).
  - Calls the new pure `patchHistoryToolResult(tab.messages, event)` (CREATE
    `libs/frontend/chat/src/lib/services/chat-store/history-tool-result-patch.ts`, +spec). It
    walks each message's finalized tree (`ExecutionChatMessage.streamingState: ExecutionNode | null`,
    `libs/shared/src/lib/types/execution/agent.ts:100`). A node with `type === 'tool'` and this
    `toolCallId` gets exactly the fields that `buildToolNode` derives from a result:
    `status: 'complete'`, `toolOutput: event.output`, `isError: event.isError`,
    `isPermissionRequest: event.isPermissionRequest`
    (`libs/frontend/chat-execution-tree/src/lib/builders/tool-node.fn.ts:213-226`). A node with
    `type === 'agent'` and this `toolCallId` gets `status: 'complete'`, the only field a Task
    result sets on it (`agent-node.fn.ts:112,119`). Copy on write along the changed path; the
    same array is returned when nothing changed.
  - Writes with `tabManager.setMessages(tabId, patched)` (`libs/frontend/chat-state/src/lib/tab-manager.service.ts:1814-1816`),
    which also reaches a tab of a background workspace (`updateTabInternal`, `:1334-1384`).
  - Precedent: `markAgentsAsInterruptedByToolCallIds` patches a finalized tree by `toolCallId`
    and writes it with `setMessages`
    (`libs/frontend/chat-streaming/src/lib/message-finalization.service.ts:431-461`).
  - Where the history node lives: replay finalization builds the tree from the replayed
    events and installs it in `tab.messages` with `streamingState: null` on the tab
    (`message-finalization.service.ts:281-303`; `tab-manager.service.ts:2010-2016`). Live events
    after that build a new streaming state, so the history tool node is reachable only through
    `tab.messages`.
  - Returns `false` (and logs one `console.warn`) when no node matched; the result is still
    kept in the live state.
  - Assumption RB2-A3: a later live turn finalization reads `tab.messages` when it runs, so it
    does not overwrite the patch (`placeFinalizedTrees(existingMessages, ...)`,
    `message-finalization.service.ts:249-251`). Check: where `existingMessages` is read above
    `:249`.
- **`deliverToTab`** is `this.streamingHandler.processStreamEvent(event, tabId, sessionId, { fanOut: false })`,
  the call replay already uses (`:212-217`) minus `isReplay: true` (Revision 3, review note 1:
  `isReplay` only gates the live user `message_start` reconcile, and `deliverToTab` carries
  assistant-scoped events only).
- **Delivery.** `deliverAll` (`:539-550`), the RA-2 per-closure drain, the overflow delivery
  (`:476-478`) and the after-close path ask every registered filter whose session equals the
  entry's session. Tabs that answer `drop` or `hold` form `excludeTabIds`; then
  `entry.deliver(excludeTabIds)`. The try/catch per entry is kept. A claim whose own fence
  overflowed builds no filter (D-10 / RA-3 rebuild it).
- **After close (B.1.2).** In `deferLiveEvent`, when no fence holds the event (`:463-464`), ask
  the same filters. When any answers `drop` or `hold`, call `deliver(excludeTabIds)` and return
  `true`.
- **Lifetime.** The filter retires (releases per (a), is deleted):
  - at rule R (terminal `turn_state` or `compaction_complete` from the buffer or the live
    stream);
  - at `claim` for its tab (`:143`), before the claim is installed, so released events land
    before the new fence like any event applied before a claim;
  - at resync arrival, through `retirePersistedFilter(tabId)` called by the loader.
  - It is discarded without release when its tab is closed or rebound, checked lazily at each
    consult with `findTabByIdAcrossWorkspaces`, as the seed guard does.
  - Why rule R is a sound barrier: `turn_state` travels in the chunk stream through the
    coordinator, and a terminal is delivered after the turn's batches
    (`implementation-plan.md:101,978`). Content persisted at the read belongs to the turn active
    at the read or an earlier one, so all its live events precede that turn's terminal. Edge: a
    turn ends and a new one starts between the claim and the read. The first terminal then
    retires the filter before the new turn's persisted blocks arrive. They show twice; nothing
    is lost.
- **Memory.** One filter per tab. `H`, `historyToolResults` and `historyToolIds` are bounded by
  the delivered page; `seedStartK` by the projection's contexts. Message state exists only for
  messages in `H` that arrived live or in the seed. Absorbed text and queues are bounded per (a),
  "Holds and absorption". No timer, no observer.

**(c) `chat-message-handler.service.ts`.**

- `applyChatStreamEvent` (`:513-529`) builds `deliver(excludeTabIds?)`:
  - Without exclusions it is unchanged.
  - With exclusions it applies the event to every active tab bound to the event's session
    except the excluded ones, each with `chatStore.processStreamEvent(event, tab.id, sessionId, { fanOut: false })`,
    then calls `streamRouter.routeStreamEvent` once, as today.
  - The tab set mirrors the fan-out rule in `streaming-handler.service.ts:247,254,314-325`.
- Revision 2 (defect 2): `parseStreamSnapshot` / `handleStreamSnapshot` read `liveSeedBlocks`.
  Valid: a plain object, every value a non-negative safe integer, every key non-empty, and
  `resyncRequired === true`. Malformed: `console.warn` and treat it as absent (the older-host
  path: seeded messages pass through), the rest of the snapshot stays valid. The map is handed
  to the claim with the seed (plan component 8). `applySeed` applies the event list it is given
  (b, "Seed through the filter").
- `chat.store.ts` `deferLiveStreamEvent` (`:439`): passthrough of the new `deliver` type.

**(d) `session-loader.service.ts`.**

- **Resync arrival.** Synchronously, next to the plan's `resyncGeneration` step and before any
  `await`: take `prefixMark = historyReplayer.liveArrivalMark()` and call
  `historyReplayer.retirePersistedFilter(targetTabId)`.
- **`chat:resume` request** (`:855-868`): add `historyBlockOwners: true` when the call holds an
  early claim (resync, and compaction per RA-1).
- **On a verified reply,** before `replay` (`:938`):
  - Validate `historyBlockOwners`: a plain object; every key a decimal integer in
    `[0, events.length)`; every value a non-empty string.
  - Malformed: `console.warn`, and `ownerByEvent = null`. Rule P can still run, since it needs
    only the seed.
  - Convert it at once to `Map<event, owner>` against the reply's `events` array, so later
    transformations of the array cannot shift indices.
  - Revision 2 (defect 1): validate `historySyntheticToolResults`: an array of distinct decimal
    integers in `[0, events.length)`, each naming a `tool_result` event. Convert to
    `Set<event>` the same way. Absent or malformed (`console.warn`): `syntheticResults = null`,
    which makes every history result synthetic (rule T never drops; it reconciles on any
    difference). That is the safe direction: no loss, at most one redundant patch.
  - Call `setPersistedFilterInputs(replayClaim, { ownerByEvent, syntheticResults, prefixMark })`.
    `prefixMark` is non-null only for a resync whose snapshot carried `liveSeed` or
    `liveSeedBlocks` (proves a host with a projection).
- **Not requested** for plain targeted and untargeted loads. Those paths stay as today.

**Ordering at close (one claim).** Replay (builds `H`) → finalize → `closeFence`: build and
register the filter → seed, through the filter for messages in `seedStartK` and unfiltered
otherwise (Revision 2) → `leaveFence` drains the buffer in arrival order through the filter →
later live events through the filter until it retires.

### B.3 Rejected options

- **Pass live message ids to `chat:resume` for exclusion** (the plan's open question 3 option).
  - The ids are not known when the request is sent. M in B.1.1 can start during `session:load`
    or `chat:resume` itself.
  - Excluding the seeded message X removes its blocks persisted before the snapshot. Neither the
    seed nor the buffer holds them, so they are lost (plan D-1).
  - Excluding a message with a Task `tool_use` orphans its subagent transcripts (plan D-1).
  - It changes the history shape for every consumer of `session-replay.service.ts`.
- **Webview dedup by message id when draining the fence.** The ids never match: history uses the
  first record's `uuid` (`session-replay.service.ts:219-220`), live uses the API id
  (`assistant-message.transformer.ts:88`).
- **Unscoped content matching.** Short repeated texts ("Done.") make it ambiguous, and live
  timestamps are transform time (`assistant-message.transformer.ts:126`). RB's match differs: it
  is scoped to one API `message.id` and one position, compares the full string, and uses the
  exact id for tools.
- **Per-message record counts (first draft).** A count is not a block identity: one SDK message
  can map to several records (`session-usage-ledger.ts:119-131`). The counts also covered the
  full parse, not the page, and agent records that replay does not render (review defects 1-3).
- **Host-computed block signatures with a hash** (evaluated as asked). The host returns, per
  `message.id`, an ordered list such as `kind + toolCallId` or `kind + length + hash`.
  - The host still needs to know which events are in the page, which is the same owner map.
  - The hash must be implemented identically in Node and in the browser, and adds a collision
    path.
  - The webview already holds both strings, so exact comparison is cheaper and exact.
- **Stamp the API id on every history event.** It changes the `FlatStreamEvent` contract
  (`libs/shared/src/lib/types/execution/stream.ts:60-91`) and the output of every replay consumer.
  The opt-in side map leaves events untouched.
- **Host block ordinals per `message.id`.** The live side cannot compute the same number: the
  transformer's `blockIndex` indexes the filtered content of one SDK message
  (`assistant-message.transformer.ts:53-54,119,131,146`), and skipped blocks are invisible to the
  webview. Sequential comparison with fail-open needs no ordinal.
- **Retire at a host high-water mark or sequence cut.** Live chunks carry no sequence
  (`chat-stream-delivery-coordinator.service.ts:121-130`); the global sequence exists only on
  snapshots (`implementation-plan.md:391-397`). No source shows that an SDK message reaches the
  host before its JSONL line is visible to a read, so a mark taken at the read does not bound the
  late live copies. RB uses the turn's terminal event instead (B.2.3 b).
- **Drop the stream deltas of a candidate block without keeping them.** When the alignment is
  wrong, its streamed content is lost. Revision 2's absorption differs: it keeps the joined text
  (bounded by the history block it is a prefix of) and rebuilds it exactly on any mismatch.
- **Revision 2, rejected for defect 3: release at expiry, then remove one copy when the exact
  complete block arrives** (the review's suggested direction).
  - Remove the live copy: the accumulator has no operation that takes a block out of a
    streaming state; complete events only replace (`accumulator-core.service.ts:297-322`). A new
    removal path in `chat-streaming` would be needed for text, thinking and tools.
  - Remove the history copy: a text or thinking block of the finalized tree has no verified
    mapping from a history event to its tree node (only tool and agent nodes carry the
    `toolCallId`, `tool-node.fn.ts:213-226`, `agent-node.fn.ts:116-126`).
  - Absorption makes both unnecessary: a verified block is never released, so no second copy
    exists to remove.
- **Revision 2, rejected for defect 1: keep every live `tool_result` without a history patch.**
  The live tree attaches a result only to a live `tool_start` (`tool-node.fn.ts:163-165`), so
  the real output would never be shown: the history node keeps the synthetic output.
- **Revision 2, rejected for defect 1: request a fresh resync when the real result differs.**
  A full tab rebuild per tool result, and the read can again precede the JSONL line and
  synthesize again (`session-replay.service.ts:375-415`), so it needs a retry bound and still
  shows the wrong state meanwhile.
- **Drop every pre-snapshot message-scoped event (first draft rule 1).** It drops complete
  batches on timing (A-1) alone. Rule P drops only stream events that the seed itself holds.
- **For window (ii), drop the pre-snapshot entries for all tabs.** The fence is per session and
  entries fan out to sibling canvas tabs (`session-history-replayer.service.ts:67-73`;
  `streaming-handler.service.ts:314-325`). Siblings were not rebuilt.
- **For window (ii), deliver the pre-snapshot entries at R2's arrival.** It puts live events
  between sibling replays' history chunks (`session-history-replayer.service.ts:443-450`).
- **Keep the stream anchor of a fully persisted message.** It leaves an empty live bubble that is
  finalized empty (plan D-8, `message-node.fn.ts:44-54`).
- **Accept and document** (open question 3's original recommendation). The user decided to fix
  it in this task.

### B.4 Compatibility

- **Who is touched.**
  - Shared: optional fields on `ChatResumeParams` / `ChatResumeResult` (`historyBlockOwners`,
    and in Revision 2 `historySyntheticToolResults`), and Revision 2's optional snapshot field
    `liveSeedBlocks` next to the plan's `liveSeed` (with its schema refine).
  - Host: `agent-sdk` replay (optional collector) and reader (opt-in option); `rpc-handlers`
    resume handler, a new pure helper and the params schema; Revision 2: the plan's projection
    and coordinator (one counter per context, one snapshot field).
  - Webview: `@ptah-extension/chat` only. `chat-streaming` and `chat-state` are unchanged; the
    excluded and released deliveries reuse the plan's `fanOut: false` passthrough, and the
    history patch reuses `TabManagerService.setMessages`.
- **Revision 2, partial peers.** A host that sends owners but no `historySyntheticToolResults`
  is treated as "all synthetic" (no tool result dropped). A snapshot without `liveSeedBlocks`
  leaves seeded messages unfiltered, as in Revision 1 (old-host path only).
- **New webview, old host.** `ChatResumeParamsSchema` is `passthrough` (`chat-rpc.schema.ts:84-94`).
  An old host ignores the opt-in and returns no owners, so `H` is empty. An old host sends no
  `liveSeed`, so `prefixMark` is `null`. No filter is built. The tab behaves as with the approved
  plan: the OQ3 duplicates remain and nothing is lost.
- **Old webview, new host.** The host adds owners only on request, and an old webview never asks.
  The reply is unchanged.
- **Mixed shapes.** The webview validates `historyBlockOwners` (B.2.3 d). Malformed owners
  disable the signature rules with a `console.warn`.
- **VS Code and Electron.** Both load the same webview and the same `rpc-handlers` resume handler
  (plan evidence, `rpc-handlers/src/lib/chat/di.ts:69-72`). The Electron host and webview ship
  together.
- **CLI/TUI: unaffected.** The CLI calls `chat:resume` (`apps/ptah-cli/src/cli/session/chat-bridge.ts`)
  without the opt-in. The reader option defaults to `false` and the replay collector is optional.
- **Rollback.** Every field is optional. Reverting the webview restores the plan's behaviour.
  Reverting the host disables the signature rules; rule P still needs only the seed.

### B.5 Interaction with D-5, D-9, D-10, RA-n, fence and seed

- **D-5 (resync supersedes resync): unchanged; the filter follows it.**
  - R2's arrival retires any filter for the tab and takes its own `prefixMark`, synchronously,
    next to the `resyncGeneration` step.
  - R1's inputs belong to R1's claim number and are deleted on supersede, like R1's seed. A
    superseded claim never builds a filter, because `closeFence` returns early for a claim that
    is not held (`session-history-replayer.service.ts:521-523`).
  - The (S1, H2) entries buffered under R1 have `arrival < prefixMark` and fall under rule P.
- **D-9: unchanged.**
  - *Resync waits behind a compaction.* The mark is taken at the resync's arrival. Events
    buffered during the wait are post-snapshot and see only the signature rules.
  - The compaction's close may build a filter. The reservation keeps the buffer closed, so it
    sees no live event. The resync's own `claim` retires it.
  - *Compaction arrives during a resync.* It is skipped before the RA-1 claim (A.5), so it never
    requests owners.
- **D-10 / RA-3: unchanged.** A claim whose fence overflowed builds no filter. The fresh resync
  rebuilds the tab with its own inputs. A filter registered earlier by another tab is still asked
  on overflow delivery, because that tab's state is final.
- **RA-1:** the compaction requests owners. It has no seed and no prefix. Messages after the
  trigger start with a stream anchor, so they are tracked from `k = 0`. Pre-boundary records are
  not in the post-boundary replay (`session-replay.service.ts:83-100`), so they are not in `H`.
- **RA-2:** the hand-over moves whole entries with their `arrival`. The per-closure drain asks
  the filters before each delivery.
- **RA-4:** unchanged. `reconcileTab` uses `session:status`, not stream events.
- **Fence.** Arrival order, "seed, then buffer", and one-throw isolation (`:539-550`) are kept.
  Exclusion is per tab; siblings receive every event; the router is called once per event.
  Released events go to the rebuilt tab only.
- **Seed (Revision 2).** Message-scoped seed events of a message in `seedStartK` pass through
  `decide` before `applySeed` (B.2.3 b, "Seed through the filter"); all other seed events are
  applied unfiltered as plan components 5 and 8 say. A seed `turn_state` is not message-scoped,
  so it never reaches `decide`: it neither retires the filter nor changes D-3. "Seed, then
  buffer" order is kept: absorbed or held seed events of X sit at the head of X's queue.
- **D-8 (host deferred anchors), Revision 2:** a deferred anchor is not in `liveSeed`, but its
  context is in the projection, so `liveSeedBlocks` has its `k0`. The host injects the anchor as
  a live stream `message_start` before X's first content chunk after the snapshot
  (`implementation-plan.md:418-425`). Rule I tracks X from `k0`, X's real next position. The
  Revision 1 effect (tracked from `k = 0`, pass-through, possible duplicate) remains only for an
  older host without `liveSeedBlocks`.
- **D-1 and subagents.** Nothing is removed from the history. A dropped live Task `tool_start`
  leaves later live subagent events to nest under the history Task node, as after any resume of
  a live session today (plan A-2).
- **OQ1 (accepted two-node split) still holds.** When the sequences match, each block is in
  exactly one node: compared blocks `0..k-1` of X are in the history node, later blocks in the
  live node. When they do not match, X passes through: a duplicate, never a loss.
- **Tool results across the split (Revision 2).** A tool whose `tool_start` is in the history
  node gets its live result through the history patch (rule T), and the Task completion signal
  through the kept live event. A tool started live gets its result in the live node, as today.

### B.6 Preserve list

| Behaviour | Where today | Kept by |
| --- | --- | --- |
| History event shape, ids and grouping by first record `uuid` | `session-replay.service.ts:83-87,215-232` | The collector parameter is optional and only reads; output is identical |
| `readSessionHistory` return shape for every existing caller | `session-history-reader.service.ts:190-204,450-462` | New option defaults to `false` |
| Default `chat:resume` reply, including paging | `chat-session.service.ts:1074-1092` | Field added only on opt-in |
| CLI `chat:resume` use | `apps/ptah-cli/src/cli/session/chat-bridge.ts` | No opt-in sent |
| Unknown `chat:resume` params pass | `chat-rpc.schema.ts:84-94` (`passthrough`) | Only a typed optional key is added |
| Snapshot payload and schema | `payload-map.ts:254-262`; `schemas.ts:204-234` | RB adds nothing |
| Live events stay in arrival order; buffer delivered when the last holder leaves | `session-history-replayer.service.ts:503-536` | Same order; per-tab exclusion; releases keep per-message order |
| One throwing delivery does not strand the rest | `:539-550` | try/catch per entry kept |
| Fence bound, warning and in-order early delivery | `:465-479` | Unchanged; an overflowed claim builds no filter |
| Sibling canvas tabs receive every session event | `streaming-handler.service.ts:314-325`; `session-history-replayer.service.ts:67-73` | `deliver(excludeTabIds)` excludes only the rebuilt tab |
| Router sees every event once | `chat-message-handler.service.ts:518-522` | Router call kept in both delivery forms; releases do not route again |
| Accumulator, dedup and append/replace semantics | `accumulator-core.service.ts:249-326,370-420` | `chat-streaming` is not modified |
| Seed applied after finalize and before buffered events | plan components 5 and 8 | Seed is not filtered |
| Status recovery from the seed turn state, or the probe | plan D-3, component 7 | Turn states are never dropped or held |
| Plain targeted and untargeted loads | `session-loader.service.ts:824,855-868` | No owners requested, so no filter |
| Accepted two-node split (OQ1) | plan open question 1 | B.5, last point |
| `chat-stream-delivery-coordinator.ws-switch-resync.spec.ts` | whole file | Must pass unchanged (plan Batch B rule) |
| `session-replay.service.spec.ts`, `session-history-reader.service.spec.ts`, `session-history-replayer.service.spec.ts`, `session-loader.service.spec.ts`, `chat-message-handler.service.spec.ts` | existing cases | Must pass. Only the fence entry type changes; specs that push raw closures adapt helpers, not assertions |

### B.7 Regression tests

The webview tests live in
`D:/projects/ptah-extension/.claude-worktrees/fix-workspace-switch-stream-flush/libs/frontend/chat/src/lib/services/chat-store/session-history-replayer.service.spec.ts`,
which drives `claim`, `deferLiveEvent`, `replay` and `release` against a `StreamingHandlerService`
double. Each `deliver` is a `jest.fn()`. Tab `tab-A` is bound to session `S`; `tab-B` is a canvas
sibling bound to `S`. `owners(...)` builds the `ownerByEvent` map from history events.

**R-B1, window (i): a block persisted before the read is not applied twice.**

- Setup: `claim = replayer.claim('tab-A', S)`. Buffer through `deferLiveEvent(event, 'tab-A', S, deliverN)`:
  e1 stream `message_start` M; e2 stream `text_delta` M `blockIndex 0` "Hello"; e3-e5 complete
  batch M (`message_start`, `text_delta` "Hello", `message_complete`); e6 stream `text_delta` M
  `blockIndex 1` " world". History: `message_start(u1)`, `text_delta(u1)` "Hello",
  `message_complete(u1)`; `setPersistedFilterInputs(claim, { ownerByEvent: owners(h1 → 'M'), prefixMark: null })`.
- Steps: `await replayer.replay(history, claim, S, undefined)`.
- Assert: `deliver1..deliver5` each called once with a set containing `'tab-A'`;
  `processStreamEvent(e1, 'tab-A', S, { fanOut: false })` (anchor flush) before `deliver6`;
  `deliver6` called with no exclusion; e2-e5 never reach `tab-A`.
- Without the fix every `deliverN` is called with no argument.
- Variant (`it.each`): a compaction claim (no seed). Covers B.1.4.

**R-B2, window (ii): pre-snapshot stream copies of a seed-held block are dropped, nothing else.**

- Setup: `claim1 = replayer.claim('tab-A', S)`. Buffer p1: stream `text_delta` X `blockIndex 1`
  "abc" (`deliverP1`); p2: stream `text_delta` X `blockIndex 0` "old" (`deliverP2`); p3: stream
  `text_delta` Y `blockIndex 0` "zz" (`deliverP3`). `mark = replayer.liveArrivalMark()`.
  `claim2 = replayer.claim('tab-A', S, applySeed)` with σ2 = [stream `message_start` X, stream
  `text_delta` X `blockIndex 1` "abcdef"]. Buffer q1: stream `text_delta` X `blockIndex 1` "g"
  (`deliverQ1`). `setPersistedFilterInputs(claim2, { ownerByEvent: null, prefixMark: mark })`.
- Steps: `await replayer.replay(history, claim2, S, undefined)`.
- Assert: `applySeed` called once with σ2 unchanged; `deliverP1` called with `{'tab-A'}`;
  `deliverP2` and `deliverP3` called with no exclusion (block not in the seed; message not in
  the seed); `deliverQ1` called with no exclusion; order `applySeed` → p1 → p2 → p3 → q1.
- Without the fix `deliverP1` reaches `tab-A` and "abc" is appended after "abcdef".
- **R-B2c:** R1 is the compaction's RA-1 claim and R2 waits behind it with the plan's D-9
  reservation. Same assertions.

**R-B3, review defect 4: N is first observed after the fence closed.**

- Setup: claim, empty buffer, history holds u2 with `text_delta` "n1"; owners map it to N.
  `await replay(...)`; the fence is gone.
- Steps: `deferLiveEvent` for N's stream `message_start`, stream `text_delta` "n1", then N's
  complete batch (`message_start`, `text_delta` "n1", `message_complete`).
- Assert: each call returns `true` and its `deliver` gets `{'tab-A'}`; no N event reaches
  `tab-A`. A following terminal `turn_state` is kept (no exclusion), and a later event of N is
  then delivered with no exclusion (filter retired).
- Without the fix (first draft) the filter retired at close and every call returns `false`.
- **R-B3b (fail open):** the same, but N's complete text is "n1 edited". Assert `tab-A` gets,
  through `processStreamEvent` in this order: the anchor, one rebuilt stream `text_delta` with
  `delta === "n1"` and N's `blockIndex`, the held batch head; then the complete `text_delta` is
  delivered with no exclusion, and later N events are not excluded.
- **R-B3c (late exact complete, review defect 3; Revision 2 replaces the hold-bound case):**
  with fake timers. `H(N) = [text "n1 n2"]`. Stream `message_start` N, then 2500 stream
  `text_delta`s whose joined text is a prefix of "n1 n2" (the last ones make it whole).
  - Advance 60 000 ms. Assert nothing of N reached `tab-A` (no timer exists, no release at any
    count), and `jest.getTimerCount()` is unchanged by the filter.
  - Then N's complete batch (`message_start`, `text_delta` "n1 n2", `message_complete`). Assert
    each is excluded for `tab-A`, and `tab-A`'s streaming state holds no text block for N
    (the history node alone shows "n1 n2").
  - Then a terminal `turn_state`: kept; N's anchor is discarded (nothing of N was kept).
  - Without the fix (Revision 1) the 5 s timer released the prefix into a live node and the
    complete batch was dropped: history node plus a partial live node.
  - Variant: after the 60 s wait the complete text is "n1 n3". Assert the rebuilt delta (the
    absorbed prefix, exactly) reaches `tab-A` before the complete `text_delta`, which is kept.
- **R-B3d (early mismatch, no seed start):** `H(N) = [text "n1", tool toolu_9]`. A stream
  `message_start` N, then a stream `tool_start` `toolu_7`. Assert the anchor and the
  `tool_start` reach `tab-A` at that moment (no wait for a complete batch), and N's
  later events are not excluded. Same with a stream `text_delta` "zz" instead (not a prefix of
  "n1").

**R-B4, review defect 3: page edge.**

- Webview: history page holds X's second block only; the host omitted X (owners map empty for
  X). X's live stream `message_start` and complete batch with the same text → all delivered
  with no exclusion.
- Host: `history-block-owners.spec.ts`: full = [X b1, X b2, Y b1], delivered = full from X b2 →
  result has Y's entry and no X entry. Unpaged → both. `chat-session-history-page.spec.ts`: with
  the opt-in and a tail page that cuts X, the reply's `historyBlockOwners` lacks X; without the
  opt-in, the reply has no `historyBlockOwners`.

**R-B5, review defect 2: subagent coverage.**

- `agent-sdk` `session-replay.service.spec.ts`, with a `blockOwners` map:
  - orphan agent: an agent file whose Task `tool_use` is before the last `compact_boundary` →
    no entry for its message ids;
  - thinking-only subagent record → no entry;
  - correlated subagent text record → one entry with its `message.id`;
  - no map passed → events deep-equal the current output.
- Filter spec: live subagent X (`parentToolUseId` set), `H(X) = [text "a"]`. Stream thinking and
  complete thinking are kept (released); then stream text and complete text "a" are dropped.

**R-B6, review defect 1: batch and record shapes differ.**

- Filter spec: `H(X) = [thinking "t", text "a", tool toolu_1]` (three records, one id). One live
  complete batch with all three blocks → every event dropped, head and `message_complete`
  included.
- `H(X) = [thinking "t"]`; one live batch [thinking "t", text "b"] → thinking dropped; head
  released before text "b"; text and `message_complete` kept.
- `H(X) = [text "a"]`; first live complete text "a2" → queue released, event kept, later X
  events kept.

**R-B7, Revision 2 defect 1: synthetic history result, then the real result.**

- Setup (replayer spec, real `StreamingHandlerService` replay path or a double that records
  `tab-A`'s finalized messages): history page holds X's `tool_start` `toolu_T` (Task), its
  agent events, and a `tool_result` `toolu_T` with output "[Agent completed]" and
  `isError: false`. `setPersistedFilterInputs(claim, { ownerByEvent: owners(tool_start → 'X'), syntheticResults: set(that tool_result), prefixMark: null })`.
  `await replay(...)`.
- Steps: live complete batch of X with `tool_start` `toolu_T` (dropped by tool identity); then
  a complete `tool_result` `toolu_T` with output "real failure text" and `isError: true`.
- Assert: the `tool_result`'s `deliver` gets no exclusion (kept for `tab-A`); `tab-A`'s
  `messages` now hold, at the `toolu_T` tool node, `toolOutput === "real failure text"`,
  `isError === true`, `status === 'complete'`, through one `setMessages` call; the live
  streaming tree of `tab-A` has no `toolu_T` tool node; an `AgentMonitorStore` double records
  `onTaskToolResult('toolu_T', true)`.
- Without the fix (Revision 1 rule T) the result is excluded for `tab-A` and the history node
  keeps "[Agent completed]" with no error.
- Variants (`it.each`):
  - persisted (non-synthetic) history result, identical output and `isError` → excluded, no
    `setMessages`;
  - persisted history result, different output → kept and patched;
  - `syntheticResults: null` (absent list) with identical output → kept, patch is a no-op
    (same array, no `setMessages`);
  - a re-delivered copy of the same real result → excluded (stored after the patch);
  - live `tool_result` for a history tool with no history result → kept and patched.
- `history-tool-result-patch.spec.ts`: tool node at depth 2 inside an agent node; agent node
  with the same `toolCallId` gets `status: 'complete'`; untouched messages keep their object
  identity; unknown id returns the same array.
- Host: `session-replay.service.spec.ts`: the synthetic result (`:405-415` path) is in
  `collector.syntheticToolResults`, the persisted one (`:363-374` path) is not.
  `history-block-owners.spec.ts`: `selectDeliveredSyntheticResults` returns delivered indices
  only.

**R-B1s, Revision 2 defect 2: seeded message, block persisted between snapshot and read.**

- Setup: `claim = replayer.claim('tab-A', S, applySeed)` with seed σ = [stream `message_start`
  X, stream `text_delta` X `blockIndex 1` "par"] and `seedStartK = { X: 1 }` (X's block 0, text
  "a", was complete-batched before the snapshot). Buffer: X's complete batch for block 1
  (`message_start`, `text_delta` "partial done", `message_complete`), then stream `text_delta`
  X `blockIndex 2` "next". History: X's records "a" and "partial done" (one owner, X);
  `prefixMark` = the mark at resync arrival.
- Steps: `await replay(history, claim, S, undefined)`.
- Assert: `applySeed` is called with no X content event (the anchor and "par" are held or
  absorbed); the buffered complete batch is excluded for `tab-A`; at "next" (position 2,
  beyond the page) `tab-A` gets the anchor, then "next", in that order; "par" and
  "partial done" never reach `tab-A`'s live state.
- Without the fix (Revision 1) σ is applied unfiltered and the complete batch is kept: "partial
  done" shows in the history node and in X's live node.
- Variants:
  - deferred anchor: σ has no X event, `seedStartK = { X: 1 }`, X's anchor arrives live after
    close; same assertions;
  - pre-snapshot complete copy (rule P2): an entry with `arrival < prefixMark` holding X's
    complete `text_delta` "a" → excluded, and X is still tracked at `k = 1`;
  - mismatch: history block 1 is "partial DONE" → "par" is rebuilt and delivered before the
    complete `text_delta`, which is kept;
  - no `liveSeedBlocks` (older host): σ applied unfiltered, as Revision 1.
- Revision 3 variants, byte-cap-truncated context (σ has no X event; X's anchor is deferred and
  arrives live after close; every case asserts that each block shows exactly once and nothing
  is missing in `tab.messages` plus the live state after a terminal `turn_state`):
  - (a) block completes before the snapshot: `seedStartK = { X: 2 }`; pre-snapshot entries
    (`arrival < prefixMark`): stream `message_start` X, stream `text_delta` X `blockIndex 1`
    "partial", complete batch of block 1 ("partial done"); history "a", "partial done". Assert:
    no X stream or complete content reaches `tab-A`; the complete batch head and tail are
    excluded; when the deferred anchor arrives X passes through (`k0 == |H(X)|`), and a later
    stream block 2 "next" reaches `tab-A` once, after the queued anchors.
  - (b) block in flight at the snapshot, persisted before the read: `seedStartK = { X: 1 }`;
    pre-snapshot stream `message_start` X and `text_delta` "par"; post-snapshot deferred
    anchor, `text_delta` "tial", complete batch block 1 "partial done"; history "a",
    "partial done". Assert: "par" and "tial" never reach `tab-A`; the complete batch is
    excluded; no partial live node remains after the terminal (the review's ordering b).
  - (c) block in flight, not persisted (`k0 == |H(X)|`, history "a" only): pre-snapshot "par",
    post-snapshot "tial". Assert: "par" is a prefix of no history block, so P3 keeps it at
    once; `tab-A` gets the anchor, then "par", then "tial", in that order; the later complete
    batch replaces the text.
  - (d) retirement of an aborted in-flight block: `seedStartK = { X: 1 }`, history `H(X)` =
    ["part one"] (block 0, so `k0 == |H(X)|`); pre-snapshot stream `message_start` X and
    `text_delta` X `blockIndex 1` "par" (a prefix of "part one", so P3 absorbs it); then a
    terminal `turn_state` with no post-snapshot event of X. Assert: `tab-A` gets the anchor
    and one rebuilt "par" before the terminal (it is the last block and equals no
    `H(X)[p < k0]`), so it is not lost.
  - (e) mismatch inside P3: history as (b); pre-snapshot "par" (absorbed, a prefix of
    "partial done") then "tX" (joined "partX" is a prefix of no history block) → `tab-A` gets
    the anchor, one rebuilt "par", then "tX".
- Host: `live-message-projection.spec.ts`: root context counts complete `text_delta`,
  `thinking_delta`, `tool_start` of its message; a subagent context does not count thinking;
  Open resets to 0; the byte cap keeps the count; `buildSeed().blockCounts` has one entry per
  context, seeded and deferred, with no cap (300 contexts → 300 entries).
  `chat-stream-delivery-coordinator` spec: a resync snapshot carries `liveSeedBlocks`;
  `chat-stream-snapshot.spec.ts`: schema accepts it with `resyncRequired: true`, rejects it
  without, rejects a negative or fractional value.

**Component seams.**

- `persisted-content-filter.spec.ts`: one case per rule (P, P2, P3, T, R, O, I, S, H; Revision 3
  adds P3, P2 on an untracked X, loose-block continuation, loose discard on a complete copy,
  and both retirement branches for loose blocks); seed message
  ids without a `seedStartK` entry pass through; a non-`message_start` first event passes
  through; anchor discarded at retirement when nothing was kept; absorbed prefix discarded at
  retirement; a stream block beyond `H(X)` flushes the anchor and is kept; tool identity drops a
  history tool's `tool_delta`s; the queue's defensive bound warns and takes the mismatch path;
  a mismatch logs one `console.warn`.
- `session-history-replayer.service.spec.ts`: no filter without owners and prefix; none for a
  superseded claim, a rebound tab or an overflowed claim; `claim` retires and releases the tab's
  filter before installing; RA-2 keeps `arrival`; one throwing `deliver` does not stop others.
- `session-loader.service.spec.ts`: resync and compaction send `historyBlockOwners: true`, a
  plain load does not; the mark is taken before the first `await`; malformed owners (bad key,
  index out of range, empty value) warn and give `ownerByEvent = null`.
- `chat-message-handler.service.spec.ts`: `deliver(new Set(['tab-A']))` applies to `tab-B` only,
  with `{ fanOut: false }`, and routes once.
- `session-history-reader.service.spec.ts`: `includeBlockOwners` returns the map; default
  returns the old shape.
- `chat-history-read.service.spec.ts`: the option passes through. `chat-rpc.schema.spec.ts`:
  accepts `historyBlockOwners: true`, rejects `false`.

### B.8 Batch placement and test commands

Paths are under `libs/` unless a full path is given.

- **Batch S** (shared contract, plan component 1): `shared/src/lib/types/rpc/rpc-chat.types.ts`
  (`ChatResumeParams.historyBlockOwners`, `ChatResumeResult.historyBlockOwners`, Revision 2
  `ChatResumeResult.historySyntheticToolResults`). Revision 2 (defect 2):
  `shared/src/lib/types/messages/payload-map.ts` (`ChatStreamSnapshotPayload.liveSeedBlocks`),
  `shared/src/lib/types/messages/schemas.ts` (field and refine) and
  `shared/src/lib/types/messages/chat-stream-snapshot.spec.ts` (the R-B1s schema cases); these
  are the same files plan component 1 already edits. S comes first.
- **Batch B** (host). `agent-sdk` joins B as its first step; its only consumer is
  `readForResume` in B, and the same `backend-developer` owns both.
  - `agent-sdk`: `backend/agent-sdk/src/lib/helpers/history/session-replay.service.ts` (+spec);
    `backend/agent-sdk/src/lib/session-history-reader.service.ts` (+spec).
  - `rpc-handlers`: `backend/rpc-handlers/src/lib/chat/session/chat-history-read.service.ts`
    (+spec); CREATE `backend/rpc-handlers/src/lib/chat/session/history-block-owners.ts` (+spec);
    `backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts` (tested in
    `chat-session-history-page.spec.ts`); `backend/rpc-handlers/src/lib/handlers/chat-rpc.schema.ts`
    (+spec).
  - Revision 2 (defect 2): `backend/rpc-handlers/src/lib/chat/streaming/live-message-projection.ts`
    (+spec; created by plan component 3) and
    `backend/rpc-handlers/src/lib/chat/streaming/chat-stream-delivery-coordinator.service.ts`
    (+`chat-stream-delivery-coordinator.service.spec.ts`; plan component 4). Same files and
    executor as the plan's components 3 and 4.
  - Order: replay collector (owners and synthetic results) → reader option → `readForResume`
    → helpers → `resumeSession` and schema; the projection counter rides with plan component 3
    and the snapshot field with component 4.
- **Batch F** (webview, plan components 5 to 10), project `@ptah-extension/chat`:
  CREATE `frontend/chat/src/lib/services/chat-store/persisted-content-filter.ts` (+spec);
  Revision 2: CREATE `frontend/chat/src/lib/services/chat-store/history-tool-result-patch.ts`
  (+spec); `session-history-replayer.service.ts` (+spec), `chat-message-handler.service.ts`
  (+spec), `chat.store.ts`, `session-loader.service.ts` (+spec). Order: filter and patch →
  replayer (with plan component 8 and RA-2) → message handler (with component 5) → loader (with
  component 7 and RA-1).
- **File-disjoint.** S touches `shared`, B touches `agent-sdk` and `rpc-handlers`, F touches
  `chat`. B and F can run in parallel after S. F does not need B: without owners only rule P
  can act (B.4).

**Test commands.** Memory-safe only. One heavy check at a time across all lanes. Never
workspace-wide. Never build, serve, dev, e2e or package.

- Batch S: `npx jest -c libs/shared/jest.config.ts libs/shared/src/lib/types/messages/chat-stream-snapshot.spec.ts --coverage=false --maxWorkers=2`
  (Revision 2, `liveSeedBlocks` schema cases), then
  `npx nx typecheck @ptah-extension/shared --parallel=1`, then
  `npx nx lint @ptah-extension/shared --parallel=1`.
- Batch B, `agent-sdk` step:
  - Narrow: `npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/helpers/history/session-replay.service.spec.ts libs/backend/agent-sdk/src/lib/session-history-reader.service.spec.ts --coverage=false --maxWorkers=2`
  - Project: `npx nx test @ptah-extension/agent-sdk --parallel=1`, then
    `npx nx lint @ptah-extension/agent-sdk --parallel=1`.
  - Must run: the R-B5 `agent-sdk` cases, including the no-map deep-equal case.
- Batch B, `rpc-handlers` step:
  - Narrow: `npx jest -c libs/backend/rpc-handlers/jest.config.ts libs/backend/rpc-handlers/src/lib/chat/session/history-block-owners.spec.ts libs/backend/rpc-handlers/src/lib/chat/session/chat-session-history-page.spec.ts libs/backend/rpc-handlers/src/lib/chat/session/chat-history-read.service.spec.ts libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.schema.spec.ts libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-delivery-coordinator.ws-switch-resync.spec.ts libs/backend/rpc-handlers/src/lib/chat/streaming/live-message-projection.spec.ts libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-delivery-coordinator.service.spec.ts --coverage=false --maxWorkers=2`
  - Project: `npx nx test @ptah-extension/rpc-handlers --parallel=1`, then
    `npx nx lint @ptah-extension/rpc-handlers --parallel=1`.
  - Must run: the R-B4 host cases, the R-B7 helper case and the R-B1s projection and
    coordinator cases. The ws-switch-resync spec must pass with its assertion unchanged.
- Batch F:
  - Narrow: `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/services/chat-store/persisted-content-filter.spec.ts libs/frontend/chat/src/lib/services/chat-store/history-tool-result-patch.spec.ts libs/frontend/chat/src/lib/services/chat-store/session-history-replayer.service.spec.ts libs/frontend/chat/src/lib/services/chat-store/session-loader.service.spec.ts libs/frontend/chat/src/lib/services/chat-message-handler.service.spec.ts --coverage=false --maxWorkers=2`
  - Project: `npx nx test @ptah-extension/chat --parallel=1`, then
    `npx nx lint @ptah-extension/chat --parallel=1`.
  - Must run: R-B1 (with the compaction variant), R-B1s (Revision 2, all variants), R-B2,
    R-B2c, R-B3, R-B3b, R-B3c (Revision 2 late exact complete and its variant), R-B3d, the R-B4
    webview case, the R-B5 filter case, R-B6, R-B7 (Revision 2, all variants), and the F seams.
  - `agent-sdk` step must also run the R-B7 collector case.
- When one lane changed both `agent-sdk` and `rpc-handlers`, it may use
  `npx nx run-many -t test -p @ptah-extension/agent-sdk @ptah-extension/rpc-handlers --parallel=1`
  and must confirm the header says "Running target test for 2 projects". Never positional
  `nx test A B`.

### B.9 Dependence on assumption A-1

**A-1** (`implementation-plan.md:170-180`): a block reaches the JSONL when, not long before, its
complete batch is emitted.

- **RB no longer depends on A-1.** No rule infers persistence from timing.
  - Signature rules (I, H): a block is dropped only when the delivered page shows it.
    "Persists earlier" gives a longer `H(X)` and more drops, all verified. "Persists later"
    gives a shorter `H(X)`, so more is kept.
  - Rule P: drops only stream events that the new seed holds (plan component 3 suffix
    contract). It does not touch complete batches.
  - Rule R: retirement only ends filtering, and releases holds. Retiring early gives
    duplicates, never a loss.
- **Assumptions RB keeps, and what fails if they are wrong.**
  - **A-B2.** For one message, the live complete block events and the history block events
    appear in the same order with the same strings. Evidence: both come from the same content
    blocks (`assistant-message.transformer.ts:119-150`; `session-replay.service.ts:283-330`).
    If wrong: a mismatch, so the message passes through (duplicate). Check: the mismatch
    `console.warn` (B.7 seams) shows how often this happens in practice.
  - **A-B3.** Stream deltas of one text or thinking block share one stream `blockIndex`
    (`stream-event.transformer.ts:51`). If wrong: the "oldest group" discard can leave a
    held delta of the matched block, which is released later as a partial duplicate.
  - **A-B5.** The stream deltas of a block, joined in order, are a prefix of the block's full
    text (the accumulator appends them, `accumulator-core.service.ts:321`, and the complete
    event replaces them, `:314-319`). If wrong: an early mismatch on a persisted block, so a
    pass-through (duplicate).
  - **A-B4.** A terminal `turn_state` is delivered after the turn's batches
    (`implementation-plan.md:101,978`). If wrong: earlier retirement, so duplicates.
- **No new A-1 check.** The plan's check (`implementation-plan.md:1148`) is not needed by RB.

### B.10 Open points

1. **Seeded messages (Revision 2: closed by option (b), no cap).**
   - *Was.* A message first seen in the seed had no known position (rule I) and the seed was
     applied unfiltered, so a block persisted between the snapshot and the read showed twice.
   - *Now.* `liveSeedBlocks` (B.2.1) gives every seeded and deferred context its start `k0`,
     counted by the projection (B.2.2). Seed events of those messages run through the filter
     (B.2.3 b), pre-snapshot complete copies go through rule P2. The map has one entry per
     projection context and no count cap or omission path, so no seeded context falls back to
     the duplicate. Its size is bounded by the projection's own 1 MiB budget, because every
     context already stores its anchor there.
   - *Cost.* One optional snapshot field with a schema rule; one integer per projection
     context; a counter step in `observe`; the seed passes through `decide`; `applySeed` takes
     the list to apply. No new file.
   - *Remaining.* An older host without `liveSeedBlocks` keeps Revision 1 behaviour (seeded
     messages pass through). The Electron host and webview ship together (B.4), so this is
     only a mixed-version path. The position premise A-B2 is shared with every signature rule
     (point 2).
2. **Identical text at a shifted position.** A wrong drop needs A-B2 to fail and an identical
   full text at the shifted position inside the same API message. Tool blocks cannot be dropped
   wrongly (exact id). The dropped text is identical to a block that stays on screen.
   *Recommendation:* accept.
3. **Rule R edge.** A turn ends and a new one starts between the claim and the read. The first
   terminal retires the filter early; the new turn's persisted blocks show twice. *Recommendation:*
   accept; no loss.
4. **Pre-snapshot complete batch kept after the seed (approved-plan behaviour, not new).** In
   window (ii) a kept complete batch of a seeded X arms `pendingTextClear`
   (`accumulator-core.service.ts:273-276`) and replaces X's text accumulators (`:314-319`),
   including the seed's partial text of the open block, until that block's complete batch
   heals it. Revision 2: for a seeded X with a `liveSeedBlocks` entry, rule P2 verifies and
   drops those batches (head and `message_complete` included when every block matched), so
   the replacement no longer happens. It remains only for the older-host path and for a
   pre-snapshot block that matches no `H(X)[p < k0]` (kept, A-B2 failure). *Recommendation:*
   record.
5. **Plan text that RB makes stale** (orchestrator to amend; this section does not edit the
   plan).
   - `implementation-plan.md:1147` says "`agent-sdk` [is] untouched". RB changes it (B.8).
   - The plan's "Files affected" list lacks: `session-replay.service.ts` (+spec),
     `session-history-reader.service.ts` (+spec), `chat-history-read.service.ts` (+spec),
     `history-block-owners.ts` (+spec), `chat-session.service.ts`, `persisted-content-filter.ts`
     (+spec), and from Revision 2 `history-tool-result-patch.ts` (+spec). Plan components 1,
     3, 4 and 5 gain the `liveSeedBlocks` field, counter, snapshot wiring and `applySeed`
     argument (B.2.1, B.2.2, B.2.3 b and c); their files are already in the plan.
   - A.10 point 1 is amended (orchestrator, Revision 1) to point to rule P (B.2.3 a) and test
     R-B2c. Rule P removes the stream-text duplicate that point
     describes, per block and for the rebuilt tab only. The condition stays: the projection
     observes every fenced chunk kind (plan component 4e). Pre-S complete batches are kept
     (point 1 here).
6. **`tool_result` placement (Revision 2: verified and resolved).** A live result renders only
   through a live `tool_start` with the same id (`streaming-indexes.ts:186-188`,
   `tool-node.fn.ts:163-165`). For a tool whose start is in the history node, the result is
   now written into that node (rule T, B.2.3 b "Reconcile"); the kept live event still fires
   the Task completion signal (`accumulator-core.service.ts:449-455`). One kept-event side
   effect is unchanged from Revision 1 and not verified further: the compact view builds a row
   from each live `tool_result` (`libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-summary.ts:296-305`).
7. **Revision 2 assumptions.** RB2-A1 (stream grammar, queue bound; check
   `stream-event.transformer.ts:181-198,290-327`), RB2-A2 (`applySeed` takes the list; both
   ends are in Batch F), RB2-A3 (live finalization reads `tab.messages` when it runs; check
   above `message-finalization.service.ts:249`). If RB2-A3 fails, the fix is to read the tab at
   that point; the patch design is unchanged.
8. **Proportionality (Revision 2).** All three defects are closed within the stated goal (no
   content twice, no content lost) for a current host. Added machinery: two optional contract
   fields (`historySyntheticToolResults`, `liveSeedBlocks`), one new pure file
   (`history-tool-result-patch.ts`), one counter per projection context. The timer and the
   2000-event release are removed. Guarantees that rest on premises, not on code: A-B2 (live
   and persisted block sequences of one API message are equal; a failure gives a duplicate,
   never a loss, except the identical-text case of point 2), and the A-1 based argument that a
   persisted block's complete batch arrives before the turn's terminal (otherwise an absorbed
   prefix is discarded at retirement while its full block stays visible in the history node).
   No option here narrows the user's goal. Not addressed by this revision (outside review
   defects 1-3, unchanged from Revision 1): the rule R edge of point 3 and the mixed-version
   path of point 1 can still show a block twice; neither loses content.
9. **Revision 3 (user decisions, 2026-10-14).** The byte-cap-truncated context is closed by
   rules P2 (untracked X), P3 and the loose-block paths of rules I, S and H (decision RB-9).
   The user accepted, as known edges that can show a block twice and lose nothing: the rule R
   turn boundary (point 3), A-B2 failure (point 2), the page edge (round 1, defect 3) and the
   older host without `liveSeedBlocks` (point 1). New residual of RB-9: a truncated context
   whose last pre-snapshot block had ended and persisted, followed by a retirement before any
   later event of that message, shows a partial duplicate (release chosen over a possible
   loss).

## Decisions

| # | Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- | --- |
| RA-1 | Close the compaction reload's pre-claim window | **Chosen:** claim at arrival, synchronously, after the registry check and before `session:load`, with no seed. Extend the plan's post-`session:load` superseded guard to compaction. Rejected: seed compaction from the projection; reset before `session:load`; claim in `CompactionLifecycleService`; accept as a residual. | The trigger is an in-order live event handled synchronously (`chat.store.ts:403-413`; `compaction-lifecycle.service.ts:557-562`). The unfenced window is `session-loader.service.ts:798-824`, and the wipe is `:901-908`. Snapshot events are applied in one synchronous loop (`chat-message-handler.service.ts:538-542`). The early reset would break stale containment (`:833-844`). | Yes. Loader only, no contract. |
| RA-2 | Events left in a fence drain when a claim opens mid-drain | **Chosen:** hand the remaining closures, in order, to the new fence for the same session. Rejected: no change, which leaves a drained `compaction_complete` path that still loses M2; skip such a compaction, which loses its reload. | `leaveFence` deletes the fence before `deliverAll` (`session-history-replayer.service.ts:534-535`). Buffered closures bypass the fence (`:539-550`; `chat-message-handler.service.ts:518-522`). | Yes. Replayer only. |
| RA-3 | Compaction fence overflow | **Chosen:** reuse D-10. When the compaction reached its reset, the fence overflowed and the claim is not superseded, request a fresh resync after it settles. Rejected: abort the compaction before its reset, which would lose the marker, stats and stale handling. | Early delivery on overflow (`session-history-replayer.service.ts:465-479`) can land before the `:902` reset. Plan components 8 and 10 provide `overflowedDuring` and `requestStreamResync`. | Yes |
| RA-4 | Status after a mid-turn compaction reload | **Chosen:** reuse component 9: `reconcileTab` after a verified or stale compaction reload that is still current, also when RA-3 or RA-5 requested a resync. Rejected: rely on a later `turn_state`, which may never come within the turn; skip the probe when a resync is requested (as D-10 does), which leaves no status repair on a host without v2, where the request is a no-op. | `markTabIdle` (`compaction-lifecycle.service.ts:532`), the reset (`tab-manager.service.ts:2547,2559`) and `applyResumeFailure` (`:2565-2569`) erase `streaming`. Only `generating` restores it (plan D-3). The probe is revision-safe, and a later resync reset is repaired by the resync's seed or probe. | Yes |
| RA-5 | Delayed compaction reloads (advisory fallback, stale retry, late boundary) start after an unfenced gap, so their reset wipes applied live content that the JSONL does not have | **Chosen:** the lifecycle passes an internal `compactionDelayed: true` at the three delayed call sites. A delayed reload that reaches its reset with a current claim requests one fresh resync (D-10 path). The tab goes into `compactionResyncTabs`, so that resync keeps the post-compaction context seed. Rejected: resync after every compaction reload, which doubles the common path; detect live state from the tab, which is fragile; skip the delayed reset, which loses stale handling and the seed; fence from the timer schedule, which spans services and still misses D3. | Timer gaps: `compaction-advisory-correlator.service.ts:60,199-225,237-256`. Callers: `compaction-lifecycle.service.ts:672-677,700-703,383-388,722-726`. The stale branch keeps state (`session-loader.service.ts:887-899`); the reset is at `:901-908`. The coordinator answers `resyncTabIds` with a projection seed, or an empty seed when no live state exists (plan 4i). Seed protection: `:1030-1037,1046-1053`. | Yes. Webview-only; one optional internal option. |

| RB-1 | Identify the live blocks that the replayed history already holds | **Chosen (Revision 1):** per-block runtime check. Same API `message.id`, same position in that message's compared block sequence, exact signature (tool: `toolCallId`; text/thinking: full string). First mismatch, unknown position or uncovered message: pass through. Subagent thinking is outside the compared sequence. Rejected: per-message record counts (first draft; not an identity, full parse, unrendered agents); host signatures with a hash; stamping the API id on every history event; host block ordinals; unscoped content matching. | One JSONL line per content block, shared `message.id` (`session-usage-ledger.ts:119-131`). One complete batch per SDK message, full block per event (`assistant-message.transformer.ts:44-50,119-150,354-363`). History renders one event per block in record order (`session-replay.service.ts:289-330`); subagents render text and tools only (`:512-559`). | Yes |
| RB-2 | How the webview learns which history blocks belong to which API message | **Chosen:** opt-in `historyBlockOwners: true` on `chat:resume`, sent only by a load holding an early claim. The replay records owners through an optional collector; `selectDeliveredBlockOwners` keeps only messages whose every block event is in the delivered page; keys are indices into `events`. Rejected: count over the full parse (page edge, review defect 3); compute coverage from records (orphan and thinking-only agents, review defect 2). | Page is a slice (`history-page.utils.ts:139`); reply is `page?.events ?? fullEvents` (`chat-session.service.ts:1074-1088`); the loader asks for a tail page (`session-loader.service.ts:855-867`). | Yes. Optional fields; old peers ignore them. |
| RB-3 | Window (ii): buffered events from before a seeded resync's snapshot | **Chosen (Revision 1):** rule P. Take `prefixMark` synchronously at resync arrival. For the rebuilt tab only, drop a pre-snapshot stream content event whose block key (message, kind, stream `blockIndex` or `toolCallId`) the new seed holds, and the pre-snapshot stream `message_start` of a seeded message. Complete batches go to the normal rules. Rejected: drop every pre-snapshot message-scoped event (first draft; relies on A-1); drop for all tabs; deliver at R2 arrival. | Seed suffix: every stream event since the last complete batch, merged per block; a capped context has no suffix content (`implementation-plan.md:337-346`). Stream `blockIndex` from the API index (`stream-event.transformer.ts:51`). Fan-out to siblings (`streaming-handler.service.ts:314-325`). | Yes |
| RB-4 | Where the filter applies | **Chosen:** per tab, through `deliver(excludeTabIds)`, at fence drain, overflow delivery and after the fence closed. The seed is filtered only for messages with a `liveSeedBlocks` start (Revision 2, RB-8); other seed events are applied unfiltered. Rejected: filter only at fence close; filter the whole seed without a known start position. | Late chunks: 16 ms host batch timer (plan evidence, `stream-batch-buffer.ts:25-33`); replay of up to 250 events without a yield (`session-history-replayer.service.ts:199,219`). | Yes |
| RB-5 | Stream events of a block that may be persisted, and the stream anchor | **Chosen (Revision 2, defect 3):** absorb, never release by time or count. Stream content of a block that is still a verified prefix of `H(X)[ks]` (tool: same id) is kept out of the tab and stored as joined text; non-content events (anchor, batch head, `message_delta`, stream `message_complete`) are queued. Exact complete match: drop and discard the absorbed text. Mismatch: X passes through; the queue is released in order with each absorbed block rebuilt as one merged delta. A stream block beyond the page flushes the queue. Retirement discards absorbed text (its full block is in the history node) and discards a queue with nothing kept. History tools are dropped by id identity. Rejected: Revision 1's 5 s timer and 2000-event release (a later exact complete batch left history plus a partial live node, review round 2 defect 3); release then remove one copy (no accumulator removal op; no verified history-node mapping for text); drop stream deltas without keeping them (loss on misalignment). | Stream deltas append, complete events replace (`accumulator-core.service.ts:297-322`). Live results and tools attach by id (`tool-node.fn.ts:163-165,213-226`). Seed merges deltas the same way (`implementation-plan.md:310-312`). `message-node.fn.ts:44-54`. | Yes. Filter-internal. |
| RB-6 | Live `tool_result` for a tool whose start is in the history node | **Chosen (Revision 2, defect 1):** drop only when the history result is persisted (not synthetic), and its output and `isError` equal the live ones. Otherwise keep it (Task completion signal) and patch the history tool node with the real `output`, `isError`, `isPermissionRequest` and `status`, via `setMessages`. The host marks synthetic results with `historySyntheticToolResults`; absent or malformed means all synthetic. Rejected: drop by id only (Revision 1; drops the real result after a synthetic one); keep without patch (the real output is never shown); fresh resync per differing result (heavy, may synthesize again). | Synthetic result: `session-replay.service.ts:375-415`; real result: `user-message.transformer.ts:57-69`; live state and completion signal: `accumulator-core.service.ts:422-460`; result attaches only to a live start: `streaming-indexes.ts:186-188`, `tool-node.fn.ts:163-165`; history tree lives in `tab.messages` (`message-finalization.service.ts:281-303`, `tab-manager.service.ts:2010-2016`); patch precedent `message-finalization.service.ts:431-461`; `setMessages` `tab-manager.service.ts:1814-1816`. | Yes. One optional result field; one pure patch file. |
| RB-7 | When the filter stops | **Chosen (Revision 1):** retire at a terminal `turn_state` or `compaction_complete` from the buffer or the live stream, at `claim` or resync arrival for the tab (release first), or discard when the tab closes or rebinds. Memory bounded by the delivered page and the hold bound. Rejected: `finished()` when tracked messages are passthrough (first draft; retires before a late message, review defect 4); host high-water mark (live chunks carry no sequence; read-versus-emit order unproven). | Terminal after the turn's batches (`implementation-plan.md:101,978`). Live chunks carry no sequence (`chat-stream-delivery-coordinator.service.ts:121-130`); global sequence only on snapshots (`implementation-plan.md:391-397`). | Yes |
| RB-8 | Block position of a seeded or deferred-anchor message (Revision 2, defect 2) | **Chosen:** B.10 point 1 option (b) without a cap. The projection counts each context's complete block events in the compared domain; every resync snapshot carries `liveSeedBlocks` (one entry per context, seeded or deferred). The webview tracks such X from `k0`, passes its seed events through the filter, and verifies pre-snapshot complete copies against `H(X)[0..k0-1]` (rule P2). Rejected: accept the duplicate (Revision 1; violates the goal); a capped field that omits entries above a count (falls back to the duplicate); stamp a position on every live chunk (changes the live event contract). | Projection Open/Suffix/Persisted boundary/Seed (`implementation-plan.md:305-339`); it observes every negotiated publish (`:415-417`); its memory budget (`:340-346,467`); hidden events are retained, visible pushed (`chat-stream-delivery-coordinator.service.ts:118-133`). | Yes. Optional snapshot field; an older host leaves seeded messages unfiltered. |
| RB-9 | Byte-cap-truncated seeded context (Revision 3, round-3 review defect 1; orchestrator edit approved by the user) | **Chosen:** rule P2 applies to any X in `seedStartK` (no tracking needed); new rule P3 absorbs pre-snapshot stream text and thinking of such an X while it is a prefix of a same-kind `H(X)` block and drops its history tools by id; rule I starts tracking only on a post-snapshot event and turns `L(X)` entries into loose blocks; rule H continues a loose block at `ks`, discards it on a complete copy that contains it, rebuilds it on mismatch; retirement discards a loose block only when it is verified against a block persisted before the snapshot (prefix for an ended block, equality for the last block), else rebuilds it. Rejected: accept the duplicate (the user kept the goal); host stream-index base for truncated contexts (`blockIndex` does not map to `H` positions for subagent contexts, which omit thinking); discard every loose block at retirement (loses an aborted in-flight block). | The cap clears the suffix and defers the anchor (`implementation-plan.md:337-346`). A complete `text_delta` sets the block text (`accumulator-core.service.ts:314-319`); a stream delta appends (`:320-322`). Fence entries are capped (`session-history-replayer.service.ts:465-480`). | Yes. Webview filter only; no contract change. |
