# Code logic re-review (round 2) — Phase D bounded correction `c4f4a51c7`

| Metric | Value |
| --- | --- |
| Score | 6/10 |
| Assessment | N1 is fixed and pinned. N2's stated overlap is fixed and pinned, but the new turn FIFO has no reset when voice is muted, stopped or loses a turn. A stale head entry swallows the next real reply and leaves the voice loop busy. |
| Blocking | 0 |
| Serious | 1 |
| Moderate | 2 |
| Minor | 1 |
| Reviewer family | Anthropic (in-process) |
| Implementer family | codex |
| Range | `c4f4a51c7^..c4f4a51c7` |

Evidence against 7-8: one Serious regression (F1) against the old single-slot token, which could not accumulate stale entries. Evidence against 4-5: the specified N1 and N2 scenarios behave as required, A1 is untouched, and the defects need a mute/stop or a lost-pulse step first.

No nx, Jest or tsc was run (repo memory rule). The orchestrator reported command-center 193/193, typecheck and lint. None of those specs mute, stop or error a turn between two arms, which is where F1 shows. Line numbers below come from `grep -n` on the checked-out files.

## Prior findings

| Id | Status | Evidence |
| --- | --- | --- |
| N1 | CLOSED | One computed `shownInput` (`command-center-page.controller.ts:81-111`) orders marked-tab permission, then pending roster, then ordinary question. One effect writes `pendingInput` (`:214-229`). `shownProposal` (`:112-117`) hands the card a proposal only while the roster question is shown, so the card cannot render the roster branch over an approval. `permissionRequest` still filters to the marked tab (`:68-80`). Spoken prompts are de-duplicated by request id (`:51`, `:225`), so priority changes do not re-speak. Pinned by `command-center-page.controller.spec.ts` "keeps approval shown when a roster arrives..." and "restores approval after declining a roster...". |
| N2 | CLOSED (stated scenario); see F1 for the new defect | A typed send during a pending voice boundary now increments `queuedTypedTurns` (`command-voice-loop.ts:417-419`) and arms after the voice boundary settles (`:442-445`). The page keeps a per-token baseline (`command-center-page.controller.ts:136-146`) and the effect shifts exactly one entry per pulse (`:247-248`). Pinned by "settles voice pulse 5 before typed pulse 6 with separate turn tokens" and "queues a typed turn behind a voice boundary...". |
| B1 | CLOSED | No change to `tab-manager.service.ts` or the Tribunal transport in this commit. |
| S1 | CLOSED | `command-center-projection.source.ts` untouched. |
| S2 | CLOSED | Projection source untouched. |
| S3 | CLOSED | N1 closes the remaining overwrite. A1 holds: Approve/Deny go only through `answerPermission` (`:307`), which the card calls; speech with `pendingInput.kind === 'approval'` hits the guard in `command-voice-loop.ts` `onClip` and never calls `handlePermissionResponse`. Roster Confirm is still card-only. The only change to the roster path is that its spoken summary now comes from the display effect (`:225-228`), which does not touch confirm. |
| M1 | CLOSED | `armTypedTurn` still returns while `active` is false (`command-voice-loop.ts:416`). The new queue branch is reachable only when active. The count's lifetime is F1. |

## Five logic questions

1. **Silent failure.** A stale head in `armedTurns` consumes a real pulse, marks it delivered and drops the reply: `onTurnBoundary` returns on the token mismatch (`command-voice-loop.ts:429-434`) while the page has already set `deliveredPulseSeq` (`command-center-page.controller.ts:246`). No toast, no log. This is F1.
2. **Surprising user action.** Mute during a voice turn, type a message during that turn, unmute and speak. The loop then arms a turn that has no send behind it. A roster that arrives while a permission is shown still starts its 120 s clock (F2).
3. **Wrong-answer input.** Two turns whose pulse order differs from their arm order. Arm order is the FIFO order, send order decides the pulse order (F3).
4. **Dependency failure.** A turn that ends with a non-success pulse or an empty `lastAssistantMessage` never satisfies the effect's gate (`:240-242`), so its entry stays at the head. The loop already waits forever for that boundary, but the old token was replaced by the next send, and the FIFO now keeps it.
5. **Missing requirement.** Nothing says what happens to armed turns on mute, stop, exit, or when a turn yields no spoken reply. The FIFO added state and no cleanup for it.

## New findings

### Serious

**F1. The armed-turn FIFO and the voice loop's typed-turn queue are never reset or reconciled, so a stale entry swallows the next real reply.**

