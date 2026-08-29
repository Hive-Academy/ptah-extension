---
id: TASK_2026_353
status: in_review
type: BUGFIX
title: 'Cache session/model lookups: config:models-list 7s x6, chat:resume 9s, session:list 3.5s, repeated findSessionsDirectory scans'
depends_on: []
created: '2026-08-28T18:55:42.739Z'
updated: '2026-08-28T18:55:42.739Z'
description: 'config:models-list first call took 7096ms (SDK supportedModels spawn, log.log:753) and is called six times per boot; chat:resume took 5675ms and 9332ms for a 281-event JSONL (log.log:846,856); session:list 3542ms (log.log:760); [JsonlReader] findSessionsDirectory rescans the same 18-dir projects folder ~20 times (log.log:674-682,768,770,834,844,...). Cache the model list for the auth-method lifetime, cache the sessions-directory resolution per workspace, and stream/parse the JSONL once per resume with a parsed-history cache keyed on file mtime.'
executor: backend-developer
estimate: M
labels:
  - performance
  - agent-sdk
  - rpc-handlers
  - sessions
  - log-audit-2026-08-28
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

config:models-list first call took 7096ms (SDK supportedModels spawn, log.log:753) and is called six times per boot; chat:resume took 5675ms and 9332ms for a 281-event JSONL (log.log:846,856); session:list 3542ms (log.log:760); [JsonlReader] findSessionsDirectory rescans the same 18-dir projects folder ~20 times (log.log:674-682,768,770,834,844,...). Cache the model list for the auth-method lifetime, cache the sessions-directory resolution per workspace, and stream/parse the JSONL once per resume with a parsed-history cache keyed on file mtime.

Full context, plan and discussion live in [./context.md](./context.md).
