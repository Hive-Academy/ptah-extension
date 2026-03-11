# Implementation Plan - TASK_2025_132: Subagent Model Info, Token Stats & Pricing Display

## Codebase Investigation Summary

### Libraries Analyzed

- **shared** (`libs/shared/src`): ExecutionNode types, MessageCompleteEvent, pricing utilities
- **chat** (`libs/frontend/chat/src`): ExecutionTreeBuilderService, InlineAgentBubbleComponent, badge atoms
- **agent-sdk** (`libs/backend/agent-sdk/src`): SdkMessageTransformer (produces MessageCompleteEvent with model/cost/tokens)

### Key Findings

1. **ExecutionNode already has all required fields** (verified: `execution-node.types.ts:161,196-202`):

   - `agentModel?: string` (line 161) - NOT populated
   - `model?: string` (line 202) - NOT populated for agent nodes
   - `tokenUsage?: MessageTokenUsage` (line 196) - NOT aggregated for agent nodes
   - `cost?: number` (line 199) - NOT aggregated for agent nodes
   - `duration?: number` (line 193) - NOT calculated for agent nodes

2. **MessageCompleteEvent carries all data** (verified: `execution-node.types.ts:865-872`):

   - `model?: string` - Full model ID (e.g., `claude-sonnet-4-20250514`)
   - `tokenUsage?: { input: number; output: number }` - Per-message tokens
   - `cost?: number` - Per-message cost
   - `duration?: number` - Per-message duration
   - `parentToolUseId?: string` - Links to parent agent's tool call

3. **SdkMessageTransformer populates model/cost on MessageCompleteEvent** (verified: `sdk-message-transformer.ts:677-703`):

   - `model: message.model` (line 701) - Set from `APIAssistantMessage.model`
   - `cost` (line 688-689) - Calculated via `calculateMessageCost()`
   - `tokenUsage` (lines 677-685) - Extracted from `message.usage`
   - **Limitation**: `message_stop` stream events (line 284-294) do NOT include model/cost/tokens

4. **Tree builder creates agent nodes WITHOUT propagating child stats** (verified: `execution-tree-builder.service.ts:708-830`):

   - `buildAgentNode()` creates agent ExecutionNode at line 818 with `createExecutionNode()`
   - No `model`, `tokenUsage`, `cost`, or `duration` fields passed
   - Child messages are unwrapped (`messageNode.children`) but their stats are discarded

5. **Existing badge components** (verified):

   - `TokenBadgeComponent` (`atoms/token-badge.component.ts`) - Accepts `MessageTokenUsage | number`
   - `CostBadgeComponent` (`atoms/cost-badge.component.ts`) - Accepts `number` (required)
   - `DurationBadgeComponent` (`atoms/duration-badge.component.ts`) - Accepts `number` (required, ms)

6. **Model name formatting already exists** in `SessionStatsSummaryComponent` (verified: `session-stats-summary.component.ts:528-567`):
   - `formatModelName()` method handles Opus, Sonnet, Haiku variants
   - Maps full model IDs to readable names (e.g., "Sonnet 4", "Opus 4.5")
   - Currently a protected method on the component class - needs extraction to shared utility

### Patterns Identified

- **Agent node creation**: `createExecutionNode({ type: 'agent', ...fields })` pattern used in 3 places in tree builder
- **Message footer badges**: `message-bubble.component.html:56-79` shows the `chat-footer` pattern with token/cost/duration badges
- **Inline badges in agent header**: `inline-agent-bubble.component.ts:130-131` already has cost badge in header

---

## Architecture Design

### Design Philosophy

**Approach**: Frontend-side stat aggregation during tree building
**Rationale**: All required data (model, tokens, cost) already flows to the frontend via `MessageCompleteEvent`. The tree builder already iterates all events and builds agent nodes. Aggregating stats during this existing traversal is the natural, performant approach - no backend changes needed.

### Data Flow Diagram

