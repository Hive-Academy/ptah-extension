---
id: TASK_2026_343
status: done
type: BUGFIX
title: >-
  Make git RPC handlers fast on large repos and stop triple git:branches
  requests per switch
depends_on: []
created: '2026-08-28T18:54:59.687Z'
updated: '2026-08-29T02:09:59.578Z'
description: >-
  On property-hub (15k files) git:branches takes 4-11.7s
  (log.log:1252,1339,1352,1390,1397,1828,1839,2158,2171),
  git:info/stashList/lastCommit ~2.1s each, and the frontend requests
  git:branches three times per workspace switch (log.log:1253,1340,1391).
  Profile the git commands used, remove per-branch subprocess fan-out, coalesce
  concurrent identical requests, and make the editor lib request branch data
  once per switch.
executor: backend-developer
estimate: M
labels:
  - performance
  - git
  - rpc-handlers
  - frontend-editor
  - log-audit-2026-08-28
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

On property-hub (15k files) git:branches takes 4-11.7s (log.log:1252,1339,1352,1390,1397,1828,1839,2158,2171), git:info/stashList/lastCommit ~2.1s each, and the frontend requests git:branches three times per workspace switch (log.log:1253,1340,1391). Profile the git commands used, remove per-branch subprocess fan-out, coalesce concurrent identical requests, and make the editor lib request branch data once per switch.

Full context, plan and discussion live in [./context.md](./context.md).
