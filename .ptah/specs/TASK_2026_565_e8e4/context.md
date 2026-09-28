# Task Context - TASK_2026_565_e8e4

## Background

The ms-marco-MiniLM-L-6-v2 cross-encoder exports one logit. rerank() in libs/backend/memory-curator/src/lib/embedder/embedder-worker.ts:277-295 runs the text-classification pipeline, whose softmax over one logit always returns 1.0. Every candidate ties, the stable sort keeps the RRF order, and rerank has no effect in production. Reproduced outside the harness with the production options (dtype q8, topk null, truncation, max_length 512). Fix: score the raw logit (or sigmoid of it) and add a spec that proves the order changes.

## Evidence

Source: follow-up from TASK_2026_563_2939 (PR #601). Evidence: ../TASK_2026_563_2939/test-report.md (reranker finding) and harness/output/knn-starvation.md.
