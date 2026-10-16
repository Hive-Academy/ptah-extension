PASS_WITH_NOTES

# Visual review - TASK_2026_674_fa33 (UI leftovers L1-L3 + lazy Rail inspector)

Read-only review in the real Electron app. No source edited, nothing committed, no build/nx/jest/e2e run.

## Environment

- Worktree: `D:\projects\ptah-extension\.claude-worktrees\chat-transcript-followups` (branch `fix/chat-transcript-followups`).
- Build under test: `dist/apps/ptah-electron/main.mjs` (mtime 2026-10-16 21:35, current; not rebuilt). The renderer under test is the one next to it in `dist/apps/ptah-electron/renderer/`.
- Launch: `electron.exe .ptah/tmp/v674-launcher.mjs --remote-debugging-port=9351`, `NODE_ENV=development`. The launcher is a copy of `a1117-launcher.mjs` with only the `import()` path changed. It uses the private profile copy `clean-session-followups/.ptah/tmp/a1117-appdata/Ptah Dev`. The real Ptah Dev profile was not touched. Electron PID 16876, started by me.
- Driver: Playwright `connectOverCDP('http://127.0.0.1:9351')`; themes switched with `data-theme` = `anubis` (dark) / `anubis-light` (light), 1.3 s settle after each switch so colour transitions are finished before measuring.
- Widths: 1440 and 760 via `setViewportSize` (the real window is 1628 px wide; 760 is Playwright emulation, as in the earlier runs; Electron minWidth is 800). The sample is an audit selection, not a support contract.
- Data: workspace `ptah-final-run-ws`. S2 has 1 lane, S4 has 2 lanes, "can you generate html stats..." and the "Command Center" sessions have 0 lanes.
- Scripts: `.ptah/tmp/v674-*.mjs`. Screenshots: `.ptah/specs/TASK_2026_674_fa33/screenshots/` (41 files).
- Before evidence (clean-session-followups TASK_2026_681_738f): `visual-review-final.md`, `visual-review-11-17.md`, `screenshots/final/compact-1440-dark.png`.

## Results

### L1 - lane usage row contrast (`ptah-cli-lane-usage-summary`, S4 lane view)

| Item | Theme | Width | Result | Measured | Screenshot |
| --- | --- | --- | --- | --- | --- |
| L1 labels `ctx`, `in >= 11.9k`, `out >= 56`, `-` | dark | 1440 | PASS | fg rgb(152,146,145) on bg rgb(19,19,23) = 6.05:1, opacity 1, 10px | `l1-usage-row-1440-dark.png`, `l1-lane-view-1440-dark.png` |
| same four labels | light | 1440 | PASS | fg rgb(116,86,101) on bg rgb(250,247,245) = 6.04:1, opacity 1 | `l1-usage-row-1440-light.png`, `l1-lane-view-1440-light.png` |
| row present | dark | 760 | PASS | row rendered, same classes (colours are not width dependent) | `l1-lane-view-760-dark.png` |
| row present | light | 760 | PASS | row rendered | `l1-lane-view-760-light.png` |

All four leaves carry `text-base-content-muted` and no opacity modifier. Both themes are above the 4.5:1 AA floor and the 5.01:1 target. The container is `bg-base-200`; the background was composited from the real ancestor chain.

### L2 - compact session card inside the Canvas focus area

Card is `ptah-canvas-focus-area ptah-compact-session-card` (Canvas compact view; reached via the focus-header `[data-compact]` toggle with the Orchestrator tab selected).

