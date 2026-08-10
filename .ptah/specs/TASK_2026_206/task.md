---
status: backlog
type: BUGFIX
title: >-
  editor:searchInFiles and editor:listAllFiles glob exclusion lists have
  already drifted from TREE_HIDDEN_DIRS
description: >-
  Two hand-maintained glob exclusion lists in editor-rpc.handlers.ts, one
  serving editor:searchInFiles and one serving editor:listAllFiles, carry
  only 5 of TREE_HIDDEN_DIRS' current 11 member names and are already
  drifted from the canonical exclusion set in
  libs/shared/src/lib/constants/workspace-scan.constants.ts. B4 AC2's
  "single source of truth" claim (TASK_2026_173 Batch 5) is true of the
  predicate mechanism, which is what that batch's Option B scoped -- it is
  not true of every exclusion decision in this file.
assignee:
depends_on: []
executor:
claim:
created: 2026-08-10T00:00:00.000Z
updated: 2026-08-10T00:00:00.000Z
---

## Description

See `context.md` for the exact locations, the current vs. canonical list comparison, and the fix.
