---
id: TASK_2026_587_bffd
status: backlog
type: FEATURE
title: "Thoth Overview tab: memory health, needs-attention and recent outcomes from lane-outcomes"
depends_on: []
created: "2026-10-01T00:00:00.000Z"
updated: "2026-10-30T03:38:08.921Z"
description: "Add an Overview tab to thoth-shell (memory|skills|cron|gateway today) with memory storage health, a needs-attention list (reclaimable storage, quarantine to review, failed cron or gateway jobs) and Recent outcomes read from libs/backend/lane-outcomes via a new RPC. No new ledger table, no skill funnel."
estimate: L
parent: TASK_2026_637_e30b
labels:
  - TASK_2026_439_1310
  - P2
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

Phase 6 of the Thoth rework. Open Thoth on one Overview with Health, Needs your attention and Recent outcomes, backed by a durable, newest-first, cross-subsystem activity ledger with ULID ids and bounded retention. Tabs become task pages and diagnostics move under Advanced.

Full context, plan and discussion live in [./context.md](./context.md).
