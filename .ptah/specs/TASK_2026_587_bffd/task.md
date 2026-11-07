---
id: TASK_2026_587_bffd
status: backlog
type: FEATURE
title: >-
  Thoth Overview tab: memory health, needs-attention and recent outcomes from lane-outcomes
depends_on: []
created: "2026-10-01T00:00:00.000Z"
updated: '2026-11-07T00:00:00.000Z'
description: >-
  Add an Overview tab to thoth-shell with memory storage health, a needs-attention list and Recent
  outcomes read from libs/backend/lane-outcomes through a new RPC. No new ledger table.
estimate: L
parent: TASK_2026_637_e30b
labels:
  - TASK_2026_439_1310
  - P2
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

## Description

Add an Overview tab as the Thoth landing view, with three sections:

- **Health:** memory DB size, reclaimable bytes, last and next retention run, retention fault.
- **Needs your attention:** reclaimable storage, quarantined memories to review, failed cron or
  gateway jobs.
- **Recent outcomes:** newest-first rows from the lane and subagent outcome record in
  `libs/backend/lane-outcomes`, through a new RPC.

Do not add a new activity ledger table (rescope of 2026-10-14). Do not build a skill funnel or
skill evidence cards: #788 (`7a4a307e7`) removed the skill-synthesis pipeline they used.

Acceptance: a spec that fails when the Overview does not read the lane-outcome record, and
visual-reviewer screenshots in Electron (dark and light).

## Current state (2026-11-07)

- Not started. The Thoth tabs are `memory`, `skills`, `cron`, `gateway`
  (`libs/frontend/thoth-shell/src/lib/components/thoth-shell.component.ts:47`); unknown tabs
  redirect to `memory` (`libs/frontend/thoth-shell/src/lib/thoth.routes.ts:43`).
- Outcome data exists: `libs/backend/lane-outcomes/src/lib/lane-outcome-reader.service.ts` and
  migration `libs/backend/persistence-sqlite/src/lib/migrations/0054_lane_outcome_records.ts`.
  Only `agent:outcomeSignals` is exposed over RPC (`libs/shared/src/lib/types/rpc.types.ts:1853`).
- Storage health is now shown in the memory UI:
  `libs/frontend/memory-curator-ui/src/lib/components/diagnostics/storage-health-panel.component.ts`.
  Reuse it or its data for the Health section.

Full context, plan and discussion live in [./context.md](./context.md).
