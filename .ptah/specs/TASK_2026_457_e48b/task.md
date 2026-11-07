---
id: TASK_2026_457_e48b
status: backlog
type: FEATURE
title: >-
  Report each memory lifecycle preview count on its own
description: >-
  readMemoryStorageHealth builds the lifecycle preview all or nothing. One missing count makes
  the whole preview null, so the panel hides the counts it did read.
depends_on: []
created: 2026-09-16T01:10:00.000Z
updated: 2026-11-07T00:00:00.000Z
parent: TASK_2026_637_e30b
labels:
  - P3
---

## Description

Site: `libs/backend/memory-curator/src/lib/retention/memory-storage-health.ts:139-152`. The preview is
null unless all five stored fields are present. Either make each field of `MemoryLifecyclePreviewDto`
(`libs/shared/src/lib/types/rpc/rpc-curator-diagnostics.types.ts:92`) nullable, or keep the counts
that were read and list the failed reads in `readErrors`. The storage panel then shows what is known
instead of hiding all of it. Update the panel states in
`libs/frontend/memory-curator-ui/src/lib/components/diagnostics/storage-health-panel.component.ts` and
their specs. This changes the DTO contract and the panel text, so it is a design change. Source:
Gate 3 minor finding, `TASK_2026_443_40ec/code-logic-review-branch.md` finding 4.

## Current state (2026-11-07)

- Not done. `preview` is still `MemoryLifecyclePreviewDto | null`
  (`rpc-curator-diagnostics.types.ts:136`).
- The all-or-nothing check is at `memory-storage-health.ts:139-144`.
- The panel shows `preview after the first run` when the preview is null
  (`storage-health-panel.component.ts:420`).
