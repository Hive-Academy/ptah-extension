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

## Open after the last authorized round (code-logic-review-phase-d-guard.md, D43)

- S-1 (Serious, medium confidence): a turn already running when the Tribunal request is sent clears
  `expectedRequest` when it ends (`command-center-page.controller.ts:317-339, 496-499`), so the real
  proposal is declined. Fails closed. Fix: clear only on the terminal pulse of the request turn itself
  (record the pulse baseline at request send and ignore earlier turns).
- A stray untagged question spends the request.
- A failed automatic Decline leaves the question hidden while free text or voice can still send "yes".
- `confirmProposal` clears a newer request's nonce.
- The 2 Minor items in the same file.
