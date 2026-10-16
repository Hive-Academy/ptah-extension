# Code Logic Review, Phase E round 4 (delta of 29ba80c32), TASK_2026_678_9083

## Summary

| Metric | Value |
| --- | --- |
| Scope | Commit 29ba80c32 only: `command-center-page.component.ts` (+spec), `command-voice-loop.ts` (+spec) |
| R3-1 | CLOSED for the two-column layout; the same edit regresses the stacked layout (R4-1, Moderate) |
| R3-2 | CLOSED |
| AC22 / A1 | Holds |
| Blocking / Serious / Moderate / Minor | 0 / 0 / 1 / 3 |
| Score | 8/10 |
| Assessment | NEEDS_REVISION (one-line CSS fix, no logic re-review needed) |

Evidence read: the full diff, the whole `command-voice-loop.ts` end-of-playback path, `onFrame`, `interruptSpeech`, `finishTurn`, `mute`, `release`, the page template and style block, `command-work-list.component.ts` template, the controller effect that sets pending input (`command-center-page.controller.ts:404-431`). Not run: tests (orchestrator reported 306/306 plus typecheck and lint clean) and no render, so layout claims are CSS reasoning, not pixels.

## Review family

- Implementer family: codex (CLI lane).
- Reviewer family: Anthropic (Sonnet 5.5).

## R3-1 status: CLOSED (two-column), with a stacked-layout regression

- Two-column: `command-center-page.component.ts:73-80` now has `.rail { max-height: clamp(420px, calc(100vh - 280px), 620px); overflow-y: auto; overscroll-behavior: contain }`. The grid row at `:57` uses the same clamp, so the dock position (S-C) is unchanged. `.work-list-region` is `flex: none` (`:81-84`). The rail is `flex flex-col` (`:277`), so every child, including the `ptah-command-pending-input` host, is blockified and none shrinks; the rail itself scrolls. The pending card's Decline/Confirm row, a question card's Send answer and the latest reply are reachable by wheel. DOM order is untouched (M-r1-1 kept). The inner `ul.max-h-full overflow-y-auto` (`command-work-list.component.ts:36`) has no definite parent height, so it does not create a competing scroller.
- `scrollToNewPendingCard` (`:422-432`), called from `afterEveryRender` (`:417-420`):
  - Fires once per key change. `lastPendingKey` is assigned before the scroll, and the call never writes a signal, so there is no render loop. Steady-state cost per render is two signal reads and a string compare.
  - Safe in jsdom: `scrollIntoView?.(...)` is guarded. The ElementRef is the always-present host (not inside an `@if`), and the child content renders in the same tick before `afterEveryRender` runs.
  - `block: 'nearest'` scrolls only when the card is not fully visible. A 400 px roster card in a 455 px rail below a 150 px selected-node card scrolls the rail by about 105 px, which reveals Confirm. When the rail is not the scroller (stacked) it scrolls the page by the minimum needed. No centering or jump.
  - Key to null and the same id back: `lastPendingKey` is reset to null at `:429`, so a reappearing id scrolls again. That is correct for a new appearance. A transient null/restore (for example a projection refresh that briefly clears the card) would also re-scroll and move the user's scroll position (R4-3, Minor).
  - Input and proposal arriving in two separate renders cause two scrolls to the same card; harmless.
- Regression: see R4-1.

## R3-2 status: CLOSED

`command-voice-loop.ts:144-158`: with no clip pending, the state is `listening` (and levels reset) if `pendingInput() !== null` or no turn is running, else `thinking`. Traces:

| Path | Result |
| --- | --- |
| Mid-turn question or roster prompt spoken (`onPendingPrompt` / `onRosterProposal`). The controller sets `store.setPendingInput` before it speaks (`controller:416-430`), and roster proposals are also a pending input | `speaking` then `listening`. Fixed. |
| Mid-turn status speech, no pending input | `speaking` then `thinking`. The old code stayed `speaking`. |
| Barge-in mid-turn. `bargeIn()` emits `false`; `interruptSpeech` skips its own reset while busy (`:489`) | `listening` with pending, `thinking` without. The `onFrame` barge-in path (`:~318`) is the same, and a later `start` sets `listening` when nothing is queued. |
| Reply after the turn boundary. `onTurnBoundary` speaks, then `finishTurn` clears busy/awaitingBoundary | The callback sees neither flag, so `listening`. `speak()` sets `thinking` at enqueue if not speaking (`:531`), so there is no flicker. |
| Mute / stop / release | `active=false` is set before `playback.stopAll()` / `playback.mute()` (`:566`, `:599`, `:614`), so the callback returns early at `:145`. Explicit `muted` / `idle` wins. Unchanged. |
| Does `thinking` get stuck? | `thinking` is only entered while `busy` or `awaitingBoundary` is true. Every exit of that window goes through `finishTurn` (`onTurnBoundary` `:475`, `abandonTurn` `:481`, the transcript/empty/error paths at `:375-439`), which sets `listening` when no clip is pending and starts a queued typed turn or clip otherwise. `mute` / `release` reset the flags. Only the already-recorded R3-3 (a turn that never gets its terminal state) can hold `thinking`, and it used to hold `speaking`. |
| Flicker between clips | The callback is guarded by `!playback.hasPending`; the multi-clip behaviour is unchanged from round 3. |

