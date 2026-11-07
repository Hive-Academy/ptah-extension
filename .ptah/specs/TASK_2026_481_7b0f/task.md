---
status: backlog
type: refactoring
title: Move synchronous SQLite reads off the Electron main thread
description: >-
  better-sqlite3 runs on the Electron main thread. Memory and vector searches measured 300 to
  1,672 ms per statement (54 lag warnings and one 7,877 ms hang in a day). Move the hot reads off it.
parent: TASK_2026_635_5ea5
labels:
  - P1
relates_to:
  - TASK_2026_455_9f2c
  - TASK_2026_622_2d05
updated: 2026-11-07T00:00:00.000Z
---

## Description

Move the measured slow reads (memory search and `memory_chunks_vec`/`code_symbols_vec` KNN) off the
Electron main thread. Follow the design in `implementation-plan.md`: it uses the `DbWorkerRunner`
shape (`libs/backend/persistence-sqlite/src/lib/integrity/db-worker-runner.ts`) and ships in ordered
steps. Do not add another unreaped child-process family (see TASK_2026_479). Keep the hexagonal rule:
backend libs use `platform-core` ports and never import `electron`. Keep the shared connection from
`persistence-sqlite`.

First re-measure the same log signals on the current database. The plan makes Step 1 conditional on
the database shrink of TASK_2026_478, because the `memories` row scans may no longer be slow after it.

## Current state (2026-11-07)

- Design is done (`implementation-plan.md`). No production code moved yet.
- `persistence-sqlite` runs only the integrity/backup worker off-thread
  (`libs/backend/persistence-sqlite/src/lib/integrity/integrity-worker.ts`, used by
  `backup.service.ts:208` and `integrity-check.service.ts`). Other reads still run on the calling
  thread. `slow-statement-timing.ts` only logs slow statements.
- The TASK_2026_478 folder is not on this branch. An offline drain for the `observation_queue`
  backlog landed in `bdd360b50`. No re-measurement after it is on record.
- The plan's host degrade matrix covers VS Code and the CLI host. Those hosts are removed (PR #892).
  Only Electron and the cli-engine worker host (it uses `platform-cli`, see
  `libs/backend/cli-engine/src/lib/container.ts`) still need a degrade path.
