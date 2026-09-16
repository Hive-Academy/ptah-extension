---
id: TASK_2026_456_b421
status: backlog
type: BUGFIX
title: Stabilize three load-sensitive specs that fail only under parallel runs
description: >-
  Recorded as R-TL8, R-TL11 and R-TL12 during TASK_2026_443_40ec. Three specs
  fail on a timeout only when several projects run together, and pass on a rerun
  or with --parallel=1, so they can block any PR that touches their projects.
depends_on: []
created: 2026-09-16T01:00:00.000Z
updated: 2026-09-16T01:00:00.000Z
---

## Description

The three specs:

- `libs/backend/platform-core/.../file-settings-manager.bench.spec.ts` (R-TL8).
- `libs/backend/memory-curator/.../boot-scan-runner` abort case (R-TL11).
- `libs/backend/rpc-handlers/.../skills-sh/skills-sh-source-root.service.spec.ts` (R-TL12, a 15 s
  timeout observed on CI and locally).

For each one, find why it is timing-sensitive and fix the cause, rather than only raising the timeout.
Prove the fix by running its project beside another heavy project with `--parallel=2` twice. Related:
`TASK_2026_450_8383` covers the separate `platform-electron` watcher stress flake.
