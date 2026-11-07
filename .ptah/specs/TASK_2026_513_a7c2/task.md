---
id: TASK_2026_513_a7c2
status: backlog
type: BUGFIX
title: Reconcile session stats with message footers and pin the four fields
description: >-
  Lanes are now shown apart from session totals. Confirm the session MODEL, TOKENS, COST and
  TIME agree with the per-message footers, and pin all four with specs for two cases.
updated: 2026-11-07T00:00:00.000Z
---

# Session stats: model, tokens, cost and time per session, with lanes labelled

## Description

The first report (2026-09-21, `context.md`) was that an Orchestra tile header showed the model,
token count and cost of a spawned CLI agent. That header is gone: the session view now uses
`SessionStatsSummaryComponent`
(`libs/frontend/chat-ui/src/lib/molecules/session/session-stats-summary.component.ts`), fed by the
backend session snapshot (authoritative since PR #587, `862c6174f`).

Remaining work:

1. Confirm that the session MODEL is the model the session uses, not a lane's model.
2. Confirm that session TOKENS, COST and TIME agree with the per-message footers, or label the
   difference in the interface.
3. Add specs that pin all four fields for a session with no spawned agent and for a session that
   spawned a lane of a different vendor.

## Current state (2026-11-07)

- Lane decision made and labelled: lane tiles show `lane · not in totals`
  (`libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/stats-limit-view-model.types.ts:296`,
  `0099a3c58`). Lane tiles render through `LaneUsageTileComponent` and `LaneSubtotalTileComponent`
  (`session-stats-summary.component.ts:17-18,84-85`).
- The investigation is done: `investigation.md` in this folder (measured on 2026-09-21; its line
  numbers are old).
- Not found: specs that pin all four fields for the two cases above, or a check that header and
  footer agree.
- TASK_2026_533_b7e1 `implementation-plan.md:318` defers "Spawned CLI tile telemetry" to this task.