```
SDK (Backend)                          Frontend (Chat Library)
=============                          ======================

APIAssistantMessage.model ─────┐
APIAssistantMessage.usage ─────┤
                               ▼
SdkMessageTransformer          │
  .transformAssistantToFlatEvents()
    → MessageCompleteEvent {   │
        model: "claude-sonnet-4-20250514",
        tokenUsage: { input: 500, output: 200 },
        cost: 0.0045,          │
        parentToolUseId: "toolu_abc123"
      }                        │
                               ▼
                         StreamingState.events (Map)
                               │
                               ▼
                    ExecutionTreeBuilderService
                      .buildAgentNode()
                               │
                    ┌──────────┴──────────┐
                    │  NEW: Aggregate     │
                    │  child message_complete │
                    │  events to compute: │
                    │  - agentModel       │
                    │  - tokenUsage (sum) │
                    │  - cost (sum)       │
                    │  - duration (calc)  │
                    └──────────┬──────────┘
                               │
                               ▼
                    ExecutionNode (type: 'agent')
                    {
                      agentModel: "claude-sonnet-4-20250514",
                      model: "claude-sonnet-4-20250514",
                      tokenUsage: { input: 1500, output: 800 },
                      cost: 0.0234,
                      duration: 45000,
                      ...existingFields
                    }
                               │
                               ▼
                    InlineAgentBubbleComponent
                    ┌──────────────────────────┐
                    │ [Header - unchanged]      │
                    │  Avatar | Type | Desc     │
                    │  Status | Cost(header)    │
                    ├──────────────────────────┤
                    │ [Collapsible Content]     │
                    │  ...children nodes...     │
                    ├──────────────────────────┤
                    │ [NEW: Stats Footer]       │
                    │  Sonnet 4 | 2.3k tokens  │
                    │  $0.0234  | 45.0s        │
                    └──────────────────────────┘
```

---

## Component Specifications

### Component 1: Stat Aggregation in ExecutionTreeBuilderService

**Purpose**: Compute per-agent model, token, cost, and duration statistics from child MessageCompleteEvent data during tree building.

**Pattern**: Extension of existing `buildAgentNode()` method
**Evidence**: `execution-tree-builder.service.ts:708-830` - current `buildAgentNode()` already iterates child messages

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\execution-tree-builder.service.ts`
**Action**: MODIFY

**Responsibilities**:

- Extract model from the first `message_complete` event with a non-null `model` field for each agent
- Sum `tokenUsage.input` and `tokenUsage.output` across all child `message_complete` events
- Sum `cost` across all child `message_complete` events
- Calculate duration from earliest `message_start` to latest `message_complete` timestamps
- Pass aggregated stats to `createExecutionNode()` when building agent nodes

**Implementation Pattern**:

A new private helper method `aggregateAgentStats()` will collect stats from the streaming state for a given agent's tool call ID:

```typescript
/**
 * Aggregate model, token usage, cost, and duration from child message events.
 * Scans all message_complete events linked to this agent via parentToolUseId.
 *
 * @param toolCallId - The agent's parent tool call ID
 * @param state - Current streaming state
 * @returns Aggregated stats for the agent node
 */
