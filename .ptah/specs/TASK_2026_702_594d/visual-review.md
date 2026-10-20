# Visual Review - TASK_2026_702 (Chat start screen, phases 1-2)

Verdict: **REVISE** (0 breaking, 2 serious, 5 moderate/minor). Score 7/10. Confidence MEDIUM (running-cap state not reached).

## Environment
- Build: `npx nx build ptah-electron` succeeded (webview + main); the renderer folder was then copied with `node apps/ptah-electron/scripts/copy-renderer.js` (the `build` target alone does not produce `dist/apps/ptah-electron/renderer`).
- Launch: Playwright `_electron`, private user data dir, APPDATA/HOME/PTAH_DB_PATH in a temp folder, `--remote-debugging-port=9341`. Main-process RPC was faked (same approach as `apps/ptah-electron-e2e/src/support/ui-driver.ts`) to seed Get ready state (`setup-status:get-status`, `plugins:*`) and recent sessions (`session:list`). Never touched the real profile.
- Viewports: 1440x900 (main), 800x700, 1184x735 (probe). Themes: anubis (dark), anubis-light. Prototype shots are 1440x900 with a different shell (rail on the left, no workspace sidebar), so geometry is compared structurally, not pixel-wise.
- Screenshots: `visual-review/<theme>-<state>.png`.

## Per-state results
| State | Screenshot | Prototype | Result | Severity |
|---|---|---|---|---|
| Empty board, dark | visual-review/dark-empty.png | prototype/screenshots/dark-empty.png | Deviates: no eyebrow "Before you begin", no row icons, no "+" in the hero button, copy differs ("Start a session and make something great."), "Setup tools" label missing, "Run setup" filled (see F2) | Moderate |
| Empty board, light | visual-review/light-empty.png | prototype/screenshots/light-empty.png | Same deviations as dark; heavy drop shadow under the Get ready card | Minor |
| Partly ready, dark / light | dark-partly.png / light-partly.png | prototype dark-partly / light-partly | Matches structure ("1 of 2 ready", Agents "Update"); the same icon/eyebrow gaps | Moderate (same as above) |
| Ready (strip only), dark / light | dark-ready.png / light-ready.png | (part of ready-recent) | "Ready" strip carries 4 buttons incl. filled "Run setup" and "Open Library"; prototype has 3 outlined | Serious (F2) |
| Ready + 3 recent, dark / light | dark-ready-recent.png / light-ready-recent.png | prototype dark-ready-recent / light-ready-recent | Layout matches (3 cards). Titles truncate at 169px ("Refactor the session s..."); dates are "Oct 19, 2026" not "Today at 10:42 / Yesterday" | Moderate |
| Running cap | not captured | prototype dark-cap.png | Needs 9 live running sessions; not reachable with a faked backend. Code path shares the notice component verified in layout warning | Unverified |
| New-session popover | dark-popover.png | prototype dark-popover.png | Works; input auto-focused; Enter opens, Esc closes and returns focus to the trigger. Popover is narrower on copy (no helper text, no label), covers the strip buttons | Minor |
| Layout warning (no tiles) | dark-layout-warning.png, light-layout-warning.png | prototype dark-layout-warning.png | Matches (warning border, icon, dismiss) | Pass |
| Layout warning with tile | dark-layout-warning-tiles.png | prototype dark-layout-warning-tiles.png | Prototype shows placeholder tiles; the real app shows the focused session. Warning renders above it without overlap. Window auto-grew to 1920x983 after creating a session (renderer driven, not asserted) | Pass |
| Reduced motion | dark-reduced.png | prototype dark-reduced.png | Aurora frozen, 0 running animations, content identical | Pass |
| 800 wide | dark-800.png, light-800.png | prototype dark-800.png | Board 416px, rail collapses to 56px, nav to icons, recents stack to 1 column and scroll; no horizontal scroll | Pass |
| VS Code single chat 280 | n/a | dark-single-chat-280.png | Not reachable in Electron (VS Code webview only) | n/a |

## Findings
- **F1 Serious. Empty inspector column on the empty board.** `canvas-rail-board.component.ts:296-309` renders the right-hand `<aside>` at md+ widths even when `focusedId()` is null, leaving a 296px bordered blank column at 1440 (aside at x=1112, w=296) and shifting the hero off-centre (board 572px of 1156px). Prototype centres the hero in the full stage. Dock bar is gone, but this blank pane reads as broken. Pre-existing code, but exposed by this start screen. Fix: render the aside only when a session is focused.
- **F2 Serious. Second filled primary button.** The setup card renders "Run setup" as a filled blue primary beside the hero "New session" (dark-empty, dark-partly, dark-ready, dark-ready-recent; same in light). Ready strip in the prototype is all-outlined. Violates the single primary action rule. Fix: make "Run setup" outlined/neutral in the Ready strip and when not the sole next step.
- F3 Moderate. Get ready card lacks eyebrow, row icons and "Setup tools" label (prototype). F4 Moderate. Recent cards truncate titles and use absolute dates (prototype: relative "Today at 10:42"). F5 Minor. Light-theme card shadow is heavy. F6 Minor. Popover lacks helper text/label. F7 Minor. Tab from the popover input leaves the popover to the Git panel toggle (non-modal; Esc only works with focus inside).
- Dock bar absent: no ticker and no "+ New Session" anchor anywhere. The "All clear" needs-you chip is still at top right (allowed until phase 3).

## Contrast (WCAG AA 4.5:1 normal, measured worst-pixel under text with text hidden, reduced-motion Aurora)
Dark: hero title 11.5, subtitle 12.18, card/strip text 12.46, "Recent sessions" 13.67, muted date 5.07, primary button label 4.82 (13px/600, passes). Light: title 15.66, subtitle 15.78, strip text 13.33, muted date 4.86, primary button label 6.76-6.81. All pass. Not measured: popover placeholder text; moving Aurora frames.

## Focus and keyboard
Hero button: 3px ring on keyboard focus (dark-focus-hero.png). Strip buttons and recent cards: 2px solid yellow outline, visible. Tab order: hero, Open Library, Run setup, Generate agents, Project guidance, recents. Popover: reachable by Enter on the hero button, focus lands in the name input, Esc closes and restores focus. Strip button size 24px high (meets WCAG 2.2 AA 24x24; below 44px guidance).

## Aurora CPU (empty board idle, dark, 20 s, 10 samples of `app.getAppMetrics()` percentCPUUsage, two runs)
| Mode | Renderer (Tab) | GPU | Browser | Total |
|---|---|---|---|---|
| Aurora visible | 0.31 / 0.27 | 0.92 / 1.10 | 0.06 / 0.07 | 1.29 / 1.44 % |
| prefers-reduced-motion | 0.00 / 0.00 | 0.01 / 0.01 | 0.07 / 0.07 | 0.08 / 0.08 % |
Aurora costs about 1.3 % of one core, mostly GPU compositing; reduced motion removes it.

## Cleanup
Electron PID 13324 and its harness node PID 37480 killed with `taskkill /T /F`; no electron.exe left; temp user data dir deleted. No source files edited.
