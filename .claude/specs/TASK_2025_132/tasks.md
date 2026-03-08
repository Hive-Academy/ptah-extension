# Development Tasks - TASK_2025_132: Subagent Model Info, Token Stats & Pricing Display

**Total Tasks**: 9 | **Batches**: 3 | **Status**: 3/3 complete

---

## Plan Validation Summary

**Validation Status**: PASSED

### Assumptions Verified

- **ExecutionNode fields exist**: `agentModel`, `model`, `tokenUsage`, `cost`, `duration` all verified on `ExecutionNode` interface (execution-node.types.ts:161,196-202)
- **createExecutionNode accepts all fields**: Uses `Partial<ExecutionNode>` so spreading aggregated stats works (execution-node.types.ts:618-628)
- **MessageCompleteEvent has model/cost/tokens**: `model`, `tokenUsage`, `cost`, `duration` all present (execution-node.types.ts:865-872)
- **parentToolUseId matching pattern**: Same pattern already used in `buildAgentNode()` line 731-736 and placeholder creation line 588-592 -- proven pattern
- **Badge component inputs**: TokenBadge accepts `MessageTokenUsage | number | undefined`, CostBadge accepts `number` (required), DurationBadge accepts `number` (required)
- **pricing.utils.ts auto-exported**: Already in shared/src/index.ts line 21, any new export is immediately available via `@ptah-extension/shared`

### Risks Identified

| Risk            | Severity | Mitigation |
| --------------- | -------- | ---------- |
| None identified | -        | -          |

### Edge Cases to Handle

- [x] No `message_complete` events yet during streaming -> `aggregateAgentStats` returns all `undefined`, footer hidden via `hasStats()` + `isStreaming()` guard
- [x] Agent with zero cost / zero tokens -> Conditional rendering (`@if`) on each badge prevents empty display
- [x] Model field absent on older sessions -> `modelDisplayName()` returns `null`, model badge not rendered
- [x] Multiple assistant messages within one agent -> Token/cost aggregation sums across all `message_complete` events

---

## Batch 1: Data Pipeline (Shared Utility + Tree Builder Aggregation) ✅ COMPLETE

**Developer**: frontend-developer
**Tasks**: 3 | **Dependencies**: None

### Task 1.1: Add `formatModelDisplayName()` to `pricing.utils.ts` ✅ COMPLETE

**File**: `D:\projects\ptah-extension\libs\shared\src\lib\utils\pricing.utils.ts`
**Action**: MODIFY (add new exported function at end of file, after `getModelPricingDescription`)
**Spec Reference**: implementation-plan.md:257-328
**Pattern to Follow**: Existing functions in same file (`findModelPricing`, `getModelPricingDescription`)

**Quality Requirements**:

- Pure function, no side effects, no dependencies
- Handles null/empty input gracefully (returns 'Unknown')
- Covers Anthropic (Opus, Sonnet, Haiku), OpenAI (GPT-4o, GPT-4, GPT-3.5), Google (Gemini) models
- Falls back to truncated model ID for unknown models (truncate at 20 chars)

**Implementation Details**:

- Import: None needed (pure string function)
- Add after line 330 (after `getModelPricingDescription` function)
- Function signature: `export function formatModelDisplayName(modelId: string): string`
- Logic: lowercase input, check `includes()` for model family keywords, return human-readable name
- See implementation-plan.md:283-327 for complete mapping logic

---

### Task 1.2: Add `aggregateAgentStats()` private method to `ExecutionTreeBuilderService` ✅ COMPLETE

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\execution-tree-builder.service.ts`
**Action**: MODIFY (add new private method)
**Spec Reference**: implementation-plan.md:126-219
**Pattern to Follow**: Existing private methods in same service (`buildMessageNode`, `buildToolNode`)

**Quality Requirements**:

- Single pass over `state.events` (no re-iteration beyond existing patterns)
- Handle missing data gracefully (some events may not have model/tokens during streaming)
- Aggregate correctly when agent has multiple assistant messages
- Return `undefined` for fields with no data (not zero)

**Implementation Details**:

- Add `MessageCompleteEvent` and `MessageStartEvent` to the existing import from `@ptah-extension/shared` (line 19-26 -- they are ALREADY imported)
- Add new private method `aggregateAgentStats(toolCallId: string, state: StreamingState)` returning `{ agentModel?: string; tokenUsage?: { input: number; output: number }; cost?: number; duration?: number }`
- Iterates `state.events.values()`, filters by `event.parentToolUseId === toolCallId`
- For `message_complete` events: captures first non-null `model`, sums `tokenUsage.input`/`output`, sums `cost`, tracks latest `timestamp`
- For `message_start` events: tracks earliest `timestamp`
- Duration = `latestEnd - earliestStart` (if both exist and latestEnd > earliestStart)
- Place the method after `buildInterleavedChildren` (after line 910) and before `parseToolInput` (line 919)

---

### Task 1.3: Wire `aggregateAgentStats()` into all 3 agent node creation sites ✅ COMPLETE

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\execution-tree-builder.service.ts`
**Action**: MODIFY (wire calls into 3 existing `createExecutionNode` calls)
**Spec Reference**: implementation-plan.md:222-248
**Dependencies**: Task 1.2

