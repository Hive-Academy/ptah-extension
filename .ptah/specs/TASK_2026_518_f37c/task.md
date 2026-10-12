---
status: cancelled
type: bugfix
title: Fix four type errors hidden by isolatedModules in memory-curator-ui specs
description: >-
  Four type errors sit in two memory-curator-ui spec files. The UI Jest configuration uses isolatedModules, so the suite passes while the errors remain. A passing test that never type-checks is a false green.
duplicates:
  - TASK_2026_642_fb22
updated: '2026-10-12T19:41:51.738Z'
---

# TASK_2026_518 — Type errors hidden by isolatedModules

Found during TASK_2026_511 while reading diagnostics. Prose: `context.md`.
