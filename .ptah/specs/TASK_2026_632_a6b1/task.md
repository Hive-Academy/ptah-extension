---
id: TASK_2026_632_a6b1
status: done
type: BUGFIX
title: "Report budget-monitor subagent stops as Ptah stops, not \"stopped by user\""
depends_on: []
created: "2026-10-12T18:47:14.118Z"
updated: "2026-10-30T01:09:07.477Z"
description: "When SubagentBudgetMonitor stops a subagent at the handoff size, the SDK task notification says \"stopped by user\"; parents and child sessions then ask the user instead of starting a fresh agent with a handoff."
executor: backend-developer
estimate: S
labels:
  - subagents
  - compaction
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

When SubagentBudgetMonitor stops a subagent at the handoff size, the SDK task notification says "stopped by user"; parents and child sessions then ask the user instead of starting a fresh agent with a handoff.

Full context, plan and discussion live in [./context.md](./context.md).
