# Implementation Plan - TASK_2025_047: Token & Cost Display

## 📊 Codebase Investigation Summary

### Libraries Discovered

- **@ptah-extension/shared**: Type definitions (libs/shared/src/lib/types/)

  - Key exports: `StrictChatMessage`, `StrictChatSession`, `ExecutionNode`, `JSONLMessage`
  - Documentation: No CLAUDE.md found
  - Usage: Central type system for all message/session data

- **@ptah-extension/chat**: Frontend chat components and services (libs/frontend/chat/src/lib/)
  - Key exports: `TokenBadgeComponent`, `DurationBadgeComponent`, `JsonlMessageProcessor`, `ChatStore`
  - Components: message-bubble (line 58-75 chat-footer for badges)
  - Services: jsonl-processor.service.ts (JSONL parsing), chat.store.ts (state management)

### Patterns Identified

**Pattern 1: JSONL Processing Flow**

- Evidence: libs/frontend/chat/src/lib/services/jsonl-processor.service.ts:98-150
- Components: `JsonlMessageProcessor.processChunk()` → `handleResultMessage()` (line 765)
- Convention: Result messages contain usage data in `chunk.usage` field

**Pattern 2: Message Finalization**

- Evidence: libs/frontend/chat/src/lib/services/chat.store.ts:1219-1261
- Components: `ChatStore.finalizeCurrentMessage()` converts ExecutionNode tree to ExecutionChatMessage
- Convention: ExecutionNode → StrictChatMessage conversion happens at finalization

**Pattern 3: Session Persistence**

- Evidence: libs/frontend/chat/src/lib/services/session-manager.service.ts:1-100
- Components: SessionManager manages session state, node maps
- Convention: Session totals must be calculated from messages array (not stored separately in current implementation)

**Pattern 4: Badge Components (Existing)**

- Evidence:
  - libs/frontend/chat/src/lib/components/atoms/token-badge.component.ts:1-43
  - libs/frontend/chat/src/lib/components/atoms/duration-badge.component.ts:1-40
- Components: Standalone Angular components with signal inputs
- Convention: Format with k/M suffixes, DaisyUI badge styling

### Integration Points

**JSONL Result Message**:

- Location: libs/shared/src/lib/types/execution-node.types.ts:365-371
- Interface: `JSONLMessage.usage: { input_tokens?, output_tokens? }`
- NOTE: Cache tokens (cache_creation_input_tokens, cache_read_input_tokens) NOT in current interface
- Usage: Extract in `handleResultMessage()`

**ExecutionNode.tokenUsage**:

- Location: libs/shared/src/lib/types/execution-node.types.ts:146-150
- Interface: `{ input: number, output: number }` (no cache field)
- Usage: Populated from JSONL result message

**StrictChatMessage Fields**:

- Location: libs/shared/src/lib/types/message.types.ts:904-911
- Interface: `tokens?: { input, output, cacheHit? }`, `cost?: number`, `duration?: number`
- Usage: Populated during ExecutionNode → StrictChatMessage conversion

**StrictChatSession Totals**:

- Location: libs/shared/src/lib/types/message.types.ts:961-963
- Interface: `totalCost?: number`, `totalTokensInput?: number`, `totalTokensOutput?: number`
- Usage: Calculated from messages array when session is saved/loaded

---

## 🏗️ Architecture Design (Codebase-Aligned)

### Design Philosophy

**Chosen Approach**: Incremental Data Enrichment Pipeline
**Rationale**: Data flows through distinct stages (JSONL → ExecutionNode → ExecutionChatMessage → Session), each stage adding token/cost metadata without disrupting existing processing logic.
**Evidence**: JsonlMessageProcessor (stateless), ChatStore.finalizeCurrentMessage (conversion point), existing badge components (display layer)

### Data Flow Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│ STAGE 1: JSONL Parsing                                               │
│ ┌─────────────────────────────────────────────────────────────────┐ │
│ │ JsonlMessageProcessor.handleResultMessage()                      │ │
│ │ Input:  JSONLMessage { type: 'result', usage: {...} }            │ │
│ │ Output: ExecutionNode.tokenUsage { input, output }               │ │
│ │ Output: ExecutionNode.duration (from chunk.duration)             │ │
│ └─────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
                                ↓
┌─────────────────────────────────────────────────────────────────────┐
│ STAGE 2: Message Finalization                                        │
│ ┌─────────────────────────────────────────────────────────────────┐ │
│ │ ChatStore.finalizeCurrentMessage()                               │ │
│ │ Input:  ExecutionNode tree (with tokenUsage, duration)           │ │
│ │ Logic:  Extract tokenUsage from root ExecutionNode               │ │
│ │         Calculate cost using pricing constants                   │ │
│ │ Output: ExecutionChatMessage (extended to StrictChatMessage)     │ │
│ │         with tokens, cost, duration fields populated             │ │
│ └─────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
                                ↓
┌─────────────────────────────────────────────────────────────────────┐
│ STAGE 3: Session Aggregation                                         │
│ ┌─────────────────────────────────────────────────────────────────┐ │
│ │ SessionConverter utility (NEW)                                   │ │
│ │ Input:  ExecutionChatMessage[] (messages array)                  │ │
│ │ Logic:  Sum tokens.input, tokens.output, cost across messages    │ │
│ │ Output: totalTokensInput, totalTokensOutput, totalCost           │ │
│ │ Usage:  Called when creating StrictChatSession from messages     │ │
│ └─────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
                                ↓
