---
id: TASK_2026_362
status: in_progress
type: FEATURE
title: >-
  Native Ptah agent loop on pi-ai as a second conductor beside the Claude Agent SDK
depends_on: []
created: '2026-08-31T12:00:00.000Z'
updated: '2026-08-31T12:00:00.000Z'
description: >-
  Build an in-house agent loop (turn/step engine, tools, context management,
  session log, subagents, hooks) on the pi-ai provider layer, exposed as a
  NativeAgentAdapter behind the existing IAgentAdapter port so users can pick
  it or the Claude Agent SDK conductor per session. Ptah MCP tools become
  in-process native tools. Research phase complete; see research-report.md.
estimate: XL
labels:
  - agent-loop
  - agent-sdk
  - pi-ai
  - architecture
  - research
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

Native Ptah agent loop on pi-ai as a second conductor beside the Claude Agent SDK.

Full context, plan and discussion live in [./context.md](./context.md).
