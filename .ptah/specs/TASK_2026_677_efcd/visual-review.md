# Visual review - TASK_2026_677 (codex)

Verdict: FAIL

## How captured

- `ptah-electron:build-dev` and `ptah-electron:copy-renderer-dev` ran via `.ptah/tmp/check-run.mjs` and both exited 0. The active renderer URL was the worktree's `dist/apps/ptah-electron/renderer/index.html`.
- Launched worktree `electron.exe` with `NODE_ENV=development`, CDP port 9333 and the Ptah Dev profile; PID **38100**. Playwright `connectOverCDP` set 1440, 760 and 400 by 900 px viewports. Themes were `anubis` and `anubis-light`.
- Scripts: `.ptah/tmp/after-lib.mjs`, `after-s1.mjs` to `after-s5.mjs`, `after-extra.mjs`, `after-tail.mjs`. The baseline pass came from s1–s3. The removed stats-strip controls blocked s4/s5. No prompt was sent.
- Compared against the matching before shots, `prototype/index.html`, approved prototype screenshots (`dark-collapsed-wide.png`, `delta2-merged-dock-400-dark.png`, `delta3-sheet-400-dark.png` and light counterparts), and `reference/01-clean-chat-turns.png` plus `reference/02-session-shell-with-inspector.png`. `visual-before.md` defines the capture procedure and viewport set.

## Screens

