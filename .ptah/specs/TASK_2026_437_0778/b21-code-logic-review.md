# Code Logic Review — `TASK_2026_437_0778` Batch 21 (C18, inbound message burst coalescing)

## Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 7/10     |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 2        |
| Failure modes found | 3        |

Scope reviewed: `libs/frontend/core/src/lib/services/message-router.service.ts` (full file),
`message-router.service.spec.ts` (full file, all 22 cases, run locally — all pass),
`libs/frontend/core/src/lib/services/rpc-call.util.ts`, `claude-rpc.service.ts`,
`apps/ptah-electron/src/ipc/ipc-bridge.ts:200-370`,
`libs/backend/vscode-core/src/services/webview-message-handler.service.ts`, and a grep sweep of
every `implements MessageHandler` consumer for zone/timing assumptions. `rpc-handlers`,
`chat-streaming`, `cli-engine` and other batches were intentionally not read in depth per the
scoping instruction; where C18's correctness depends on one of them, that is called out as a
residual, not asserted as verified.

I ran the one permitted command:
`npx jest -c libs/frontend/core/jest.config.ts message-router.service.spec.ts --maxWorkers=1` →
22/22 pass.

## Five logic questions

### 1. How does this fail silently?

- `dispatchBatch` (`message-router.service.ts:195-206`): a `BATCH` message with a non-object
  `payload`, or a `payload.events` that isn't an array, returns with no dispatch and no
  `ErrorHandler` call. This is unchanged from the pre-batch code (confirmed via
  `git diff HEAD~1`), so it is not a regression introduced here, but it is still a silent drop of
  an entire burst with zero observability — worth carrying into a future hardening pass rather
  than blocking this batch on it.
- The MessageChannel-vs-null branch (`:74`, `:139-142`) has no logging when the null branch is
  taken on a host that was expected to have `MessageChannel`. If a future Electron/Chromium
  sandboxing change ever removed `MessageChannel` from the renderer, the router would silently
  fall back to synchronous per-message dispatch — functionally safe (correctness preserved) but a
  silent loss of the INV-11 budget with no signal that the fallback path is now live in
  production instead of only in jsdom.

### 2. What user action produces unexpected behaviour?

Nothing found that changes handler-visible behaviour. Every `MessageHandler` implementation was
grep-swept for `detectChanges`, `markForCheck`, `scrollTop`/`scrollIntoView`,
`requestAnimationFrame`, and no handler asserts prior zone-per-message semantics; the found
`Date.now()` reads (`back-office-activity.service.ts`, `boot-status.service.ts`,
`thoth-status.service.ts`) only affect a "when was this recorded" timestamp, which shifts by at
most one macrotask uniformly for the whole burst — not a correctness change a user could observe
as wrong, only as a (bounded, budgeted) later paint.

### 3. What input data produces a wrong answer?

None found in the router itself — the queue/drain state machine is a straightforward FIFO with a
single re-entrancy guard (`draining`) and a single "already scheduled" guard (`drainScheduled`),
both exercised by the spec's re-entrant-message and empty-drain tests
(`message-router.service.spec.ts:459-484`, `:508-510`).

### 4. What happens when a dependency fails?

- If `channel.port2.postMessage` were to throw (not observed in any real `MessageChannel`
  implementation, but nothing guards it), `drainScheduled` would already be `true`
  (`:143` runs before `:144`), permanently wedging the queue: no future `scheduleDrain()` call
  would re-arm because the flag is already set and nothing ever flips it back except the port's
  own `onmessage`, which will now never fire. Low likelihood (this call cannot realistically
  throw), but the failure mode is a total, silent stop of the router with no error surfaced —
  worth a defensive `try/catch` around the post if this is ever hardened further.
- A throwing handler is isolated per message (`dispatchGuarded`, `:179-185`) and per batch member
  (`dispatchBatch` now calls `dispatchGuarded` at `:204` instead of the pre-batch `dispatch`) —
  this is a genuine fix over the previous behaviour (one throw used to abort the rest of the
  batch; verified against `git diff HEAD~1`, and pinned by the
  `'isolates a throwing handler...'` spec at `:425-457`).

