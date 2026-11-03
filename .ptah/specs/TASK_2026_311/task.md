---
id: TASK_2026_311
status: backlog
type: BUGFIX
title: "Refund the curation rate-limit token when a pass stalls on an exhausted provider"
description: "CuratorRateLimitService.refund exists (PR #510) but MemoryTriggerService refunds only on a network-backoff deferral. A provider-exhaustion stall (recordStall) still spends the hourly token. Add that refund; do not refund passes that reached the provider and did work."
parent: TASK_2026_635_5ea5
labels:
  - P1
relates_to:
  - TASK_2026_579_f2e2
updated: "2026-10-30T03:43:14.678Z"
---

# The hourly rate-limit token is not refunded on a stalled pass

Machine-owned metadata carrier. Prose lives in `./context.md`.
