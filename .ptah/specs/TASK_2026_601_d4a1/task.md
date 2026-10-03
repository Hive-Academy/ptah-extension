---
id: TASK_2026_601_d4a1
status: backlog
type: BUGFIX
title: Close the Cursor split-key and agy status-line gaps in CLI adapter output
depends_on: []
created: "2026-10-03T12:09:59.897Z"
updated: "2026-10-03T12:09:59.897Z"
description: "Cursor redaction misses a key split across two assistant text deltas; parseAgyModels (old tab-less format) still lists a status line such as \"Please sign in\" as a model."
executor: backend-developer
estimate: S
labels:
  - cli-agents
  - security
relates_to:
  - TASK_2026_555
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

Cursor redaction misses a key split across two assistant text deltas; parseAgyModels (old tab-less format) still lists a status line such as "Please sign in" as a model.

Full context, plan and discussion live in [./context.md](./context.md).