### 5. What is missing that the requirements never mentioned?

- No production-real integration test exercises R-P8 against the actual `rpc-call.util.ts`
  `RpcClient` singleton — see Moderate #1 below.
- No verification that BATCH producers outside this batch's scope (`cli-engine`'s
  `cli-webview-manager-adapter.ts`, `rpc-handlers`' `stream-batch-buffer.ts` /
  `chat-stream-broadcaster.service.ts`) uphold the same "`rpc:response` is never a BATCH member"
  invariant that `ipc-bridge.ts` and the VS Code host uphold. This batch's correctness depends on
  that invariant holding everywhere `MessageRouterService` is wired, not only in the Electron path
  checked here.

## Failure modes

### R-P8 ordering verified only against a stand-in, not the real collaborator

- Trigger: a future change to `rpc-call.util.ts`'s listener (e.g. someone adds
  `{ capture: true }` to `rpc-call.util.ts:69`, or another capture-phase listener is added ahead
  of the router's) would break the "pushes before response resolves" guarantee.
- Symptom: `ClaudeRpcService`/`rpcCall()` callers could see an RPC resolve before a push the
  backend flushed immediately before it (`ipc-bridge.ts:319-333` relies on this ordering by
  design).
- Evidence: `message-router.service.spec.ts:486-519` builds its own inline
  `rpcClientLike = (event) => { ... }` listener with default (bubble) options rather than
  importing and exercising the real `getClient()` singleton from `rpc-call.util.ts`. The ordering
  guarantee that matters in production is never asserted against the actual code it is meant to
  race against.
- Current handling: none — the design comment (`:27-32`) states the invariant as a fact but the
  test only proves the invariant holds for a listener shaped like `rpc-call.util.ts`'s, not for
  that file itself.
- Recommendation: add (or ask a follow-up batch to add) an integration spec that constructs the
  real `RpcClient` (via `getRpcClient()`/`rpcCall()`) alongside `MessageRouterService` and asserts
  the same ordering end to end, so a change to either file's listener registration is caught.

### Silent, permanent wedge if `MessageChannel.postMessage` throws

- Trigger: `channel.port2.postMessage(null)` (`:144`) throws (not observed in practice, but
  unguarded).
- Symptom: `drainScheduled` stays `true` forever; every subsequent inbound message is queued and
  never drained again — a silent full stop of the message pipeline with no error surfaced to
  `ErrorHandler` or console.
- Evidence: `message-router.service.ts:136-145` — no `try/catch` around the post; `drainScheduled`
  is set unconditionally before the call that could fail.
- Current handling: none.
- Recommendation: wrap the post in `try/catch`, and on failure fall back to the null-channel path
  (`this.drain()` synchronously) or reset `drainScheduled` and re-log via `ErrorHandler`.

### BATCH-embedded `rpc:response` would bypass the R-P8 flush entirely

- Trigger: any BATCH producer that ever bundles an `rpc:response` event as one of `payload.events`.
- Symptom: that response would be dispatched only on the next queued drain (one macrotask later,
  same as any other push), not synchronously ahead of `RpcClient`'s bubble listener — silently
  reintroducing the exact race R-P8 exists to prevent, for that one response only.
- Evidence: `dispatchBatch` (`:195-206`) unconditionally routes every batch member through
  `dispatchGuarded`, with no check for `MESSAGE_TYPES.RPC_RESPONSE`; the synchronous-flush branch
  only triggers from the top-level `onWindowMessage` check at `:83`. Verified this cannot happen
  today via `apps/ptah-electron/src/ipc/ipc-bridge.ts:57-66` (`BATCHABLE_STREAM_TYPES` excludes
  `RPC_RESPONSE`) and `libs/backend/vscode-core/src/services/webview-message-handler.service.ts`
  (no BATCH construction at all on the VS Code path). NOT verified for
  `libs/backend/cli-engine/src/lib/transport/cli-webview-manager-adapter.ts` or
  `libs/backend/rpc-handlers/src/lib/chat/streaming/stream-batch-buffer.ts` /
  `chat-stream-broadcaster.service.ts` — out of this batch's scope per the orchestrator's
  exclusion list, so treat this as an unverified residual, not a confirmed bug.
