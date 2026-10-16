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

## After Phase E rounds 3 and 4 (code-logic-review-phase-e-r3.md, code-logic-review-phase-e-r4.md; visual-review-phase-e-r1.md)

- R3-3: no bound on a turn that never receives its terminal `turn_state`; S-E relies on delivery.
- F-2 (narrowed): the canvas detail transcript registers skip-if-present, so it loses visibility only if the page
  leaves first on the same tab.
- R3-4: a focused plate that becomes `visibility: hidden` by a relayout drops focus to the body.
- R3-5: the conductor tile reads `correlationId()` at register and at destroy; a changed id leaks a count.
- R3-6: after a stored `stopped`/`error`, a turn that begins without `send` keeps showing the stored status.
- R3-7: an abort started outside the page shows "could not finish" as an error.
- R3-8: the first send after an error shows the old `error`/`stopped` until the send acks.
- R4-2: after a mid-turn question is answered on the card, the HUD stays `listening` while the turn resumes.
- R4-3: a transient null then the same pending id re-scrolls the rail (`command-center-page.component.ts`
  `scrollToNewPendingCard`); clear the key only when the card resolves.
- R4-4: in the two-column layout `.work-list-region` keeps `tabindex="0"` but no longer scrolls (extra tab stop).
- Visual M-r1-2: light focus ring `oklch(0.72 0.18 55)` is 2.2-2.5:1 on light surfaces.
- Visual M-r1-4: shell tab strip scrollbar overlays labels at 892/900. M-r1-5: disabled control contrast.
- Visual M-r1-6: at 900x800 with 24 nodes the Ptah plate sits far from its sphere (`scene-layout.ts` root-plate
  fallback). M-r1-7: the "+1 completed" overflow chip has a square backing (`command-scene-renderer.ts:299-302`).
- Visual Minors (r1): header wraps at 892; chip status is colour only on screen; pending description scroll clips
  the last line; the session input outline is cut at the send button; session badge 10 px.
- Visual r3 Moderates (visual-review-phase-e-r3.md): the error toast pushes the dock down about 60 px; at 900x800 and
  892x735 the command input sits at or below the fold; the "+1 completed" overflow chip backing overlaps the hint
  text; the Ptah plate sits far from its sphere with 24 nodes (M-r1-6, M-r1-7 carried).
- Not reached in the r3 visual pass: a live mid-turn model question, a real Tribunal Confirm click, barge-in by voice.
