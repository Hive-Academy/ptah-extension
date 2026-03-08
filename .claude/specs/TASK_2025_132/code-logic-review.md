# Code Logic Review - TASK_2025_132

## Review Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall Score       | 7/10           |
| Assessment          | NEEDS_REVISION |
| Critical Issues     | 2              |
| Serious Issues      | 3              |
| Moderate Issues     | 3              |
| Failure Modes Found | 7              |

---

## The 5 Paranoid Questions

### 1. How does this fail silently?

**Failure Mode A: Nested sub-subagent stats leak into parent aggregation.**
`aggregateAgentStats()` filters events by `event.parentToolUseId === toolCallId`. However, this only matches events that are _direct children_ of the agent's tool call. If a sub-subagent spawns (agent within agent), the sub-subagent's `message_complete` events will have a _different_ `parentToolUseId` (the sub-subagent's Task tool ID, not the parent agent's). So nested sub-subagent events do NOT leak -- this is actually correct. However, this means the displayed stats for an agent do NOT include tokens/cost from sub-subagents it spawned. The user sees incomplete cost data with no indication that sub-subagent costs are excluded. This is a **silent undercount**.

**Failure Mode B: Zero cost from `MessageCompleteEvent.cost` when it is exactly 0.**
At line 974: `if (complete.cost) { totalCost += complete.cost; }`. If `cost` is exactly `0` (e.g., for a cached response), this falsy check skips it. While this doesn't cause a visible error (0 + 0 = 0), it means the `cost` guard at line 995 (`totalCost > 0 ? totalCost : undefined`) would still return `undefined`. This is acceptable behavior, but worth noting.

**Failure Mode C: Cache not invalidated when aggregated stats change during streaming.**
The tree cache uses `events.size` as part of its fingerprint. When a `message_complete` event arrives (changing `events.size`), the cache correctly invalidates. But if the _content_ of an existing event were mutated without changing the map size, the cache would serve stale data. Since events are immutable `readonly` interfaces added to the map, this scenario should not occur -- but there is no explicit guard against it.

### 2. What user action causes unexpected behavior?

**Rapid tab switching during streaming.**
If a user switches between tabs while a subagent is streaming, the tree builder rebuilds using a potentially partially-populated `StreamingState`. The `aggregateAgentStats()` method handles this gracefully (returns `undefined` for missing data, footer hides via `hasStats() && !isStreaming()`). However, if the user switches tabs after streaming completes but before the final `message_complete` with `cost` arrives, the footer might flash briefly with partial data then update.

**Collapsing agent bubble does not hide/show footer inconsistently.**
The footer is rendered outside the `@if (!isCollapsed())` block, meaning it is always visible regardless of collapse state. This is intentionally consistent with the message-bubble pattern. No issue here.

### 3. What data makes this produce wrong results?

**Model ID `claude-sonnet-4-5-20250929` produces "Sonnet 4.5" but `claude-sonnet-4-20250514` produces "Sonnet 4".**
The `formatModelDisplayName()` function checks `lower.includes('4')` AFTER checking `lower.includes('4.5') || lower.includes('4-5')`. For the actual Claude Sonnet 4 model ID `claude-sonnet-4-20250514`, the `4-5` check matches the substring `4-2` in `4-20250514`? No -- `4-5` checks for literal `4-5`, and `4-20250514` does not contain `4-5`. So the code correctly falls through to `lower.includes('4')` returning "Sonnet 4". This is correct.

**CRITICAL: Model ID `claude-3-5-sonnet-20241022` incorrectly maps.**
For this model, `lower.includes('sonnet')` is true. Then `lower.includes('4.5')` is false. Then `lower.includes('4-5')` is false. Then `lower.includes('4')` is false (the string is `claude-3-5-sonnet-20241022` which does NOT contain just `4` by itself -- wait, actually it does NOT contain `4` at all). Then `lower.includes('3.5')` is false. Then `lower.includes('3-5')` -- `claude-3-5-sonnet-20241022` DOES contain `3-5`. So it returns "Sonnet 3.5". This is correct.

