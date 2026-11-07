---
id: TASK_2026_888_36b0
status: backlog
type: FEATURE
title: Add steer and interrupt to the opencode lane via opencode serve
description: >-
  Phase 2 of TASK_2026_591_fff5. Phase 1 (queue-next-turn) merged in #658. Steer and
  interrupt through opencode serve is design-first and waits on a user gate.
depends_on: [TASK_2026_591_fff5]
created: 2026-11-07T00:00:00.000Z
updated: 2026-11-07T00:00:00.000Z
---

## Description

Split out of TASK_2026_591_fff5 by the TASK_2026_886_032a status sweep. Phase 1 (queue the next
turn) merged in #658 (`779b89b5d`). The opencode adapter spec pins `continuation: supported` and
messaging `queue`. Phase 2 adds steer and interrupt through `opencode serve`. It is a design-first
item behind a user gate and was never started. Read the parent task folder for the design notes.
