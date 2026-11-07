---
id: TASK_2026_558_f761
status: backlog
type: BUGFIX
title: Keep Electron e2e runs from writing the developer's real ~/.gemini MCP config
depends_on: []
created: "2026-09-25T17:00:00.000Z"
updated: 2026-11-07T00:00:00.000Z
description: >-
  With agy installed, an e2e launch may write Ptah's MCP server into the real
  ~/.gemini/config/mcp_config.json, because the e2e launcher does not isolate the home directory.
estimate: S
labels:
  - e2e
  - electron
relates_to:
  - TASK_2026_522_c6b1
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

## Description

Every Electron e2e launch starts `registerCodeExecutionMcpForSubagents`
(`apps/ptah-electron/src/activation/wire-runtime.ts:562`). With `agy` on PATH, the antigravity
adapter is the one writer of `~/.gemini/config/mcp_config.json`, and it resolves the home directory
as `HOME`, then `USERPROFILE`, then `os.homedir()`
(`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts:515-520,615-636`).
The launcher isolates `userData` and the database, but passes the real `HOME`/`USERPROFILE` through
(`apps/ptah-electron-e2e/src/support/electron-launcher.ts:107-115`).

1. Confirm it on disk first: record the mtime and hash of `~/.gemini/config/mcp_config.json`, run
   `smoke.spec.ts` with `agy` installed (only when the user asks for an e2e run), and compare.
2. If confirmed, choose one: point `HOME`/`USERPROFILE` at a temp dir for the launched app; skip
   rival-CLI registration under `PTAH_E2E=1` with an opt-in env var; or fold it into the home
   isolation of TASK_2026_522_c6b1.

Acceptance: an e2e run leaves every rival-CLI config file under the real home directory unchanged
(mtime and hash before and after).

## Current state (2026-11-07)

- Not fixed and not confirmed on disk.
- `PTAH_E2E=1` skips other boot work (`apps/ptah-electron/src/activation/bootstrap.ts:554`,
  `post-window.ts:166`, `boot-coordinator.ts:656`), but not rival-CLI MCP registration.
- Same root cause as TASK_2026_522_c6b1 (OAuth manifest under the real home directory).

Full history in [./context.md](./context.md).