**CRITICAL: Model ID `claude-opus-4-5-20251101` analysis.**
`lower.includes('opus')` is true. `lower.includes('4.5')` is false. `lower.includes('4-5')` is true (`opus-4-5`). Returns "Opus 4.5". Correct.

**SERIOUS: Model ID `claude-3-opus-20240229` analysis.**
`lower.includes('opus')` is true. `lower.includes('4.5')` is false. `lower.includes('4-5')` is false. `lower.includes('4')` is false. `lower.includes('3')` -- yes, the string `claude-3-opus-20240229` contains `3`. Returns "Opus 3". Correct.

**CRITICAL FINDING: The `lower.includes('4')` check is overly broad and could match date suffixes.**
Consider a hypothetical model `claude-sonnet-3-20240514`. This contains `sonnet`, does NOT contain `4.5` or `4-5`, but DOES contain `4` (in `20240514`). This would incorrectly return "Sonnet 4" instead of "Sonnet 3" or just "Sonnet". While this may not be a real model today, it is a **latent bug** in the matching logic -- date suffixes can contain any digit.

**CRITICAL FINDING: Real model `claude-3-5-haiku-20241022` check.**
`lower.includes('haiku')` is true. `lower.includes('4.5')` is false. `lower.includes('4-5')` is false. `lower.includes('3.5')` is false. `lower.includes('3-5')` -- yes, `3-5` is in `claude-3-5-haiku-20241022`. Returns "Haiku 3.5". Correct.

BUT: `claude-haiku-3-20240307` (hypothetical). Contains `haiku`. No `4.5`, no `4-5`, no `3.5`, no `3-5`. Falls through to `return 'Haiku'`. This is acceptable.

**CONFIRMED CRITICAL: `claude-3-haiku-20240307` (REAL model from pricing table).**
Contains `haiku`. No `4.5`, no `4-5`. But DOES contain `3.5`? No, string is `claude-3-haiku-20240307`. `3.5` is not present. `3-5`? Not present. Falls to `return 'Haiku'`. But should return "Haiku 3". However the pricing table only has a "Haiku 3" vs "Haiku 3.5" -- the `3-haiku` pattern is Claude 3 Haiku. The function returns "Haiku" for this, missing the version "3". **This is a minor inaccuracy but not a production blocker** since Claude 3 Haiku is legacy and unlikely to appear as a subagent model.

### 4. What happens when dependencies fail?

**TokenBadgeComponent receives `agentTokenUsage()!` with non-null assertion.**
At `inline-agent-bubble.component.ts` line 195: `[tokens]="agentTokenUsage()!"`. The `@if (agentTokenUsage())` guard on line 194 ensures this only renders when `agentTokenUsage()` is non-null. The non-null assertion is safe within the `@if` block. However, Angular's template compiler does not statically verify `@if` guards for non-null assertions. If the signal value changes to null between the `@if` check and the binding evaluation (theoretically impossible in synchronous rendering but worth noting), it would pass `null` to the component.

**DurationBadgeComponent receives `agentDuration()!` with non-null assertion.**
Same pattern at line 199. Same analysis applies. The `@if (agentDuration())` guard makes this safe.

**CostBadgeComponent input is `input.required<number>()`.**
At line 197: `[cost]="agentCost()"` where `agentCost()` is `this.node().cost ?? 0`. Since `agentCost()` always returns a number (defaulting to 0), and the template guard is `@if (agentCost() > 0)`, the required input is always satisfied when rendered. This is safe.

### 5. What's missing that the requirements didn't mention?

1. **Sub-subagent cost rollup**: When Agent A spawns Agent B, Agent A's stats do NOT include Agent B's costs. Users might expect the parent agent's cost to be inclusive. This is not addressed.

2. **Streaming partial stats**: The footer hides during streaming (`!isStreaming()`). This means users cannot see partial token/cost stats while a long-running agent is still working. The requirements say "only display after streaming completes" but users of long-running agents (10+ minutes) might want to see running totals.

