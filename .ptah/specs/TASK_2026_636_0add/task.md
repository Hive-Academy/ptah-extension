---
id: TASK_2026_636_0add
status: backlog
type: FEATURE
title: "Memory quality, measured: better recall and a cleaner corpus"
depends_on: []
created: "2026-10-12T19:39:36.772Z"
updated: "2026-11-07T00:00:00.000Z"
description: >-
  Epic. Rerank that actually reorders, the scored memory and skills bench, merge policy and reversible corpus
  consolidation, sediment classification, and bench-guided tool fixes. Children carry the work.
estimate: XL
labels:
  - epic
  - memory
  - P2
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

## Description

Epic. Memory search returns the right memories, the corpus stops growing with duplicates and
sediment, and each quality claim has a bench number behind it. The children carry the work: a
cross-encoder rerank that reorders, bench recordings and the first scored run, the tier-2 merge
decision, reversible consolidation of the existing corpus, sediment classification, and fixes to
the code-intelligence and memory MCP tools.

## Current state (2026-11-07)

- All six children are still `backlog`: TASK_2026_565_e8e4, TASK_2026_624_d671,
  TASK_2026_619_af7f, TASK_2026_566_9a50, TASK_2026_577_cbfb, TASK_2026_568_3933.
- The evidence files still exist on main:
  `libs/backend/memory-curator/src/lib/embedder/embedder-worker.ts` and
  `libs/backend/memory-curator/src/lib/curator-llm/merge-candidate-collector.ts`. Line numbers in
  `context.md` date from 2026-10-12.
- The memory and skills bench lives in `tools/mcp-bench/src/memory-skills/`.

Full context, plan and discussion live in [./context.md](./context.md).
