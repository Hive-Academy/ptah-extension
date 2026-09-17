---
id: TASK_2026_445_6ece
status: backlog
type: BUGFIX
title: Pin the locale in the memory diagnostics formatSnapshot
description: >-
  Follow-up from TASK_2026_440_834c. formatSnapshot in
  memory-diagnostics-accordion.component.ts calls toLocaleString() with no pinned
  locale, unlike the storage panel formatters that pin en-US.
depends_on: [TASK_2026_440_834c]
created: 2026-09-15T16:10:00.000Z
updated: 2026-09-15T16:10:00.000Z
---

## Description

Pin the locale in `formatSnapshot` (`libs/frontend/memory-curator-ui/.../memory-diagnostics-accordion.component.ts`)
so it matches the batch 6 formatters. Source: `TASK_2026_440_834c/code-style-review-batch-6.md`.
