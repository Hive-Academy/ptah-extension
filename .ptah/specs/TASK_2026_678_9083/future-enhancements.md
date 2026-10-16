# Follow-up items - TASK_2026_678_9083 (Command Center)

Deferred by the orchestrator with the user's decisions D40 and D41. Each item names its source review.

## Logic (code-logic-review-phase-d-final.md, reviewer Anthropic)

- M-1: no pulse-to-send correlation; a typed turn that finishes inside the voice transcription window
  leaves a phantom token and a deaf loop. Needs a turn or message id on terminal turn pulses.
- M-2: a clip that arrives while a typed turn is awaited cancels that reply; a failed typed turn can
  clear `busy` during transcription.
- M-3: a microphone failure disables Start for the page lifetime, and every capture failure reads as
  "permission denied".
- M-4: a failed or aborted chat turn after a voice send gives no spoken or visible feedback.
- The Minor items in the same file.

## Style (code-style-review-phase-d-rereview.md, reviewer Anthropic, APPROVED 7/10)

- M1 (carried): split `CommandCenterPageController` (461 lines); extract the roster flow into a page
  provider and share the pulse cursor with the Tribunal transport.
- N1: HUD error kinds are chosen by matching toast text; use typed toast fields like the M5 fix.
- N2: no spec asserts the S1 and S2 wiring (HUD outputs, theme feed).
- N3: the turn-state reset block is duplicated in `mute()` and `release()` of the voice loop.
- N4-N9 Minor, and the 10 Minor items of `code-style-review-phase-d.md`.

## Out of scope by decision

- Zoom and pan of the scene (D31): candidate task with a hand-written `{scale, tx, ty}` camera.
- Worktree setup should run `npx husky` (D15).

## After the D44 round (code-logic-review-phase-d-s1.md, APPROVED)

S-1, guard M-1 and guard M-2 from `code-logic-review-phase-d-guard.md` are CLOSED (D44). Open:

- M-A: `expectedRequest` has no lifetime bound after a skipped pulse. If the SDK folds the request
  into the running turn, or that turn is aborted, the next ordinary question on the tab is declined.
  Fix: a TTL on the request, or a grace timer after the skipped pulse.
- M-B: after the third failed automatic Decline, `retryInvalidDecline()` has no UI. The toast says
  "Retry the Decline" but the user can only leave the page. Fix: a `retry-decline` toast action, or
  change the copy.
- M-C: no specs for the retry timers and cap, the "request cancelled" text, or the second-pulse clear.
- Minor: `requestStatus` bypasses the send gate; `skipNextPulse` reads `tabs()` (active workspace
  only) and checks only `'streaming'`; a second untagged question waits while one is undeclined.
- From the guard review: `confirmProposal` clears a newer request's nonce (M-3), and its 2 Minors.
