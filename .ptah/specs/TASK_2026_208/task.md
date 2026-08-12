---
status: done
type: DOCUMENTATION
title: >-
  Pre-existing B4 AC4 asymmetry between explicit-rootPath enumeration and
  navigation-from-root is undocumented
description: >-
  An explicitly-targeted ignored directory is enumerable via
  editor:getFileTree with an explicit rootPath and openable via
  handleFileOpen (which applies no exclusion filter at all), even though the
  same directory is unreachable by navigation from the workspace root.
  Confirmed byte-identical to HEAD before and after TASK_2026_173 Batch 5, so
  genuinely pre-existing and untouched. Arguably correct "user asked for it
  explicitly" behaviour, but written down nowhere. Register item 2 from
  TASK_2026_173 Batch 9.
assignee:
depends_on: []
executor:
claim:
created: 2026-08-10T00:00:00.000Z
updated: 2026-08-10T00:00:00.000Z
---

## Description

See `context.md`. **Severity**: LOW. File as documentation, not as a bug, unless a decision is taken
to change the behaviour.
