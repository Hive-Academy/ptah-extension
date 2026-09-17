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
| `memory.curatorEnabled`         | `true`                     | Legacy registered key; no current runtime consumer                                                                            |
| `memory.embeddingModel`         | `Xenova/bge-small-en-v1.5` | Legacy registered key; no current runtime consumer                                                                            |
| `memory.curatorModel`           | _(empty)_                  | LLM used by the curator and resolver stages; empty rides the active model                                                     |
| `memory.curatorProvider`        | _(empty)_                  | Curator provider id; empty rides the active provider, otherwise the curator runs on the chosen provider independently of chat |
| `memory.searchTopK`             | `20`                       | Legacy registered key; no current runtime consumer                                                                            |
| `memory.searchAlpha`            | `0.5`                      | Legacy registered key; no current runtime consumer                                                                            |
| `memory.symbolInjectionEnabled` | `true`                     | Inject matching code symbols alongside curated memories                                                                       |

### Retention

| Key                              | Default | Clamp range | What it does                                                     |
| -------------------------------- | ------- | ----------- | ---------------------------------------------------------------- |
| `memory.retention.enabled`       | `true`  | —           | Enables observation-queue retention                              |
| `memory.retention.processedDays` | `7`     | `1–365`     | Keeps processed observations for this many days                  |
| `memory.retention.stuckDays`     | `14`    | `7–365`     | Quarantines unprocessed observations older than this many days   |
| `memory.retention.batchSize`     | `500`   | `50–5000`   | Bounds observation rows processed in each retention batch        |

### Lifecycle

| Key                                 | Default | Clamp range      | What it does                                                                                         |
| ----------------------------------- | ------- | ---------------- | ---------------------------------------------------------------------------------------------------- |
| `memory.lifecycle.enabled`          | `true`  | —                | Enables age-based archival, deletion, and the per-workspace cap                                    |
| `memory.lifecycle.archiveAfterDays` | `30`    | `7–365`          | Moves unused recall memories to archival and stamps `archived_at`                                  |
| `memory.lifecycle.deleteAfterDays`  | `60`    | `7–730`          | Deletes archival memories this many days after `archived_at`, together with their search data       |
| `memory.lifecycle.maxPerWorkspace`  | `25000` | `1000–1000000`   | Caps evictable memories per workspace; archival rows are evicted first after a 7-day archival grace |

Pinned, core, and corpus memories are exempt. Recorded use restores an archival memory to recall. Stored salience is an immutable base; recency and use affect query-time ranking only. Lifecycle deletes pause when sqlite-vec is unavailable and the `memory_chunks_vec_ad` cleanup trigger exists; without that trigger, deletion proceeds because there are no triggered vector deletes to run.

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
