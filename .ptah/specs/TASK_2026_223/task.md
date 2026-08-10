---
status: backlog
type: BUGFIX
title: >-
  A glyph click landing mid-await inside runApply is guarded but not tested
description: >-
  applyInFlight guards a glyph click landing mid-await inside runApply
  structurally, and the token binding covers the refresh-then-click
  ordering, but only that ordering has a test; the click-during-RPC ordering
  has none. An untested guard is exactly the shape both TASK_2026_173 Batch
  7's regression guard and 8A's guard 6 proved can be vacuous. Register item
  17 from TASK_2026_173 Batch 9. Known one-line fix (one new test).
assignee:
depends_on: []
executor:
claim:
created: 2026-08-10T00:00:00.000Z
updated: 2026-08-10T00:00:00.000Z
---

## Description

See `context.md`. **Severity**: LOW. Known one-line fix -- add one coordinator test.
