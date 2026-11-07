---
id: TASK_2026_311
status: backlog
type: BUGFIX
title: "Refund the curation rate-limit token when a pass stalls on an exhausted provider"
description: >-
  `MemoryTriggerService.refundUndispatched` refunds the hourly curation token only for a
  network-backoff deferral or an unsupported provider. A provider-exhaustion stall still spends
  it. Add that refund; do not refund passes that reached the provider and did work.
parent: TASK_2026_635_5ea5
labels:
  - P1
relates_to:
  - TASK_2026_579_f2e2
updated: 2026-11-07T00:00:00.000Z
---

# The hourly rate-limit token is not refunded on a stalled pass

Machine-owned metadata carrier. Prose lives in `./context.md`.

## Description

Remaining work:

- In `libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.ts:924-931`
  `refundUndispatched`, also refund when the pass stalled because the provider was exhausted
  before it did any work.
- Carry the stall reason into `CuratorRunStats`. The stall is recorded at
  `libs/backend/memory-curator/src/lib/memory-curator.service.ts:781-782`
  (`extraction.status === 'stalled'` → `activity.recordStall`).
- Do not refund a stall that already completed windows against the provider.
- Add specs for both cases.

## Current state (2026-11-07)

- Done: `CuratorRateLimitService.refund` exists
  (`libs/backend/agent-sdk/src/lib/helpers/curator-rate-limit.service.ts:26`, PR #510).
- Done: refunds for `network-backoff` and `provider-unsupported`
  (`memory-trigger.service.ts:926-929`).
- Not done: no refund for a provider-exhaustion stall.
- Related task TASK_2026_579_f2e2 and parent TASK_2026_635_5ea5 are still `backlog`.
