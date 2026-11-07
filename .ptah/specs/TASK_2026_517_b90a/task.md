---
status: backlog
type: feature
title: Surface a retention fault without waiting for the user to open a tab
description: >-
  The retention health verdict shows only as a banner in the Electron Memory tab. Choose an
  active channel for a never-completed or stalled verdict, with a suppression rule, and build it.
parent: TASK_2026_637_e30b
labels:
  - P2
relates_to:
  - TASK_2026_457_e48b
updated: 2026-11-07T00:00:00.000Z
---

# TASK_2026_517 — Active surfacing of a retention fault

## Description

First choose the channel: a host notification, a badge on the Memory tab, or a one-time message in
the open chat surface. Then build it with a de-duplication and dismiss rule, so a fault that is
recomputed on every retention tick does not re-announce itself. Keep the TASK_2026_511 rules:
`unknown` raises no alarm, `disabled` outranks every other verdict, and a healthy verdict clears the
suppression. The decision options and constraints are in `context.md`; they still apply.

## Current state (2026-11-07)

- TASK_2026_511_c7b4 is `done`. The verdict is computed by `computeRetentionHealthVerdict`
  (`libs/backend/memory-curator/src/lib/retention/memory-storage-health.ts:31-61`).
- The only UI that shows it is the storage health panel
  (`libs/frontend/memory-curator-ui/src/lib/components/diagnostics/storage-health-panel.component.ts`).
- No active channel exists. A candidate is the renderer notification center
  (`libs/frontend/notification-center/src/lib/notification-center.store.ts`) or the host attention
  port (`PLATFORM_TOKENS.HOST_ATTENTION_NOTIFICATIONS`,
  `libs/backend/platform-core/src/di/tokens.ts:36`). Neither carries retention items today.
- The channel decision is not recorded.
