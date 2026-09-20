---
status: backlog
type: bugfix
title: Two paths understate cost instead of reporting it unknown
description: >-
  Cached input tokens bill at zero when the catalog entry publishes no cache
  rate, and the rival-CLI Codex lane computes no cost at all while discarding
  its cached-token field. Both understate silently. Neither degrades to "cost
  unavailable", which is the behaviour the rest of the pricing path now has.
labels:
  - pricing
  - agent-sdk
  - cli-agent-runtime
---

# Two paths understate cost instead of reporting it unknown

TASK_2026_474_5c9f established the rule the pricing path now follows: when a
price is unknown, report it unknown. Never present a fabricated or partial
number as a complete one. Two paths still break that rule by understating.

## 1. Cached tokens bill at zero when no cache rate is published

`libs/shared/src/lib/utils/pricing.utils.ts:289-290` bills cache reads at
`resolved.cacheReadCostPerToken ?? 0`.

When the OpenRouter entry carries no `input_cache_read` field
(`openrouter-pricing.service.ts:249-288` parses it when present), every cached
token costs nothing. On a long session cache reads dominate the token count —
measured at 2,761,872 cache-read tokens against 42 uncached input tokens in
`Ptah Electron-2026-09-18.log:195` — so the understatement is not marginal.

The decision to make: does an absent cache rate mean "free" or "unknown"? If
unknown, the turn cost should be null and render "cost unavailable", matching
what an unknown model price now does. That is a behaviour change for every
provider whose catalog entry omits the field, so measure how many entries that
is before choosing.

## 2. The rival-CLI Codex lane computes no cost

`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex-cli.adapter.ts:1104-1113`.

The `turn.completed` event carries
`usage: { input_tokens, cached_input_tokens, output_tokens }`. Note the field
name differs from the chat-provider lane, which uses
`input_tokens_details.cached_tokens`.

`handleTurnCompleted` converts this to a text segment only:

    Usage: ${input} input, ${output} output tokens

`cached_input_tokens` is dropped. No cost is computed. `cli-agent-runtime`
contains no reference to `calculateMessageCost` or `costUSD` at all.

Nothing in the file records a decision to skip cost, so this reads as a gap
rather than a choice. Before building cost plumbing into `cli-agent-runtime`,
settle where a rival-CLI turn's cost would be displayed and whether any surface
asks for it today. A lane with no consumer needs no cost.

## Acceptance criteria

1. An absent cache rate produces either a documented "free" decision or a null
   cost, with the choice recorded in a comment and pinned by a test.
2. The rival-CLI Codex lane either reports cost, or carries a comment stating
   why it does not and which surface would consume it.
3. `cached_input_tokens` is no longer silently discarded.
4. `test`, `typecheck` and `lint` pass for every touched project.

## Origin

Found during TASK_2026_474_5c9f by the Codex pricing audit. Full trace in that
task's `codex-pricing-findings.md`, verdict items 2 and 3.
