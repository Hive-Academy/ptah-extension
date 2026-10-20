# Visual recheck - TASK_2026_702 (Electron only)

Verdict: APPROVED, 8/10. No visual-breaking or serious defects. Four minor deviations remain.

## Environment
- Fresh `npx nx build ptah-electron` + `copy-renderer.js` in the worktree (branch feat/chat-start-screen, includes b34813b0e and 633432181).
- Playwright `_electron`, temp APPDATA/HOME/PTAH_DB_PATH/user-data-dir, `--remote-debugging-port=9341`, faked main-process RPC (`setup-status:get-status`, `plugins:*`, `session:list`, workspace/auth stubs). Theme set through `set-state` + localStorage; `data-theme` confirmed `anubis` and `anubis-light`.
- Script: `visual-recheck/shoot.cjs`. Window 1440x900 (screenshots are 1.5x DPR), plus one 800x700 dark shot.
- Prototype compared: `prototype/screenshots/dark-empty.png`, `light-empty.png`, `dark-ready-recent.png`, `light-ready-recent.png`.

## Results
| State | Dark | Light | Result |
| --- | --- | --- | --- |
| 1 Empty board (setup incomplete) | visual-recheck/dark-1-empty-incomplete.png | light-1-empty-incomplete.png | PASS. Aurora hero, single filled "+ New session" (`btn-primary`); all setup buttons are `btn-xs btn-outline` (F2 fixed). No blank inspector: no `canvas-wide-inspector` node, hero box x=296 w=780 centred in the stage (F1 fixed). |
| 2a Get ready, incomplete | same as 1 | same as 1 | PASS. Eyebrow, "0 of 2 ready" badge, row icons, Setup tools label present. |
| 2b Get ready, complete | dark-2-empty-ready.png | light-2-empty-ready.png | PASS. Ready strip: Run setup / Generate agents / Project guidance, all outlined; Open Library intentionally absent. |
| 3 Recent sessions (3 seeded) | dark-3-recent-ready.png, dark-3b-recent-incomplete.png | light-3-recent-ready.png, light-3b-recent-incomplete.png | PASS. Three equal cards, two-line title clamp with ellipsis, relative dates (30m ago / Yesterday / Oct 11). |
| 4 New-session popover | dark-4a-popover-open.png, dark-4b-popover-escaped.png | light-4a-popover-open.png, light-4b-popover-escaped.png | PASS. Popover shows title, helper text, labelled "Session name (optional)" input, Cancel / Create. With focus on the anchor, Escape closes it (open dialogs 1 -> 0) and focus stays on `canvas-hero-new-session`, in both themes. |
| 5 Empty board 800x700 dark | dark-5-empty-800.png | - | PASS. No horizontal overflow (`scrollWidth <= innerWidth`); card reflows, buttons stay reachable; the board scrolls vertically inside its pane. |

## Remaining minor deviations (do not block)
1. Eyebrow "Before you begin" and the "0 of 2 ready" badge are neutral; the prototype uses amber (`project-setup-card.component.ts:~24`).
2. Setup rows have no divider lines between them (prototype has hairlines) (`project-setup-card.component.ts:~25-27`).
3. The host Sessions rail (existing component, not the F1 inspector) sits on the right, while the prototype puts it on the left. In the recent state it reads "No sessions yet" while Recent cards are listed (rail shows open tiles, cards show history). Pre-existing, out of this task's change set.
4. The aurora wash ends at a hard vertical edge at the Sessions rail border (dark-1-empty-incomplete.png, around x=1555 in the screenshot).

## Notes
- F5 (light shadow): light cards now show a soft shadow, acceptable (light-3-recent-ready.png).
- F6/F7: popover copy and Escape-on-anchor verified above.
