---
id: TASK_2026_558_f761
status: backlog
type: BUGFIX
title: Keep Electron e2e runs from writing the developer's real ~/.gemini MCP config
depends_on: []
created: "2026-09-25T17:00:00.000Z"
updated: "2026-09-25T17:00:00.000Z"
description: "On a machine with agy installed, an e2e launch may register Ptah's MCP server into the real ~/.gemini/config/mcp_config.json because the e2e profile does not isolate os.homedir()."
estimate: S
labels:
  - e2e
  - electron
relates_to:
  - TASK_2026_556_d12d
  - TASK_2026_522_c6b1
  - TASK_2026_389
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

On a machine with agy installed, an e2e launch may register Ptah's MCP server into the real ~/.gemini/config/mcp_config.json because the e2e profile does not isolate os.homedir().

Full context, plan and discussion live in [./context.md](./context.md).
