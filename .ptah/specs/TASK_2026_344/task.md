---
id: TASK_2026_344
status: in_review
type: BUGFIX
title: Cache WorkspaceFileIndex across workspace switches and take the walk off the main thread
depends_on: []
created: '2026-08-28T18:55:03.911Z'
updated: '2026-08-28T18:55:03.911Z'
description: 'Every workspace:switch re-walks the full tree: property-hub 15249 files/4935 dirs took 14826ms, 9969ms, 8626ms (log.log:1346,1835,2165); qa3elhamor 7657ms then 2.5-4s. The walk emits 400-550ms event-loop lags (log.log:1347-1350,1836-1840,2166-2169), so it does sync work on the main thread. Keep one index per open folder, reuse it on switch (invalidate via the existing watchers), and make the walk incremental/async with yielding.'
executor: backend-developer
estimate: L
labels:
  - performance
  - workspace-intelligence
  - electron
  - log-audit-2026-08-28
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

Every workspace:switch re-walks the full tree: property-hub 15249 files/4935 dirs took 14826ms, 9969ms, 8626ms (log.log:1346,1835,2165); qa3elhamor 7657ms then 2.5-4s. The walk emits 400-550ms event-loop lags (log.log:1347-1350,1836-1840,2166-2169), so it does sync work on the main thread. Keep one index per open folder, reuse it on switch (invalidate via the existing watchers), and make the walk incremental/async with yielding.

Full context, plan and discussion live in [./context.md](./context.md).
