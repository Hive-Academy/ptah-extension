# TASK_2026_476_a1c9 — context

## Triage 2026-10-30

Backlog audit after the October refactors: partly delivered, still open.

- Still open: The session-stats path still prices cache hits at zero when the model row lacks cache rates: pricing.utils.ts:415 falls back to `?? 0`, live-session-stats-publisher price() nulls only on a missing model row (no cache-rate guard) and session-stats-owner.service.ts:1118 splits knownCost only on `costUSD === null`. The free-vs-unknown decision for cache pricing is also unrecorded.
- Evidence on main: Delivered in part: codex adapter now emits cacheReadTokens (main:codex-cli.adapter.ts:1284-1296, ac43b0818 / PR #669, 2026-10-09) and usage-analytics + agent-monitor price each request with its own model and treat a missing cache price as unknown (e8114e024, 2026-10-05, usage-pricing.service.ts:33, agent-monitor.store.ts:290). Still open: main:libs/shared/src/lib/utils/pricing.utils.ts:414-415 prices cache hits as `(tokens.cacheHit ?? 0) * (resolved.cacheReadCostPerToken ?? 0)` — absent cache rates bill at zero.
