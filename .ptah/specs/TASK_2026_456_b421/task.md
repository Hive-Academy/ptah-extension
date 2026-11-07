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
updated: 2026-11-07T00:00:00.000Z
---

## Description

The three specs:

- `libs/backend/platform-core/src/file-settings-manager.bench.spec.ts` (R-TL8). Its 1 000 real
  atomic writes run under a 30 s Jest timeout (`:72`).
- `libs/backend/memory-curator/src/lib/triggers/boot-scan-runner.spec.ts:282`, the case
  "aborts mid-scan when AbortSignal triggers" (R-TL11).
- `libs/backend/rpc-handlers/src/lib/skills-sh/skills-sh-source-root.service.spec.ts` (R-TL12, a 15 s
  timeout observed on CI and locally).

For each one, find why it is timing-sensitive and fix the cause, rather than only raising the timeout.
Prove the fix by running its project beside another heavy project twice, through `npm run verify`
(for example `npm run verify -- -t test -p A,B`), not a raw `--parallel` run. Related:
`TASK_2026_450_8383` covers the separate `platform-electron` watcher stress flake.

## Current state (2026-11-07)

- The bench spec already uses a head/tail ratio check instead of a wall-clock bound
  (`file-settings-manager.bench.spec.ts:123-134`, from `f80fa299c`, before this task). A timeout
  under load can still happen, because the 1 000 writes hit the real disk.
- The skills.sh spec only raised its timeout: `jest.setTimeout(30_000)` at `:147`, `:537`, `:699`
  and `:865` (`5dc8c2dfa`). The cause is not fixed.
- `boot-scan-runner.ts` changed on 2026-10-07 (`4535e0b74`, `9724c2525`, `9ec626df3`). None of
  these commits says it fixes the abort-case timing.
- Not re-measured after these changes. A fresh parallel run decides whether each flake is still
  real.
