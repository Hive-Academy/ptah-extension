# Requirements Document - TASK_2025_206: Session-Based Dashboard with Pricing Analytics

## Introduction

The Ptah Extension has a `libs/frontend/dashboard` library that currently contains only code quality dashboard components (TASK_2025_144). There is no session analytics dashboard -- users cannot see their AI usage costs, token consumption, session history, or model comparison data in any centralized view. All the raw data and utility infrastructure exists (pricing utils, session totals, subagent cost breakdown, session loading with pagination, per-model usage lists), but there is no frontend visualization layer built on top of it.

This task builds the session analytics dashboard: a new set of components within the existing dashboard library that load real session data, calculate per-model/per-provider pricing, and display actionable analytics (cost breakdown, token usage, session history, model comparison).

## Problem Statement

Users of the Ptah Extension interact with multiple AI models (Claude Opus/Sonnet/Haiku, GPT-4o, Gemini, etc.) across many sessions. There is currently no way to:

1. See aggregate spending across all sessions
2. Compare cost efficiency between models
3. Track token consumption trends over time
4. Understand per-session and per-agent cost breakdown
5. View session history with cost/token metadata at a glance

The data to answer all these questions already exists in the session list (`ChatSessionSummary.tokenUsage`), the session resume response (`ChatResumeResult.stats`, `modelUsageList`), and the shared utility layer (`pricing.utils.ts`, `session-totals.utils.ts`, `subagent-cost.utils.ts`). What is missing is the frontend analytics layer.

## Scope

### In Scope

- New session analytics components within `libs/frontend/dashboard/`
- A state service that consumes `ChatStore.sessions` signal (session list with token usage)
- Aggregate cost calculation using `pricing.utils.ts` (`findModelPricing`, `calculateMessageCost`, `formatModelDisplayName`)
- Session history table/list with cost, tokens, model, and date
- Per-model cost comparison view
- Summary metric cards (total cost, total tokens, session count, avg cost per session)
- Integration with the existing webview navigation system (the `analytics` ViewType already exists)
- Token usage breakdown (input vs output vs cache read vs cache creation)
- **VS Code: Full web panel** — Dashboard opens as a dedicated webview panel (like setup wizard), using `createWizardPanel()` pattern with `initialView: 'analytics'`
- **Electron: Center panel view** — Dashboard renders via existing `AppShellComponent` `@switch(currentView())` in the Electron shell's center panel

### Explicitly Out of Scope

- Chart.js integration or time-series trend charts (can be added in a follow-up; focus on tabular/card data first)
- New RPC endpoints -- the dashboard must work with data already available from `session:list` and `chat:resume`
- Backend changes of any kind (except minor additions to support panel creation)
- Real-time streaming cost tracking (already handled by `SessionStatsSummaryComponent` in the chat lib)
- Export functionality (follow-up task)
- Activity feed (follow-up task)
- Modifications to the quality dashboard components

## Requirements

### FR-1: Session Analytics State Service

**User Story:** As a developer using Ptah, I want the dashboard to load and aggregate data from my session history, so that I can see my AI usage analytics without manual calculation.

#### Acceptance Criteria