- Current handling: none — the invariant is enforced only by convention at each producer, not by
  an assertion in the router itself.
- Recommendation: either have `dispatchBatch` special-case `RPC_RESPONSE` the same way
  `onWindowMessage` does, or add a cheap runtime assertion (dev-only) that a batch never contains
  one, so a future producer regression fails loudly instead of silently reintroducing the race.

## Blocking issues

None found.

## Serious issues

None found. The capture-phase-before-bubble-phase ordering claim in the file header
(`:27-32`) was independently verified, not taken on faith: `window` is itself the event
target for a `postMessage`-delivered `MessageEvent` (no ancestor chain), and per the DOM
dispatch algorithm the "capturing" traversal pass over the target's own listener list runs before
the "bubbling" pass regardless of registration order — confirmed empirically by running the R-P8
spec (`:486-519`), which registers the bubble-phase stand-in listener _before_ constructing the
router and still observes the router's capture listener run first.

## Moderate and minor issues

- **Moderate** — R-P8 spec uses a synthetic stand-in for `rpc-call.util.ts`'s listener rather than
  the real module (`message-router.service.spec.ts:488-494`); see failure mode above.
- **Moderate** — unguarded `channel.port2.postMessage` can wedge the drain loop permanently and
  silently (`message-router.service.ts:144`); see failure mode above.
- **Minor** — `dispatchBatch`'s silent drop on malformed `payload`/`events` (`:195-199`) has no
  `ErrorHandler` call, unlike every other failure path in this file; pre-existing, not introduced
  by this batch, but inconsistent with the per-message guard added elsewhere in the same diff.
- **Minor** — no dev-time warning when the null-`MessageChannel` fallback path is taken on a host
  that isn't jsdom (see Q1); would help catch an unexpected loss of the INV-11 budget in the
  field.

## Data flow

1. `window` receives a `message` event (Electron `ipcRenderer` bridge or VS Code webview
   postMessage) → `onWindowMessage` (capture phase, outside Angular zone) — OK, guarded against
   null/typeless payloads (`:78-79`).
2. Message pushed to `this.queue` — OK, FIFO, arrival order preserved.
3. If `rpc:response` and not currently draining → synchronous `drain()` in the same task — OK,
   verified this predates `RpcClient`'s own bubble-phase resolution in the same dispatch (see
   Serious section). If already draining (re-entrant case), falls through to `scheduleDrain()`
   instead of a synchronous flush — this is the one case where R-P8's synchronous guarantee is
   _not_ honoured, though I found no realistic trigger for it in this codebase (see failure mode
   analysis in the transcript above; not restated as a separate finding since I could not
   construct a real trigger).
4. Otherwise → `scheduleDrain()`: posts one `MessageChannel` task, deduplicated via
   `drainScheduled` — OK, single test-proven dedup (`:344-362`).
5. `drain()`: snapshots `this.queue`, replaces it with `[]`, and dispatches the snapshot inside
   one `ngZone.run` — OK; messages enqueued during the run land in the _new_ array and get their
   own follow-up drain (`:169-171`), bounding the loop — OK, proven by
   `message-router.service.spec.ts:459-484`.
6. Each message dispatches via `dispatchGuarded` (or per-event via `dispatchBatch` →
   `dispatchGuarded`) — OK, isolated failure, sent to `ErrorHandler`.
7. Teardown (`DestroyRef.onDestroy`) removes the listener with matching `capture` option, closes
   both ports, and clears state — OK, proven by `:542-559`.

## Requirements fulfilment

