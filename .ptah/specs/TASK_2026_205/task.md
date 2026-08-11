---
status: in_review
type: BUGFIX
title: >-
  Submodule paths surface as the generic "unknown" git-read error code
  instead of a submodule-specific one
description: >-
  A submodule path fails git-read classification into the generic `unknown`
  GitReadErrorCode rather than a dedicated `submodule`/`gitlink` code, even
  though the classification already has the exact signal it needs to
  distinguish this case (a `git show` exit-128 paired with a `rev-parse
  --verify` exit-0). Same non-blocking shape as the directory-row finding
  (TASK_2026_204): correct, safe behaviour, less specific message than ideal.
  Discovered during TASK_2026_173's R-3 triage and filed rather than fixed,
  per that task's NFR-9 scope discipline.
assignee:
depends_on: []
executor:
claim:
created: 2026-08-10T00:00:00.000Z
updated: 2026-08-10T00:00:00.000Z
---

## Description

See `context.md` for the full finding and the fix.

**Severity**: LOW. Correct, safe behaviour with a less specific message than ideal.
