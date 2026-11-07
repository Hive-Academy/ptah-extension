---
status: backlog
type: bugfix
title: Orphaned stdio MCP server process trees leak on every failed connect
description: >-
  A stdio MCP connect timeout leaves the cmd.exe plus node tree running on Windows. The
  back-off part is done; tree-kill and the duplicate drive-letter key remain.
updated: 2026-11-07T00:00:00.000Z
---

## Description

Each `claude` subprocess that Ptah spawns starts its own stdio MCP servers from `.mcp.json`. On a
connect timeout the `cmd.exe /c npx ...` wrapper and its node children stay alive (measured
2026-09-19: 14 node and 14 cmd.exe `firecrawl` processes, still growing).

Remaining work:

1. Find out who owns the orphaned tree: Ptah code or the `claude` subprocess. If it is the
   subprocess, record that and keep the fix to what Ptah controls (which servers it injects, and the
   back-off). If Ptah owns it, kill the whole tree on Windows, not only the direct child.
2. `~/.claude.json` registers this workspace twice, under `<drive>:/<repo-path>` keys that differ
   only in drive-letter case. Find out whether Ptah writes these keys. If it does, normalise the
   casing. Check whether the duplicate doubles MCP spawns.

Constraint: any reaping must be bounded. Do not add a timer that scans all system processes.

## Current state (2026-11-07)

- Done: `McpServerBackoffService`
  (`libs/backend/agent-sdk/src/lib/helpers/mcp-server-backoff.service.ts`, `54ceb9c10`, PR #539)
  stops re-spawns of a failed server through `disabledMcpjsonServers`/`deniedMcpServers`.
- Open: `libs/backend/agent-sdk/src/lib/helpers/off-thread-process-spawner.ts:387-389` still records
  that `process.kill` on Windows ends only the named process, not its tree.
- Open: ownership of the orphaned tree and the drive-letter duplicate are not investigated. Code
  that reads or writes `~/.claude.json` is in `libs/backend/cli-agent-runtime/src/lib/mcp-directory/`.
- See `child-process-audit.md` and the judge reports in this folder for the back-off history.
