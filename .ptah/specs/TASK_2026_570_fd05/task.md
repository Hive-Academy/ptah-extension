---
id: TASK_2026_570_fd05
status: backlog
type: REFACTORING
title: Split memory.store.ts and memory-curator.service.ts under the facade rule
depends_on: []
created: '2026-09-26T20:53:50.214Z'
updated: '2026-09-26T20:53:50.214Z'
description: 'memory.store.ts is past 1,000 lines and memory-curator.service.ts is 861 (lint max-lines 700); extract nameable collaborators, keep public class names, tokens and signatures'
labels:
  - memory-curator
relates_to:
  - TASK_2026_563_2939
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

memory.store.ts is past 1,000 lines and memory-curator.service.ts is 861 (lint max-lines 700); extract nameable collaborators, keep public class names, tokens and signatures

Full context, plan and discussion live in [./context.md](./context.md).
