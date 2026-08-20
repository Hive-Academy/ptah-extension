# TASK_2026_294 — findings

## The invariant added

**Ptah owns the follow-up queue; the SDK queue is where messages die.**

`SessionStreamPump` yields at most ONE user message per turn. It claims
`SessionRecord.turnInFlight` immediately before every `yield` and refuses to
yield again until the turn's `result` message releases it. Both entry paths —
the fresh-session iterable prompt and the resume-mode `streamInput` — drain the
same pump (`session-query-executor.service.ts:214`, `:296`), so this is a single
chokepoint, not a per-path guard.

## Files changed

- `session-lifecycle/session-registry.service.ts` — `SessionRecord.turnInFlight`;
  `markTurnStarted(rec)`; `markTurnEnded(idOrTabId)` (clears the flag AND wakes
  the parked pump via `resolveNext`, so a held message goes out immediately).
- `session-lifecycle/session-stream-pump.service.ts` — drain loop gated on
  `!turnInFlight`; `markTurnStarted` before each yield.
- `session-lifecycle/session-control.service.ts` — `interruptCurrentTurn`
  releases the claim on both the success and the throw path.
- `helpers/session-lifecycle-manager.ts` — `markTurnEnded` passthrough.
- `helpers/stream-transformer.ts` — new `onTurnEnd?: () => void` in
  `StreamTransformConfig`, fired first inside the `isResultMessage` branch.
- `sdk-agent-adapter.ts` — `releaseTurnOnResult(sessionId)` wired into all FOUR
  `transform()` call sites (start, resume-existing-stream, resume-new-query,
  slash-command).

## Two traps found while implementing

1. **Hot spin.** The park promise has a fast path that resolves `'message'` when
   `messageQueue.length > 0`. With a message held, that fast path resolved on
   every iteration while the drain loop refused to consume it — a busy loop. The
   fast path now also requires `!turnInFlight`. Pinned by the
   "does not hot-spin while a message is held" test.

2. **`onResultStats` is not a turn boundary.** It is skipped entirely when
   `validateStats` rejects the payload (cost > 100, token counts out of range,
   negative duration), and it runs only after an `await pricingProvider.getPricing`.
   Releasing the turn from there would strand `turnInFlight` on any malformed
   result — the follow-up would then wait for the 180s `NoActivityWatchdog`
   instead of the turn. Hence the separate `onTurnEnd`, fired unconditionally and
   first. Pinned by "fires even when validateStats rejects the payload".

## Stuck-flag backstops

`turnInFlight` is released by: the `result` message; `interruptCurrentTurn`
(success and throw); session teardown (`endSession` removes the record
outright); and `NoActivityWatchdog` at 180s, which aborts the controller and
ends the pump loop (TASK_2026_190).

## Verification

- `npx nx test agent-sdk` → 72 suites, **955 tests passed** (up from 900; +6 pump
  tests, +3 transformer tests, and 3 suites that previously could not run because
  their `SessionRecord` fixtures were missing the new field).
- `npx nx lint agent-sdk` → **0 errors**, 38 pre-existing warnings in untouched files.
- `npx nx affected -t typecheck` → **70 projects, all green.**

## Surface audit (follow-up: "canvas, setup wizard and tribunal have this too")

Traced each surface's send path rather than assuming they share one.

| Surface                      | Send path                                                                                   | Verdict                                                                                                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chat sidebar / tabs          | `ChatStore.sendOrQueueMessage` → `chat:continue` → `sendMessageToSession` → pump            | Fixed above                                                                                                                                                                 |
| **Canvas**                   | injects `ChatStore` (`orchestra-canvas.component.ts:233`) — identical path                  | Fixed above, no separate work                                                                                                                                               |
| **Harness builder**          | `chat:continue` with `surfaceMode: true` (`harness-workflow.service.ts:332`) → same backend | Fixed above, no separate work                                                                                                                                               |
| **Setup wizard**             | `wizard:*` → `agent-generation` → `InternalQueryService` one-shots                          | **Not this bug.** The lib has NO mid-run message input at all — no send/submit path anywhere in `libs/frontend/setup-wizard/src`. Surfaces are registered for display only. |
| **Tribunal / agent monitor** | `agent:continue` → `AgentProcessManager.continueConversation`                               | **Different mechanism, real gap** — fixed below                                                                                                                             |

### The tribunal / agent-monitor gap

`agent-process-manager.service.ts:774` refuses a follow-up to a running agent
with `AgentContinueError('busy')`, and `AgentContinueInputComponent` disabled the
textarea outright for the whole run (`disabled = submitting || status === 'running'`).
So steering a working CLI agent was impossible, and the `busy` branch — which
showed "Agent is busy, try again when it finishes" and kept the draft — was
near-dead code only a status race could reach.

Fixed **frontend-only**, deliberately: chat's queue lives in `TabManagerService`
for the same reason — an unsent message is not the backend's business, and
holding it in the component means it cannot be lost between the two. No RPC
contract, no new event, no `TrackedAgent` field.

- The box stays usable while the agent runs; `submit()` on a running agent
  enqueues instead of calling the store.
- Repeats coalesce with `\n`, matching `ConversationService.queueOrAppendMessage`
  — a second thought must not become a second turn.
- An `effect()` on `agent()` flushes the moment the agent leaves `running`. It
  tracks `agent()` only; `queued` is read and cleared through `untracked` so the
  write cannot re-trigger it.
- A `busy` answer at flush time re-queues instead of erroring (status race).
- Every failure path calls `restoreUndelivered` to put the text back in the box —
  including the two pre-existing resume failures, which previously kept the draft
  only because the draft had not been cleared yet.
- The queued chip is clickable (`unqueue`) to edit or drop, mirroring
  `ChatStore.moveQueueToInput`.

Files: `libs/frontend/chat/src/lib/components/molecules/agent-continue-input/agent-continue-input.component.ts` (+ spec).

Two existing tests asserted the old behaviour and were rewritten, not deleted:
"disables the input while the agent is running" → now asserts the box stays
usable; "retains the draft and shows a busy message" → now asserts a re-queue.

Verification: `nx test chat` → 55 suites, **832 passed**, 2 skipped.
`nx lint chat` → 0 errors. `nx affected -t typecheck` → 24 projects green.

## Not fixed here (deliberate)

- The frontend `isStreaming` desync in `MessageDispatchService` — now harmless for
  delivery, but it still lets `send()` → `wireAbortDispatch` →
  `createAbortController` abort a live controller and fire a stray `chat:abort`.
- `chat:continue`'s double-send on auto-resume (`chat-session.service.ts:531`
  passes `prompt` to `resumeSession`, then `:588` sends it again).
