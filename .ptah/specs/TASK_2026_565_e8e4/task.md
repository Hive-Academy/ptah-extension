---
id: TASK_2026_565_e8e4
status: backlog
type: BUGFIX
title: Fix inert cross-encoder rerank in the embedder worker
depends_on: []
created: '2026-09-26T20:53:47.829Z'
updated: '2026-11-07T00:00:00.000Z'
description: >-
  rerank() in embedder-worker.ts runs a softmax over the single logit of the ms-marco cross-encoder,
  so every pair scores 1 and searchRich keeps the RRF order. Score the raw logit or its sigmoid.
labels:
  - memory-curator
  - P1
parent: TASK_2026_636_0add
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

## Description

The `Xenova/ms-marco-MiniLM-L-6-v2` cross-encoder exports one logit. `rerank()` runs the
default `text-classification` pipeline, whose softmax over one logit always returns 1.0. Every
candidate ties, the stable sort keeps the RRF order, and rerank has no effect.

- Score the raw logit (or its sigmoid), for example with the pipeline option
  `function_to_apply: 'none'` or by calling the model directly.
- Add a spec that proves the rerank changes the candidate order.

## Current state (2026-11-07)

- Not fixed. `libs/backend/memory-curator/src/lib/embedder/embedder-worker.ts:231` loads the
  `text-classification` pipeline, and `:277-294` (`rerank`) calls it with `topk: null` and no
  `function_to_apply`.
- `extractScore` at `:260-265` takes `entry[0].score`, which is always 1.0 for this model.
- Found in TASK_2026_563 Phase 2 (PR #601).

Full context, plan and discussion live in [./context.md](./context.md).
