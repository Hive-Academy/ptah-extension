---
id: TASK_2026_450_8383
status: backlog
type: BUGFIX
title: Stabilize the workspace-watch host AC-7 stress scenario on CI
description: >-
  platform-electron workspace-watch-host.stress.spec.ts (added in 000719279,
  TASK_2026_437) failed on the ubuntu CI runner for PR 513 run 35000520860 with
  "Timed out after 15000 ms waiting for delivery to resume after recovery" in
  AC-7 repeated kills past the restart budget, then passed on a rerun of the
  same commit. Any PR that touches platform-core pulls this spec into the
  affected set, so the flake can block unrelated PRs.
depends_on: []
created: 2026-09-15T18:00:00.000Z
updated: 2026-09-15T18:00:00.000Z
---

## Description

Failing site: `libs/backend/platform-electron/src/workspace-watch/workspace-watch-host.stress.harness.ts:734`
(`runDegradedPastBudgetScenario`, `waitFor` with a 15 s deadline), called from
`workspace-watch-host.stress.spec.ts:140`. The single-kill scenario in the same run passed
(restartMs=305). Decide whether the recovery wait is too tight for a shared runner or whether recovery
after the restart budget is genuinely slow or racy; fix the cause rather than only raising the timeout.
Owner context: TASK_2026_437.
