---
status: in_review
type: REFACTORING
title: >-
  Editor-panel resize handles would benefit from pointer capture hardening
description: >-
  The three editor-panel resize handles (sidebar, terminal, split) do not use
  pointer capture. Adding it would make the double-mousedown drag re-entry
  case structurally impossible rather than merely benign. TASK_2026_173
  Batch 4's reviewer ruled no action needed -- the post-refactor code is
  strictly safer than the pre-refactor behaviour (which registered two
  racing listener quartets) -- so this is a hardening improvement, not a
  defect fix. Register item 3 from TASK_2026_173 Batch 9.
assignee:
depends_on: []
executor:
claim:
created: 2026-08-10T00:00:00.000Z
updated: 2026-08-10T00:00:00.000Z
---

## Description

See `context.md`. **Severity**: LOW. Hardening improvement, not a defect fix.
