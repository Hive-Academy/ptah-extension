# Code Logic Review - TASK_2026_678_9083 - Phase D S-1 / M-1 / M-2 fix round

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 7.5/10 |
| Assessment | APPROVED |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 3 |
| Minor issues | 4 |
| Reviewer | Anthropic (in-process) |
| Implementer | codex |
| Range | uncommitted diff on 93489596d |

Scope read in full: `command-center-page.controller.ts` (every line of the effects, `sendCommand`, `tryInvalidDecline`,
`retryInvalidDecline`, `exit`), the full diff of the controller and its spec, `command-center-tribunal.transport.ts` `answer` and
`discoveryComplete` (`:77-129`), `TabManagerService.applyTurnState` and `markStreaming` (`tab-manager.service.ts:1639-1803`),
`SessionTurnStateRegistry.settleTurn` (`session-turn-state.registry.ts:352-391`), `MessageSenderService.send` (`:327-368`),
`MessageDispatchService.sendOrQueueMessage` (`:155-217`), `CommandCenterSessionCoordinator.send` (`:225-248`),
`command-center-page.component.ts` (every `page.*` binding, toast block `:104-110`) and the implementer report. No tests were run
(read-only rules); the orchestrator's 229/229, typecheck and lint results are taken as given. Binding text: Amendment A1 and AC22.

## Prior findings

