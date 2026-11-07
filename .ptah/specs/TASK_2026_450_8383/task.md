---
id: TASK_2026_450_8383
status: backlog
type: BUGFIX
title: Stabilize the workspace-watch host AC-7 stress scenario on CI
description: >-
  The AC-7 "repeated kills past the restart budget" scenario in platform-electron
  `workspace-watch-host.stress.spec.ts` flaked on CI (PR 513). A re-probe and a derived timeout
  have since landed. Confirm it is stable, or find the slow or racy recovery behind it.
depends_on: []
created: 2026-09-15T18:00:00.000Z
updated: 2026-11-07T00:00:00.000Z
---

## Description

The original failure: "Timed out after 15000 ms waiting for delivery to resume after recovery"
on the ubuntu runner for PR 513 run 35000520860; a rerun of the same commit passed. Any PR that
touches `platform-core` pulls this spec into the affected set. Remaining work:

1. Check recent CI history for this scenario. If it has not failed since the fixes below,
   propose closing the task.
2. If it still flakes: decide whether recovery after the restart budget is slow or racy, and fix
   the cause. Do not only raise `DEGRADED_RECOVERY_LOAD_MARGIN_MS`.

Failing site today: `runDegradedPastBudgetScenario`
(`libs/backend/platform-electron/src/workspace-watch/workspace-watch-host.stress.harness.ts:789`),
timeout message at :776. Owner context: TASK_2026_437.

## Current state (2026-11-07)

- Done: `c0670a9e8` re-probes delivery after recovery and replaces the flat 15 s deadline with
  `DEGRADED_DELIVERY_TIMEOUT_MS` (recovery delay + ack window + two batch intervals + a 15 s
  load margin, `stress.harness.ts:746-751`).
- Done: `aacf99591` stops the AC-7 harness throwing on an exited pid; `7a225c06f` waits for the
  subscription ack instead of a sleep. Last change to the harness: 2026-09-20.
- Not checked: CI flake history after 2026-09-20. The 15 s margin may still be a timeout bump.
