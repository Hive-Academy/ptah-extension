---
id: TASK_2026_606_b6b7
status: backlog
type: BUGFIX
title: Show a normalised CLI version in the tasks UI
depends_on: []
created: "2026-10-03T12:10:10.450Z"
updated: "2026-10-03T12:10:10.450Z"
description: "task-agent-discovery.service.ts builds \"Run through {cli} {version}.\" from the raw --version line (\"Run through codex codex-cli 0.155.1.\"); reuse the cliVersionLabel normaliser from Settings."
executor: frontend-developer
estimate: XS
labels:
  - tasks-ui
relates_to:
  - TASK_2026_555
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

task-agent-discovery.service.ts builds "Run through {cli} {version}." from the raw --version line ("Run through codex codex-cli 0.155.1."); reuse the cliVersionLabel normaliser from Settings.

Full context, plan and discussion live in [./context.md](./context.md).