- Page FIFO: `command-center-page.controller.ts:49` (declared), `:144` (push), `:247` (only removal; success pulse with a message). `muteVoice`, `stopVoice` and `exit` do not touch it.
- Voice queue: `command-voice-loop.ts:66`, `:418`, `:442-445`. `release()` clears the count (`:547`). `mute()` (`:507-527`) does not, and `onClip` (`:320-333`) does not either.
- Scenario A (queued typed turn survives mute): a voice turn is in flight (token 1). The user types, so `queuedTypedTurns` is 1. The user mutes: `mute()` sets `awaitingBoundary` false but leaves the count at 1. The user unmutes and speaks (token 2). When its boundary settles, `onTurnBoundary` spends the stale count and calls `armTypedTurn()` (`:442-445`), which calls `onVoiceSend` and pushes a phantom token 3 on the page. The phantom has no turn behind it. The next voice turn gets token 4, the FIFO is `[3, 4]`, and the pulse for turn 4 is assigned to token 3. `onTurnBoundary(text, 3)` returns on the mismatch (`awaitingTurnToken` is 4). The pulse is marked delivered and the reply is never spoken. `busy` stays true (`finishTurn` never runs), so later clips queue behind it and the voice loop appears deaf until some other pulse settles token 4.
- Scenario B (lost pulse): a voice turn ends with an error classification or no final assistant text. Its entry stays at the head and the loop stays `awaitingBoundary`. The user then types: the old code replaced the token and spoke the typed reply. The new code queues it (`:417-419`). The typed turn's pulse settles the stale token 1, and `onTurnBoundary` arms a phantom token 2 from the queue. The next real turn is then lost as in Scenario A.
- Scenario C (stale head after stop/mute): a voice turn is sent, then voice is stopped and restarted before its pulse arrives. The entry for the stopped turn is still the head. If that turn's pulse never comes because the turn was aborted, every later pulse settles the wrong token.
- Impact: the user's voice reply is silently dropped and the voice loop stops taking clips. This path is more likely than the old single-slot behaviour and is the same class as the round 1 N2 (the wrong turn is spoken or the right one is lost).
- Fix: (1) clear `queuedTypedTurns` in `mute()` and when `onClip` resets the turn state; (2) give the loop an `onTurnsAbandoned` callback, or have the page clear `armedTurns` and `voiceTurnToken` from `muteVoice`, `stopVoice` and `exit`; (3) in the page effect, shift entries until the head token equals the loop's current `awaitingTurnToken`, or let the loop expose which tokens are still live; (4) add specs for mute-with-queued-typed, error pulse then typed send, and stop then restart then speak.

### Moderate

**F2. A roster hidden behind a permission can expire without the user seeing it.** `command-center-page.controller.ts:208` starts the 120 s timer when the roster is received, but `shownInput` can hide the roster for as long as a permission is pending (`:81-90`). `timeoutProposal` (`:366-372`) clears the proposal with no toast and no spoken message. Scenario: a tool permission waits for two minutes, the roster arrives, the roster times out, the user approves, and the roster never appears. Fix: start the timer when the roster is first shown (in the display effect), or pause it while hidden, and toast on timeout.

**F3. A typed turn armed in the voice transcription/send window is dropped, or can be spoken as the wrong turn.** `onClip` clears `awaitingBoundary` on every new clip (`command-voice-loop.ts:333`), so `armTypedTurn` does not queue during transcription (the queue branch at `:417` needs `awaitingBoundary`). The typed token T is armed immediately, then the voice send overwrites `awaitingTurnToken` with T+1 (`:395-397`). The page FIFO is `[T, T+1]`. If the typed pulse arrives first, it is rejected on mismatch and the typed reply is not spoken. If the voice send resolved after the typed send but started earlier, the voice pulse arrives first and is consumed by token T, then the typed pulse is spoken as the voice reply. The window is the transcription time (seconds). Fix: queue typed turns whenever `busy` is true, not only when `awaitingBoundary` is true.

### Minor

**F4.** `pendingRoster` stays true while the card shows an approval over a spoken roster (`command-voice-loop.ts` `onRosterProposal`, cleared only by `onRosterResolved`). A spoken reply then gets the toast "Confirm or decline the roster on the card" while the card shows an approval. The approval guard text would be correct. Fix: reset `pendingRoster` when the shown input is not the roster, and set it again when the roster returns.

## Checked and not filed

- Priority flapping: the display effect re-runs when any dependency changes and `setPendingInput` always writes a new object, but the spoken dedupe by id prevents repeats. A permission that returns with the same id (spec) is not re-spoken; a real resolved id does not return.
- Permission for another tab: `permissionRequest` requires `request.tabId === markedTabId`, or the session id when the request has no tab id (`:68-80`).
- Answer paths: `answerOrdinaryQuestion` and `answerPermission` no longer clear `pendingInput` themselves, but `handleQuestionResponse` and `handlePermissionResponse` remove the request from the chat signals synchronously (`permission-handler.service.ts` `_questionRequests.update` and `_permissionRequests.update`), so the effect clears the card on the next tick. The card also blocks a second click per id.
- Send failure: `onVoiceSend` runs only after a successful send (`:394-397`), and `armTypedTurn` only after `sent` (`:331`, `:347`), so a failed send adds no entry.
- Exit: `release()` clears the count (`:547`) and the page's `exit()` ends the page lifetime, so the FIFO leak is for mute/stop-restart and lost pulses within one page lifetime.
- Pulse settling two turns: the effect shifts one entry and sets `deliveredPulseSeq`, so the same pulse cannot settle the next token. A stale pulse cannot settle a newer token because of the `> minPulseSeq` baseline taken at arm time (`:137-143`).
- Uncertainty: status and launch turns (`sendStatusTurn`, `sendLaunchTurn`) also produce pulses on the marked tab and are not armed. A head token may consume them. This predates the commit and I did not trace whether they are suppressed elsewhere.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Count N2 as CLOSED for its stated scenario and file the leak as new F1 (Serious) | (a) N2 PARTIAL; (b) N2 CLOSED plus F1 | The stated overlap is fixed and pinned; the leak comes from state the commit introduced (`:49`, `:66`), not from the overlap. | yes |
| Rate F1 Serious, not Blocking | (a) Blocking; (b) Serious | A reply is lost and voice stalls, but text and the card remain usable and no permission or data is affected. | yes |
| Leave F3's inverted-order case Moderate | (a) Serious; (b) Moderate | The window is the transcription time and needs a typed send inside it. | yes |

Verdict: NEEDS_REVISION
