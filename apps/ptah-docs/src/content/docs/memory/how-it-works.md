---
title: How Memory Works
description: The curator pipeline — extract, resolve, score, store, embed.
---

# How Memory Works

Memory updates happen during **context compaction**, not on every turn. That keeps the conversation hot path cheap and lets the curator see a meaningful slice of recent activity.

## The pipeline

```text
PreCompact hook fires
        ↓
Curator LLM      → extracts memory drafts from the about-to-be-compacted turns
        ↓
Resolver LLM     → merges drafts against existing memories (insert / update /
                   promote / demote / forget)
        ↓
Salience scorer  → assigns a weight per memory based on novelty + reuse signals
        ↓
SQLite + vec     → memories land in ~/.ptah/ptah.db, chunks are embedded and
                   indexed for hybrid search
```

## Curator and resolver

Both stages are LLM calls. By default they use **`claude-haiku-4-20251022`** — fast and cheap, which matters because the curator runs every compaction. Override via `memory.curatorModel` if you want a sharper or cheaper model.

The curator's output is structured: each draft has a `kind` (`fact | preference | event | entity`), a body, an optional `subject`, and a tier hint. The resolver does the work of deciding what's actually new versus what's a refinement of something Ptah already knows.

## Salience and tier movement

Each memory carries a salience score. The score increases when a memory is **retrieved and used** in subsequent turns, and decays exponentially when it's not. The half-life is `memory.decayHalflifeDays` (default 14 days).

- High salience + frequent hits → promoted toward `core`
- Low salience over time → demoted toward `archival`, eventually pruned

Pinned memories (see [Pinning & forgetting](/memory/pinning-and-forgetting/)) are exempt from decay.

## Embeddings

Embeddings run **in a worker thread** using transformers.js — no network calls, no API key. Model defaults to `Xenova/bge-small-en-v1.5` (384 dims). First run downloads the model weights to your Electron user-data cache; subsequent runs are local-only.

:::note
If sqlite-vec fails to load (rare — usually an unsupported native binary), Ptah keeps running on BM25-only search. The search response includes a `bm25Only: true` flag so the UI can surface the degraded state.
:::

## Where it lives

All memory state is in `~/.ptah/ptah.db`:

- `memories` — one row per memory (kind, body, tier, salience, pinned, timestamps)
- `memory_chunks` — text shards used for retrieval
- `memory_chunks_fts` — FTS5 BM25 index
- `memory_chunks_vec` — sqlite-vec embedding index
