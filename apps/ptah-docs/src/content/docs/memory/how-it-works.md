---
title: How Memory Works
description: The curator pipeline — extract, resolve, score, store, embed.
---

# How Memory Works

Memory updates do not run on every turn. A **trigger** starts a curate pass, and
a per-hour ceiling caps how often that can happen. This keeps the conversation
hot path cheap and lets the curator see a meaningful slice of recent activity.

## What starts a curate pass

| Trigger            | Fires when                                             |
| ------------------ | ------------------------------------------------------ |
| **Pre-compact**    | The context is about to be compacted                   |
| **Idle**           | The session has been idle for `memory.triggers.idleMs` |
| **Turn threshold** | `memory.triggers.turnThreshold` turns have accumulated |
| **Boot scan**      | Ptah starts and finds uncurated sessions               |
| **Prompt submit**  | Your prompt contains a recall cue (this retrieves)     |
| **Post tool use**  | A tool call completes                                  |

`memory.triggers.maxCuratesPerHour` (default 20) bounds the total. See
[Memory Settings](/memory/settings/) to tune or disable any trigger.

## The pipeline

```text
a trigger fires
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

Both stages are LLM calls. Choose the curator provider and model in the **Memory** settings panel, or via `memory.curatorProvider` and `memory.curatorModel`. Both default to empty, which means the curator rides the provider and model your chat is already using. Pick a small, fast model here — the curator runs often. The curator can also run on its **own independently-chosen provider** — set `memory.curatorProvider` and the curator authenticates against that provider on its own, regardless of which provider your chat is using (leave it empty to ride the active provider). Reuses the credentials you already authenticated for that provider.

The curator's output is structured: each draft has a `kind` (`fact | preference | event | entity`), a body, an optional `subject`, and a tier hint. The resolver does the work of deciding what's actually new versus what's a refinement of something Ptah already knows.

## Salience and tier movement

Each memory carries a salience score. The score increases when a memory is **retrieved and used** in subsequent turns, and decays exponentially when it's not. The half-life is `memory.decayHalflifeDays` (default 30 days).

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

## The code-symbol index

Alongside curated memory, Ptah keeps a separate **code-symbol index** for the current workspace. This is distinct from the curator pipeline above:

- **Memory chunks** are LLM-extracted, scored, and tiered — they capture _decisions and knowledge_ from your sessions.
- **Code symbols** come straight from indexing your source tree — they capture _structure_ (functions, classes, methods) so the agent can navigate and recall where code lives.

Indexing runs on your machine; nothing is uploaded. When the workspace changes, you can re-index from the **Memory** tab. Each indexed symbol records its name, `kind` (e.g. function, class, method), the file it lives in, and a token count.

:::note
The code-symbol index is workspace-scoped and lives in the same `~/.ptah/ptah.db`. It is part of the Electron desktop app's **Memory** tab and is not available in the VS Code extension or the CLI.
:::
