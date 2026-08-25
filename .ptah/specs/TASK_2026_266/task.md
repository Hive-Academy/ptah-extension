---
id: TASK_2026_266
status: backlog
type: feature
title: >-
  Memory graph + vector-space explorer — derived concept/file graph and a 2-d
  embedding projection in the Memory tab
description: >-
  The memory store has 25k memories and 26k 384-dim embeddings but no way to see
  either: there is no edges table, no `memory:graph` RPC, and no graph or
  scatter component in `memory-curator-ui`. The edge material already exists in
  `concepts_json`, `files_json`, `subject` and `session_id` (migration 0017), and
  the embeddings already exist in `memory_chunks_vec`. Add a graph projection
  service in `memory-curator`, expose it over the existing `memory:` RPC prefix,
  and ship a Graph view plus a vector-space view in the Memory tab. A validated
  throwaway prototype established the approach and the layout parameters; see
  `./context.md`.
---

# Memory graph + vector-space explorer

Machine-owned metadata carrier. Prose lives in `./context.md`.