**Quality Requirements**:

- All 3 sites must call `aggregateAgentStats()` and spread results into `createExecutionNode()`
- Must set both `agentModel` and `model` fields for consistency (model name lookup uses either)
- Must not break existing agent node creation logic

**Implementation Details**:

**Site 1 - `buildAgentNode()` (~line 818)**:

- Before the `createExecutionNode` call, call `const stats = this.aggregateAgentStats(toolCallId, state);`
- Spread `...stats` into the `createExecutionNode` object
- Also set `model: stats.agentModel` for consistency
- The `toolCallId` parameter is already available as the method parameter

**Site 2 - Placeholder agent in `collectTools()` (~line 664)**:

- Before the placeholder `createExecutionNode` call, call `const stats = this.aggregateAgentStats(toolStart.toolCallId, state);`
- Spread `...stats` into the `createExecutionNode` object
- Also set `model: stats.agentModel`

**Site 3 - `buildToolChildren()` (~line 1151)**:

- Before the agent node `createExecutionNode` call, call `const stats = this.aggregateAgentStats(toolCallId, state);` (where `toolCallId` is the method parameter)
- Spread `...stats` into the `createExecutionNode` object
- Also set `model: stats.agentModel`

---

**Batch 1 Verification**:

- All files exist at paths
- Build passes: `npx nx build shared` and `npx nx build chat`
- code-logic-reviewer approved
- `formatModelDisplayName` properly exported from `@ptah-extension/shared`
- `aggregateAgentStats` called at all 3 agent creation sites

---

## Batch 2: UI Footer + SessionStats Refactor ✅ COMPLETE

**Developer**: frontend-developer
**Tasks**: 2 | **Dependencies**: Batch 1

### Task 2.1: Add stats footer to `InlineAgentBubbleComponent` ✅ COMPLETE

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\organisms\inline-agent-bubble.component.ts`
**Action**: MODIFY
**Spec Reference**: implementation-plan.md:338-451
**Pattern to Follow**: `message-bubble.component.html:56-79` (chat-footer pattern with badge components)

**Quality Requirements**:

- Footer appears BELOW collapsible content, not in header
- Footer is always visible (not affected by collapse state) -- consistent with message footer pattern
- Only renders when at least one stat is available AND not streaming
- Compact single-row layout using existing badge components
- Model name shown as outline badge with full model ID as tooltip
- Cost badge removed from header (moved to footer for unified display)

**Implementation Details**:

**1. Add imports to the component `imports` array** (line 51-57):

- Add `TokenBadgeComponent` from `'../atoms/token-badge.component'`
- Add `DurationBadgeComponent` from `'../atoms/duration-badge.component'`
- Add `formatModelDisplayName` from `'@ptah-extension/shared'` (top-level import)

**2. Add 4 computed signals** (after `hasChildren` at line 466):

```
modelDisplayName = computed(() => {
  const model = this.node().agentModel || this.node().model;
  if (!model) return null;
  return formatModelDisplayName(model);
});

agentTokenUsage = computed(() => this.node().tokenUsage ?? null);

agentDuration = computed(() => this.node().duration ?? null);

