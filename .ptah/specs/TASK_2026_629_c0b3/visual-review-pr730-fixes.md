# Visual Review - TASK_2026_629_c0b3 - PR #730 fix round (session 13, after shots)

`S` = `W\.ptah\tmp\final-run\shots\` (W = the worktree root). All new shots are `S\after-s13-*.png` (19 files).
"Before" shots are `S\after-s12fix-*.png` (build before this round) and
`W\.ptah\tmp\pr730\artifacts-electron\results-1\git-agent-file-links-agent-1062c-thout-navigating-the-window\test-failed-1.png` (narrow).

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 7/10 |
| Assessment | NEEDS_REVISION (all six fixes verified; three Serious findings on adjacent surfaces, none caused by the fix round except F-2) |
| Visual breaking | 0 |
| Serious | 3 (F-1 setup card contrast, F-2 clipped text in the collapsed empty rail, F-3 "in focus" on every card name) |
| Moderate | 2 |
| Minor | 1 |
| Viewports tested | 1584x967 (window 1600), 1384x967 (Git dock open), 984x835, 1084x535 |
| Screenshots taken | 19 kept (more were taken and discarded) |
| Components tested | rail card (ring, ctx, idle ink), rail toggle, collapsed rail, focus area / panes, empty board + setup card |

## Environment

- Build: `node .ptah/tmp/check-run.mjs s13-renderer -- npx nx run ptah-electron:build-dev` ran through the lock (waited 160 s, exit 0, `dist/apps/ptah-electron/main.mjs` 03:36). That target does **not** rebuild the renderer (`apps/ptah-electron/project.json` `build-dev` runs only main, preload and workers). `renderer/index.html` stayed at 01:37, which is before commit `d5c8ba3e4` (03:36), so I ran one more target through the lock: `npx nx copy-renderer-dev ptah-electron --parallel=1` (it builds `ptah-extension-webview` in development, then copies it; exit 0). After it, `renderer/index.html` is 03:39:02, newer than the rebuild start. Previous sessions used the same two-step build (`build-renderer.log`). The bundle contains `#9ca3af` in `styles.css`. No better-sqlite3 rebuild was attempted or needed.
- Launched with `launch.mjs` (CDP 9333, port was free). First on `D:\projects\ptah-final-run-ws` (three Rail cards S2, S4, "can you generate html stats...", all `done`), then restarted on the empty folder `D:\projects\ptah-s13-empty-ws` (created by me, empty, outside any git repo) for check (d). The app is closed (stop file, video written, no listener on 9333).
- Themes `anubis` and `anubis-light`. Method as in `recheck-s12-fix-report.md`: computed styles through CDP, colours resolved through a 1x1 canvas and composited over the real ancestor backgrounds, WCAG 2 luminance; thresholds 4.5:1 text and 3:1 UI. Window resized with `window.resizeTo` (the Electron CDP has no `Browser.getWindowForTarget`).
- Not run: tests, other builds, git commands (none anywhere). For check (c) I wrote `liveModelStats.contextPercent` into the three tabs in app memory through `TabManagerService.setLiveModelStats` (via `ng.getComponent`), then restored the original objects; no source change.
- Harness additions (new, in `W\.ptah\tmp\final-run\`): `s13-*.mjs` helper steps. No source files edited.

## Result table

| # | Check | Before shot | After shot (dark / light) | Measurement | Result |
|---|---|---|---|---|---|
| a | Rail board, idle-state ink | `after-s12fix-rail-anubis.png` / `...-anubis-light.png` (idle pill 4.99:1 on the focused tint, from the s12 report) | `after-s13-01-dark-rail.png` / `after-s13-10-light-rail.png` | `--state-ink-idle` dark `#9ca3af` vs base-100 `#131317` **7.30**, base-200 `#1a1a20` **6.82**, focused tint `#222339` **6.05**. Idle pill text (derived ink `#b2b7be`) 8.59 on base-200. Light ink `#6b6570` vs base-100 `#faf7f5` **5.29**, base-200 `#efeae6` **4.73**, focused tint `#f0e5d5` **4.54** (thin margin). Idle pill `#564b5e` 6.86. Other states (dot vs base-200, dark): running 4.71, needs 6.18, error 4.60, done 5.25; light 5.42 / 5.21 / 5.47 / 5.09. | PASS (min 4.54 text, 4.60 dot) |
| b | Keyboard focus ring on the rail card select button | `after-s12fix-focused-card-anubis.png` (no ring; light before shot shows the outer ring only) | `after-s13-02-dark-focus.png` / `after-s13-11-light-focus.png` (wide), `after-s13-07-dark-narrow-focus.png` / `after-s13-14-light-narrow-focus.png` (collapsed rail) | Tab from the rail toggle reaches `.rc-select` of the focused card, `:focus-visible` true. Outer li ring 2 px solid, offset 2 px: dark `#e8e6e1` vs rail `#131317` **14.86**; light `#291334` vs `#faf7f5` **15.92**. Inner ring on `ptah-compact-rail-card` (new, offset -4 px): dark `#16a34a` vs card **4.66**; light `#13713a` vs card **4.89**. Collapsed button ring 2 px offset -2 px, visible in both themes. | PASS |
| c | Compact card context % is a whole number | `after-s12fix-rail-anubis.png` ("ctx 0%" only, real data) | `after-s13-03-dark-rail-ctx-whole.png` / `after-s13-12-light-rail-ctx-whole.png` | Raw `contextPercent()` 37.6 / 0.4 / 99.5 renders "ctx 38%" / "ctx 0%" / "ctx 100%" in both themes. With real data (0) it reads "ctx 0%". The text matches `^ctx (\d+%\|—)$` for every card. The fixed layout did not shift (card heights stay 176 px; the line did not wrap). | PASS |
| d | Empty board shows project setup card and scrolls instead of clipping | none (earlier build clipped it, per the PR comment) | tall: `after-s13-20-light-empty-board.png` / `after-s13-23-dark-empty-board.png`; short: `after-s13-21-light-empty-short-top.png`, `after-s13-22-light-empty-short-bottom.png`, `after-s13-24-dark-empty-short-top.png`, `after-s13-25-dark-empty-short-bottom.png` | Tall window (1584x967): "No sessions on this board", "New session", "Skills Not Configured" card with "Open Marketplace Skills" (143x24), "Intelligent Project Setup" card; no scrolling needed. Short window (1084x535): section `overflow-y: auto`, `scrollHeight` 591 > `clientHeight` 458; at `scrollTop` 0 the `h2` is at y=101 (inside); at `scrollTop` 133 the setup card bottom is inside the section; page itself does not scroll. Same in dark. See F-1 and F-2 for what else the shots show. | PASS (with F-1, F-2) |
| e | Narrow canvas (< 640 px) | `test-failed-1.png` (rail card cut off at the left edge, no pane visible) | dark, window 984: `after-s13-05-dark-narrow-split.png`, `after-s13-06-dark-narrow-single.png`; light, Git dock open at 1384: `after-s13-13-light-git-dock-narrow.png` | Dark: canvas 606 px, rail `w-[56px]` (width 56), toggle `aria-disabled="true"`, `title`/`aria-describedby` text "Widen the canvas to expand the Rail", `aria-label` "Expand rail", `aria-expanded="false"`, opacity 0.6. Focused pane visible: single 506x758, split 540x400 + 540x400. No horizontal page scroll. Light + dock: canvas 508 px, rail 56, same toggle state, pane 408 px wide visible. With the dock at 1584 the canvas is 708 px and the rail stays expanded (272 px): the 640 threshold works. | PASS |
| f | A11y snapshot, regions per pane | none | single: dark and light; split: `after-s13-04-dark-split.png`, `after-s13-15-light-split.png` | `ariaSnapshot` + DOM query. Single pane (both themes, narrow too): exactly one `region "Focused session: can you generate html stats and some…"`. Split (both themes): exactly one region per pane, named `Top session: can you generate html stats and some…` and `Bottom session: S2, active` (by design `paneLabel` switches to Top/Bottom while split, so no "Focused session:" name appears then). Other regions in the tree ("Turn summary: ...") are the Display chip, not panes. | PASS (note the split naming) |

## Findings

### Serious

**F-1. Project setup card fails contrast, worst in the light theme (visible now that it is on the empty board).**
- File: `libs/frontend/chat/src/lib/components/molecules/setup-plugins/project-setup-card.component.ts:40-41` (`text-warning` title), `:49-53` (`btn-xs btn-primary btn-outline`, 11 px), `:77-79` (`text-primary` title). Rendered by `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts:146`.
- Screens: `after-s13-20-light-empty-board.png`, `after-s13-23-dark-empty-board.png`.
- Measured (text, computed over the real card background):

| Element | Dark | Light |
| --- | --- | --- |
| "Intelligent Project Setup" (16 px semibold) | 3.16 | **1.44** |
| "Open Marketplace Skills" (11 px) | 3.47 | **1.32** |
| "Skills Not Configured" (12 px) | 6.40 | **2.32** |
| Card body text | 5.86 | 5.69 |
| "Configure" | 4.82 | 6.81 |

- Impact: in the light theme the call to action on the first-run screen is close to invisible; the dark theme title and button text also fail 4.5:1 (16 px is not "large text").
- Not caused by this round: the card is an existing component that this round's scroll fix now exposes. Fix: use a darker ink for `text-primary`/`text-warning` on the light card (or `text-base-content` for the title and a filled `btn-primary` for the button).

**F-2. Collapsed (56 px) Rail with an empty board clips "No sessions yet".**
- File: `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail.component.ts:177-181` (`<p class="px-3 py-4 text-sm ...">No sessions yet</p>` has no collapsed variant; the scroller is `overflow-x: hidden` at `:68-72`).
- Viewport: any width where the canvas is under 640 px with no sessions (shot at window 1100x560 = 1084x535). Screenshots: `after-s13-21-light-empty-short-top.png`, `after-s13-22-light-empty-short-bottom.png`.
- Measured: paragraph 55 px wide, `scrollWidth` 70 > `clientWidth` 55; it shows "No sessio / yet".
- Impact: cut-off text inside the new narrow-canvas state; the information is repeated by the board heading, so nothing functional is lost, but it reads as broken. Introduced by the auto-collapse feature in this round.
- Fix: render the empty text only when `!collapsed()`, or use `sr-only` plus an icon when collapsed.

**F-3. Every card's select button is named "..., in focus", not only the focused card.**
- File: `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-rail-card.component.ts:436-439` (`selectName` always ends with `, in focus`; `aria-current` is correctly set only on the focused card, `:222`). Seen in the DOM for S2, S4 and the focused card: `aria-label="S2, done, in focus"`.
- Impact: a screen reader announces all three unfocused and focused cards as "in focus"; the collapsed button (`canvas-rail-card.component.ts:113`) does it correctly (`focused() ? ', in focus' : ''`). Pre-existing (commit `e877d0c91`), not a fix-round regression.
- Fix: append ", in focus" only when `focused()`.

### Moderate

- **M-1. Collapsed Rail gives no visual mark for the focused session.** `after-s13-06-dark-narrow-single.png`, `after-s13-13-light-git-dock-narrow.png`. All three `.rail-collapsed` buttons have the same border (`/10`), background and colour; only `aria-current="true"` and `tabindex=0` differ (`canvas-rail-card.component.ts:112-117`). In the 56 px state the user cannot see which number is the open pane.
- **M-2. Rail collapse toggle is 15x24 px** (`canvas-rail.component.ts:108-123`, `btn btn-xs` with a single glyph), below the 24x24 minimum of WCAG 2.5.8 (AA) when it is active; neighbours are far enough apart that the spacing exception probably applies, so this is a guidance-level issue. While auto-collapsed it is `aria-disabled` at opacity 0.6, which is an inactive control.

### Minor

- The auto-collapsed toggle at opacity 0.6 measures 4.45:1 in the light theme (just under 4.5); exempt as an inactive control and the reason text is exposed through `title` and `aria-describedby`.

## Before / after comparison

| Surface | Before | After | Regression |
| --- | --- | --- | --- |
| Rail with three cards, dark | `after-s12fix-rail-anubis.png` | `after-s13-01-dark-rail.png`, `after-s13-03-dark-rail-ctx-whole.png` | None: same layout, card heights 176 px, focused frame unchanged, "Lanes" row shows live data for S2 after the split test. |
| Rail with three cards, light | `after-s12fix-rail-anubis-light.png` | `after-s13-10-light-rail.png` | None. |
| Focused card | `after-s12fix-focused-card-anubis.png` / `...-light.png` | `after-s13-02-dark-focus.png`, `after-s13-11-light-focus.png` | None; ring added. |
| Split | `after-s12fix-split-anubis.png` / `...-light.png` | `after-s13-04-dark-split.png`, `after-s13-15-light-split.png` | None (stacked Top/Bottom at this width, as before). |
| Narrow canvas | `test-failed-1.png` (card clipped, no pane) | `after-s13-05-dark-narrow-split.png`, `after-s13-06-dark-narrow-single.png`, `after-s13-13-light-git-dock-narrow.png` | Fixed; F-2 and M-1 are new in this state. |
| Display dock | `after-s12fix-display-dock-anubis.png` | not re-shot (not part of this round) | n/a |

## Verdict

- Recommendation: REVISE (the six fix-round checks pass in both themes; fix F-2 before merge since it appears in the new collapsed state, and schedule F-1 and F-3).
- Confidence: HIGH for the measured checks (a) to (f); MEDIUM for the exact "before" of (b), because the before shots were not taken with a deliberate Tab focus.
- Key concern: the project setup card on the empty board is unreadable in the light theme (1.32:1 to 1.44:1).
