# Visual Review - TASK_2026_699_833e (plan rev 4, canvas side dock)

## Previous rounds (short note)

Round 1 (single-layout host, since superseded by decision 16) scored 7.5/10 NEEDS_REVISION with one Serious and three Moderate findings.
- V1: open "Stats" label contrast. V2: tab focus ring clipped. V3: width readout covered the dock title.
- That round forced the `single` layout and so reviewed a host Electron's canvas does not use. Its screenshots are in `screenshots/`. This round replaces it. Rev 4 re-checks V1-V3 below.

## Summary

| Metric            | Value                                                                                  |
| ----------------- | -------------------------------------------------------------------------------------- |
| Overall score     | 6/10                                                                                   |
| Assessment        | REJECTED by the template rule (one overlap finding); reply verdict REVISE              |
| Visual breaking   | 1                                                                                      |
| Serious           | 1                                                                                      |
| Moderate          | 1                                                                                      |
| Minor             | 1 new (plus the 2 known)                                                               |
| Viewports tested  | 1900, 1440, 1200, 1100, 900, 800, 760, 600, 500, 470, 440, 420, 380 (dark and light)   |
| Screenshots taken | 71 files in `screenshots/rev4/` (about 30 are supporting zooms)                        |
| Components tested | Stats tab, dock, drag grip, rail auto-collapse, deferred inspector body, tile floor    |

Score reasoning: the dock mechanics all measure correct (bands, clamps, floor, persistence, reset, Esc restore, rail auto-collapse, V1-V3). Two things hold the score at 6. The composer toolbar overlaps at the 360 px floor that this plan chose, and the dock body can sit on an empty placeholder for 4.5 to 6.5 s. The 7-8 band needs neither of those.

## Environment