| Surface | Width | Theme | After file | Before file | Prototype match | Note |
|---|---:|---|---|---|---|---|
| Approval popover | 1440 | dark + light | approval-popover-1440-dark.png; approval-popover-1440-light.png | — | partial | Approval chip opens a dialog popover. |
| Canvas lane session | 1440 | dark + light | canvas-focus-lane-1440-dark.png; canvas-focus-lane-1440-light.png | canvas-focus-lane-1440-dark.png; canvas-focus-lane-1440-light.png | partial | Rendered in both themes; fixture content differs. |
| Canvas lane session | 1440 | dark + light | canvas-focus-lane-panelsclosed-1440-dark.png; canvas-focus-lane-panelsclosed-1440-light.png | canvas-focus-lane-panelsclosed-1440-dark.png; canvas-focus-lane-panelsclosed-1440-light.png | partial | Rendered in both themes; fixture content differs. |
| Canvas lane session | 400 | dark + light | canvas-focus-lane-panelsclosed-400-dark.png; canvas-focus-lane-panelsclosed-400-light.png | canvas-focus-lane-panelsclosed-400-dark.png; canvas-focus-lane-panelsclosed-400-light.png | partial | Rendered in both themes; fixture content differs. |
| Canvas lane session | 760 | dark + light | canvas-focus-lane-panelsclosed-760-dark.png; canvas-focus-lane-panelsclosed-760-light.png | canvas-focus-lane-panelsclosed-760-dark.png; canvas-focus-lane-panelsclosed-760-light.png | partial | Rendered in both themes; fixture content differs. |
| Canvas lane session | 1440 | dark + light | canvas-focus-orchestrator-1440-dark.png; canvas-focus-orchestrator-1440-light.png | canvas-focus-orchestrator-1440-dark.png; canvas-focus-orchestrator-1440-light.png | partial | Rendered in both themes; fixture content differs. |
| Canvas lane session | 1440 | dark + light | canvas-focus-orchestrator-panelsclosed-1440-dark.png; canvas-focus-orchestrator-panelsclosed-1440-light.png | canvas-focus-orchestrator-panelsclosed-1440-dark.png; canvas-focus-orchestrator-panelsclosed-1440-light.png | partial | Rendered in both themes; fixture content differs. |
| Canvas lane session | 400 | dark + light | canvas-focus-orchestrator-panelsclosed-400-dark.png; canvas-focus-orchestrator-panelsclosed-400-light.png | canvas-focus-orchestrator-panelsclosed-400-dark.png; canvas-focus-orchestrator-panelsclosed-400-light.png | partial | Rendered in both themes; fixture content differs. |
| Canvas lane session | 760 | dark + light | canvas-focus-orchestrator-panelsclosed-760-dark.png; canvas-focus-orchestrator-panelsclosed-760-light.png | canvas-focus-orchestrator-panelsclosed-760-dark.png; canvas-focus-orchestrator-panelsclosed-760-light.png | partial | Rendered in both themes; fixture content differs. |
| Finished chat turn | 1440 | dark + light | chat-turn-end-1440-dark.png; chat-turn-end-1440-light.png | chat-turn-end-1440-dark.png; chat-turn-end-1440-light.png | partial | Rendered in both themes; fixture content differs. |
| Finished chat turn | 400 | dark + light | chat-turn-end-400-dark.png; chat-turn-end-400-light.png | chat-turn-end-400-dark.png; chat-turn-end-400-light.png | partial | Rendered in both themes; fixture content differs. |
| Finished chat turn | 760 | dark + light | chat-turn-end-760-dark.png; chat-turn-end-760-light.png | chat-turn-end-760-dark.png; chat-turn-end-760-light.png | partial | Rendered in both themes; fixture content differs. |
| Finished chat turn | 1440 | dark + light | chat-turn-end-panelsclosed-1440-dark.png; chat-turn-end-panelsclosed-1440-light.png | chat-turn-end-panelsclosed-1440-dark.png; chat-turn-end-panelsclosed-1440-light.png | partial | Rendered in both themes; fixture content differs. |
| Finished chat turn | 400 | dark + light | chat-turn-end-panelsclosed-400-dark.png; chat-turn-end-panelsclosed-400-light.png | chat-turn-end-panelsclosed-400-dark.png; chat-turn-end-panelsclosed-400-light.png | partial | Rendered in both themes; fixture content differs. |
| Finished chat turn | 760 | dark + light | chat-turn-end-panelsclosed-760-dark.png; chat-turn-end-panelsclosed-760-light.png | chat-turn-end-panelsclosed-760-dark.png; chat-turn-end-panelsclosed-760-light.png | partial | Rendered in both themes; fixture content differs. |
| Finished chat turn | 1440 | dark + light | chat-turn-top-1440-dark.png; chat-turn-top-1440-light.png | chat-turn-top-1440-dark.png; chat-turn-top-1440-light.png | partial | Rendered in both themes; fixture content differs. |
| Finished chat turn | 400 | dark + light | chat-turn-top-400-dark.png; chat-turn-top-400-light.png | chat-turn-top-400-dark.png; chat-turn-top-400-light.png | partial | Rendered in both themes; fixture content differs. |
| Finished chat turn | 760 | dark + light | chat-turn-top-760-dark.png; chat-turn-top-760-light.png | chat-turn-top-760-dark.png; chat-turn-top-760-light.png | partial | Rendered in both themes; fixture content differs. |
| Finished chat turn | 1440 | dark + light | chat-turn-top-panelsclosed-1440-dark.png; chat-turn-top-panelsclosed-1440-light.png | chat-turn-top-panelsclosed-1440-dark.png; chat-turn-top-panelsclosed-1440-light.png | partial | Rich-session inspector remains blank (Issue 2). |
| Finished chat turn | 400 | dark + light | chat-turn-top-panelsclosed-400-dark.png; chat-turn-top-panelsclosed-400-light.png | chat-turn-top-panelsclosed-400-dark.png; chat-turn-top-panelsclosed-400-light.png | partial | Rendered in both themes; fixture content differs. |
| Finished chat turn | 760 | dark + light | chat-turn-top-panelsclosed-760-dark.png; chat-turn-top-panelsclosed-760-light.png | chat-turn-top-panelsclosed-760-dark.png; chat-turn-top-panelsclosed-760-light.png | partial | Rendered in both themes; fixture content differs. |
| Composer | 1440 | dark + light | composer-1440-dark.png; composer-1440-light.png | composer-1440-dark.png; composer-1440-light.png | partial | Rendered in both themes; fixture content differs. |
| Composer | 400 | dark + light | composer-400-dark.png; composer-400-light.png | composer-400-dark.png; composer-400-light.png | partial | Rendered in both themes; fixture content differs. |
| Composer | 1440 | dark + light | composer-typed-1440-dark.png; composer-typed-1440-light.png | composer-typed-1440-dark.png; composer-typed-1440-light.png | partial | Rendered in both themes; fixture content differs. |
| Dock interaction | 1440 | dark + light | dock-focus-1440-dark.png; dock-focus-1440-light.png | — | partial | Rendered in both themes; fixture content differs. |
| Dock interaction | 760 | dark + light | dock-focus-760-dark.png; dock-focus-760-light.png | — | partial | Card enters Sessions pane (Issue 3). |
| Dock interaction | 400 | dark + light | dock-overflow-400-dark.png; dock-overflow-400-light.png | — | partial | Sheet covered dock; menu unverified. |
| Inspector state | 400 | dark + light | inspector-open-400-dark.png; inspector-open-400-light.png | — | no | Sheet clipped; close off-screen (Issue 1). |
| Inspector state | 400 | dark + light | inspector-sheet-escape-400-dark.png; inspector-sheet-escape-400-light.png | — | no | Sheet clipped; close off-screen (Issue 1). |
| Inspector state | 400 | dark + light | inspector-sheet-tab-400-dark.png; inspector-sheet-tab-400-light.png | — | no | Sheet clipped; close off-screen (Issue 1). |
| Inspector state | 400 | dark + light | inspector-toggle-400-dark.png; inspector-toggle-400-light.png | — | no | Sheet clipped; close off-screen (Issue 1). |
| Session header | 1440 | dark + light | session-header-1440-dark.png; session-header-1440-light.png | session-header-1440-dark.png; session-header-1440-light.png | partial | Rendered in both themes; fixture content differs. |
| Session header | 400 | dark + light | session-header-400-dark.png; session-header-400-light.png | session-header-400-dark.png; session-header-400-light.png | partial | Rendered in both themes; fixture content differs. |
| Work log expanded | 1440 | dark + light | worklog-expanded-1440-dark.png; worklog-expanded-1440-light.png | — | partial | Disclosure expands and shows tool rows. |

