---
status: in_review
type: BUGFIX
title: >-
  Nobody has ever SEEN the glyph-margin hunk markers -- visual claim
  unverified in any live host
description: >-
  Sizing, colours and the color-mix fallbacks for the glyph-margin hunk
  markers are asserted only as class names in jsdom; whether a marker is
  visible and legible in light, dark and high-contrast themes is unverified
  by anyone. Same root cause as item 12 (TASK_2026_218) -- no live host was
  reachable in any TASK_2026_173 Batch 8 pass. Register item 16 from
  TASK_2026_173 Batch 9. Verify in the same Electron smoke as item 12.
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
