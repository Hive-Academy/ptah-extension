---
id: TASK_2026_415
status: backlog
type: BUGFIX
title: "Single-flight the boot readiness pull and make the harness target reads async"
depends_on: []
created: '2026-09-10T16:16:02.872Z'
updated: 2026-11-07T00:00:00.000Z
description: >-
  Worker-backed state storage already fixed the startup freeze. Two items remain: a
  single-flight guard on `BootStatusService.pullReadiness`, and async reads in place of the
  sync `fs` calls in harness-sync `claude-target.ts` and `workspace-target.ts`.
executor: ollama cloud
estimate: M
labels:
  - partial
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

Trace repeated boot:getReadiness timeouts and reported initial-load UI freeze, identify the cause and define a regression-tested fix independent of compaction.

Full context, plan and discussion live in [./context.md](./context.md).

## Description

The root cause (main-thread starvation from full `workspace-state.json` writes) is fixed.
Remaining work:

1. Single-flight guard: `pullReadiness`
   (`libs/frontend/core/src/lib/services/boot-status.service.ts:246`) is called from :202 and
   from the watchdog at :336 with no in-flight guard. Add a `pullInFlight` promise so
   overlapping pulls share one `boot:getReadiness` call. Add a spec.
2. Async target reads in `libs/backend/harness-sync/src/lib/targets/`:
   - `claude-target.ts:20` imports `existsSync`, `lstatSync`, `readdirSync`, `readFileSync`
     (used at :598, :654, :669, :713-717).
   - `workspace-target.ts:32` imports the same (used at :484, :546, :700, :784, :855).
   Replace them with `fs/promises`. The plan gates this behind a profile check; measure first.

## Current state (2026-11-07)

- Done elsewhere: worker-backed state storage (TASK_2026_411 `122770d90`, `a9f2fd97d`;
  TASK_2026_430_83a2 `2a365495c`). This task has no commits of its own.
- Not done: both items above.
