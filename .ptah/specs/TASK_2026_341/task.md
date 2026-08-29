---
id: TASK_2026_341
status: done
type: BUGFIX
title: Stop SDK query() launch from blocking the Electron main thread for ~1.6s
depends_on: []
created: '2026-08-28T18:54:51.917Z'
updated: '2026-08-29T02:09:59.493Z'
description: >-
  Every SdkQueryRunner/SessionLifecycle query() launch is followed by an
  event-loop lag equal to the launch time (~1600ms) — tmp/logs/log.log:693/698,
  951/952, 1018/1019, 1068/1071, 1087/1097, 1361/1362, 1378/1381, 1406/1409,
  1422/1425, 1438/1439. Boot fires it ten times. Find the synchronous work
  (spawn, sync module load, sync fs) and move it off the main thread or make it
  async; add an event-loop-lag assertion around query launch.
executor: backend-developer
estimate: L
labels:
  - performance
  - electron
  - agent-sdk
  - log-audit-2026-08-28
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

Every SdkQueryRunner/SessionLifecycle query() launch is followed by an event-loop lag equal to the launch time (~1600ms) — tmp/logs/log.log:693/698, 951/952, 1018/1019, 1068/1071, 1087/1097, 1361/1362, 1378/1381, 1406/1409, 1422/1425, 1438/1439. Boot fires it ten times. Find the synchronous work (spawn, sync module load, sync fs) and move it off the main thread or make it async; add an event-loop-lag assertion around query launch.

Full context, plan and discussion live in [./context.md](./context.md).
