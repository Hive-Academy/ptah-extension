# Code logic final re-review - Phase D, commits `711a1c980` and `e1f2e5ea7`

| Metric | Value |
| --- | --- |
| Score | 6/10 |
| Assessment | F1-F4 are closed and pinned. The earlier closures hold. One new Serious defect in the newly wired question card puts the A1 binding at risk. Four Moderate and two Minor items remain. |
| Blocking | 0 |
| Serious | 1 |
| Moderate | 4 |
| Minor | 2 |
| Reviewer family | Anthropic (in-process) |
| Implementer family | codex |
| Range | `711a1c980^..e1f2e5ea7` (47 files, 606 insertions, 184 deletions) |

Evidence against 7-8: S-A below is reachable on the live path, and no spec drives it. Every spec that offers a roster uses the exact tag. Evidence against 4-5: all four F-findings are fixed with specs, the kind and status refactors preserve behaviour, and nothing found touches data or permissions directly.

No nx, Jest or tsc was run (repo memory rule). The orchestrator reported command-center 217/217, chat-state 598/598, chat 3954 pass, typecheck and lint pass. Line numbers come from reading the checked-out files.

## Prior findings

| Id | Status | Evidence |
| --- | --- | --- |
| F1 (armed-turn FIFO never reset) | CLOSED | `mute()` and `release()` now call `options.onTurnsAbandoned` and reset `awaitingTurnToken` and `queuedTypedTurns` (`command-voice-loop.ts:529-545`, `:563-578`). The page clears the FIFO and the head token on mute, stop, exit (`command-center-page.controller.ts:340-349`, `:444-446`, `:457-460`). A non-success pulse or an empty message now settles the head and calls `abandonTurn` (`controller:299-304`, `voice-loop:449-453`), so the lost-pulse head of scenario B no longer sticks. Pinned by `controller.spec.ts` "clears armed turns on %s" (`:155`), "abandons a failed pulse..." (`:256`) and `voice-loop.spec.ts:86`. Residual stale-entry paths are M-1 and M-2. |
| F2 (roster timer runs while hidden) | CLOSED | The timer starts in the display effect only while `rosterShown` and is cleared when hidden (`controller:258-269`). Timeout toasts and sets `rosterTimedOut` (`:429-440`). Pinned at `controller.spec.ts:556-568` (null while approval is shown, non-null after it resolves). Minor m-1 covers a second roster. |
| F3 (typed turn in the transcription window) | CLOSED for the stated scenario | `armTypedTurn` queues when `busy \|\| awaitingBoundary` (`voice-loop:415-421`) and `finishTurn` arms the queued turn (`:511-515`). Pinned by `voice-loop.spec.ts:64`. The reverse direction (typed turn already waiting, then a clip) is M-2. |
| F4 (pendingRoster stays true behind an approval) | CLOSED | The display effect calls `voice.setRosterPending(rosterShown)` on every run (`controller:263`, `voice-loop:480-482`). Pinned at `controller.spec.ts:558` and `voice-loop.spec.ts:102`. |
| B1 | CLOSED | `tab-manager.service.ts` and the Tribunal transport are not in the range. |
| S1 (projection ownership) | CLOSED | Ownership logic in `command-center-projection.source.ts` is untouched. Only the status mapper calls changed (`:91`, `:113`, `:126`) and the mapper body is identical to the removed local `state()`. |
| S2 (lane join and run roll-up) | CLOSED, one behaviour change (m-2) | The lane-to-agent join is untouched. `runState` keeps the order running, failed, then others. With the five real `AgentStatus` values the only change is that a run mixing `stopped` and `completed` agents is now `cancelled`, not `completed`. |
| S3 / N1 (permission vs roster card) | CLOSED | `shownInput` priority is unchanged (`controller:117-147`). `shownProposal` still gates the roster branch on the shown id (`:148-153`). Pinned at `controller.spec.ts:537-619`. A1 itself is reopened by S-A for a different path. |
| M1 (typed arm only when active) | CLOSED | `armTypedTurn` returns while inactive (`voice-loop:416`). |
| N2 (typed send during a voice turn) | CLOSED | The queue-then-arm path is intact (`voice-loop:415-429`, `:511-515`). Pinned by `voice-loop.spec.ts:42` and `controller.spec.ts:323`. |

## Five logic questions

