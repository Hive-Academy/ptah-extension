---
id: TASK_2026_345
status: done
type: BUGFIX
title: >-
  Run user-layer mirror, reconcile and skill catalog sync once per workspace
  switch, not 2-4 times
depends_on: []
created: '2026-08-28T18:55:08.152Z'
updated: '2026-08-29T02:56:42.916Z'
description: >-
  One switch to property-hub ran skill_registry catalog sync 4 times,
  UserLayerMirror reconcile twice and mirrorAll twice (log.log:1206-1223); the
  first qa3elhamor switch synced the catalog 3 times (log.log:861-896). The
  frontend also requests plugins:get-config + plugins:list-available in
  duplicate pairs per view (log.log:978-993,1907-1924,1949-1968) and
  config:models-list 6 times. Identify the multiple triggers (activation,
  workspace-folders-changed, content-download-complete, addFolder+switch) and
  coalesce them into one debounced run per switch; dedupe the frontend requests.
executor: backend-developer
estimate: M
labels:
  - performance
  - electron
  - agent-generation
  - skill-synthesis
  - frontend
  - log-audit-2026-08-28
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

One switch to property-hub ran skill_registry catalog sync 4 times, UserLayerMirror reconcile twice and mirrorAll twice (log.log:1206-1223); the first qa3elhamor switch synced the catalog 3 times (log.log:861-896). The frontend also requests plugins:get-config + plugins:list-available in duplicate pairs per view (log.log:978-993,1907-1924,1949-1968) and config:models-list 6 times. Identify the multiple triggers (activation, workspace-folders-changed, content-download-complete, addFolder+switch) and coalesce them into one debounced run per switch; dedupe the frontend requests.

Full context, plan and discussion live in [./context.md](./context.md).
