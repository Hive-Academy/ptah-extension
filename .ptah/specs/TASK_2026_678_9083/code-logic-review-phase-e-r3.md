# Code Logic Review - TASK_2026_678_9083 - Phase E round 3

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 7/10 |
| Assessment | NEEDS_REVISION (one Serious, introduced by the S-C layout fix) |
| Blocking issues | 0 |
| Serious issues | 1 (R3-1) |
| Moderate issues | 3 (R3-2, R3-3, F-2 carried) |
| Minor issues | 5 |
| Range | `git diff 65ef903ba ee39c7311 -- libs/` (15 files) |

Scope read in full: `command-center-turn-status.ts`, `tab-manager.service.ts` (`registerVisibleTab`, `unregisterVisibleTab`,
all references to the visible set), `command-voice-loop.ts` (`speak`, `finishTurn`, `onFrame`, `onTurnBoundary`, `mute`, `release`),
`tts-playback-queue.ts` (whole file), `command-overlay.component.ts` plate template, the page component CSS, template and
`visibleLabelIds`, `command-pending-input.component.ts` hunk, `conductor-tile.component.ts:200-240`,
`canvas-detail-transcript.component.ts:90-112`, `chat-stream-delivery-coordinator.service.ts` reveal path (from the earlier rounds), and
the turn lane report. Specs were read only for what they assert. Nothing was run (no Jest, Nx or build, per the instruction). Rendered
layout and the live host are therefore unproven by me.

## Review family

Reviewer: Anthropic (in-process, Claude). Implementer: codex CLI lanes (turn, voice, layout) plus Anthropic orchestrator corrections
(canvas change reverted, `untracked()` around the register call, `resetLevels` mock). The orchestrator corrections are from my own
family, so I read them as carefully as the lane code.

## Status of S-A to S-F

| Item | Status | Evidence |
| --- | --- | --- |
| S-A visible-tab ownership | CLOSED in code; root cause unproven | Ref count in `tab-manager.service.ts:3092-3112`; page registers unconditionally inside `untracked()` and releases in `onCleanup` (`command-center-turn-status.ts:37-44`). See the audit below. |
| S-B speaking state | CLOSED for the reported case; two gaps (R3-2) | `tts-playback-queue.ts:128-135,153-165` and `command-voice-loop.ts:144-156,528-529,549`. |
| S-C stage stretched by a long roster | PARTIAL: fixed, but the fix clips rail content (R3-1, Serious) | `command-center-page.component.ts:57,75-87`. |
| S-D light-theme input contrast | CLOSED in code; contrast unproven | `command-pending-input.component.ts:118` uses the `!` important variants, which beat the theme rule by specificity. Needs the visual re-review to measure. |
| S-E failed start leaves page running | CLOSED in code; delivery unproven | `shownSessionStatus` (`turn-status.ts:15-18`) lets stored `stopped`/`error` win; failure toast in both settle effects. Relies on the terminal event arriving (R3-3). |
| S-F stray plate on the header | CLOSED in code; cause unproven | `visibleLabelIds` gate (`page.component.ts:383-389`, `overlay.component.ts:42-46`). |

### 1. S-A ref count audit

Callers and balance:
- Command Center page: `registerVisibleTab` runs inside `untracked()` in an effect that tracks only `markedTabId`
  (`turn-status.ts:37-44`). Each run is paired with one `onCleanup` unregister of the same id, which Angular runs on re-run and on
  destroy. Balanced, and it no longer depends on `visibleTabIds()` so it cannot be skipped. The orchestrator's `untracked()` wrapper is
  required and sufficient: the registration does not read or write a tracked signal, so the re-run loop seen in the canvas spec cannot
  occur here (`_visibleTabIds.update` is a write inside `untracked`, no read).