1. **Silent failure.** A chat turn that ends in error or aborted settles through `abandonTurn` and the page says nothing (M-4). A typed reply is not spoken when a clip arrives while it is awaited (M-2). Both leave text visible.
2. **Surprising user action.** Typing a short command while a long utterance is being transcribed can leave the loop deaf (M-1). Clicking "Confirm" on a proposal the model delimited differently sends the literal "Confirm" to the model (S-A).
3. **Wrong-answer input.** A model proposal with any delimiter other than the exact tag is rendered as an ordinary question with Decline and Confirm buttons (S-A).
4. **Dependency failure.** A microphone failure of any kind disables Start for the page lifetime (M-3). The model may ignore the tag because no prompt names it (S-A).
5. **Missing requirement.** Nothing says what an armed turn should do when its pulse never arrives; only Mute and Stop clear it (M-1).

## New findings

### Serious

**S-A. An untagged roster proposal becomes an ordinary question, and the newly wired choice buttons and the voice path deliver the literal "Confirm" to the model (A1.1, AC22).**

- Files: `libs/frontend/chat-state/src/lib/command-center-persona.ts:10` (persona), `command-center-page.controller.ts:82-97` (`ordinaryQuestion`), `:98-103` (`ordinaryChoices`), `command-center-page.component.ts:128` (`[choices]`), `command-pending-input.component.ts` ordinary-question branch, `command-voice-loop.ts:362-373` (voice answers a `question`).
- Facts, confirmed by `grep` over `libs`, `apps`, `.claude` and `docs`: `TRIBUNAL_ROSTER_PROPOSAL` appears only in the controller, the parser and specs. The persona says "a clearly delimited payload" and names neither the tag nor the JSON fields the zod schema needs (`proposalId`, `nonce`, `rootSessionId`, `move`, `options`, `objective`, `rounds`, `lanes[laneId, family, displayName, cli]`, `tribunal-roster-proposal.ts:12-33`). The request block carries only `nonce` and `rootSessionId` (`controller:405-409`). The style review's carry-over note (`code-style-review-phase-d-rereview.md:77`) asked for this to be confirmed; it is confirmed.
- Scenario: the user says "run a council on this". The model follows the persona: `AskUserQuestion` with options Decline then Confirm and a payload in whatever delimiter it picks. `ordinaryQuestion` excludes a question only when its text contains the exact tag (`:92-94`), so this one is an ordinary question. Before the range the card offered a free-text box. This range binds `[choices]="page.ordinaryChoices()"`, so the card now shows "Decline" and "Confirm" buttons. Clicking Confirm calls `answerOrdinaryQuestion` and sends `Confirm` to the model. Saying "confirm" or "yes" does the same through `answerOrdinaryQuestion` in the voice loop, because `pendingRoster` is false and `pendingInput.kind === 'question'`.
- Impact: A1.1 says the page never sends the literal "Confirm" or any affirmative answer to the model, and AC22 says Confirm comes only from the page card. Both are violated on the most likely live path. No paid run starts, because launch needs the page-controlled turn and the persona forbids launching on any answer. The Tribunal feature is also dead live: the real roster card never appears. The integration and controller specs feed tagged synthetic proposals, so nothing catches this.
- Fix (three small changes):
  1. Move `TRIBUNAL_ROSTER_PROPOSAL_TAG` to `chat-state` beside `COMMAND_CENTER_TRIBUNAL_REQUEST_TAG` and interpolate it into the persona with the exact field list and an example, so the persona and parser cannot drift.
  2. In `ordinaryQuestion`, also exclude a question when a Tribunal request is outstanding (`expectedRequest()` is set) and any option label matches `/confirm/i`. Surface it as the invalid-proposal card with Decline only, and answer Decline per A1.3.
  3. In `ordinaryChoices` and `answerOrdinaryQuestion`, never offer or accept an answer that matches `/^(confirm|yes|approve|go ahead)/i` for such a question.
  Add one controller spec that offers an untagged Decline/Confirm question and asserts no Confirm button and no `answerQuestion` call from click or speech.

### Moderate

