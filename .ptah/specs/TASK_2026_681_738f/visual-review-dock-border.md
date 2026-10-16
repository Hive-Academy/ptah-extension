# Visual re-check - canvas agent dock border (PR #738, item 18 follow-up)

Verdict: PASS

Change under test: `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-tabs.component.ts:87`, the `[role="tablist"]` dock now has `border-b border-surface-border bg-surface-1` on top of `relative z-10 ... pb-1 shadow-[0_6px_8px_-6px_rgb(0_0_0/0.45)]`.

## How captured

- Build confirmed current: `dist/apps/ptah-electron/renderer/main.js` contains the literal class string `overflow-x-clip border-b border-surface-border bg-surface-1` (renderer index.html 20:05, newer than the earlier build). No build, nx, jest, serve or e2e was run.
- Launch: `.ptah/tmp/a1117-launcher.mjs` (NODE_ENV=development, private profile copy `.ptah/tmp/a1117-appdata/Ptah Dev`, single-instance lock skipped) via this worktree's `electron.exe`, `--remote-debugging-port=9351` (free; 9333 not used).
- Electron PID started by me: 19684 (children 37536, 9940, 9756, 36268, 16856, 29540, 40116). Nothing else started or killed.
- Playwright `connectOverCDP`; themes via `document.documentElement.dataset.theme` (`anubis` dark, `anubis-light` light); viewports 1440 / 760 / 400 x 900; session S4 (`ptah-final-run-ws`, two restored codex CLI lanes); sidebars closed; no prompt sent.
- Scripts and logs in `.ptah/tmp/`: `dock-lib.mjs`, `dock-common.mjs`, `dock-run.mjs` (facts, clips, hover card, menu), `dock-colors.mjs` (canvas-resolved colours, contrast), `dock-px.mjs` (pixel column sample from the screenshot); logs `run-dock.log`, `run-dock-colors.log`, `run-dock-px.log`.
- Screenshots: `.ptah/specs/TASK_2026_681_738f/screenshots/dock-border/` (14 files). Compared to `screenshots/final/dock-shadow-clip-1440-{dark,light}.png`.
- Viewport sample is an audit selection, not a support contract. Light was captured at 1440 only (as requested).

## Results

| Check | Result | Evidence |
| --- | --- | --- |
| Border edge visible in dark | PASS | 1px bottom border computed `oklch(0.925 0.007 88.6 / 0.14)`. Pixel column at x=900, y=167 is (53,53,59), the lightest line between dock bg (25,25,31) above and pane (19,19,23) below. Border vs pane 1.54:1, vs dock 1.45:1 (decorative edge, no 3:1 requirement). `dock-edge-zoom-1440-dark.png`, `dock-shadow-clip-1440-dark.png` |
| Dock bg is a soft step from the pane | PASS | Dark (25,25,31) vs pane (19,19,23) = 1.06:1; light (240,236,232) vs pane (250,247,245) = 1.10:1. Reads as a faint tonal step, not a block. `lane-view-1440-{dark,light}.png` |
| Dark shadow under the border | Unchanged | Below the border: (15,15,18) at y=168 easing to (19,19,23) by y=175. Light: (199,197,195) easing to (250,247,245) by y=178 |
| Tab text readable on bg-surface-1 | PASS | Dark: `codex` (232,230,225) on (25,25,31) 14.03:1; `done` (22,163,74) 5.31:1 (12px). Light: `codex` (41,19,52) on (240,236,232) 14.44:1; `done` (19,113,58) 5.18:1. All ≥ 4.5:1. Icons 14.03 / 5.31 (dark), 14.44 / 5.18 (light) |
| Active tab chip still distinct | PASS | Selected tab keeps its 1px amber outline (`oklch(0.7665 0.1387 91)` dark, `oklch(0.58 0.132 75)` light); visible in all clips |
| Hover card over lane content, 1440 dark | PASS | `[role=tooltip]` z-index 50, box 546,163 256x104, 9/9 sample points hit the card. `dock-hovercard-1440-dark.png` |
| Dock menu over lane content, 1440 dark | PASS | `role=menu` box 593,178 256x144, overlaps the lane view, 9/9 sample points hit the menu. `dock-menu-1440-dark.png` |
| Layout shift vs final | PASS | Dock height 42 -> 43 px (the 1px border); lane view y 167 -> 168, height 733 -> 732. Dock x/width unchanged at 1440 (368, 720), 760 (336, 348), 400 (120, 312). No horizontal shift. Tab boxes 38px high, unchanged. |
| 760 and 400 dark | PASS | Same computed border/bg/shadow; clips `dock-clip-760-dark.png`, `dock-clip-400-dark.png`. Page-level horizontal overflow at 400 (`scrollWidth` 723 vs 400) is the pre-existing item noted in the final review, unchanged |

## Measured colours (sRGB resolved from oklch via canvas)

| | Dock bg (bg-surface-1) | Pane bg | Border (alpha 0.14, composited on dock) |
| --- | --- | --- | --- |
| Dark `anubis` | (25,25,31) `oklch(0.2166 0.0112 285.43)` | (19,19,23) `oklch(0.1886 0.00805 285.6)` | (54,54,58); rendered pixel (53,53,59) |
| Light `anubis-light` | (240,236,232) `oklch(0.9444 0.00664 60.84)` | (250,247,245) `oklch(0.97788 0.004 56.4)` | (212,206,207); rendered pixel (212,206,206) |

Light: border vs dock 1.32:1, vs pane 1.46:1; edge visible in `dock-shadow-clip-1440-light.png`, the shadow remains as in final.

## Findings

- Blocking: none. Serious: none.
- Minor 1: in light the dock border is low contrast against the dock (1.32:1) and sits on top of an already visible shadow; it adds little there. Acceptable, decorative.
- Minor 2: at 760 the dock hover card from the previous tab hover stayed visible after `dismiss()` (1 tooltip); same behaviour as the final run (retaken there in `final-d`), not caused by this change.
- Prior final-review Minor 1 (dark shadow subtle) is now resolved by the visible border.

## Cleanup

Electron PID 19684 and its 7 children stopped with `taskkill /PID 19684 /T /F`; `Get-Process electron` returns 0 and nothing listens on 9351. Electron closed: yes.
