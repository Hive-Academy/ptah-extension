# Requirements Document - TASK_2025_047

## Introduction

### Business Context

Claude CLI provides comprehensive token usage and cost data with every assistant response, including input tokens, output tokens, cache creation tokens, and cache read tokens. This data is critical for users to understand the cost of their AI interactions and optimize their usage patterns. Currently, this data flows through the system but is never displayed in the UI, creating a significant gap in user awareness and cost transparency.

### Value Proposition

By displaying token counts and costs in the chat UI, users will gain:

- Real-time visibility into the cost of each AI response
- Ability to track cumulative session costs
- Understanding of cache efficiency (cache hits vs new tokens)
- Data-driven insights for optimizing prompt efficiency
- Transparency into AI resource consumption

### Scope

This task focuses on wiring existing infrastructure (types, components, data sources) to display token usage and cost information in the chat UI. The data extraction from Claude CLI, calculation logic, and UI components already exist - they need to be connected.

---

## Requirements

### Requirement 1: Extract Token Usage from Claude CLI JSONL Stream

**User Story:** As the system processing Claude CLI responses, I want to extract token usage data from JSONL result messages, so that token and cost information is available for display.

#### Acceptance Criteria

1. WHEN JsonlMessageProcessor receives a JSONL message with `type === 'result'` THEN it SHALL extract the `usage` field containing:

   - `input_tokens: number`
   - `output_tokens: number`
   - `cache_creation_input_tokens: number` (optional)
   - `cache_read_input_tokens: number` (optional)

2. WHEN usage data is extracted THEN it SHALL populate the `ExecutionNode.tokenUsage` field for the current message node with:

   - `input: number` (mapped from `input_tokens`)
   - `output: number` (mapped from `output_tokens`)
   - `cacheHit: number` (mapped from `cache_read_input_tokens`, if present)

3. WHEN usage data extraction encounters missing or malformed data THEN it SHALL log a warning and continue processing without crashing

4. WHEN a message completes without usage data THEN the `tokenUsage` field SHALL remain undefined (graceful degradation)

---

### Requirement 2: Populate StrictChatMessage Token and Cost Fields

**User Story:** As the SessionManager persisting message data, I want to populate token and cost fields when finalizing messages, so that historical data includes cost information.

#### Acceptance Criteria

1. WHEN SessionManager finalizes a message with `ExecutionNode.tokenUsage` populated THEN it SHALL populate `StrictChatMessage.tokens` with:

   - `input: number` (from `tokenUsage.input`)
   - `output: number` (from `tokenUsage.output`)
   - `cacheHit: number` (from `tokenUsage.cacheHit`, if present)

2. WHEN calculating message cost THEN it SHALL use Claude Sonnet 4.5 pricing:

   - Input tokens: $3 per 1M tokens ($0.000003 per token)
   - Output tokens: $15 per 1M tokens ($0.000015 per token)
   - Cache read tokens: $0.30 per 1M tokens ($0.0000003 per token)
   - Cache creation tokens: $3.75 per 1M tokens ($0.0000038 per token)

3. WHEN cost is calculated THEN it SHALL populate `StrictChatMessage.cost` as a number in USD (e.g., 0.0042 for $0.0042)

4. WHEN token usage is unavailable THEN both `tokens` and `cost` fields SHALL remain undefined

---

### Requirement 3: Calculate and Populate Session-Level Totals

**User Story:** As the SessionManager tracking session state, I want to calculate cumulative token and cost totals across all messages, so that session-level summaries can be displayed.

#### Acceptance Criteria

1. WHEN SessionManager adds or updates a message with token/cost data THEN it SHALL recalculate and populate `StrictChatSession` totals:

   - `totalTokensInput: number` (sum of all message `tokens.input`)
   - `totalTokensOutput: number` (sum of all message `tokens.output`)
   - `totalCost: number` (sum of all message `cost` values)

2. WHEN calculating session totals THEN it SHALL include cache tokens in the cost calculation but NOT in the input token count (cache read tokens are separate)

3. WHEN a message is removed from a session THEN session totals SHALL be recalculated to exclude that message's contribution

4. WHEN loading a session from disk THEN session totals SHALL be recalculated from message data (not persisted separately)

---

### Requirement 4: Display Per-Message Token Badge

**User Story:** As a user viewing chat messages, I want to see a token count badge below each assistant message, so that I know how many tokens were used for that response.

#### Acceptance Criteria

1. WHEN an assistant message has `tokens` data populated THEN the message-bubble component SHALL display a `TokenBadgeComponent` below the message content

2. WHEN displaying the token badge THEN it SHALL show the total tokens (input + output) formatted as:

   - < 1,000 tokens: "324 tokens"
   - > = 1,000 tokens: "1.2k tokens"
   - > = 1,000,000 tokens: "1.2M tokens"

