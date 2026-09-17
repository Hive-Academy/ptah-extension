---
id: TASK_2026_442_68ba
status: done
type: FEATURE
title: Fluid, user-driven canvas tile spans beyond the fixed 1/2/3 column caps
depends_on: []
created: '2026-09-14T14:00:00.000Z'
updated: '2026-09-14T14:00:00.000Z'
description: >-
  The canvas layout dock only offers a global "max tiles per row" cap of 1, 2
  or 3, applied to every row of the workspace. Users cannot say "this session
  takes the full width, these two share the next row, this one takes two thirds
  next to a narrow one". Elevate canvas tiles so each session carries its own
  span preference (third / half / two-thirds / full, or free resize), rows mix
  spans, tiles can be focused or expanded in place, and the layout is
  persisted per workspace, while the responsive column capacity still protects
  the minimum readable tile width.
executor: software-architect
estimate: L
labels:
  - canvas
  - ux
  - layout
relates_to:
  - TASK_2026_387
  - TASK_2026_404_6fcd
  - TASK_2026_416_2060
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

Per-tile span preferences and fluid, interactive multi-session layouts for the Orchestra Canvas.

Full context, plan and discussion live in [./context.md](./context.md).
