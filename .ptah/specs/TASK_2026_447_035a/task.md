---
id: TASK_2026_447_035a
status: backlog
type: BUGFIX
title: Repair the contentless memory_concepts_fts drift on real databases
description: >-
  On real databases `memory_concepts_fts` is contentless, not the 0017 DDL, so the
  `memories_concepts_ad` trigger deletes nothing and deleted memories leave concept rows. No
  production code reads the table. Rebuild it to the source DDL in a migration, or drop it.
depends_on: []
created: 2026-09-15T17:30:00.000Z
updated: 2026-11-07T00:00:00.000Z
parent: TASK_2026_635_5ea5
labels:
  - P2
---

## Description

Found by TASK_2026_443_40ec (risk R1). On the 2026-09-09 snapshot the table had `content=''`,
so `memory_id` reads NULL and 113,662 orphan concept entries had built up. Remaining work, one
of:

- A new migration in `libs/backend/persistence-sqlite/src/lib/migrations/` (latest is 0071) that
  drops and recreates `memory_concepts_fts` to the 0017 DDL
  (`0017_memory_schema_v2.ts`, trigger at :42-43) and repopulates it from
  `memories.concepts_json`; or
- A migration that drops the write-only index and its triggers, and removes the writer in
  `libs/backend/memory-curator/src/lib/memory.store.ts:266` and the unused
  `rebuildConceptsIndex` (:976-991).

Add a migration spec against a contentless fixture.

## Current state (2026-11-07)

- Not fixed. The only migration that touches the table is `0017_memory_schema_v2.ts`.
- `memory.store.ts:266` still writes the table, and nothing reads it (no `MATCH` or `SELECT`
  against it in `libs/`).
- `rebuildConceptsIndex` (:984) has no caller, and its plain `DELETE FROM` assumes a
  non-contentless table, so it is not a repair for this drift.
- Evidence: `TASK_2026_443_40ec/implementation-plan.md` (sizing table, risk R1). That folder is
  no longer in `.ptah/specs/`; read it from git history.
