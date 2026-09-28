# TASK_2026_558 — e2e runs may write the real `~/.gemini` MCP config

## Origin

The TASK_2026_556 implementer found this by reading the code. **It has not been confirmed on
disk.** Confirm it first.

## Problem

Every Electron e2e launch runs `registerCodeExecutionMcpForSubagents`
(`libs/backend/vscode-core/src/services/subsystem-bringup.ts`). When `agy` is on PATH and no
workspace is open, its registration writes Ptah's MCP server entry into a config under
`os.homedir()`: `~/.gemini/config/mcp_config.json`. The e2e launcher
(`apps/ptah-electron-e2e/src/support/electron-launcher.ts`) isolates the Electron `userData`
directory, but not the home directory. So a developer's real Gemini/agy config could get a
Ptah entry that points at a short-lived test port.

This is the same `os.homedir()` isolation gap as TASK_2026_522 and the one left open in
TASK_2026_389.

## Direction (not decided)

- Check it: note the mtime and content of `~/.gemini/config/mcp_config.json`, run
  `smoke.spec.ts` with `agy` installed, and compare.
- If confirmed, choose one:
  - (a) Point `HOME`/`USERPROFILE` at a temp dir for the launched app.
  - (b) Skip rival-CLI registration under `PTAH_E2E=1`, with an opt-in env var, following
    `PTAH_E2E_ALLOW_UPDATE_CHECK`.
  - (c) Fold this into TASK_2026_522's homedir isolation.

## Acceptance

- An e2e run leaves every file under the real home directory unchanged, checked by comparing
  mtimes and hashes before and after for the rival-CLI config paths.
