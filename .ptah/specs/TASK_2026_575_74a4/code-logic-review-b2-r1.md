# Code Logic Review — `TASK_2026_575_74a4` (Batch 2, Revision 1)

## Summary

| Metric              | Value                                |
| ------------------- | ------------------------------------ |
| Overall score       | 8/10                                 |
| Assessment          | APPROVED                             |
| Blocking issues     | 0                                    |
| Serious issues      | 0                                    |
| Moderate issues     | 1                                    |
| Failure modes found | 1                                    |

The Round 1 revision resolves all critical and serious defects identified in the initial review. Specifically:
1. **Duplicate Result Overwrite (Earlier Serious):** FIXED. [SessionStatsOwnerService.replaceRun](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts#L495) now yields `turnCost: null` on `outcome === 'duplicate'`, and [StreamTransformer](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts#L761-L764) suppresses dispatching `onResultStats` for duplicate results. The wire contract on [ResultStatsPayload](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/shared/src/lib/types/agent-adapter.types.ts#L38-L55) now explicitly guarantees that every emitted payload represents its own distinct turn.
2. **Negative Delta Clamping (Earlier Moderate):** FIXED in delta arithmetic. [acceptedTurnCost](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts#L793-L796) checks for decreases greater than `TURN_COST_NOISE_USD` (1e-6); when detected, it sets `turnCost: null` and flags `runCostDecreased: true`, which [StreamTransformer](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts#L720-L724) logs as a warning.
3. **Turn 1 Float Precision (Earlier Moderate):** FIXED. [session-stats-owner.service.ts:787](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts#L787) routes the first turn through `nonNegativeUsd(now)`, and a 500-turn test ([session-stats-owner.service.spec.ts:1067-1081](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.spec.ts#L1067-L1081)) pins drift tolerance to $\le 1\mu\$$ per turn.
4. **Dead Code / Consumer Audit (Earlier Minor):** FIXED. Obsolete `addStats` and `propagateStatsToParent` methods were deleted from [session-metadata-store.ts](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/backend/agent-sdk/src/lib/session-metadata-store.ts#L889).
5. **Turn Cost Bounds Validation (Earlier Minor):** FIXED. [StreamTransformer.validateStats](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts#L262-L274) rejects payloads with negative, NaN, or non-finite `turnCost`.

One residual edge case is noted below regarding pre-existing `isGrown` behavior during mid-run rate drops on unreported routes without a base, which is non-blocking for Batch 2.

---

## Status of earlier findings

| Finding | Severity | Status | Verification & Evidence |
| ------- | -------- | ------ | ----------------------- |
| **Finding 1:** Duplicate result overwrites message cost with 0 in UI | Serious | **FIXED** | [session-stats-owner.service.ts:495](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts#L495) sets `turnCost: null` on duplicate; [stream-transformer.ts:761-764](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts#L761-L764) suppresses `onResultStats`; verified by `it('a duplicate result is not published...')` in [stream-transformer.spec.ts:2898](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/backend/agent-sdk/src/lib/helpers/stream-transformer.spec.ts#L2898). |
| **Finding 2:** Clamping negative deltas to 0 on rate decrease breaks telescoping | Moderate | **FIXED** | [session-stats-owner.service.ts:793-796](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts#L793-L796) sets `turnCost: null` and `runCostDecreased: true`; [stream-transformer.ts:720](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts#L720) logs warning; verified by specs at :1110 and :2944. |
| **Finding 3:** First turn unrounded when base is null | Moderate | **FIXED** | [session-stats-owner.service.ts:787](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts#L787) applies `nonNegativeUsd(now)` on `previous === null`; 500-turn test proves drift $\le 500\mu\$$. |
| **Finding 4:** Inactive `SessionMetadataStore.addStats` still reading `.cost` | Minor | **FIXED** | Deleted from [session-metadata-store.ts](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/backend/agent-sdk/src/lib/session-metadata-store.ts#L889) and [session-metadata-store.spec.ts](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/backend/agent-sdk/src/lib/session-metadata-store.spec.ts#L1525). |
| **Finding 5:** `validateStats` lacked validation on `turnCost` | Minor | **FIXED** | [stream-transformer.ts:262-274](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts#L262-L274) drops payload if `stats.turnCost < 0` or `!Number.isFinite(stats.turnCost)`. |

---

## Five logic questions

### 1. How does this fail silently?
If a model's rate is lowered mid-session while running an `unreported` query without a restored base (`base === null`), [isGrown](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts#L927-L933) checks `next.totalCost < prev.totalCost`. Because the new rate lowered the dollar total, `isGrown` returns `false`, causing [applyResult](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts#L732) to return `'rejected-non-monotonic'`. The owner rejects the result, freezing the session stats snapshot at the stale turn's token and cost values until cumulative tokens multiplied by the lower rate exceed the previous dollar total.

### 2. What user action produces unexpected behaviour?
A user running a zero-cost or cached turn (a turn that produces 0 new tokens and 0 spend): because token counters do not advance, [applyResult](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts#L730) treats the result as a `duplicate`. [StreamTransformer](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts#L761) skips emitting `onResultStats`. The frontend message finalizer relies on `completeEvent` from the API call for that message's footer rather than receiving a `SESSION_STATS` event. This is benign (the prior message's cost is preserved, and the zero-cost turn displays "cost unavailable" or its API-level tokens).

### 3. What input data produces a wrong answer?
None found. Floating-point noise is clamped to 0 up to $1\mu\$$ (`TURN_COST_NOISE_USD`), and larger negative deltas yield `null` rather than a falsified number. Unpriced models strictly yield `null`.

### 4. What happens when a dependency fails?
- If the SDK query process crashes or emits an error result with 0 usage: [isZeroUsage](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts#L886) flags `ignored-error`, snapshot is retained, and `turnCost` remains `null`.
- If SDK emits negative counters or non-finite costs: [isValidResult](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts#L870) triggers `rejected-invalid`, dropped by owner and transformer.

### 5. What is missing that the requirements never mentioned?
On `unreported` routes, tokens are the authoritative physical quantity, while dollars are a derived projection (`tokens × catalog_rate`). Enforcing cost monotonicity in `isGrown` (`next.totalCost >= prev.totalCost`) conflates token counter monotonicity with rate stability.

---

## Failure modes

### FM-1: Mid-Run Rate Reduction on Fresh Unreported Runs Freezes Session Snapshot
- **Trigger:** Provider pricing catalog updates mid-run on an `unreported` route without a restored base (`base === null`), reducing the price per token for the active model.
- **Symptom:** The next result produces a lower raw `totalCost` despite token counts increasing. The result is rejected as `rejected-non-monotonic`. The session stats owner does not advance `run.current`, freezing session tokens, cost, and duration at the previous turn.
- **Evidence:**
  - [session-stats-owner.service.ts:927-933](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts#L927-L933):
    ```typescript
    if (
      prev.totalCost !== null &&
      next.totalCost !== null &&
      next.totalCost < prev.totalCost
    ) {
      return false;
    }
    ```
  - Numerical scenario:
    - Turn 1: 100 tokens @ $0.02 = $2.00 (`prev.totalCost = 2.00`).
    - Catalog updates: rate drops to $0.01.
    - Turn 2: 120 tokens @ $0.01 = $1.20 (`next.totalCost = 1.20`).
    - `next.totalCost < prev.totalCost` ($1.20 < $2.00) $\to$ `isGrown` returns `false`.
    - Outcome is `rejected-non-monotonic`. Turn 2 is discarded by the owner.
- **Current handling:** Result is rejected as non-monotonic; warning logged once per run.
- **Recommendation (Follow-up / Non-blocking):** On `unreported` routes where `costSource === 'unreported'`, `isGrown` should evaluate token counter monotonicity (`grown.tokens >= m.tokens`) rather than dollar monotonicity, since dollar values are subject to external rate updates.

---

## Blocking issues

*None.*

---

## Serious issues

*None.* (The duplicate result overwrite was completely resolved).

---

## Moderate and minor issues

### Issue 1: `isGrown` Dollar Check on Unreported Route (Moderate)
- **File:** [libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts:927-947](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts#L927-L947)
- **Scenario:** Rate decreases mid-run for a proxied model without a restored base.
- **Fix:** In `isGrown`, bypass the `next.totalCost < prev.totalCost` and `grown.costUSD < m.costUSD` checks when `next.costSource === 'unreported'`, relying strictly on the 4 token class counters.

---

## Data flow

1. **Entry:** SDK emits `type: 'result'` message $\to$ `StreamTransformer.transformStream` ([stream-transformer.ts:634](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts#L634)). **[OK]**
2. **Cost Calculation:** SDK dollars extracted for `reported`, or token counts multiplied by current rate for `unreported` ([stream-transformer.ts:647-660](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts#L647-L660)). **[OK]**
3. **Owner Processing:** `statsOwner.replaceRun` processes cumulative total and model rows ([stream-transformer.ts:693](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts#L693)). **[OK]**
4. **Outcome Branching:**
   - `accepted` $\to$ computes `turnCost = nonNegativeUsd(now - before)` or `null` if decreased ([session-stats-owner.service.ts:793](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts#L793)). **[OK]**
   - `duplicate` $\to$ returns `turnCost: null` ([session-stats-owner.service.ts:495](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts#L495)). **[OK]**
5. **Deduplication Filter:** `StreamTransformer` checks `duplicate` and suppresses `onResultStats` ([stream-transformer.ts:761](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts#L761)). **[OK]**
6. **Validation:** `validateStats` checks `sdkCost` and `turnCost` boundaries ([stream-transformer.ts:252-274](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts#L252-L274)). **[OK]**
7. **Broadcast:** `sdk-callbacks.ts` broadcasts `MESSAGE_TYPES.SESSION_STATS` with validated `turnCost` and authoritative `sessionStats` ([sdk-callbacks.ts:404](file:///D:/projects/ptah-extension/.claude-worktrees/task-575-session-cost/libs/backend/cli-agent-runtime/src/lib/wiring/sdk-callbacks.ts#L404)). **[OK]**

---

## Requirements fulfilment

| Requirement | Status | Gap |
| ----------- | ------ | --- |
| R1 Delta arithmetic net of base | COMPLETE | Telescoping confirmed; first turn rounded to 1e-6; drift tested over 500 turns. |
| R2 Wire field rename | COMPLETE | `turnCost: number \| null` on `ResultStatsPayload`. |
| R3 Subagent spend inclusion | COMPLETE | `modelUsage` covers subagents; `turnCost` covers subagents; `tokens` is main loop. |
| R4 Non-accepted outcomes never republish cumulative | COMPLETE | Cumulative totals never leak to message cost. |
| R4 Duplicate outcome handling | COMPLETE | Suppressed from re-publication; `turnCost: null`. |
| R5 Pinning tests replace wrong expectations | COMPLETE | Tests strictly assert deltas [10, 5], [1, 1], and [3, 2, 3]. |

---

## Edge cases

| Case | Handled | How | Concern |
| ---- | ------- | --- | ------- |
| First turn with `base === null` | YES | Routed through `nonNegativeUsd(now)` | None. |
| Mid-run rate reduction with base | YES | Returns `turnCost: null` + `runCostDecreased: true` | None. |
| Mid-run rate reduction without base | PARTIAL | `isGrown` rejects as non-monotonic | Snapshot freezes until tokens make up the difference (unlikely edge case). |
| Duplicate stream flush / retry | YES | `StreamTransformer` suppresses emission | None (existing message cost preserved). |
| Non-finite or negative `turnCost` | YES | Dropped by `validateStats` | None. |
| Long sessions (500 turns) | YES | Maximum cumulative drift $\le 0.025$ cents | None. |

---

## Verdict

- **Recommendation:** APPROVE
- **Confidence:** HIGH
- **Top risk:** Mid-session catalog rate cuts on proxied routes without a base trigger `rejected-non-monotonic` in `isGrown`.
- **What a robust implementation would add:** Scope `isGrown` dollar monotonicity checks to `costSource === 'reported'` runs, checking token monotonicity only on `unreported` runs.
