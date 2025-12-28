# Development Tasks - TASK_2025_047

**Total Tasks**: 12 | **Batches**: 4 | **Status**: 4/4 complete

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS

### Assumptions Verified

- ✅ JSONLMessage.usage field exists (execution-node.types.ts:368-371)
- ✅ ExecutionNode.tokenUsage field exists (execution-node.types.ts:147-150)
- ✅ StrictChatMessage.tokens/cost/duration fields exist (message.types.ts:904-911)
- ✅ handleResultMessage method exists (jsonl-processor.service.ts:765-775)
- ✅ finalizeCurrentMessage method exists (chat.store.ts:1219-1261)
- ✅ TokenBadgeComponent and DurationBadgeComponent exist

### Risks Identified

| Risk                                             | Severity | Mitigation                                      |
| ------------------------------------------------ | -------- | ----------------------------------------------- |
| Cache tokens not in JSONLMessage.usage interface | LOW      | Implement without cache, add pricing for future |
| ExecutionNode.tokenUsage lacks cacheHit field    | LOW      | Optional: extend interface if needed            |
| Session totals calculation point unclear         | MEDIUM   | Developer uses Grep to find session creation    |

### Edge Cases to Handle

- [ ] JSONL result without usage → Handled in Task 1.1 (graceful degradation)
- [ ] ExecutionNode without tokenUsage → Handled in Task 2.2 (undefined checks)
- [ ] Messages without tokens/cost → Handled in Batch 3 (conditional rendering)
- [ ] Empty session (no cost data) → Handled in Task 4.1 (fallback message)

---

## Batch 1: Utility Functions ✅ COMPLETE

**Developer**: frontend-developer
**Tasks**: 2 | **Dependencies**: None
**Commit**: b2a9fb4

### Task 1.1: Create Pricing Utility ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\shared\src\lib\utils\pricing.utils.ts
**Spec Reference**: implementation-plan.md:201-292
**Pattern to Follow**: Pure utility function (similar to libs/shared/src/lib/utils/json.utils.ts)

**Quality Requirements**:

- Cost accuracy to 4 decimal places
- Support all 4 token types (input, output, cache read, cache creation)
- Pure function (no side effects, easy to test)
- Pricing constants in single location

**Validation Notes**:

- Risk: Pricing may change → Mitigated by centralized constants with source URL comment
- Edge case: Handle zero tokens (return 0.0000)

**Implementation Details**:

- Create constants: CLAUDE_SONNET_4_5_PRICING with per-token rates
- Input: $3.00 per 1M tokens ($0.000003 per token)
- Output: $15.00 per 1M tokens ($0.000015 per token)
- Cache read: $0.30 per 1M tokens ($0.0000003 per token)
- Cache creation: $3.75 per 1M tokens ($0.0000038 per token)
- Interface: TokenBreakdown { input, output, cacheHit?, cacheCreation? }
- Function: calculateMessageCost(tokens: TokenBreakdown): number
- Round to 4 decimal places for sub-cent accuracy

**Verification**:

- [ ] File exists at D:\projects\ptah-extension\libs\shared\src\lib\utils\pricing.utils.ts
- [ ] CLAUDE_SONNET_4_5_PRICING constant exported
- [ ] calculateMessageCost function exported
- [ ] Pricing source URL in comments
- [ ] Returns numbers with 4 decimal precision

---

### Task 1.2: Create Session Totals Utility ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\shared\src\lib\utils\session-totals.utils.ts
**Dependencies**: None
**Spec Reference**: implementation-plan.md:388-481
**Pattern to Follow**: Pure utility function

**Quality Requirements**:

- Accurate summation (no floating-point errors > 0.0001)
- Graceful handling of messages without cost data
- Deterministic (same messages = same totals)
- O(n) linear scan (< 10ms for 100 messages)

**Validation Notes**:

- Edge case: Empty messages array → Return zeros
- Edge case: Messages without tokens/cost → Skip in calculation

**Implementation Details**:

