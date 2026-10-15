# Prototype round 2 notes (Gate 1.7 revise, FINAL round)

Source: `design-spec-review-r1.md` findings 1, 3, 4, 6 (2 and 5 belong to the spec side). Files touched: `index.html`,
`assets/app.js`, `assets/app.css`, `assets/capture.mjs`, `screenshots/`. Checks: `node assets/capture.mjs checks`
(see the result line in the reply; the new checks are listed per finding below).

| Finding | What changed | Where | Check name (in `capture.mjs checks`) |
| --- | --- | --- | --- |
| 1 Serious, lane navigation inert | Agent row select and `Open lane` both call `openLane(id)`: sets `state.lane`, shows a concrete mock lane view (`#laneView`, focusable `h2#laneTitle tabindex=-1`, status, mock transcript, pending-permission note), at overlay width funnels the close through `closeInsp(laneTitle)`, otherwise focuses the title, and announces "Opened the X lane." only after `document.activeElement === laneTitle` (after two animation frames). Agent chips in the thread open the lane the same way. `Back to session` returns to the thread with focus on `#sessTitle`. State `lane=<agent id>` (proto bar: "Main view"). | `app.js`: `openLane`, `renderLane`, `leaveLane`, handlers `select`, `open-lane`, `lane-back`; `index.html`: `#laneView`; `app.css`: `.cs-lane`, `.lane-*` | `lane via agent row ...`, `lane via Open lane ...` (sheet closed, background live, lane view replaces thread, focus on `laneTitle`, announcement text), `Back to session ...` |
| 1 (host rule) | `host=electron`: no `Open lane` link, no "Open lane" in chip labels, row select only marks the selection (no lane view); the inline permission panel remains the way to answer. | `app.js`: `panelHTML` (unchanged condition), `renderChips`, `select` handler, `state.lane` forced to `''` on electron | `host=electron: no Open lane link ...`, `host=electron: row select opens no lane view ...` |
| 3 Moderate, question card absent | `answerFlow(key)` no longer assumes `#qCard`. Absent card: row shows "Opening the question..." (status) for up to 1 s, then a row-level error "Could not find the question in the conversation. The request is still waiting." with `Retry` (`role=alert`, linked to Answer via `aria-describedby`); request and header count stay; focus returns to that row's Answer button; at overlay width the sheet stays open. `Retry` reruns the flow; once the card mounts it focuses the first option (and closes the sheet at overlay width). State: `ask=question&fail=card` (alias `qcard=missing`); proto bar "Question card: Missing" and "Mount it now" simulate recovery. Both hosts use the same path (electron: no lane to open first; rail: lane-owned question prototype still routes to the card directly, as in round 1). | `app.js`: `answerFlow`, `applyQCard`, `lineHTML` (question branch), `renderNeeds` null guard; `index.html`: bar group, `#qRestore` | `qcard missing, host=electron|rail, 1594|400 px ...` (request and count kept, error + Retry, focus on Answer, sheet stays open, Retry after mount focuses first option, sheet closes at 400 px) |
| 4 Moderate, resize and session switch | `ResizeObserver` now runs `bandCheck()`: detects docked to overlay (`shell.clientWidth < 960`) while the sheet is open and calls `autoClose('resize')`, which uses `closeInsp` with focus on the recorded opener (`ui.opener`, set in `openInsp`) when still connected and visible, else `#sessTitle`. `Replay session switch` is now `switchSession()`: resets per-session UI state, closes the sheet with `autoClose('switch')` (focus on the session title), leaves the lane view, replays the entrance. First observer callback only records the band, so URL-loaded states (`width=sidebar&insp=open`) are not auto-closed. | `app.js`: `autoClose`, `bandCheck`, `switchSession`, `openInsp`; `index.html`: `#sessTitle tabindex=-1` | `resize: docked sheet is open ...`, `resize to 400 px: sheet closed automatically ...`, `... focus returns to the opener ...`, `resize back to wide ...`, `resize with no recorded opener ...`, `session switch, 400 px sheet|wide docked ...` |
| 6 Minor, live line | `renderNeeds` binds `#liveLabel` to `needCount()` in every state (the `t2=ref` exemption is removed): `Waiting for you` when N > 0, else `Orchestrating`. | `app.js`: `renderNeeds` | `t2=ref|streaming|answered: header "5 need you" and live line "Waiting for you" agree`, `... no pending request -> "Orchestrating"` |

## New states (URL params)

- `lane=gemini` (any agent id) and the screenshots `*-lane-opened` (400 px, reached by keyboard: toggle, row, Enter).
- `ask=question&fail=card` (alias `qcard=missing`) and `*-question-card-missing`.
- `*-resize-closed` (opened docked at 1594 px by keyboard, window narrowed to 400 px).

## Decisions

- Lane title is an `h2` inside the lane view, not the `h1` the spec's focus table names (8.3 paths 4 and 5): the header keeps
  the session `h1`, and a second `h1` on the page would be wrong. Reversible; the spec table should say "lane title heading".
  Spec-side designer: please align the wording (this is a text-only difference, behaviour is identical).
- Failure focus target is the row's Answer button (coordinator message, spec 4.5), not the error region; the error is
  associated through `aria-describedby` and announced through `role=alert`.
- Electron row select: highlight only (no navigation) because the spec offers no lane surface there.
- Question card wait is capped at 1 s, matching the spec's "not mounted within 1 s" rule.

## Not changed

Lane-owned question under `host=rail` still focuses the card directly (spec 4.5 says the lane opens first); the card lives in
the session thread, so opening the lane first would hide it again. Spec-side decision, flagged here.