## Issues

1. **Serious — the 400 px inspector sheet loses its close control and clips content.** `inspector-toggle-400-dark.png` and `inspector-sheet-tab-400-light.png` show the sheet beginning around x=63 and extending beyond the 400 px viewport. The close button and ends of AGENTS rows are off-screen. `inspector-sheet-escape-400-dark.png` still shows it after Escape. The approved `prototype/screenshots/delta3-sheet-400-dark.png` fits within 400 px with a visible close button. The Electron shell imposes `min-w-[400px]` on the focus host (`libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts:308`) while the shell rail consumes width; the compact sheet then fills that oversized host (`libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts:247`).
2. **Serious — rich-session inspector remains empty.** `chat-turn-top-panelsclosed-1440-dark.png` and its light counterpart show a 320 px “Session details” column with no SESSION, PLAN LIMITS or LANES after the rich turn loads. The approved wide prototype has a populated inspector. The aside renders even if `focusedId()` is absent, while the deferred inspector is conditional on that id (`libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts:231`). The lane session does populate the column (`canvas-focus-orchestrator-panelsclosed-1440-dark.png`), so this is session-specific.
3. **Moderate — dock focus card crosses into Sessions pane at 760 px.** `dock-focus-760-dark.png` shows the card beginning around x=293 while the focus pane begins around x=335. It obscures part of the session list. The prototype (`prototype/screenshots/delta2-merged-hover-card-focus-visible-dark.png`) keeps the card within its pane. `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-tabs.component.ts:392` requests bottom-start floating placement without passing a pane boundary.

## Not captured, and why

