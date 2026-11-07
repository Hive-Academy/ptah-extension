---
status: backlog
type: bugfix
title: Stop the session-stats path from billing cached tokens at zero
description: >-
  calculateMessageCost still bills cache reads and writes at zero when the catalog entry
  publishes no cache rate. The session-stats path uses it without a cache-rate guard, so
  long sessions understate cost instead of showing "cost unavailable".
updated: 2026-11-07T00:00:00.000Z
labels:
  - pricing
  - agent-sdk
  - cli-agent-runtime
---

# Stop the session-stats path from billing cached tokens at zero

## Description

TASK_2026_474_5c9f established the rule the pricing path follows: when a
price is unknown, report it unknown. Never present a fabricated or partial
number as a complete one. One path still breaks that rule by understating.

### Cached tokens bill at zero when no cache rate is published

`calculateMessageCost` (`libs/shared/src/lib/utils/pricing.utils.ts:466-482`)
bills cache reads at `resolved.cacheReadCostPerToken ?? 0` (`:476`) and cache
writes at `resolved.cacheCreationCostPerToken ?? 0` (`:478`).

`calculateExactMessageCost` (`pricing.utils.ts:566` onward) already returns a
null cost when a used cache rate is missing, but the session-stats path does not
use it. `LiveSessionStatsPublisher.price()`
(`libs/backend/agent-sdk/src/lib/helpers/live-session-stats-publisher.ts:540-556`)
returns null only when the model row is missing, then calls
`calculateMessageCost`. Other `calculateMessageCost` callers include
`session-stats-owner.service.ts:271`, `session-usage-aggregator.ts:268` and
`session-replay.service.ts:399,889` under `libs/backend/agent-sdk/src/lib`.

When a catalog entry carries no `input_cache_read` field (parsed in
`libs/backend/auth-providers/src/lib/providers/openrouter/openrouter-pricing.service.ts`
and `libs/backend/auth-providers/src/lib/provider-models.service.ts:1289`), every cached
token costs nothing. On a long session cache reads dominate the token count —
measured at 2,761,872 cache-read tokens against 42 uncached input tokens in
`Ptah Electron-2026-09-18.log:195` — so the understatement is not marginal.

The decision to make: does an absent cache rate mean "free" or "unknown"? If
unknown, the turn cost should be null and render "cost unavailable", matching
what an unknown model price now does. That is a behaviour change for every
provider whose catalog entry omits the field, so measure how many entries that
is before choosing.

## Acceptance criteria

1. On the session-stats path, an absent cache rate produces either a documented
   "free" decision or a null cost, with the choice recorded in a comment and
   pinned by a test.
2. `npm run verify -- -p <touched projects>` passes (lint, test, typecheck).

## Current state (2026-11-07)

- Done: the Codex lane no longer drops cached tokens. `laneUsage` maps
  `cachedInputTokens` to `cacheReadTokens` and passes `costUsd` through
  (`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-lane-events.ts:240-249`,
  `ac43b0818`, PR #669). The old `codex-cli.adapter.ts` file is gone.
- Done: lane cost in the renderer returns null when a used cache rate is missing
  (`libs/frontend/chat/src/lib/utils/lane-stats.adapters.ts:146-149`).
- Done: usage-analytics and agent-monitor treat a missing cache price as unknown
  (`e8114e024`).
- Open: `calculateMessageCost` still uses `?? 0` for cache rates
  (`pricing.utils.ts:476,478`), and `live-session-stats-publisher.ts:551` calls it
  without a cache-rate guard. The free-versus-unknown decision is not recorded.

## Origin

Found during TASK_2026_474_5c9f by the Codex pricing audit. Full trace in that
task's `codex-pricing-findings.md`, verdict items 2 and 3.
