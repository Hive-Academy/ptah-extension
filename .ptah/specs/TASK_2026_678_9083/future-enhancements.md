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

## After Phase E revise round 1 (code-logic-review-phase-e-r1.md, APPROVED 7.5/10; visual-review-phase-e.md)

Deferred by the user's round 1 scope (2026-10-16): only S-1, M-1..M-3, N1..N5 and the overlapping Moderates
were in scope. F-1, F-3, F-4, F-5 and F-7 of the round 1 review are fixed in the follow-up pass (r1b).

- Logic M-4 (Phase E): typed error kinds `stt`/`tts`/`playback`/`chat` are declared but never produced; voice-loop
  failures show only a toast; mic errors still link to Voice settings.
- Logic M-5 (Phase E): a pinned card hidden for lack of space keeps an invisible pinned state
  (`command-overlay-positioner.ts:134-141`). Fall back to the least-overlapping position, or unpin.
- Logic M-6 (Phase E) and F-8 (r1): dense grid searches inside a reactive effect (`scene-layout.ts` compact packing
  and the root-plate fallback search, up to ~10k candidates at 1600x1000); the root plate fallback can land far from
  the sphere with no leader. Memoize per projection/viewport, coarse-to-fine grid, search outward from the root.
- Logic Minors m-1..m-6 (Phase E): Setup hub card Space key; `startVoice` clears unrelated toasts; Escape focus
  restore for the root plate; BOM in two files; root state derived twice; m-6 is closed by the r1 layout lane.
- F-2 (r1): visible-tab registration is not ref-counted (`tab-manager.service.ts:3091-3106`); a page that
  registered first and unregisters can hide a tab another surface needs; Start new while the old turn streams
  drops the old tab from the viewport. Counted register/unregister, or release the old tab only after it stops.
- F-6 (r1): the chip says "Voice unavailable" while the config loads; `open()` fetches the config only after
  `openOrResume()` succeeds; the chip aria-label does not contain its visible text (label-in-name).
- F-9 (r1): a new plate is laid out once with the guessed size and then jumps; a plate hidden because nothing fit
  keeps a stale size.
- F-10 (r1): with N5 fixed, Command Center turns add completion ledger entries and notifications; confirm no
  notification sound plays over the spoken reply.
- Visual M-e: the shell tab-strip scrollbar overlays the tab labels at 892/900 (`electron-shell.component.ts:150-157`).
- Visual M-g: disabled controls are 1.76:1 / 1.46:1 (carried M6).
- Visual Minors: no FPS meter compared with the prototype; Stop is not red; Ptah plate ~22 px right of the sphere
  centre in idle; plate tooltip card overlaps neighbours; Setup hub card focus ring differs from the Tribunal card;
  "Status" sends a billed status turn without saying so.
