---
id: TASK_2026_451_3cd0
status: done
type: FEATURE
title: Let a compact canvas tile shrink and its neighbours reflow
description: >-
  Switching a canvas tile to compact view leaves its Gridstack box at full
  height (h 6, 90% viewport floor), so nothing reflows. Feed tab view mode into
  the layout projection as a derived input, add a compact height tier resolved
  in canvas-layout-intent.ts, and make the singleton rule mode-aware. Builds on
  TASK_2026_442 (PR 514).
depends_on: [TASK_2026_442_68ba]
created: 2026-09-15T19:00:00.000Z
updated: 2026-09-15T19:00:00.000Z
---

## Description

Compact view today swaps only the chat subtree inside an unchanged tile. See
`context.md` for intent and the three `compact-sizing-check-*.md` reports for
the evidence.
