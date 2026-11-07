---
id: TASK_2026_266
status: backlog
type: feature
title: >-
  Add a memory graph and a 2-D vector-space explorer to the Memory tab
description: >-
  Add a derived concept/file graph and a 2-D embedding projection to the Memory tab. Build a
  graph projection service in `memory-curator`, expose it under the `memory:` RPC prefix, and
  add a Graph view and a vector-space view in `memory-curator-ui`.
parent: TASK_2026_637_e30b
labels:
  - P4
depends_on:
  - TASK_2026_587_bffd
updated: 2026-11-07T00:00:00.000Z
---

# Memory graph + vector-space explorer

Machine-owned metadata carrier. Prose lives in `./context.md`.

## Description

The memory store holds memories and 384-dim embeddings, but the Memory tab shows only
row lists. Remaining work (all of it):

- A graph projection service in `libs/backend/memory-curator` that derives edges at read time
  from `concepts_json`, `files_json`, `subject` and `session_id` (schema in
  `libs/backend/persistence-sqlite/src/lib/migrations/0017_memory_schema_v2.ts`). Do not add an
  edges table.
- A 2-D projection of the vectors in `memory_chunks_vec` (see `context.md`, "Vector projection":
  PCA alone is not enough).
- New `memory:` RPC methods in `libs/shared/src/lib/types/rpc.types.ts` (the `memory:*` block
  starts near :2361).
- A Graph view and a vector-space view in `libs/frontend/memory-curator-ui/src/lib/components/`.

## Current state (2026-11-07)

- Nothing is implemented. No `memory:graph` RPC exists, and `memory-curator-ui` has no graph or
  scatter component.
- The data sources still exist: migration `0017_memory_schema_v2.ts` and the `memory_chunks_vec`
  readers in `libs/backend/memory-curator/src/lib/memory-search.service.ts`.
- Dependency `TASK_2026_587_bffd` (Thoth Overview tab) is still `backlog`.
- The prototype and layout parameters are in `context.md`, "Prototype". Row counts there are
  from 2026-08-17.
