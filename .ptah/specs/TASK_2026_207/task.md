---
status: in_review
type: DEVOPS
title: >-
  No drift detection between workspace-scan.constants.ts and the M3 perf
  harness's hand-maintained IGNORED_DIRS copy
description: >-
  perf-m3-watcher-churn.script.mjs hand-maintains its own copy of the
  workspace exclusion list because the .mjs harness cannot import the TS
  shared constant without dragging itself into the build graph and forfeiting
  the "zero product-code change" property that makes the M3 before/after
  numbers comparable. That copy is justified but has no automated safeguard
  today beyond a comment banner. Register item 1 from TASK_2026_173 Batch 9,
  raised during Batch 5 review.
assignee:
depends_on: []
executor:
claim:
created: 2026-08-10T00:00:00.000Z
updated: 2026-08-10T00:00:00.000Z
---

## Description

See `context.md`. **Severity**: MODERATE. Tooling-only: drift corrupts a future measurement, never
production behaviour.
