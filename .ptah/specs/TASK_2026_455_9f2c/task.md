---
id: TASK_2026_455_9f2c
status: backlog
type: RESEARCH
title: >-
  Measure the memory retention batch timings on the Electron better-sqlite3 binding
description: >-
  Closes assumption A2 and risk R7 of TASK_2026_443_40ec. All phase 2 timings came from
  node:sqlite, so the batch size of 100 is not yet measured on the shipped better-sqlite3 binding.
depends_on: []
created: 2026-09-16T01:00:00.000Z
updated: 2026-11-07T00:00:00.000Z
parent: TASK_2026_635_5ea5
labels:
  - P3
relates_to:
  - TASK_2026_481_7b0f
---

## Description

Run the Electron dev build against a temp copy of a large database, leave it idle past the 10-minute
boot deferral, and read the per-batch debug durations the retention run logs. Compare against the
Task 10.3 targets: delete and evict batches at most 120 ms max and 100 ms p95, archive p95 at most
100 ms. Report whether 100 is right for the shipped binding, and whether adaptive halving triggers.
Never open `~/.ptah/state/ptah.sqlite` or a `ptah.pre-migration-*.sqlite` file; copy first, with a name
that does not start with "ptah". Source: `TASK_2026_443_40ec/test-report.md` and its residual list.

## Current state (2026-11-07)

- The batch size is 100 (`libs/backend/memory-curator/src/lib/retention/memory-retention-config.ts:75`).
  The minimum after halving is 50 (`:83`).
- The boot deferral is 10 minutes (`memory-retention-config.ts:102`).
- Slow batches log `retention batch slow; halved` at debug level
  (`libs/backend/memory-curator/src/lib/retention/retention-run-budget.ts:150`).
- No field measurement on the Electron binding is on record. The work is still open.