| Requirement                                           | Status                                             | Gap                                                                                                                                                                   |
| ----------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| INV-11 (one CD pass per burst)                        | COMPLETE                                           | Proven by AC-13 spec, 1000 messages → 1 zone entry.                                                                                                                   |
| R-P8 (response ordering vs. earlier pushes)           | COMPLETE for the paths checked (Electron, VS Code) | Verified only against a stand-in listener, and only for BATCH producers in this batch's scope; `cli-engine`/`rpc-handlers` BATCH producers unverified (out of scope). |
| Drain bound (no unbounded loop on re-entrant message) | COMPLETE                                           | Spec-proven.                                                                                                                                                          |
| Per-message + per-batch-member error isolation        | COMPLETE                                           | Fixes a real prior bug (throw dropped rest of batch).                                                                                                                 |
| Zoneless-host compatibility                           | COMPLETE                                           | No-op zone verified via dedicated spec.                                                                                                                               |
| Teardown / no leaks                                   | COMPLETE                                           | Listener + both ports closed, queue cleared.                                                                                                                          |

Implicit requirements not addressed: an integration-level regression test for R-P8 against the
real `RpcClient`; a guard against a BATCH ever carrying an `rpc:response`.

## Edge cases

| Case                                               | Handled             | How                                                              | Concern                                                                             |
| -------------------------------------------------- | ------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 1000-message burst                                 | YES                 | Single drain, single zone entry                                  | None                                                                                |
| Re-entrant message during drain                    | YES                 | Deferred to next drain task, order kept                          | None                                                                                |
| Throwing handler (plain message)                   | YES                 | `dispatchGuarded` → `ErrorHandler`                               | None                                                                                |
| Throwing handler (BATCH member)                    | YES                 | `dispatchGuarded` per member, siblings still dispatch            | None                                                                                |
| `rpc:response` while not draining                  | YES                 | Synchronous flush ahead of bubble listener                       | None                                                                                |
| `rpc:response` while already draining (re-entrant) | PARTIAL             | Falls to `scheduleDrain()`, one macrotask later                  | No realistic trigger found in this codebase; flagged for completeness               |
| `rpc:response` nested inside a BATCH               | NO (bypasses flush) | Dispatched like any other batch member                           | Currently unreachable per verified producers; unverified for out-of-scope producers |
| No `MessageChannel` host (jsdom)                   | YES                 | Synchronous same-task drain                                      | None                                                                                |
| Zoneless host                                      | YES                 | No-op `run`, dedicated spec                                      | None                                                                                |
| Teardown mid-pending-drain-task                    | YES                 | Ports closed, `destroyed` flag short-circuits the delivered task | None                                                                                |
| `channel.port2.postMessage` throwing               | NO                  | Unguarded, would wedge `drainScheduled` permanently              | Not observed as reachable with a real `MessageChannel`, but no defence exists       |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: the R-P8 ordering guarantee — the most novel and highest-consequence part of this
  design — is pinned by a spec that stands in for `rpc-call.util.ts` rather than exercising it,
  so a regression in the real collaborator would ship undetected.
- What a robust implementation would add: (1) an integration spec wiring the real `RpcClient`
  singleton against `MessageRouterService`; (2) a guard (dev-assertion or explicit check) that
  `RPC_RESPONSE` can never arrive inside a BATCH, rather than relying on every current and future
  producer to uphold that convention unchecked; (3) a `try/catch` around
  `channel.port2.postMessage` so a thrown post cannot silently wedge the drain loop forever.

---

## Delta review (review fixes)

Scope: the seven fixes listed for this delta — `libs/frontend/core/src/lib/services/macrotask-scheduler.ts`
(new, + spec), `message-router.service.ts` (updated), `message-router.service.spec.ts` (new
sections at the failed-post, batched-response and real-`RpcClient` describe blocks),
`libs/frontend/core/CLAUDE.md:32-33`. `libs/frontend/chat`, `chat-state`, `shared`, `rpc-handlers`,
`agent-sdk` and e2e (Batch 20) were not read, per the coordinator's exclusion list, beyond the one
grep needed to answer check (d) below.

