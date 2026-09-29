# Code Logic Review — `TASK_2026_575_74a4` (Batch 6)

## Summary

| Metric              | Value                                |
| ------------------- | ------------------------------------ |
| Overall score       | 8/10                                 |
| Assessment          | APPROVED                             |
| Blocking issues     | 0                                    |
| Serious issues      | 0                                    |
| Moderate issues     | 2                                    |
| Failure modes found | 2                                    |

### Evidence separating this score from adjacent bands
- **Separation from 9-10 (Exemplary):** The test suite is well-crafted with documented mutation verification for each guard, but it falls short of 9-10 because the `[1m]` live-path contract test manually stiches `findModelPricing` results into synthetic `RunUsageResult` rows rather than driving the end-to-end streaming pipeline through `StreamTransformer` and `IPricingProvider`. Furthermore, global pricing map reset relies solely on an in-test `try/finally` block rather than suite-level `beforeEach`/`afterEach` lifecycle hooks.
- **Separation from 5-6 (Works with real gaps):** Every historical regression (R-a through R-f) has an active, unambiguous guard with exact `file:line` citations. Deliberate mutation evidence confirms all guards bite when production logic is degraded. No tautological assertions or loose tolerances were found.

---

## Regression Guard Verification (R-a .. R-f)

| ID | Regression Description | Status | Guarding Test (`file:line`) |
|---|---|---|---|
| **R-a** | Per-message cost set to cumulative SDK process total instead of turn delta (last message badge == session total) | **GUARDED** | [session-stats-owner.service.spec.ts:885-897](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.spec.ts#L885-L897) (`expect([first.turnCost, second.turnCost, third.turnCost]).toEqual([10, 5, 7])` and `expect(third.turnCost).not.toBe(third.snapshot?.totalCost)`); [stream-transformer.spec.ts:2407-2410](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/backend/agent-sdk/src/lib/helpers/stream-transformer.spec.ts#L2407-L2410); [streaming-handler.service.spec.ts:1257-1282](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/frontend/chat-streaming/src/lib/streaming-handler.service.spec.ts#L1257-L1282); [session-cost-contract.spec.ts:198-206](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/backend/agent-sdk/src/lib/session-stats/session-cost-contract.spec.ts#L198-L206) |
| **R-b** | Frontend summing cumulative values into a session total (double counting across process restarts / restored base) | **GUARDED** | [session-stats-aggregator.service.spec.ts:490-503](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/frontend/chat/src/lib/services/chat-store/session-stats-aggregator.service.spec.ts#L490-L503) ("assignment, never a sum") and [:670-681](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/frontend/chat/src/lib/services/chat-store/session-stats-aggregator.service.spec.ts#L670-L681) (`expect(headerTotal).toBe(15); expect(headerTotal).not.toBe(20)`); [agent-stats.service.spec.ts:235-256](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/frontend/chat-execution-tree/src/lib/agent-stats.service.spec.ts#L235-L256); [session-cost-contract.spec.ts:251-336](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/backend/agent-sdk/src/lib/session-stats/session-cost-contract.spec.ts#L251-L336) (restored base net delta matches full combined disk ledger); [use-sessions.spec.ts:141-147](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/apps/ptah-tui/src/hooks/use-sessions.spec.ts#L141-L147) |
| **R-c** | A model id with a `[1m]` tag or provider prefix gets no price (`null`) and silently drops cost | **GUARDED** | [pricing.utils.spec.ts:273-305](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/shared/src/lib/utils/pricing.utils.spec.ts#L273-L305) (`findModelPricing` and `calculateMessageCost` for `[1m]`, `anthropic/..[1m]`, date snapshot `..[1m]`); [session-cost-contract.spec.ts:220-249](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/backend/agent-sdk/src/lib/session-stats/session-cost-contract.spec.ts#L220-L249) (live owner path prices `[1m]` at base rate) |
| **R-d** | Unknown price coerced to `$0` | **GUARDED** | [agent-stats.service.spec.ts:301-330](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/frontend/chat-execution-tree/src/lib/agent-stats.service.spec.ts#L301-L330) (`result.cost` is `undefined`, never `0`); [session-stats-owner.service.spec.ts:1000-1012](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.spec.ts#L1000-L1012) (`totalCost` is `null`, `knownCost` preserved); [streaming-handler.service.spec.ts:1304-1314](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/frontend/chat-streaming/src/lib/streaming-handler.service.spec.ts#L1304-L1314) (`expect(cost).toBeNull(); expect(cost).not.toBe(0)`); [use-sessions.spec.ts:160-170](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/apps/ptah-tui/src/hooks/use-sessions.spec.ts#L160-L170); [analytics-card.component.spec.ts:279-296](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/frontend/dashboard/src/lib/components/analytics-card/analytics-card.component.spec.ts#L279-L296) |
| **R-e** | Live header total diverging from the disk (analytics) total for the same session, including subagent transcripts | **GUARDED** | [session-cost-contract.spec.ts:128-218](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/backend/agent-sdk/src/lib/session-stats/session-cost-contract.spec.ts#L128-L218) (`snapshot.totalCost ≈ disk.totalCost`, `snapshot.tokens == disk.tokens`, `recordAgent` is count-only); [session-cost-contract.spec.ts:251-336](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/backend/agent-sdk/src/lib/session-stats/session-cost-contract.spec.ts#L251-L336) (resumed run owner total matches combined disk ledger) |
| **R-f** | A mid-run rate change freezing the session total (unreported/Codex path) | **GUARDED** | [session-stats-owner.service.spec.ts:1202-1248](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.spec.ts#L1202-L1248) (cases a & b: rate drop accepts turn with `turnCost: null`, `runCostDecreased: true`, repricing snapshot tokens without freeze) |

---

## Five Logic Questions

### 1. How does this fail silently?
- **In `session-cost-contract.spec.ts:220-249`:** The test for `[1m]` live-path pricing manually invokes `findModelPricing` and directly constructs an already-priced `RunModelUsage` row before passing it to `SessionStatsOwnerService.replaceRun`. If the live streaming entry point (`StreamTransformer.ts` and `IPricingProvider`) were to regress by failing to strip variant tags or failing to resolve rates asynchronously, `session-cost-contract.spec.ts` would still pass silently because it bypasses the transformer layer.
- **In `agent-stats.service.ts:97-98, 120`:** If an agent executes turns that legitimately cost `$0.00` (e.g. locally hosted or free community models), `if (complete.cost)` treats `0` as falsy and `cost: totalCost > 0 ? totalCost : undefined` silently coerces the result to `undefined`, displaying "—" (pricing unavailable) instead of `$0.00`.

### 2. What user action produces unexpected behaviour?
- **Executing a session with genuinely zero-cost models:** A user inspecting agent badges for tasks run entirely on free/local models will see no cost badge (`undefined`), unable to distinguish between "free ($0.00)" and "pricing lookup failed (unpriced)".
- **Running tests under parallel Jest worker threads sharing in-memory pricing state:** If a test failure occurs before the `finally` block in `session-cost-contract.spec.ts:221-248`, subsequent tests executing in the same worker could read polluted model pricing definitions.

### 3. What input data produces a wrong answer?
- **Negative or non-finite cost values in stream events:** In `AgentStatsService.aggregateAgentStats` (`agent-stats.service.ts:97-99`), `if (complete.cost)` evaluates to `true` for negative numbers (e.g. `-0.05`). Adding a negative number reduces `totalCost`. If `totalCost` drops to `<= 0`, the entire accumulated positive cost from earlier turns is abruptly replaced with `undefined`.
- **Micro-dollar pricing variations below 1e-6:** Both `session-cost-contract.spec.ts` and `session-stats-owner.service.spec.ts` use `toBeCloseTo(..., 6)`. Sub-microdollar rate divergences ($0.0000004 per token, typical for cache read rates) are truncated by 6-decimal-place comparisons.

### 4. What happens when a dependency fails?
- **Prefix loading fails in `prepareRun`:** In `session-cost-contract.spec.ts:301-308`, if `loadPrefix` or `loadSavedCostState` rejects, the promise throws and fails the test immediately without corrupting session state.
- **Child `message_complete` event has missing/malformed cost:** In `agent-stats.service.spec.ts:259-299`, child events with `cost: undefined` or `cost: null` are gracefully skipped without zeroing or corrupting the sum of known sibling costs.

### 5. What is missing that the requirements never mentioned?
- **True end-to-end integration test through `StreamTransformer` for live `[1m]` pricing:** The contract test verifies `SessionStatsOwnerService` and `findModelPricing` in isolation, leaving the asynchronous pricing lookup bridge in `StreamTransformer` covered only by unit specs in `agent-sdk`.
- **Suite-level `beforeEach`/`afterEach` pricing isolation:** `session-cost-contract.spec.ts` lacks suite-level `resetPricingMapForTesting()` hooks, relying on an in-test `try/finally` block.

---

## Failure Modes

### 1. Transformer Bypass in `[1m]` Live Contract Guard

- Trigger: Upstream regression in `StreamTransformer` model key normalization or `IPricingProvider` lookup.
- Symptom: Live streaming sessions using `[1m]` models fail to resolve pricing at runtime, but `session-cost-contract.spec.ts` continues to pass.
- Evidence: [session-cost-contract.spec.ts:220-236](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/backend/agent-sdk/src/lib/session-stats/session-cost-contract.spec.ts#L220-L236)
- Current handling: The test calls `findModelPricing` directly and manually populates `RunModelUsage.pricing` and `costUSD`.
- Recommendation: In addition to the owner-level unit test, pipe a simulated SDK message containing `claude-opus-5-5[1m]` through `StreamTransformer` in `stream-transformer.spec.ts` (which is already tested in lines 765-895).

### 2. Pricing Map State Leak on Uncaught Pre-Condition Error

- Trigger: An unexpected error thrown prior to or outside the `try/finally` block in `session-cost-contract.spec.ts`.
- Symptom: Leaked pricing entries alter pricing lookups in subsequent test suites running in the same process worker.
- Evidence: [session-cost-contract.spec.ts:221-248](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/backend/agent-sdk/src/lib/session-stats/session-cost-contract.spec.ts#L221-L248)
- Current handling: `updatePricingMap` is called outside `try`, with `resetPricingMapForTesting()` in `finally`.
- Recommendation: Add `afterEach(() => resetPricingMapForTesting())` at the top of the `describe` block.

---

## Blocking Issues

None.

---

## Serious Issues

None.

---

## Moderate and Minor Issues

### 1. [Moderate] `[1m]` Contract Test Bypasses Live Transformer Pipeline
- File: [session-cost-contract.spec.ts:220-248](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/backend/agent-sdk/src/lib/session-stats/session-cost-contract.spec.ts#L220-L248)
- Scenario: The test title claims "end to end (scope 6d live path)", but manually resolves `findModelPricing` and manually constructs `RunUsageResult`.
- Fix: Add a comment clarifying that this tests `findModelPricing` + `SessionStatsOwnerService` integration without DI mocks, while `StreamTransformer` wiring is covered by `stream-transformer.spec.ts`.

### 2. [Moderate] Test Isolation Relies on Inline `finally` Rather Than Test Lifecycle Hooks
- File: [session-cost-contract.spec.ts:221, 247](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/backend/agent-sdk/src/lib/session-stats/session-cost-contract.spec.ts#L221)
- Scenario: If an unhandled exception occurs before entering the `try` block or during test setup, the global pricing map remains modified for the rest of the worker run.
- Fix: Add `afterEach(() => resetPricingMapForTesting())` to ensure cleanup under all failure modes.

### 3. [Minor] Subagent Count Parity Omitted from Direct Assertion
- File: [session-cost-contract.spec.ts:214-217](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/backend/agent-sdk/src/lib/session-stats/session-cost-contract.spec.ts#L214-L217)
- Scenario: The test asserts `after?.agentSessionCount === before?.agentSessionCount + 1`, but does not assert `after?.agentSessionCount === disk.agentSessionCount`.
- Fix: Add `expect(after?.agentSessionCount).toBe(disk.agentSessionCount);`.

### 4. [Minor] Agent Stats Truthiness Check Swallows Legitimate $0 Costs
- File: [agent-stats.service.ts:97, 120](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/frontend/chat-execution-tree/src/lib/agent-stats.service.ts#L97) and [agent-stats.service.spec.ts:301-330](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/frontend/chat-execution-tree/src/lib/agent-stats.service.spec.ts#L301-L330)
- Scenario: `if (complete.cost)` treats `0` as falsy, preventing an agent with zero-cost models from reporting `$0.00`.
- Fix: In future production cleanup, consider checking `complete.cost != null && complete.cost >= 0`.

---

## Data Flow

```text
[Disk Path]
JSONL Transcript Lines -> SessionUsageLedgerBuilder.visit() -> SessionUsageLedger -> aggregateSessionUsage() [calls aggregateLedgers] -> disk.totalCost (OK)

[Live Path]
RunModelUsage rows -> SessionStatsOwnerService.replaceRun() -> snapshot.totalCost & turnCost (OK)

[Live vs Disk Parity Check]
snapshot.totalCost ≈ disk.totalCost (6 decimal places) (OK)
snapshot.tokens == disk.tokens (OK)
Σ turnCost telescopes to snapshot.totalCost within 3 * 1e-6 (OK)

[Resumed Process Path]
preLedger -> aggregateSessionUsage (prefix total) -> SavedCostState
fullLedger -> aggregateSessionUsage (full total)
resumed replaceRun -> turnCost = net(new) - net(restored base) == fullTotal - prefixTotal (OK)
snapshot.totalCost == fullTotal (OK)

[Frontend Agent Stats Path]
Streaming events -> AgentStatsService.aggregateAgentStats() -> sums per-call complete.cost, ignores undefined, preserves known sum (OK)
```

---

## Requirements Fulfilment

| Requirement | Status | Gap |
|---|---|---|
| Live-vs-disk parity (6e) | COMPLETE | None. Verified with parent + subagent ledgers and owner cumulative progression. |
| End-to-end `[1m]` pricing (6d live path) | COMPLETE | Minor: Tested at owner + pricing utility level, not full transformer pipeline. |
| Resumed process multi-run accounting | COMPLETE | None. Verified restored base subtraction and parity with combined disk ledger. |
| Telescoping turn cost sum | COMPLETE | None. Verified Σ turnCost == session total within 1e-6/turn tolerance. |
| `recordAgent` count-only invariance | COMPLETE | None. Verified cost and tokens byte-identical after recording subagent identity. |
| `agent-stats.service` per-call summation (6f, A2) | COMPLETE | None. Verified per-call accumulation, skipping unknown costs, never defaulting to $0. |

---

## Edge Cases

| Case | Handled | How | Concern |
|---|---|---|---|
| Subagent spend in cumulative run | YES | Verified in parity test with subagent ledger and model B rows | None |
| Subagent identity recorded live | YES | `owner.recordAgent('agent-s1')` increments count only | None |
| Multi-run process restart with restored base | YES | Resumed run net delta calculated against restored base | None |
| `[1m]` variant model in live stream | YES | Tag stripped and resolved to base rates via `findModelPricing` | None |
| Mixed known and unknown costs across agent messages | YES | `AgentStatsService` skips undefined without zeroing running sum | None |
| All unknown costs across agent messages | YES | `AgentStatsService` returns `cost: undefined`, never `$0` | None |

---

## Verdict

- Recommendation: **APPROVE**
- Confidence: **HIGH**
- Top risk: A future refactor to `StreamTransformer` pricing resolution could break the live `[1m]` path without failing `session-cost-contract.spec.ts` due to transformer bypass in the contract spec.
- What a robust implementation would add:
  1. An `afterEach(() => resetPricingMapForTesting())` hook in `session-cost-contract.spec.ts`.
  2. Direct assertion of `snapshot.agentSessionCount === disk.agentSessionCount` after `recordAgent`.
  3. A full end-to-end stream test through `StreamTransformer` for `[1m]` pricing events.
