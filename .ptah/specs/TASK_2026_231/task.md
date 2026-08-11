---
id: TASK_2026_231
status: in_review
type: BUGFIX
title: >-
  perf-m1-diff-redisplay spec fails waiting for a diff tab that never opens
description: >-
  apps/ptah-electron-e2e/src/specs/editor/perf-m1-diff-redisplay.spec.ts fails
  waiting for a diff tab that never appears. Confirmed pre-existing on
  ak/license-server-validation-pipe by the TASK_2026_222 agent, which reverted
  both of its changed lib files to HEAD, rebuilt, and reproduced the identical
  failure. Re-encountered and skipped by TASK_2026_227 and TASK_2026_229 on
  explicit instruction, so three tasks in a row have routed around it. It is a
  perf-measurement spec, so a failure here means the M1 diff-redisplay budget
  is currently unmeasured -- the same class of gap TASK_2026_218 existed to
  close for the hunk-apply path. Whether the tab genuinely fails to open or
  the spec's wait condition has drifted from the current UI is unknown.
assignee:
depends_on: []
executor:
claim:
created: 2026-08-11T00:00:00.000Z
updated: 2026-08-11T00:00:00.000Z
---

## Description

Machine-owned metadata carrier. Prose lives in `./context.md`.
