---
id: TASK_2026_564_87a6
status: backlog
type: BUGFIX
title: "ptah-cli Anthropic proxy: remove dead skill__/mcp__ placeholder tools and disclose dropped tools[] and /commands"
depends_on: []
created: "2026-09-26T16:04:56.809Z"
updated: '2026-10-12T19:41:51.738Z'
description: "Path C CLI workspace proxy merges caller tools[] and skill__/mcp__ placeholders it never forwards, fires false proxy.tool_invoked, flattens /commands, and drops tool_result."
executor: backend-developer
parent: TASK_2026_640_11a5
labels:
  - P2
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

Path C CLI workspace proxy merges caller tools[] and skill__/mcp__ placeholders it never forwards, fires false proxy.tool_invoked, flattens /commands, and drops tool_result.

Full context, plan and discussion live in [./context.md](./context.md).
