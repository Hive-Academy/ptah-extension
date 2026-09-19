---
status: in_review
type: bugfix
title: Memory retention never purges a row (governor wait consumes the whole run budget)
description: >-
  MemoryRetentionService has never completed a run. It burns its entire 60s wall
  budget inside the first BackgroundWorkGovernor wait, then hard-stops with
  processed_purged 0. observation_queue has grown to 177,919 rows / 878 MB.
---

Confirmed livelock. `retention-run-budget.ts:70` passes the run's own remaining
wall budget as the governor deferral ceiling, so the first wait always consumes
it all. Secondary: with 7 sessions the `foreground-active` gate never opens.
