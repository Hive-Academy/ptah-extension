---
id: TASK_2026_440_834c
status: in_progress
type: FEATURE
title: 'Thoth phase 1: stop database growth with a scheduled retention job'
description: >-
  Phase 1 of TASK_2026_439_1310. The live DB is 1.28 GB and 80 percent of it is
  processed observation_queue rows that nothing deletes (purgeOlderThan has no
  production caller). Add one scheduled, bounded, idle-gated retention job that
  purges processed observations after 7 days and quarantines stuck unprocessed
  rows, cut pre-migration backup rotation from 3 to 1, reclaim pages without a
  boot-path VACUUM, and show storage numbers in diagnostics. Ships with a
  reachability proof that the job is registered and actually deletes rows.
depends_on: []
created: 2026-09-14T15:05:00.000Z
updated: 2026-09-14T15:05:00.000Z
---

## Description

Requirements come from section A of `verdict.md` in this folder. See `context.md`.