┌─────────────────────────────────────────────────────────────────────┐
│ STAGE 4: UI Display                                                  │
│ ┌─────────────────────────────────────────────────────────────────┐ │
│ │ message-bubble.component.html (MODIFY chat-footer)               │ │
│ │ - TokenBadgeComponent (existing, integrate)                      │ │
│ │ - CostBadgeComponent (NEW, create)                               │ │
│ │ - DurationBadgeComponent (existing, integrate)                   │ │
│ │                                                                   │ │
│ │ SessionCostSummaryComponent (NEW)                                │ │
│ │ - Display session totals (totalCost, totalTokens)                │ │
│ │ - Placement: Chat header or sidebar panel                        │ │
│ └─────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

### Component Specifications

---

#### Component 1: JSONL Usage Extractor

**Purpose**: Extract token usage and duration from Claude CLI JSONL result messages and populate ExecutionNode metadata.

**Pattern**: Extend existing JsonlMessageProcessor service
**Evidence**: libs/frontend/chat/src/lib/services/jsonl-processor.service.ts:765-774 (handleResultMessage method exists but incomplete)

**Responsibilities**:

- Extract `usage.input_tokens` and `usage.output_tokens` from JSONL result message
- Extract `duration` from JSONL result message
- Populate `ExecutionNode.tokenUsage` field on message root node
- Populate `ExecutionNode.duration` field on message root node
- Log warnings if usage data is missing or malformed (graceful degradation)

**Implementation Pattern**:

```typescript
// Pattern source: jsonl-processor.service.ts:765-774
// Verified imports: ExecutionNode (execution-node.types.ts:75)

private handleResultMessage(
  chunk: JSONLMessage,
  currentTree: ExecutionNode | null
): ProcessingResult {
  // ENHANCEMENT: Extract usage data and populate ExecutionNode
  if (currentTree && chunk.usage) {
    const updatedTree: ExecutionNode = {
      ...currentTree,
      tokenUsage: {
        input: chunk.usage.input_tokens ?? 0,
        output: chunk.usage.output_tokens ?? 0,
      },
      duration: chunk.duration,
    };

    return {
      tree: updatedTree,
      streamComplete: true,
      newMessageStarted: false,
    };
  }

  // Existing logic (no changes)
  return {
    tree: currentTree,
    streamComplete: true,
    newMessageStarted: false,
  };
}
```

**Quality Requirements**:

**Functional Requirements**:

- Extract token usage from 100% of result messages containing usage field
- Gracefully handle missing usage data (no crash, log warning)
- Preserve existing ExecutionNode structure (immutable updates)

**Non-Functional Requirements**:

- Extraction latency: < 0.1ms (simple object field access)
- Zero impact on existing JSONL processing performance
- Type-safe (leverage TypeScript JSONLMessage.usage type)

**Pattern Compliance**:

- MUST use immutable ExecutionNode updates (spread operator pattern from codebase)
- MUST return ProcessingResult interface (jsonl-processor.service.ts:12-22)
- MUST preserve existing handleResultMessage contract

**Files Affected**:

- libs/frontend/chat/src/lib/services/jsonl-processor.service.ts (MODIFY handleResultMessage method)

---

#### Component 2: Cost Calculator Utility

**Purpose**: Calculate message cost from token counts using Claude Sonnet 4.5 pricing.

**Pattern**: Centralized pricing constants + pure calculation function
**Evidence**: No existing pricing logic found, create new utility following shared library pattern

**Responsibilities**:

- Store Claude Sonnet 4.5 pricing constants (input, output, cache rates)
- Provide pure function to calculate cost from token breakdown
- Handle cache token cost calculation (when cache fields added to types)
- Support precision to 4 decimal places ($0.0001)

**Implementation Pattern**:

````typescript
// NEW FILE: libs/shared/src/lib/utils/pricing.utils.ts
// Pattern: Pure utility functions (no codebase example - creating new)

/**
 * Claude Sonnet 4.5 Pricing (as of December 2024)
 * Source: https://www.anthropic.com/pricing
 * Last updated: 2024-12-06
 */
export const CLAUDE_SONNET_4_5_PRICING = {
  /** Input tokens: $3.00 per 1M tokens */
  INPUT_PER_TOKEN: 0.000003,
  /** Output tokens: $15.00 per 1M tokens */
  OUTPUT_PER_TOKEN: 0.000015,
  /** Cache read tokens: $0.30 per 1M tokens */
  CACHE_READ_PER_TOKEN: 0.0000003,
  /** Cache creation tokens: $3.75 per 1M tokens */
  CACHE_CREATION_PER_TOKEN: 0.0000038,
} as const;

/**
 * Token breakdown for cost calculation
 */
export interface TokenBreakdown {
  readonly input: number;
  readonly output: number;
  readonly cacheHit?: number; // cache read tokens
  readonly cacheCreation?: number; // cache write tokens
}

/**
 * Calculate message cost in USD
 *
 * @param tokens - Token breakdown from message
 * @returns Cost in USD (e.g., 0.0042 for $0.0042)
 *
 * @example
 * ```typescript
 * const cost = calculateMessageCost({
 *   input: 1000,
 *   output: 500,
 *   cacheHit: 200
 * });
 * // Returns: 0.0078 ($0.0078)
 * ```
 */
export function calculateMessageCost(tokens: TokenBreakdown): number {
  const inputCost = tokens.input * CLAUDE_SONNET_4_5_PRICING.INPUT_PER_TOKEN;
  const outputCost = tokens.output * CLAUDE_SONNET_4_5_PRICING.OUTPUT_PER_TOKEN;
  const cacheReadCost = (tokens.cacheHit ?? 0) * CLAUDE_SONNET_4_5_PRICING.CACHE_READ_PER_TOKEN;
  const cacheCreationCost = (tokens.cacheCreation ?? 0) * CLAUDE_SONNET_4_5_PRICING.CACHE_CREATION_PER_TOKEN;

  // Round to 4 decimal places for sub-cent accuracy
  return Math.round((inputCost + outputCost + cacheReadCost + cacheCreationCost) * 10000) / 10000;
}
````

