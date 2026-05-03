---
title: Memory
description: Letta-style tiered memory that survives compactions, restarts, and context resets.
---

import { Card, CardGrid } from '@astrojs/starlight/components';

# Memory

Ptah remembers. Long-running work tends to outlive a single context window — preferences shift, decisions accumulate, and "what did we settle on for auth?" becomes a real question. Ptah's memory subsystem captures durable knowledge from your sessions and surfaces it back to the agent on demand.

The design is **Letta-style tiered**:

| Tier         | Cap (default) | What lives here                                          |
| ------------ | ------------- | -------------------------------------------------------- |
| **core**     | 50            | Identity, durable preferences, project invariants        |
| **recall**   | 500           | Recent events, decisions, things that happened this week |
| **archival** | 5000          | Deep history — searchable but rarely surfaced            |

A **curator** runs automatically on every context compaction (driven by the SDK's `PreCompact` hook). It reads the conversation, extracts memory drafts, then a **resolver** merges those drafts against existing memories — inserting, updating, promoting, demoting, or forgetting. Salience scoring decides which memories rise to `core` and which decay out of `archival`.

Search is **hybrid**: BM25 (SQLite FTS5) and vector similarity (sqlite-vec, 384-dim `bge-small-en-v1.5` embeddings) are fused with **Reciprocal Rank Fusion**. If sqlite-vec isn't available on your platform, search falls back to BM25-only — no setup pain, just slightly less semantic recall.

Memory kinds: `fact`, `preference`, `event`, `entity`.

## What's in this section

<CardGrid>
  <Card title="How it works" icon="setting">
    Curator pipeline, resolver, salience scoring. [Learn more →](/memory/how-it-works/)
  </Card>
  <Card title="Searching" icon="magnifier">
    Hybrid BM25 + vector retrieval, top-K, weighting. [Learn more →](/memory/searching/)
  </Card>
  <Card title="Pinning & forgetting" icon="pin">
    Pin durable facts; soft-delete what no longer applies. [Learn more →](/memory/pinning-and-forgetting/)
  </Card>
  <Card title="Settings" icon="setting">
    Every tunable, with defaults. [Learn more →](/memory/settings/)
  </Card>
</CardGrid>

:::tip
Memory is on by default. There's nothing to wire up — start a session and watch the **Memory** panel populate after the first compaction.
:::