hasStats = computed(() => {
  return !!(this.modelDisplayName() || this.agentTokenUsage() || this.agentCost() > 0 || this.agentDuration());
});
```

**3. Remove cost badge from header** (lines 130-132):

- Remove the `@if (agentCost() > 0) { <ptah-cost-badge [cost]="agentCost()" /> }` block from the header button

**4. Add footer template** after the collapsible content `</div>` (after line 176) but BEFORE the closing outer `</div>` (line 178):

```html
@if (hasStats() && !isStreaming()) {
<div class="flex items-center gap-1.5 px-3 py-1.5 border-t border-base-300/30 text-base-content/60">
  @if (modelDisplayName()) {
  <span class="badge badge-xs badge-outline text-[9px] opacity-70 flex-shrink-0" [title]="node().agentModel || node().model || ''"> {{ modelDisplayName() }} </span>
  } @if (agentTokenUsage()) {
  <ptah-token-badge [tokens]="agentTokenUsage()!" />
  } @if (agentCost() > 0) {
  <ptah-cost-badge [cost]="agentCost()" />
  } @if (agentDuration()) {
  <ptah-duration-badge [durationMs]="agentDuration()!" />
  }
</div>
}
```

---

### Task 2.2: Refactor `SessionStatsSummaryComponent.formatModelName()` to use shared utility ✅ COMPLETE

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\session-stats-summary.component.ts`
**Action**: MODIFY
**Spec Reference**: implementation-plan.md:330-334
**Pattern to Follow**: Import shared utility, delegate protected method to it

**Quality Requirements**:

- `formatModelName()` method must still work identically for all existing callers
- Import `formatModelDisplayName` from `@ptah-extension/shared`
- Method body becomes a single delegation call
- No other changes to the component

**Implementation Details**:

**1. Add import** at top of file:

```typescript
import { calculateSessionCostSummary, formatModelDisplayName } from '@ptah-extension/shared';
```

(Merge into existing import from `@ptah-extension/shared` on line 9)

**2. Replace `formatModelName()` method body** (lines 528-567):
Replace the entire method body with:

```typescript
protected formatModelName(modelId: string): string {
  return formatModelDisplayName(modelId);
}
```

---

**Batch 2 Verification**:

- All files exist at paths
- Build passes: `npx nx build chat`
- code-logic-reviewer approved
- Footer renders with model badge, token badge, cost badge, duration badge
- Cost badge no longer appears in agent header
- `SessionStatsSummaryComponent` still renders model names correctly

---

## Batch 3: Dynamic Pricing from OpenRouter API ✅ COMPLETE

**Developer**: orchestrator (direct)
**Tasks**: 4 | **Dependencies**: Batch 2 (pricing infrastructure)

### Task 3.1: Extend `ProviderModelInfo` with pricing fields ✅ COMPLETE

**File**: `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc.types.ts`
**Action**: MODIFY (add 3 optional pricing fields to interface)

Added `inputCostPerToken?`, `outputCostPerToken?`, `cacheReadCostPerToken?` as optional fields.
Backwards-compatible - existing code that creates `ProviderModelInfo` without pricing continues to work.

---

### Task 3.2: Extract pricing in `fetchDynamicModels()` and feed into pricing map ✅ COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\provider-models.service.ts`
**Action**: MODIFY

- Extended `ModelsApiModel.pricing` interface with `input_cache_read` and `input_cache_write` fields
- Added `updatePricingMap` import from `@ptah-extension/shared`
- Updated model transformation to extract `inputCostPerToken`, `outputCostPerToken`, `cacheReadCostPerToken` from API response
- Added `feedPricingMap()` call after successful model fetch

---

### Task 3.3: Add `prefetchPricing()` method for startup pre-fetch ✅ COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\provider-models.service.ts`
**Action**: MODIFY (add 3 new methods)

- `prefetchPricing()` - Public method that fetches OpenRouter models without auth (endpoint is public)
- `parsePricingField()` - Private helper to parse pricing strings to numbers
- `feedPricingMap()` - Private helper that creates pricing entries keyed by full ID, stripped ID, and normalized ID (dots→hyphens) for partial matching

Key design: Creates 3 pricing map keys per model to ensure `findModelPricing()` partial matching works:

1. `anthropic/claude-opus-4.5` (full OpenRouter ID)
2. `claude-opus-4.5` (stripped provider prefix)
3. `claude-opus-4-5` (normalized dots to hyphens, matches SDK IDs like `claude-opus-4-5-20251101`)

---

### Task 3.4: Wire pricing prefetch into extension startup ✅ COMPLETE

**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\main.ts`
**Action**: MODIFY (add Step 7.2 to activation sequence)

Added non-blocking `prefetchPricing()` call at Step 7.2 (after SDK auth init, before session import).
Fire-and-forget with error catching - won't block startup. Falls back to bundled `DEFAULT_MODEL_PRICING` if fetch fails.

---

**Batch 3 Verification**:

- `npx nx run shared:typecheck` ✅
- `npx nx run agent-sdk:typecheck` ✅
- `npx nx run ptah-extension-vscode:typecheck` ✅
- `npx nx run chat:typecheck` ✅
- `npx nx lint agent-sdk` ✅ (0 new errors/warnings)