**M-1. No pulse-to-send correlation: a typed turn that finishes inside the voice transcription window leaves a phantom token and a deaf loop.** The implementer's residual risk is reachable, in one narrow window. It is not an inversion of completion order: turns in one session are sequential, so pulse order equals send order.
- What is harmless: the typed send T goes first and the voice send V second, while arm order is V then T. T's pulse (if it arrives after V is armed) settles V's token and V's pulse settles T's token. Both replies are still spoken in completion order; only the latency attribution is swapped.
- What is not: if T's pulse arrives before `sendTranscript` for V resolves, V's `minPulseSeq` already covers T's pulse. After V's boundary, `finishTurn` arms the queued T as a new token (`voice-loop:511-515`, `beginAwaitingTurn` `:424-429`) whose `minPulseSeq` covers every existing pulse, so it never settles. `awaitingBoundary` stays true and `busy` false. The next clip clears `awaitingBoundary` (`:335`), sends, and its token is queued behind the phantom in the page FIFO. The next real pulse is given to the phantom, `onTurnBoundary` returns on the token mismatch (`:432-439`), that reply is lost, and the real token stays at the head with `busy` true. Later clips queue behind it until a Mute or Stop (both now reset, `F1`).
- The same shape occurs when mute is followed by unmute and speech while the pre-mute turn is still running (`coordinator.mute()` does not abort the chat): the old turn's pulse settles the new token and the new reply is never spoken.
- Likelihood: needs a typed reply faster than transcription (local cold-worker STT is the slow case). Recovery: Mute or Stop. Severity: Moderate.
- Fix: give each send a correlation value. The pulse already carries `seq`; record the `lastTerminalPulse.seq` observed at send time and also the tab's turn count, or have `sendCommand` return the user-message id and match the pulse's turn. Short of that, add an expiry to the head entry: drop it when a later entry's pulse arrives, or after a fixed bound (for example 10 minutes).

**M-2. A clip arriving while a typed turn is awaited cancels that reply, and a failed typed turn can clear `busy` mid-transcription.**
- `onClip` sets `awaitingBoundary = false` unconditionally (`voice-loop:335`). A typed turn waits with `busy === false` (`beginAwaitingTurn`, `:424-429`), so any clip (speech, cough, an empty transcript that calls `finishTurn`) disables the boundary for the typed reply. `onTurnBoundary` returns on `!this.awaitingBoundary` (`:432-439`). The reply is never spoken and no toast is shown. The page FIFO settles correctly, so state stays consistent. Text stays visible.
- `abandonTurn` has no such guard (`:449-453`): if the typed turn then ends in error while a clip is being transcribed, it matches `awaitingTurnToken`, calls `finishTurn`, and sets `busy = false`, `turnGeneration = null` and `currentReplyOrigin = null` while the transcription is in flight. A second utterance then starts a parallel turn instead of queueing.
- Fix: make a waiting typed turn occupy the turn slot (`busy = true` in `beginAwaitingTurn`, cleared by `finishTurn`) so clips queue behind it, and drop the unconditional reset at `:335` or restrict it to a turn that has no token. Add `if (!this.awaitingBoundary) return` to `abandonTurn`.

**M-3. Microphone failure disables Start for the whole page lifetime, and every capture failure reads as "permission denied".**
- `voiceErrorKind` returns `mic-denied` whenever the toast text contains "Microphone" (`controller:50-58`). `start()` produces that text for `denied`, `unavailable` and `worklet` (`voice-loop:237-242`). The HUD shows "Microphone permission was denied." for all three (`command-voice-hud.component.ts:23-30`) and `canStart` is false while the kind is `mic-denied` (`:114-120`).
- Nothing clears the toast: `setToast(null)` is never called outside specs, and a toast is replaced only by another toast. Start therefore stays disabled until the user leaves the page (the store is page-scoped) or an unrelated toast appears. A user who plugs in a device or grants access cannot retry.
- Fix: expose the capture reason as typed state (`captureFailure: 'denied' | 'unavailable' | 'worklet' | null`) instead of matching message text. Keep Start enabled and clear the failure when `start()` begins. Show the denied copy only for `denied`.

**M-4. A failed or aborted chat turn after a voice send gives no feedback.** `abandonTurn` returns the loop to listening and nothing is spoken or toasted (`controller:302-304`). The HUD `chat` error kind exists but is set only by the transcription exception toast (`voice-loop:405-411`). In hands-free use the user speaks and hears nothing. Fix: on a pulse with classification `error`, set a toast (and speak a short failure line); stay silent for a user abort.

### Minor

