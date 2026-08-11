---
status: done
type: BUGFIX
title: >-
  Directory rows in Source Control resolve to a generic "unknown" error
  instead of a directory-specific message
description: >-
  Clicking an untracked directory row in Source Control is clickable today and
  resolves to a correct, non-crashing, persistent error overlay, but the copy
  reads "Git could not read this file" instead of a directory-specific
  message such as "Cannot diff a directory". No data-integrity risk, no
  crash, no misrendering as content -- purely a message-specificity gap.
  Discovered as a Follow-up finding during TASK_2026_173's R-3 triage
  (A3, real-git-failure classification) and deliberately filed rather than
  fixed, per that task's NFR-9 scope discipline.
assignee:
depends_on: []
executor:
claim:
created: 2026-08-10T00:00:00.000Z
updated: 2026-08-10T00:00:00.000Z
---

## Description

See `context.md` for the full finding and the two candidate fixes.

**Severity**: LOW. Correct, safe behaviour with a less specific message than ideal.