- Interface: SessionTotals { totalTokensInput, totalTokensOutput, totalCost, messagesWithCost }
- Function: calculateSessionTotals(messages: readonly ExecutionChatMessage[]): SessionTotals
- Sum tokens.input, tokens.output, cost across messages
- Skip messages where fields are undefined
- Round totalCost to 4 decimal places

**Verification**:

- [ ] File exists at D:\projects\ptah-extension\libs\shared\src\lib\utils\session-totals.utils.ts
- [ ] SessionTotals interface exported
- [ ] calculateSessionTotals function exported
- [ ] Returns zeros for empty array
- [ ] Handles undefined fields gracefully

---

**Batch 1 Verification**:

- [ ] Both files exist at paths
- [ ] Export utilities from libs/shared/src/index.ts
- [ ] Build passes: `npx nx build shared`
- [ ] Edge cases handled (empty inputs, undefined fields)

---

## Batch 2: Backend Integration ✅ COMPLETE

**Developer**: frontend-developer
**Tasks**: 3 | **Dependencies**: Batch 1 (pricing utility)
**Commit**: 6f7aeb8

### Task 2.1: Extract Token Usage from JSONL ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\jsonl-processor.service.ts
**Spec Reference**: implementation-plan.md:129-198
**Pattern to Follow**: jsonl-processor.service.ts:412-434 (immutable ExecutionNode updates)

**Quality Requirements**:

- Extract token usage from 100% of result messages with usage field
- Gracefully handle missing usage data (no crash, log warning)
- Preserve existing ExecutionNode structure (immutable updates)
- Zero impact on existing JSONL processing performance

**Validation Notes**:

- Risk: Cache tokens not in JSONLMessage.usage → Skip cache for now (future enhancement)
- Edge case: usage field missing → Leave tokenUsage undefined, log warning
- Edge case: usage.input_tokens or output_tokens missing → Use 0 as fallback

**Implementation Details**:

- Modify handleResultMessage method (lines 765-775)
- Extract chunk.usage.input_tokens and chunk.usage.output_tokens
- Extract chunk.duration
- Populate ExecutionNode.tokenUsage: { input, output }
- Populate ExecutionNode.duration
- Use spread operator for immutable update
- Return ProcessingResult with updated tree

**Verification**:

- [ ] handleResultMessage extracts usage when present
- [ ] ExecutionNode.tokenUsage populated correctly
- [ ] ExecutionNode.duration populated correctly
- [ ] Missing usage data doesn't crash (warning logged)
- [ ] Existing tests still pass

---

### Task 2.2: Enrich Message with Tokens/Cost ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat.store.ts
**Dependencies**: Task 1.1 (pricing utility), Task 2.1 (tokenUsage in tree)
**Spec Reference**: implementation-plan.md:295-386
**Pattern to Follow**: chat.store.ts:1234-1241 (immutable ExecutionNode updates)

**Quality Requirements**:

- Populate tokens field when ExecutionNode.tokenUsage exists
- Calculate cost accurately using pricing utility
- Preserve duration from ExecutionNode
- Gracefully handle missing data (undefined fields)
- Zero impact on message display if token data missing

**Validation Notes**:

- Risk: createExecutionChatMessage may not support tokens/cost/duration parameters
- Mitigation: Check createExecutionChatMessage signature, extend if needed OR manually assign after creation
- Edge case: ExecutionNode.tokenUsage undefined → Leave message.tokens undefined
- Edge case: ExecutionNode.duration undefined → Leave message.duration undefined

**Implementation Details**:

- Modify finalizeCurrentMessage method (lines 1219-1261)
- After finalizeNode, extract finalTree.tokenUsage
- If tokenUsage exists, create tokens object: { input, output }
- Import and call calculateMessageCost(tokens)
- Pass tokens, cost, duration to createExecutionChatMessage OR assign after creation
- Preserve existing finalization logic

**Verification**:

- [ ] Import calculateMessageCost from @ptah-extension/shared
- [ ] ExecutionChatMessage has tokens, cost, duration populated when data available
- [ ] Cost calculation accurate (manual spot check)
- [ ] Missing tokenUsage doesn't break finalization
- [ ] Existing tests still pass

---

### Task 2.3: Export Utilities from Shared Library ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\shared\src\index.ts
**Dependencies**: Task 1.1, Task 1.2
**Spec Reference**: implementation-plan.md:290-291, 478-479

**Quality Requirements**:

- Export pricing utilities for use in frontend libraries
- Export session totals utilities
- Maintain existing export structure

**Implementation Details**:

- Add export for pricing.utils.ts: `export * from './lib/utils/pricing.utils';`
- Add export for session-totals.utils.ts: `export * from './lib/utils/session-totals.utils';`

**Verification**:

- [ ] Can import calculateMessageCost from @ptah-extension/shared
- [ ] Can import calculateSessionTotals from @ptah-extension/shared
- [ ] Build passes: `npx nx build shared`
- [ ] No circular dependency errors

---

**Batch 2 Verification**:

- [ ] All files modified successfully
- [ ] Build passes: `npx nx build chat`
- [ ] No TypeScript errors
- [ ] Utilities imported correctly in chat.store.ts

---

## Batch 3: UI Components ✅ COMPLETE

**Developer**: frontend-developer
**Tasks**: 4 | **Dependencies**: Batch 2 (messages have tokens/cost)
**Commit**: 0d282bd

### Task 3.1: Create Cost Badge Component ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\atoms\cost-badge.component.ts
**Spec Reference**: implementation-plan.md:485-565
**Pattern to Follow**: libs/frontend/chat/src/lib/components/atoms/token-badge.component.ts:1-43

**Quality Requirements**:

- Accurate cost formatting (no rounding errors)
- Tooltip shows full precision (4 decimals)
- Badge color indicates cost type (success = cost info)
- OnPush change detection (< 1ms render)

**Validation Notes**:

- Edge case: cost = 0 → Display "$0.00"
- Edge case: cost < $0.01 → Display "$0.0042" (4 decimals)
- Edge case: cost >= $0.01 → Display "$0.12" (2 decimals)

**Implementation Details**:

- Standalone component with selector: 'ptah-cost-badge'
- Signal input: cost = input.required<number>()
- Template: DaisyUI badge with badge-success class
- formatCost() method: conditional formatting based on amount
- Tooltip with full precision: [title]="'$' + cost().toFixed(4) + ' USD'"
- OnPush change detection

**Verification**:

- [ ] File exists at D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\atoms\cost-badge.component.ts
- [ ] Standalone component with cost signal input
- [ ] formatCost handles all edge cases
- [ ] Tooltip shows 4 decimal places
- [ ] Badge uses DaisyUI classes

---

### Task 3.2: Integrate Badges into Message Bubble ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\organisms\message-bubble.component.html
**Dependencies**: Task 3.1 (CostBadgeComponent)
**Spec Reference**: implementation-plan.md:568-650
**Pattern to Follow**: message-bubble.component.html:58-75 (chat-footer section)

**Quality Requirements**:

- Badges only show when data available (graceful degradation)
- Badges hidden during streaming (avoid flickering)
- Badges visually distinct from action buttons (left vs right)
- No content shift when badges appear

**Validation Notes**:

- Edge case: Streaming message → Hide all badges
- Edge case: No tokens data → Don't show token badge
- Edge case: No cost data → Don't show cost badge
- Edge case: No duration data → Don't show duration badge

**Implementation Details**:

- Modify chat-footer section (lines 58-75)
- Add left-aligned div for metadata badges (tokens, cost, duration)
- Conditional rendering with @if (!isStreaming() && message().tokens)
- TokenBadgeComponent: [count]="message().tokens!.input + message().tokens!.output"
- CostBadgeComponent: [cost]="message().cost!"
- DurationBadgeComponent: [durationMs]="message().duration!"
- Preserve existing action buttons on right side