private aggregateAgentStats(
  toolCallId: string,
  state: StreamingState
): {
  agentModel?: string;
  tokenUsage?: { input: number; output: number };
  cost?: number;
  duration?: number;
} {
  let model: string | undefined;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCost = 0;
  let hasTokenData = false;
  let earliestStart: number | undefined;
  let latestEnd: number | undefined;

  for (const event of state.events.values()) {
    // Only look at events linked to this agent's tool call
    if (event.parentToolUseId !== toolCallId) continue;

    if (event.eventType === 'message_complete') {
      const complete = event as MessageCompleteEvent;

      // Capture model from first message_complete that has it
      if (!model && complete.model) {
        model = complete.model;
      }

      // Accumulate token usage
      if (complete.tokenUsage) {
        totalInputTokens += complete.tokenUsage.input;
        totalOutputTokens += complete.tokenUsage.output;
        hasTokenData = true;
      }

      // Accumulate cost
      if (complete.cost) {
        totalCost += complete.cost;
      }

      // Track latest timestamp for duration calculation
      if (!latestEnd || complete.timestamp > latestEnd) {
        latestEnd = complete.timestamp;
      }
    }

    if (event.eventType === 'message_start') {
      // Track earliest timestamp for duration calculation
      if (!earliestStart || event.timestamp < earliestStart) {
        earliestStart = event.timestamp;
      }
    }
  }

  return {
    agentModel: model,
    tokenUsage: hasTokenData ? { input: totalInputTokens, output: totalOutputTokens } : undefined,
    cost: totalCost > 0 ? totalCost : undefined,
    duration: earliestStart && latestEnd && latestEnd > earliestStart
      ? latestEnd - earliestStart
      : undefined,
  };
}
```

Then in `buildAgentNode()` (line 818), add the aggregated stats:

```typescript
// EXISTING code at line 817-829
const agentNode = createExecutionNode({
  id: agentStart.id,
  type: 'agent',
  status: finalChildren.length > 0 ? 'complete' : 'streaming',
  content: agentStart.agentDescription || '',
  children: finalChildren,
  startTime: agentStart.timestamp,
  agentType: agentStart.agentType,
  agentDescription: agentStart.agentDescription,
  toolCallId: agentStart.toolCallId,
  agentId: effectiveAgentId,
  // NEW: Add aggregated stats
  ...stats, // spreads agentModel, tokenUsage, cost, duration
  model: stats.agentModel, // also set model field for consistency
});
```

**Critical Note**: The same aggregation must be applied in THREE places where agent nodes are created:

1. `buildAgentNode()` method (line 818) - primary agent node creation
2. Placeholder agent creation in `collectTools()` (line 664) - streaming placeholder
3. `buildToolChildren()` method (line 1151) - agent nodes within tool children

For the placeholder agent (place 2), we can call the same `aggregateAgentStats()` with the `toolStart.toolCallId`. For `buildToolChildren()` (place 3), we call it with `toolCallId` parameter.

**Quality Requirements**:

- Must not impact tree building performance (single pass over events, no re-iteration)
- Must handle missing data gracefully (some events may not have model/tokens during streaming)
- Must aggregate correctly when agent has multiple assistant messages

---

### Component 2: `formatModelDisplayName()` Utility Function

**Purpose**: Convert full model IDs to human-readable display names. Extract the existing `formatModelName()` logic from `SessionStatsSummaryComponent` into a shared utility.

**Pattern**: Pure utility function in shared library
**Evidence**: `session-stats-summary.component.ts:528-567` has the existing implementation; `pricing.utils.ts` is the natural home for model-related utilities

**File**: `D:\projects\ptah-extension\libs\shared\src\lib\utils\pricing.utils.ts`
**Action**: MODIFY (add new exported function)

**Implementation Pattern**:

```typescript
/**
 * Format a full model ID to a human-readable display name.
 *
 * Maps model identifiers from the API to short readable names:
 * - "claude-sonnet-4-20250514" -> "Sonnet 4"
 * - "claude-opus-4-5-20251101" -> "Opus 4.5"
 * - "claude-haiku-4-5-20251001" -> "Haiku 4.5"
 * - "gpt-4o-2024-08-06" -> "GPT-4o"
 * - Unknown models -> truncated ID
 *
 * @param modelId - Full model identifier from API
 * @returns Human-readable model name
 */
export function formatModelDisplayName(modelId: string): string {
  if (!modelId) return 'Unknown';

  const lower = modelId.toLowerCase();

  // Anthropic Claude models
  if (lower.includes('opus')) {
    if (lower.includes('4.5') || lower.includes('4-5')) return 'Opus 4.5';
    if (lower.includes('4')) return 'Opus 4';
    if (lower.includes('3')) return 'Opus 3';
    return 'Opus';
  }

  if (lower.includes('sonnet')) {
    if (lower.includes('4.5') || lower.includes('4-5')) return 'Sonnet 4.5';
    if (lower.includes('4')) return 'Sonnet 4';
    if (lower.includes('3.5') || lower.includes('3-5')) return 'Sonnet 3.5';
    return 'Sonnet';
  }

  if (lower.includes('haiku')) {
    if (lower.includes('4.5') || lower.includes('4-5')) return 'Haiku 4.5';
    if (lower.includes('3.5') || lower.includes('3-5')) return 'Haiku 3.5';
    return 'Haiku';
  }

  // OpenAI models
  if (lower.includes('gpt-4o-mini')) return 'GPT-4o Mini';
  if (lower.includes('gpt-4o')) return 'GPT-4o';
  if (lower.includes('gpt-4-turbo')) return 'GPT-4 Turbo';
  if (lower.includes('gpt-4')) return 'GPT-4';
  if (lower.includes('gpt-3.5')) return 'GPT-3.5';

  // Google Gemini models
  if (lower.includes('gemini-2')) return 'Gemini 2';
  if (lower.includes('gemini-1.5-pro')) return 'Gemini 1.5 Pro';
  if (lower.includes('gemini-1.5-flash')) return 'Gemini 1.5 Flash';
  if (lower.includes('gemini')) return 'Gemini';

  // Fallback: truncate long IDs
  if (modelId.length > 20) {
    return modelId.substring(0, 20) + '...';
  }
  return modelId;
}
```

After adding this utility, `SessionStatsSummaryComponent.formatModelName()` should be updated to delegate to `formatModelDisplayName()` from shared, reducing duplication.

**Files Affected**:

- `D:\projects\ptah-extension\libs\shared\src\lib\utils\pricing.utils.ts` (MODIFY - add function)
- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\session-stats-summary.component.ts` (MODIFY - delegate to shared utility)

