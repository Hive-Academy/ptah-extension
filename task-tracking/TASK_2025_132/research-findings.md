# Research Report: Subagent Model Info, Token Stats, and Pricing in UI

## TASK_2025_132 - Research Findings

**Research Classification**: STRATEGIC_ANALYSIS
**Confidence Level**: 92% (based on direct codebase analysis of 25+ source files)
**SDK Version Analyzed**: @anthropic-ai/claude-agent-sdk 0.2.25

---

## 1. Executive Summary

The Ptah Extension already has significant infrastructure for displaying session-level cost, token, and model data. The primary gap is at the **per-subagent level**: when a subagent (e.g., `frontend-developer`, `backend-developer`) is spawned via the Task tool, the UI shows the agent type and cost badge but does NOT show which model the subagent uses or its individual token breakdown. This report maps the complete data flow, identifies exactly what data is available at each layer, and recommends a concrete approach to surface subagent model/token/cost information in the UI.

---

## 2. Current Architecture - Data Flow Diagram

```
+------------------------------------------------------------------+
|  Claude Agent SDK (v0.2.25)                                       |
|  +-----------------------+  +-------------------------------+     |
|  | SDKSystemMessage      |  | SDKPartialAssistantMessage    |     |
|  | (type: 'system')      |  | (type: 'stream_event')        |     |
|  | .model (primary)      |  | .event.message.model          |     |
|  +-----------------------+  | (per-message model ID)        |     |
|                             +-------------------------------+     |
|  +-----------------------+  +-------------------------------+     |
|  | SubagentStartHookInput|  | SDKResultMessage              |     |
|  | .agent_id             |  | (type: 'result')              |     |
|  | .agent_type           |  | .total_cost_usd               |     |
|  | (NO model field)      |  | .usage (input/output tokens)  |     |
|  +-----------------------+  | .modelUsage (per-model map)   |     |
|                             | .duration_ms                  |     |
|  +-----------------------+  +-------------------------------+     |
|  | SDKAssistantMessage   |  +-------------------------------+     |
|  | .message.model        |  | AgentDefinition (config)      |     |
|  | (full model ID)       |  | .model? ('sonnet'|'opus'|     |     |
|  +-----------------------+  |  'haiku'|'inherit')           |     |
|                             +-------------------------------+     |
+------------------------------------------------------------------+
              |                          |                |
              v                          v                v
+------------------------------------------------------------------+
|  Backend Layer (agent-sdk library)                                 |
|                                                                    |
|  StreamTransformer          SubagentHookHandler                    |
|  - Transforms SDK messages  - Handles SubagentStart/Stop hooks     |
|    to FlatStreamEventUnion  - Starts/stops agent file watching     |
|  - Extracts ResultStats     - Registers with SubagentRegistry      |
|    (cost, tokens, model-    - Does NOT extract model from hook     |
|     Usage array)            - Passes agentType, agentId only       |
|                                                                    |
|  SdkMessageTransformer      RPC Method Registration                |
|  - Creates MessageComplete  - setupResultStatsCallback:            |
|    events with model field  -   Sends SESSION_STATS to webview     |
|  - Creates AgentStart       -   Includes modelUsage array          |
|    events (NO model field)  - setupAgentWatcherListeners:          |
|                             -   Forwards agent-start events        |
|                             -   Forwards summary-chunk events      |
+------------------------------------------------------------------+
              |                          |
              v                          v
+------------------------------------------------------------------+
|  Frontend Layer (chat library)                                     |
|                                                                    |
|  ChatStore                  ExecutionTreeBuilder                    |
|  - handleSessionStats()     - Builds tree from flat events         |
|  - modelUsageList computed  - Agent nodes get: agentType,          |
|  - Updates tab with cost,   -   agentDescription, cost, model?     |
|    tokens, duration, model  -   (model comes from                  |
|    usage list               -    MessageCompleteEvent)              |
|                                                                    |
|  InlineAgentBubbleComponent session-stats-summary.component        |
|  - Shows agentType          - Shows per-model usage breakdown      |
|  - Shows agentDescription   - Shows total cost, tokens             |
|  - Shows cost badge         - Collapsible multi-model display      |
|  - NO model name badge      |                                      |
|  - NO token count badge     message-bubble.component               |
|                             - Shows token-badge, cost-badge,       |
|                             -   duration-badge for messages         |
+------------------------------------------------------------------+
```

---

## 3. Data Availability Analysis

### 3.1 What Data IS Available from the SDK

