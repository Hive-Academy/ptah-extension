---
title: Searching Memory
description: Hybrid BM25 + vector retrieval with Reciprocal Rank Fusion.
---

# Searching Memory

When the agent needs context — "what did we decide about auth?" — Ptah runs a **hybrid search** across all memories and injects the top hits.

## Hybrid retrieval

Two retrievers run in parallel:

1. **BM25** (SQLite FTS5) — exact term matching, fast, great for proper nouns and code identifiers
2. **Vector** (sqlite-vec) — semantic similarity using 384-dim `bge-small-en-v1.5` embeddings

Their ranked lists are fused with **Reciprocal Rank Fusion**. The blend is governed by `memory.searchAlpha`:

- `0.0` — pure vector
- `1.0` — pure BM25
- `0.5` (default) — even mix

## Top-K

`memory.searchTopK` (default `10`) caps the number of memories returned per query. Lower it if context budget is tight; raise it if the agent is missing relevant facts.

## When sqlite-vec is missing

If the native `sqlite-vec` binary fails to load, the search service silently degrades to BM25-only. Responses include a `bm25Only: true` flag so the UI can show a "vector index unavailable" hint. Functionally everything still works — semantic recall is just less forgiving of paraphrased queries.

:::tip
For best results, write memories the way you'd want to find them. Concrete nouns and verbs win over generic phrasing — same rule that applies to skill descriptions.
:::

## Inspecting search

Open the **Memory → Search** panel to test queries against your store. Each result shows the BM25 rank, vector rank, and final RRF score, so you can see why a memory surfaced (or didn't).
