# Batch 22 BEFORE screenshots (Settings > Agent Orchestration > Background Model Roles)

Base commit: `c57a9a1e7` (detached worktree `D:\projects\ptah-extension\.claude-worktrees\646-base-shots`, built 2026-10-15, NOT rebuilt).
Risk R-10, step A12. Authorised by decision #58. One Electron process, no build/serve/e2e/package target run, no `rebuild-native`.
Electron has been closed (0 electron processes remain after the run).

## Method (repeat exactly for the AFTER run)

Electron app driven through Playwright `_electron`, same harness as batch 8. Chosen because the Background Model Roles rows
read the real host RPCs (`agent:getConfig` and the provider/model config) and the batch-8 route is proven. The `ptah_browser_*`
tools cannot attach to Electron. The webview-e2e-harness route was not needed.

Command (about 35 s; the script launches and closes Electron itself, no serve process to stop):

    node D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\.ptah\specs\TASK_2026_646_136a\visual\batch-22-before\capture-orchestration-settings.cjs <worktreeRoot> <outDir> <prefix>

- BEFORE (done): `<worktreeRoot>` = `D:/projects/ptah-extension/.claude-worktrees/646-base-shots`, `<outDir>` = this task's `visual\batch-22-before`, `<prefix>` = `before`.
- AFTER: only change `<worktreeRoot>` to `D:/projects/ptah-extension/.claude-worktrees/decision-model-routing` (it needs
  `dist/apps/ptah-electron/main.mjs` and `renderer/` built from the feature commit; the AFTER run needs its own build-dev +
  copy-renderer-dev, as in batch 8) and `<prefix>` to `after`. Use a different `<outDir>` (for example `visual\batch-22-after`) or keep the folder and rely on the prefix.
- The script loads `@playwright/test` through `createRequire` on `<worktreeRoot>\package.json`, so it needs no install.

## Navigation path (selectors)

1. Navbar settings icon: `[data-test="config-menu-item-settings"]` (click). Wait for `[data-testid="settings-back"]`.
2. Settings tab strip: `page.locator('ptah-settings').getByRole('button', { name: 'Agent Orchestration', exact: true })` (click).
3. `[data-testid="background-roles-details"]` is a closed `<details>` by default; click `[data-testid="background-roles-summary"]` to open it
   (summary text: "Background Model Roles", badge "6 roles", helper "Memory curator, archaeologist, synthesis, judge, replay, judging").
4. Wait for `[data-testid="provider-consumer-assignments"]` and the row cell `[data-testid="consumer-edit-synthesis"]`, then 2.5 s settle
   (the deferred CLI matrix chunk and the cold-boot catalog sync).
5. Row opened state: click `[data-testid="consumer-edit-synthesis"]`, wait for `[data-testid="consumer-editor-synthesis"]` (the "Synthesis lane" reassign popover), screenshot, close with Escape.
6. Theme: navbar `[aria-label="Change theme"]`, then `button[data-theme="anubis"]` (dark) or `button[data-theme="anubis-light"]` (light);
   the script logs `document.documentElement[data-theme]` after each switch (printed `anubis`, then `anubis-light`).

Row ids seen (6): `memory-curator`, `archaeologist`, `synthesis`, `judge`, `replay`, `judging-enhancement`
(`[data-testid="consumer-row-<id>"]`). The AFTER run should show a seventh `consumer-row-*` for the Decision model and a badge "7 roles".

## Isolation

Temp `HOME`/`USERPROFILE`, temp `--user-data-dir`, temp `PTAH_DB_PATH`, `NODE_ENV=test`, `PTAH_E2E=1`, temp workspace `ws` with a `.ptah` marker dir
(so workspace-root resolution cannot ascend to the real `C:\Users\abdal\.ptah`). Nothing in the real `~/.ptah` was read or written; `skillSynthesis.enabled=false`
in the real settings file was not touched; memory not touched. The temp dir is deleted in the script's `finally`. No seed data is used for this capture (the isolated profile has no providers configured).

## Viewport

Electron window content size requested 1100 x 700 via `BrowserWindow.setContentSize`; the script logged the actual viewport:
`{"w":1100,"h":700,"dpr":1}`. Window PNGs are 1100 x 700. The element PNG is the section block (702 x 342 CSS px dark, 702 x 344 light).

## Screenshots (folder `batch-22-before\`)

| File | Shows |
| --- | --- |
| `before-roles-viewport-dark.png` | Window shot, theme `anubis`. Orchestration tab scrolled so the roles summary is at the top: "BACKGROUND MODEL ROLES / 6 roles", "Background models" heading and copy, the 3 x 2 grid of cards (Memory curator, Archaeologist lane, Synthesis lane / Judge lane, Replay lane, Judging & enhancement), each "Follows main agent" with a "haiku tier" badge, the Enhancement time limit row ("Time limit: 120 seconds", "Edit limit"). The whole section (summary and all six rows) fits in the 700 px window. The Subagent prompt-cache TTL and Session budget cards start below it. |
| `before-roles-viewport-light.png` | Same framing, theme `anubis-light`. |
| `before-roles-section-dark.png` | Element screenshot of `[data-testid="background-roles-details"]` only (702 x 342): summary row, heading, six cards, time-limit row. Use this one for a pixel comparison of the grid. |
| `before-roles-section-light.png` | Same element, light (702 x 344). |
| `before-roles-row-open-dark.png` | Window shot with the "Synthesis lane" reassign popover open (`consumer-editor-synthesis`): title, Provider ("Active provider") and Model ("Default (active provider)") selects, "No models available from this provider.", "Not listed? Enter a model ID", warning "Choose a provider to start the main agent. Not saved." with "Set up main provider", footer "Each choice saves at once, with Undo.", Close X at top right. The open card uses the `surface-3` shade. |
| `before-roles-row-open-light.png` | Same, light. |

No `roles-rest` shot exists: the section is shorter than the window, so the script skipped it (it only takes it when the block is taller than window height minus 40 px).
The AFTER section will be taller (seventh row). If it grows past about 660 px the script takes `after-roles-rest-<theme>.png` as well.

## Limits

- Every row reads "Follows main agent" with the Claude mark and an ellipsis ("Follows main agent → ..."), because the isolated profile has no providers and no pinned lanes. The popover lists no models for the same reason. AFTER will look the same for the six old rows.
- Only the `synthesis` row is opened (its popover, not the Enhancement time limit editor). The pointer stays on that card after the click, so in the open-row shots the opened card and the cells show hover/active styling (white cell backgrounds in light, `surface-3` card shade); the closed-state shots (`roles-viewport`, `roles-section`) are taken with the pointer parked at (5, 5) after the theme switch, so no row is hovered.
- Dark and light are taken in one session: dark first, then the light switch with the section still open. The scroll offset of the Settings pane is reset by `scrollIntoView({ block: 'start' })` before each shot.
- Window position and window chrome are not part of the PNG (page screenshots only). Fonts and the `haiku tier` badge text are as rendered by this machine; compare before/after on the same machine.
- A `Harness reconcile failed (non-fatal)` shutdown log line may appear; unrelated.
- No Jest, Nx, build or serve target was run for this capture.
