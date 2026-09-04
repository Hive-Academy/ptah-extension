---
id: TASK_2026_311
status: backlog
type: BUGFIX
title: >-
  A curation pass that stalls on an exhausted provider still spends its hourly
  rate-limit token, so curation stays throttled after quota returns
description: >-
  `CuratorRateLimitService.tryAcquire` is called BEFORE the curate runs —
  `libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.ts:470`
  and `:657` — and there is no refund API on the service
  (`libs/backend/agent-sdk/src/lib/helpers/curator-rate-limit.service.ts`). A
  pass that acquires a token and then stalls, because the provider quota is
  exhausted and the pass produces nothing, has spent one of the hour's budget
  for no curation. This is NOT data loss: TASK_2026_306 fixed the separate
  defect where a stalled pass discarded its own input, so the episode rows now
  survive. The cost is throughput. A long provider cooldown can burn the whole
  hourly allowance on passes that curated nothing, and when quota does come back
  the curator is throttled by a budget it spent on failures — precisely when it
  has the largest backlog to work through. The fix is a refund path: either
  `tryAcquire` moves after the point where the pass is known to have done real
  work, or the service grows an explicit `refund(...)` that the stall branch
  calls. Prefer the refund — moving the acquire risks two concurrent passes both
  getting past a check that exists to serialise them. Note the blast radius is
  wider than the finding: `CuratorRateLimitService` lives in `agent-sdk/helpers`
  and is also consumed by `skill-synthesis`
  (`skill-curator.service.ts`, `triggers/skill-trigger.service.ts`), so a refund
  API is a shared-service change and both consumers should be considered even if
  only the memory-curator stall branch calls it initially. Recorded as a
  follow-up by TASK_2026_306.
---

# The hourly rate-limit token is not refunded on a stalled pass

Machine-owned metadata carrier. Prose lives in `./context.md`.
