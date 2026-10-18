# Code Logic Review - TASK_2026_678_9083 - Tribunal answer guard (final)

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 6.5/10 |
| Assessment | NEEDS_REVISION |
| Blocking issues | 0 |
| Serious issues | 1 |
| Moderate issues | 3 |
| Minor issues | 2 |
| Reviewer | Anthropic (in-process) |
| Implementer | codex |
| Range | `73f36418a^..73f36418a` |

Scope read in full: `command-center-page.controller.ts` (all 559 lines), the diffs of `command-pending-input.component.ts` and
`command-center-page.component.ts`, `command-center-tribunal.transport.ts` `answer()`, `tribunal-run-coordinator.ts` `receive()`,
`command-voice-loop.ts:340-420`, `session-coordinator.ts` `send`/`answerQuestion`, the controller specs at `:471-735`, and the
implementer report. No tests were run (read-only rules); the orchestrator's 227/227, typecheck and lint results are taken as given.
Binding text: Amendment A1 (plan lines 118-137) and AC22.

## Prior findings

| ID | Status | Evidence |
| --- | --- | --- |
| N-1 (guard and choice filter hit every ordinary question) | CLOSED | `controller:82-85` defines `activeTribunalRequest`; `:123-125` (`ordinaryChoices`) and `:447-452` (`answerOrdinaryQuestion`) apply the filter and the reject only while it is non-null. Pinned by `controller.spec.ts:515` (ordinary Confirm button and typed "yes" accepted, no Tribunal request) and `:472` (denial kept while a request is outstanding). |
| N-2 (`expectedRequest` never cleared) | CLOSED, but the clearing is too eager (see S-1, M-1, M-2 below) | Clears at `:239` (successful invalid decline), `:303` (invalid proposal), `:339` (terminal pulse without a proposal), `:503` (failed send), `:511` (confirm), `:518` (decline), `:528` (timeout), `:544` (exit). Pinned by `controller.spec.ts:634` and `:650`. |
| N-3 (blocked answer disables the card for good) | CLOSED | `command-pending-input.component.ts:266-268` marks the id in flight, not responded; `:211-224` re-enables on `accepted:false` and shows the message at `:169-174`; `command-center-page.component.ts:167-173` reports the boolean. Duplicate click is blocked by `:262-265`. Pinned by `command-pending-input.component.spec.ts:138` and `command-center-page.component.spec.ts:273`. |
| M-1 (label heuristic, narrower scope) | CLOSED | `invalidRosterQuestion` (`controller:86-102`) now matches `tabId` or `sessionId` and flags every untagged question while a request is active, with no label test. Pinned by `controller.spec.ts:674`. |
| M-2 (fire-and-forget auto-Decline) | PARTIAL | `controller:229-247` reads the boolean, adds the id to `invalidRosterQuestionIds` and toasts "declined" only on success (pinned by `:705`). The failure path still leaves the question outstanding and hidden, and "retry" is incidental (see M-2 below). |

AC22 / A1 check: no path found by which a Tribunal-related Confirm reaches the model as text. Roster Confirm stays on the roster card
(`confirmProposal` -> `tribunal.confirm`, no answer text, `:507-514`); `Approve`/`Deny` go only through `answerPermission` ->
`chat.handlePermissionResponse` (`:459-472`), and a spoken "yes" never reaches it (voice loop `:379-385` only toasts). A spoken answer
to an ordinary question goes through `answerOrdinaryQuestion` (`controller:198-203`) and gets the same guard as the click path; on
rejection the voice loop toasts and does not fall through to `sendTranscript` (`command-voice-loop.ts:363-376`). While a request is
outstanding, `ordinaryQuestion` is effectively always null (every untagged question is routed to `invalidRosterQuestion`), so the
choice filter and the answer reject are defence in depth.

## New findings

### Serious

**S-1. A terminal pulse from a turn that was already running when the Tribunal request was sent clears `expectedRequest`, so the real
proposal is rejected and Declined.**

- File: `command-center-page.controller.ts:496-499` (captures `minPulseSeq` as the last pulse seq at send time) and `:317-339`
  (clears on any later pulse with no proposal yet).
- Scenario: the user (typed or voice) has a Command Center turn in flight, for example a status or "what is running" turn. They send
  "run a council on X" before it ends. `minPulseSeq` is the seq of the previous completed turn. The in-flight turn ends first, its
  terminal pulse has `seq > minPulseSeq`, there is no pending proposal and no tagged question yet, so line 339 sets
  `expectedRequest` to null. The request turn then runs and emits the tagged proposal. The receive effect (`:272-316`) sees
  `!expected`, takes the reject branch at `:303-314`, `tribunal.receive` Declines the question, and the user sees "Invalid Tribunal
  proposal. It was declined." for a valid proposal. This controller already treats several turns in flight with ordered pulses as
  normal (`armedTurns`, `deliveredPulseSeq`, spec `:325` "settles voice pulse 5 before typed pulse 6"), so the case is reachable.
