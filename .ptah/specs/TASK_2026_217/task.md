---
status: backlog
type: BUGFIX
title: >-
  Flaky perf assertion in CI -- "perf M2 scaling -- directory indicator
  lookup (B3 AC2)"
description: >-
  Failed once during TASK_2026_173 Batch 7 with "Expected: < 3 / Received:
  23.89" and passed on three subsequent runs; the reviewer hit the identical
  flake independently in Round 1 while running a different experiment. A
  wall-clock threshold measuring GC/timing noise on a shared runner, in
  Batch 3's work, unrelated to Batch 7 -- filed, not fixed. A test that fails
  at random trains everyone to re-run rather than read the failure, which is
  precisely how a genuine B3 regression would get waved through. Register
  item 11 from TASK_2026_173 Batch 9.
assignee:
depends_on: []
executor:
claim:
created: 2026-08-10T00:00:00.000Z
updated: 2026-08-10T00:00:00.000Z
---

## Description

See `context.md`. **Severity**: MODERATE. Known one-line fix: replace the absolute bound with a
scaling-ratio assertion.