- Canvas transcript: `if (visibleTabIds().has(id)) return false; register; onCleanup(unregister)` runs only when it registered
  (`canvas-detail-transcript.component.ts:99-107`). It never unregisters what it did not register, so it cannot underflow or leak. Its
  one weakness is unchanged: if another owner (the page) holds the tab, the tile skips, and when that owner leaves the tile mounted
  for the same tab loses visibility (F-2, Moderate, now only this ordering).
- Conductor tile: registers once in `ngOnInit` and unregisters in `ngOnDestroy`, both reading `tribunalState.correlationId()` at the
  moment of the call (`conductor-tile.component.ts:225-237`). If the correlation id changes or is cleared between the two, the
  original id keeps its count forever (Minor R3-5). Before this round that leak was an idempotent set entry; now it also keeps a
  co-owner's tab visible after the co-owner leaves. The conductor's tab is normally not the Command Center tab, so the practical
  reach is small.
- Underflow: `unregisterVisibleTab` returns when the count is 0 (`:3103-3105`), so an unmatched unregister cannot drive the count
  negative or remove another owner's entry. Over-registration (register twice without unregister) is the only way to leak, and I
  found no caller that does it.
- Nothing else mutates `_visibleTabIds` (only lines 304, 3096, 3110). Closing a tab does not clear its count, which is harmless
  because owners clean up on their own lifecycle.
- Root cause: the lane could not prove the old-skip-if-present ordering that the reviewer saw (the lane report says so). The page
  registering unconditionally and the count make every overlap order safe, so I consider S-A closed by construction. If a voice turn
  still stays `streaming` in the next Electron run, the cause is elsewhere (host reveal or delivery), not ownership.

### 2. S-E: stored `stopped`/`error` precedence

- New turn after a Stop or error: `coordinator.send` sets stored `running` after the sender resolves (`session-coordinator.ts` `send()`),
  so `shownSessionStatus` returns `running` again from that moment. Between the click and the send ack (tens of ms to a `session:validate`
  round trip) the badge still shows the old `stopped`/`error` while the tab is already `streaming`, because the stored value now wins.
  Brief and the right way round (it never shows a stale `running`), but it is a visible flicker on the first send after an error.
- A turn that starts without `send` (background wake, queued message) after a stored `stopped`/`error` keeps showing `stopped`/`error`
  until the next send. Acceptable; Minor (R3-6).
- Failure toast on a user Stop: no. `coordinator.stop()` sets `stopped` synchronously before it aborts (`session-coordinator.ts` `stop()`),
  and both settle effects require stored `running` (`turn-status.ts:67-75,93-104`), so the abort's terminal pulse or edge is ignored.
  Stop from outside the page (chat surface or tab strip) leaves stored `running`, so the terminal reason `aborted_*` shows
  "The Command Center turn could not finish." Minor (R3-7): reasonable but it reads as a failure.
- No double toast: the pulse effect settles first and sets the status away from `running`, so the edge effect skips.
- A failed first start with no pulse (no resolved session id): the edge effect covers it via `lastTerminalReason`.
- Residual (R3-3): all settling depends on a `turn_state` reaching the frontend. If the host or viewport never delivers it, the tab
  stays `streaming` and the page shows `running` with no timeout or watchdog. N5 and the ref count reduce this to a delivery fault, but
  nothing bounds it.

### 3. S-B voice state machine

State sources: `speak()` ends by setting `thinking` unless already `speaking` (`command-voice-loop.ts:528-529`); playback start sets
`speaking` (callback `true`, after `play()` resolves); playback end, queue empty, sets `listening` only if `!hasPending && !busy &&
!awaitingBoundary`; `finishTurn` sets `listening` only if `!hasPending`; the old self-heal in `onFrame` was removed.

