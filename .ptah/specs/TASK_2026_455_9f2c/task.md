---
id: TASK_2026_455_9f2c
status: backlog
type: RESEARCH
title: >-
  Measure the memory retention batch timings on the Electron better-sqlite3 binding
description: >-
  Closes assumption A2 and risk R7 of TASK_2026_443_40ec. Every phase 2 timing
  number comes from node:sqlite, because the repository better-sqlite3 binary is
  built for the Electron ABI. The delete batch size was lowered from 200 to 100
  on those numbers, so the shipped binding is still unmeasured in the field.
depends_on: [TASK_2026_443_40ec]
created: 2026-09-16T01:00:00.000Z
updated: 2026-09-16T01:00:00.000Z
---

## Description

Run the Electron dev build against a temp copy of a large database, leave it idle past the 10-minute
boot deferral, and read the per-batch debug durations the retention run logs. Compare against the
Task 10.3 targets: delete and evict batches at most 120 ms max and 100 ms p95, archive p95 at most
100 ms. Report whether 100 is right for the shipped binding, and whether adaptive halving triggers.
Never open `~/.ptah/state/ptah.sqlite` or a `ptah.pre-migration-*.sqlite` file; copy first, with a name
that does not start with "ptah". Source: `TASK_2026_443_40ec/test-report.md` and its residual list.
