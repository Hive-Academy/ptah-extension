---
id: TASK_2026_447_035a
status: backlog
type: BUGFIX
title: Repair the contentless memory_concepts_fts drift on real databases
description: >-
  Found by TASK_2026_443_40ec (risk R1). On the 2026-09-09 snapshot memory_concepts_fts is
  contentless (content=''), not the source DDL in 0017_memory_schema_v2.ts, so memory_id
  reads NULL, the memories_concepts_ad trigger deletes nothing, and every deleted memory
  leaves its concept entries (113,662 entries). No production reader queries the table.
depends_on: [TASK_2026_443_40ec]
created: 2026-09-15T17:30:00.000Z
updated: 2026-09-15T17:30:00.000Z
---

## Description

Either rebuild `memory_concepts_fts` to the source DDL in a migration, or delete the write-only index and
its triggers. Evidence: `TASK_2026_443_40ec/implementation-plan.md` sizing table and risk R1.
