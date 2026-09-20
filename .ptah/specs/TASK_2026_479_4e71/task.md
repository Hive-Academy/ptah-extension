---
status: blocked
type: bugfix
title: Orphaned stdio MCP server process trees leak on every failed connect
description: >-
  Each spawned claude.EXE starts its own stdio MCP servers from .mcp.json. A
  connect timeout orphans the cmd.exe plus node tree instead of killing it.
  Measured 14 node and 14 cmd.exe firecrawl processes, still growing.
---

Also in scope: `~/.claude.json` registers this workspace twice under
`D:/projects/ptah-extension` and `d:/projects/ptah-extension`, differing only in
drive-letter case.