- Short `task623-pop` turn: switching workspace in the reused Ptah Dev session did not update the available rail cards during capture; the known short card never appeared and the after script timed out. The before files remain available, but no after claim is made.
- Old stats-strip and expanded tool-row shots: those selectors no longer exist in the new view, so `after-s4.mjs` and `after-s5.mjs` failed. The replacement work-log expansion is in `worklog-expanded-1440-dark/light.png`.
- A usable 400 px dock overflow menu: the compact inspector sheet covered the dock during `dock-overflow-400-dark/light.png`. That pair does not verify the menu. Hover/focus at 1440 and 760 was captured.
- Streaming, live approvals and agent work: none existed in the Dev profile, and sending a prompt was prohibited. Contrast ratios and animation layout shift were not measured.
- The script diagnostics check was unavailable after its 45-second TypeScript timeout; the screenshots and successful renderer build are the verification evidence.
- The rich turn displays “Worked” without duration. Source intentionally falls back when timestamps are absent (`libs/frontend/chat/src/lib/utils/turn-facts.utils.ts:229`), so this data shape cannot verify “Worked for Xm Ys”.

## Decisions

- Severity follows user impact: an inaccessible close action and missing inspector content are Serious; a card overlapping the pane but remaining readable is Moderate. Verdict is FAIL because the narrow sheet prevents reliable access to content and controls.





## Re-check after FIX-4

Verdict: PASS

### How captured

- `check-run.mjs fix4-electron` (`ptah-electron:build-dev`) exited 0, then `check-run.mjs fix4-copy` (`ptah-electron:copy-renderer-dev`) exited 0. Both used `--parallel=1 --skip-nx-cache`. The loaded renderer was this worktree's `dist/apps/ptah-electron/renderer/index.html`.
- Launched `electron.exe dist/apps/ptah-electron/main.mjs --remote-debugging-port=9333` with `NODE_ENV=development`, Ptah Dev profile, PID 34052. Used Playwright `connectOverCDP` via `.ptah/tmp/after-fix4.mjs` and `.ptah/tmp/after-lib.mjs` at 1440, 760 and 400 by 900. Opened only existing sessions and sent no prompt. Stopped PID 34052 with `taskkill /PID 34052 /T /F` after non-forceful termination could not stop all children.
- Fresh shots are in `screenshots/after-fix4/`. Compared with the old `screenshots/after/` shots and approved `prototype/screenshots/delta3-sheet-400-dark/light.png`, `delta3-full-inspector-1440-dark/light.png`, and `delta2-merged-hover-card-focus-visible-dark/light.png`.

### Defects

| # | Old severity | Status | Evidence, dark + light | Note |
| --- | --- | --- | --- | --- |
| 1 | Serious | FIXED | `inspector-toggle-400-dark/light.png`; `inspector-sheet-tab-400-dark/light.png`; `inspector-sheet-escape-400-dark/light.png` | At 400 px, sheet bounds were x=0â€“400 and close button x=364â€“392. AGENTS rows fit. Thirty further Tabs per theme stayed inside. Escape closed it with focus on its outside opener; the close button also worked. Geometry matches the approved sheet. |
| 2 | Serious | FIXED | `chat-turn-top-panelsclosed-1440-dark/light.png` | The 320 px aside contains SESSION and PLAN LIMITS rather than the placeholder. This session has zero lane runs, so LANES is conditionally absent (`libs/frontend/chat-ui/src/lib/molecules/session/inspector-stats/inspector-limits-lanes.component.ts:48`). The S4 sheet shots show populated LANES content. |
| 3 | Moderate | FIXED | `dock-focus-760-dark/light.png` | Hover card x=395â€“651 remained within focus pane x=336â€“684, clear of Sessions. Hover and keyboard focus use the same `openCard` method (`libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-tabs.component.ts:385`). |

### New issues

None observed on these screens. `dock-overflow-400-dark/light.png` shows the optional overflow menu after closing the sheet.

### Not captured, and why

- A rich-session LANES section: that existing session has no lane runs; the component only renders LANES when lane tiles or subtotal exist. S4 supplied the lane-content check.
- A live or streaming turn: no prompt was sent. Other screens, browsers and widths were outside this targeted recheck.

### Decisions

- Mark defect 2 FIXED rather than PARTIAL: the empty aside is populated, and source plus zero-run data explain the missing LANES heading. Reversible if the product requirement changes to show an empty LANES section.
- Use hover for the 760 px card: scripted `.focus()` did not satisfy the component's `:focus-visible` guard, while both hover and keyboard focus call the same positioning method. Reversible.
