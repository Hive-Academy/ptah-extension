# Batch 8 BEFORE screenshots (Agents tab, skill-synthesis-ui)

Base commit: `c57a9a1e7` (detached worktree `D:\projects\ptah-extension\.claude-worktrees\646-base-shots`, left in place).
Authorised by decision #58. One heavy process at a time; the Electron app has been closed (0 electron processes left).

## Where the Agents tab is

Electron app > navbar Thoth icon (`[data-test="config-menu-item-thoth"]`) > Thoth `Skills` tab (`#thoth-tab-skills`) >
sub-view `Library` (`[data-testid="skills-subview-clones"]`) > kind tab `Agents` (`role=tab`, "Agents"). Components:
`skill-synthesis-tab.component`, `clones/skill-clones-view.component`, `clone-card.component`, `clone-detail-drawer.component`.
The tab needs the desktop host (RPC `skillSynthesis:listClones` reads the SQLite `skill_registry`), so a plain browser
serve of the webview cannot show it. The Electron app driven through Playwright (`_electron`) was used instead.
(The `ptah_browser_*` tools only open http/https pages and cannot attach to Electron, so they were not usable.)

## How it was launched (repeat in the feature worktree)

Steps 1-2 are done once for the base; for the AFTER run substitute the feature worktree
`D:\projects\ptah-extension\.claude-worktrees\decision-model-routing` (it needs `node_modules` too; it already has one).

1. Worktree + node_modules junction (done):
   `git worktree add --detach .claude-worktrees/646-base-shots c57a9a1e7`
   `cmd /c mklink /J ...\646-base-shots\node_modules D:\projects\ptah-extension\node_modules`
2. Build (from the worktree root, `NX_DAEMON=false`, no `rebuild-native`, so the shared native modules are not touched):
   `npx nx build-dev ptah-electron --parallel=1`        (about 45 s)
   `npx nx copy-renderer-dev ptah-electron --parallel=1` (webview dev build + copy to `dist/apps/ptah-electron/renderer`, about 75 s)
   This replaces `nx serve ptah-electron` (which also runs `rebuild-native` and launches the real profile).
3. Capture (about 40 s; launches and closes Electron itself, so there is no serve process to stop):
   `node <this folder>\capture-agents-tab.cjs <worktreeRoot> <outDir> <prefix>`
   Before: `node ...\visual\batch-8-before\capture-agents-tab.cjs "D:/projects/ptah-extension/.claude-worktrees/646-base-shots" "<outDir>" before`
   After:  same script with the feature worktree root and prefix `after`.

Isolation done by the script: temp `HOME`/`USERPROFILE`, temp `--user-data-dir`, temp `PTAH_DB_PATH`,
`NODE_ENV=test`, `PTAH_E2E=1`, a temp workspace (`ws`). Nothing in the real `~/.ptah` is read or written.

## Seed data (same for before and after)

Four agent clones, written directly as `<slug>.md` + `<slug>.ptah-origin.json` under
`<HOME>/.ptah/user/agents/<ws key>/` (and the unscoped `agents/` root): `architect`, `backend-developer`
(marked diverged, with a `pendingSourceHash`, so it shows the orange diverged state and "Rebase all diverged (1)"),
`frontend-developer` (has `lastEnhancedAt`), `code-reviewer`. All `pluginId: null` (shown as "authored").
The temp workspace has a `.ptah` marker dir; without it `resolveHarnessWorkspaceRoot` ascends to the real `C:\Users\abdal\.ptah`
and the catalog lists nothing. All runs/invocation/scorecard counts are zero (no outcome data), so the cards show
"Never invoked yet", "0/5 runs", "no data yet".

## Viewport and theme

- Electron window content size 1100 x 700 CSS px, devicePixelRatio 1 (script requests 1100x700 via `BrowserWindow.setContentSize`;
  the script logs `actual viewport:` and it printed `{"w":1100,"h":700,"dpr":1}`). PNG size is 1100 x 700. Reuse it.
  (An earlier try at 1280x800 was clamped by the display to 1184x735, so 1100x700 was chosen to be stable.)
- Theme toggle: navbar palette button (`[aria-label="Change theme"]`), then the theme row `button[data-theme="anubis"]` (dark)
  or `button[data-theme="anubis-light"]` (light). The script confirms `document.documentElement[data-theme]` after each switch.

## Screenshots (this folder: `batch-8-before\`)

| File | Shows |
| --- | --- |
| `before-agents-list-dark.png` | Library > Agents, theme `anubis` (dark). Tab strip Skills 0 / Agents 4 / Commands 0, "1 diverged entry can be rebased" + "Rebase all diverged (1)", Sync provider copies, 2-column card grid (architect, backend-developer diverged, ...) scrolled so the cards are at the top. |
| `before-agents-list-light.png` | Same view, theme `anubis-light`. |
| `before-agents-drawer-dark.png` | Clone detail drawer for `architect` (first card clicked), dark: title and "authored - agent", "Never invoked yet", Actions (Enhance now disabled, needs 5 runs), Scorecard "no data yet", Body, History (0). |
| `before-agents-drawer-light.png` | Same drawer, light. |

Note: the list screenshots are viewport-only and show only the first row of cards (architect, backend-developer); the card
region below, with per-provider chips ("claude source", "codex not synced", ...) and "Loading models..." in the model
section, is partially visible at the bottom. The AFTER run uses the same script so the framing is identical.

## Limits

- No outcome-signal data exists in the base (that feature is what Batch 8 adds), so the before cards carry no outcome UI by design.
- Provider-sync chips read "not synced"/"not detected" and the model section reads "Loading models..." because the isolated
  profile has no installed providers (the model list never resolves in the capture window). Expect the same in the after run.
- Only the first card's drawer is captured, and only the Agents kind tab (Skills and Commands tabs are empty in the seeded profile).
- Cold boot: the content-download pass of the app re-runs the catalog sync during the capture; the script waits 2.5 s after
  opening the Agents tab, and the first run listed 4 rows as expected (`clones-row count: 4`).
- A `Harness reconcile failed (non-fatal)` log line may appear on shutdown; it is unrelated.
- `capture-agents-tab.cjs` uses `createRequire` on `<worktreeRoot>\package.json` to load `@playwright/test`, so it needs no install.