| Data Point                | Source                                                               | When Available          | Granularity                           |
| ------------------------- | -------------------------------------------------------------------- | ----------------------- | ------------------------------------- |
| Primary session model     | `SDKSystemMessage.model`                                             | Session init            | Session-level                         |
| Per-message model ID      | `APIAssistantMessage.model` (via `message_start` stream event)       | Every assistant message | Per-message (incl. subagent messages) |
| Total session cost        | `SDKResultMessage.total_cost_usd`                                    | Session end             | Session-level                         |
| Total token usage         | `SDKResultMessage.usage` (input, output, cache_read, cache_creation) | Session end             | Session-level                         |
| Per-model usage breakdown | `SDKResultMessage.modelUsage` (Record<string, ModelUsage>)           | Session end             | Per-model across entire session       |
| Per-model cost            | `ModelUsage.costUSD`                                                 | Session end             | Per-model across entire session       |
| Per-model context window  | `ModelUsage.contextWindow`                                           | Session end             | Per-model                             |
| Agent definition model    | `AgentDefinition.model` ('sonnet'\|'opus'\|'haiku'\|'inherit')       | Config time             | Per-agent-definition                  |
| Subagent ID               | `SubagentStartHookInput.agent_id`                                    | Subagent start          | Per-subagent                          |
| Subagent type             | `SubagentStartHookInput.agent_type`                                  | Subagent start          | Per-subagent                          |
| Subagent transcript path  | `SubagentStopHookInput.agent_transcript_path`                        | Subagent stop           | Per-subagent                          |
| Session duration          | `SDKResultMessage.duration_ms`                                       | Session end             | Session-level                         |
| Per-message token delta   | `MessageDeltaEvent.usage`                                            | During streaming        | Per-message                           |

### 3.2 What Data is Currently Flowing to Frontend

| Data Point            | Transport Mechanism                | Frontend Consumer                | Display Location                                                         |
| --------------------- | ---------------------------------- | -------------------------------- | ------------------------------------------------------------------------ |
| Session cost          | `SESSION_STATS` message            | `ChatStore.handleSessionStats()` | Session header, tab badge                                                |
| Session tokens        | `SESSION_STATS` message            | `ChatStore.handleSessionStats()` | Session header                                                           |
| Session duration      | `SESSION_STATS` message            | `ChatStore.handleSessionStats()` | Session header                                                           |
| Per-model usage array | `SESSION_STATS` message            | `ChatStore.modelUsageList`       | `session-stats-summary.component`                                        |
| Per-message model     | `MessageCompleteEvent.model`       | `ExecutionTreeBuilder`           | `ExecutionNode.model` field (available but NOT displayed on agent cards) |
| Agent type            | `AgentStartEvent.agentType`        | `ExecutionTreeBuilder`           | `InlineAgentBubbleComponent` header                                      |
| Agent description     | `AgentStartEvent.agentDescription` | `ExecutionTreeBuilder`           | `InlineAgentBubbleComponent` subtitle                                    |
| Agent cost            | `ExecutionNode.cost`               | `InlineAgentBubbleComponent`     | Cost badge in agent header                                               |
| Message tokens        | `MessageCompleteEvent.tokenUsage`  | `ExecutionTreeBuilder`           | `message-bubble` token badge                                             |
| Message cost          | `MessageCompleteEvent.cost`        | `ExecutionTreeBuilder`           | `message-bubble` cost badge                                              |

### 3.3 What Data is MISSING (Gap Analysis)

| Missing Data                          | Root Cause                                                                                                                                  | Difficulty                                                                               | Impact                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| **Subagent model name on agent card** | `AgentStartEvent` does not include model field; `SubagentStartHookInput` also lacks model                                                   | LOW - model IS available on `MessageCompleteEvent` which fires for each subagent message | HIGH - Users cannot see which model a subagent is using     |
| **Per-subagent token breakdown**      | SDK only provides per-model totals in `SDKResultMessage.modelUsage`, not per-subagent                                                       | MEDIUM - Need to accumulate from `MessageCompleteEvent.tokenUsage` per agent node        | HIGH - No visibility into per-agent resource consumption    |
| **Per-subagent cost**                 | `ExecutionNode.cost` exists in the type but is only populated from `MessageCompleteEvent.cost` which is per-turn, not accumulated per agent | MEDIUM - Need to aggregate cost from child message_complete events                       | MEDIUM - Already partially working via `agentCost` computed |
| **Model name badge on agent cards**   | `InlineAgentBubbleComponent` has no model display, only cost badge                                                                          | LOW - Just UI work, data already available                                               | HIGH - Primary user request                                 |
| **Token count badge on agent cards**  | `InlineAgentBubbleComponent` has no token display                                                                                           | LOW - Just UI work once data aggregation works                                           | MEDIUM - Nice to have                                       |
| **SubagentRecord model field**        | `SubagentRecord` interface does not track model                                                                                             | LOW - Add field to interface                                                             | LOW - Registry primarily for lifecycle tracking             |

