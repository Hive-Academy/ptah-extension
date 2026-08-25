---
status: done
type: BUGFIX
title: >-
  Empty-state role="list" ownership violation in SourceControlPanelComponent
  -- confirmed live critical axe defect
description: >-
  When a source-control section has zero files, SourceControlPanelComponent
  renders a plain div ("No staged changes" / "No changes") inside a
  role="list" region. Not hypothetical: the reviewer ran axe-core over the
  exact empty-state markup and reproduced a live critical
  aria-required-children violation on both branches, today. Hits the common
  case, since most working trees have nothing staged. Genuinely pre-existing
  and correctly excluded from Batch 6's scope (the empty-state lines fall
  outside every hunk in that diff). Register item 5 from TASK_2026_173
  Batch 9. Known one-line fix.
assignee:
depends_on: []
executor:
claim:
created: 2026-08-10T00:00:00.000Z
updated: 2026-08-10T00:00:00.000Z
---

## Description

See `context.md`. **Severity**: MODERATE. Confirmed defect, known one-line fix, hits the common case.
