---
id: TASK_2026_565_e8e4
status: backlog
type: BUGFIX
title: Fix inert cross-encoder rerank in the embedder worker
depends_on: []
created: '2026-09-26T20:53:47.829Z'
updated: '2026-09-26T20:53:47.829Z'
description: 'embedder-worker.ts:277-295 applies softmax to a single-logit ms-marco cross-encoder, so every pair scores 1 and searchRich rerank keeps RRF order (found in TASK_2026_563 Phase 2)'
labels:
  - memory-curator
relates_to:
  - TASK_2026_563_2939
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

embedder-worker.ts:277-295 applies softmax to a single-logit ms-marco cross-encoder, so every pair scores 1 and searchRich rerank keeps RRF order (found in TASK_2026_563 Phase 2)

Full context, plan and discussion live in [./context.md](./context.md).
