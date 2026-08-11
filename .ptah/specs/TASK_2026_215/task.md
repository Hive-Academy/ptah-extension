---
status: done
type: DEVOPS
title: >-
  axe-core is not a declared dependency, so dialog accessibility relies on
  reviewers remembering to scan
description: >-
  Both TASK_2026_173 Batch 6 and Batch 7 proved their accessibility claims
  with axe-core@4.12.1 reached transitively through @axe-core/playwright, via
  temporary specs deleted immediately after. A permanent spec importing it
  today would break silently on a dependency bump, and declaring it means
  editing package.json -- outside the libs/frontend/editor/** constraint both
  batches worked under. Register item 9 from TASK_2026_173 Batch 9.
assignee:
depends_on: []
executor:
claim:
created: 2026-08-10T00:00:00.000Z
updated: 2026-08-10T00:00:00.000Z
---

## Description

See `context.md`. **Severity**: MODERATE. Note the standing limit: axe has no automated rule for focus
trapping, so behavioural tests remain necessary alongside it.