Ran the two permitted specs:
`npx jest -c libs/frontend/core/jest.config.ts message-router.service.spec.ts macrotask-scheduler.spec.ts --maxWorkers=1`
→ 35/35 pass (22 router + 13 scheduler cases across both new describe blocks).

### All three prior findings are closed

1. **R-P8 tested only against a stand-in (previously Moderate)** — now closed.
   `message-router.service.spec.ts:657-770` adds a describe block that loads the real
   `rpc-call.util.ts` module fresh per case via `jest.isolateModulesAsync` (so each case gets an
   un-shared `RpcClient` singleton), and drives both registration orders
   (`it.each` at `:727-746`: client-first and router-first). `deliverScenario`
   (`:748-769`) proves pushes queued ahead of an `rpc:response` are dispatched
   (`order` populated) before the awaited `rpcCall()` resolves, in both orders — which is the
   thing the original synthetic-listener test could not prove. This is exactly the fix I
   recommended; verified by running it, not just reading it.

2. **Unguarded `channel.port2.postMessage`, could wedge the queue forever (previously Moderate)**
   — now closed. `scheduleMacrotask` (`macrotask-scheduler.ts:60-65`) closes the channel and
   rethrows on a failed post; `MessageRouterService.scheduleDrain` (`message-router.service.ts:174-196`)
   wraps the call in `try/catch`, resets `drainScheduled` to `false`, reports the error via
   `ErrorHandler`, and immediately calls `this.drain()` to un-wedge synchronously rather than
   leaving the queue stuck. No double report: `scheduleMacrotask` never itself calls
   `ErrorHandler` — it only throws — so the single `catch` in `scheduleDrain` is the only place
   that reports it. Verified live by `message-router.service.spec.ts:590-612`, which fails one
   post, confirms exactly one `errorHandler.handleError` call and that the message drains anyway,
   then confirms a later successful post schedules and delivers normally again (the flag is not
   left stuck at `true`).

3. **BATCH-embedded `rpc:response` bypassed the synchronous flush (previously part of a Failure
   Mode)** — now closed. `needsSynchronousFlush` (`message-router.service.ts:153-172`) scans a
   BATCH's `payload.events` for an `rpc:response` member and, if found, routes the whole envelope
   through the same synchronous `drain()` path as a top-level response, while reporting the
   producer regression to `ErrorHandler` exactly once per router instance
   (`batchedResponseReported`, `:99,161-170`). Verified by
   `message-router.service.spec.ts:614-648`: two batches each carrying a response produce only
   one `errorHandler.handleError` call between them, ordering within the batch is preserved
   (`push:1, rpc:response:2, push:3`), and a batch of pushes only is still coalesced normally
   afterward — so the fix does not regress the common case.

### Answers to the coordinator's five checks

**(a) Fresh `MessageChannel` per call — cost and leaks.** Every path closes both ports: on
delivery (`macrotask-scheduler.ts:55-59`), on `cancel()` (`:47-53,66`), and on a failed post
(`:62-65`). `macrotask-scheduler.spec.ts:69-82,96-117` assert `state.closed === 2` (both ports)
after each of these. A channel per drain-wakeup is one allocation per burst (not per message —
`scheduleDrain` dedupes via `drainScheduled`), so the cost is bounded by burst count, not message
count. No leak found.

**(b) Rethrow-after-close vs. the router's own catch — double reporting.** Confirmed single
report; see closed finding #2 above. `scheduleMacrotask` is a pure throw (no side-effecting
report), so only one layer up the stack ever calls `ErrorHandler`.

**(c) jsdom sync fallback runs the drain inside the listener task.** Confirmed. Without
`MessageChannel`, `scheduleMacrotask`'s callback runs synchronously inside `scheduleDrain()`,
which itself runs synchronously inside `onWindowMessage` (or inside `drain()`'s own tail-call to
`scheduleDrain()`) — so in jsdom the entire drain happens in the same task the triggering
`dispatchEvent` call is on, matching the pre-existing "null-channel" behaviour and the file
header's claim (`message-router.service.ts:16` "no `MessageChannel`... drain in the task it
arrived in"). The `handle && this.drainScheduled` guard at `scheduleDrain:193-195` correctly
declines to store a cancel handle in this case (the flag is already `false` by the time the
synchronous call returns), so `teardown()`'s `this.drainHandle?.cancel()` is a safe no-op on
jsdom. No bug found in this path.

