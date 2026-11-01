---
id: TASK_2026_415
status: backlog
type: BUGFIX
title: "Single-flight the boot readiness pull and make the harness target reads async"
depends_on: []
created: '2026-09-10T16:16:02.872Z'
updated: "2026-10-30T03:43:14.678Z"
description: "Worker-backed state storage already removed the whole-store write blocker. Remaining: add a single-flight guard around BootStatusService.pullReadiness and replace the synchronous reads in harness-sync claude-target.ts and workspace-target.ts behind the plan's profile gate."
executor: ollama cloud
estimate: M
labels:
  - partial
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

Trace repeated boot:getReadiness timeouts and reported initial-load UI freeze, identify the cause and define a regression-tested fix independent of compaction.

Full context, plan and discussion live in [./context.md](./context.md).
