---
title: Memory Settings
description: Every memory tunable, with defaults.
---

# Memory Settings

Memory settings live in `~/.ptah/settings.json` under the `memory.*` prefix. Edit them through **Settings → Memory** in the desktop app.

## Reference

| Key                          | Default                    | What it does                                                        |
| ---------------------------- | -------------------------- | ------------------------------------------------------------------- |
| `memory.curatorEnabled`      | `true`                     | Master kill-switch — when `false`, no extraction or resolution runs |
| `memory.tierLimits.core`     | `50`                       | Cap on the `core` tier; oldest unused memory is demoted when full   |
| `memory.tierLimits.recall`   | `500`                      | Cap on the `recall` tier                                            |
| `memory.tierLimits.archival` | `5000`                     | Cap on the `archival` tier                                          |
| `memory.decayHalflifeDays`   | `14`                       | Half-life of unused memories' salience                              |
| `memory.embeddingModel`      | `Xenova/bge-small-en-v1.5` | Embedder (transformers.js, runs in a worker)                        |
| `memory.curatorModel`        | `claude-haiku-4-20251022`  | LLM used by both curator and resolver stages                        |
| `memory.searchTopK`          | `10`                       | Number of hits returned per query                                   |
| `memory.searchAlpha`         | `0.5`                      | RRF weight: `1.0` = pure BM25, `0.0` = pure vector                  |

## Storage

Memory state lives in `~/.ptah/ptah.db` (shared SQLite database) across these tables:

- `memories` — primary row per memory
- `memory_chunks` — retrieval shards
- `memory_chunks_fts` — FTS5 BM25 index
- `memory_chunks_vec` — sqlite-vec embedding index

:::caution
Don't hand-edit `~/.ptah/ptah.db`. Use the Memory panel — it round-trips through the curator's invariants and keeps the FTS / vec indexes consistent.
:::
