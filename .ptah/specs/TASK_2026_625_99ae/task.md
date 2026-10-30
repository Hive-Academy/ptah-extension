---
id: TASK_2026_625_99ae
status: done
type: BUGFIX
title: Hide console windows for every Windows child-process spawn
depends_on: []
created: '2026-10-10T20:27:35.627Z'
updated: "2026-10-30T01:09:07.477Z"
description: 'Console windows flash open and closed on Windows while Ptah works, because spawn sites outside OffThreadProcessSpawner omit windowsHide: true. Inventory and per-site fixes are in context.md.'
executor: backend-developer
estimate: M
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

Console windows flash open and closed on Windows while Ptah works, because spawn sites outside OffThreadProcessSpawner omit windowsHide: true. Inventory and per-site fixes are in context.md.

Full context, plan and discussion live in [./context.md](./context.md).
