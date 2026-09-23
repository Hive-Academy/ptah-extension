---
id: TASK_2026_453_1eb4
status: done
type: BUGFIX
title: Keep opening three canvas tiles on long sessions under the long-task budget
description: >-
  AC-11 from TASK_2026_437 is not met - opening 3 tiles on 2,000-event sessions
  blocks the renderer for 4.7 to 6.2 s (longest task 1.0 to 1.9 s). Staged fix -
  gate auto-animate during bulk mount, stagger concurrent tile opens, queue
  canvas session requests (FU-22a), measure, then reduce DOM volume only for the
  remaining gap.
depends_on:
  - TASK_2026_437_0778
created: 2026-09-15T20:30:00.000Z
updated: '2026-09-23T14:52:47.541Z'
---

## Description

Follow-up of TASK_2026_437_0778 Batch 22 and the FU-22d attribution spike. Measured with
`apps/ptah-electron-e2e/src/specs/chat/tile-open-longtask-budget.perf.spec.ts`.
