---
status: backlog
type: FEATURE
title: >-
  No dedicated affordance signals when split panes hold divergent content
  after a save-conflict Cancel
description: >-
  After Cancel on the save-conflict dialog, the two split panes knowingly
  hold different content, and the only cue is the generic tab-strip dirty
  dot -- ambiguous between "this pane has unsaved edits" and "the other pane
  disagrees with what you are looking at". Not data loss (Cancel writes
  nothing and any subsequent save re-prompts), so defensible as shipped, but
  not unambiguous. Register item 8 from TASK_2026_173 Batch 9.
assignee:
depends_on: []
executor:
claim:
created: 2026-08-10T00:00:00.000Z
updated: 2026-08-10T00:00:00.000Z
---

## Description

See `context.md`. **Severity**: MODERATE. Known one-line fix.
