---
id: TASK_2026_387
status: in_review
type: refactoring
title: Fluid canvas grid with intent-driven tile layout
description: >-
  Replace the fixed pixel breakpoints and coordinate-only tile model in
  libs/frontend/canvas with a fluid layout: columns from a minimum tile width,
  remainder rows fill the width, compaction after drag and close, and a
  weight-based tile model where drag means reorder and resize means weight.
---

See context.md for intent and implementation-plan.md for the design.
