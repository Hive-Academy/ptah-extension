---
id: TASK_2026_227
status: done
type: BUGFIX
title: >-
  Hunk revert confirmation dialog is unclickable by mouse in Electron -- canvas
  paints over the modal
description: >-
  The revert confirmation dialog at diff-view.component.ts:491 uses
  `class="modal modal-open z-50"`. z-50 is resolved inside whatever stacking
  context an ancestor establishes, not against the app root, so in the
  Electron grid layout the canvas panel paints on top of it -- the captured
  failure screenshot shows "Orchestra Canvas" legible THROUGH the modal box --
  and the canvas empty-state text intercepts pointer events on both Cancel and
  Discard. Keyboard dismissal (Escape, Tab) still works, which is exactly why
  every jsdom spec passes and why this survived Batch 8B review. Predates
  TASK_2026_221; found while mouse-testing the new floating hunk widget's
  Discard path in a live Electron host. A destructive-action confirmation that
  a mouse user cannot answer is the failure mode that matters here.
assignee:
depends_on: []
executor:
claim:
created: 2026-08-11T00:00:00.000Z
updated: 2026-08-11T00:00:00.000Z
---

## Description

Machine-owned metadata carrier. Prose lives in `./context.md`.