3. WHEN hovering over the token badge THEN it SHALL show a tooltip with detailed breakdown:

   - "Input: 1,234 tokens"
   - "Output: 567 tokens"
   - "Cache hits: 890 tokens" (if cache hits present)

4. WHEN a message is streaming (not yet complete) THEN the token badge SHALL NOT be displayed (only show on complete messages)

5. WHEN a message has no token data THEN no token badge SHALL be displayed (graceful degradation)

---

### Requirement 5: Display Per-Message Cost Badge

**User Story:** As a user viewing chat messages, I want to see the cost of each assistant message, so that I understand the financial impact of my interactions.

#### Acceptance Criteria

1. WHEN an assistant message has `cost` data populated THEN the message-bubble component SHALL display a cost badge below the message content, next to the token badge

2. WHEN displaying the cost badge THEN it SHALL format the cost as:

   - < $0.01: "$0.0042" (4 decimal places for sub-cent amounts)
   - > = $0.01: "$0.12" (2 decimal places for cent amounts)
   - > = $1.00: "$1.23" (2 decimal places for dollar amounts)

3. WHEN hovering over the cost badge THEN it SHALL show a tooltip with cost breakdown:

   - "Input: $0.0012"
   - "Output: $0.0030"
   - "Cache: $0.0001" (if cache tokens present)
   - "Total: $0.0043"

4. WHEN a message is streaming THEN the cost badge SHALL NOT be displayed

5. WHEN a message has no cost data THEN no cost badge SHALL be displayed

---

### Requirement 6: Display Message Duration Badge

**User Story:** As a user viewing chat messages, I want to see how long each message took to generate, so that I can understand response latency.

#### Acceptance Criteria

1. WHEN an assistant message has `duration` data populated THEN the message-bubble component SHALL display a `DurationBadgeComponent` below the message content

2. WHEN displaying the duration badge THEN it SHALL format the duration as:

   - < 1 second: "850ms"
   - < 60 seconds: "12.5s"
   - > = 60 seconds: "2.3m"

3. WHEN a message is streaming THEN the duration badge SHALL NOT be displayed

4. WHEN a message has no duration data THEN no duration badge SHALL be displayed

---

### Requirement 7: Create Session Cost Summary Component

**User Story:** As a user viewing a chat session, I want to see a summary of total tokens and costs for the entire session, so that I can track my overall usage.

#### Acceptance Criteria

1. WHEN viewing a chat session THEN the UI SHALL display a SessionCostSummaryComponent showing:

   - Total input tokens (formatted with k/M suffixes)
   - Total output tokens (formatted with k/M suffixes)
   - Total cost (formatted as currency)
   - Number of messages contributing to totals

2. WHEN the session cost summary is displayed THEN it SHALL be positioned:

   - In the chat header area (above messages), OR
   - In a collapsible panel in the sidebar, OR
   - As a tooltip on hover over a session info icon
   - (Exact placement TBD by UI/UX review during implementation)

3. WHEN session totals update (new message added) THEN the summary SHALL reactively update using Angular signals

4. WHEN a session has zero messages with cost data THEN the summary SHALL display "No usage data available" instead of $0.00

5. WHEN clicking the session cost summary THEN it SHALL expand to show a detailed breakdown:
   - Message count
   - Average cost per message
   - Cache efficiency (% of tokens from cache vs new)
   - Estimated monthly cost (if user continues at current rate)

---

## Non-Functional Requirements

### Performance Requirements

- **Token Calculation Latency**: Cost calculations SHALL complete in < 1ms per message (simple arithmetic)
- **Session Total Recalculation**: Session total recalculation SHALL complete in < 10ms for sessions with up to 100 messages
- **UI Render Impact**: Token/cost badges SHALL NOT increase message render time by more than 2ms per message
- **Memory Overhead**: Token/cost data SHALL add < 100 bytes per message to in-memory session state

### Accuracy Requirements

- **Cost Precision**: Cost calculations SHALL be accurate to 4 decimal places ($0.0001)
- **Token Count Accuracy**: Token counts SHALL match Claude CLI reported values exactly (no rounding)
- **Calculation Consistency**: Recalculating session totals SHALL always produce identical results (deterministic)

### Reliability Requirements

- **Graceful Degradation**: Missing token/cost data SHALL NOT break message display or UI layout
- **Error Handling**: Malformed usage data SHALL be logged and ignored without crashing the UI
- **Data Persistence**: Token/cost data SHALL persist across VS Code restarts (part of session storage)

### Usability Requirements

