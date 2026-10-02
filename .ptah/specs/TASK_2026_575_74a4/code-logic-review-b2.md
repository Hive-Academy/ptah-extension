# Code Logic Review — `TASK_2026_575_74a4` (Batch 2)

## Summary

| Metric              | Value                                |
| ------------------- | ------------------------------------ |
| Overall score       | 7/10                                 |
| Assessment          | NEEDS_REVISION                       |
| Blocking issues     | 0                                    |
| Serious issues      | 1                                    |
| Moderate issues     | 2                                    |
| Failure modes found | 3                                    |

The Batch 2 changes successfully fix the primary defect where cumulative process spend was published as per-message cost, implement clean telescoping delta accounting (`turnCost = net(new) - net(previous accepted)`), cleanly rename the wire field from `cost` to `turnCost`, and update all relevant backend tests to strictly pin the new semantics.

However, revision is required before merging because:
1. **Serious:** A duplicate result (`outcome === 'duplicate'`) emits `turnCost: 0` ([session-stats-owner.service.ts:496-497](../../../libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts#L496-L497)), which causes frontend message handlers ([streaming-handler.service.ts:649](../../../libs/frontend/chat-streaming/src/lib/streaming-handler.service.ts#L649)) to overwrite an already-finalized non-zero message cost (e.g. $0.45) with $0.00 upon receiving a duplicate stream completion or repeat result.
2. **Moderate:** On the `unreported` (rate-card priced) route, clamping negative deltas to zero via `nonNegativeUsd(now - before)` ([session-stats-owner.service.ts:768](../../../libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts#L768)) masks rate card changes or catalog discrepancies, silently reporting a $0 turn cost for consumed tokens and breaking telescoping ($\sum \text{turnCost} \ne \text{snapshot.totalCost}$).
3. **Moderate:** The first accepted turn of a run without a restored base ([session-stats-owner.service.ts:764](../../../libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts#L764)) returns raw `now` without passing through `nonNegativeUsd(now)`, introducing arbitrary float precision differences between turn 1 and turns 2+.

---

## Five logic questions

### 1. How does this fail silently?
- **Silent message zeroing on duplicate events:** When the SDK sends a duplicate result message (e.g., an identical cumulative usage result sent upon stream completion flush or retry), [SessionStatsOwnerService.replaceRun](../../../libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts#L496-L497) returns `turnCost: 0`. [StreamTransformer](../../../libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts#L748-L763) publishes this as a valid `SESSION_STATS` event. The consumer in [StreamingHandlerService.mergeStatsOntoLastAssistant](../../../libs/frontend/chat-streaming/src/lib/streaming-handler.service.ts#L649) mutates the tab's last assistant message with `cost: stats.turnCost`, overwriting the actual turn spend (e.g., $0.35) with `$0.00`.
- **Silent rate discontinuity masking:** If model pricing rates decrease mid-session on an `unreported` run (e.g., dynamic rate catalog reload), `now - before` evaluates to a negative number. [acceptedTurnCost](../../../libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts#L768) executes `nonNegativeUsd(now - before)` which clamps the negative delta to `0`. The user is told the turn cost `$0.00` despite generating tokens, and the cumulative sum of published turn costs no longer equals the session total.

### 2. What user action produces unexpected behaviour?
- **User triggers a query whose SDK process emits duplicate result flushes:** When a query produces a duplicate result (or an identical result frame across a reconnection), the message badge previously displaying the turn's cost silently flips to `$0.00`.
- **User initiates multiple turns across catalog updates:** If pricing metadata changes during an active session on proxied models, the user sees `$0.00` on turns where hundreds of output tokens were generated.

### 3. What input data produces a wrong answer?
- **Unrounded floating point numbers on Turn 1:** If Claude SDK reports `total_cost_usd: 0.0012345678` on the very first turn of a fresh run (`base === null`), [session-stats-owner.service.ts:764](../../../libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts#L764) executes `if (previous === null) return now;` which returns `0.0012345678` unrounded. On Turn 2, `acceptedTurnCost` executes `nonNegativeUsd(now - before)` which rounds to 6 decimal places (`0.001235`). Turn 1 leaks raw unrounded float decimals to the UI while Turn 2 is rounded to $10^{-6}$.

### 4. What happens when a dependency fails?
- **SDK sends malformed / non-monotonic results:** Handled correctly. If SDK sends negative tokens, non-finite costs, or decreased token counts, [applyResult](../../../libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts#L724-L734) marks the result `rejected-invalid` or `rejected-non-monotonic`. `turnCost` is `null` ([session-stats-owner.service.ts:495](../../../libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts#L495)), keeping the existing accepted snapshot and refusing to publish corrupt numbers.
- **Model pricing lookup fails (unpriced model):** Handled correctly. [subtractRunBase](../../../libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts#L271-L274) sets `totalCost: null`, and [acceptedTurnCost](../../../libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts#L763) sets `turnCost: null`. The UI never receives `$0.00` for an unpriced model.

### 5. What is missing that the requirements never mentioned?
- **Duplicate Result Semantics:** Requirements stated `duplicate -> 0` under the assumption that a duplicate represents a zero delta in the abstract. However, in stream processing, a duplicate `result` message belongs to an *already processed* turn, not a new turn with zero spend. Publishing `turnCost: 0` causes downstream consumers to overwrite the message's true cost with zero.
- **Validation of `turnCost` in `validateStats`:** [validateStats](../../../libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts#L243-L265) was updated to check `sdkCost`, but does not validate that `stats.turnCost` is finite and non-negative when non-null.

---

## Failure modes

### FM-1: Duplicate Result Message Zeros Out Last Assistant Message Cost
- **Trigger:** SDK stream emits a duplicate result message with identical cumulative usage for an existing turn, or a repeat result event is re-broadcast.
- **Symptom:** The assistant message cost badge changes from its genuine spend (e.g. `$0.42`) to `$0.00`.
- **Evidence:** 
  - [session-stats-owner.service.ts:496-497](../../../libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts#L496-L497):
    ```typescript
    if (outcome === 'duplicate') {
      turnCost = 0;
    }
    ```
  - [stream-transformer.ts:748-763](../../../libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts#L748-L763): `turnCost: 0` is packed into `rawStats` and dispatched to `onResultStats`.
  - [streaming-handler.service.ts:649](../../../libs/frontend/chat-streaming/src/lib/streaming-handler.service.ts#L649): `messages[lastAssistantIndex].cost = stats.turnCost;` overwrites the message cost.
- **Current handling:** Sets `turnCost = 0` on duplicate.
- **Recommendation:** A duplicate outcome means nothing has changed and no new turn spend occurred. Either:
  1. `replaceRun` should return `turnCost: null` on `outcome === 'duplicate'` (indicating no turn cost delta is available to assign to a message), OR
  2. `StreamTransformer` should skip calling `onResultStats` when `outcome === 'duplicate'`, because the snapshot is unchanged and there is no new turn spend to publish.

### FM-2: Negative Delta Clamping Breaks Telescoping on Rate Card Changes
- **Trigger:** Model pricing rate card changes between turn $N-1$ and turn $N$ on an `unreported` run (e.g. rate drops from $0.02 to $0.01 per token).
- **Symptom:** Turn $N$ publishes `turnCost: 0` despite output tokens being produced. The sum of all published message costs diverges from `sessionStats.totalCost`.
- **Evidence:**
  - [session-stats-owner.service.ts:762-768](../../../libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts#L762-L768):
    ```typescript
    const now = subtractRunBase(accepted, base).totalCost;
    if (now === null) return null;
    if (previous === null) return now;
    const before = subtractRunBase(previous, base).totalCost;
    if (before === null) return null;
    return nonNegativeUsd(now - before);
    ```
  - Numerical scenario:
    - Base: 0 tokens.
    - Turn 1: 100 tokens @ $0.02 = $2.00 (`now = 2.00`, `turnCost = 2.00`).
    - Turn 2: 110 tokens @ $0.01 = $1.10 (`now = 1.10`).
    - `now - before = 1.10 - 2.00 = -0.90`.
    - `nonNegativeUsd(-0.90) = Math.max(0, -0.90) = 0`.
    - Published turn costs: Turn 1 = $2.00, Turn 2 = $0.00.
    - Snapshot `totalCost`: $1.10.
    - $\sum \text{turnCost} = \$2.00 \ne \$1.10$.
- **Current handling:** `Math.max(0, now - before)` clamps negative difference to 0.
- **Recommendation:** Differentiate float epsilon noise from genuine pricing discrepancies. If `now - before < -1e-6`, re-evaluate `before` using `accepted`'s rate card (since monotonic token growth ensures $(tokens_{accepted} - tokens_{previous}) \times rate \ge 0$). If pricing data cannot be re-evaluated, return `turnCost: null`.

### FM-3: First Turn Float Precision Inconsistency
- **Trigger:** First accepted result of a run with `base === null` produces a fractional cost with more than 6 decimal places from the SDK (e.g., Claude `total_cost_usd = 0.00012345`).
- **Symptom:** Turn 1 displays raw unrounded precision (8 decimal places), while Turn 2 displays 6 decimal places.
- **Evidence:**
  - [session-stats-owner.service.ts:764](../../../libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts#L764):
    ```typescript
    if (previous === null) return now;
    ```
  - When `base === null`, `subtractRunBase(accepted, null)` returns `accepted` directly ([session-stats-owner.service.ts:228](../../../libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts#L228)), so `now` is not rounded. In contrast, line 768 passes `now - before` through `nonNegativeUsd`, which rounds to 1e-6.
- **Current handling:** Returns unrounded `now`.
- **Recommendation:** Change line 764 to:
  ```typescript
  if (previous === null) return nonNegativeUsd(now);
  ```

---

## Blocking issues

*None.* The codebase builds cleanly, types align across the 3 affected libraries, and regression tests pass.

---

## Serious issues

### Issue 1: Duplicate Result Message Causes Message Cost To Be Overwritten With 0
- **File:** [libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts:496-497](../../../libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts#L496-L497) and [libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts:748-763](../../../libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts#L748-L763)
- **Scenario:** The SDK or runtime emits a duplicate result message at the end of a turn (identical token counts and cost).
- **Impact:** `replaceRun` sets `turnCost: 0`. `StreamTransformer` emits this as `session:stats`. The frontend streaming handler updates the last assistant message with `cost: 0`, destroying the displayed cost for that message.
- **Fix:** In `session-stats-owner.service.ts`, set `turnCost = null` for `outcome === 'duplicate'`, or in `stream-transformer.ts`, do not invoke `onResultStats` when `offered.outcome === 'duplicate'`.

---

## Moderate and minor issues

### Issue 2: Negative Delta Clamping on Rate Card Change (Moderate)
- **File:** [libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts:768](../../../libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts#L768)
- **Scenario:** Rate card drops on an unreported run, making `now < before`.
- **Fix:** If `now - before < -1e-6`, re-evaluate previous tokens against current rates or return `turnCost: null`.

### Issue 3: Turn 1 Cost Unrounded When Base is Null (Moderate)
- **File:** [libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts:764](../../../libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts#L764)
- **Scenario:** Fresh run first result has >6 decimal digits from SDK.
- **Fix:** Change to `if (previous === null) return nonNegativeUsd(now);`.

### Issue 4: Inactive Backend Consumer Still References `.cost` (Minor)
- **File:** [libs/backend/agent-sdk/src/lib/session-metadata-store.ts:906, 942](../../../libs/backend/agent-sdk/src/lib/session-metadata-store.ts#L906)
- **Scenario:** `addStats()` method in `SessionMetadataStore` takes `{ cost: number }` and adds `stats.cost`.
- **Impact:** Method has no production callers (verified by grep; only tested in `session-metadata-store.spec.ts`), but represents dead code with obsolete field semantics.

---

## Data flow

1. **Entry (SDK Message):** `StreamTransformer.transformStream` receives SDK message with `type: 'result'` ([stream-transformer.ts:630](../../../libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts#L630)). **[OK]**
2. **Cumulative Total Resolution:** For `reported`, `totalCost = sdkMessage.total_cost_usd`; for `unreported`, sums `row.costUSD` from `calculateMessageCost` ([stream-transformer.ts:643-656](../../../libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts#L643-L656)). **[OK]**
3. **Owner Processing:** `statsOwner.replaceRun` called with cumulative `totalCost` and `runModels` ([stream-transformer.ts:689-703](../../../libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts#L689-L703)). **[OK]**
4. **Base & Delta Derivation:** `acceptedTurnCost` calculates `now = subtractRunBase(accepted, run.base).totalCost` and `before = subtractRunBase(previous, run.base).totalCost` ([session-stats-owner.service.ts:757-769](../../../libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts#L757-L769)). **[GAP: First turn unrounded; duplicate returns 0; rate changes clamp to 0]**
5. **Snapshot Publication:** `snapshot = this.publish(sessionId, state)` merges run contributions and prefix via `aggregateSessionUsage` ([session-stats-owner.service.ts:645-694](../../../libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts#L645-L694)). **[OK]**
6. **Payload Construction:** `rawStats` constructed with `turnCost: offered.turnCost`, `tokens: sdkTokens`, `duration: sdkMessage.duration_ms` ([stream-transformer.ts:748-755](../../../libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts#L748-L755)). **[OK - never publishes cumulative total]**
7. **Transport Dispatch:** `sdk-callbacks.ts` broadcasts `MESSAGE_TYPES.SESSION_STATS` carrying `turnCost` and `sessionStats` ([sdk-callbacks.ts:404-411](../../../libs/backend/cli-agent-runtime/src/lib/wiring/sdk-callbacks.ts#L404-L411)). **[OK]**

---

## Requirements fulfilment

| Requirement | Status | Gap |
| ----------- | ------ | --- |
| R1 Delta arithmetic net of base | COMPLETE | Telescoping arithmetic verified; first turn unrounded when base is null. |
| R2 Wire field rename | COMPLETE | `cost` renamed to `turnCost: number \| null` on `ResultStatsPayload`. |
| R3 Subagent spend inclusion | COMPLETE | `modelUsage` covers subagents; per-turn `turnCost` covers subagents while `tokens` is main loop. |
| R4 Non-accepted outcomes never republish cumulative | COMPLETE | Cumulative total is never republished as message cost. |
| R4 Duplicate outcome handling | PARTIAL | `duplicate -> 0` causes message cost zeroing in UI. |
| R5 Pinning tests replace wrong expectations | COMPLETE | `stream-transformer.spec.ts` and `session-stats-owner.service.spec.ts` strictly pin new behavior. |

Implicit requirements not addressed:
- Downstream protection against zeroing existing message costs on duplicate result events.

---

## Edge cases

| Case | Handled | How | Concern |
| ---- | ------- | --- | ------- |
| First accepted turn with restored base | YES | `subtractRunBase(accepted, run.base)` subtracts saved base tokens/dollars | None. |
| Process reset (counters shrunk below saved base) | YES | `resolveRunBase` returns `null`; first turn billed as full new cumulative | None. |
| Model switch / new process (`runToken`) | YES | New `RunState` created; first turn measured against own base | None. |
| Unpriced model in result | YES | `subtractRunBase` sets `totalCost: null`; `acceptedTurnCost` returns `null` | None (never returns 0). |
| Mixing priced and unpriced models | YES | `turnCost: null`, `sessionStats.totalCost: null`, `knownCost` preserved | None. |
| Duplicate result event | NO | Returns `turnCost: 0` | Overwrites real message cost with 0 in UI. |
| Negative delta from rate card decrease | NO | Clamps to 0 with `Math.max(0, ...)` | Falsifies turn cost and breaks telescoping. |
| Rounding drift over 500 turns | YES | Maximum theoretical drift $\le 0.025$ cents ($500 \times 0.5\mu\$$) | Well within 1 cent. |

---

## Verdict

- **Recommendation:** REVISE (NEEDS_REVISION)
- **Confidence:** HIGH
- **Top risk:** Receiving a duplicate result event at turn completion overwrites the user's message cost badge with `$0.00`.
- **What a robust implementation would add:**
  1. In `session-stats-owner.service.ts`: return `turnCost: null` on `outcome === 'duplicate'`, OR in `stream-transformer.ts`: do not dispatch `onResultStats` on duplicate outcomes.
  2. In `session-stats-owner.service.ts:764`: wrap `now` in `nonNegativeUsd(now)` when `previous === null`.
  3. In `session-stats-owner.service.ts:768`: check for material negative delta (`now - before < -1e-6`) and either reprice `previous` using `accepted`'s rate card or return `null`.