Residual (R4-2, Minor): after a mid-turn question is answered through the card, the turn is still busy but the HUD stays `listening` until the next state change. Previously it was worse (stuck `speaking`). It is also not wrong, since the mic is open.

## AC22 / Amendment A1: holds

The delta writes only a CSS rule, a `scrollIntoView` call and `store.setVoiceState` / `resetLevels`. `confirmProposal`, `answerOrdinaryQuestion`'s Confirm filter and `sendCommand` are not touched. No text is sent to the model, and a roster Confirm still comes only from the card's click or key handler.

## Tests

- `voice-loop` (three specs): non-tautological. Each sets `busy` and `awaitingBoundary` through the private fields and a real `pendingInput` getter. Against the old code the first and third leave the state at `speaking` and fail; the second would also fail (`speaking`, not `thinking`). They pin `listening` / `thinking` / barge-in. Gap: the typed-turn variant (`awaitingBoundary` true, `busy` false) and the "pending resolved before speech ends" case are not covered.
- `scrolls a newly pending card into view once`: pins call count, args and no repeat on re-render; would fail without the code. It does not cover the null-and-reappear case.
- `keeps the two-column rail bounded as the single scroller`: this is a source-text regex over the component file, not behaviour. It pins the strings but cannot detect that the layout works (jsdom has no layout), and it does not look at the `@container (width < 720px)` block, which is where R4-1 sits. Acceptable as a guard but weak evidence for "Confirm is reachable"; the visual re-review should check a 3-lane roster at about 892x735.

## Findings

### Blocking

None.

### Serious

None.

### Moderate

**R4-1. Stacked layout loses the work-list scroller.**
- File: `command-center-page.component.ts:81-84` (base `.work-list-region` no longer has `overflow-y: auto`) against `:101-104` (`@container (width < 720px) .work-list-region { flex: none; max-height: 24rem }`).
- Scenario: container under 720 px, a delegated list taller than 24rem (about 8 to 9 rows; a 24-node list is about 1000 px). Before the commit the base rule supplied `overflow-y: auto`, so the region scrolled at 24rem. Now `overflow` is `visible`: `max-height` only shrinks the box, and the `ul` inside (`max-h-full` on an auto-height parent) does not scroll, so the rows overflow past the region box and its focus outline. The brief said the stacked layout is unchanged; it is not.
- Impact: in the stacked layout the cap becomes cosmetic. The list renders outside its bordered region and stretches the page. It is probably still reachable through page scroll, since the rail is last in the stacked order, but the intended bounded list is gone. I could not render it, so the exact visual is unconfirmed.
- Fix: in the `< 720px` block, add `overflow-y: auto; overscroll-behavior: contain;` to `.work-list-region` (and extend the CSS spec to read that block).

### Minor

- R4-2: HUD stays `listening` while a busy turn resumes after the pending card is answered (`command-voice-loop.ts:148-155` only runs on playback end). Cosmetic.
- R4-3: a transient null then same id for the pending key re-scrolls the rail (`command-center-page.component.ts:427-431`). Consider keeping the last id and only clearing it when a different non-null id appears, or when the card is resolved.
- R4-4: in the two-column layout `.work-list-region` keeps `tabindex="0"` (`:~337`) but is no longer scrollable, so it is a redundant tab stop with a focus ring on a non-scrolling box. The `ul` roving tabindex already provides keyboard entry. Also `overscroll-behavior: contain` on the rail blocks wheel chaining to the page when the cursor is over the rail and the rail is at its end; I did not verify Chromium's behaviour when the rail does not overflow, so check it in the visual pass.

## Verdict

- Recommendation: REVISE with one CSS line (R4-1); the R3-1 and R3-2 logic themselves are sound.
- Assessment: NEEDS_REVISION. Score 8/10. Confidence HIGH on the voice state machine and AC22 (read directly); MEDIUM on layout (CSS reasoning, not rendered).
- Top risk: the narrow-window work list no longer scrolls inside its cap, which was introduced by removing the base `overflow-y: auto`.
