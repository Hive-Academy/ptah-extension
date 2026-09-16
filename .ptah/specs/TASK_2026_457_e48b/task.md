---
id: TASK_2026_457_e48b
status: backlog
type: FEATURE
title: >-
  Report each memory lifecycle preview count on its own
description: >-
  Gate 3 minor finding on TASK_2026_443_40ec. readMemoryStorageHealth builds the
  lifecycle preview all or nothing, so one failed count read makes the whole
  preview null and the panel says "preview after the first run" even though the
  other counts were read. Per-field nullability changes the
  MemoryLifecyclePreviewDto contract and the panel text, so it is a design
  change rather than a Gate 3 fix.
depends_on: [TASK_2026_443_40ec]
created: 2026-09-16T01:10:00.000Z
updated: 2026-09-16T01:10:00.000Z
---

## Description

Site: `libs/backend/memory-curator/src/lib/retention/memory-storage-health.ts:97-110`. Either make each
field of `MemoryLifecyclePreviewDto` nullable, or keep the counts that were read and list the failed
reads in `readErrors`. The storage panel then shows what is known instead of hiding all of it. Update
the panel states in `storage-health-panel.component.ts` and their specs. Source:
`TASK_2026_443_40ec/code-logic-review-branch.md` finding 4.