| Item | Theme | Width | Result | Measured | Screenshot |
| --- | --- | --- | --- | --- | --- |
| 1 lane (S2) | dark/light | 1440 | PASS | no `compact-session-title` element, no "Full view" text or button, card header bar absent; status row `Done` + `DONE` chip, model row, NOW and LANES (1 done) remain; no h-scroll | `l2-compact-S2-1lane-1440-dark.png`, `...-light.png` |
| 1 lane (S2) | dark/light | 760 | PASS | same; card 348 px wide, no overflow | `l2-compact-S2-1lane-760-dark.png`, `...-light.png` |
| 2 lanes (S4) | dark/light | 1440, 760 | PASS | same; two lane rows | `l2-compact-S4-2lanes-1440-dark.png`, `...-light.png`, `l2-compact-S4-2lanes-760-dark.png`, `...-light.png` |
| 0 lanes (recap card, "can you generate...") | dark/light | 1440, 760 | PASS | no title, no Full view; status row + recap + wire stream remain | `l2-compact-can-you-0lanes-1440-dark.png`, `...-light.png`, `...-760-dark.png`, `...-760-light.png` |
| 0 lanes (empty card, Command Center) | dark/light | 1440, 760 | PASS | `compact-session-empty` variant: no title, no Full view; status text "Ready" + stats remain | `l2-compact-CmdCenter-0lanes-1440-dark.png`, `...-light.png`, `...-760-dark.png`, `...-760-light.png` |
| Rail cards (variant="rail") | dark/light | 1440, 760 | PASS (unchanged) | rail cards still show their title and menu | any `l2-*` shot, left column |
| needs-you count | - | - | NOT VERIFIED | no session in the profile has a pending request, so the "N needs you" label could not be rendered. The source keeps it (`@if (!canvasHost || needsYouCount() > 0)` header, `compact-session-card.component.ts:151-165`). | - |
| Outside Canvas (chat view) card unchanged | - | - | NOT VERIFIED | In the Electron app the Chat tab is the Canvas; no non-Canvas host of the compact card is reachable. By source, `canvasHost` is false without `RAIL_TRANSCRIPT_RETENTION`, so the header renders as before. | - |

Before/after: before (`clean-session-followups/.../final/compact-1440-dark.png`) showed an `S4` title row with a "Full view" link above the status row. After (`l2-compact-S4-2lanes-1440-dark.png`) that row is gone and the status row starts at the top.

### L3a - pane-side strip details opener at 760

| Item | Theme | Width | Result | Measured | Screenshot |
| --- | --- | --- | --- | --- | --- |
| Opener is an icon button | dark | 760 | PASS | `<button aria-label="Open details" title="Session details" aria-expanded="false">`, no text, one `svg.lucide` (rect + vertical line = lucide `PanelRight`), svg 16x16 | `l3a-760-dark.png`, `l3a-opener-clip-760-dark.png` |
| same | light | 760 | PASS | same markup | `l3a-760-light.png`, `l3a-opener-clip-760-light.png` |
| Icon contrast | dark | 760 | PASS | rgb(232,230,225) on rgb(19,19,23) = 14.86:1 (needs 3:1 for UI) | - |
| Icon contrast | light | 760 | PASS | rgb(41,19,52) on rgb(250,247,245) = 15.92:1 | - |
| Target size | both | 760 | PASS (AA) | 44 x 24 CSS px; meets WCAG 2.2 AA 24x24. Below the 44 px platform guidance in height (guidance only) | - |
| Keyboard focus ring | dark | 760 | PASS | `:focus-visible`, outline solid 2px rgb(232,230,225) | `l3a-focus-ring-760-dark.png` |
| Hover | dark/light | 760 | PASS | bg `base-content` at 20 % (dark) / 10 % (light) | `l3a-hover-clip-760-dark.png`, `l3a-hover-clip-760-light.png` |
| Click opens inspector sheet | dark/light | 760 | PASS | sheet with `[data-inspector-close]` opens, content "This session" | `l3a-sheet-open-760-dark.png`, `l3a-sheet-open-760-light.png` |

The old circled Unicode "i" is gone.

### L3b - dock hover card (`canvas-lane-tabs`, S4: Orchestrator + 2 codex lane tabs, 38x38 each)

Real pointer movement (`mouse.move` with steps), polled for visible `[role=tooltip]`.

| Item | Theme | Width | Result | Measured | Screenshot |
| --- | --- | --- | --- | --- | --- |
| Baseline, no hover | dark/light | 1440 | PASS | 0 cards | - |
| Hover tab A | dark/light | 1440 | PASS | 1 card "codex CLI lane done pong Click to view this thread", box 543,163 256x124 | `l3b-hover-A-1440-dark.png`, `...-light.png` |
| Move pointer away | dark/light | 1440 | PASS | 0 cards after 1.5 s | `l3b-away-1440-dark.png`, `...-light.png` |
| Sweep A to B | dark/light | 1440 | PASS | at +100 ms A's card, at +300/700/1200 ms only B's card (box 583,163 256x104, text without "pong"). Never 2 cards in any sample | `l3b-sweep-B-1440-dark.png`, `...-light.png` |
| Fast flick A to B (2 steps), then away | dark/light | 1440 | PASS | only B's card; 0 cards after leaving | - |
| Click tab A, then leave | dark | 1440 | PASS | card closes (0 cards): the `:focus-visible` change no longer keeps it open after a mouse click | - |
| Keyboard focus (ArrowRight onto a tab) | dark | 1440 | PASS | card opens and stays while focus-visible, as designed | `l3b-keyboard-focus-1440-dark.png` |

