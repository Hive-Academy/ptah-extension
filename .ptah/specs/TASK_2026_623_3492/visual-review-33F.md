# Visual Review 33F (scoped re-check) - TASK_2026_623_3492

Verdict: PASS WITH NOTES (D1 fixed, D2 fixed, keyboard OK, no new serious/critical defect attributable to this task; populated surfaces UNVERIFIED because the provider cannot produce a turn)

## Environment
- App: rebuilt Electron app at HEAD 5a2344e37, already running, attached over CDP http://127.0.0.1:9333 (playwright-core connectOverCDP, scripts in %TEMP%\task623-vr, outside the repo). No rebuild, no relaunch, no close.
- The app window (pid 21252) was minimised when I started the keyboard pass (CDP screenshots hung); I restored it with ShowWindow(SW_SHOWNOACTIVATE). No other app state change except the one chat prompt in "Provider" below.
- Dock viewports: window 892x735 gives dock 292 px wide; 1700x1000 gives dock 481.5 px. Chip widths 360 / 1024 via clone method (below).
- Themes switched with `data-theme` on `<html>` (dark / light). Final state left: light, viewport 892x735.
- Screenshots: `visual-review/33F-*.png` (24 files).

## Check table
| # | Check | Width | Theme | Result | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | D1 Displays tab selected: displays panel `display:flex` h 497; agents panel `hidden`, computed `display:none`, h 0 | dock 292 | dark, light | PASS | 33F-dock-292-{dark,light}-displays.png |
| 2 | D1 Agents tab selected: agents panel `flex` h 497; displays panel `hidden`, `display:none`, h 0, no stacked content | dock 292 | dark, light | PASS | 33F-dock-292-{dark,light}-agents.png |
| 3 | D1 Displays tab selected (displays flex h 737, agents none h 0) | dock 481 | dark, light | PASS | 33F-dock-481-{dark,light}-displays.png |
| 4 | D1 Agents tab selected (agents flex h 737, displays none h 0) | dock 481 | dark, light | PASS | 33F-dock-481-{dark,light}-agents.png |
| 5 | D2 chip, real chip clones, "unavailable" in Tokens/Cost/Time tiles: one line (lines=1), scrollWidth 85 == clientWidth 85, `overflow-wrap: normal`, class `break-normal font-medium text-sm` (14 px / 500), no hscroll in wrapper, 3 columns of 104.7 px | 360 | dark, light | PASS | 33F-chip-exp-360-{dark,light}.png |
| 6 | D2 same chip, 4 columns of 242.5 px, "unavailable" one line (223/223) | 1024 | dark, light | PASS | 33F-chip-exp-1024-{dark,light}.png |
| 7 | D2 numeric tile keeps large style: Tests "1/1", "1/4" render large and bold in the 360 screenshot (code: `MINI_VALUE_CLASS` text-lg font-semibold tabular-nums, turn-summary-chip.component.ts:44, binding :198) | 360 | light (visual), both (word tiles) | PASS (visual; see unverified: numeric Tokens/Cost/Time) | 33F-chip-exp-360-light.png |
| 8 | Keyboard: ArrowRight/ArrowLeft move focus and selection between Displays and Agents (wraps at both ends), Home selects Displays, End selects Agents; roving tabindex (selected 0, other -1); the panels follow (`flex`/`none`) | dock 292 | dark, light | PASS | console log; 33F-kbd-*-focus-ring-*.png |
| 9 | Focus ring on tabs: 2 px solid outline, offset 2 px (dark oklch(0.746 0.022 264), light oklch(0.278 0.030 257)); clearly visible on the pill | 292 | dark, light | PASS | 33F-kbd-dark-focus-ring-agents.png, 33F-kbd-light-focus-ring-agents.png, ...-displays.png |
| 10 | Focus never lands in the hidden panel: from the tablist Tab goes Pin panel, then Close panel, then leaves the dock (Hand off session, Layout options); `closest('[role=tabpanel][hidden]')` false at every stop, with Agents active and with Displays active | 292 | dark, light | PASS | console log (Tab/DispTab steps) |
| 11 | axe dock (dock root, both tabs' markup) | 292 | dark, light | PASS: 0 violations | axe run |
| 12 | axe chat transcripts (9 roots) | 892 window | dark, light | PASS for this task: 0 critical; moderate heading-order x1; moderate landmark-unique x2 (see Notes); serious scrollable-region-focusable x9 is pre-existing markdown (see Notes N1) | axe run |
| 13 | Populated surfaces (turn summary card live, dock with surfaces, display strip pills, expanded display chip, $agents, atoms, panel 300/960 vs prototype/screenshots) | - | - | UNVERIFIED | see below |

Chip method: real expanded `ptah-turn-summary-chip` nodes (4 exist in the live DOM, all with "unavailable" in Tokens/Cost/Time, so real chips with the word do exist) were cloned into a fixed-width (360 / 1024) wrapper on `document.body`, same method as visual-review.md. `data-theme` toggled on `<html>`.

## Measurements
- Dock 292 wide: active panel 497 px, inactive 0 px (previously both ~249 px, visible). Dock 481 wide: active 737 px, inactive 0 px (previously ~369).
- Chip value "unavailable": 14 px, weight 500, block, `break-normal`, width 85 px at 360 (tile content 85) and 223 px at 1024. D1/D2 before: 18 px, 600, `break-words`, wrapped "unavailab/le".
- Tab focus ring: 2 px outline, 2 px offset on a 81x28 px tab (tab target is 28 px high, meets 24 px AA target-size minimum).

## D1 / D2 status
- D1 (inactive dock tabpanel visible): FIXED. Evidence rows 1-4 and 8-10.
- D2 (chip "unavailable" breaking mid-word at 360): FIXED. Evidence rows 5-7. "pending" does not occur in any real chip; it shares the same `MINI_WORD_CLASS` binding in code (decision #156) but was not rendered.

## Provider and populated surfaces
- One prompt was sent ("Reply with only the word ok. Do not use any tools.") in the chat tile at 1700 px. Result: "Message delivery failed. No Anthropic API key configured. Add an API key in Settings, or switch to Claude CLI." (Authentication-required banner), screenshot 33F-turn-attempt.png. The earlier sessions still show the HTTP 429 ("API Error: Request rejected (429) ... reached your...") text. No second attempt was made because the cause is missing configuration, not a transient limit. Side effect: this created a new session titled "Reply with only the word ok. Do not..." in the app's session list (no repository files touched).
- Under decision #155(b) these items are UNVERIFIED and become the named follow-up task "populated surfaces, and the panel at 300/960 against the prototype": turn summary card from a live turn, dock with surfaces, display strip pills, expanded display chip, agents ($agents) populated, atoms, panel at 300 and 960 vs prototype/screenshots/. Also not rendered: the real "pending" chip word, a real numeric Tokens/Cost/Time tile, and `dp-tabpanel` in display-panel.component.ts (same `[hidden]` pattern as D1, flagged in visual-review.md; verify in the follow-up). Not failing this re-check.

## Notes (not blocking)
- N1 (pre-existing, outside this task): axe `scrollable-region-focusable` serious x9 on `.ptah-markdown-root` (overflow-x:auto, libs/frontend/markdown/src/lib/provide-markdown-rendering.ts, unchanged vs main). The tiles were squeezed to 33-51 px content width because the dock was open in a 892 px window (non-spec width); not caused by Batch 33F.
- N2 (moderate, new observation, expanded chip only): axe `landmark-unique` x2: `section[aria-label="Turn summary: 1 test passed"]` and `#ptah-turn-summary-chip-0-region` (role=region, aria-labelledby the toggle) are reported as duplicate landmarks when the chip is expanded. Distinct from the known code-output M1 (#151). Candidate for the same later accessibility task.
- N3 (moderate, known): `heading-order` x1 (chat-view "Get Started" h3), already recorded in #151.
- N4: the dock close button shows a focus ring after a click (observed in 33F-dock-481-dark-displays.png); it is the ordinary focus-visible state after programmatic focus, no action.

## Unverified list
1. Populated surfaces and panel at 300/960 vs prototype (provider unavailable; #155(b)).
2. Real "pending" chip word; real numeric Tokens/Cost/Time tile.
3. `dp-tabpanel` hidden behaviour in display-panel.component (needs surfaces).
4. Out of scope per #154(c): merge-base heights, synthetic CJK/markdown inputs, VS Code R7.8/R7.10, real window resize.

## Verdict
PASS WITH NOTES. D1 and D2 fixed in both themes at the reachable widths, keyboard and focus correct, no new serious/critical defect attributable to this task; populated surfaces remain a named follow-up.