---

### Component 3: Agent Stats Footer in InlineAgentBubbleComponent

**Purpose**: Display model name, token count, cost, and duration as a footer bar below the collapsible content area of agent bubbles.

**Pattern**: Footer section matching the existing `chat-footer` pattern from `message-bubble.component.html:56-79`
**Evidence**:

- Message footer pattern: `message-bubble.component.html:56-79`
- Existing cost badge in header: `inline-agent-bubble.component.ts:130-131`
- Badge components: `token-badge.component.ts`, `cost-badge.component.ts`, `duration-badge.component.ts`

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\organisms\inline-agent-bubble.component.ts`
**Action**: MODIFY

**Responsibilities**:

- Add computed signals for model display name, aggregated tokens, cost, and duration
- Add a stats footer section BELOW the collapsible content div (after line 176)
- Import `TokenBadgeComponent`, `DurationBadgeComponent` (CostBadgeComponent already imported)
- Import `formatModelDisplayName` from `@ptah-extension/shared`
- Remove the cost badge from the header (it will be in the footer instead)
- Only show the footer when the agent has completed (not during streaming) and has stats

**Computed Signals to Add**:

```typescript
import { formatModelDisplayName } from '@ptah-extension/shared';

// Model display name (e.g., "Sonnet 4", "Opus 4.5")
readonly modelDisplayName = computed(() => {
  const model = this.node().agentModel || this.node().model;
  if (!model) return null;
  return formatModelDisplayName(model);
});

// Aggregated token usage for the agent
readonly agentTokenUsage = computed(() => {
  return this.node().tokenUsage ?? null;
});

// Aggregated duration for the agent
readonly agentDuration = computed(() => {
  return this.node().duration ?? null;
});

// Whether we have any stats to show in the footer
readonly hasStats = computed(() => {
  return !!(
    this.modelDisplayName() ||
    this.agentTokenUsage() ||
    this.agentCost() > 0 ||
    this.agentDuration()
  );
});
```

**Template Changes**:

The stats footer goes AFTER the collapsible content div (after the `@if (!isCollapsed())` block ends at line 176), but still INSIDE the outer container div. It appears regardless of collapse state, similar to how `chat-footer` works for messages.

```html
<!-- Agent Stats Footer (shown when stats available and not streaming) -->
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

**Header Change**: Remove the existing cost badge from the header (line 130-132):

```html
<!-- REMOVE from header -->
@if (agentCost() > 0) {
<ptah-cost-badge [cost]="agentCost()" />
}
```

This moves cost display to the footer alongside other stats for a unified experience.

**Import Changes**:

```typescript
// Add to imports array
imports: [
  LucideAngularModule,
  ExecutionNodeComponent,
  TypingCursorComponent,
  CostBadgeComponent,
  TokenBadgeComponent,      // NEW
  DurationBadgeComponent,   // NEW
  NgClass,
],
```

**Quality Requirements**:

- Footer must appear BELOW the collapsible content, not in the header
- Footer is always visible (not affected by collapse state) - consistent with message footer pattern
- Compact single-row layout using existing badge components
- Model name shown as outline badge with full ID as tooltip
- Only renders when at least one stat is available
- Does not render during streaming (stats are incomplete)

