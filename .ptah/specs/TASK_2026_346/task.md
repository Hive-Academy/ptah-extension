---
id: TASK_2026_346
status: done
type: BUGFIX
title: >-
  Stop harness-sync from removing and rewriting the inactive folder's artifacts
  on every workspace switch
depends_on: []
created: '2026-08-28T18:55:12.387Z'
updated: '2026-08-29T02:09:59.878Z'
description: >-
  Switching from property-hub back to qa3elhamor removed 44 harness artifacts
  (11 per target, log.log:1647); switching back rewrote them (log.log:1822
  expected 127). Each tab switch between two open folders tears down and
  re-materialises harness dirs across four targets. Reconcile should treat every
  open workspace folder as a scope and only remove artifacts when a folder is
  actually removed from the workspace. Also the 12-path "blocked" list for
  property-hub is emitted in full four times (log.log:1286,1290,1315,1824,2154)
  — emit once per reason change.
executor: backend-developer
estimate: M
labels:
  - harness-sync
  - electron
  - performance
  - log-audit-2026-08-28
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

Switching from property-hub back to qa3elhamor removed 44 harness artifacts (11 per target, log.log:1647); switching back rewrote them (log.log:1822 expected 127). Each tab switch between two open folders tears down and re-materialises harness dirs across four targets. Reconcile should treat every open workspace folder as a scope and only remove artifacts when a folder is actually removed from the workspace. Also the 12-path "blocked" list for property-hub is emitted in full four times (log.log:1286,1290,1315,1824,2154) — emit once per reason change.

Full context, plan and discussion live in [./context.md](./context.md).
