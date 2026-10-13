---
id: TASK_2026_643_5210
status: backlog
type: REFACTORING
title: "Split memory.store.ts, memory-curator.service.ts and memory-trigger.service.ts under the facade rule"
depends_on:
  - TASK_2026_454_b401
created: "2026-10-12T19:39:51.430Z"
updated: "2026-10-12T19:39:51.430Z"
description: "Merges TASK_2026_570 and TASK_2026_310. The files are 1041, 1049 and 1539 lines (lint max 700). Extract nameable collaborators, keep public names, tokens and signatures. Starts after the TASK_2026_454 boundary decision."
executor: backend-developer
parent: TASK_2026_638_7a8e
estimate: L
labels:
  - memory
  - P3
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

Merges TASK_2026_570 and TASK_2026_310. The files are 1041, 1049 and 1539 lines (lint max 700). Extract nameable collaborators, keep public names, tokens and signatures. Starts after the TASK_2026_454 boundary decision.

Full context, plan and discussion live in [./context.md](./context.md).
