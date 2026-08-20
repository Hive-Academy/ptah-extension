---
status: done
type: FEATURE
title: >-
  File tree has no windowing/virtualization for large expanded directories
description: >-
  Expanding a large directory in the editor file tree renders every node with
  no windowing. TASK_2026_173 B3 fixed the O(dirs x changed-files) directory-
  indicator scan (the sharper edge of the same problem class); this is the
  remaining, self-contained piece: virtualizing the tree pulls in its own
  keyboard-navigation, screen-reader-tree, scroll-restoration and drag-and-drop
  surface, which is why it was ruled out of TASK_2026_173's scope from the
  start. Filed with the post-B3 M2 measurement attached as justification.
assignee:
depends_on: []
executor:
claim:
created: 2026-08-10T00:00:00.000Z
updated: 2026-08-10T00:00:00.000Z
---

## Description

See `context.md` for the full M2 measurement this record's justification depends on, quoted verbatim from `TASK_2026_173/measurements.md` per that task's Batch 9 dispatch instruction (DoD item 10: "attach the actual number, not a description of it").

**Filed as LOW-priority watch item, not an urgent defect** — see `context.md` for why.
