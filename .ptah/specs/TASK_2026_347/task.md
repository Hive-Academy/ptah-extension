---
id: TASK_2026_347
status: in_review
type: BUGFIX
title: 'Fix Electron boot order: voice GC, task-specs index and gateway start before SQLite is open'
depends_on: []
created: '2026-08-28T18:55:15.920Z'
updated: '2026-08-28T18:55:15.920Z'
description: '"[gateway] voice GC failed: Persistence is offline: SQLite connection has not been initialized yet" (log.log:558) fires before openAndMigrate starts (log.log:565); "[task-specs] index rebuild write skipped — store not ready yet" (log.log:549); "Messaging gateway started"/"Gateway chat bridge started" (log.log:576-578) run while migration is still in progress. Make the persistence-dependent subsystems await the SQLite ready promise (or an explicit phase gate) in apps/ptah-electron boot, and add a unit test on the ordering.'
executor: backend-developer
estimate: M
labels:
  - electron
  - boot-order
  - persistence-sqlite
  - messaging-gateway
  - task-specs
  - log-audit-2026-08-28
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

"[gateway] voice GC failed: Persistence is offline: SQLite connection has not been initialized yet" (log.log:558) fires before openAndMigrate starts (log.log:565); "[task-specs] index rebuild write skipped — store not ready yet" (log.log:549); "Messaging gateway started"/"Gateway chat bridge started" (log.log:576-578) run while migration is still in progress. Make the persistence-dependent subsystems await the SQLite ready promise (or an explicit phase gate) in apps/ptah-electron boot, and add a unit test on the ordering.

Full context, plan and discussion live in [./context.md](./context.md).