---

## 4. Detailed Source Analysis

### 4.1 SDK Hook Limitations

The `SubagentStartHookInput` interface (lines 1269-1275 of `claude-sdk.types.ts`) contains only:

- `hook_event_name: 'SubagentStart'`
- `agent_id: string`
- `agent_type: string`
- Plus base fields: `session_id`, `transcript_path`, `cwd`

There is **no `model` field** on the SubagentStart hook. This is an SDK limitation. The model information for a subagent is determined by the `AgentDefinition.model` field at configuration time, but this is not included in the hook input.

**Workaround**: The `APIAssistantMessage.model` field (line 211 of `claude-sdk.types.ts`) IS available during streaming. When the SDK sends a `message_start` stream event for a subagent's response, the event contains `event.message.model` with the full model identifier (e.g., `claude-sonnet-4-20250514`). This is already transformed to `MessageCompleteEvent.model` by the `SdkMessageTransformer`. The model from the first `message_start` event for a given subagent definitively identifies which model the subagent is using.

### 4.2 AgentStartEvent Gap

The `AgentStartEvent` interface (lines 847-860 of `execution-node.types.ts`) does not include a `model` field:

```typescript
export interface AgentStartEvent extends FlatStreamEvent {
  readonly eventType: 'agent_start';
  readonly toolCallId: string;
  readonly agentType: string;
  readonly agentDescription?: string;
  readonly agentPrompt?: string;
  readonly agentId?: string;
  // NO model field
}
```

However, the `ExecutionNode` interface (line 161, 201) already has both `agentModel?: string` and `model?: string` fields defined. The data structure supports it; the population pipeline just does not fill it.

### 4.3 Stream Transformer Stats Extraction

The `StreamTransformer` (lines 270-326 of `stream-transformer.ts`) already extracts per-model usage into `ResultModelUsage[]`:

```typescript
interface ResultModelUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  contextWindow: number;
  costUSD: number;
  cacheReadInputTokens: number;
}
```

This flows to the frontend via `SESSION_STATS` and is displayed in `session-stats-summary.component.ts`. However, this is **session-level** breakdown by model, not by subagent.

### 4.4 Existing UI Badge Components

The following badge components already exist and can be reused:

- `ptah-cost-badge` (already on agent cards)
- `ptah-token-badge` (on message bubbles, not on agent cards)
- `ptah-duration-badge` (on message bubbles, not on agent cards)

There is no `ptah-model-badge` component. A new atom component or inline display is needed.

### 4.5 InlineAgentBubbleComponent Analysis

File: `libs/frontend/chat/src/lib/components/organisms/inline-agent-bubble.component.ts`

Current agent header displays (lines 96-132):

1. Expand/collapse chevron
2. Colored avatar circle
3. Agent type name (e.g., "frontend-developer")
4. Agent description (truncated)
5. Status badge (Streaming / Interrupted / child stats)
6. Cost badge (if cost > 0)

Missing from agent header:

- Model name (e.g., "Sonnet 4.5" or "claude-sonnet-4-20250514")
- Token count (input + output)
- Duration

### 4.6 Pricing Utilities

File: `libs/shared/src/lib/utils/pricing.utils.ts`

Already has `DEFAULT_MODEL_PRICING` covering:

- Claude Opus 4.5, Sonnet 4.5, Haiku 4.5
- GPT-4o, GPT-4o-mini
- Gemini models

And `findModelPricing()` with fuzzy matching, plus `calculateMessageCost()`. This infrastructure is ready for per-subagent cost calculation.

---

## 5. Recommended Implementation Approach

### 5.1 Strategy: Message-Level Model Propagation

The recommended approach uses the `message_start` stream event's `APIAssistantMessage.model` field to identify subagent models. Since each subagent produces its own assistant messages with `parent_tool_use_id` linking them to their parent Task tool, the model can be propagated to the agent node.

### 5.2 Implementation Steps

