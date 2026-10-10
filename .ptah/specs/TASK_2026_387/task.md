---
id: TASK_2026_387
status: done
type: refactoring
title: Fluid canvas grid with intent-driven tile layout
description: >-
  Replace the fixed pixel breakpoints and coordinate-only tile model in
  libs/frontend/canvas with a fluid layout: columns from a minimum tile width,
  remainder rows fill the width, compaction after drag and close, and a
  weight-based tile model where drag means reorder and resize means weight.
updated: '2026-10-10T18:19:14.559Z'
---

See context.md for intent and implementation-plan.md for the design.