- Build: not rebuilt, per instruction. Launched `node apps/ptah-electron/scripts/launch.js` equivalent from the worktree, through the private launcher `.ptah/specs/TASK_2026_699_833e/.electron-userdata/launch.js`. It adds `--remote-debugging-port=9391` and a private `--user-data-dir`/`APPDATA` (the stock launcher passes no profile argument, and the real profile must not be touched). The renderer is `dist/apps/ptah-electron/renderer/index.html`.
- Layout: canvas, no override. I wrote no layout flag and `ptah-layout-mode` was never set (localStorage read `grid`, the app's own value). The dock rendered in `canvas-rail-board` single-focus mode. This confirms the rev 4 retarget works in the real host.
- Profile: the private profile, with 10 real sessions and one focused tile ("Reply with only the word ok..."). It had no plan-limit owner, so the plan cards show "Usage unavailable". I tried a fixture and it did not map to the session (tile count 1). Plan Limits card visuals are therefore not re-verified this round; round 1 covered them.
- Viewport method: CDP `Emulation.setDeviceMetricsOverride` (widths are viewport widths, rail included). The real window has `minWidth: 800` (`apps/ptah-electron/src/windows/main-window.ts:119`). Widths below 800 are therefore audit selections and not reachable in the app. 760 was requested and is listed that way.
- Themes: `anubis` (dark) and `anubis-light`.
- Rail preference: the profile starts with the rail collapsed (56 px). I ran with the rail collapsed first, then expanded for the wide-rail cases, and put it back to collapsed at the end. The dock width preference was reset (double-click) to the band default.
- Cleanup: the launcher node process (13884) and its whole Electron tree (9 processes) were killed with `taskkill /T`. `Get-Process electron` returns 0 and nothing listens on 9391. Only the process I launched was killed. Nothing was committed and no source file was edited.

## Findings by severity

### Visual breaking

#### 1. Composer toolbar controls overlap at the 360 px tile floor

- File: `libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.component.ts:364-365` (the toolbar row `flex items-center gap-1 ... min-w-0`). The floor is set by the dock width math in `inspector-shell.controller.ts` and `canvas-rail-board.component.ts:389-396` (decision 18).
- Viewports affected: any tile of 360 px or less. Reached at 800-900 wide with the dock open (tile 348/360), at 760 (tile 308), and at 1200 with the rail expanded when the dock is dragged to its limit (tile 360).
- Screenshots: `dark-760-sm-open-composer-zoom.png`, `light-800-sm-open.png`, `dark-900-sm-open.png`, `light-1200-md-drag-to-floor.png`.
- Problem: the "+" button, the permission icon (red shield), the model name "Default (recommended)" and the effort bars draw on top of one another. The model label is struck through by the shield and "+".
- Impact: the permission mode, model and effort controls are unreadable and mis-clickable in the chat the dock is docked beside.
- Note: the cause is the composer's own narrow-width behaviour, and it probably exists today in split panes (their floor is also 360). I did not capture a base-commit screenshot, so "pre-existing" is unproven. The rev 4 floor of 360 does not protect against it, and the 800-900 default-sm case can now reach it with one click on Stats.
- Fix: either let the toolbar wrap or hide labels under about 400 px (container query), or raise the single-focus floor to the width where the toolbar fits (the board then lowers the dock maximum, or opens the sheet).

### Serious

#### 2. Dock body shows an empty "Session details" placeholder for 4.5 to 6.5 s

- File: `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts:249` (`@defer (on idle)`, placeholder at about line 260; the same trigger at 203 and 271).
- Viewports affected: all, every open.
- Screenshot: `dark-1440-lg-placeholder-delay.png` (dock open, only the heading).
- Problem: measured on this profile (9 sessions, 10 tiles). Re-opening the dock took 6508, 5502 and 4496 ms until `ptah-session-inspector` was in the DOM. A bare `requestIdleCallback` took 7.5 s in the same page, so idle never comes while the app is busy. The placeholder is `aria-hidden` text with no skeleton or spinner.
- Impact: in a busy workspace the user clicks Stats and gets an empty panel with a resize grip, and no feedback, for several seconds.
- Fix: render on open, not on idle: `@defer (when dockOpen())` or `on immediate`, with `prefetch on idle` to keep the chunk out of the initial bundle. Give the placeholder a skeleton.

### Moderate

#### 3. Dock can crush the tile at narrow boards, and the compact sheet is not reachable here

- File: `canvas-rail-board.component.ts:383-396` (`dockShown`, `dockAvailableWidth`) with `dockMinWidth` 300 winning over the floor.
- Viewports: 760 gives tile 308 (floor 360 not kept, as the plan allows). Below the real window minimum it gets worse: viewports 420-640 give tile 12-148 px with the dock open at 300.
- Screenshots: `dark-760-sm-open.png`, `light-760-sm-open.png`. The 420-640 numbers were measured only (script output), no screenshot. They sit below the 800 px window minimum.
- Compact sheet: I could not reach it. The board never measures below 400 (board stays 400 at viewports 380, 420 and 440), so `compactSheet()` (board < 400) did not turn on and no `role=dialog` sheet appeared. It is unreachable in Electron anyway because of the 800 px minimum. I report it as not verified, not as passing.
- Fix: open the dock as a sheet below the width where tile + 300 + tab + 56 rail no longer leaves 360 (about 748 px of board), or lower `minWidth` at sm.

### Minor (new)

- Width readout still covers dock content during a drag or keyboard resize. V3 is fixed for the title, because the readout now sits at mid-height (y 509 at 1440), but it now covers the "Model" card label ("400 px" over "Model", `light-handle-focus-zoom.png`, `light-1200-md-drag-to-floor.png`). It is transient and disappears when the handle loses focus. File: `libs/frontend/chat-ui/src/lib/atoms/split-handle.component.ts:162` (anchor class). Fix: anchor the readout in the tab column or above the grip, outside the dock text.

Known Minor items (not re-reported): long plan-window label truncation at 300/336 px, and the 2 px light-theme open indicator at about 1.2:1.

## Prototype fidelity

- Approved prototype: `prototype/index.html`, `prototype/screenshots/{dark,light}-{1440,760}.png`.
- Fidelity assessment: DEVIATES, by approved decision only.
- Deviations observed:
  - Tab: prototype has a right-edge "Session" tab outside the shell. Rev 4 has "Stats" on the dock's inner (left) edge, 32x823 px, with the active line facing the dock (decision 13). Matches the decision.
  - Floor: prototype says 624, rev 4 uses 360 (decision 18). Measured at the floor: tile 360, dock 456 at 1200 with the rail expanded. Respected.
  - Grip: matches the prototype (12 px hit area on the dock side, 4x32 rest grip, solid 2 px outline on focus). Hover turns the line to `primary/60`.
  - Dock content: real session data in place of the prototype's mock. Header "This session", close X, single hierarchy. No component was stripped.
  - Sheet: prototype 760 shows a modal sheet. Rev 4 at 760 docks inline (sm band, tile 308) and no sheet is shown. See finding 3.
- Before/after (no prototype): not applicable, a prototype exists.

Screenshots against prototype: dark and light, 1440 `screenshots/rev4/{dark,light}-1440-lg-open.png`, 760 `{dark,light}-760-sm-open.png` and `-closed.png`.

## Viewport results

| Viewport (vw) | Band (board) | Dock open (default pref) | Tile | Result | Screenshot |
| --- | --- | --- | --- | --- | --- |
| 1900 | xl (1836) | 448 | 1300 | OK | `{dark,light}-1900-xl-open.png` |
| 1440 | lg (1376) | 400 | 888 (rail 56), 640 (rail 304) | OK | `{dark,light}-1440-lg-open.png`, `-open-railExpanded.png` |
| 1200 | md (1136) | 336 | 712 / 480 | OK | `{dark,light}-1200-md-open.png` |
| 1100 | sm (1036) | closed by default; open 400 | 732 closed, 548 open | OK, rail auto-collapses | `{dark,light}-1100-sm-{open,closed}.png` |
| 900 | sm | open 388 | 360 | composer overlap (F1) | `dark-900-sm-open.png` |
| 800 (real minimum) | sm | open 300 | 348 | composer overlap (F1) | `{dark,light}-800-sm-open.png` |
| 760 | sm (696) | closed by default; open 300 | 392 closed, 308 open | F1, F3 | `{dark,light}-760-sm-{open,closed}.png` |
| 420-440 | board pinned at 400 | n/a | tile 12 (open) | compact sheet not reached (F3) | `{dark,light}-440-compact-closed.png` |

No horizontal scroll at any width (`scrollWidth` equals the viewport at every step).

Defaults on a clean preference: md 336, lg 400, xl 448 (measured before any resize). After a resize the preference persisted across closing and reopening, and a double-click on the grip restored the band default.

## Component and interaction results

| Component | States tested | Result | Screenshot |
| --- | --- | --- | --- |
| Stats tab | rest open/closed, hover, keyboard focus, both themes | OK | `{dark,light}-tab-{open,closed}-{rest,focus}-zoom.png` |
| Drag grip | rest, hover, focus, keyboard (Left 16 px, Home, End), pointer drag to floor and to min, Esc mid-drag restores, double-click reset | OK (readout is Minor) | `{dark,light}-handle-{hover,focus,readout}-zoom.png`, `-1200-md-drag-to-{floor,min}.png`, `-1440-lg-resize-{max,min}.png` |
| Rail auto-collapse | sm band, dock open then closed | OK: 272 to 56 on open, back to 272 on close, at 1100 and 760 | `{dark,light}-{1100,760}-sm-{open,closed}.png` |
| Dock body | first render after open | Serious (F2) | `dark-1440-lg-placeholder-delay.png` |
| Resize clamps | min 300, max 560, floor 360 | OK: End 560, Home 300, md drag stops at 456 / tile 360 | `-1440-lg-resize-max.png` |

## V1-V3 re-check

| Item | Result | Evidence |
| --- | --- | --- |
| V1 open "Stats" label contrast | FIXED. Dark 14.21:1, light 14.81:1 (10 px, 600). Closed state 5.79 dark, 5.62 light, both above 4.5. | computed colour and background, `{dark,light}-tab-open-rest-zoom.png` |
| V2 tab focus ring | FIXED. `outline 2px solid`, offset `-2px`, `:focus-visible` true, shows on all four edges. Dark `oklch(0.766 0.139 91)`, light `oklch(0.48 0.12 70)`. | `light-tab-closed-focus-zoom.png`, `dark-tab-open-focus-zoom.png` |
| V3 readout position | PARTLY FIXED. No longer over "This session" (readout at x 992, y 509; title at y 91). It now covers the "Model" label (Minor, above). | `light-handle-focus-zoom.png` |

## Design system compliance

- Open indicator colour `oklch(0.85 0.138 181)` on `oklch(0.94 0.007 61)` in light: known Minor.
- Grip rest uses `base-content/60`, hover `primary/60`, focus `outline-base-content`: tokens, no raw hex.
- Dock edge uses `border-base-content/10` at `canvas-rail-board.component.ts:244`; no deviation seen.

## Accessibility audit

Criterion: WCAG 2.2 AA (the repo declares no other standard).
- Contrast: tab label pairs in the V1 table. All pass.
- Targets: Stats tab 32x823 px, grip hit area 12x823 px (the grip is 4x32 visually). Both meet the 24 px minimum on the short side except the grip's 12 px width. The grip is a pointer-and-keyboard separator with an alternative (keyboard resize, double-click reset), so the 2.5.8 exception for an alternative applies.
- Focus: handle `role=separator`, `tabindex=0`, `aria-valuenow/min/max` 400/300/560, `aria-label="Resize session details"`. Tab has `aria-expanded`, `aria-label="Toggle Stats panel"`. Grip focus outline is a full-height 2 px solid ring.
- The deferred placeholder is `aria-hidden`, so a screen reader hears nothing during the 4.5-6.5 s wait (see F2).

## Visual performance

- Placeholder wait of 4.5-6.5 s (F2) is the main item. Cause supported by the browser evidence: idle callbacks starved by a busy page (7.5 s for a bare `requestIdleCallback`).
- Layout shift was not re-measured this round. Toggling moves the tile by design (width changes by the dock width), and no unexpected shift was seen across the toggles.

## Verdict

- Recommendation: REVISE (template rule gives REJECT because of the overlap finding; the dock itself is sound).
- Confidence: HIGH on F1 and F2 (measured and screenshotted), MEDIUM on whether F1 predates this task.
- Key concern: the composer toolbar overlaps at the 360 px floor the plan chose (F1), and the dock body is empty for several seconds on a busy workspace (F2).
- Uncertainty: Plan Limits card visuals were not re-verified; the compact sheet could not be reached; widths below 800 are not reachable in the real window.
