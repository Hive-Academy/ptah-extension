# A0 Electron BEFORE recapture (F-D4)

| File | Result |
| --- | --- |
| evidence/f-d4-before-dark.png | PASS (theme `ptah-glass`, 1200x774 PNG, verified) |
| evidence/f-d4-before-light.png | PASS (theme `ptah-glass-light`, 1200x774 PNG, verified) |

Both were viewed: "Install dotnet-msbuild?" dialog with the MCP warning block, Cancel and Install buttons visible.

## Dialog text observed (identical in both themes)
- Title "Install dotnet-msbuild?", subtitle "dotnet/skills - version 0.1"
- "34 files", "246.6 KB on disk", "20 skills" with the same 20 skill chips (binlog-failure-analysis ... troubleshoot-binlog-mcp)
- "This plugin declares MCP servers": "Ptah will NOT register or run these servers. Installing only puts the plugin's files on disk. Nothing below executes unless you add it yourself."
- Server `binlog`, command `dotnet dnx Microsoft.AITools.BinlogMcp --yes --prerelease`
- Buttons "Cancel" and "Install dotnet-msbuild"

Differences from a0-electron-before.md lines 14-19: none.

## Build and isolation
- Build: existing /home/amun/ptah-extension/dist/apps/ptah-electron/main.mjs (Oct 29 23:06), no rebuild, no build/serve target, no source edits, no node_modules changes.
- Launch: `node_modules/.bin/electron main.mjs --user-data-dir=/tmp/ptah-f-d4-before2/udd --remote-debugging-port=9344 /tmp/ptah-f-d4-before2/ws`; HOME, XDG_CONFIG_HOME, XDG_DATA_HOME, PTAH_DB_PATH under /tmp/ptah-f-d4-before2; NODE_ENV, PTAH_E2E, ELECTRON_RUN_AS_NODE unset. Driven via playwright-core over CDP (scripts in /tmp/ptah-f-d4-scripts2).
- Flow: Marketplace -> Marketplaces -> add suggested ".NET Agent Skills" (dotnet/skills) -> Browse -> Install on dotnet-msbuild (plan request only) -> dark shot -> Cancel -> theme popover "Ptah Glass Light" -> dialog reopened -> light shot -> Cancel (dialog count 0).
- Observation: on the second open the plan request showed a spinner for roughly a minute (app was busy with embedder warmup) before the dialog appeared; the dialog content was identical.
- Temp dir: /tmp/ptah-f-d4-before2 (retained). Instance terminated with SIGTERM.

## Nothing installed
Install was never confirmed. Temp home plugins dir holds only Ptah's bundled plugins plus an empty `external/.ptah-external.json`; no dotnet-msbuild files exist anywhere under the temp dir. The user's running Ptah, ~/.ptah, ~/.claude and /home/amun/projects/.ptah were not touched. Nothing committed or pushed.
