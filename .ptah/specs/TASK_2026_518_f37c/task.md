---
status: backlog
type: bugfix
title: Fix four type errors hidden by isolatedModules in memory-curator-ui specs
description: >-
  Four type errors sit in two memory-curator-ui spec files. The UI Jest
  configuration uses isolatedModules, so the suite passes while the errors
  remain. A passing test that never type-checks is a false green.
---

# TASK_2026_518 — Type errors hidden by isolatedModules

Found during TASK_2026_511 while reading diagnostics. Prose: `context.md`.