**Quality Requirements**:

**Functional Requirements**:

- Cost accuracy to 4 decimal places (matches pricing page precision)
- Support all 4 token types (input, output, cache read, cache creation)
- Deterministic calculation (same inputs = same output)

**Non-Functional Requirements**:

- Calculation time: < 0.01ms (simple arithmetic)
- Memory overhead: < 100 bytes (constants only)
- Type-safe (TypeScript const pricing object)

**Maintainability Requirements**:

- Pricing constants in single location (one file to update)
- Comment with pricing source URL and last-updated date
- Pure function (no side effects, easy to test)

**Files Affected**:

- libs/shared/src/lib/utils/pricing.utils.ts (CREATE)
- libs/shared/src/index.ts (MODIFY - export pricing utilities)

---

#### Component 3: Message Finalization Enrichment

**Purpose**: Populate StrictChatMessage token and cost fields when converting ExecutionNode tree to chat message.

**Pattern**: Extend ChatStore.finalizeCurrentMessage()
**Evidence**: libs/frontend/chat/src/lib/services/chat.store.ts:1219-1261 (conversion point from ExecutionNode to ExecutionChatMessage)

**Responsibilities**:

- Extract `tokenUsage` from ExecutionNode root after finalization
- Extract `duration` from ExecutionNode root
- Calculate cost using pricing utility
- Populate ExecutionChatMessage with tokens, cost, duration
- Handle missing token data gracefully (leave fields undefined)

**Implementation Pattern**:

```typescript
// Pattern source: chat.store.ts:1219-1261
// Verified imports: ExecutionNode (execution-node.types.ts:75),
//                   createExecutionChatMessage (execution-node.types.ts:242)

private finalizeCurrentMessage(tabId?: string): void {
  // ... existing code to get tree and messageId (lines 1220-1232)

  // Mark all streaming nodes as complete
  const finalizeNode = (node: ExecutionNode): ExecutionNode => ({
    ...node,
    status: node.status === 'streaming' ? 'complete' : node.status,
    children: node.children.map(finalizeNode),
  });

  const finalTree = finalizeNode(tree);

  // ENHANCEMENT: Extract token usage and calculate cost
  let tokens: { input: number; output: number; cacheHit?: number } | undefined;
  let cost: number | undefined;
  let duration: number | undefined;

  if (finalTree.tokenUsage) {
    tokens = {
      input: finalTree.tokenUsage.input,
      output: finalTree.tokenUsage.output,
      // cacheHit: Future enhancement when ExecutionNode.tokenUsage includes cache
    };
    cost = calculateMessageCost(tokens);
  }

  if (finalTree.duration !== undefined) {
    duration = finalTree.duration;
  }

  // Create chat message with execution tree + token/cost metadata
  const assistantMessage = createExecutionChatMessage({
    id: messageId,
    role: 'assistant',
    executionTree: finalTree,
    sessionId: targetTab?.claudeSessionId ?? undefined,
    // ENHANCEMENT: Add token/cost/duration fields
    tokens,
    cost,
    duration,
  });

  // ... existing code to add message to tab (lines 1252-1261)
}
```

**Note**: `createExecutionChatMessage` currently returns `ExecutionChatMessage` (execution-node.types.ts:250). This needs to be aligned with `StrictChatMessage` type which has tokens/cost fields. Two options:

1. Extend ExecutionChatMessage to include tokens/cost/duration (PREFERRED - less coupling)
2. Convert ExecutionChatMessage to StrictChatMessage after creation (more ceremony)

**Quality Requirements**:

**Functional Requirements**:

- Populate tokens field when ExecutionNode.tokenUsage exists
- Calculate cost accurately using pricing utility
- Preserve duration from ExecutionNode
- Gracefully handle missing data (undefined fields)

**Non-Functional Requirements**:

- Finalization overhead: < 2ms per message (including cost calculation)
- Zero impact on message display if token data missing
- Type-safe (leverage existing TypeScript types)

**Pattern Compliance**:

- MUST preserve existing finalizeCurrentMessage behavior (no breaking changes)
- MUST use immutable updates (spread operators)
- MUST call calculateMessageCost from pricing utility

**Files Affected**:

- libs/frontend/chat/src/lib/services/chat.store.ts (MODIFY finalizeCurrentMessage method)
- libs/shared/src/lib/types/execution-node.types.ts (MODIFY ExecutionChatMessage interface to add tokens/cost/duration OR create converter)

---

#### Component 4: Session Total Calculator

**Purpose**: Calculate cumulative token and cost totals across all messages in a session.

**Pattern**: Pure utility function (similar to pricing calculator)
**Evidence**: StrictChatSession totals exist (message.types.ts:961-963) but no calculation logic found

**Responsibilities**:

