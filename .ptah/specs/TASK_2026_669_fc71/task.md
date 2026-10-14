---
id: TASK_2026_669_fc71
status: backlog
type: BUGFIX
title: Prune per-session autopilot write counters
depends_on: []
created: "2026-10-14T17:08:12.587Z"
updated: "2026-10-14T17:08:12.587Z"
description: autopilot-state.service.ts keeps per-session write counters that are never pruned when a session ends (PR 725 Moderate).
estimate: XS
labels:
  - follow-up
relates_to:
  - TASK_2026_655_handoff
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

autopilot-state.service.ts keeps per-session write counters that are never pruned when a session ends (PR 725 Moderate).

Full context, plan and discussion live in [./context.md](./context.md).
