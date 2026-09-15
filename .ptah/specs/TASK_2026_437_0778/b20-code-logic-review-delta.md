# Code Logic Review — Delta — `TASK_2026_437_0778` Batch 20 (P4, C15)

Base: `b20-code-logic-review.md` (6/10, NEEDS_REVISION, 0 blocking / 2 serious / 4
moderate / 5 failure modes). This delta re-verifies every base finding against the
current uncommitted diff in `D:\projects\ptah-437` plus the new
`session-history-replayer.service{,.spec}.ts` and `rpc-chat.types.spec.ts`, and
performs the mandatory `yieldToMacrotask`/fence probe. HEAD `36a24f257` (Sonar fix)
is out of scope and not referenced below.

## Summary

| Metric              | Value                |
| ------------------- | -------------------- |
| Overall score       | 7/10                 |
| Assessment          | APPROVE_WITH_FIXES   |
| Blocking issues     | 0                    |
| Serious issues      | 1 (S2, narrowed)     |
| Moderate issues     | 2                    |
| Failure modes found | 2 (1 carried, 1 new) |

## Base findings — closed / open

| Base finding                                                                                               | Status                                                      | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1 — `ChatResumeResult.messages` deletion orphans CLI's documented transcript source                       | **CLOSED**                                                  | `libs/shared/src/lib/types/rpc/rpc-session.types.ts:93-101` doc rewritten ("There is no text `{ id, role, content }` projection over RPC... A reader that needs the transcript replays `ChatResumeResult.events`"); `apps/ptah-cli/src/cli/commands/session.ts:22-24,907-910` documents `session.history` as metadata-only with a pointer to `chat:resume events`; matching updates in `apps/ptah-cli/README.md`, `apps/ptah-cli/docs/jsonrpc-schema.md`, `apps/ptah-cli/src/cli/commands/interact.ts`, `apps/ptah-cli/src/cli/router.ts`, and both `ptah-cli-usage/references/jsonrpc.md` copies (verified byte-identical via `diff`). `libs/shared/CLAUDE.md:29` adds the one-paragraph contract note. |
| S2 — No fence between chunked replay and a concurrently activated live session                             | **PARTIALLY CLOSED**                                        | See Failure mode "Pre-replay live-event race survives the fence" below. The inter-chunk window (the case the base review's evidence walk actually traced) is now closed and well tested. A second, more probable window is not.                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| M1 (logic) — `yieldToMacrotask` has no `MessageChannel` fallback, diverging from `MessageRouterService`    | **CLOSED**                                                  | Both now share one primitive: `libs/frontend/core/src/lib/services/macrotask-scheduler.ts` (`scheduleMacrotask`/`yieldToMacrotask`), imported by `session-history-replayer.service.ts:32` and, per Batch 21, `message-router.service.ts:51`. The single module documents both host cases (no more silent divergence) and rejects on a failed post (see mandatory check below).                                                                                                                                                                                                                                                                                                                           |
| M2 — Rebind-mid-replay branch had no dedicated spec                                                        | **CLOSED**                                                  | `session-history-replayer.service.spec.ts:238-253` ("stops when the tab is rebound to another session between chunks, leaving the new owner queue alone") asserts `'superseded'`, `isCurrent(claim)` still true, and the new owner's queue untouched (`clearPendingUpdates` not called).                                                                                                                                                                                                                                                                                                                                                                                                                 |
| M3 — Global `SessionManager.setStatus`/`setSessionId` shared across concurrent tabs                        | **OPEN, unchanged**                                         | Pre-existing, out of this batch's file scope, not touched by the diff. No regression.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| M4 — `TabManagerService.applyResumedHistory` dead in production                                            | **CLOSED**                                                  | `applyResumedHistory` no longer exists in `libs/frontend/chat-state/src/lib/tab-manager.service.ts` (repo-wide grep returns zero hits) — deleted along with the `.messages` fallback branch it served.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Style Serious-1 — `readHistoryAsMessages` dead code contradicting its own "CRITICAL: Public API" header    | **CLOSED** (style-adjacent, verified as part of this delta) | `readHistoryAsMessages` no longer exists in `session-history-reader.service.ts`; `artifact-parity.spec.ts:302-322` now calls `reader.readHistoryForCuration(...)` directly and keeps the `isMeta` + `isSynthetic` suppression assertion the base review flagged as needing preservation.                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Style Serious-2 — replay/claim logic belongs in a named collaborator, not inline in `SessionLoaderService` | **CLOSED**                                                  | Extracted to `SessionHistoryReplayer` (`services/chat-store/session-history-replayer.service.ts`), injected into both `SessionLoaderService` and `ChatStore` the way the facade rule prescribes. `session-loader.service.ts` no longer defines `yieldToMacrotask`, `REPLAY_CHUNK_SIZE`, `replayClaims`, or the chunk loop inline.                                                                                                                                                                                                                                                                                                                                                                        |

## Mandatory check — `yieldToMacrotask` semantics

Read `libs/frontend/core/src/lib/services/macrotask-scheduler.ts:39-77` and
`session-history-replayer.service.ts:141-180`.

- **(a) Rejection path.** `scheduleMacrotask` throws inside the `Promise` executor
  when `port2.postMessage` throws (`macrotask-scheduler.ts:60-65`); the `Promise`
  constructor turns a synchronous executor throw into a rejection, so
  `yieldToMacrotask()` rejects with the same error. Inside `replay()`
  (`session-history-replayer.service.ts:163`), `await yieldToMacrotask()` is not
  wrapped in a local `try`, so the rejection propagates out of `replay()` as a
  rejected promise — landing in `SessionLoaderService.switchSession`'s
  `catch (error: unknown)` (`session-loader.service.ts:774-786`), which runs
  `clearPendingUpdates` + `applyResumeFailure` + `setStatus('loaded')` _iff still
  current_, then rethrows. `finally` always calls `historyReplayer.release(claim)`,
  which calls `closeFence` regardless of currency and delivers any buffered live
  events. Verified directly by
  `session-history-replayer.service.spec.ts:259-280` ("rejects like a throwing
  chunk when a yield post fails, keeping the fence until release") — asserts the
  fence stays closed to new deliveries until `release()`, then delivers exactly
  once. Matches the developer's claim exactly. **No gap found.**
- **(b) Microtask-fallback path.** On a host without `MessageChannel`,
  `scheduleMacrotask` calls `callback()` synchronously
  (`macrotask-scheduler.ts:40-42`), so `yieldToMacrotask()`'s executor calls
  `resolve()` synchronously and the returned promise settles on the microtask
  queue, not a real macrotask. `session-history-replayer.service.spec.ts:282-303`
  ("replays in order with every claim check on a host without `MessageChannel`")
  confirms claim/tab checks still run once per chunk (3 lookups for 600 events /
  250-chunk = 3 chunks) and event order is preserved. On **starvation/ordering**:
  because a microtask-only yield never returns control to the macrotask queue, a
  push message delivered as a browser/Electron macrotask (which is how
  `chat:chunk` actually arrives — IPC/postMessage from the extension host) cannot
  be processed between two "chunks" in this mode, since the whole loop drains
  synchronously from the macrotask queue's point of view. The replayer's own spec
  and doc comment say so explicitly (`session-history-replayer.service.ts:26-28`:
  "only without a real event-loop turn between them — and so without live events
  to fence"), and jsdom (the only host lacking `MessageChannel`) never receives
  real push IPC in a unit test, so this is not a production hazard — it is a
  documented, intentional consequence of the fallback, not a starvation bug. **No
  gap found**, but see the note below: this same "no real turn" reasoning is what
  makes the _pre-replay_ window (next section) unprotected on the hosts that do
  have a real macrotask queue, which is the opposite failure direction.
- **No unbounded synchronous loop**: the `for` loop bounds on `events.length`;
  each iteration does O(1) work plus one `processStreamEvent` call. Confirmed no
  recursion or unbounded retry.

## Failure modes

### Pre-replay live-event race survives the fence (S2, narrowed but not closed)

- Trigger: `chat:resume` called with `activate: true` on a session whose live SDK
  query is not yet active. `chat-session.service.ts:944-963` reads `events` from
  disk, **then** `await`s `autoResumeIfInactive(...)` — which starts the live SDK
  query — **before** the RPC handler returns its response
  (`chat-session.service.ts:977-988` builds and returns the response only after
  that `await`). A live turn's `chat:chunk` push can therefore reach the renderer
  while `SessionLoaderService.switchSession`'s
  `await this.claudeRpcService.call('chat:resume', …)` (`session-loader.service.ts`
  around the RPC call site) is still pending — i.e., strictly before
  `historyReplayer.replay(...)` is ever invoked and before any fence exists for
  the session. `historyReplayer.claim(tabId)` is taken earlier
  (`session-loader.service.ts:653`), but `claim()` only records tab ownership; it
  does not open a fence — `openFence` runs only inside `replay()`, and only when
  `chunked` is true (`session-history-replayer.service.ts:149-150`). So the race
  is open for **every** resume with `activate: true`, chunked or not, for the
  entire RPC round trip, not just the inter-chunk gaps.
- Symptom: the live turn's events (`message_start`/`text_delta`/`turn_state`, …)
  apply to `StreamingState` for the tab before any of the resumed history has been
  replayed, so the rendered transcript shows the new turn ahead of — not after —
  the history that is about to load in behind it. No error, no warning; this is
  the same "wrong order, not wrong value" symptom the base review's S2 described,
  just at an earlier point in the sequence.
- Evidence: `chat-session.service.ts:944-963,977-988` (activation before
  response); `session-loader.service.ts:653` (claim), `session-history-replayer.service.ts:149-150`
  (`openFence` only inside `replay()`, gated on `chunked`); and, decisively,
  `session-history-replayer.service.spec.ts:354-368` — "lets a live event through
  before a replay starts and after it ends" — which asserts
  `deferLiveEvent(...)` returns `false` (i.e., delivered immediately, unfenced)
  for an event offered before `claim()`'s owning `replay()` call begins. The
  developer's own test documents this window as intentional, not oversight, but
  nothing records _why_ it is considered acceptable given it is the RPC's own
  activation path that creates the live events in the first place.
- Current handling: none — the fence exists only from the first line of
  `replay()` onward.
- Recommendation: open the session's fence at `claim()` time (or immediately
  before the `chat:resume` call, keyed by `sessionId` the same way `openFence`
  already is) rather than inside `replay()`, and close it once the resume result
  is known to need no replay (short history) or once `replay()` finishes/throws.
  This reuses the exact mechanism already built — it is a placement change, not
  new machinery. If closing it is out of scope for this batch, record it as an
  explicit known limitation (a line in `chat/CLAUDE.md`'s new bullet 7, which
  currently reads as if the fence covers "while a chunked replay runs" without
  qualifying that "runs" starts only after the RPC round trip) and open a
  follow-up ticket, since this is the same correctness property C15/INV-9 exists
  to protect and the more probable trigger of the two windows the base review and
  this delta identified (activation-during-resume is the documented, designed
  behavior of `activate: true`; concurrent windows during an already-active live
  query are comparatively rarer).

### `chat:error` / `session:turnEnded` / `session:turnFailed` bypass the fence — verified safe, not a new finding

Probed per the task's instruction ("a live `turn_state`/message_complete held
while chat:error/turnEnded applies first — can this leave a tab in a wrong
state"). Traced all three:

- `session:turnEnded` → `TurnEndHandlerService.handleTurnEnded`
  (`turn-end-handler.service.ts:86-123`) — doc comment and code agree: "No status
  write." It only stamps `pendingBackgroundTasks`/`pendingSessionCrons`/
  `lastTerminalReason` on tabs bound to the session. Does not touch
  `StreamingState`, tab status, or the spinner.
- `session:turnFailed` → `handleTurnFailed` → `ChatLifecycleService.handleChatError`
  (`chat-lifecycle.service.ts:272-318`) — doc comment: "Presentation only... does
  NOT finalize, write `status` or clear the spinner — the ordered `failed`/`idle`
  `turn_state`... owns those." Code confirms: only
  `clearQueuedContentAndOptions` + `compactionLifecycle.clearCompactionState()` +
  a session-list refresh.
- `chat:error` → `ChatMessageHandler.handleChatError` (`chat-message-handler.service.ts:469-506`)
  → same `ChatLifecycleService.handleChatError`, same "presentation only"
  contract.

None of the three writes the state the fenced `turn_state` (a `chat:chunk`) is
responsible for, so a tab cannot end up straddling "errored per the unfenced
push" and "still resuming per the fenced turn_state" in a way that corrupts
status — the two write disjoint fields. This closes that part of the mandatory
probe with no new finding; the module's own reasoning
(`session-history-replayer.service.ts:213-216`) is accurate and worth leaving as
is.

## Other mandatory probes

- **Fence overflow at 2,000 (event #2,001).** Verified via
  `session-history-replayer.service.spec.ts:575-606`: at the 2,000th buffered
  event the fence warns (`console.warn`, not silent), delivers the full buffer at
  once in arrival order, sets `overflowed = true`, and every later event for that
  fence (including #2,001) bypasses the fence and is delivered immediately —
  reintroducing the exact interleaving risk the fence exists to prevent, but
  logged and bounded, not silent or unbounded. Matches the developer's claim.
  Acceptable degradation for a limit sized well above any observed live-event
  volume during a replay window (module comment: "far fewer than this in the few
  event-loop turns a replay spans").
- **A fence that never closes.** `release(claim)` is called unconditionally from
  `SessionLoaderService.switchSession`'s `finally` (`session-loader.service.ts:820`
  area), so even an RPC timeout (120 s), a throw before `replay()` is ever
  called, or a throw inside a chunk all still reach `release`, which calls
  `closeFence` unconditionally (idempotent no-op if the claim no longer holds the
  fence). No path found where a fence is opened but never has a matching
  `release`/`closeFence` call.
- **Re-entrancy during buffered delivery.** `leaveFence` deletes
  `this.fences` entry **before** calling `deliverAll` (`session-history-replayer.service.ts:294-296`),
  so a buffered `deliver()` that triggers a new `claim()`/`replay()` for the same
  session operates on a fresh fence, not the one being drained. No corruption
  path found.
- **Two tabs, one superseded / one fails.** Directly tested only for
  same-outcome pairs (both finish, one superseded-with-fence-transfer). The
  "one fails, one still replaying" combination is not tested explicitly, but the
  mechanism (`holders: Set<number>`, decremented per-claim in `leaveFence`) is
  structurally symmetric with the tested cases — a failing tab's `release` only
  removes its own holder, leaving the sibling's hold and buffer intact. Moderate,
  not serious: recommend one spec pinning this combination given how central the
  holder-refcounting is to correctness.
- **Exactly-once delivery.** `fence.buffered` is never touched after
  `this.fences.delete(...)` runs (both in `leaveFence` and in the overflow
  branch's `splice(0)`), so no code path can push into an array that then also
  gets delivered a second time. Confirmed exactly-once across supersede/failure/
  closed/rebound/overflow paths, matching every spec listed above.

## Blocking issues

None found.

## Serious issues

### S2 (carried, narrowed) — Fence does not cover the RPC round-trip window before `replay()` starts

See "Pre-replay live-event race survives the fence" above for full evidence and
recommendation.

## Moderate and minor issues

- M-new-1: no spec pins "one of two tabs replaying the same session fails while
  the other is still mid-chunk" — the holder-refcount logic that would need to
  get this right is exercised only by all-succeed and one-superseded
  combinations today.
- M-new-2: `chat/CLAUDE.md` bullet 7 (new) describes the fence as active "while a
  chunked replay runs" without noting it does not cover the RPC-round-trip window
  before replay begins — a reader will believe the race the base review flagged
  is fully closed. Tie this to the S2 recommendation: either close the window or
  correct the claim.
- M3 (carried, unchanged) — global `SessionManager` status/sessionId shared
  across concurrent tabs. Out of this batch's scope, not regressed.

## Verdict

- Recommendation: APPROVE_WITH_FIXES
- Confidence: HIGH
- Top risk: `activate: true` resumes can still show a live turn's events ahead of
  the history being replayed behind them, because the live-event fence
  (`SessionHistoryReplayer`) opens only inside `replay()`, after the `chat:resume`
  RPC has already resolved — but the backend starts the live query, and can begin
  pushing `chat:chunk` events, _before_ that RPC resolves
  (`chat-session.service.ts:944-988`). This is the same correctness property the
  base review's S2 named; the batch closed the (harder-to-build,
  well-tested) inter-chunk case but left the (easier-to-trigger,
  by-design-of-`activate:true`) pre-resolution case open, and a spec documents
  this as intentional without a recorded justification.
- Required fixes before merge: (1) open the session fence at `claim()` time (or
  immediately before issuing `chat:resume`) instead of inside `replay()`, so the
  RPC round-trip window is covered the same way the inter-chunk gaps are; or, if
  intentionally deferred, record it as a named residual risk in `chat/CLAUDE.md`
  bullet 7 and file a follow-up ticket rather than leaving it implicit in a test
  title. (2) Optional but recommended: one spec pinning "tab A fails while tab B
  (same session) is still mid-replay" to pin the holder-refcount path the
  overflow/supersede specs don't quite cover.
- Everything else from the base review (S1, M1, M2, M4, and the style review's
  two Serious findings on dead code and facade placement) is verified closed
  with direct evidence in this delta.