3. **Cache token tracking lost in aggregation**: `MessageTokenUsage` includes `cacheRead` and `cacheCreation` fields, but `aggregateAgentStats()` only aggregates `input` and `output`. The aggregated `tokenUsage` returned to the agent node is `{ input, output }` without cache fields. When passed to `TokenBadgeComponent`, the tooltip will only show input/output, missing cache info. This is data loss during aggregation.

4. **No loading/skeleton state**: When a completed agent has no stats (e.g., historical session replay where `MessageCompleteEvent.cost` was not populated), the footer simply does not render. No indication to the user that stats are unavailable vs not yet loaded.

5. **Model change during agent execution**: If an agent is configured with `model: 'inherit'` and the primary session model changes mid-execution (via model switching), the "first non-null model" capture in `aggregateAgentStats` would show the model at the time of the first message, not necessarily the current model. This is actually correct behavior but could confuse users.

---

## Failure Mode Analysis

### Failure Mode 1: Sub-Subagent Cost Undercount

- **Trigger**: Main agent spawns a sub-agent via Task tool. Sub-agent spawns another nested sub-agent.
- **Symptoms**: Parent agent's cost/token footer shows only its own direct message costs, not inclusive of sub-subagent costs. User sees misleadingly low cost for the top-level agent.
- **Impact**: Medium -- Users get incomplete cost visibility for deeply nested agent hierarchies.
- **Current Handling**: Not handled. `aggregateAgentStats` only matches `parentToolUseId === toolCallId`, which correctly scopes to direct children only.
- **Recommendation**: Document this limitation. Consider recursive aggregation in a future enhancement, or add a visual indicator ("excludes sub-agent costs").

### Failure Mode 2: Cache Tokens Dropped During Aggregation

- **Trigger**: Agent messages include `cacheRead` and `cacheCreation` token counts.
- **Symptoms**: Token badge tooltip shows input + output only. Actual cost is correct (since `cost` is aggregated separately), but the token breakdown is incomplete.
- **Impact**: Low -- Primarily informational. Cost display is accurate since it comes from pre-calculated `MessageCompleteEvent.cost`.
- **Current Handling**: `aggregateAgentStats` creates `tokenUsage` as `{ input, output }` only.
- **Recommendation**: Extend aggregation to include `cacheRead` and `cacheCreation` sums. The `MessageTokenUsage` interface supports these fields.

### Failure Mode 3: formatModelDisplayName Date-Digit Collision

- **Trigger**: A model ID like `claude-sonnet-3-20240514` where the date suffix contains digits that match version checks.
- **Symptoms**: Model name displays as "Sonnet 4" instead of "Sonnet" or "Sonnet 3" because `lower.includes('4')` matches `4` in the date `20240514`.
- **Impact**: Low for current model IDs (all known IDs produce correct output). Medium for future model IDs.
- **Current Handling**: Uses broad `includes()` checks.
- **Recommendation**: Use regex with word boundaries or explicit known-model lookup table instead of substring includes.

### Failure Mode 4: Model ID Not in Known Pattern

- **Trigger**: OpenRouter model IDs like `anthropic/claude-haiku-4.5`, custom provider aliases, or future models with unexpected naming.
- **Symptoms**: Falls through to truncated ID display (e.g., `anthropic/claude-haiku...`).
- **Impact**: Low -- UI degradation only, not functional.
- **Current Handling**: Truncation fallback at 20 chars. The OpenRouter prefix `anthropic/` is included in the check (`lower.includes('haiku')` still matches), so `anthropic/claude-haiku-4.5` would correctly return "Haiku 4.5".
- **Recommendation**: Acceptable. The substring matching is resilient to provider prefixes.

### Failure Mode 5: Zero-Cost Agent After Streaming