1. WHEN the session analytics view is initialized THEN the service SHALL consume the `ChatStore.sessions` signal (which returns `readonly ChatSessionSummary[]`)
2. WHEN sessions are loaded THEN the service SHALL calculate aggregate metrics: total cost (via `findModelPricing` + `calculateMessageCost` applied to each session's `tokenUsage`), total input tokens, total output tokens, total sessions count, average cost per session
3. WHEN the sessions signal updates (new sessions loaded, pagination) THEN all computed metrics SHALL reactively update via Angular computed signals
4. WHEN sessions have no `tokenUsage` data THEN those sessions SHALL be gracefully excluded from cost calculations but still counted in session totals

### FR-2: Summary Metrics Cards

**User Story:** As a developer, I want to see key usage metrics at a glance, so that I can quickly understand my AI spending and usage patterns.

#### Acceptance Criteria

1. WHEN the analytics view loads THEN it SHALL display metric cards showing: Total Estimated Cost (USD), Total Input Tokens, Total Output Tokens, Session Count, and Average Cost Per Session
2. WHEN displaying costs THEN values SHALL be formatted as USD with 2-4 decimal places (e.g., "$0.42" or "$12.3456" for sub-cent amounts)
3. WHEN displaying token counts THEN large numbers SHALL use compact formatting (e.g., "1.2M" for 1,200,000 tokens)
4. WHEN no sessions exist THEN cards SHALL display zero values with a helpful empty state message

### FR-3: Session History Table

**User Story:** As a developer, I want to browse my past AI sessions with their cost and token data, so that I can identify expensive sessions and understand my usage patterns.

#### Acceptance Criteria

1. WHEN the analytics view loads THEN it SHALL display a sortable table of sessions with columns: Name, Model (display name via `formatModelDisplayName`), Created Date, Input Tokens, Output Tokens, Estimated Cost, Message Count
2. WHEN a session has `tokenUsage` data THEN the cost SHALL be calculated using `findModelPricing` with the session's model and `calculateMessageCost` with the token breakdown
3. WHEN a session lacks `tokenUsage` data THEN cost SHALL display as "--" or "N/A"
4. WHEN the user clicks a column header THEN the table SHALL sort by that column (ascending/descending toggle)
5. WHEN more sessions are available (pagination) THEN a "Load More" button SHALL trigger `ChatStore.loadMoreSessions()`

### FR-4: Per-Model Cost Comparison

**User Story:** As a developer, I want to compare costs across different AI models I've used, so that I can make informed decisions about which models to use for different tasks.

#### Acceptance Criteria

1. WHEN sessions are loaded THEN the service SHALL group sessions by model (using the model identifier from session metadata or defaulting to 'unknown')
2. WHEN displaying model comparison THEN it SHALL show for each model: model display name (via `formatModelDisplayName`), session count, total input/output tokens, total estimated cost, average cost per session, pricing rate (via `getModelPricingDescription`)
3. WHEN a model is not found in the pricing map THEN default pricing SHALL be used (the `findModelPricing` fallback behavior)
4. WHEN multiple providers are represented THEN the comparison SHALL include a provider column (Anthropic, OpenAI, etc. from `ModelPricing.provider`)

### FR-5: Token Usage Breakdown

**User Story:** As a developer, I want to understand how my tokens are distributed across input, output, and cache operations, so that I can optimize my usage.

#### Acceptance Criteria

1. WHEN sessions with `tokenUsage` data are loaded THEN the dashboard SHALL display aggregate token breakdown: input tokens, output tokens, cache read tokens, cache creation tokens
2. WHEN displaying the breakdown THEN it SHALL show both absolute numbers and percentages of total
3. WHEN cache tokens are zero across all sessions THEN the cache section SHALL be hidden or collapsed

### FR-6: Navigation Integration

**User Story:** As a developer, I want to access the analytics dashboard from the webview navigation, so that I can switch between chat and analytics views seamlessly.

#### Acceptance Criteria

1. WHEN the user navigates to the `analytics` ViewType THEN the analytics dashboard view component SHALL be rendered
2. WHEN the analytics view is rendered THEN session data loading SHALL be triggered if sessions are not already loaded
3. WHEN the user navigates away from analytics THEN the computed state SHALL remain cached (no reload required on return)

## Data Sources (Existing Infrastructure to Leverage)

### Session List Data

- **Source**: `ChatStore.sessions` signal (from `SessionLoaderService`)
- **Type**: `readonly ChatSessionSummary[]`
- **Fields**: `id`, `name`, `messageCount`, `createdAt`, `lastActivityAt`, `tokenUsage?: MessageTokenUsage`, `isActive`
- **File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat-store\session-loader.service.ts`
- **Pagination**: `ChatStore.hasMoreSessions`, `ChatStore.loadMoreSessions()`

### Token Usage Type

- **Type**: `MessageTokenUsage` with fields: `input`, `output`, `cacheRead?`, `cacheCreation?`
- **File**: `D:\projects\ptah-extension\libs\shared\src\lib\types\execution-node.types.ts`

### Pricing Utilities

- **`findModelPricing(modelId)`**: Returns `ModelPricing` for any model (with partial match + fallback)
- **`calculateMessageCost(modelId, tokens)`**: Returns USD cost for a token breakdown
- **`formatModelDisplayName(modelId)`**: Returns human-readable model name
- **`getModelPricingDescription(modelId)`**: Returns pricing rate string
- **`DEFAULT_MODEL_PRICING`**: Bundled pricing for Claude, GPT, and OpenRouter models
- **File**: `D:\projects\ptah-extension\libs\shared\src\lib\utils\pricing.utils.ts`

### Session Totals Utility

- **`calculateSessionTotals(messages)`**: Aggregates tokens and cost from `ExecutionChatMessage[]`
- **File**: `D:\projects\ptah-extension\libs\shared\src\lib\utils\session-totals.utils.ts`
- **Note**: This operates on loaded messages. For the dashboard overview, use `ChatSessionSummary.tokenUsage` directly (no need to load full messages).

### Subagent Cost Utility

- **`calculateSessionCostSummary(messages)`**: Returns `SessionCostSummary` with per-agent breakdown
- **`getAgentCostBreakdown(node)`**: Returns `AgentCostBreakdown[]` from execution tree
- **File**: `D:\projects\ptah-extension\libs\shared\src\lib\utils\subagent-cost.utils.ts`
- **Note**: Requires loaded session messages (ExecutionChatMessage[]). Useful for drill-down into a single session, not for the overview.

### Resume Stats (Detail View)

- **Type**: `ChatResumeResult.stats` with `totalCost`, `tokens`, `messageCount`, `model`
- **Type**: `TabState.modelUsageList` with per-model breakdown
- **File**: `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc.types.ts`
- **Note**: Available only after `chat:resume` is called for a specific session. Not available in the list view.

### CLI Session References

- **Type**: `CliSessionReference` with `cli`, `agentId`, `task`, `status`
- **File**: `D:\projects\ptah-extension\libs\shared\src\lib\types\agent-process.types.ts`
- **Note**: Available after session resume. Useful for showing multi-provider agent activity.

## Key Technical Decisions for Architect

1. **Data source for overview vs detail**: The session list (`session:list` RPC) returns `ChatSessionSummary` with `tokenUsage` but NO `model` field. The model is only available after `chat:resume`. The architect must decide: (a) add `model` to `ChatSessionSummary` on the backend (scope creep), (b) show model as "Unknown" in the overview and only display it after drill-down, or (c) extract model from session name heuristics. Recommendation: option (b) for now, flag as enhancement.

2. **Cost estimation accuracy**: `ChatSessionSummary.tokenUsage` provides aggregate tokens but no model. Without knowing which model produced those tokens, cost can only be estimated using default pricing. For accurate per-model cost, the session needs to be resumed to get `stats.model` or `modelUsageList`. The architect should decide whether the overview should show "estimated cost" (using default pricing) or defer cost display until model is known.

3. **No new RPC endpoints**: The requirement is to work with existing data. If the architect determines that adding `model` to `ChatSessionSummary` is critical, that would be a small backend addition to flag.

4. **Component placement**: New components go in `libs/frontend/dashboard/src/lib/components/session-analytics/` alongside the existing `quality/` folder. New state service in `libs/frontend/dashboard/src/lib/services/`.

5. **No Chart.js in first iteration**: Focus on DaisyUI stat cards, tables, and progress bars. This keeps the implementation simpler and avoids Chart.js complexity. Charts can be added in a follow-up.

6. **ViewType `analytics` already exists**: The `AppStateManager` already supports `'analytics'` as a `ViewType`. The app shell just needs to render the dashboard component when this view is active.

## Non-Functional Requirements

### Performance

- Computed signals must not recalculate on every render; use Angular `computed()` with signal dependencies
- Session list aggregation (up to hundreds of sessions) should complete in under 50ms
- No additional RPC calls beyond what `ChatStore` already makes for session loading

### Accessibility

- All metric cards must have ARIA labels
- Table must be keyboard-navigable with proper `role` attributes
- Color should not be the sole indicator of any information

### Responsiveness

- Dashboard must work within the VS Code webview panel width (variable, typically 300-800px)
- Use DaisyUI responsive grid classes

### Code Quality

- All components must use `ChangeDetectionStrategy.OnPush`
- All state must use Angular signals (no RxJS BehaviorSubject)
- All components must be standalone
- Follow existing patterns from `quality-dashboard-view.component.ts`

## Success Criteria

1. A user can navigate to the analytics view and see aggregate cost/token metrics across all their sessions
2. The session history table displays all loaded sessions with sortable columns
3. Per-model comparison shows cost and token breakdown grouped by AI model
4. Token usage breakdown shows input/output/cache distribution
5. All data is derived from existing `ChatStore.sessions` signal without new backend RPC calls
6. Components follow the same patterns as the existing quality dashboard (standalone, OnPush, signal-based, DaisyUI styling)
7. Dashboard exports are added to `libs/frontend/dashboard/src/index.ts`

## Risks

| Risk                                                                                                                             | Probability | Impact | Mitigation                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ChatSessionSummary` lacks `model` field, so per-model grouping in overview is not possible without backend change               | High        | Medium | Show "estimated" costs using default pricing in overview; accurate per-model data available on session drill-down. Flag `model` field addition as a fast-follow enhancement. |
| `tokenUsage` field on `ChatSessionSummary` may be null for older sessions                                                        | Medium      | Low    | Gracefully skip sessions without token data; show "N/A" for cost. Count them in session total but not in cost aggregation.                                                   |
| Large session lists (500+) could slow down aggregate computation                                                                 | Low         | Low    | Angular `computed()` memoizes results; aggregation is O(n) linear scan. Profile if needed.                                                                                   |
| Dashboard library currently only exports quality components; wiring analytics into the app shell may require webview app changes | Medium      | Low    | The `analytics` ViewType already exists in `AppStateManager`. The app shell just needs a conditional render for the new component.                                           |
