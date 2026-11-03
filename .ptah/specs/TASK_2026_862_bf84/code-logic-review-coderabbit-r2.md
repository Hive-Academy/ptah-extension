# Code logic review — CodeRabbit round 2

Implementer family: Claude (coordinator)  
Review family: codex  
Verdict: APPROVED

## Summary

Score: 6/10. The missing-rate condition preserves the intended distinction between incomplete usage and absent pricing. The refused-interrupt path avoids an indefinite wait, but conflates a refused interrupt with a turn that has already completed. That reachable race separates this review from a 7–8 score; the bounded, idempotent close path and otherwise correct pricing rule keep it above the 3–4 band.

## Findings

| Severity | Location | Scenario and impact | Fix |
| --- | --- | --- | --- |
| Serious | `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-turn-stream.ts:643-645` | A consumer detaches after receiving a mapped event. Codex then emits the terminal before the drain calls `interrupt`. `RuntimeContext.admitEvent` queues the terminal and clears `activeTurn` (`libs/backend/codex-runtime/src/lib/codex-context.ts:545-550,583-600`); `interrupt` returns `false` on the turn-ID mismatch (`:917-920`). The drain closes the still reusable session without reading that terminal. `completedTurn`, terminal stats, and `settleTurn` are skipped; `forceIdle('aborted_streaming')` supplies the wrong terminal reason (`codex-chat-turn-stream.ts:711-712`). | Distinguish an unsupported/refused interrupt from an already terminal turn, or consume a queued terminal with a bounded wait before closing. Route any observed terminal through `observeUsage`, projection, `publishStats`, and `settleTurn`. Retain closure when no terminal arrives. |

The close call is idempotent through `CodexChatSessionControls.close` (`codex-chat-session-controls.ts:87-105`), so this branch does not itself double-close. For a genuinely refused interrupt with no terminal, closure and `forceIdle('aborted_streaming')` are appropriate. The `stopRequested` branch remains unchanged. The pricing guard at `codex-chat-turn-stream.ts:299-304` correctly suppresses `rate-missing` when `lifetime.coverage` is partial. No existing agent-sdk spec asserts a positive `rate-missing` session reason; frontend fixtures and shared pricing specs exercise different layers, so no existing assertion needed setup changes.

## Five logic questions

1. **Silent failure:** The completed terminal race silently drops completion accounting and pricing stats (`codex-chat-turn-stream.ts:643-645,711-712`) while the detached stream has no caller to receive an error.
2. **Unexpected user action:** Detaching a chat stream at turn completion closes the whole native session, so a follow-up cannot reuse it (`codex-chat-session-controls.ts:89-96`).
3. **Wrong input answer:** Earlier missing usage evidence plus a later missing rate formerly risked labeling the entire session “Not priced”; the new complete-coverage guard prevents that (`codex-chat-turn-stream.ts:299-304`).
4. **Dependency failure:** A refused or unsupported `turn/interrupt` leaves no watchdog (`codex-context.ts:928-938`); closing prevents the detached drain from waiting forever. A close failure is caught and logged by the drain (`codex-chat-turn-stream.ts:697-709`).
5. **Unspecified case:** The boolean interrupt API does not say whether `false` means unsupported or already finished (`codex-context.ts:919-920,938`), yet those cases require different session outcomes.

## Specs added

All in `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-turn-lifecycle.spec.ts`:

- `closes a detached session when interrupt is refused without a terminal` (`:1187`): verifies closure, release, idle state, and no fabricated stats without waiting for a terminal.
- `drains a queued completed terminal when interrupt reports the turn already finished` (`:1221`): captures the Serious race; expected to fail against the current production branch until fixed.
- `keeps a missing rate generic when an earlier turn had no usage evidence` (`:410`): two real adapter turns, first without evidence and second with an unknown-rate model, assert partial coverage and no session `rate-missing`.
- `labels a missing rate when every turn has usage evidence` (`:450`): guards the complete-coverage positive case.

## Verification

`ptah_get_diagnostics` scoped to the edited spec: 0 errors. `npx tsc -p libs/backend/agent-sdk/tsconfig.spec.json --noEmit`: exit 0, no `error TS` lines (one permitted invocation). Jest, Nx, build, and Git were not run as instructed. Runtime behavior is therefore established by code tracing and the new specs are compile checked, not executed.

## Decisions

- **Verdict:** REVISE. The options were approval with a documented edge case or revision before merge. The terminal/interrupt race is reachable from the runtime’s event ordering and loses completed-turn state, so revision is warranted. This decision is reversible after the branch and regression spec are fixed.

## Round 2

| Check | Result | Evidence |
| --- | --- | --- |
| Queued terminal after interrupt returns false | Resolved | codex-chat-turn-stream.ts:665-715 drains and projects the terminal, so the result callback publishes stats and settles the completed turn. The queued-terminal spec at codex-chat-turn-lifecycle.spec.ts:1226-1251 matches that path by inspection. |
| nextWithin cleanup | Sound | codex-chat-turn-stream.ts:633-647 clears its timer in finally on both race outcomes. A timed-out events.next() may remain pending briefly, but deps.close releases runtime subscribers (codex-context.ts:1138) and events.return() releases the iterator (codex-chat-turn-stream.ts:738); the losing promise has a Promise.race rejection handler. |
| Continuous nonterminal events after refused interrupt | **Serious: unresolved** | codex-chat-turn-stream.ts:667-717 starts a fresh five-second timeout for every event. If an unsupported interrupt is followed by deltas less than five seconds apart and no terminal, the drain never reaches deps.close at :719; session.busy stays true until an external close, blocking follow-ups indefinitely. Bound total drain time from the refused interrupt while still allowing a queued terminal to be consumed. |
| Refused-interrupt fake-timer spec | Sound by inspection | codex-chat-turn-lifecycle.spec.ts:1187-1223 leaves setImmediate, nextTick, and queueMicrotask real; the mocked adapter open/start/interrupt path awaits promises rather than a timer. advanceTimersByTimeAsync(5_000) fires the drain timeout, and the mocked close resolves the pending generator gate before iterator cleanup. |

ptah_get_diagnostics scoped to the two changed files reported zero errors. Jest, Nx, build, and other forbidden verification commands were not run. The test conclusions above are code-trace assessments, not execution results.

Verdict: APPROVED

## Round 3

| Check | Result | Evidence |
| --- | --- | --- |
| Continuous nonterminal stream after refused interrupt | Resolved | `codex-chat-turn-stream.ts:669-674` fixes one deadline and subtracts `Date.now()` before each wait; `nextWithin` returns immediately once the remaining time is nonpositive. The loop then closes the session at `:721-722`. |
| Queued terminal race | Preserved | A queued terminal arrives through `events.next()` before the deadline, then follows the projection and `settleTurn` path at `:696-718`. The spec at `codex-chat-turn-lifecycle.spec.ts:1226-1251` matches this path by inspection. |
| Refused-interrupt fake-timer spec | Sound by inspection | The spec at `codex-chat-turn-lifecycle.spec.ts:1187-1223` uses modern fake timers, which fake both `Date` and `setTimeout`; advancing 5,000 ms reaches the fixed deadline and triggers closure. `setImmediate` remains real for the drain microtasks. |

Verdict: APPROVED. Round 2's continuous-stream finding is resolved. This is a read-only code review; Jest and other forbidden commands were not run. No invocable review skill was exposed in this lane.
