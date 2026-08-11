---
status: cancelled
type: BUGFIX
title: >-
  aria-required-children ownership violation on role="tablist" -- INTRODUCED
  by Batch 6, ACCEPTED BY USER DECISION 2026-08-10
description: >-
  De-nesting the tab close button onto a role="presentation" wrapper (fixing
  a nested-interactive defect) makes axe descend through the wrapper, which
  re-parents the close button onto the tablist; ARIA permits only role=tab as
  an owned element. This trades one critical axe violation for another. The
  user ruled the trade favourable on 2026-08-10 and instructed that the
  tablist/tab shape be kept as-is. Register item 4 from TASK_2026_173 Batch 9
  -- settled, do not re-litigate.
assignee:
depends_on: []
executor:
claim:
created: 2026-08-10T00:00:00.000Z
updated: 2026-08-10T00:00:00.000Z
---

## Description

See `context.md`. **Severity**: MODERATE. **Do not propose `role="toolbar"` + `aria-current`,
`aria-owns`, or hoisting the buttons -- all three were evaluated and ruled out.**
