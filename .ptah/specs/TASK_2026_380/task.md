---
id: TASK_2026_380
status: in_progress
type: REFACTORING
title: 'Unfreeze Electron cold start: move SQLite quick_check off boot, defer skill boot scan, and show staged boot readiness in the renderer'
depends_on: []
created: '2026-09-05T21:52:15.493Z'
updated: '2026-09-05T21:52:15.493Z'
description: 'Cold start blocks the main process 20-26 s on PRAGMA quick_check of a 986 MB ptah.sqlite, then stutters 90 s while the skill boot scan enqueues sessions; the renderer has no boot-readiness signal, so it shows a bare spinner then a frozen shell. Fix both tracks.'
executor: software-architect
estimate: L
labels:
  - performance
  - electron
  - boot
  - ux
relates_to:
  - TASK_2026_331
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

Cold start blocks the main process 20-26 s on PRAGMA quick_check of a 986 MB ptah.sqlite, then stutters 90 s while the skill boot scan enqueues sessions; the renderer has no boot-readiness signal, so it shows a bare spinner then a frozen shell. Fix both tracks.

Full context, plan and discussion live in [./context.md](./context.md).