- **m-1. A second roster keeps the first one's timer state.** The effect starts a timer only when `rosterTimeout === null` (`controller:265`) and captures the first `proposal.proposalId`. If a new roster replaces the first while it is shown, the old timer fires `timeoutProposal(oldId)`, which returns on the id check (`:429-431`) before `clearRosterTimeout`. The stale handle then blocks every later timer, so the new roster never times out until it is confirmed, declined, hidden or the page exits. Fix: clear and restart the timer when `proposal.proposalId` changes, and clear the handle on the early return.
- **m-2. Run roll-up now reads `stopped` plus `completed` as `cancelled`.** The old inline logic said `completed` (S2 closure). `runState` and its spec pin the new reading (`work-state.spec.ts`), and the style fix report records it. The consequence: a run where the user stopped one lane never gets "Tribunal completed" narration, because the narrator speaks only running, completed, failed for a tribunal node (`status-narrator.ts` `meaningful`). Accepted as a deliberate decision; revisit if a partial run should still be called finished.

## Checked and not filed

- **M3 mapping.** `workStateForStatus` matches the removed `state()` case for case (`work-state.ts`). Lanes can only carry the five CLI statuses, so the new lane mapping gives the same result as the old ladder; unbound lanes stay `queued`. No visible state changed except m-2.
- **`kind` replacing id prefixes.** No `startsWith('lane:'|'phase:'|'tribunal:'|'child:'|'cli:'|'sdk:')` remains in non-test code (grep). Every production node literal sets `kind` (`work-projection.ts:61,129,146,159,173,187,196,219`). `narrator.meaningful` covers the old prefixes: child, cli and sdk map to `child`/`agent`, with `root` returning false as before. The exhaustive `never` guard compiles away a missing kind. Sprite size, palette, layout orbit filter and the child label match the old prefix tests one for one.
- **HUD wiring.** Interrupt is enabled only while `speaking` and calls `interruptSpeech`, which stops playback and resets state (`voice-loop:455-461`). Open voice settings calls `appState?.setCurrentView('settings')`. The Resume button was dead (`canResume` never bound) and its removal loses nothing, since `open()` already resumes.
- **Theme and reduced motion.** The theme effect and the media query listener are cleaned up through `DestroyRef`. The scene keeps its own media listener, and both read the same OS value.
- **Required turn token and `beginAwaitingTurn`.** `onTurnBoundary` now rejects a mismatched or missing token (`voice-loop:432-439`). The page always passes the head token (`controller:303`).
- **Protocol tags.** The persona interpolates `COMMAND_CENTER_TRIBUNAL_REQUEST_TAG`, the same constant used to build the request block (`controller:408`), so text and block match. The roster regex built from `TRIBUNAL_ROSTER_PROPOSAL_TAG` is equivalent to the removed literal (the tag has no regex metacharacters). Persisted sessions hold the same persona text as before.
- **A1 on Approve/Deny.** `answerPermission` is still the only permission path and is reached only from the card. Speech with an approval shown hits the guard and never calls `handlePermissionResponse` (`voice-loop:374-380`). Roster Confirm is card-only. The one A1 hole is S-A.
- **Uncertainty.** Status and launch turns are not armed. Their pulses on the marked tab can be consumed by an armed head token (not traced; predates the range). I could not confirm whether the chat queue merges two queued messages into one turn; if it does, M-1's phantom token also appears without the transcription window.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| The implementer's residual risk is filed as Moderate M-1 and not as an "inverted completion order" finding | (a) not filed; (b) Moderate; (c) Serious | Same-session turns are sequential, so completion order equals send order and the swapped labels are harmless. A concrete failing case exists only when the typed turn completes before the voice send resolves; Mute and Stop recover. | yes |
| S-A is Serious and counts against this range although the persona gap and the tag-only exclusion are older | (a) out of range, not filed; (b) Serious; (c) Blocking | The `[choices]` binding in this range turns the free-text path into one-click "Confirm". The user named A1 and AC22 as binding for this review. No launch is possible without the page-controlled turn, so not Blocking. | yes |
| m-2 (stopped plus completed is cancelled) is Minor and not a regression | (a) Moderate; (b) Minor | Deliberate, documented and pinned; stopped is a user or model stop request, and no code path stops lanes in normal runs. | yes |
| The style reviewer's carry-over note on the roster tag is confirmed and folded into S-A | (a) separate finding; (b) fold into S-A | Same root cause and same fix. | yes |

Verdict: NEEDS_REVISION
