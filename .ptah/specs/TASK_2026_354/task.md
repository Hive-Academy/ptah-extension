---
id: TASK_2026_354
status: done
type: BUGFIX
title: >-
  Boot log hygiene: duplicate MCP start line, .mcp.json rewrite on every switch,
  MCP port fallback, broken plugin skip, mojibake
depends_on: []
created: '2026-08-28T18:55:48.078Z'
updated: '2026-08-29T02:10:04.797Z'
description: >-
  Small faults from the 2026-08-28 log audit: "CodeExecutionMCP server started"
  logged twice (log.log:551-552); the user's project .mcp.json is
  unregistered/re-registered on every workspace switch
  (log.log:1142-1143,1546-1547,1733-1734,2000-2001,2088-2089,2176-2177) —
  register once per open folder and only touch the file when content changes;
  "MCP port 51820 unavailable (EADDRINUSE)" (log.log:550) should say which
  process/instance likely holds it; plugin ptah-skillssh-oso95-scroll-world has
  no SKILL.md (log.log:740) and should surface as a user-visible broken-plugin
  state rather than a debug line; em dashes print as "â€”" on Windows console
  (log.log:632,692) — set stdout encoding or use ASCII in log strings.
executor: backend-developer
estimate: S
labels:
  - electron
  - vscode-lm-tools
  - plugin-marketplace
  - logging
  - log-audit-2026-08-28
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

Small faults from the 2026-08-28 log audit: "CodeExecutionMCP server started" logged twice (log.log:551-552); the user's project .mcp.json is unregistered/re-registered on every workspace switch (log.log:1142-1143,1546-1547,1733-1734,2000-2001,2088-2089,2176-2177) — register once per open folder and only touch the file when content changes; "MCP port 51820 unavailable (EADDRINUSE)" (log.log:550) should say which process/instance likely holds it; plugin ptah-skillssh-oso95-scroll-world has no SKILL.md (log.log:740) and should surface as a user-visible broken-plugin state rather than a debug line; em dashes print as "â€”" on Windows console (log.log:632,692) — set stdout encoding or use ASCII in log strings.

Full context, plan and discussion live in [./context.md](./context.md).