**(d) Batch 20's `session-loader` reuse of `yieldToMacrotask` — semantic risk.** Not directly
verifiable here: the current `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts`
in this worktree has no local `MessageChannel`/macrotask-yield code today (grepped, no match), so
whatever local helper the style review compared it against is part of Batch 20's own uncommitted
work, which is out of scope per the exclusion list. From `yieldToMacrotask`'s own contract
(`macrotask-scheduler.ts:70-77`, exercised by `macrotask-scheduler.spec.ts:130-176`) two things a
consumer must handle that a bespoke one-shot channel may not have: (1) on a host without
`MessageChannel` it resolves on a **microtask**, not a macrotask — a chunked-replay loop that
assumed a real task boundary between chunks (e.g. to let a paint or a timer fire) would get tighter
interleaving under jsdom than in production, which is fine for production behaviour but could
change what a jsdom-based replay-equivalence spec observes between chunks; (2) it **rejects** on a
failed post, where a bespoke helper might have swallowed the failure or not modeled it at all — if
the chunked-replay loop does `await yieldToMacrotask()` without a surrounding `try/catch`, adopting
the shared helper turns a previously-unmodeled failure into a thrown/rejected promise that aborts
the `for` loop, which per `implementation-plan.md:711` ("a chunk throwing aborts replay and runs
the existing failure branch") may be the _intended_ behaviour — but only if `SessionLoaderService`
actually has a failure branch wired around that specific `await`. This is a real integration
question Batch 20's own review needs to close, not something this delta can confirm without
reading chat/session-loader, which is out of scope here.

**(e) `needsSynchronousFlush`'s O(n) scan per BATCH.** Acceptable. It runs once per BATCH envelope
(not per member-dispatch), gated behind an early `message.type !== BATCH` return
(`message-router.service.ts:158`), and BATCH envelopes are bounded by `ipc-bridge.ts`'s flush
interval, not by burst size — this cost was already being paid implicitly by `dispatchBatch`'s own
member loop, so `needsSynchronousFlush` roughly doubles a walk that was already O(n), not adds a
new order of growth.

### Style items (b21-code-style-review.md) — brief

- **Serious #1 (MessageChannel technique duplicated, no shared abstraction)** — CLOSED by this
  delta: `macrotask-scheduler.ts` is exactly the extraction the style review recommended, and
  `MessageRouterService` now consumes it instead of owning its own channel. Whether
  `SessionLoaderService` also switches to it is Batch 20's concern (see check (d) above).
- **Serious #2 (`CLAUDE.md` didn't document the coalescing contract)** — CLOSED:
  `libs/frontend/core/CLAUDE.md:32-33` now carries a multi-sentence description matching the
  density of its siblings (`plugin-catalog.service.ts`, `boot-status.service.ts` entries), naming
  the zone-entry-per-burst contract, the R-P8 flush (including the BATCH case and its one-report
  rule), the per-message/per-batch-member error isolation, and the jsdom fallback.
- **Minor (`LISTENER_OPTIONS` had no pointer comment)** — CLOSED:
  `message-router.service.ts:64-69` now has a comment naming R-P8 and stating the capture phase is
  load-bearing.
- **Minor (pre-existing `no-empty-function` warning on the `APP_INITIALIZER` factory)** — not
  addressed and not expected to be; the style review itself attributed this to before the batch.

### Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- All three findings from the original review (R-P8 test fidelity, unguarded post, BATCH-embedded
  response bypass) are closed with evidence I ran myself, not just read. The one open item is
  outside this delta's scope by the coordinator's own instruction (Batch 20's adoption of
  `yieldToMacrotask` in `session-loader.service.ts`) and is called out above as a question for that
  batch's review, not a defect in this one.