| Path | Result |
| --- | --- |
| Reply with synthesis delay (3.5 s) | `thinking` during synthesis, `speaking` from audio start, `listening` at last clip end. Correct. |
| Multiple chunks | `notifiedPlaying` stays true across clips, so no flicker between clips; the empty-queue branch resets it. Correct. |
| Last clip ends while the next is still synthesizing | head clip has no blob, so no `false` is emitted and the state stays `speaking`/`thinking` until the next clip plays. Correct. |
| All clips fail | failed heads are shifted, queue empty, `false` emitted, `listening` if not busy. Correct. |
| Barge-in | `stopAll` emits `false`; mic start path sets `listening` when nothing is pending (`:322`). Correct. |
| Mute / stop / release | `active=false` is set before `playback.stopAll()`, so the callback returns early and the explicit `muted`/`idle` state wins. Correct. |
| Turn ending with no speech | `finishTurn` sets `listening` (no pending). Correct. |
| Stuck-state: spoken prompt while a turn is awaiting its boundary | R3-2 below. |

#### R3-2 (Moderate). `speaking`/`thinking` can stay set with nothing playing

- File: `command-voice-loop.ts:144-156` (end-of-playback callback requires `!awaitingBoundary && !busy`), `:288-292` (self-heal removed).
- Scenario: a question card appears mid-turn on a voice session (`onPendingPrompt` speaks it while `awaitingBoundary` is true, and
  `busy` stays true through the turn). The prompt finishes, the callback sees `awaitingBoundary`, and does not reset. The HUD keeps
  saying "Speaking" (or "Thinking" if synthesis failed) for the whole time the model waits for the user's answer. The old per-frame
  reset healed this; it was removed. It self-heals only when the user starts speaking (`:322` with nothing pending) or the turn ends.
- Impact: wrong feedback at exactly the moment the user must answer, and the Interrupt control is offered with nothing to interrupt.
- Fix: in the end-of-playback callback, reset to `listening` when `!playback.hasPending` regardless of `busy`/`awaitingBoundary`
  (those only matter for `thinking`-before-reply), or restore a frame-level check of `!isPlaying && !hasPending && state==='speaking'`.

### 4. S-C / S-F layout and the hidden-plate rule

#### R3-1 (Serious). The rail clips pending input and the reply with `overflow: hidden`

- File: `command-center-page.component.ts:75-87` (`.rail { max-height: clamp(420px, calc(100vh - 280px), 620px); overflow: hidden }`,
  `.work-list-region { min-height: 0; flex: 1 1 auto; overflow-y: auto }`), template order `:277-345`.
- Scenario: grid layout (container at least 720 px wide). The rail is a column of: selected-node card (always present, the root is
  selected by default, about 150 px), the pending card, the latest reply paragraph, then the work list. Only the work list can
  shrink (`min-height: 0`); everything else keeps its content height. At a 735 px tall window the rail is 455 px. A Tribunal
  roster card with 3 lanes is about 400 px (title, description up to 96, lane list, helper text, Decline and Confirm row), so
  150 + 400 + gap exceeds 455. The Decline/Confirm row, or the Send answer button of a question card, falls below the clip, and with
  `overflow: hidden` the mouse wheel cannot scroll it into view; only keyboard focus can (the browser scrolls a hidden-overflow box
  for a focused child). The reply paragraph is unbounded and also clipped, and the work list collapses to zero height while still being a
  focusable `tabindex="0"` region.
- Impact: a pointer user cannot answer an approval or confirm a roster on a short window, and cannot read a long reply. These are the
  actions the page exists for. The stacked layout (container under 720 px) resets the clip (`:101-108`), so only the two-column layout
  is affected.
- Fix: make the rail the single scroller (`overflow-y: auto`, keep the max-height) and let the work list keep `flex: none` with its own
  `max-height`; or cap the selected-node card and reply (`max-h` plus `overflow-y: auto`). Add a layout spec that renders a
  3-lane roster at 735 px height and asserts the Confirm button is inside the rail's visible box or the rail scrolls.

