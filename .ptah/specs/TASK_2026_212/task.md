---
status: done
type: REFACTORING
title: >-
  closeSplit's stopPropagation() is the last live leftover stopPropagation
  in editor-panel.component.ts
description: >-
  closeSplit's event.stopPropagation() was held out of both Batch 6's and
  Batch 7's scope of TASK_2026_173 by explicit instruction and confirmed
  untouched across both rounds (reviewer verified it sits outside every diff
  hunk). It reads as an obvious leftover ten lines from where Batch 7
  worked -- exactly why it needs a record rather than an opportunistic fix.
  The close button is already a sibling of the pane container after Batch
  6's de-nesting, so nothing depends on the suppression. Register item 6
  from TASK_2026_173 Batch 9. Known one-line fix.
assignee:
depends_on: []
executor:
claim:
created: 2026-08-10T00:00:00.000Z
updated: 2026-08-10T00:00:00.000Z
---

## Description

See `context.md`. **Severity**: LOW. Known one-line fix; held out of two consecutive batches by
explicit instruction.