#### Step 1: Add `model` field to `AgentStartEvent` (shared types)

**File**: `D:\projects\ptah-extension\libs\shared\src\lib\types\execution-node.types.ts`

Add an optional `model` field to `AgentStartEvent`:

```typescript
export interface AgentStartEvent extends FlatStreamEvent {
  readonly eventType: 'agent_start';
  readonly toolCallId: string;
  readonly agentType: string;
  readonly agentDescription?: string;
  readonly agentPrompt?: string;
  readonly agentId?: string;
  readonly model?: string; // NEW: Model ID from first message_start event
}
```

#### Step 2: Propagate model from MessageStartEvent to parent agent node

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\tree-builder.service.ts`

When building the execution tree, the tree builder should propagate the `model` field from a subagent's first `MessageStartEvent` (or `MessageCompleteEvent`) up to the parent agent node. Since `MessageCompleteEvent` already carries `model?: string`, the tree builder can set `agentModel` on the agent `ExecutionNode` when processing the first child message complete event.

Pseudocode:

```typescript
// When processing MessageCompleteEvent for a message under an agent:
if (parentAgentNode && !parentAgentNode.agentModel && event.model) {
  // Set the agent's model from its first response
  parentAgentNode = { ...parentAgentNode, agentModel: event.model };
}
```

#### Step 3: Aggregate per-agent token usage

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\tree-builder.service.ts`

When building the tree, accumulate `tokenUsage` from all `MessageCompleteEvent` events that belong to a given agent (matched via `parentToolUseId`). Store the aggregate on the agent's `ExecutionNode.tokenUsage`.

Pseudocode:

```typescript
// After all events processed, for each agent node:
agentNode.tokenUsage = aggregateChildTokenUsage(agentNode.children);
agentNode.cost = aggregateChildCosts(agentNode.children);
```

#### Step 4: Create model display in InlineAgentBubbleComponent

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\organisms\inline-agent-bubble.component.ts`

Add model name display and token badge to the agent header. The model name should be formatted for readability (e.g., "claude-sonnet-4-20250514" becomes "Sonnet 4.5").

```typescript
// New computed signal
readonly agentModelDisplay = computed(() => {
  const model = this.node().agentModel || this.node().model;
  if (!model) return null;
  return formatModelName(model); // e.g., "Sonnet 4.5"
});

readonly agentTokens = computed(() => {
  const usage = this.node().tokenUsage;
  if (!usage) return null;
  return { input: usage.input, output: usage.output };
});
```

Template addition (after agent description, before status badges):

```html
@if (agentModelDisplay()) {
<span class="badge badge-xs badge-outline text-[9px] flex-shrink-0 opacity-70"> {{ agentModelDisplay() }} </span>
} @if (agentTokens()) {
<ptah-token-badge [tokens]="agentTokens()!" />
}
```

#### Step 5: Add model name formatting utility

**File**: `D:\projects\ptah-extension\libs\shared\src\lib\utils\pricing.utils.ts` (extend existing)

Add a `formatModelDisplayName()` function that maps full model IDs to readable names:

```typescript
export function formatModelDisplayName(modelId: string): string {
  const knownModels: Record<string, string> = {
    'claude-opus-4-5-20251101': 'Opus 4.5',
    'claude-sonnet-4-5-20250514': 'Sonnet 4.5',
    'claude-sonnet-4-20250514': 'Sonnet 4',
    'claude-haiku-4-5-20250514': 'Haiku 4.5',
    // ... more models
  };
  if (knownModels[modelId]) return knownModels[modelId];
  // Fuzzy fallback: extract family name
  // ...
}
```

### 5.3 Optional Enhancement: Backend Model Resolution via AgentDefinition

For cases where the model needs to be known before the first message arrives (e.g., to show it immediately when the agent starts), the `AgentDefinition.model` config can be resolved at hook time:

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\subagent-hook-handler.ts`

If `AgentDefinition` entries are available to the hook handler, the configured model can be included in the `agent-start` event emitted by `AgentSessionWatcherService`. However, this requires passing the agents config to the hook handler, which adds complexity. The recommended approach (resolving from `message_start` events) is simpler and more accurate since `AgentDefinition.model` uses abstract names ('sonnet', 'opus') while `APIAssistantMessage.model` has the full model identifier.

---

## 6. Files to Modify

### Shared Types (Foundation)