- **Trigger**: An agent completes with all message costs being undefined (e.g., cost calculation failed in backend, or older SDK version that doesn't populate cost).
- **Symptoms**: `totalCost` remains 0, `cost: totalCost > 0 ? totalCost : undefined` returns `undefined`. Footer shows model and tokens but no cost badge. No indication that cost data is missing.
- **Impact**: Low -- UI gracefully omits the badge.
- **Current Handling**: Correct -- conditional rendering hides the cost badge.
- **Recommendation**: Acceptable.

### Failure Mode 6: Negative Duration

- **Trigger**: Clock skew between events, or events with identical timestamps.
- **Symptoms**: `latestEnd > earliestStart` guard at line 997 catches this and returns `undefined` for duration.
- **Impact**: None -- guard works correctly.
- **Current Handling**: Explicit check `latestEnd > earliestStart`.
- **Recommendation**: Acceptable. Well-handled.

### Failure Mode 7: Multiple Events Scan Performance

- **Trigger**: Large session with 1000+ events. `aggregateAgentStats()` iterates all `state.events.values()`.
- **Symptoms**: Three call sites each iterate the full events map. For a session with N events and M agents, this is O(N \* M) work during each tree build.
- **Impact**: Low-Medium -- The tree cache prevents redundant rebuilds, but when the cache invalidates (every new event), all three aggregations re-scan.
- **Current Handling**: No optimization. Full scan on every cache miss.
- **Recommendation**: Consider pre-indexing events by `parentToolUseId` in the `StreamingState` for O(1) lookup, similar to `eventsByMessage`.

---

## Critical Issues

### Issue 1: `aggregateAgentStats` Called 3 Times Per Agent with Full Event Scan

- **File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\execution-tree-builder.service.ts`, lines 665, 826, 1241
- **Scenario**: For a session with 3 agents and 500 events, tree building triggers 3 \* 500 = 1,500 event iterations just for stat aggregation. Additionally, `buildAgentNode` at line 826 and the placeholder at line 665 could both be called for the SAME agent in different code paths (placeholder created first, then `buildAgentNode` called when `agent_start` arrives).
- **Impact**: Redundant computation. Not a correctness bug, but a performance concern that could cause jank during streaming with many agents.
- **Evidence**: Lines 665, 826, 1241 each call `this.aggregateAgentStats(toolCallId, state)` with a full `for (const event of state.events.values())` loop.
- **Fix**: Cache aggregated stats by `toolCallId` within a single `buildTree` call. Add a `Map<string, AgentStats>` that is populated on first call and returned on subsequent calls for the same `toolCallId`.

### Issue 2: `buildToolChildren` Uses Same `toolCallId` for Both Agent Loop and Stats Aggregation

- **File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\execution-tree-builder.service.ts`, line 1241
- **Scenario**: In `buildToolChildren`, the `for (const agentStart of agentStarts)` loop at line 1150 iterates multiple agent starts. But `this.aggregateAgentStats(toolCallId, state)` at line 1241 is called with the SAME `toolCallId` for every agent in the loop. If multiple agents share the same parent `toolCallId` (which shouldn't happen in practice but is theoretically possible), they would all get identical aggregated stats.
- **Impact**: Stats duplication if multiple `agent_start` events have the same `parentToolUseId`. In practice, this is unlikely but the code structure makes it possible.
- **Evidence**: Line 1241 uses the method parameter `toolCallId` rather than `agentStart.toolCallId`.
- **Fix**: Use `agentStart.toolCallId` instead of the method's `toolCallId` parameter, OR verify through the data model that only one `agent_start` per `toolCallId` is possible.

---

## Serious Issues

### Issue 1: Cache Token Data Lost in Aggregation

- **File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\execution-tree-builder.service.ts`, lines 964-968
- **Scenario**: `MessageTokenUsage` interface has `cacheRead?: number` and `cacheCreation?: number` fields. The aggregation only sums `input` and `output`, discarding cache data.
- **Impact**: Token badge tooltip for agents shows incomplete breakdown. Session-level stats DO show cache data, creating an inconsistency.
- **Evidence**:
  ```typescript
  if (complete.tokenUsage) {
    totalInputTokens += complete.tokenUsage.input;
    totalOutputTokens += complete.tokenUsage.output;
    hasTokenData = true;
  }
  ```
  No `cacheRead` or `cacheCreation` accumulation.
- **Fix**: Add `totalCacheReadTokens` and `totalCacheCreationTokens` accumulators. Return full `MessageTokenUsage` object:
  ```typescript
  tokenUsage: hasTokenData ? {
    input: totalInputTokens,
    output: totalOutputTokens,
    cacheRead: totalCacheReadTokens || undefined,
    cacheCreation: totalCacheCreationTokens || undefined,
  } : undefined,
  ```

### Issue 2: `hasStats` Computed Signal May Show Empty Footer

- **File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\organisms\inline-agent-bubble.component.ts`, lines 520-527
- **Scenario**: `hasStats()` returns true if ANY of `modelDisplayName()`, `agentTokenUsage()`, `agentCost() > 0`, or `agentDuration()` is truthy. If only the model is available (e.g., tokens/cost/duration are all undefined), the footer renders with ONLY a model badge. This is technically correct but could look odd -- a footer with just one tiny badge.
- **Impact**: Minor UX issue -- not a logic error but could look unfinished.
- **Evidence**:
  ```typescript
  readonly hasStats = computed(() => {
    return !!(
      this.modelDisplayName() ||
      this.agentTokenUsage() ||
      this.agentCost() > 0 ||
      this.agentDuration()
    );
  });
  ```
- **Fix**: Consider requiring at least TWO stats to be present, or accept this as intentional (model-only footer is still useful information).

### Issue 3: `aggregateAgentStats` Uses Timestamps from Different Event Types for Duration

- **File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\execution-tree-builder.service.ts`, lines 982-987
- **Scenario**: `earliestStart` is tracked from `message_start` events, but `latestEnd` from `message_complete` events. If a `message_start` event has `parentToolUseId` matching but no corresponding `message_complete` (e.g., the agent is still processing that message), we get `earliestStart` set but `latestEnd` from a PREVIOUS completed message. This would show a duration shorter than actual elapsed time.
- **Impact**: During streaming, duration would be inaccurate. But the footer is hidden during streaming (`!isStreaming()`) so this is a non-issue for rendering. After streaming completes, all `message_complete` events should be present.
- **Evidence**: The `!isStreaming()` template guard prevents rendering during streaming, so this is mitigated.
- **Fix**: No fix needed given the streaming guard, but adding a comment explaining this would aid maintainability.

---

## Moderate Issues

### Issue 1: `formatModelDisplayName` Substring Matching Could Produce Incorrect Results for Future Models

- **File**: `D:\projects\ptah-extension\libs\shared\src\lib\utils\pricing.utils.ts`, lines 351-368
- **Scenario**: The `includes('4')` check on line 353/360 matches any `4` in the model string, including date components. For example, a future `claude-sonnet-3-20240601` would match `includes('4')` via the date, returning "Sonnet 4" instead of "Sonnet 3".
- **Impact**: Low currently (all known models produce correct results), but fragile against future model naming changes.
- **Evidence**: `if (lower.includes('4')) return 'Sonnet 4';` -- matches `4` in `20240601`.
- **Fix**: Use regex: `/(?:^|[-\s.])4(?:[-\s.]|$)/` to match `4` as a distinct version segment, not within a date string. Or strip the date suffix before version matching.

### Issue 2: Placeholder Agent Stats Computed Early, May Become Stale

- **File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\execution-tree-builder.service.ts`, line 665
- **Scenario**: Placeholder agents are created when `agent_start` hasn't arrived yet. Stats are aggregated at that point. When `agent_start` arrives, the tree rebuilds and `buildAgentNode` re-aggregates. Between these two rebuilds, the placeholder's stats are from the earlier point in time.
- **Impact**: Low -- tree cache invalidates on new events, so the stale window is very short.
- **Evidence**: Line 665 calls `aggregateAgentStats` for placeholder, line 826 calls it again for the real agent node.
- **Fix**: Acceptable. Cache invalidation handles this.

### Issue 3: `SessionStatsSummaryComponent.formatModelName` is Now a Thin Wrapper

- **File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\session-stats-summary.component.ts`, lines 532-534
- **Scenario**: The protected method `formatModelName` now just delegates to `formatModelDisplayName`. This is a good refactor for deduplication, but if `formatModelDisplayName` behavior changes, it silently affects `SessionStatsSummaryComponent` which was previously independent.
- **Impact**: Low -- this is standard code reuse, but the coupling is implicit.
- **Evidence**:
  ```typescript
  protected formatModelName(modelId: string): string {
    return formatModelDisplayName(modelId);
  }
  ```
- **Fix**: Acceptable. This is proper shared utility usage.

---

## Data Flow Analysis

```
Backend (SdkMessageTransformer)
    |
    | MessageCompleteEvent { model, tokenUsage, cost, parentToolUseId }
    | MessageStartEvent { parentToolUseId, timestamp }
    |
    v
StreamingState.events (Map<string, FlatStreamEventUnion>)
    |
    v
ExecutionTreeBuilderService.aggregateAgentStats(toolCallId, state)
    |
    | Filters: event.parentToolUseId === toolCallId
    | Aggregates: model (first non-null), tokens (sum), cost (sum), duration (timestamps)
    |
    |  GAP: cacheRead/cacheCreation tokens discarded  <---- SERIOUS
    |  GAP: Only direct children, not recursive sub-agents <---- DOCUMENTED LIMITATION
    |
    v
createExecutionNode({ ...stats, model: stats.agentModel })
    |
    v
ExecutionNode { agentModel, model, tokenUsage, cost, duration }
    |
    v
InlineAgentBubbleComponent (computed signals)
    |
    | modelDisplayName() -> formatModelDisplayName(node.agentModel || node.model)
    | agentTokenUsage() -> node.tokenUsage ?? null
    | agentCost() -> node.cost ?? 0
    | agentDuration() -> node.duration ?? null
    | hasStats() -> any of the above truthy
    |
    v
Template: @if (hasStats() && !isStreaming())
    |
    v
Footer: [Model Badge] [Token Badge] [Cost Badge] [Duration Badge]
```

### Gap Points Identified:

1. **Cache token fields dropped** during aggregation (cacheRead, cacheCreation)
2. **Sub-subagent costs not rolled up** into parent agent stats
3. **Three separate full-event scans** for aggregation per tree build cycle

---

## Requirements Fulfillment

| Requirement                              | Status   | Concern                                                        |
| ---------------------------------------- | -------- | -------------------------------------------------------------- |
| Display model name on agent bubbles      | COMPLETE | Uses `formatModelDisplayName`, correct for all known model IDs |
| Display token count on agent bubbles     | COMPLETE | Sums from `message_complete` events, missing cache breakdown   |
| Display cost on agent bubbles            | COMPLETE | Sums from `message_complete.cost`, only direct children        |
| Display duration on agent bubbles        | COMPLETE | Earliest start to latest end, well-guarded                     |
| Footer only shows when stats available   | COMPLETE | `hasStats() && !isStreaming()` guard                           |
| Model names human-readable               | COMPLETE | All current model IDs produce correct names                    |
| Full model ID as tooltip                 | COMPLETE | `[title]="node().agentModel \|\| node().model \|\| ''"`        |
| Shared utility for model name formatting | COMPLETE | `formatModelDisplayName()` in `pricing.utils.ts`               |
| SessionStatsSummary delegates to shared  | COMPLETE | `formatModelName()` now calls `formatModelDisplayName()`       |
| Cost badge removed from header           | COMPLETE | Moved to footer                                                |
| Stats aggregation during tree build      | COMPLETE | Called at all 3 creation sites                                 |
| Cache invalidation when stats change     | COMPLETE | `events.size` fingerprint in cache                             |

### Implicit Requirements NOT Addressed:

1. Sub-subagent cost rollup not implemented (costs only from direct child messages)
2. Cache token fields (cacheRead, cacheCreation) lost during aggregation
3. No pre-indexing of events by `parentToolUseId` for performance optimization

---

## Edge Case Analysis

| Edge Case                                   | Handled | How                                                                                             | Concern                                   |
| ------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------- |
| No message_complete events during streaming | YES     | `aggregateAgentStats` returns all `undefined`, footer hidden via `hasStats()` + `isStreaming()` | None                                      |
| Agent with zero cost / zero tokens          | YES     | Conditional `@if` on each badge, `cost > 0` guard                                               | None                                      |
| Model field absent (old sessions)           | YES     | `modelDisplayName()` returns null, badge not rendered                                           | None                                      |
| Multiple assistant messages in one agent    | YES     | Sums across all `message_complete` events                                                       | None                                      |
| Null/undefined toolCallId                   | PARTIAL | No explicit null check in `aggregateAgentStats` for `toolCallId` param                          | Very unlikely to be null given call sites |
| Identical timestamps on start/end           | YES     | `latestEnd > earliestStart` returns false, duration = undefined                                 | Badge not rendered                        |
| Empty model string from API                 | YES     | `formatModelDisplayName('')` returns `'Unknown'`                                                | None                                      |
| OpenRouter model IDs with prefix            | YES     | `includes()` checks match substring regardless of prefix                                        | None                                      |
| Tab switch mid-streaming                    | YES     | Cache invalidates on new events, footer hidden during streaming                                 | Brief stale window                        |
| Non-null assertion on undefined             | YES     | Each `!` assertion guarded by preceding `@if` check                                             | Theoretically safe                        |

---

## Integration Risk Assessment

| Integration                        | Failure Probability | Impact              | Mitigation                             |
| ---------------------------------- | ------------------- | ------------------- | -------------------------------------- |
| Tree Builder -> ExecutionNode      | LOW                 | Stats not displayed | `hasStats` guard prevents empty footer |
| formatModelDisplayName -> Template | LOW                 | Wrong model name    | Tested against all known model IDs     |
| TokenBadgeComponent input          | LOW                 | Runtime error       | `@if` guard + non-null assertion       |
| DurationBadgeComponent input       | LOW                 | Runtime error       | `@if` guard + non-null assertion       |
| CostBadgeComponent input           | LOW                 | Runtime error       | `agentCost()` always returns number    |
| Cache invalidation                 | LOW                 | Stale data          | `events.size` changes on new events    |
| SessionStatsSummary delegation     | LOW                 | Regression          | Single delegation call, same logic     |

---

## Verdict

**Recommendation**: NEEDS_REVISION
**Confidence**: HIGH
**Top Risk**: Cache token data (cacheRead, cacheCreation) is silently dropped during aggregation, creating inconsistency between agent-level and session-level token displays.

The implementation is **functionally correct for the happy path** and handles most edge cases well. The architecture follows existing patterns correctly. However, there are two issues that warrant revision before production:

1. **Cache token data loss** (Serious) -- The aggregated `tokenUsage` drops `cacheRead` and `cacheCreation` fields that exist on individual `MessageCompleteEvent` records. This should be a straightforward addition of two more accumulators.

2. **Performance concern with triple full-scan** (Critical for scale) -- Each of the 3 call sites performs a full `state.events.values()` iteration. For sessions with many agents and events, this compounds. A per-build-cycle cache for aggregated stats would eliminate redundant work.

The `formatModelDisplayName` utility is well-designed and handles all currently known model IDs correctly. The template guards are properly constructed. The `SessionStatsSummary` refactor preserves existing behavior.

## What Robust Implementation Would Include

Beyond current implementation:

- **Aggregation cache within single `buildTree` call** -- Memoize `aggregateAgentStats` results by `toolCallId` to avoid redundant scans
- **Full `MessageTokenUsage` aggregation** -- Include `cacheRead` and `cacheCreation` token sums
- **Pre-indexed events by `parentToolUseId`** -- Similar to existing `eventsByMessage` index for O(1) lookup
- **Regex-based version extraction** in `formatModelDisplayName` to avoid date-digit collisions
- **Recursive sub-subagent cost rollup** (optional, future enhancement)
- **Visual indicator** when stats are partial (e.g., "excludes sub-agent costs" tooltip)
