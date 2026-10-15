# Re-check (session 12, after fixes) - F-A, F-B, F-C, F-E re-measured

Build under test: dev Electron app rebuilt after commit 10a660318 (merged at af028f886). `dist/.../renderer/index.html` is
dated 01:37, after the commit (01:34), and the bundle contains `--rc-focus-frame` and "not available yet". Launched by the
orchestrator (CDP 9333, video on); `FR\ready` was present at the first check. Workspace `D:\projects\ptah-final-run-ws`, three
Rail cards (S2, S4, "can you generate html stats..."), all `done`. Viewport 1600x967 (the earlier run used 1920x983). At this
width a split stacks Top/Bottom instead of Left/Right. Themes `anubis` and `anubis-light`.
Method as before: computed styles via CDP eval, colours resolved through a 1x1 canvas and composited over the real ancestor
backgrounds (8-bit sRGB), WCAG 2 luminance. Thresholds: text 4.5:1, UI parts 3:1. No code, build, test, git or paid agent run;
no `stop` file; app not relaunched. `S` = `W\.ptah\tmp\final-run\shots\`.

## Verdict: PASS - 0 findings open; F-A, F-B, F-C, F-E are all resolved in the running app. One Minor observation (below).

## Result table

| # | Check | Measured | Threshold | Result | Evidence |
|---|---|---|---|---|---|
| 1a | F-A dark: focused card frame `#2563eb` vs page `#131317` | 3.59:1 | 3:1 | PASS | `S\after-s12fix-focused-card-anubis.png`, `S\after-s12fix-rail-anubis.png` |
| 1b | F-A dark: frame vs unfocused card surface `#1a1a20` | 3.35:1 | 3:1 | PASS | same |
| 1c | F-A light: frame `#004a45` vs page `#faf7f5` | 9.53:1 (was 1.40) | 3:1 | PASS | `S\after-s12fix-focused-card-anubis-light.png`, `S\after-s12fix-rail-anubis-light.png` |
| 1d | F-A light: frame vs unfocused card surface `#efeae6` | 8.51:1 (was 1.25) | 3:1 | PASS | same |
| 2a | F-B dark: `done` pill on focused tint `#222339` / on unfocused `#1a1a20` | 6.40 / 7.22 | 4.5 | PASS | live cards |
| 2b | F-B light: `done` pill on focused tint `#f0e5d5` / on unfocused `#efeae6` | 6.87 / 7.16 | 4.5 | PASS | live cards |
| 2c | F-B absent states (running, needs, error, idle), dark, focused / unfocused | 6.02 / 6.79, 7.12 / 8.03, 5.91 / 6.67, **4.99** / 5.63 (idle) | 4.5 | PASS (min 4.99, idle focused) | computed on a hidden `cloneNode` of a card appended to `body` for one read, then removed; no app state touched |
| 2d | F-B absent states, light, focused / unfocused | 7.17 / 7.48, 6.96 / 7.25, 7.24 / 7.54, 6.58 / 6.86 (idle) | 4.5 | PASS (min 6.58) | same method |
| 3a | F-C light: inactive pane title `strong.truncate` | 6.04:1 vs active 15.92:1 (was 15.92 for both) | quieter and >= 4.5 | PASS | `S\after-s12fix-split-header-inactive-anubis-light.png`, `S\after-s12fix-split-header-active-anubis-light.png`, `S\after-s12fix-split-anubis-light.png` |
| 3b | F-C light: inactive pane marker "1" / chips | 5.39:1 (was 14.21) | >= 4.5 | PASS | same |
| 3c | F-C dark (regression): inactive title and marker vs active | 6.05 vs 14.86 | quieter, >= 4.5 | PASS | `S\after-s12fix-split-swapped-anubis.png` |
| 4a | F-E click `general-purpose` tile: notice visible | Notice span appeared 62-80 ms after the click, text "This agent is not available yet.", 8 px below the host top, inside the viewport, hit-test returns the span, 14 px, opacity 1 | visible at top | PASS | `S\after-s12fix-notice-anubis.png`, `S\after-s12fix-notice-anubis-light.png`, `S\after-s12fix-tile-expanded.png` |
| 4b | F-E layout shift | lane-view host (`ptah-canvas-detail-transcript`) scrollHeight/clientHeight 806/806 before, during and after, host rect unchanged; `[role=status]` height 0 when empty, 28 px with the notice, absolutely positioned, no scrollbar added | none | PASS | eval log |
| 4c | F-E auto-clear | removed 4066 ms (light) and 4074 ms (dark) after the click | ~4 s | PASS | MutationObserver log |
| 4d | F-E second click within 4 s | at 2001 ms the observer saw one `added` and one `removed` of the span in the same tick (node replaced); the notice was then removed at 5989 ms = 3.99 s after the second click (first timer cancelled) | replaces | PASS | MutationObserver log |
| 4e | F-E notice contrast | 13.89:1 dark (`#e8e6e1` on `#1a1a20`), 14.21:1 light (`#291334` on `#efeae6`) | 4.5 | PASS | eval |
| 5a | Heap: detached nodes after GC (CDP `detachedness`) | detached `ptah-canvas-lane-view`, `ptah-canvas-detail-transcript`, `.chat-msg-slot`, `ptah-chat-view`, tile or gridstack: **0** (819 detached nodes in total, none of those types) | 0 | PASS | heap snapshot, deleted after reading |
| 5b | No Grid DOM; ChatView counts | `ptah-canvas-tile` 0, gridstack/grid selectors 0, board toggle 0; `data-canvas-live-views` 1, `data-canvas-rail-shifts` 0; `ptah-chat-view` 2 = 1 in the transcript plus 1 hidden outside it (as before: 1 live view) | as before | PASS | eval |
| 5c | Actions inside the card | the 3 `.rail-actions-trigger` buttons (24x24) lie inside their card rect | inside | PASS | `S\after-s12fix-rail-anubis*.png` |
| 5d | Rail actions trigger colour (`text-base-content-muted`) | dark 5.65 unfocused / 5.01 focused; light 5.39 unfocused / 5.17 focused | 4.5 | PASS | eval |
| 5e | Dock shows Displays only | dock header reads "Displays (0)" with a "Turn summary" pill and card; no other tabs | Displays only | PASS | `S\after-s12fix-display-dock-anubis.png` |
| 5f | Split 1/2 markers follow Swap (light) | before: "can you..." = 1 Top (y 77), S2 = 2 Bottom (y 525); after Swap: "can you..." = 2 Bottom (y 525), S2 = 1 Top (y 77) | markers follow position | PASS | `S\after-s12fix-split-swapped-anubis-light.png`, `S\after-s12fix-split-swapped-anubis.png` |

