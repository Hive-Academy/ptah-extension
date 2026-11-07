---
id: TASK_2026_577_cbfb
status: backlog
type: FEATURE
title: Consolidate near-duplicate memories with a scheduled, reversible merge job
depends_on:
  - TASK_2026_572_07c4
created: '2026-09-30T13:53:38.000Z'
updated: '2026-11-07T00:00:00.000Z'
description: >-
  Merge runs only when a new memory is written, so existing memories are never combined. Add an
  idle-gated job that clusters them, merges each cluster and quarantines the originals reversibly.
labels:
  - memory-curator
  - P2
relates_to:
  - TASK_2026_566_9a50
  - TASK_2026_568_3933
parent: TASK_2026_636_0add
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

## Description

Merge candidates are checked only in the resolve path of a new curation pass. A near-duplicate
that is still in use is never merged and never ages out. Add a scheduled job that merges
near-duplicates in the existing corpus, with no hard delete.

- Register an idle- and power-gated job in the Thoth cron start
  (`libs/backend/thoth-runtime/src/lib/start-thoth-cron.ts`) through the background-work governor,
  with a bounded budget per run and a resumable cursor (follow the retention job pattern).
- Cluster by workspace and lowercased subject, then by embedding similarity over a threshold.
  Bound the cluster size. Skip clusters of one with no LLM call.
- One curator LLM call per cluster writes the merged memory (tier = highest of the members, pinned
  wins).
- Quarantine the members with `quarantine_reason = 'merged-into:<merged id>'`. Add a quarantine
  write method to `MemoryStore`, and widen the RPC `reason` selector to accept
  `merged-into:<ULID>`.
- Revert by reason restores the members and quarantines the merged row with reason
  `merge-reverted` in one transaction. The job keeps its own merge record and never re-merges a
  member that the user restored by hand.
- Diagnostics: last run, clusters merged, rows quarantined, and a dry-run preview.

The acceptance criteria and the revert rules are in `./context.md` ("Scope", "Acceptance
criteria"). They are still current.

## Current state (2026-11-07)

- Not started. No consolidation job exists in `libs/backend/memory-curator/src`.
- Quarantine columns: `libs/backend/persistence-sqlite/src/lib/migrations/0048_memory_quarantine.ts:19-20`.
- `MemoryStore` has `restoreQuarantined` only (`libs/backend/memory-curator/src/lib/memory.store.ts:912`),
  no quarantine writer.
- The reason selector accepts only `rule:<id>`:
  `libs/backend/rpc-handlers/src/lib/handlers/memory-rpc.schema.ts:119`.
- Blocked by TASK_2026_572_07c4 (a UI to see and restore quarantined rows).

Full context, plan and discussion live in [./context.md](./context.md).
