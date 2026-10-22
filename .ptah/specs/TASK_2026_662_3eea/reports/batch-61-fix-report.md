# Batch 61 follow-up: spec compile fixes

## Fixes

- `libs/backend/skill-synthesis/src/lib/lanes/lane-runner.network-backoff.spec.ts:58-64,231-238`: supplied `null` for the fourth `IMcpServerStatus` argument so `backoffs` occupies the fifth `ProviderNetworkBackoffs` argument. The backoff assertions are unchanged.
- `libs/backend/skill-synthesis/src/lib/skill-judge.service.spec.ts:23-29,113-142`: removed the deleted `makeBudgetStub` import and its three uses. All three runner constructions now pass logger, resolver, query (or `null`), and MCP status (`null`) in the current order. Assertions are unchanged.
- `tools/mcp-bench/src/memory-skills/doubles/recorded-lane-runner.spec.ts:188-213`: removed the two obsolete `queueItemId` request fields. The test still compares differing attempt and MCP host state and retains its replay assertion; no test was deleted.
- `tools/mcp-bench/src/memory-skills/doubles/recorded-lane-runner.ts:14-19`: removed `queueItemId` from the explanatory comment. The double had no queue or budget behavior to remove.

## Sweep

Searched `libs`, `tools`, and `apps` TypeScript files for `makeBudgetStub|queueItemId|SkillBudgetStore|SkillQueueStore|new LaneRunnerService\(`. No `makeBudgetStub` or `queueItemId` references remain. The remaining budget/queue store names are comments in migration, memory curator, interface, and test-support files, plus intentionally retained declarations/comments in `skill-synthesis/src/lib/di/tokens.ts`. Other `LaneRunnerService` constructions in the sweep have no removed budget or queue argument; the two backoff constructions and three judge constructions above were the stale calls found.

## Checks

No test, typecheck, lint, build, Nx, or Jest command was run, as required. The orchestrator must run its compile gate.