**Verification**:

- [ ] Badges appear in chat-footer
- [ ] Badges on left, action buttons on right (flexbox mr-auto)
- [ ] Badges hidden during streaming
- [ ] Conditional rendering works (no errors when data missing)
- [ ] Layout stable (no shift when badges render)

---

### Task 3.3: Update Message Bubble Component Imports ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\organisms\message-bubble.component.ts
**Dependencies**: Task 3.1, Task 3.2
**Spec Reference**: implementation-plan.md:649-650

**Quality Requirements**:

- Import all badge components
- Standalone component with correct imports array

**Implementation Details**:

- Import TokenBadgeComponent from '../atoms/token-badge.component'
- Import CostBadgeComponent from '../atoms/cost-badge.component'
- Import DurationBadgeComponent from '../atoms/duration-badge.component'
- Add to component imports array

**Verification**:

- [ ] All badge components imported
- [ ] Component builds without errors
- [ ] Badges render in template

---

### Task 3.4: Export Components from Chat Library ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\index.ts
**Dependencies**: Task 3.1
**Spec Reference**: implementation-plan.md:563-564

**Quality Requirements**:

- Export CostBadgeComponent for reuse
- Maintain existing export structure

**Implementation Details**:

- Add export: `export * from './atoms/cost-badge.component';`

**Verification**:

- [ ] CostBadgeComponent exported
- [ ] Build passes: `npx nx build chat`
- [ ] Can import from @ptah-extension/chat

---

**Batch 3 Verification**:

- [ ] All files created/modified
- [ ] Build passes: `npx nx build chat`
- [ ] Badges display correctly in webview
- [ ] Conditional rendering works (no errors)
- [ ] Visual design matches existing badge components

---

## Batch 4: Session Summary Component ✅ COMPLETE

**Developer**: frontend-developer
**Tasks**: 3 | **Dependencies**: Batch 2 (session totals utility), Batch 3 (UI components)
**Commit**: 2f7fd31

### Task 4.1: Create Session Cost Summary Component ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\session-cost-summary.component.ts
**Spec Reference**: implementation-plan.md:653-801
**Pattern to Follow**: Standalone component with signals (similar to message-bubble.component.ts)

**Quality Requirements**:

- Reactive updates when session totals change (signal inputs)
- Expandable details (click to toggle)
- Show "No usage data" when messageCount = 0
- Accurate average cost calculation
- Render time: < 5ms

**Validation Notes**:

- Edge case: messageCount = 0 → Show "No usage data available"
- Edge case: totalCost = 0 but messageCount > 0 → Show "$0.00" (valid state)
- Edge case: Division by zero in average → Check messageCount > 0

**Implementation Details**:

- Standalone component with selector: 'ptah-session-cost-summary'
- Signal inputs: totalCost, totalTokensInput, totalTokensOutput, messageCount (all required<number>)
- Local state: isExpanded = signal(false)
- Template: DaisyUI card with collapsible details
- Summary: totalCost (formatted), totalTokens (k/M suffix), messageCount
- Expanded: input tokens, output tokens, avg cost/message
- Methods: toggleExpanded(), averageCostPerMessage(), formatCost(), formatTokens()
- OnPush change detection

**Verification**:

- [ ] File exists at D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\session-cost-summary.component.ts
- [ ] All signal inputs defined
- [ ] Expand/collapse toggle works
- [ ] Formatting methods handle edge cases
- [ ] Shows "No usage data" when messageCount = 0

---

### Task 4.2: Export Session Summary Component ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\index.ts
**Dependencies**: Task 4.1
**Spec Reference**: implementation-plan.md:794-795

**Quality Requirements**:

- Export SessionCostSummaryComponent for use in parent components

**Implementation Details**:

- Add export: `export * from './molecules/session-cost-summary.component';`

**Verification**:

- [ ] SessionCostSummaryComponent exported
- [ ] Can import from @ptah-extension/chat

---

