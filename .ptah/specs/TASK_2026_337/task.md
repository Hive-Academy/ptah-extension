---
id: TASK_2026_337
status: backlog
type: BUGFIX
title: >-
  fingerprintNode does not fold summaryContent or toolCount, so a node can be
  reused with stale content that renders
description: >-
  `fingerprintNode`
  (`libs/frontend/chat-streaming/src/lib/execution-tree-builder.service.ts:629-656`)
  computes the per-node reuse key for the incremental execution-tree rebuild. It
  folds `cost`, `duration`, `model`, `tokenUsage`, `agentDescription`, `error`
  and `status`, but NOT `summaryContent` and NOT `toolCount` — both of which
  render on agent cards. A node whose summary or tool count moved while every
  folded field stayed put keeps its cached object and renders stale. Excluding
  the timestamps (`startTime`, `endTime`) alongside them looks deliberate and
  should stay: folding those would invalidate node identity on every history
  replay and force exactly the full re-render the incremental rebuild exists to
  avoid. `summaryContent` and `toolCount` look like omissions rather than
  decisions. Low risk in practice today because both move together with `cost`,
  `duration` and `tokenUsage`, which ARE folded — so the fields that would betray
  a stale node usually change alongside ones that invalidate it. That is a
  coincidence of the current producers, not a guarantee. Surfaced by the
  TASK_2026_333 implementer, who declined to widen a production reuse key on
  their own judgement inside a bugfix. That was the right call and it is why this
  is a separate task.
relates_to:
  - TASK_2026_333
  - TASK_2026_323
labels:
  - chat-streaming
  - cache-invalidation
executor: frontend-developer
estimate: S
---

# fingerprintNode under-folds two rendered fields

Machine-owned metadata carrier. Prose lives in `./context.md`.
