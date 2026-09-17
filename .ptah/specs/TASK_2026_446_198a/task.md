---
id: TASK_2026_446_198a
status: done
type: REFACTORING
title: Exclude test-support files from the memory-curator lib build
description: >-
  Follow-up from TASK_2026_440_834c. libs/backend/memory-curator/tsconfig.lib.json has
  no src/**/*.test-support.ts exclude (skill-synthesis has one), so
  retention-sqlite.test-support.ts compiles into the lib build.
depends_on: [TASK_2026_440_834c]
created: 2026-09-15T16:10:00.000Z
updated: 2026-09-15T16:10:00.000Z
---

## Description

Add the `src/**/*.test-support.ts` exclude to `libs/backend/memory-curator/tsconfig.lib.json`, matching
skill-synthesis. Source: `TASK_2026_440_834c/batch-3-report.md` out-of-scope observations.

Note: TASK_2026_443_40ec (phase 2) may touch memory-curator test support. If phase 2 adds this exclude,
close this task as done there.
