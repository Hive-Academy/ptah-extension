# Code Logic Review — TASK_2026_155 (Gateway Turn Hang Fix)

## Review Summary

| Metric              | Value                                |
| -------------------- | ------------------------------------ |
| Overall Score        | 5/10                                 |
| Assessment            | NEEDS_REVISION                       |
| Critical Issues       | 1                                     |
| Serious Issues        | 0                                     |
| Moderate Issues       | 2                                     |
| Minor Issues          | 2                                     |
| Failure Modes Found   | 4                                     |

F1 (permission-level threading) and F2 (unroutable deny-timeout) are correct, carefully scoped, and genuinely proven by behavioral tests (the batch reports document actual break-and-revert sanity checks that fail when the guard is removed — this is real evidence, not theater). F4 (premium parity) is a faithful mirror of the webview path and DI ordering was independently verified safe. F3 (turn watchdog) settles `runTurn`'s own promise on schedule, but `Promise.race` does not cancel the losing `turnWork()` closure — it keeps running in the background with live references to the SAME per-conversation `route`/`conversation`/`sessionToEnd` state that the very next queued turn (unblocked because `runTurn` already resolved) is now concurrently using. This reintroduces a variant of the original bug class (cross-turn interference) instead of eliminating it, and the new watchdog tests cannot catch it because their mock "hanging" stream is wired to never settle under any circumstance — including after `endSession`/`interrupt` — unlike the real SDK query.

## The 5 Paranoid Questions

### 1. How does this fail silently?

A watchdog-terminated turn's abandoned `turnWork()` promise keeps executing after `runTurn()` has already returned to the `ConversationQueue`. Its eventual settlement (success, retry, or error) touches the SAME `GatewayService` coalescer bucket (`gateway.service.ts:742-767`, keyed by `conversationKey`) that the next dequeued turn is now using — via `appendOutboundChunk` and, in the retry-failure branch, `drainOutbound`/`sendError`. None of this raises an alarm; it just quietly interleaves stray text or a stray "could not complete this request" error into whatever the next turn is building, and no test or log line calls this out as abnormal.

### 2. What user action causes unexpected behavior?

A Discord/Telegram/Slack user whose turn trips the 10-minute watchdog, and who then sends a second message shortly after receiving the "took too long" error, can see their SECOND reply arrive corrupted or prefixed with debris from the abandoned first turn's retry attempt — the exact "message gets weird after a stall" symptom the original bug report described, just with a longer fuse (10 min instead of forever).

### 3. What data makes this produce wrong results?

Any turn where the underlying stream is genuinely hung when the watchdog fires (not the F1/F2-covered permission-hang case — think a wedged provider connection, a stalled MCP tool, or any other future stream-level stall) AND a second inbound message for the same conversation arrives before the abandoned retry finishes settling. Given `SessionControl.endSession` calls `rec.query.interrupt()` (`session-control.service.ts:110-150`), the abandoned `pumpStream`'s `for await` loop is very likely to unblock shortly after the watchdog fires — either with 0 events consumed (triggering `pumpStream`'s `'stream produced zero events'` throw at `gateway-chat-bridge.ts:444`, which sends `turnWork()`'s catch straight into `tryFallbackStart` → a brand-new `startChatSession`/`resumeSession` call) or with some events already consumed (in which case it returns normally, having already called `bindSession`/`appendOutboundChunk` mid-flight). Both branches touch shared conversation state concurrently with the next turn.

### 4. What happens when dependencies fail?

- `agentAdapter.endSession` (via `SessionControl.endSession`) is fire-and-forget from the bridge's perspective (`endSessionAfterTurn` doesn't await the interrupt settling) — it only guarantees the interrupt is *dispatched*, not that the abandoned stream has actually stopped touching shared state by the time the next turn starts.
- If the abandoned `turnWork()`'s un-guarded `sendError()` call (`gateway-chat-bridge.ts:188-191`, no `.catch`) ever rejects (e.g. `drainOutbound` failing because the coalescer state was already reset by the next turn's own `sealTurn()`), that rejection propagates out of `turnWork()` uncaught by anything — a genuine unhandled promise rejection, since `Promise.race`'s loser has no one awaiting it once the watchdog has already won.