- **Clarity**: Token/cost badges SHALL use clear, human-readable formatting (k/M suffixes, currency symbols)
- **Discoverability**: Token/cost information SHALL be visible without requiring user interaction (hover, click)
- **Tooltips**: Detailed breakdowns SHALL be accessible via hover tooltips (< 500ms delay)
- **Visual Hierarchy**: Token/cost badges SHALL be visually distinct but not distracting from message content

### Maintainability Requirements

- **Pricing Updates**: Pricing constants SHALL be defined in a single location for easy updates when pricing changes
- **Component Reusability**: Badge components SHALL be reusable across message and session contexts
- **Type Safety**: All token/cost calculations SHALL use TypeScript types to prevent runtime errors
- **Testing**: Token extraction, cost calculation, and badge display SHALL have unit test coverage

---

## Technical Constraints

### Existing Infrastructure (Leverage, Do Not Rebuild)

- **Types Already Defined**: `StrictChatMessage.tokens`, `StrictChatMessage.cost`, `StrictChatSession.totalCost`, `ExecutionNode.tokenUsage` - populate these, do not create new types
- **Components Already Built**: `TokenBadgeComponent`, `DurationBadgeComponent` - integrate these, do not create new components
- **Data Source Identified**: `JSONLMessage` with `type === 'result'` contains `usage` field - extract from here

### Integration Points

- **JSONL Processing**: `JsonlMessageProcessor.handleResultMessage()` - extract usage data here
- **Message Finalization**: `SessionManager.addMessage()` or finalization logic - populate `StrictChatMessage` fields here
- **Session Total Calculation**: `SessionManager` - add method to recalculate session totals
- **UI Integration**: `message-bubble.component.html` - add badge components to assistant message template

### Pricing Model (Claude Sonnet 4.5)

- **Input tokens**: $3.00 per 1M tokens ($0.000003 per token)
- **Output tokens**: $15.00 per 1M tokens ($0.000015 per token)
- **Cache read tokens**: $0.30 per 1M tokens ($0.0000003 per token)
- **Cache creation tokens**: $3.75 per 1M tokens ($0.0000038 per token)
- **Source**: Anthropic pricing page (as of December 2024)

---

## Acceptance Criteria Summary

### Backend (Data Layer)

- [ ] `JsonlMessageProcessor` extracts usage data from `result` JSONL messages
- [ ] `ExecutionNode.tokenUsage` populated with input/output/cacheHit tokens
- [ ] `StrictChatMessage.tokens` populated from `ExecutionNode.tokenUsage`
- [ ] `StrictChatMessage.cost` calculated using Claude Sonnet 4.5 pricing
- [ ] `StrictChatSession` totals (`totalTokensInput`, `totalTokensOutput`, `totalCost`) calculated and populated
- [ ] Session totals recalculated when messages added/removed
- [ ] Graceful handling of missing/malformed usage data

### Frontend (UI Layer)

- [ ] `TokenBadgeComponent` displayed below assistant messages when token data available
- [ ] Token badge formats counts with k/M suffixes
- [ ] Token badge tooltip shows input/output/cache breakdown
- [ ] Cost badge displayed below assistant messages when cost data available
- [ ] Cost badge formats currency with appropriate decimal places
- [ ] Cost badge tooltip shows cost breakdown by token type
- [ ] `DurationBadgeComponent` displayed when duration data available
- [ ] `SessionCostSummaryComponent` created and displayed in chat UI
- [ ] Session summary shows total tokens, cost, message count
- [ ] Session summary reactively updates when new messages added
- [ ] No badges displayed for streaming messages (only complete)
- [ ] No badges displayed when data unavailable (graceful degradation)

### Testing

- [ ] Unit tests for token usage extraction from JSONL
- [ ] Unit tests for cost calculation logic (all token types)
- [ ] Unit tests for session total calculation
- [ ] Unit tests for badge formatting (edge cases: 0, 999, 1000, 1M)
- [ ] Integration test: full flow from JSONL → session totals → UI display
- [ ] Manual test: verify cost accuracy against Anthropic pricing page

---

## Out of Scope

### Explicitly NOT Included in This Task

- **Historical Cost Tracking**: Long-term cost analytics, charts, or trends across sessions (future enhancement)
- **Budget Alerts**: Warnings when session/daily/monthly costs exceed thresholds (future enhancement)
- **Cost Optimization Suggestions**: AI-powered recommendations for reducing costs (future enhancement)
- **Multi-Model Pricing**: Support for different pricing models (GPT-4, etc.) - only Claude Sonnet 4.5 for now
- **Cache Optimization UI**: Visual indicators for cache efficiency or suggestions to improve cache usage (future enhancement)
- **Export with Costs**: Including cost data in session export (markdown/JSON) - could be added later if needed
- **Cost Filtering/Sorting**: Ability to filter or sort messages by cost - only display is in scope
- **User Preferences**: Settings to show/hide token/cost badges - always shown when data available
- **Currency Conversion**: Only USD supported (Claude CLI provides USD costs)

