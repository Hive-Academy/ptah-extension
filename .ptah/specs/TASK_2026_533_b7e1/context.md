# Context

## User decisions (2026-09-23)

1. The backend is the single authority for session stats (cost, all four token
   classes, per-model rows, agent count). The frontend displays the payload and
   never recalculates a total from messages or execution trees.
2. The design is provider-neutral: it must work for direct Anthropic, the Codex
   proxy and every other provider, with no branch hardcoded to one provider
   beyond "the provider reported a cost" vs "price the reported tokens from the
   rate card by the model's own id".
3. The per-query usage each provider already reports (SDK result `usage`,
   `modelUsage`, `total_cost_usd`; Codex `turn.completed` usage) is the input.

## Scope decision (2026-09-23): lean backend authority

The first implementation-plan.md (about 87 files, persistent accounting
checkpoint, blocked on TASK_2026_418) was rejected as too large. Chosen design:

- A backend session-stats owner keeps, per session: the history prefix from
  `aggregateSessionUsage` at resume, plus the LATEST cumulative result of each
  query run (keyed by `SessionRecord.token`). A new result for a run REPLACES
  the previous one; it is never added. Snapshot = prefix + sum over runs.
- No persistent accounting checkpoint. After a restart, stats rebuild from JSONL
  through the same aggregator, as resume does today.
- Cost authority is a per-query `usageCostSource: 'reported' | 'unreported'`
  flag that replaces the `isDirectAnthropic` branch. No provider-name branches.
- Not blocked by TASK_2026_418. 418 keeps its Codex-proxy normalization and
  context-capacity work; its frontend delta accumulation is superseded.

## Resume combination (correction, 2026-09-23)

An earlier claim that SDK 0.3.278 resets cumulative figures on resume was
wrong: it checked only the project-config save (`lastSessionId`).
`sdk.d.ts:5366/5374` says a resumed session "continues from the totals its
transcript saved, when it has them". The saved totals are the transcript entry
`{"type":"cost-state","totalCostUSD","modelUsage","hasUnknownModelCost"}`,
written at process end. Evidence from local transcripts:

- Claude sessions restore exactly (6100+59839=65939, 65939+5195=71134,
  71134+31694=102828 output tokens).
- Proxy (GLM) sessions sometimes reset (58471 then 22014 with 1316 between).

Rule: history prefix = JSONL aggregate (unchanged). Per resumed run, compare
the first result with the last `cost-state`: if it is at least as large for
every model and every token class, the run restored, and its contribution is
`R - costState`; otherwise the contribution is `R`. A fresh run has base zero.
Inside one run the SDK total never resets: Ptah handles `/clear` natively
(`slash-command-interceptor.ts:37`, `chat-slash-command-router.service.ts:82-96`
end the query; the next message is a new run). So a result is accepted only
when it keeps every accepted model and no counter decreases; anything else is
rejected without a state change (review round 2, N1/F2). Known limit: a
reset whose first result exceeds a tiny saved state in every class reads as
restored; the error is bounded by that saved state.

## Regression history

- COST chip "cost unavailable": regression from `c10d0438f` (2026-09-19,
  TASK_2026_474_5c9f). `subagent-cost.utils.ts:110` changed `node.cost ?? 0` to
  `node.cost ?? null`, and `:201/:208` null the session total when any agent node
  lacks its own cost. Agent nodes carry no cost of their own because the SDK
  folds subagent cost into the parent result total.
- TOKENS chip omits cache-creation since `2b537f44c` (v0.2.32, 2026-05-15).
- AGENTS chip vs strip: different populations; strip filter since `b366e052f`
  (2026-07-14).

## Existing backend accounting paths (to be unified)

- Live: `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts:435-573`
- Resume: `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts:885`
- Sessions list: `libs/backend/agent-sdk/src/lib/session-stats/session-usage-aggregator.ts:108`
- Frontend recalculation (to remove from the panel):
  `libs/shared/src/lib/utils/subagent-cost.utils.ts:163`