---

## Integration Architecture

### Integration Points

1. **Tree Builder -> ExecutionNode**: `aggregateAgentStats()` populates `agentModel`, `tokenUsage`, `cost`, `duration` on agent nodes via `createExecutionNode()` (existing factory function, no changes needed)

2. **Shared Utility -> Component**: `formatModelDisplayName()` imported from `@ptah-extension/shared` into `InlineAgentBubbleComponent` for model name formatting

3. **Badge Components -> Agent Footer**: Existing `TokenBadgeComponent`, `CostBadgeComponent`, `DurationBadgeComponent` reused in the new footer template section

### Data Flow

```
MessageCompleteEvent (in StreamingState.events)
    |
    v
ExecutionTreeBuilderService.aggregateAgentStats()
    |
    v
ExecutionNode { agentModel, tokenUsage, cost, duration }
    |
    v
InlineAgentBubbleComponent (computed signals read from node())
    |
    v
Stats Footer: [Model Badge] [Token Badge] [Cost Badge] [Duration Badge]
```

### Dependencies

All dependencies are **existing** and verified:

- `@ptah-extension/shared` exports `createExecutionNode`, `calculateMessageCost`, `MessageTokenUsage`, `MessageCompleteEvent`, `MessageStartEvent`
- `@ptah-extension/chat` has `TokenBadgeComponent`, `CostBadgeComponent`, `DurationBadgeComponent` in `components/atoms/`

---

## Quality Requirements

### Functional Requirements

- Agent nodes display the correct model name used by the subagent
- Token counts accurately reflect the sum of all assistant messages within the agent
- Cost reflects the sum of all child message costs
- Duration reflects elapsed time from first message_start to last message_complete
- Stats footer appears below the collapsible content area
- Stats only display after streaming completes (when data is available)
- Model names are human-readable (e.g., "Sonnet 4" not "claude-sonnet-4-20250514")
- Full model ID shown as tooltip on the model badge

### Non-Functional Requirements

- **Performance**: Stat aggregation during existing tree build pass (no additional iteration)
- **Cache Correctness**: Tree cache must invalidate when agent stats change (already handled - events map size is fingerprinted)
- **Maintainability**: Shared `formatModelDisplayName()` utility prevents duplication
- **Consistency**: Footer uses same badge components as message bubbles
- **Accessibility**: All badges have descriptive tooltips

### Pattern Compliance

- Agent node creation uses `createExecutionNode()` factory (verified: `execution-node.types.ts:618`)
- Component uses `computed()` signals for derived state (Angular signal pattern)
- Component uses `ChangeDetectionStrategy.OnPush` (existing pattern)
- Badge components are standalone atoms imported into organism (Atomic Design pattern)

---

## Files Affected Summary

### MODIFY

| File                                                                                                            | Change Description                                                                                             |
| --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `D:\projects\ptah-extension\libs\shared\src\lib\utils\pricing.utils.ts`                                         | Add `formatModelDisplayName()` export function                                                                 |
| `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\execution-tree-builder.service.ts`              | Add `aggregateAgentStats()` method; use in `buildAgentNode()`, placeholder creation, and `buildToolChildren()` |
| `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\organisms\inline-agent-bubble.component.ts`   | Add stats footer template; add computed signals; import TokenBadge + DurationBadge; remove header cost badge   |
| `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\session-stats-summary.component.ts` | Refactor `formatModelName()` to delegate to shared `formatModelDisplayName()`                                  |

### NO CHANGES NEEDED (verified)

| File                          | Reason                                                                       |
| ----------------------------- | ---------------------------------------------------------------------------- |
| `execution-node.types.ts`     | `agentModel`, `model`, `tokenUsage`, `cost`, `duration` fields already exist |
| `sdk-message-transformer.ts`  | Already populates `model`, `tokenUsage`, `cost` on `MessageCompleteEvent`    |
| `token-badge.component.ts`    | Already accepts `MessageTokenUsage` input                                    |
| `cost-badge.component.ts`     | Already accepts `number` input                                               |
| `duration-badge.component.ts` | Already accepts `number` input                                               |
| Backend / agent-sdk           | No changes - all data already flows to frontend                              |

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: frontend-developer