### Backward Compatibility Notes

- **Existing Sessions**: Sessions without token/cost data (created before this feature) will gracefully degrade (no badges displayed)
- **Schema Migration**: No migration needed - `tokens` and `cost` fields already defined as optional in `StrictChatMessage`
- **UI Layout**: Badge addition will not break existing message layout (DaisyUI badge components are inline-flex)

---

## Implementation Notes

### Recommended Implementation Order

1. **Backend First**: Extract usage from JSONL → populate `ExecutionNode.tokenUsage`
2. **Message Level**: Populate `StrictChatMessage.tokens` and `.cost` from `ExecutionNode`
3. **Session Level**: Calculate and populate `StrictChatSession` totals
4. **UI Integration**: Add badge components to `message-bubble.component.html`
5. **Session Summary**: Create and integrate `SessionCostSummaryComponent`
6. **Testing**: Unit tests for calculations, integration test for full flow

### Key Design Decisions

- **Pricing Constants Location**: Create `libs/shared/src/lib/constants/pricing.constants.ts` for centralized pricing
- **Session Summary Placement**: Defer exact UI placement to implementation phase (architect + frontend developer decision)
- **Tooltip Implementation**: Use DaisyUI tooltip directive for consistency with existing UI
- **Cache Token Display**: Show cache hits separately in tooltips, not in main badge (keep badges simple)

---

## Success Metrics

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

---

## Dependencies

### Internal Libraries

- `@ptah-extension/shared`: Type definitions (`StrictChatMessage`, `StrictChatSession`, `ExecutionNode`, `JSONLMessage`)
- `@ptah-extension/claude-domain`: `SessionManager` for session state management
- `@ptah-extension/chat`: UI components (`TokenBadgeComponent`, `DurationBadgeComponent`, message-bubble component)

### External Dependencies

- Angular signals (for reactive session summary updates)
- DaisyUI (for badge styling and tooltip components)
- ngx-markdown (existing, no new dependency)

---

## Risks and Mitigation

### Risk 1: Pricing Changes

- **Risk**: Claude pricing may change, requiring code updates
- **Probability**: Medium
- **Impact**: High (incorrect costs displayed)
- **Mitigation**: Centralize pricing constants in single file for easy updates
- **Contingency**: Add comments with pricing source URL and last-updated date

### Risk 2: JSONL Format Changes

- **Risk**: Claude CLI may change JSONL format or usage field structure
- **Probability**: Low
- **Impact**: High (no token data extracted)
- **Mitigation**: Add runtime validation (Zod schema) for usage field, log warnings on format mismatch
- **Contingency**: Graceful degradation already built-in (missing data = no badges)

### Risk 3: Performance Impact on Large Sessions

- **Risk**: Recalculating session totals on every message add may be slow for large sessions (100+ messages)
- **Probability**: Low
- **Impact**: Medium (UI lag when adding messages)
- **Mitigation**: Session total recalculation is O(n) but simple arithmetic (< 10ms for 100 messages)
- **Contingency**: If performance issues arise, memoize totals and update incrementally

### Risk 4: UI Layout Disruption

- **Risk**: Adding badges may break existing message layout or cause visual clutter
- **Probability**: Low
- **Impact**: Medium (poor UX)
- **Mitigation**: Use existing DaisyUI badge components (already tested), position badges in chat-footer area
- **Contingency**: A/B test badge placement, add user preference to hide badges if feedback negative

---

## Stakeholder Communication

### For Technical Team

This task wires together existing infrastructure to display token usage and cost data. The types, components, and data sources already exist - we need to extract usage from JSONL, populate the fields, and integrate the badge components into the message template. Implementation should be straightforward with minimal new code.

### For Product Team

Users will gain full visibility into Claude Code costs, enabling data-driven decisions about prompt efficiency and usage patterns. This addresses a critical gap in user awareness and aligns with our transparency goals. The UI changes are minimal (badges below messages) and non-intrusive.

### For Users

You will now see token counts, costs, and response times for every Claude response, plus a session-level summary of total usage. This helps you understand the cost of your AI interactions and optimize your prompts for efficiency. The display is automatic - no configuration needed.

---

## References

- **Anthropic Pricing**: https://www.anthropic.com/pricing (Claude Sonnet 4.5 pricing)
- **JSONL Message Format**: `libs/shared/src/lib/types/execution-node.types.ts` (JSONLMessage interface)
- **Existing Components**: `libs/frontend/chat/src/lib/components/atoms/token-badge.component.ts`, `duration-badge.component.ts`
- **Session Types**: `libs/shared/src/lib/types/message.types.ts` (StrictChatMessage, StrictChatSession)