### 5. What's missing that the requirements didn't mention?

The task's own risk table (tasks.md, "Watchdog (F3) racing the normal `finally` seal → double-seal / double-endSession") only considered THIS turn's own `finally` racing the watchdog — it never considered the abandoned turn racing the NEXT queued turn on the same conversation key. `ConversationQueue`'s entire contract is concurrency=1 per key (`conversation-queue.ts:1-8`); F3 as implemented silently breaks that contract in exactly the scenario it exists to handle.

## Failure Mode Analysis

### Failure Mode 1: Watchdog does not cancel the abandoned turn — cross-turn outbound corruption

- **Trigger**: A gateway turn's stream genuinely stalls for `TURN_WATCHDOG_MS` (10 min) for any reason other than the F1/F2-covered permission hang (e.g. provider/network stall), AND a second inbound message for the same conversation is queued and runs after the watchdog fires.
- **Symptoms**: The user's next Discord/Telegram/Slack reply can contain interleaved or duplicated text/error fragments left over from the first (abandoned) turn's retry; `conversations.setPtahSessionId` may be overwritten with a session UUID belonging to the abandoned retry instead of the legitimate next turn.
- **Impact**: Serious user-visible correctness bug (garbled/duplicated replies, possible replay of the original stale prompt to the agent via `tryFallbackStart`'s `startNew` — risky if that prompt triggers a mutating tool call a second time).
- **Current Handling**: None. `Promise.race([turnWork(), watchdog])` lets the loser keep running; nothing cancels, aborts, or fences it off from shared per-conversation state.
- **Recommendation**: Give `turnWork()` (and the objects it captures — `openStream`, `pumpStream`, `tryFallbackStart`, `sendError`) a way to observe "this turn was already watchdog-terminated" and bail out immediately instead of retrying/appending. Simplest fix: check a `timedOut` flag at the top of `pumpStream`'s loop body and right after `openStream()` resolves, and skip `tryFallbackStart`/`sendError` entirely if the turn was already timed out. A more robust fix threads an `AbortSignal` into `openStream`/`pumpStream`/`tryFallbackStart` that the watchdog trips, and has all of them check `signal.aborted` before touching `route`/`conversation` state.

### Failure Mode 2: Un-guarded `sendError` in the normal (non-watchdog) failure path can produce an unhandled rejection

- **Trigger**: `tryFallbackStart` returns `{ ok: false }` and the subsequent `await this.sendError(route, 'Ptah could not complete this request...')` (`gateway-chat-bridge.ts:188-191`) itself rejects (e.g. `gateway.drainOutbound` throws).
- **Symptoms**: An uncaught promise rejection surfaces from `runTurn()`, which is invoked via `ConversationQueue.enqueue`'s `run` promise — the raw (non-recovering) promise returned to `onInbound`'s `void this.queue.enqueue(...)` (`gateway-chat-bridge.ts:122`). `enqueue`'s internal `settled` chain (used for the `tails` bookkeeping) does catch it for queue-advancement purposes, so the QUEUE itself doesn't wedge — but the top-level `run` promise is unhandled.
- **Impact**: Moderate — doesn't wedge the queue (pre-existing `ConversationQueue` design already tolerates this for chain-advancement), but is a real unhandled-rejection surface, and inconsistent with the defensive `.catch(...)` wrapping the watchdog path just added two branches below (`gateway-chat-bridge.ts:221-229`) for the identical `sendError` call.
- **Current Handling**: The watchdog's own `sendError` call is wrapped; this one, one code path away, is not. Pre-existing pattern (not introduced by this diff), but the diff was the opportunity to close it since the watchdog branch right next to it demonstrates the team already knows the right pattern.
- **Recommendation**: Wrap the `sendError` call at `gateway-chat-bridge.ts:188-191` in the same `.catch(...)` pattern used at lines 221-229.

### Failure Mode 3: `resolvePremiumContext` runs outside the watchdog's protection

- **Trigger**: Any of `licenseService.verifyLicense()`, `codeExecutionMcp.getPort()`, `enhancedPromptsService.getEnhancedPromptContent()`, or `pluginLoader.getWorkspacePluginConfig()/resolvePluginPaths()` takes a long time.
- **Symptoms**: `runTurn` stalls before the watchdog timer is even armed (`resolvePremiumContext` is awaited at `gateway-chat-bridge.ts:157`, before `turnWork`/`watchdog` are constructed at lines 159/203).
- **Impact**: Low in practice — `licenseService.verifyLicense()` bottoms out in `axios.post(..., { timeout: NETWORK_TIMEOUT_MS })` with `NETWORK_TIMEOUT_MS = 5000` (`license-fetcher.ts:34,110`), and the other three calls are local (MCP port lookup, prompt/plugin file resolution), so a true multi-minute hang here is unlikely. Documented for completeness, not scored as a blocking issue.
- **Current Handling**: Fully defensive against *failure* (try/catch around each call, degrades to non-premium), but not against *hang*.
- **Recommendation**: Optional — if you want the watchdog to be a true hard ceiling on turn latency, move `resolvePremiumContext` inside `turnWork()`/the race, or give it its own short timeout. Not blocking given the bounded network timeout above.

### Failure Mode 4: Test suite cannot catch Failure Mode 1

- **Trigger**: The watchdog test's "never settles" stream (`gateway-chat-bridge.spec.ts`, `GatewayChatBridge — turn watchdog` block) is `await new Promise<void>(() => { /* never resolves */ })` — a promise with NO connection to the mocked `endSession`/`isSessionActive` calls. In production, `endSessionAfterTurn` → `agentAdapter.endSession` → `SessionControl.endSession` → `rec.query.interrupt()` actually causes the real SDK stream to unblock; the test's mock does not model this at all.
- **Symptoms**: The test suite (correctly) proves the watchdog *fires* and the *queue advances*, but has no way to prove what happens to the abandoned turn afterward, because in the test the abandoned promise stays pending forever too (harmlessly, since nothing later reads from it) — masking the fact that in production it resolves/rejects and re-enters shared state.
- **Impact**: This is a test-coverage gap, not a production bug by itself, but it explains why Failure Mode 1 shipped with green tests.
- **Recommendation**: Add a test where the mocked stream's async iterator DOES eventually throw/settle (e.g. driven by the mocked `endSession`), after the watchdog has already fired and a second turn has already been dequeued, and assert the abandoned turn's late activity does NOT call `appendOutboundChunk`/`startChatSession`/`setPtahSessionId` again for the wrong turn.

## Critical Issues

### Issue 1: `Promise.race` watchdog does not cancel the losing turn — cross-turn state corruption

- **File**: `libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.ts:159-241` (also `:417-448` `pumpStream`, `:450-485` `tryFallbackStart`)
- **Scenario**: See Failure Mode 1 above. Concretely: turn A hangs → watchdog fires at 10 min → `endSessionAfterTurn` dispatches an interrupt (doesn't wait for it) → `runTurn` returns → `ConversationQueue` immediately starts turn B for the same conversation (same `tabId = gw-<conversation.id>`, same `route.conversationKey`) → turn A's abandoned `turnWork()` unblocks a few hundred ms/seconds later (interrupt completed), `pumpStream` throws `'stream produced zero events'` → turn A's catch calls `tryFallbackStart` → `this.startNew(...)` starts a THIRD SDK session under the SAME `tabId` turn B is also actively using, and pumps its stream, calling `this.gateway.appendOutboundChunk(route, ...)` into the SAME coalescer bucket (`gateway.service.ts:742-767`) turn B is accumulating into.
- **Impact**: Corrupted/duplicated outbound replies, a persisted `ptahSessionId` that may end up pointing at the wrong (abandoned) session, and a stale user prompt silently replayed to the agent a second time.
- **Evidence**: `Promise.race([turnWork(), watchdog])` at `gateway-chat-bridge.ts:211` — the loser is never `.catch`'d, aborted, or fenced off; `ConversationQueue.enqueue` (`conversation-queue.ts:12-29`) advances to the next task as soon as `runTurn`'s returned promise settles, with no knowledge that background work tied to the same key is still running.
- **Fix**: Thread a per-turn cancellation flag/AbortSignal that the watchdog trips, and have `openStream`/`pumpStream`/`tryFallbackStart`/`sendError` check it before mutating `route`/`conversation` state (bail out silently if already timed out). At minimum, guard `tryFallbackStart`'s and the catch-block's `sendError` call behind `if (!timedOut)`.

## Moderate Issues

### Issue 1: Un-guarded `sendError` call inconsistent with the watchdog path's defensive wrapping

- **File**: `libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.ts:188-191`
- **Scenario**: `tryFallbackStart` fails and `sendError` itself rejects.
- **Impact**: Unhandled promise rejection surfacing from `runTurn`/`ConversationQueue.enqueue`'s un-caught `run` promise (queue chain still advances via the internal `settled` chain, but the rejection is unhandled at the process level).
- **Fix**: Wrap with `.catch(...)` the same way `gateway-chat-bridge.ts:221-229` already does for the watchdog's identical call.

### Issue 2: tasks.md batch-level status markers stale

- **File**: `.ptah/specs/TASK_2026_155/tasks.md:3,61,169,290`
- **Scenario**: Header says `**Status**: 0/3 complete` and each `## Batch N: ...` heading still reads `⏸️ PENDING`, even though every individual task underneath is `🔄 IMPLEMENTED` and all three batch/test reports confirm implementation is done.
- **Impact**: Documentation/tracking inconsistency only — no functional impact, but the review brief explicitly asked to check status-marker consistency and this is out of sync with the actual state.
- **Fix**: Update batch headings to `🔄 IMPLEMENTED` (team-leader normally does this on APPROVED, so may be intentionally deferred — flagging for awareness).

## Minor Issues

### Issue 1: `resolvePremiumContext` sits outside watchdog protection

- **File**: `libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.ts:157`
- See Failure Mode 3. Not blocking (bounded by a 5s network timeout plus fast local calls) but worth a one-line comment noting the watchdog does not cover this phase.

### Issue 2: No new unit test exercises "abandoned turn later settles after being superseded"

- **File**: `libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.spec.ts` (new `turn watchdog` describe block)
- See Failure Mode 4. Recommend adding the scenario described there before merging, since it is exactly the seam Issue 1 (Critical) lives in.

## Data Flow Analysis

```
Inbound Discord msg (turn A) -> ConversationQueue.enqueue(key) -> runTurn(A)
   -> resolvePremiumContext (bounded, ~5s worst case)               [OK]
   -> Promise.race([turnWork_A(), watchdog(10min)])
        watchdog wins at 10min ─────────────────────────────────────┐
   -> endSessionAfterTurn(A) [fire-and-forget interrupt dispatch]    │
   -> sendError("took too long") [guarded]                          │
   -> finally: clearTimeout, sealTurn (seals A's buffer), endSessionAfterTurn (idempotent)
   -> runTurn(A) promise RESOLVES ◄─────────────────────────────────┘
        |
        | ConversationQueue immediately starts runTurn(B) for the SAME key
        v
   turnWork_A() [ABANDONED, still running in background] ── interrupt completes ──┐
        catches pumpStream's "zero events" error                                  │
        -> tryFallbackStart(A) -> startNew(A) [NEW SDK session, same tabId as B!] │
        -> pumpStream(A) -> gateway.appendOutboundChunk(route, ...) ──────────────┤
                                                                                    │
   runTurn(B) concurrently: openStream(B) -> pumpStream(B)                        │
        -> gateway.appendOutboundChunk(route, ...) [SAME coalescer bucket] ◄──────┘
        -> sealTurn(B) -> completeOutboundTurn -> flushes MIXED buffer to Discord
```

### Gap Points Identified:

1. No cancellation signal ties the watchdog's decision back into `turnWork()`'s still-executing code paths.
2. `gateway.appendOutboundChunk`/`drainOutbound`/`completeOutboundTurn` are keyed only by `conversationKey`, with no per-turn epoch/nonce to reject stale writers.
3. `tryFallbackStart` and the catch-block's `sendError` have no awareness that the turn they belong to has already been force-terminated.

## Requirements Fulfillment

| Requirement | Status | Concern |
| ----------- | ------ | ------- |
| F1 — auto-approve from turn one, never SDK `bypassPermissions` | COMPLETE | None found; compile-time enforced via the stricter `PermissionLevel` type. |
| F2 — deny-timeout for unroutable permission requests only | COMPLETE | None found; genuinely proven via fake-timer tests + documented break/revert sanity checks. |
| F3 — turn watchdog guarantees queue always settles | PARTIAL | The `runTurn` promise does settle on schedule (letter of the requirement met), but the abandoned turn is not cancelled, so it can corrupt the NEXT turn's shared per-conversation state — the underlying goal ("a hung turn cannot mess up the conversation") is not fully met. |
| F4 — premium parity, no rpc-handlers/platform-adapter imports, DI tokens registered | COMPLETE | Verified: `gateway-chat-bridge` imports none of `rpc-handlers`/`platform-{cli,electron,vscode}`; all 4 injected tokens are registered before the bridge is constructed in `apps/ptah-electron` (Phase 1/2/3 all complete before `post-window.ts` resolves/starts the bridge); degrades safely to non-premium on any failure. |

### Implicit Requirements NOT Addressed:

1. "A watchdog-terminated turn must not interfere with subsequently queued turns on the same conversation" — not explicitly stated in context.md/tasks.md, but is the natural extension of "ConversationQueue chain always settles" and is violated (see Critical Issue 1).

## Edge Case Analysis

| Edge Case | Handled | How | Concern |
| --------- | ------- | --- | ------- |
| `permissionLevel` omitted (webview path) | YES | Falls back to `permissionHandler.getPermissionLevel()`, byte-identical | None |
| Unroutable permission request, no response | YES | 60s deny timer, cleanup, log | None |
| Routable request with UUID sessionId, no tabId | YES | Classified routable (OR condition), infinite wait preserved | None |
| Real response arriving before unroutable timeout | YES | `clearTimer()` in resolve wrapper, `jest.getTimerCount()` returns to 0 | None |
| Fast turn under watchdog | YES | Timer cleared in `finally`, no spurious error reply | None |
| Turn that never settles, no queued follow-up turn | YES | Watchdog fires, session ended, error sent, seal runs once | None (the abandoned promise never touches anyone else's turn if nothing is queued behind it) |
| Turn that never settles, WITH a queued follow-up turn on the same conversation | NO | Watchdog fires and next turn starts, but the abandoned turn keeps running and can corrupt the next turn's outbound state | Critical Issue 1 |
| Non-premium / license failure | YES | Every external call individually try/catch'd, degrades to non-premium defaults | None |
| DI token availability at bridge construction | YES | Verified all 4 tokens registered in Phase 1/2/3 before Phase-4 `post-window.ts` resolves the bridge | None |

## Integration Risk Assessment

| Integration | Failure Probability | Impact | Mitigation |
| ------------ | -------------------- | ------ | ---------- |
| `ConversationQueue` ↔ abandoned watchdog turn | MEDIUM (requires both a genuine stream stall past 10 min AND a follow-up message within roughly the interrupt-completion window) | HIGH (corrupted/duplicated user-facing replies, possible duplicate side-effecting tool call) | NONE currently — see Critical Issue 1 fix. |
| `resolvePremiumContext` external calls | LOW | LOW (bounded 5s network timeout + local calls; degrades to non-premium on failure) | Existing try/catch is sufficient for failure; hang risk is low but uncovered by the watchdog. |
| DI token resolution order (Electron) | LOW | Would be HIGH if it occurred (crash whole app boot per the non-gateway tokens) | Verified: all phases run strictly before bridge construction; independently confirmed via activation-sequence trace. |

## Verdict

**Recommendation**: REVISE
**Confidence**: HIGH
**Top Risk**: The turn watchdog (F3) settles its own promise but does not cancel the abandoned turn's still-running work, which shares mutable per-conversation state (`GatewayService`'s coalescer bucket, `conversations.setPtahSessionId`, and the `tabId`-keyed SDK session) with whatever turn the now-unblocked `ConversationQueue` dequeues next. This can produce corrupted/duplicated replies and, in the worst case, a silently-replayed stale prompt — a new failure mode introduced by the very fix meant to eliminate turn-hang failures, in the exact "message queued behind a stalled turn" scenario the original bug report described.

## What Robust Implementation Would Include

- A per-turn cancellation token (AbortSignal or simple boolean ref) created alongside the watchdog timer, threaded into `openStream`, `pumpStream`, `tryFallbackStart`, and `sendError`, checked before any shared-state mutation so a timed-out turn's background continuation becomes an inert no-op the instant the watchdog fires.
- A test that actually drives the mocked stream to settle/reject AFTER the watchdog has fired and a second turn has been dequeued, asserting the abandoned turn's late activity is suppressed.
- Consistent defensive wrapping of every `sendError`/`drainOutbound` call site (not just the watchdog's), given `ConversationQueue.enqueue`'s returned `run` promise is not itself caught by the caller.

---

## Re-Review (fix-pass)

**Scope**: fix-pass changes only (per coordinator request) — closure of the original findings plus a hunt for new failure modes introduced by the fix. Re-read the current `gateway-chat-bridge.ts` and `gateway-chat-bridge.spec.ts` working tree; independently re-ran the gateway-chat-bridge suite (31/31 green) and independently reproduced the developer's break-and-revert sanity check (details below).

### Closure Status of Original Findings

| Original Finding | Severity | Status | Evidence |
| ---------------- | -------- | ------ | -------- |
| Critical 1 — watchdog does not cancel the abandoned turn (cross-turn corruption) | Critical | **CLOSED** | `TurnCancellation` flag (`gateway-chat-bridge.ts:79-80`) created per `runTurn` invocation (`:174`, fresh object each turn — no cross-turn leakage) and tripped INSIDE the watchdog `setTimeout` callback (`:239`) before the race resolves, i.e. before the queue can advance. All five mutation seams from my Data Flow Analysis are guarded: post-`openStream` (`:185` return before pump), `pumpStream` loop-top (`:469` break before `bindSession`/`appendOutboundChunk` — the check precedes both mutations in the same iteration), `pumpStream` pre-throw (`:483` a cancelled turn never throws the zero-events sentinel, so the caller can never be driven into `tryFallbackStart`), `tryFallbackStart` entry (`:506`) + post-`startNew` (`:517`), and the catch error-branch (`:207` `else if (!cancellation.cancelled)` suppresses the duplicate error reply/log). Re-traced the original abandoned-turn timeline: watchdog fires → flag trips → `endSessionAfterTurn` unwedges the real stream → abandoned `pumpStream` breaks at loop-top (no append, no bind) → returns without throwing → no `tryFallbackStart`, no stray `startNew`, no `sendError`. No shared-state mutation survives cancellation. |
| Moderate 1 — un-guarded non-watchdog `sendError` | Moderate | **CLOSED** | `gateway-chat-bridge.ts:212-223` — the turn-failure `sendError` now carries the same `.catch((sendErr: unknown) => logger.warn(...))` with `instanceof Error` narrowing as the watchdog path. No remaining un-guarded `sendError` on any watchdog-adjacent path (the `workspaceRoot`-missing `sendError` at `:134-137` is pre-existing, same exposure as before, out of fix-pass scope). |
| Moderate 2 — tasks.md batch-header markers stale | Moderate | **OPEN (deferred, accepted)** | Explicitly left to team-leader per the fix-pass note; markers flip to complete at commit time per the tasks.md status legend. Not blocking. |
| Minor 1 — `resolvePremiumContext` outside watchdog | Minor | **ACCEPTED AS-IS** | Coordinator decision; risk already assessed low (license fetch bounded by `NETWORK_TIMEOUT_MS = 5000` in `license-fetcher.ts:34`, remaining calls local). |
| Minor 2 / Failure Mode 4 — missing abandoned-turn behavioral test | Minor | **CLOSED — and independently verified** | New test at `gateway-chat-bridge.spec.ts:1113-1222`. It models the production seam faithfully: the hung stream's `next()` awaits a gate released ONLY by the mocked `endSession` (mirroring `endSession → query.interrupt()` unwedging the real `for await`), then completes with ZERO events; the conversation has a persisted `ptahSessionId` so the fallback path is genuinely reachable; assertions cover the stray `startChatSession` (never called), outbound debris (`'STRAY'` never appended; only the watchdog error + the second turn's text), and `setPtahSessionId` (exactly once, with the second turn's `SDK_UUID_B`). |

### Independent Verification Performed (not taken on trust)

1. Ran `npx nx test gateway-chat-bridge --skip-nx-cache` myself: **2 suites, 31/31 passed**.
2. Reproduced the break-and-revert sanity check myself: temporarily disabled guard sites 3 (`pumpStream` pre-throw, `:483`) and 4 (`tryFallbackStart` entry, `:506`) via `if (false && ...)`, ran the abandoned-turn test → **FAILED exactly as the developer reported** (`expect(startChatSession).not.toHaveBeenCalled()` — Expected 0, Received 1: the stray fallback session). Restored both guards (verified no `if (false` remains in the file), re-ran the full suite → **31/31 green again**. The new test is genuinely load-bearing on the cancellation guards, not theater. The working tree is byte-restored (both edits inverted exactly).

### New-Failure-Mode Hunt (fix-pass regressions)

- **Legitimate error replies on non-timed-out turns**: NOT suppressed. `cancellation.cancelled` only becomes true when the watchdog fires, and the watchdog path sends its own error reply — so the user receives exactly one error message in every failure scenario (normal failure → turn-failure reply; timeout → watchdog reply). The flag is per-invocation (`:174`), so turn B's replies can never be suppressed by turn A's cancellation.
- **Zero-events sentinel for normal turns**: NOT swallowed. The pre-throw guard (`:483`) is only reachable with `cancellation.cancelled === true`; an un-cancelled zero-event stream still throws and still drives the legitimate resume→fallback recovery. The pre-existing test `'falls back to a new session when the resumed stream yields zero events'` still passes, confirming this.
- **`recovered.ok` semantics under cancellation**: `tryFallbackStart` returns `{ ok: false }` when cancelled and the catch branch then skips the error reply via `else if (!cancellation.cancelled)` — correct, since the watchdog reply already covers the user.

### NEW Finding (Minor) — residual stray-session leak when cancellation trips mid-`openStream`/`startNew`

- **File**: `libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.ts:178-185, 516-517`
- **Scenario**: If the watchdog fires while `openStream()`/`startNew()` is itself mid-await (session creation in flight), the guard correctly prevents pumping and all shared-state mutation — but the SDK session the in-flight call creates still comes into existence AFTER the watchdog's `endSessionAfterTurn` already ran, leaving an idle active session registered under the shared `gw-<conversationId>` tabId (or, on the fallback path, a stray started session that is never pumped).
- **Impact**: Resource leak only (an idle SDK query awaiting input) — NO outbound corruption, NO `setPtahSessionId` overwrite, NO stray reply, since every mutation seam is guarded. A subsequent turn's `finally` calling `endSessionAfterTurn(tabId)` (when that turn resolves no UUID) would opportunistically clean it up; otherwise it lingers until app shutdown.
- **Probability**: Very low — requires session *creation* (not the stream pump) to straddle the exact 10-minute boundary; the primary hang class lives in the pump, not the open.
- **Recommendation**: Non-blocking. Optional two-line hardening: have `turnWork` call `endSessionAfterTurn(tabId)` when it observes `cancellation.cancelled` immediately after `openStream`/`startNew` resolves (`:185`, `:517`) — safe because `endSessionAfterTurn` is idempotent via the `isSessionActive` check.

### Trace Note (no action needed)

The abandoned turn's late `sessionToEnd = (await pumpStream(...)) ?? sessionToEnd` assignment (`:186-193`) can still mutate the closure variable after `runTurn`'s `finally` already consumed it — harmless, as nothing reads `sessionToEnd` after the `finally`, and the cancelled `pumpStream` return value carries no side effects.

## Final Verdict (Re-Review)

**Recommendation**: APPROVED_WITH_FINDINGS
**Confidence**: HIGH
**Findings**: Critical 0 | Serious 0 | Moderate 0 blocking (1 deferred doc item: tasks.md batch markers, owned by team-leader at commit) | Minor 2 (residual stray-session leak in a very narrow window — non-blocking hardening suggestion; `resolvePremiumContext` outside watchdog — accepted as-is per coordinator).

Critical Issue 1 and Moderate Issue 1 are genuinely closed, the closure is proven by a behavioral test I independently verified to be load-bearing (break-and-revert reproduced first-hand), and the fix-pass introduced no regression in the legitimate error-reply or zero-events-recovery paths. Ready for commit.