| File                                                | Change                                              | Effort  |
| --------------------------------------------------- | --------------------------------------------------- | ------- |
| `libs/shared/src/lib/types/execution-node.types.ts` | Add `model?: string` to `AgentStartEvent` interface | Trivial |
| `libs/shared/src/lib/utils/pricing.utils.ts`        | Add `formatModelDisplayName()` utility function     | Low     |

### Backend (Data Pipeline)

| File                                                              | Change                                                                                                                              | Effort         |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts`    | No changes needed - already extracts per-model data                                                                                 | None           |
| `libs/backend/agent-sdk/src/lib/sdk-message-transformer.ts`       | Ensure `model` from `message_start` events is included in `MessageStartEvent` or `MessageCompleteEvent` (verify it's already there) | Verify only    |
| `libs/backend/agent-sdk/src/lib/helpers/subagent-hook-handler.ts` | Optional: Pass configured model from AgentDefinition (if available)                                                                 | Low (optional) |

### Frontend (Display)

| File                                                                               | Change                                                                                                                    | Effort |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------ |
| `libs/frontend/chat/src/lib/services/tree-builder.service.ts`                      | Propagate model from child MessageCompleteEvent to parent agent node; aggregate tokenUsage and cost across agent children | Medium |
| `libs/frontend/chat/src/lib/components/organisms/inline-agent-bubble.component.ts` | Add model name badge, token badge to agent header template; add computed signals for model display and token counts       | Medium |
| `libs/frontend/chat/src/lib/components/atoms/model-badge.component.ts`             | NEW: Optional atom component for model display badge (or use inline template)                                             | Low    |

### Testing

| File                                                                                    | Change                                       | Effort |
| --------------------------------------------------------------------------------------- | -------------------------------------------- | ------ |
| `libs/frontend/chat/src/lib/services/tree-builder.service.spec.ts`                      | Test model propagation and token aggregation | Medium |
| `libs/frontend/chat/src/lib/components/organisms/inline-agent-bubble.component.spec.ts` | Test new model/token display                 | Low    |

---

## 7. SDK Limitations and Workarounds

### Limitation 1: No Model in SubagentStart Hook

**Issue**: `SubagentStartHookInput` does not include a `model` field. When a subagent starts, we do not immediately know which model it uses.

**Workaround**: Extract model from the subagent's first `message_start` stream event (`APIAssistantMessage.model`). This arrives shortly after the subagent starts (within milliseconds during streaming). The agent card can show "Starting..." until the model is resolved, then update reactively.

**Evidence**: `APIAssistantMessage` (line 206-215 of `claude-sdk.types.ts`) has `model: string` which is the full model identifier. The `SdkMessageTransformer` already transforms this into `MessageCompleteEvent.model`.

### Limitation 2: Per-Model Stats Not Per-Subagent

**Issue**: `SDKResultMessage.modelUsage` provides usage breakdown by model name across the entire session, not per-subagent. If two subagents use the same model, their usage is merged.

**Workaround**: Accumulate token usage from individual `MessageCompleteEvent.tokenUsage` events, which are per-message and linked to specific agents via `parentToolUseId`. This gives accurate per-subagent totals.

**Evidence**: `MessageCompleteEvent` (lines 865-872 of `execution-node.types.ts`) has `tokenUsage?: { input: number; output: number }` and `cost?: number` fields.

### Limitation 3: AgentDefinition Uses Abstract Model Names

**Issue**: `AgentDefinition.model` uses abstract names ('sonnet', 'opus', 'haiku', 'inherit') rather than full model identifiers.

**Workaround**: Use the resolved model from streaming events rather than the config. The full model ID (e.g., `claude-sonnet-4-20250514`) from `APIAssistantMessage.model` is more informative and accurate.

### Limitation 4: Cost Calculation for Subagent Messages

**Issue**: `MessageCompleteEvent.cost` may not always be populated for intermediate messages within a subagent session. The SDK primarily reports total cost in the result message.

**Workaround**: Use `calculateMessageCost()` from `pricing.utils.ts` with the model ID and token counts from `MessageCompleteEvent`. This provides estimated per-message cost using the pricing table.

---

## 8. Existing Infrastructure Inventory

### Components Ready for Reuse

- `CostBadgeComponent` (`libs/frontend/chat/src/lib/components/atoms/cost-badge.component.ts`) - Already imported in InlineAgentBubble
- `TokenBadgeComponent` (`libs/frontend/chat/src/lib/components/atoms/token-badge.component.ts`) - Needs to be imported into InlineAgentBubble
- `DurationBadgeComponent` (`libs/frontend/chat/src/lib/components/atoms/duration-badge.component.ts`) - Available for optional use
- `session-stats-summary.component.ts` - Shows per-model breakdown (session level, reference implementation)

### Types Ready for Use

- `ExecutionNode.agentModel?: string` - Already defined, needs population
- `ExecutionNode.model?: string` - Already defined, needs population
- `ExecutionNode.tokenUsage?: MessageTokenUsage` - Already defined, needs aggregation
- `ExecutionNode.cost?: number` - Already defined, partially populated
- `AgentInfo.agentModel?: string` - Already defined, needs population

### Utilities Ready for Use

- `findModelPricing()` - Model-to-pricing lookup with fuzzy matching
- `calculateMessageCost()` - Token-to-cost calculation
- `DEFAULT_MODEL_PRICING` - Pricing data for all major models

---

## 9. Risk Assessment

| Risk                                 | Probability  | Impact                                | Mitigation                                           |
| ------------------------------------ | ------------ | ------------------------------------- | ---------------------------------------------------- |
| Model not available on first message | Low (10%)    | Low - show "detecting..." placeholder | Use reactive signal, update when model arrives       |
| Token aggregation performance        | Low (15%)    | Low - tree building is already O(n)   | Aggregate during tree build, not in computed signals |
| Stale model ID in pricing table      | Medium (30%) | Low - fallback to generic pricing     | Keep pricing table updated; use fuzzy matching       |
| UI clutter with too many badges      | Medium (40%) | Medium - reduces readability          | Use compact badges, only show when data available    |
| Breaking existing tests              | Low (20%)    | Medium                                | Changes are additive (optional fields)               |

---

## 10. Priority Recommendation

**Phase 1 (High Priority - Quick Win)**:

1. Add model name display to agent cards using existing `ExecutionNode.model` / `agentModel` data
2. Format model names for readability
3. This alone delivers the primary user-visible improvement

**Phase 2 (Medium Priority)**:

1. Aggregate per-agent token usage in tree builder
2. Add token badge to agent cards
3. Improve per-agent cost accuracy

**Phase 3 (Optional Enhancement)**:

1. Add model to `AgentStartEvent` for earlier display
2. Parse subagent JSONL transcripts for detailed per-subagent stats
3. Add per-agent duration tracking

---

## 11. Research Artifacts

### Primary Sources (Codebase Files Analyzed)

1. `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\types\sdk-types\claude-sdk.types.ts` - SDK type definitions (1671 lines)
2. `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\stream-transformer.ts` - Stream transformation (427 lines)
3. `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\subagent-hook-handler.ts` - Subagent lifecycle hooks (361 lines)
4. `D:\projects\ptah-extension\libs\shared\src\lib\types\execution-node.types.ts` - ExecutionNode types (924 lines)
5. `D:\projects\ptah-extension\libs\shared\src\lib\types\message.types.ts` - Message protocol
6. `D:\projects\ptah-extension\libs\shared\src\lib\types\subagent-registry.types.ts` - Subagent registry
7. `D:\projects\ptah-extension\libs\shared\src\lib\utils\pricing.utils.ts` - Pricing utilities
8. `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\organisms\inline-agent-bubble.component.ts` - Agent card UI (479 lines)
9. `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\organisms\execution-node.component.ts` - Recursive tree renderer
10. `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\organisms\message-bubble.component.html` - Message display
11. `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\usage-extraction.utils.ts` - Token extraction utilities
12. `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\rpc-method-registration.service.ts` - RPC stats flow
13. `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\model-state.service.ts` - Model state management
14. `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\sdk-agent-adapter.ts` - IAIProvider implementation

### Prior Research Referenced

- `D:\projects\ptah-extension\task-tracking\TASK_2025_047\implementation-plan.md` - Token and cost display implementation

---

## 12. Decision Support

**GO Recommendation**: PROCEED WITH CONFIDENCE

- Technical Feasibility: HIGH (all required data available in SDK, most infrastructure exists)
- Implementation Risk: LOW (additive changes, optional fields, no breaking changes)
- User Impact: HIGH (directly addresses the primary user complaint of invisible subagent model/cost)
- Estimated Effort: 2-4 hours for Phase 1, 4-8 hours for Phase 1+2

**Next Agent**: software-architect
**Architect Focus**: Design the model propagation pipeline in tree-builder.service.ts, decide on badge component strategy (reuse vs new), and ensure the approach works for both streaming and history replay scenarios.
