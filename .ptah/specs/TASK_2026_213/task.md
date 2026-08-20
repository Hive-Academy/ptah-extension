---
status: done
type: BUGFIX
title: >-
  Pre-existing right-pane self-echo in updateSplitContent
description: >-
  updateSplitContent's first line still sets splitFileContent from the right
  pane's own contentChanged -- the same self-referential shape as Task 7.2's
  hazard in TASK_2026_173, just un-debounced and pre-existing. Confirmed by
  diff as byte-identical to HEAD; masked today by last-write-wins signal
  semantics. Removing it inside Batch 7 would have been a read-path change
  AC5 forbade. Register item 7 from TASK_2026_173 Batch 9. Genuinely a batch
  of its own, not a one-liner.
assignee:
depends_on: []
executor:
claim:
created: 2026-08-10T00:00:00.000Z
updated: 2026-08-10T00:00:00.000Z
---

## Description

See `context.md`. **Severity**: MODERATE. **Not a one-liner** -- the fix requires re-pointing two new
panel guards from Batch 7 in the same change.
