# A0 Electron BEFORE capture - PRODUCED

Both screenshots were captured from the real Electron app. No mocks, no e2e fixtures, no install confirmed.

## Result

| File | Result |
| --- | --- |
| evidence/f-d4-before-dark.png | PASS (theme `ptah-glass`, dark glass; 1200x774 viewport) |
| evidence/f-d4-before-light.png | PASS (theme `ptah-glass-light`, same viewport and plugin) |

I looked at both images. Each shows the "Install dotnet-msbuild?" consent dialog. Dark has the Cancel button and "Install dotnet-msbuild" button visible; light matches.

Dialog text observed (identical in both themes):
- Title: "Install dotnet-msbuild?", subtitle "dotnet/skills - version 0.1"
- "34 files", "246.6 KB on disk", "20 skills" with the skill chips (binlog-failure-analysis ... troubleshoot-binlog-mcp)
- Warning block "This plugin declares MCP servers": "Ptah will NOT register or run these servers. Installing only puts the plugin's files on disk. Nothing below executes unless you add it yourself."
- Server `binlog` with command `dotnet dnx Microsoft.AITools.BinlogMcp --yes --prerelease`
- Buttons "Cancel" and "Install dotnet-msbuild"

## What I did

- Build: existing `dist/apps/ptah-electron/main.mjs` (no rebuild, no build/serve/e2e target, no source edits, no dependency links).
- Isolated instance: `node_modules/electron/dist/electron main.mjs --user-data-dir=/tmp/ptah-f-d4-run/udd --remote-debugging-port=9333 /tmp/ptah-f-d4-run/ws`, with HOME, XDG_CONFIG_HOME, XDG_DATA_HOME and PTAH_DB_PATH under `/tmp/ptah-f-d4-run`. NODE_ENV, PTAH_E2E and ELECTRON_RUN_AS_NODE were unset. The user's dev instance (pid 622747) was untouched and is still running.
- Driven over CDP with playwright-core (scripts in `/tmp/ptah-f-d4-scripts`).
- Flow: dismiss the "Update available" modal with "Later" -> Marketplace -> Marketplaces -> add suggested "dotnet/skills" (real GitHub fetch, 16 plugins) -> Browse -> click Install on plugins in order until the dialog contained the MCP block. dotnet, dotnet-advanced, dotnet-data and dotnet-diag had no MCP servers; dotnet-msbuild (5th) did. Install on a plugin only requests the plan (tokenless call, writes nothing).
- Dark shot taken, Cancel clicked. Theme popover (`Change theme`) -> Glass mode light swatch (`ptah-glass-light`). Dialog reopened for the same plugin, light shot taken, Cancel clicked (dialog count 0).
- Dark was captured first, so the header "Workspaces" panel state differs slightly only in the discarded intermediate attempt, not in the final images.
- Nothing installed. The only plugin dir in the temp home is `/tmp/ptah-f-d4-run/home/.ptah/plugins/ptah-dotnet`, Ptah's own bundled plugin synced at boot, not the dotnet-msbuild plugin.
- Instance closed (SIGTERM); only temp data under the temp dir was written.

## Cause of the earlier "Loading workspace" hang (previous attempt)

Not reproduced. With PTAH_E2E unset and a real directory passed as workspace arg, the renderer left the loading screen within ~5 s: the log shows "Cleared file cache for workspace switch to /tmp/ptah-f-d4-run/ws" and the workspace panel lists `ws`. The earlier attempt used PTAH_E2E=1 plus NODE_ENV=test and no workspace arg; the backend then likely never resolved `workspace:getInfo` (set in `finally` of `syncFromBackend`, `libs/frontend/core/src/lib/services/electron-layout.service.ts`). I did not isolate which of the three differences matters, so this is a hypothesis, not a confirmed cause.

Other observations: an "Update available 0.0 -> 0.1.70" modal appears on first launch (network update check, dismiss with Later). No license or onboarding gate blocked the marketplace.

## Temp dir

`/tmp/ptah-f-d4-run` (profile, home, workspace, logs in `out/`); scripts in `/tmp/ptah-f-d4-scripts`. Retained, not deleted.

## Previous attempt (superseded)

Earlier worker reported A0 UNAVAILABLE at base SHA `2bccac73fec116923f9bfd82f8334e17d167a037`: the worktree renderer build failed on missing prismjs/daisyui links, the worker temporarily linked and then removed them (out of scope, not authorized), and an isolated Playwright launch with PTAH_E2E=1 stuck at "Ptah / Loading workspace" (temp home `/tmp/ptah-consent-home-fQrIuX`). No screenshots were produced and nothing was installed.
