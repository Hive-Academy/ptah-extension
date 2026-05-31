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

## Browsing the indexed code

The **Memory** tab also tracks the [code-symbol index](/memory/how-it-works/#the-code-symbol-index) for your workspace — separate from curated memories. Two surfaces expose it:

- The **Code index** stat card shows the number of indexed symbols. It sits next to **Last curated** in the stats row at the top of the tab.
- The **Indexed code** panel — a collapsible section below the memory list — lets you browse those symbols directly.

Expand **Indexed code** to see the symbol list. Each row shows the symbol name, its `kind` badge (function, class, method, …), the file it's in (shown relative to the workspace root), and a token count. A counter reports how many symbols are indexed in total.

### Searching symbols

Type into the **Search indexed symbols** box to filter the list. The search is debounced and matches against indexed symbols for the current workspace. Results are paginated — use **Prev** / **Next** to move through pages, and the footer shows the current range (`X–Y of total`). **Re-load** refreshes the list on demand.

:::note
The **Code index** stat, the **Indexed code** panel, and symbol search are part of the Electron desktop app's **Memory** tab. They are not available in the VS Code extension or the CLI.
:::

### Workspace scope

Symbol browsing follows the same **This workspace** / **All workspaces** toggle as the memory list. The index is workspace-scoped, so switching scope re-runs the symbol query accordingly.

### Automatic refresh after indexing

When a workspace index finishes, the Memory tab refreshes itself — the **Code index** stat, the memory list, and the **Indexed code** symbol list all reload so you see the latest results without leaving the tab.