Sampling was at 100/300/700/1200 ms, not per frame, so a sub-100 ms overlap of two cards is not excluded by measurement; the card is driven by one `cardKey` signal, so two cards at once is not structurally possible.

### L5 - wide Rail aside, deferred inspector (`@defer (on idle)`), 1440

Method: reload the renderer with a `PerformanceObserver('layout-shift')` and a per-frame sampler, restored session S4 focused, sidebars closed so the rail goes wide.

| Item | Theme | Width | Result | Measured | Screenshot |
| --- | --- | --- | --- | --- | --- |
| Aside shell appears, then inspector fills | dark | 1440 | PASS | aside shell (1088,77, 320x823) at t=7611 ms, inspector content (3 child sections: orchestrator card, session stats, agents section) at t=7966 ms. Delay after shell 355 ms (earlier run: 237 ms). Idle fired well inside "a few seconds" | `l5-wide-rail-inspector-1440-dark.png` |
| Final content | light | 1440 | PASS | "This session / Orchestrator / SESSION Context, Tokens 467.0k, Cost $0.55, Agents 1, Model Opus 5.5 / AGENTS ..." renders fully; aside 320x823, no vertical overflow, no h-scroll | `l5-wide-rail-inspector-1440-light.png` |
| No layout jump from the fill | both | 1440 | PASS | focus-area box stays 368,77,720,823 from 7734 ms to the end and across the fill at 7966 ms; zero layout-shift entries in the window from 150 ms before to 1500 ms after the fill; aside width is already reserved (`w-[320px]`) | - |
| Layout-shift total after closing sidebars | dark | 1440 | NOTE | 0.33 summed over 10 entries, all from the left sidebar/rail width animation that my own panel toggle triggers (DIV 254,40 to 28,40 etc.). Not related to the inspector; pre-existing behaviour | - |
| Rail with sidebars open (narrow) | dark | 1440 | OK | the aside is not rendered; the pane-side strip with the PanelRight opener is shown at top right | `l5-reload-no-focus-1440-dark.png` |

### Console (renderer)

No `error`-level console messages and no page errors in any run (listener attached for every script, plus a full reload run that includes boot). Warnings only:

- `NG0956` track-by-identity re-created a collection of size 1 (appears on session/lane switches).
- `NG0914` zoneless app still loading Zone.js (boot).
- `Canvas2D getImageData willReadFrequently` came from my own contrast probe, not the app.

Main-process stderr shows only `PluginLoaderService` skip-skill warnings (missing SKILL.md in the harness plugins folder), unrelated.

## Findings by severity

### Critical

None.

### Serious

None.

### Moderate

None.

### Minor

1. Status is still stated three times in the Canvas compact card plus the focus header (L2 residue). The focus header pill says `done`, and the card's status row still shows `Done` plus a `DONE` chip. The plan said "status row stays", and the title and Full view duplicates are removed, so this is by design; it is the remainder of the prior "status 3x" complaint. Evidence: `l2-compact-S4-2lanes-1440-dark.png` (header "done" at top right, row "Done" / "DONE" below). File: `libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.ts:151-165` (no header pill existed to hide).
2. The deferred aside renders as an empty bordered column for about 0.25-0.35 s before the inspector fills (L5). No layout shift (width reserved), but a brief empty pane is visible on first focus. Evidence: sampler timeline above. `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts:245-248`.
3. The L3a opener is 44x24. It meets WCAG 2.2 AA (24x24) but is below the 44 px vendor guidance in height, and the strip is much taller than the button. Evidence: `l3a-opener-clip-760-dark.png`. File: `canvas-rail-board.component.ts:228` (`btn-xs`).
4. Console `NG0956` warning on session/lane switches; not attributable to this task from this run (no before-baseline for renderer console).

## Not verified

- L2 "N needs you" label (no pending request in the profile) and the L2 non-Canvas chat-view card (not reachable in the Electron app); both covered only by source reading, not by a rendered screenshot. Their unit specs were not run (memory rules).
- The 760 px width is page emulation inside a 1628 px window.

## Cleanup

Electron PID 16876 and its child processes were stopped with `taskkill /PID 16876 /T /F`. Afterwards `Get-Process electron` returns 0 and nothing listens on port 9351. Port 9351 is free: yes. Electron closed: yes.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH for L1, L3a, L3b, L5 and L2 in Canvas; MEDIUM for L2's needs-you and non-Canvas paths (not rendered).
- Key concern: none blocking; the residual status duplication (Minor 1) is the only visible leftover of the L2 complaint.