### Task 4.3: Document Integration Point for Session Summary ✅ COMPLETE

**File**: Create D:\projects\ptah-extension\task-tracking\TASK_2025_047\session-summary-integration.md
**Dependencies**: Task 4.1
**Spec Reference**: implementation-plan.md:796-800

**Quality Requirements**:

- Document where SessionCostSummaryComponent should be integrated
- Provide example usage with signal bindings

**Validation Notes**:

- Risk: Session totals calculation point unclear → Developer must find session creation/persistence
- Mitigation: Document options for integration (chat header, sidebar, tooltip)

**Implementation Details**:

- Create markdown file documenting integration options
- Option A: Chat header (above messages)
- Option B: Sidebar panel (collapsible)
- Option C: Tooltip on session info icon
- Provide code example showing signal binding
- Document need to call calculateSessionTotals() where sessions created
- Recommend using Grep to find session creation points

**Verification**:

- [ ] File exists with integration documentation
- [ ] Code example provided
- [ ] Options clearly documented
- [ ] Note to find session creation points

---

**Batch 4 Verification**:

- [ ] All files created
- [ ] Build passes: `npx nx build chat`
- [ ] SessionCostSummaryComponent renders correctly
- [ ] Expand/collapse works
- [ ] Integration documentation complete

---

## Final Verification Checklist

**Code Quality**:

- [ ] All TypeScript files compile without errors
- [ ] All imports resolved correctly
- [ ] No circular dependencies
- [ ] Follows codebase patterns (standalone components, signals, OnPush)

**Functionality**:

- [ ] Token usage extracted from JSONL
- [ ] Message tokens/cost populated
- [ ] Badges display correctly
- [ ] Session summary component works
- [ ] Graceful degradation (missing data handled)

**Testing**:

- [ ] Spot check: Cost calculation matches Anthropic pricing
- [ ] Edge case: Messages without tokens display normally
- [ ] Edge case: Empty session shows "No usage data"
- [ ] Visual test: Badge layout on various screen sizes

**Build System**:

- [ ] `npx nx build shared` passes
- [ ] `npx nx build chat` passes
- [ ] No linting errors
- [ ] No type errors

---

## Implementation Notes

### Recommended Implementation Order

1. Batch 1: Utilities (easy to test, no dependencies)
2. Batch 2: Backend integration (populates data)
3. Batch 3: UI components (displays data)
4. Batch 4: Session summary (final integration)

### Key Design Decisions

**Pricing Constants Location**: libs/shared/src/lib/utils/pricing.utils.ts

- Rationale: Shared library for frontend/backend access
- Maintenance: Single file to update when pricing changes

**Session Summary Placement**: Deferred to integration phase

- Options: Chat header, sidebar panel, tooltip
- Recommendation: Document all options, let product decide

**Cache Token Display**: Future enhancement

- Current: Skip cache tokens (not in JSONLMessage.usage)
- Future: Add when JSONL format includes cache fields

### Testing Strategy

**Unit Tests** (create in parallel with implementation):

1. pricing.utils.spec.ts: Test calculateMessageCost
2. session-totals.utils.spec.ts: Test calculateSessionTotals
3. cost-badge.component.spec.ts: Test formatCost

**Integration Test** (after Batch 3):

1. Full flow: JSONL → ExecutionNode → Message → Badges

**Manual Testing** (after all batches):

1. Verify cost accuracy vs Anthropic pricing
2. Test graceful degradation
3. Test responsive layout

---

## Status Icons Reference

| Status         | Meaning                         | Who Sets              |
| -------------- | ------------------------------- | --------------------- |
| ⏸️ PENDING     | Not started                     | team-leader (initial) |
| 🔄 IN PROGRESS | Assigned to developer           | team-leader           |
| 🔄 IMPLEMENTED | Developer done, awaiting verify | developer             |
| ✅ COMPLETE    | Verified and committed          | team-leader           |
| ❌ FAILED      | Verification failed             | team-leader           |
