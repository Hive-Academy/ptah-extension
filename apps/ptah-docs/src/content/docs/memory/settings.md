---
title: Memory Settings
description: Every memory tunable, with defaults.
---

# Memory Settings

Memory settings live in `~/.ptah/settings.json` under the `memory.*` prefix. Edit them through **Settings → Memory** in the desktop app.

## Reference

### Core

| Key                             | Default                    | What it does                                                                                                                  |
| ------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `memory.enabled`                | `true`                     | Master kill-switch for the whole memory subsystem                                                                             |
| `memory.curatorEnabled`         | `true`                     | When `false`, no extraction or resolution runs                                                                                |
| `memory.tierLimits.core`        | `256`                      | Cap on the `core` tier; the weakest memory is demoted when full                                                               |
| `memory.tierLimits.recall`      | `4096`                     | Cap on the `recall` tier                                                                                                      |
| `memory.tierLimits.archival`    | `100000`                   | Cap on the `archival` tier                                                                                                    |
| `memory.decayHalflifeDays`      | `30`                       | Half-life of unused memories' salience                                                                                        |
| `memory.embeddingModel`         | `Xenova/bge-small-en-v1.5` | Embedder (transformers.js, runs in a worker)                                                                                  |
| `memory.curatorModel`           | _(empty)_                  | LLM used by the curator and resolver stages; empty rides the active model                                                     |
| `memory.curatorProvider`        | _(empty)_                  | Curator provider id; empty rides the active provider, otherwise the curator runs on the chosen provider independently of chat |
| `memory.searchTopK`             | `20`                       | Number of hits returned per query                                                                                             |
| `memory.searchAlpha`            | `0.5`                      | RRF weight: `1.0` = pure BM25, `0.0` = pure vector                                                                            |
| `memory.symbolInjectionEnabled` | `true`                     | Inject matching code symbols alongside curated memories                                                                       |

### Triggers

Memory does not run only at compaction. Each trigger below can fire a curate pass.

| Key                                                | Default  | What it does                                                |
| -------------------------------------------------- | -------- | ----------------------------------------------------------- |
| `memory.triggers.preCompact`                       | `true`   | Curate the turns that are about to be compacted             |
| `memory.triggers.idleMs`                           | `600000` | Curate after this much idle time (10 minutes)               |
| `memory.triggers.turnThreshold`                    | `20`     | Curate once this many turns have accumulated                |
| `memory.triggers.bootScan`                         | `true`   | Scan for uncurated sessions at startup                      |
| `memory.triggers.userPromptSubmit.enabled`         | `true`   | Retrieve memories when your prompt contains a recall cue    |
| `memory.triggers.userPromptSubmit.cueList`         | _(list)_ | The phrases that count as a recall cue                      |
| `memory.triggers.userPromptSubmit.minPromptLength` | `20`     | Ignore prompts shorter than this                            |
| `memory.triggers.postToolUse.enabled`              | `true`   | Curate after a tool call completes                          |
| `memory.triggers.maxCuratesPerHour`                | `20`     | Hard ceiling on curate passes per hour, across all triggers |

## Storage

Memory state lives in `~/.ptah/ptah.db` (shared SQLite database) across these tables:

- `memories` — primary row per memory
- `memory_chunks` — retrieval shards
- `memory_chunks_fts` — FTS5 BM25 index
- `memory_chunks_vec` — sqlite-vec embedding index

:::caution
Don't hand-edit `~/.ptah/ptah.db`. Use the Memory panel — it round-trips through the curator's invariants and keeps the FTS / vec indexes consistent.
:::
