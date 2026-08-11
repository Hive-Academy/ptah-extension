---
status: in_review
type: FEATURE
title: >-
  No in-editor floating hunk action widget -- mouse ergonomics only, flagged
  rather than rounded up
description: >-
  Task 8.5 of TASK_2026_173 asked for glyph-margin decorations plus an
  overlay widget anchored at modifiedStart. 8B built the decorations and the
  roving-tabindex keyboard toolbar but not the floating button cluster:
  Monaco's line-anchored primitive is a content widget (overlay widgets are
  fixed-position), an interactive one sits in DOM Angular does not manage,
  and 8B could not run the app to verify it. Every stated criterion is met
  without it. What is lost: a mouse user clicks the glyph to select, then
  acts in the header, rather than acting at the hunk. Register item 15 from
  TASK_2026_173 Batch 9. Verify in the same Electron smoke as item 12
  (TASK_2026_218).
assignee:
depends_on:
  - TASK_2026_218
executor:
claim:
created: 2026-08-10T00:00:00.000Z
updated: 2026-08-10T00:00:00.000Z
---

## Description

See `context.md`. **Severity**: LOW. Depends on the Electron smoke infrastructure filed as item 12
(`TASK_2026_218`).
