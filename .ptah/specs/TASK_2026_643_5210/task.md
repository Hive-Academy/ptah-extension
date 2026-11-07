---
id: TASK_2026_643_5210
status: backlog
type: REFACTORING
title: >-
  Split memory.store.ts, memory-curator.service.ts and memory-trigger.service.ts under the facade
  rule
depends_on:
  - TASK_2026_454_b401
created: "2026-10-12T19:39:51.430Z"
updated: "2026-11-07T00:00:00.000Z"
description: >-
  The three files are 1041, 1051 and 1565 lines (lint max-lines 700). Extract nameable
  collaborators and keep public names, tokens and signatures. Start after TASK_2026_454 decides.
executor: backend-developer
parent: TASK_2026_638_7a8e
estimate: L
labels:
  - memory
  - P3
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

## Description

Split each file below the `max-lines` limit of 700 (`eslint.config.mjs:517`, a warning that skips
blank lines and comments):

| File | Lines (2026-11-07) |
|---|---|
| `libs/backend/memory-curator/src/lib/memory.store.ts` | 1041 |
| `libs/backend/memory-curator/src/lib/memory-curator.service.ts` | 1051 |
| `libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.ts` | 1565 |

Rules: extract nameable collaborators; keep public class names, DI tokens and method signatures.
`libs/backend/memory-curator/src/lib/triggers/episode-tracker.ts` is the precedent for the trigger
split. Start after TASK_2026_454_b401 decides the agent-sdk import boundary. Split the store after
TASK_2026_577_cbfb, TASK_2026_573_e2bf and any store work of TASK_2026_568_3933 land. One PR per
file is acceptable. The task closes when all three files are under the limit.

## Current state (2026-11-07)

- Not started. The files grew since 2026-10-12 (1049 to 1051 and 1539 to 1565 lines).
- TASK_2026_454_b401, TASK_2026_577_cbfb, TASK_2026_573_e2bf and TASK_2026_568_3933 are all still
  `backlog`, so the start condition is not met.

Merged on 2026-10-12 from TASK_2026_570 and TASK_2026_310.

Full context, plan and discussion live in [./context.md](./context.md).