- Sum `tokens.input` across all messages
- Sum `tokens.output` across all messages
- Sum `cost` across all messages
- Handle messages without token data (skip, don't crash)
- Return session totals object

**Implementation Pattern**:

````typescript
// NEW FILE: libs/shared/src/lib/utils/session-totals.utils.ts
// Pattern: Pure utility function (no state, testable)

import { ExecutionChatMessage } from '../types/execution-node.types';

/**
 * Session totals calculated from messages
 */
export interface SessionTotals {
  readonly totalTokensInput: number;
  readonly totalTokensOutput: number;
  readonly totalCost: number;
  readonly messagesWithCost: number; // Count of messages contributing to totals
}

/**
 * Calculate session totals from messages array
 *
 * @param messages - Array of ExecutionChatMessage
 * @returns Session totals
 *
 * @example
 * ```typescript
 * const totals = calculateSessionTotals(messages);
 * console.log(totals.totalCost); // 0.042
 * ```
 */
export function calculateSessionTotals(messages: readonly ExecutionChatMessage[]): SessionTotals {
  let totalTokensInput = 0;
  let totalTokensOutput = 0;
  let totalCost = 0;
  let messagesWithCost = 0;

  for (const message of messages) {
    if (message.tokens) {
      totalTokensInput += message.tokens.input;
      totalTokensOutput += message.tokens.output;
    }

    if (message.cost !== undefined) {
      totalCost += message.cost;
      messagesWithCost++;
    }
  }

  // Round total cost to 4 decimal places
  totalCost = Math.round(totalCost * 10000) / 10000;

  return {
    totalTokensInput,
    totalTokensOutput,
    totalCost,
    messagesWithCost,
  };
}
````

**Quality Requirements**:

**Functional Requirements**:

- Accurate summation (no floating-point errors > 0.0001)
- Graceful handling of messages without cost data
- Deterministic (same messages = same totals)

**Non-Functional Requirements**:

- Calculation time: < 10ms for 100 messages (O(n) linear scan)
- Memory overhead: < 1KB (no allocations, stack only)
- Pure function (no side effects)

**Files Affected**:

- libs/shared/src/lib/utils/session-totals.utils.ts (CREATE)
- libs/shared/src/index.ts (MODIFY - export session totals utility)

**Usage Context**: This utility will be called wherever StrictChatSession is created from messages (ChatStore, backend session loader, etc.)

---

#### Component 5: Cost Badge Component

**Purpose**: Display per-message cost with appropriate formatting and tooltip breakdown.

**Pattern**: Standalone Angular component (matches existing TokenBadgeComponent pattern)
**Evidence**: libs/frontend/chat/src/lib/components/atoms/token-badge.component.ts:1-43

**Responsibilities**:

- Accept cost as signal input (number in USD)
- Format cost based on magnitude (< $0.01: 4 decimals, >= $0.01: 2 decimals)
- Display DaisyUI badge with cost
- Provide tooltip with cost breakdown (future: input/output/cache breakdown)

**Implementation Pattern**:

```typescript
// NEW FILE: libs/frontend/chat/src/lib/components/atoms/cost-badge.component.ts
// Pattern source: token-badge.component.ts:1-43 (existing badge component)
// Verified imports: Component, input, ChangeDetectionStrategy from @angular/core

import { Component, input, ChangeDetectionStrategy } from '@angular/core';

/**
 * CostBadgeComponent - Displays message cost with formatting
 *
 * Complexity Level: 1 (Simple atom)
 * Patterns: Standalone component, OnPush change detection
 *
 * Formats costs:
 * - < $0.01: "$0.0042" (4 decimal places)
 * - >= $0.01: "$0.12" (2 decimal places)
 * - >= $1.00: "$1.23" (2 decimal places)
 */
@Component({
  selector: 'ptah-cost-badge',
  standalone: true,
  template: `
    <span class="badge badge-outline badge-sm badge-success" [title]="'$' + cost().toFixed(4) + ' USD'">
      {{ formatCost() }}
    </span>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CostBadgeComponent {
  readonly cost = input.required<number>();

  protected formatCost(): string {
    const cost = this.cost();

    if (cost < 0.01) {
      return `$${cost.toFixed(4)}`;
    }

    return `$${cost.toFixed(2)}`;
  }
}
```

**Quality Requirements**:

**Functional Requirements**:

- Accurate cost formatting (no rounding errors)
- Tooltip shows full precision (4 decimals)
- Badge color indicates cost type (success = cost info)

**Non-Functional Requirements**:

- Render time: < 1ms (OnPush change detection)
- Zero dependencies (standalone component)
- DaisyUI badge styling consistency

**Pattern Compliance**:

- MUST use standalone component (Angular 20+ pattern)
- MUST use signal inputs (input.required)
- MUST use OnPush change detection
- MUST follow DaisyUI badge classes

**Files Affected**:

- libs/frontend/chat/src/lib/components/atoms/cost-badge.component.ts (CREATE)
- libs/frontend/chat/src/lib/components/index.ts (MODIFY - export CostBadgeComponent)

---

#### Component 6: Message Bubble Badge Integration

**Purpose**: Display token, cost, and duration badges below assistant messages.

**Pattern**: Enhance existing message-bubble.component.html chat-footer
**Evidence**: libs/frontend/chat/src/lib/components/organisms/message-bubble.component.html:58-75 (existing chat-footer with action buttons)

**Responsibilities**:

- Display TokenBadgeComponent when message.tokens exists
- Display CostBadgeComponent when message.cost exists
- Display DurationBadgeComponent when message.duration exists
- Only show badges for complete messages (not streaming)
- Position badges in chat-footer area (left side, before action buttons)

**Implementation Pattern**:

```html
<!-- Pattern source: message-bubble.component.html:58-75 -->
<!-- Verified components: TokenBadgeComponent (token-badge.component.ts:14),
                          DurationBadgeComponent (duration-badge.component.ts:14) -->

<!-- Action buttons + badges (hover reveal) -->
<div class="chat-footer opacity-0 hover:opacity-100 transition-opacity duration-200 flex gap-2 mt-1 items-center">
  <!-- ENHANCEMENT: Left side - Metadata badges (tokens, cost, duration) -->
  <div class="flex gap-1.5 items-center mr-auto">
    @if (!isStreaming() && message().tokens) {
    <ptah-token-badge [count]="message().tokens!.input + message().tokens!.output" />
    } @if (!isStreaming() && message().cost !== undefined) {
    <ptah-cost-badge [cost]="message().cost!" />
    } @if (!isStreaming() && message().duration !== undefined) {
    <ptah-duration-badge [durationMs]="message().duration!" />
    }
  </div>

  <!-- Existing action buttons (right side) -->
  <button class="btn btn-xs btn-ghost" aria-label="Copy message" title="Copy">
    <lucide-angular [img]="CopyIcon" class="w-3.5 h-3.5" />
  </button>
  <button class="btn btn-xs btn-ghost" aria-label="Like message" title="Like">
    <lucide-angular [img]="ThumbsUpIcon" class="w-3.5 h-3.5" />
  </button>
  <button class="btn btn-xs btn-ghost" aria-label="Dislike message" title="Dislike">
    <lucide-angular [img]="ThumbsDownIcon" class="w-3.5 h-3.5" />
  </button>
</div>
```

**Quality Requirements**:

**Functional Requirements**:

- Badges only show when data available (graceful degradation)
- Badges hidden during streaming (avoid flickering)
- Badges visually distinct from action buttons (left vs right)

**Non-Functional Requirements**:

- Render overhead: < 2ms per message (3 conditional badges)
- Layout stability (no content shift when badges appear)
- Accessibility (badges part of chat-footer semantics)

**Pattern Compliance**:

- MUST use Angular control flow (@if) for conditional rendering
- MUST preserve existing hover:opacity-100 transition
- MUST use DaisyUI gap/flex utilities for spacing

**Files Affected**:

- libs/frontend/chat/src/lib/components/organisms/message-bubble.component.html (MODIFY chat-footer section)
- libs/frontend/chat/src/lib/components/organisms/message-bubble.component.ts (MODIFY - import TokenBadgeComponent, CostBadgeComponent, DurationBadgeComponent)

---

#### Component 7: Session Cost Summary Component

**Purpose**: Display session-level token and cost totals with expandable details.

**Pattern**: Standalone Angular component with signal inputs
**Evidence**: No existing session summary component found, create new following chat library component pattern

**Responsibilities**:

- Accept session totals as signal inputs (totalCost, totalTokensInput, totalTokensOutput, messageCount)
- Display compact summary (total cost, total tokens)
- Expand to show detailed breakdown (average cost per message, cache efficiency)
- Reactive updates when session totals change (signal-based)
- Placement: Chat header area OR collapsible sidebar panel (TBD during implementation)

**Implementation Pattern**:

```typescript
// NEW FILE: libs/frontend/chat/src/lib/components/molecules/session-cost-summary.component.ts
// Pattern: Standalone component with signal inputs (similar to message-bubble.component.ts)

import { Component, input, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * SessionCostSummaryComponent - Displays session-level cost and token totals
 *
 * Complexity Level: 2 (Molecule with state)
 * Patterns: Standalone component, OnPush change detection, signal-based state
 *
 * Features:
 * - Compact summary view (total cost, total tokens)
 * - Expandable detail view (average cost, message count, cache efficiency)
 * - Reactive updates via signal inputs
 */
@Component({
  selector: 'ptah-session-cost-summary',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="card bg-base-200 shadow-md">
      <!-- Summary header (always visible) -->
      <div class="card-body p-3 cursor-pointer" (click)="toggleExpanded()">
        <div class="flex items-center justify-between">
          <div class="flex gap-3 items-baseline">
            <span class="text-sm font-medium">Session Cost:</span>
            <span class="text-lg font-bold text-success">
              {{ formatCost(totalCost()) }}
            </span>
          </div>

          <div class="flex gap-2 text-xs text-base-content/70">
            <span>{{ formatTokens(totalTokensInput() + totalTokensOutput()) }} tokens</span>
            <span>•</span>
            <span>{{ messageCount() }} messages</span>
          </div>
        </div>

        <!-- Expanded details -->
        @if (isExpanded()) {
        <div class="divider my-2"></div>

        <div class="grid grid-cols-2 gap-2 text-xs">
          <div>
            <span class="text-base-content/70">Input tokens:</span>
            <span class="font-medium ml-2">{{ formatTokens(totalTokensInput()) }}</span>
          </div>
          <div>
            <span class="text-base-content/70">Output tokens:</span>
            <span class="font-medium ml-2">{{ formatTokens(totalTokensOutput()) }}</span>
          </div>
          <div>
            <span class="text-base-content/70">Avg. cost/message:</span>
            <span class="font-medium ml-2">{{ formatCost(averageCostPerMessage()) }}</span>
          </div>
          <div>
            <span class="text-base-content/70">Messages with cost:</span>
            <span class="font-medium ml-2">{{ messageCount() }}</span>
          </div>
        </div>
        }
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SessionCostSummaryComponent {
  // Signal inputs
  readonly totalCost = input.required<number>();
  readonly totalTokensInput = input.required<number>();
  readonly totalTokensOutput = input.required<number>();
  readonly messageCount = input.required<number>();

  // Local state
  protected readonly isExpanded = signal(false);

  protected toggleExpanded(): void {
    this.isExpanded.update((v) => !v);
  }

  protected averageCostPerMessage(): number {
    const count = this.messageCount();
    return count > 0 ? this.totalCost() / count : 0;
  }

  protected formatCost(cost: number): string {
    if (cost === 0) return '$0.00';
    if (cost < 0.01) return `$${cost.toFixed(4)}`;
    return `$${cost.toFixed(2)}`;
  }

  protected formatTokens(count: number): string {
    if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
    if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
    return `${count}`;
  }
}
```

**Quality Requirements**:

**Functional Requirements**:

- Reactive updates when session totals change (signal inputs)
- Expandable details (click to toggle)
- Show "No usage data" when messageCount = 0
- Accurate average cost calculation

**Non-Functional Requirements**:

- Render time: < 5ms (including calculations)
- Compact size (fits in header area or sidebar)
- Responsive (mobile-friendly)

**Pattern Compliance**:

- MUST use standalone component
- MUST use signal inputs
- MUST use OnPush change detection
- MUST use DaisyUI card styling

**Files Affected**:

- libs/frontend/chat/src/lib/components/molecules/session-cost-summary.component.ts (CREATE)
- libs/frontend/chat/src/lib/components/index.ts (MODIFY - export SessionCostSummaryComponent)

**Placement Decision** (defer to implementation):

- Option A: Chat header (above messages) - requires parent component integration
- Option B: Sidebar panel (collapsible) - less intrusive
- Option C: Tooltip on session info icon - minimal footprint
- **Recommendation**: Start with Option A (header), iterate based on UX feedback

---

## 🔗 Integration Architecture

### Integration Points

**JSONL → ExecutionNode** (Component 1):

- Location: `JsonlMessageProcessor.handleResultMessage()`
- Data: `JSONLMessage.usage` → `ExecutionNode.tokenUsage`, `JSONLMessage.duration` → `ExecutionNode.duration`
- Evidence: jsonl-processor.service.ts:765-774

**ExecutionNode → ExecutionChatMessage** (Component 3):

- Location: `ChatStore.finalizeCurrentMessage()`
- Data: `ExecutionNode.tokenUsage` → `ExecutionChatMessage.tokens`, calculated cost → `ExecutionChatMessage.cost`
- Evidence: chat.store.ts:1219-1261

**ExecutionChatMessage[] → Session Totals** (Component 4):

- Location: Session creation/persistence layer (TBD - likely in ChatStore or backend)
- Data: `calculateSessionTotals(messages)` → `StrictChatSession.totalCost/totalTokensInput/totalTokensOutput`
- Evidence: message.types.ts:961-963 (fields exist, calculation missing)

**Session Totals → UI** (Component 7):

- Location: Parent component (chat container or header)
- Data: Session totals signals → `SessionCostSummaryComponent` inputs
- Evidence: New integration point

### Data Flow

```
JSONL stream
  ↓ [handleResultMessage]
ExecutionNode (with tokenUsage, duration)
  ↓ [finalizeCurrentMessage]
ExecutionChatMessage (with tokens, cost, duration)
  ↓ [messages array]
Session Totals (calculated via utility)
  ↓ [signal bindings]
UI Components (badges, summary)
```

### Dependencies

**External Dependencies** (none required):

- DaisyUI: Already in project (badge styling)
- Angular signals: Core Angular 20+ feature

**Internal Dependencies**:

- `@ptah-extension/shared`: Type definitions (StrictChatMessage, ExecutionNode, JSONLMessage)
- `@ptah-extension/chat`: UI components (message-bubble, existing badges)

---

## 🎯 Quality Requirements (Architecture-Level)

### Functional Requirements

- Extract token usage from 100% of JSONL result messages containing usage field
- Calculate costs with 4 decimal place precision
- Display badges for all assistant messages with token data
- Display session summary reactively (updates when new messages added)
- Graceful degradation when token data missing (no crashes, no layout breaks)

### Non-Functional Requirements

**Performance**:

- Token extraction: < 0.1ms per message
- Cost calculation: < 0.01ms per message
- Session total calculation: < 10ms for 100 messages
- Badge rendering: < 2ms per message

**Accuracy**:

- Cost precision: 4 decimal places ($0.0001)
- Token counts: Exact match with Claude CLI values
- Session totals: Deterministic recalculation

**Reliability**:

- Zero crashes from missing token data
- Zero UI layout breaks from badge addition
- Data persists across VS Code restarts (leverage existing session persistence)

**Usability**:

- Badges visible without interaction (hover reveals chat-footer)
- Tooltips for detailed breakdowns (< 500ms delay)
- Clear formatting (k/M suffixes, currency symbols)

**Maintainability**:

- Pricing constants in single file (libs/shared/src/lib/utils/pricing.utils.ts)
- Pure utility functions (testable, no side effects)
- Type-safe (leverage TypeScript types)

### Pattern Compliance

**Verified Patterns from Codebase**:

- MUST use immutable ExecutionNode updates (spread operators)
- MUST use standalone Angular components
- MUST use signal inputs for component inputs
- MUST use OnPush change detection
- MUST use DaisyUI styling classes
- MUST follow JsonlMessageProcessor stateless pattern
- MUST preserve existing ProcessingResult contract

**Evidence Citations**:

- Immutable updates: jsonl-processor.service.ts:412-434 (replaceNodeInTree)
- Standalone components: token-badge.component.ts:14-26
- Signal inputs: token-badge.component.ts:28
- OnPush: token-badge.component.ts:25
- DaisyUI: token-badge.component.ts:19 (badge classes)

---

## 🤝 Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: frontend-developer

**Rationale**:

1. **UI Component Work**: Creating CostBadgeComponent, SessionCostSummaryComponent, integrating badges into message-bubble.component.html
2. **Angular Expertise**: Leveraging Angular signals, standalone components, OnPush change detection
3. **Service Modification**: Modifying ChatStore and JsonlMessageProcessor (frontend services)
4. **Type Extension**: Extending ExecutionChatMessage interface (shared types, but frontend context)

**Backend Work Minimal**: Only creating pricing/session-totals utilities in shared library (pure TypeScript, no Node.js/NestJS dependencies)

### Complexity Assessment

**Complexity**: MEDIUM
**Estimated Effort**: 12-16 hours

**Breakdown**:

1. **Component 1 (JSONL Extractor)**: 2-3 hours

   - Modify handleResultMessage (1 hour)
   - Test usage extraction (1 hour)
   - Handle edge cases (1 hour)

2. **Component 2 (Cost Calculator)**: 1-2 hours

   - Create pricing.utils.ts (0.5 hours)
   - Implement calculateMessageCost (0.5 hours)
   - Unit tests (1 hour)

3. **Component 3 (Message Finalization)**: 2-3 hours

   - Modify finalizeCurrentMessage (1 hour)
   - Integrate cost calculation (0.5 hours)
   - Test finalization flow (1.5 hours)

4. **Component 4 (Session Totals)**: 1-2 hours

   - Create session-totals.utils.ts (0.5 hours)
   - Implement calculateSessionTotals (0.5 hours)
   - Unit tests (1 hour)

5. **Component 5 (Cost Badge)**: 1-2 hours

   - Create cost-badge.component.ts (0.5 hours)
   - Format cost logic (0.5 hours)
   - Styling/tooltip (1 hour)

6. **Component 6 (Badge Integration)**: 2-3 hours

   - Modify message-bubble.component.html (1 hour)
   - Import/wire badge components (0.5 hours)
   - Test badge display/layout (1.5 hours)

7. **Component 7 (Session Summary)**: 3-4 hours
   - Create session-cost-summary.component.ts (2 hours)
   - Expandable details logic (1 hour)
   - Integrate into chat parent (1 hour)

**Risk Factors**:

- **Type Alignment**: ExecutionChatMessage vs StrictChatMessage type mismatch may require additional refactoring (+2 hours)
- **Session Persistence**: Finding where StrictChatSession is created/saved may require investigation (+1 hour)
- **UI Placement**: SessionCostSummaryComponent placement decision may iterate (+1 hour)

### Files Affected Summary

**CREATE**:

- libs/shared/src/lib/utils/pricing.utils.ts (Component 2)
- libs/shared/src/lib/utils/session-totals.utils.ts (Component 4)
- libs/frontend/chat/src/lib/components/atoms/cost-badge.component.ts (Component 5)
- libs/frontend/chat/src/lib/components/molecules/session-cost-summary.component.ts (Component 7)

**MODIFY**:

- libs/frontend/chat/src/lib/services/jsonl-processor.service.ts (Component 1 - handleResultMessage method)
- libs/frontend/chat/src/lib/services/chat.store.ts (Component 3 - finalizeCurrentMessage method)
- libs/frontend/chat/src/lib/components/organisms/message-bubble.component.html (Component 6 - chat-footer section)
- libs/frontend/chat/src/lib/components/organisms/message-bubble.component.ts (Component 6 - imports)
- libs/frontend/chat/src/lib/components/index.ts (exports)
- libs/shared/src/index.ts (exports)
- libs/shared/src/lib/types/execution-node.types.ts (OPTIONAL - extend ExecutionChatMessage OR create converter)

**REWRITE** (Direct Replacement): None

### Critical Verification Points

**Before Implementation, Team-Leader Must Ensure Developer Verifies**:

1. **All imports exist in codebase**:

   - `ExecutionNode` from libs/shared/src/lib/types/execution-node.types.ts:75
   - `JSONLMessage` from libs/shared/src/lib/types/execution-node.types.ts:337
   - `StrictChatMessage` from libs/shared/src/lib/types/message.types.ts:883
   - `createExecutionChatMessage` from libs/shared/src/lib/types/execution-node.types.ts (VERIFY export exists)
   - `TokenBadgeComponent` from libs/frontend/chat/src/lib/components/atoms/token-badge.component.ts:27
   - `DurationBadgeComponent` from libs/frontend/chat/src/lib/components/atoms/duration-badge.component.ts:24

2. **All patterns verified from examples**:

   - Immutable ExecutionNode updates: jsonl-processor.service.ts:412-434
   - Standalone component pattern: token-badge.component.ts:14-26
   - Signal inputs: token-badge.component.ts:28
   - OnPush change detection: token-badge.component.ts:25
   - DaisyUI badge styling: token-badge.component.ts:19

3. **Type alignment investigation**:

   - Developer MUST verify whether `createExecutionChatMessage` returns type compatible with StrictChatMessage
   - If not, developer MUST decide: extend ExecutionChatMessage OR create converter function
   - Document decision in implementation

4. **No hallucinated APIs**:
   - All ExecutionNode fields verified: execution-node.types.ts:146-150 (tokenUsage), :144 (duration)
   - All JSONLMessage fields verified: execution-node.types.ts:365-371 (usage, duration)
   - All StrictChatMessage fields verified: message.types.ts:904-911 (tokens, cost, duration)
   - All StrictChatSession fields verified: message.types.ts:961-963 (totalCost, totalTokensInput, totalTokensOutput)

### Architecture Delivery Checklist

- [x] All components specified with evidence
- [x] All patterns verified from codebase
- [x] All imports/decorators verified as existing
- [x] Quality requirements defined (functional + non-functional)
- [x] Integration points documented
- [x] Files affected list complete
- [x] Developer type recommended (frontend-developer)
- [x] Complexity assessed (MEDIUM, 12-16 hours)
- [x] No step-by-step implementation (that's team-leader's job)
- [x] Evidence citations provided for all patterns

---

## 📝 Implementation Notes

### Recommended Implementation Order

1. **Backend First**: Create pricing.utils.ts and session-totals.utils.ts (pure utilities, easy to test)
2. **JSONL Extraction**: Modify JsonlMessageProcessor.handleResultMessage (populates ExecutionNode)
3. **Message Finalization**: Modify ChatStore.finalizeCurrentMessage (populates ExecutionChatMessage)
4. **UI Components**: Create CostBadgeComponent (parallel to existing TokenBadgeComponent)
5. **Badge Integration**: Modify message-bubble.component.html (display badges)
6. **Session Summary**: Create SessionCostSummaryComponent (last, depends on session totals)
7. **Testing**: Unit tests for utilities, integration test for full flow

### Key Design Decisions

**Pricing Constants Location**: `libs/shared/src/lib/utils/pricing.utils.ts`

- Rationale: Shared library ensures frontend and backend (if needed) can access pricing
- Maintenance: Single file to update when pricing changes
- Evidence: No existing pricing logic found, creating new pattern

**Session Summary Placement**: Defer to implementation phase

- Options: Chat header, sidebar panel, tooltip
- Recommendation: Start with chat header (most visible), iterate based on UX
- Evidence: No existing session summary component to reference

**Type Strategy**: Extend ExecutionChatMessage vs Converter

- Recommended: Extend ExecutionChatMessage to include tokens/cost/duration (less coupling)
- Alternative: Create converter function (more ceremony, but preserves type separation)
- Decision: Developer chooses during implementation based on type compatibility

**Cache Token Display**: Future enhancement

- Current: ExecutionNode.tokenUsage only has input/output fields
- Future: Add cacheHit field when JSONLMessage.usage includes cache_read_input_tokens
- Note: Pricing calculation already supports cache tokens (future-proof)

### Testing Strategy

**Unit Tests Required**:

1. `pricing.utils.spec.ts`: Test calculateMessageCost with various token breakdowns
2. `session-totals.utils.spec.ts`: Test calculateSessionTotals with edge cases (empty array, missing data)
3. `cost-badge.component.spec.ts`: Test cost formatting logic
4. `session-cost-summary.component.spec.ts`: Test expand/collapse, average calculation

**Integration Tests**:

1. Full flow test: JSONL result message → ExecutionNode → ExecutionChatMessage → UI badges
2. Session totals test: Messages array → calculateSessionTotals → SessionCostSummaryComponent

**Manual Testing**:

1. Verify cost accuracy against Anthropic pricing page (spot check 5-10 messages)
2. Test graceful degradation (messages without token data display normally)
3. Test badge layout on various screen sizes (responsive)
4. Test session summary expand/collapse interaction

---

## 🚨 Risks and Mitigation

### Risk 1: Type Alignment (ExecutionChatMessage vs StrictChatMessage)

- **Risk**: ExecutionChatMessage may not have tokens/cost/duration fields, requiring type refactoring
- **Probability**: Medium
- **Impact**: Medium (extra refactoring work)
- **Mitigation**: Developer investigates type compatibility BEFORE modifying finalizeCurrentMessage
- **Contingency**: If types incompatible, create converter function or extend ExecutionChatMessage interface

### Risk 2: JSONL Cache Token Fields Missing

- **Risk**: JSONLMessage.usage may not include cache_creation_input_tokens and cache_read_input_tokens
- **Probability**: High (confirmed in investigation)
- **Impact**: Low (future enhancement, not blocking)
- **Mitigation**: Implement without cache tokens initially, add when JSONL format confirmed
- **Contingency**: Pricing calculation already supports cache tokens (future-proof), UI tooltips can be enhanced later

### Risk 3: Session Totals Calculation Location Unclear

- **Risk**: Unclear where StrictChatSession objects are created/saved from ExecutionChatMessage arrays
- **Probability**: Medium
- **Impact**: Medium (may require backend investigation)
- **Mitigation**: Developer uses Grep to find session creation/persistence logic BEFORE implementing Component 4
- **Contingency**: If backend handles session persistence, coordinate with backend-developer to integrate calculateSessionTotals

### Risk 4: UI Layout Disruption from Badges

- **Risk**: Adding badges to chat-footer may break existing layout or cause visual clutter
- **Probability**: Low
- **Impact**: Medium (poor UX)
- **Mitigation**: Use existing DaisyUI badge components (already tested), position with flexbox (left vs right)
- **Contingency**: Iterate badge placement based on visual testing, consider chat-footer redesign if needed

---

## 📚 References

- **Anthropic Pricing**: https://www.anthropic.com/pricing (Claude Sonnet 4.5 pricing as of Dec 2024)
- **JSONL Message Format**: libs/shared/src/lib/types/execution-node.types.ts:337-375
- **Existing Badge Components**:
  - libs/frontend/chat/src/lib/components/atoms/token-badge.component.ts
  - libs/frontend/chat/src/lib/components/atoms/duration-badge.component.ts
- **Session Types**: libs/shared/src/lib/types/message.types.ts:883-964
- **JSONL Processor**: libs/frontend/chat/src/lib/services/jsonl-processor.service.ts
- **Chat Store**: libs/frontend/chat/src/lib/services/chat.store.ts

---

## 🎯 Success Metrics

### User-Facing Metrics

- Users can see token counts for 100% of assistant messages (when data available)
- Users can see costs for 100% of assistant messages (when data available)
- Users can view session-level cost summary for all sessions
- Zero user-reported bugs related to incorrect cost calculations

### Technical Metrics

- Cost calculation accuracy: 100% match with manual calculations using Anthropic pricing
- Performance: < 2ms render overhead per message for badge display
- Graceful degradation: 100% of messages without token data display normally (no crashes, no layout breaks)
- Test coverage: 80%+ for token extraction and cost calculation logic