Hidden-plate rule (`visibleLabelIds`):
- Root plate: `scene-layout.ts` always gives the root a `labelRect` (forced fallback), so it is never hidden by the rule.
- Selected or pinned plate: `must` nodes try the candidate list but only the root has a forced fallback, so a crowded scene can still
  leave the selected plate without a rect. It is then hidden by this rule exactly as the renderer already hides it with
  `display: none` (M-5 carried, no new harm; visibility does not change keyboard reachability because `display: none` already
  removed the plate). The pinned card follows a sphere anchor, not the plate, so it is unaffected.
- Initial and new plates: `visibleLabelIds` is `[]` until the scene has a layout, so a new plate is hidden until the layout includes it,
  which is what removes the origin flash. `visibility: hidden` keeps the box measured, so `ResizeObserver` and `offsetWidth` still
  work and the S-1 measurement path is not broken. One frame between the Angular update and the renderer's rAF transform is still
  theoretically visible at (0,0); I could not confirm it without a render.
- `scene()` undefined: only when the canvas is unavailable, when the overlay is not rendered either.
- Minor (R3-4): a focused plate that becomes `hidden` by a relayout drops focus to the document body.

### 5. AC22 / Amendment A1

Holds. The only change in the pending card is the input's class string (`!border-…`, `placeholder:!text-…`). `confirmProposal`,
`answerOrdinaryQuestion`'s Confirm filter, `sendCommand` and the teardown logic are unchanged in this diff. A roster Confirm still
comes only from the card's click or key handler. The new failure toast and `shownSessionStatus` precedence never send text. The
voice end-of-playback and `thinking` changes only alter display state. The toast moved into the dock and has fixed text.

### 6. New silent failures and races

- The round-3 settle path adds a fixed-text error toast; it does not expose host text. OK.
- The playback callback fires from `play().then(...)`; a clip stopped between `play()` and its resolution is guarded by the
  `settled` and generation checks. OK.
- `registerVisibleTab` before the tab exists (marked id set slightly ahead of the tab list) is harmless; the host reveals on id.
- Each page effect run still pairs one register with one unregister, so rapid tab changes (Start new twice) stay balanced.

## Findings

### Blocking

None.

### Serious

- R3-1: rail `overflow: hidden` clips the pending card, reply and work list in the two-column layout (details above).

### Moderate

- R3-2: `speaking`/`thinking` stays set with nothing playing when a prompt is spoken mid-turn.
- R3-3: no bound on a turn that never receives its terminal `turn_state`; S-E relies entirely on delivery.
- F-2 (carried, narrowed to the canvas tile): a skip-if-present registrant loses visibility when the other owner leaves.

### Minor

- R3-4: a focused plate that gets `visibility: hidden` by a relayout loses focus.
- R3-5: conductor tile reads `correlationId()` at register and at destroy; a changed id leaks a count that now outlives co-owners.
- R3-6: after a stored `stopped`/`error`, a turn that begins without `send` keeps showing the stored status.
- R3-7: an abort started outside the page shows "could not finish" as an error.
- R3-8: first send after an error shows the old `error`/`stopped` until the send acks, even though the tab is already streaming.

## Verdict

- Recommendation: REVISE (small, CSS plus one callback condition).
- Assessment: NEEDS_REVISION. Blocking 0, Serious 1, Moderate 3, Minor 5.
- Score: 7/10. S-A, S-B, S-D, S-E and S-F are addressed with sound logic and the ref count is balanced across all three callers.
  Held down by R3-1, which makes the confirm/approve controls unreachable by pointer on short windows in the two-column layout,
  and by R3-2, which removed a self-heal without replacing it for the awaiting-boundary case.
- Confidence: MEDIUM-HIGH on the ref count, voice state machine and AC22 (read directly); MEDIUM on R3-1 (CSS reasoning, sizes
  estimated, not rendered; the visual re-review should check a 3-lane roster at roughly 1100x700 and 892x735).
- Top risk: the Tribunal Confirm/Decline row or an approval answer clipped inside the rail on a short window.
