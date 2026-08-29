---
id: TASK_2026_342
status: in_review
type: BUGFIX
title: 'Cache and dedupe auth:getAuthStatus (14 calls at 2-5s each) and fix codexTokenStale contradiction'
depends_on: []
created: '2026-08-28T18:54:56.217Z'
updated: '2026-08-28T18:54:56.217Z'
description: 'auth:getAuthStatus is invoked 14 times during boot and workspace switches, 2-5.3s each, with an unchanging result (log.log:696,800,801,832,1190,1614,1791,1959,2043,2245,2251); up to three calls run concurrently. Add in-flight dedupe plus a short TTL cache invalidated on auth changes, and reduce frontend callers. Also resolve the contradiction where CliDetection reports "codex credential refresh: fresh" (log.log:911) while every later status still reports codexTokenStale:true (log.log:1006,1188,2244).'
executor: backend-developer
estimate: M
labels:
  - performance
  - rpc-handlers
  - auth
  - log-audit-2026-08-28
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

auth:getAuthStatus is invoked 14 times during boot and workspace switches, 2-5.3s each, with an unchanging result (log.log:696,800,801,832,1190,1614,1791,1959,2043,2245,2251); up to three calls run concurrently. Add in-flight dedupe plus a short TTL cache invalidated on auth changes, and reduce frontend callers. Also resolve the contradiction where CliDetection reports "codex credential refresh: fresh" (log.log:911) while every later status still reports codexTokenStale:true (log.log:1006,1188,2244).

Full context, plan and discussion live in [./context.md](./context.md).
