---
id: TASK_2026_568_3933
status: backlog
type: RESEARCH
title: 'Classify and quarantine remaining event, task and worktree sediment'
depends_on: []
created: '2026-09-26T20:53:48.820Z'
updated: '2026-11-07T00:00:00.000Z'
description: >-
  SQL predicate rules R1-R3 caught durable rows and were dropped, so about 2,500 sediment events
  stay active. Research a content-level, reviewed classifier that feeds the reversible quarantine.
labels:
  - memory-curator
  - P3
relates_to:
  - TASK_2026_572_07c4
  - TASK_2026_577_cbfb
parent: TASK_2026_636_0add
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

## Description

Rules R1-R3 (event, task, PR, date and worktree predicates) each caught durable rows in seeded
samples and holdouts. Only R4 (89 commitlint scope facts) shipped. About 20% of sampled events and
70% of sampled worktree rows were durable, and about 2,500 sediment events stay active.

- Research a classifier that reads the content and all structured fields (for example an LLM or
  small-model judgment with human review), instead of blind SQL predicates.
- Feed its result into the existing reversible quarantine columns and the
  `memory:restoreQuarantined` RPC.

## Current state (2026-11-07)

- Not started. No sediment classifier exists in `libs/backend/memory-curator/src`.
- The reversible quarantine and its RPCs exist:
  `libs/backend/rpc-handlers/src/lib/handlers/memory-rpc.handlers.ts:175-176`
  (`memory:listQuarantined`, `memory:restoreQuarantined`).
- Evidence for the dropped rules: `quarantine-rules.md` sections 3-6 of TASK_2026_563, now in git
  history only: `git show ff531866f:.ptah/specs/TASK_2026_563_2939/quarantine-rules.md`.

Full context, plan and discussion live in [./context.md](./context.md).
