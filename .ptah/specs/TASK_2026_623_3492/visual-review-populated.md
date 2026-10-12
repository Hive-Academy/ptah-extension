# Visual Review (populated display surfaces) - recheck after Gate 3 fixes - TASK_2026_623_3492

Previous result: PASS WITH NOTES (older 00:26 renderer build, 1 serious, 2 moderate, 2 minor). A first attempt at this recheck was BLOCKED because the renderer was stale (see Note).

## Verdict: PASS (confidence HIGH on items a, b, d, e, f, g; MEDIUM on c, see below)

All seven items pass on the fresh renderer of abb512aec. 0 visual-breaking, 0 serious, 0 moderate, 3 minor (new or carried over).

## Environment

- Build: "Ptah Dev" relaunched by the coordinator on CDP http://127.0.0.1:9333; page `dist/apps/ptah-electron/renderer/index.html` in the worktree. Renderer `main.js` is now 15:46 (previously 00:26). Confirmed live: the dock separator is a `BUTTON`, and "In display" renders. Attached with playwright-core `connectOverCDP`, scripts in `%TEMP%\task623-vr` (outside the repo). No build, kill or relaunch from me. No source edits.
- Provider: Claude CLI (Opus 5.5, Full Auto), already authenticated. No key or token typed, read or captured.
- Populated by two real turns in the scratch workspace `C:\Users\abdal\AppData\Local\Temp\task623-pop` (outside the repo): turn 1 (the previous review's: Read, Edit, Write, Edit, `npm test`, recap fence) and a new turn 2 (Edit `sum.js`, passing `npm test`, `ptah-ui display recap2` fence with stat trend pills "+3 good" and "-2 bad", a sparkline, and two avatars).
- Themes: anubis (dark), anubis-light, retro. Viewports 1700x1000 (dock 400 px, 300 px, 736 px max) and 2200x1000 (dock 960 px).
- Note (gap in the build flow): the `ptah-electron:build` target does not run `copy-renderer`. The first attempt found only `main.mjs` rebuilt while `renderer/` stayed at 00:26. The coordinator ran `node apps/ptah-electron/scripts/copy-renderer.js` to fix it. Worth wiring into the build target or the packaging checklist.

## Per-item results

| Item | Result | Evidence |
| --- | --- | --- |
| (a) Contrast of trend pill and avatar text >= 4.5:1 in anubis, anubis-light, retro | PASS | Computed fg over composited bg, 12 px text. Trend "up" (good): anubis 7.30, anubis-light 6.55, retro 5.12 (previously 3.7 light and 3.14 retro). Trend "down" (bad): 6.92, 7.18, 5.24. Avatar initials AL (success): 7.30, 6.55, 5.12. GH (warning): 7.44, 6.57, 5.08. Avatar names 11.98 to 15.92, subtitles 6.04 to 6.38. Screenshots: `recheck/r4-recap-anubis.png`, `r4-recap-anubis-light.png`, `r4-recap-retro.png`. |
| (b) Passing `npm test` shows passed | PASS | Recap "Tests passed" tile = 1 (turn 2, and the older turn 1 now also 1, previously 0). Host Turn summary Tests tile "1/1 pass" (previously "0/1 pass"). Turn summary chip "1 test passed" for both turns. Screenshots: `r2-open.png`, `g-960-anubis-light-Turn_summary.png`, `r4-recap-anubis.png`. |
| (c) Collapsed group header never shows the raw fence; no-text turn says "Assistant response" | PASS (live) / PASS by test (fallback) | Collapsed headers read as prose: "I added `sub` to `sum.js` and created and edited `notes.md`, and `npm test`..." and "I added `mul` to `sum.js` and `npm test` passed 1 of 1 tes...". "ptah-ui" text occurs only in the user's own prompt bubble and its code header, never in an assistant group header (DOM scan). Screenshot: `c-d-transcript-anubis.png`. The "Assistant response" fallback was not produced live (I could not make the agent emit a text-less turn without dishonest prompting): verified in source only, `message-summary.utils.ts:134` and spec `message-summary.utils.spec.ts:20`. MEDIUM confidence for that sub-point. |
| (d) Applied display chip badge reads "In display" | PASS | Both completed turns show a blue "In display" badge on the Recap and Recap two chips; no "Live" text in the page. Screenshots: `r1-initial.png`, `c-d-transcript-anubis.png`. |
| (e) Resize handle is a native `<button role="separator">` with keyboard resize and accessible name | PASS | `BUTTON type=button role=separator`, `aria-label="Resize display panel"`, `aria-orientation=vertical`, `aria-valuenow/min/max` 400/300/736 (1111 at 2200 px), `aria-valuetext "Panel width 400 pixels"`, tabindex 0. ArrowLeft 400 to 416, ArrowRight back to 400, Home 300, End 736, Enter resets 400. Focus ring 2 px solid outline. Screenshot: `r5-separator-focus-anubis.png`. |
| (f) b57766c74 parser and display-panel fixes hold; no console errors | PASS | Both fences render (cards, stats, trend pills, sparkline, avatars, table, paging). Console and pageerror listeners attached across theme switches, tab switches, resize and keyboard actions: 0 errors, 0 warnings. Limit: listeners were attached after page load, so load-time messages were not captured. |
| (g) Panel at 300 px and 960 px vs prototype | PASS | 300 px: tablist, sub-tabs, stat tiles, trend pills, avatars, host tiles all render in one column without overlap or truncation; document scrollWidth equals viewport; no descendant extends past the dock; only the active tabpanel is visible (the other four are `hidden`, expected). 960 px (needs a 2200 px window, max dock is 1111): Turn summary tiles in a 3 x 2 grid, Recap two in two cards side by side, Agents (0) empty state; no overflow. Layout, tab order and component choices (host-built chip, stat tiles, "Host" badge, rounded pills) match the prototype family. Screenshots: `g-300-anubis-*.png`, `g-300-anubis-light-*.png`, `g-960-anubis-*.png`, `g-960-anubis-light-*.png`. |

On the electron-only decision #5: the turn summary chip replaces the change-set card on Electron; not flagged.

## New and carried findings

All minor, none block.

1. Host Turn summary tiles render collapsed (value only) while the prototype's `summary-panel-*-expanded-*.png` shows the expanded detail rows (file list with Open file and Review, lines bar, tests list) and sparklines. Tiles do expand via their chevrons; I did not expand them. Confirm that collapsed-by-default is intended. At 960 px this leaves a large empty area under the 6 tiles.
2. Collapsed group headers show raw inline-code backticks ("`sub` to `sum.js`") and singular/plural drift ("1 files", "2 tools"). Source not traced. Cosmetic.
3. Carried over: at 892 px and below the session header metrics strip clips (pre-existing chrome, not this task). Not re-measured on this run.

## Not covered

- A text-less assistant turn live (see c).
- Retro theme at 300 and 960 px, and anubis-light at 1700 px for the Turn summary (contrast was measured in all 3 themes; layout screenshots at 300 and 960 px are in anubis and anubis-light).