- Impact: a legitimate request is silently spent and mislabelled invalid. The user must repeat the request, and may do so while
  again racing a turn.
- Confidence: medium. `MessageSenderService.send` (`message-sender.service.ts:327-358`) does not queue itself; whether the SDK runs
  the new message as a separate turn after the running one, or folds it into the running turn, decides whether the early pulse
  occurs. The code does not guard against the separate-turn case.
- Fix: do not treat a pulse as "the request turn ended" unless it is the request turn's pulse. For example, at send time record
  whether the root tab is streaming and, if so, set `minPulseSeq` to the last pulse seq plus one (the running turn's pulse is
  expected first); or clear on pulse only after the request turn's own boundary (the transport already tracks `boundarySeq`
  similarly). Add a spec: set a running-turn pulse after `sendCommand`, then offer the tagged proposal and assert it opens.

### Moderate

**M-1. A stray untagged question in the discovery turn spends the request, so the real proposal that follows is rejected.**
`controller:239` clears `expectedRequest` right after the automatic Decline. If the model gets that Decline and then emits the tagged
proposal in the same turn, `:303` rejects it as unexpected. Defensible as "only the tagged proposal is allowed in this turn", and the
user can retry, but the toast does not tell them the request was cancelled. Fix: say "Tribunal request cancelled, ask again"
in the `:239` toast, or keep the nonce alive until the turn's own pulse and only drop the guard.

**M-2. The failed-Decline path leaves the question outstanding and hidden, and still reachable by free text.**
`controller:229-238` returns without marking the id, so `ordinaryQuestion` stays null for it (`invalidRosterQuestion` still returns it)
and `pendingInput` is null. The model waits on the question. The composer (`command-center-page.component.ts:154`,
`(commandSubmit)="page.sendCommand($event)"`) and the voice loop (`command-voice-loop.ts:393`) are not gated, so a typed or spoken
"yes" goes to the model as a chat message while the untagged Confirm question is still unanswered. Retry works only because
`transport.answer` reads signals (`markedTabId`, `lastTerminalPulseByTab`) inside the effect and so re-runs it on a pulse change, or
when `chat.questionRequests()` yields a new object reference (the spec at `:705` uses `{ ...request }`). Nothing guarantees either.
Fix: on failure, keep a signal-backed "undeclined invalid question id" and gate `sendCommand` and the voice send while it is set; add
an explicit retry action or a bounded retry timer.

**M-3. `confirmProposal` clears `expectedRequest` unconditionally after the await.** `controller:510-511` runs after
`tribunal.confirm` resolves, which can take as long as the manifest write. If the user sent a new Tribunal request during that await,
`sendCommand` (`:499`) has already stored the new nonce and `:511` wipes it, so the new proposal is rejected. `declineProposal` and
`timeoutProposal` clear synchronously and do not have this window. Fix: capture the nonce when the proposal opens and clear only if
`expectedRequest()?.nonce` still equals it.

### Minor

1. `command-pending-input.component.ts:171` shows "Choose Decline or try another answer." for any rejected answer, including a
   rejected `Approve`/`Deny` (`answerPermission` returns false for a stale id), where there is no Decline. Make the text kind-aware.
2. `controller:130` and `:450` use `\b` after the keyword, so "yes-man" and "approve-branch" still match. Harmless now that the guard
   is scoped to an outstanding request. The implementer's note that exact-answer forms (old M-3) were not done is accurate.

Not filed (checked, no defect): the terminal-pulse effect (`:317-339`) runs after the receive effect in creation order, so a pulse
that lands in the same flush as the tagged question sees `pendingProposal` already set; a pulse arriving before the tagged question
would clear early, but a turn does not end before its own `AskUserQuestion` is registered. The card's `answerResult` effect writes
signals via `update`, which does not add them as dependencies. No duplicate emit: `respond` is guarded by `respondedIds` and
`inFlightIds` (`command-pending-input.component.ts:259-269`). The card cannot stay stuck after a rejection: the in-flight id is
cleared in the same effect run as the rejection (`:213-223`) and the result is set synchronously in the same tick as the emit.

## Decisions

- Severity of S-1 is Serious although reachability depends on SDK queuing behaviour I could not confirm from the files in scope: the
  controller itself models overlapping turns, so the code must not assume none is running. Reversible: downgrade to Moderate if the
  SDK folds mid-stream messages into the running turn.
- M-1 is Moderate and not a defect in the spec: A1 states the discovery turn permits only the tagged proposal, so spending the
  request on an untagged question is consistent with it.
- The guard being near-dead code while a request is active (every untagged question is auto-declined first) is not filed; it is
  harmless redundancy and the spec at `:472` still pins it.

## Verdict (summary)

N-1, N-3, M-1 closed; N-2 closed with over-eager clearing (S-1, M-1, M-3 above); M-2 partial. One Serious open.

Verdict: NEEDS_REVISION