**Rationale**:

- All changes are in frontend libraries (shared utilities + chat components)
- No backend changes required
- Requires Angular component expertise (signals, templates, change detection)
- Requires understanding of the ExecutionTreeBuilderService (complex frontend service)

### Complexity Assessment

**Complexity**: MEDIUM
**Estimated Effort**: 3-5 hours

**Breakdown**:

- `formatModelDisplayName()` utility: ~30 min (straightforward extraction)
- Tree builder stat aggregation: ~1.5 hours (3 insertion points, careful event iteration)
- Agent bubble footer UI: ~1 hour (template + computed signals + imports)
- SessionStatsSummary refactor: ~30 min (delegate to shared utility)
- Testing and verification: ~1 hour

### Critical Verification Points

**Before Implementation, Developer Must Verify**:

1. **All imports exist in codebase**:

   - `createExecutionNode` from `@ptah-extension/shared` (verified: `execution-node.types.ts:618`)
   - `MessageCompleteEvent` from `@ptah-extension/shared` (verified: `execution-node.types.ts:865`)
   - `MessageStartEvent` from `@ptah-extension/shared` (verified: `execution-node.types.ts:775`)
   - `TokenBadgeComponent` from atoms (verified: `token-badge.component.ts:39`)
   - `DurationBadgeComponent` from atoms (verified: `duration-badge.component.ts:24`)
   - `CostBadgeComponent` from atoms (verified: `cost-badge.component.ts:27`)

2. **All patterns verified from examples**:

   - Message footer pattern: `message-bubble.component.html:56-79`
   - Badge usage: token-badge accepts `[tokens]` or `[count]`, cost-badge accepts `[cost]`, duration-badge accepts `[durationMs]`
   - Agent node creation: `createExecutionNode()` in tree builder at 3 locations

3. **Tree builder cache invalidation**: The cache uses `events.size` as fingerprint. When new `message_complete` events arrive, `events.size` changes, which correctly invalidates the cache. No additional cache invalidation logic needed.

4. **No hallucinated APIs**:
   - `formatModelDisplayName()` is NEW (to be created in `pricing.utils.ts`)
   - All other APIs are verified as existing in the codebase

### Task Breakdown for Team-Leader

**Task 1**: Add `formatModelDisplayName()` to `pricing.utils.ts`

- Create the utility function in shared library
- Export from `pricing.utils.ts`
- Verify export accessible via `@ptah-extension/shared`

**Task 2**: Add `aggregateAgentStats()` to `ExecutionTreeBuilderService`

- Add private method that scans `state.events` for `message_complete` and `message_start` events matching a given `parentToolUseId`
- Aggregates model (first non-null), tokenUsage (sum), cost (sum), duration (timestamp diff)

**Task 3**: Wire aggregation into all 3 agent node creation sites

- `buildAgentNode()` method (~line 818): Spread stats into `createExecutionNode()`
- Placeholder agent in `collectTools()` (~line 664): Call aggregation with `toolStart.toolCallId`
- `buildToolChildren()` method (~line 1151): Call aggregation with `toolCallId`

**Task 4**: Add stats footer to `InlineAgentBubbleComponent`

- Add imports: `TokenBadgeComponent`, `DurationBadgeComponent`, `formatModelDisplayName`
- Add computed signals: `modelDisplayName`, `agentTokenUsage`, `agentDuration`, `hasStats`
- Add footer template section after collapsible content
- Remove cost badge from header (moved to footer)

**Task 5**: Refactor `SessionStatsSummaryComponent.formatModelName()` to use shared utility

- Import `formatModelDisplayName` from `@ptah-extension/shared`
- Delegate `formatModelName()` to the shared utility

### Architecture Delivery Checklist

- [x] All components specified with evidence
- [x] All patterns verified from codebase
- [x] All imports/decorators verified as existing
- [x] Quality requirements defined
- [x] Integration points documented
- [x] Files affected list complete
- [x] Developer type recommended (frontend-developer)
- [x] Complexity assessed (MEDIUM, 3-5 hours)
- [x] No step-by-step implementation (team-leader decomposes into atomic tasks)
- [x] Data flow diagram provided
- [x] All 3 agent node creation sites identified for stat wiring