## Notes

- The light frame ratios read 9.53 / 8.51 where the lane predicted 9.80 / 8.75. Same offset as the earlier run's 9.53 for
  the split bar: my 8-bit canvas pipeline against the lane's culori float model. Both are well above 3:1.
- Unfocused card border `#2f2e33` (dark) is a quiet 1.1:1 against its surface by design; the focused frame vs that border
  is 2.61 dark / 6.94 light. The spec check is frame vs page and vs card surface (1a-1d).
- The tile is reachable only after expanding the collapsed "5 tools" group in the transcript (same as the earlier run); the
  step used the group's own button (`aria-expanded=false`).
- Interacting with a header (its menu) makes that pane the active one; the quiet/active tiers moved with it, as expected.
- Minor observation (not counted): the notice is absolutely positioned at the host's top, so it covers part of the chat
  view's context chip strip (MODEL / CONTEXT / TOKENS) for 4 s (`S\after-s12fix-notice-anubis-light.png`). It has
  `pointer-events-none` and causes no shift. Carried over, not new: dock header "Displays (0)" with one display pill; the
  header chip strip clips AGENTS in narrow panes.

## Before / after pairs

| Subject | Before | After |
|---|---|---|
| Rail board, dark / light | `S\after-s12-rail-anubis.png`, `S\after-s12-rail-anubis-light.png` | `S\after-s12fix-rail-anubis.png`, `S\after-s12fix-rail-anubis-light.png` |
| Focused card, dark / light | `S\after-s12-rail-focused-anubis.png`, `S\after-s12-rail-focused-anubis-light.png` | `S\after-s12fix-focused-card-anubis.png`, `S\after-s12fix-focused-card-anubis-light.png` |
| Split, light (inactive header) | `S\after-s12-split-swapped-anubis-light.png` | `S\after-s12fix-split-anubis-light.png`, `S\after-s12fix-split-header-inactive-anubis-light.png`, `S\after-s12fix-split-header-active-anubis-light.png`, `S\after-s12fix-split-swapped-anubis-light.png` |
| Split after Swap, dark | `S\after-s12-split-swapped-anubis.png` | `S\after-s12fix-split-swapped-anubis.png` |
| Sub-agent click | `S\after-s12-subagent-click-anubis.png`, `S\after-s12-subagent-expanded-anubis.png` (no visible notice) | `S\after-s12fix-notice-anubis.png`, `S\after-s12fix-notice-anubis-light.png`, `S\after-s12fix-tile-expanded.png` |
| Display dock | `S\after-s12-display-dock-anubis.png` | `S\after-s12fix-display-dock-anubis.png` |

(`S` = `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\.ptah\tmp\final-run\shots\`)

## Not done

- No card in a running, needs-you, error or idle state exists, so 2c and 2d are computed on a clone of a real card with
  `data-state` set, not on live cards. The ratios use the app's own computed colours.
- F-D (Rail switch long tasks) was out of scope for this re-measure and is untouched.
- Only 1600x967 was opened; the 1920 side-by-side split layout was not re-measured.
- The app was left in `anubis`, single view, "can you generate html stats..." focused, dock closed, split closed.