| ID | Status | Evidence |
| --- | --- | --- |
| S-1 (running turn's pulse clears `expectedRequest`) | CLOSED for the separate-turn case; residual unbounded-lifetime risk filed as M-A | `controller.ts:512-515` computes `skipNextPulse` from the tab's `status === 'streaming'` BEFORE `coordinator.send`, so the sender's own optimistic `markStreaming` (`message-sender.service.ts:765`) cannot set it. The pulse effect (`:320-345`) rewrites `minPulseSeq` to the pulse seq and drops the flag, then returns, so the request survives the running turn's pulse and the request turn's own pulse (seq greater, flag false) takes the `:344` clear. `applyTurnState` emits one pulse per `result` (`tab-manager.service.ts:1722-1729`, `registry.settleTurn:352`), so a queued separate turn gives exactly two pulses. |
| M-1 (toast does not say the request was cancelled) | CLOSED | `controller.ts:585-587` toast now reads "Invalid Tribunal proposal. It was declined. Tribunal request cancelled - ask again." It is raised only after `answer` returned true (`:569-583`). Not pinned by a spec (see M-C). |
| M-2 (failed Decline leaves the question outstanding and sendable) | CLOSED for the gate and the bounded retry; the post-exhaustion dead end is M-B | Signal-backed id `:83`, set on failure `:571`. Gate at the top of `sendCommand` `:483-489` covers typed input (`component:154`) and voice (`:218` -> `sendCommand`, so `command-voice-loop.ts:393` receives `false`). Retry: `:576-578` schedules at most two timers (attempts 1 and 2 re-arm, attempt 3 does not) at 250 ms. Cleared on success `:582`, on question gone `:225-231` and `:596-600`, on `exit` `:558`, on destroy `:223`. |

AC22 / A1: no regression. The change only lengthens the life of `expectedRequest` (stricter guard) and adds a send gate (fewer
messages reach the model). No new path sends Confirm text; `answer()` still maps any Confirm-like answer to Decline
(`transport.ts:89`).

## Answers to the five review questions

**1. Is S-1 closed?** Yes for the case the SDK runs the new message as a separate later turn. Trace: tab streaming at send,
`skipNextPulse=true`, `minPulseSeq=N`. Running turn ends: pulse `N+1`, flag consumed, `minPulseSeq=N+1`. Request turn emits the
tagged roster (`expectedRequest` still set, nonce matches), `pendingProposal` set, accepted. If the request turn ends with no
proposal: pulse `N+2 > N+1`, flag false, cleared. Both branches are pinned or covered by the older "restores ordinary Confirm" spec.

The fold case (only one terminal pulse) is real in this code path: `coordinator.send` goes to `MessageSenderService.send`
directly (no queue, `session-coordinator.ts:229`), and the dispatch service itself documents that the SDK "handles message queueing
natively". The registry emits `idle` per `result`, so a folded message yields one pulse. Then:

- If the folded turn produces the tagged proposal, it appears mid-turn, before the pulse; the receive effect (`:269-313`) accepts it
  and the pulse effect's `!pendingProposal()` guard keeps it alive. No defect.
- If the folded turn ends with no proposal (or the running turn was aborted so the queued request never ran, or the status was a
  stale `streaming`), the single pulse is eaten by the skip and `expectedRequest` stays set with `skipNextPulse=false`. It has no
  timeout. While it is set, `invalidRosterQuestion` (`:90-106`) returns any untagged question on the tab, and the effect at
  `:224-243` auto-Declines it with the toast "Invalid Tribunal proposal ... Tribunal request cancelled". The first such question
  declined clears the request (`:584`), and the next turn's terminal pulse also clears it (`:344`). So the damage is bounded to
  one legitimate `AskUserQuestion` declined and mislabelled, plus ordinary Confirm choices filtered (`:125-137`) until then.
  Severity: Moderate (M-A). Fail direction is safe for AC22.

**2. M-1 closed?** Yes (`:585-587`).

**3. M-2 closed?** Yes for the gate and the bounded retry; two caveats.

- After 3 failed attempts the user can do nothing in the UI except leave the page. `retryInvalidDecline` is public but not bound
  anywhere (grep over `libs/frontend`: only the controller and spec reference it; `page.component` has no binding), and the toast
  tells the user to "Retry the Decline before sending". The gate then rejects every typed and spoken send with that same toast.
  Fail-closed, and `exit()` (`component:187` on destroy, and the exit control) clears it, so Moderate (M-B). Triggers are
  `answer()` returning false: no marked tab, or `coordinator.answerQuestion` throwing (`transport.ts:83,93-97`), both rare.
- Re-entrancy is sound. Failure on the first attempt runs inside the effect: `undeclinedInvalidQuestionId.set(id)` is a write to a
  signal the same effect read, so the effect is re-queued once; the second run takes the `pendingId` early return (`:237`) and
  does not call `answer` again, so there is no loop and the signal reads inside `transport.answer` are dropped from the dependency
  set on that run. Success inside the effect writes `expectedRequest` (a dependency through `invalidRosterQuestion`); the
  re-run finds `invalidRosterQuestion` null and returns. The timer-driven retry runs outside the reactive context. A pending id
  whose question vanished is cleared in the effect (`:226-231`); that run still returns at `:237` on its captured `pendingId`, and
  the cleared signal re-queues the effect, so the next run is clean. No leak: the timer is cleared on every exit path and destroy.

**4. New regression to A1/AC22 or the existing guard specs?** None found. The existing specs (`controller.spec.ts:472`, `:515`,
`:634`, `:650`, `:674`) depend on `tabs()` returning no streaming tab; `beforeEach` now resets `tabs.set([])` (`spec:94`), so
`skipNextPulse` is false for all of them. The one rewritten spec replaced a signal-reread retry that no longer exists by design.

**5. Do the new specs pin the fix?**

- `keeps a Tribunal request through the terminal pulse of a turn already running at send` (`spec:675`): fails on the old code (old
  `:344` path clears on pulse seq 1 > 0, then the roster is rejected and Declined). It also pins the `minPulseSeq` rewrite: without
  it the effect re-run would clear immediately. It does not pin that the request turn's own later pulse clears (mutation "skip
  forever" passes). See M-C.
- `blocks text and voice sends after a failed Decline ...` (`spec:745`): fails on old code (no gate, `coordinator.send` would be
  called). Covers text, voice, toast, explicit retry success, id cleared, send restored.
- `clears a failed Decline and its retry timer on exit` (`spec:778`): pins exit cleanup. The timer-driven retries, the cap of three
  attempts and the 250 ms interval are not exercised (no fake timers), see M-C.

## New findings

### Moderate

**M-A. `expectedRequest` has no lifetime bound once a pulse has been skipped.**
`controller.ts:336-343` swallows the first pulse and `:344` is the only clearing path left for the no-proposal case. If that pulse
was the request's own (SDK folded the message into the running turn, the running turn was aborted so the queued message never
ran, or `status` was stale `streaming`), nothing clears the request until another turn ends, a question is declined, or the page
exits. Scenario: user types "run a council on X" while a status turn streams; the SDK answers it inside the same turn without a
proposal; the user then asks a follow-up and the model asks an ordinary clarifying question; the controller Declines it and shows
"Invalid Tribunal proposal ... cancelled". Impact: one legitimate question lost and mislabelled; confusing, not unsafe. Fix: give
the request a TTL (the roster card already uses 120 s, `:355-358`) or, after consuming the skipped pulse, arm a short grace timer
that clears the request if the tab is not `streaming` again when it fires (separate-turn case re-enters `streaming` first). Add a
spec with fake timers. Reversible: yes.

