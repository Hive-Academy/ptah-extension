---
id: TASK_2026_574_c230
status: backlog
type: BUGFIX
title: Isolate harness-skill-selection spec from the machine temp folder
depends_on: []
created: '2026-09-26T20:53:58.343Z'
updated: '2026-09-26T20:53:58.343Z'
description: "harness-skill-selection-rpc.service.spec.ts never-writes-state.json fails when %TEMP%\\.ptah exists on the host; the spec must use an isolated temp dir"
relates_to:
  - TASK_2026_563_2939
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

harness-skill-selection-rpc.service.spec.ts never-writes-state.json fails when %TEMP%\.ptah exists on the host; the spec must use an isolated temp dir

Full context, plan and discussion live in [./context.md](./context.md).
