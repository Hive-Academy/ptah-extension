---
id: TASK_2026_604_e720
status: backlog
type: REFACTORING
title: Bring the oversized settings files under 700 lines and drop spec codes from comments
depends_on: []
created: "2026-10-03T12:10:06.444Z"
updated: "2026-10-03T12:10:06.444Z"
description: "providers-settings-state.service.ts (729), file-settings-manager.ts (761), settings-reachability.table.ts (1010) and styles.css (2260) grew past the cap in TASK_2026_555; comments cite internal spec codes (A10, D15, M8) a reader cannot resolve."
executor: frontend-developer
estimate: M
labels:
  - settings
  - tech-debt
relates_to:
  - TASK_2026_555
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

providers-settings-state.service.ts (729), file-settings-manager.ts (761), settings-reachability.table.ts (1010) and styles.css (2260) grew past the cap in TASK_2026_555; comments cite internal spec codes (A10, D15, M8) a reader cannot resolve.

Full context, plan and discussion live in [./context.md](./context.md).