**M-B. Dead end after three failed Declines, with a toast that points at an unavailable action.**
`controller.ts:566-579` (toast and cap) and `:592-602` (`retryInvalidDecline`, public, unbound). After the third failure no timer is
armed and nothing re-triggers the effect (`pendingId` early return `:237`). Every send is refused (`:483-489`) with "Retry the
Decline", which the user cannot do. Fix: add a toast action (the store already supports `toast.action`, `component:106`, used for
`retry-speech`) such as `retry-decline` wired to `page.retryInvalidDecline()`, or change the copy to "Leave the Command Center
and reopen it". Do the same wording fix for the interim attempts ("Retrying" rather than "Retry").

**M-C. Spec gaps around the new timers and the skip lifecycle.** No spec uses fake timers for the retry (cap of 3, 250 ms, no
timer after attempt 3); no spec asserts the "Tribunal request cancelled - ask again" text (`spec` only checks `'It was declined'`);
no spec shows that after the skipped pulse a second pulse clears the request. A regression in any of the three would pass the suite.
Add: fake-timer spec with `answer` always false expecting exactly 3 calls then no more; a spec asserting the cancelled text; a
spec with two pulses where the second clears and an ordinary Confirm question is restored.

### Minor

1. `component:153` (`requestStatus` -> `coordinator.sendStatusTurn('Status')`) bypasses the new send gate. The text is fixed and
   cannot carry a Confirm, so AC22 holds, but a message still reaches the model while a Decline is undelivered. Route it through
   the controller or check the gate.
2. `controller.ts:512-514` uses `this.tabs.tabs()`, the active-workspace signal. A Command Center tab parked in a background
   workspace is not found, so `skipNextPulse` is false and S-1 reappears there (`message-dispatch.service.ts:167-175` documents
   this pitfall; use `findTabByIdAcrossWorkspaces`). Only `'streaming'` is checked; `awaiting-background` and `sleeping` tabs can
   also emit a terminal pulse (`tab-manager.service.ts:1722-1727`), though the optimistic `markStreaming` at send closes most of
   that window.
3. While one invalid question is undeclined (`:237` early return), a second untagged question on the tab is neither declined nor
   shown until the first resolves. Acceptable, since the send gate is on and the first Decline is retried.
4. Formatting: several new lines exceed 80 columns (`controller.ts:359`, `:447`, `:515`, `:578`, `:586` in the new positions;
   `spec:20`). Prettier will rewrite them at lint-staged time; route to the style reviewer if it matters.

## Decisions

- S-1 is rated CLOSED, with the fold/abort/stale residual filed as Moderate and not Serious. Evidence: the request survives the
  documented separate-turn case; the residual self-clears at the next pulse or first auto-decline; it fails toward the stricter
  A1 guard, never toward leaking a Confirm. Reversible: raise to Serious if the SDK is shown to fold mid-turn messages routinely
  and the user-visible mislabelled decline is judged unacceptable.
- M-B is rated Moderate, not Serious: fail-closed gate, rare trigger (`answer()` false), recovery by leaving the page. The
  prior review offered "an explicit retry action or a bounded retry timer"; the bounded timer was chosen, which satisfies it.
  Reversible: raise if the trigger proves common.
- The `:224-243` effect calling `tryInvalidDecline` (signal writes) is accepted as is: traced above, no loop.

## Verdict

S-1, M-1, M-2 closed; no Blocking or Serious findings. Three Moderate items (unbounded lifetime after a skipped pulse, the
unreachable retry action after the cap, missing timer specs) recommended as a follow-up; none gates the commit.

Verdict: APPROVED
