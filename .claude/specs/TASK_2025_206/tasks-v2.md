# Development Tasks - TASK_2025_206 v2: Dashboard Redesign with Per-Session Stats Cards

**Total Tasks**: 9 | **Batches**: 3 | **Status**: 0/3 complete

---

## Plan Validation Summary

**Validation Status**: PASSED

### Assumptions Verified

- `SessionHistoryReaderService.readSessionHistory(sessionId, workspacePath)` returns `{ events, stats }` where stats is `{ totalCost, tokens: { input, output, cacheRead, cacheCreation }, messageCount, model } | null` -- VERIFIED at `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\session-history-reader.service.ts:86-101`
- `SDK_TOKENS.SDK_SESSION_HISTORY_READER` is an injectable token for `SessionHistoryReaderService` -- VERIFIED at `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\di\tokens.ts`
- `RpcMethodRegistry` interface at line 1585 of `rpc.types.ts` follows `'method:name': { params: Type; result: Type }` pattern -- VERIFIED
- `RPC_METHOD_NAMES` array at line 2034 of `rpc.types.ts` lists all method names -- VERIFIED
- `session:cli-sessions` is the last session method in both `RpcMethodRegistry` (line 1607-1610) and `RPC_METHOD_NAMES` (line 2047) -- VERIFIED, new entry goes after these
- `SessionRpcHandlers.register()` method at line 47 calls all register methods -- VERIFIED
- `SessionRpcHandlers` constructor injects `TOKENS.LOGGER`, `TOKENS.RPC_HANDLER`, `SDK_TOKENS.SDK_SESSION_METADATA_STORE` -- VERIFIED at lines 38-42
- `chat-rpc.handlers.ts` shows the injection pattern for `SessionHistoryReaderService` via `@inject(SDK_TOKENS.SDK_SESSION_HISTORY_READER)` -- VERIFIED per implementation plan
- `formatModelDisplayName` is exported from `@ptah-extension/shared` via `pricing.utils.ts` (line 385) re-exported in `index.ts` (line 29) -- VERIFIED
- `ClaudeRpcService` is available from `@ptah-extension/core` -- VERIFIED in `libs/frontend/core/src/lib/services/claude-rpc.service.ts`
- `AppStateManager.workspaceInfo()` returns `WorkspaceInfo | null` where `WorkspaceInfo.path` is a `string` -- VERIFIED at `common.types.ts:16-20` and `app-state.service.ts:81`
- `formatCost()` and `formatTokenCount()` exist in `D:\projects\ptah-extension\libs\frontend\dashboard\src\lib\utils\format.utils.ts` -- VERIFIED
- `SessionHistoryTableComponent` only imported by `session-analytics-dashboard-view.component.ts` and `index.ts` -- VERIFIED (no app-level imports)
- `TokenUsageBreakdownComponent` only imported by `session-analytics-dashboard-view.component.ts` and `index.ts` -- VERIFIED (no app-level imports)

### Risks Identified

| Risk                                                                        | Severity | Mitigation                                                                                                                  |
| --------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------- |
| Reading 10+ JSONL files sequentially may be slow for large sessions         | LOW      | Plan uses sequential processing to avoid FS thrashing; individual failures return zero stats rather than breaking the batch |
| `readSessionHistory()` returns stats `null` for sessions with no usage data | LOW      | Handler maps null stats to zero-valued defaults -- handled in Task 1.2                                                      |

### Edge Cases to Handle

- [x] Session with no JSONL file (never saved to disk) -- returns zero stats (Task 1.2)
- [x] Session with no usage data in JSONL -- `stats` is null, mapped to zeros (Task 1.2)
- [x] Empty session list -- dashboard shows empty state (Task 3.3)
- [x] RPC call failure -- dashboard shows error state with retry (Task 3.3)
- [x] Zero tokens total -- aggregate shows zeros without division errors (Task 2.1)
- [x] `workspaceInfo` is null -- uses empty string fallback for workspacePath (Task 2.1)

---

## Batch 1: Backend -- RPC Types + Handler

**Developer**: backend-developer
**Tasks**: 2 | **Dependencies**: None
**Status**: IMPLEMENTED

### Task 1.1: Add RPC type definitions for session:stats-batch

**File**: `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc.types.ts` (MODIFY)
**Spec Reference**: implementation-plan-v2.md lines 126-183
**Pattern to Follow**: `SessionCliSessionsParams`/`SessionCliSessionsResult` at lines 287-296

**Quality Requirements**:

- All interface fields must use `readonly` modifier (matches existing pattern)
- Interfaces must be exported

**Implementation Details**:

1. **Add 3 new interfaces** before the `RpcMethodRegistry` interface (before line 1585). Place them near the other Session RPC types (after `SessionCliSessionsResult` around line 296):

   ```typescript
   /** Per-session stats returned from JSONL reading (TASK_2025_206 v2) */
   export interface SessionStatsEntry {
     readonly sessionId: string;
     readonly model: string | null;
     readonly totalCost: number;
     readonly tokens: {
       readonly input: number;
       readonly output: number;
       readonly cacheRead: number;
       readonly cacheCreation: number;
     };
     readonly messageCount: number;
   }

   /** Parameters for session:stats-batch RPC method */
   export interface SessionStatsBatchParams {
     readonly sessionIds: string[];
     readonly workspacePath: string;
   }

   /** Response from session:stats-batch RPC method */
   export interface SessionStatsBatchResult {
     readonly sessionStats: SessionStatsEntry[];
   }
   ```

2. **Add to `RpcMethodRegistry`** (after `session:cli-sessions` entry at line 1610):

   ```typescript
   'session:stats-batch': {
     params: SessionStatsBatchParams;
     result: SessionStatsBatchResult;
   };
   ```

3. **Add to `RPC_METHOD_NAMES`** array (after `'session:cli-sessions'` at line 2047):

   ```typescript
   'session:stats-batch',
   ```

**Acceptance Criteria**:

- `SessionStatsEntry`, `SessionStatsBatchParams`, `SessionStatsBatchResult` interfaces are exported
- `'session:stats-batch'` appears in `RpcMethodRegistry` under Session Methods section
- `'session:stats-batch'` appears in `RPC_METHOD_NAMES` array under Session Methods section
- `nx typecheck shared` passes

---

### Task 1.2: Add session:stats-batch RPC handler to SessionRpcHandlers

**File**: `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\session-rpc.handlers.ts` (MODIFY)
**Spec Reference**: implementation-plan-v2.md lines 186-293
**Pattern to Follow**: `registerSessionCliSessions()` method at lines 405-432; injection pattern from `chat-rpc.handlers.ts`
**Dependencies**: Task 1.1

**Quality Requirements**:

- Follow existing error handling pattern (try/catch with logger.error)
- Individual session failures must NOT break the batch -- return zero stats
- Sequential processing (not Promise.all) to avoid file system thrashing

**Implementation Details**:

1. **Add imports** at top of file (alongside existing imports):

   - `SessionHistoryReaderService` from `@ptah-extension/agent-sdk` (add to existing `SDK_TOKENS` import)
   - `SessionStatsBatchParams`, `SessionStatsBatchResult`, `SessionStatsEntry` from `@ptah-extension/shared`

2. **Add constructor parameter** (after `metadataStore` parameter at line 41):

   ```typescript
   @inject(SDK_TOKENS.SDK_SESSION_HISTORY_READER)
   private readonly historyReader: SessionHistoryReaderService
   ```

3. **Add to `register()` method** (after `this.registerSessionCliSessions()` at line 52):

   ```typescript
   this.registerSessionStatsBatch();
   ```

4. **Add `'session:stats-batch'` to the debug log array** at line 55-61

5. **Add new private method** `registerSessionStatsBatch()` after `registerSessionCliSessions()` (after line 432). This method:
   - Registers `'session:stats-batch'` handler with `rpcHandler.registerMethod<SessionStatsBatchParams, SessionStatsBatchResult>`
   - Iterates `sessionIds` sequentially calling `this.historyReader.readSessionHistory(sessionId, workspacePath)`
   - Maps stats to `SessionStatsEntry` (null stats become zero defaults)
   - Wraps individual session reads in try/catch (log warning, push zero stats)
   - Returns `{ sessionStats }`

**Acceptance Criteria**:

- `SessionHistoryReaderService` injected via `SDK_TOKENS.SDK_SESSION_HISTORY_READER`
- `registerSessionStatsBatch()` registered in `register()` method
- Individual session failures return zero stats (not throw)
- `nx typecheck rpc-handlers` passes

---

**Batch 1 Verification**:

- `nx typecheck shared` passes
- `nx typecheck rpc-handlers` passes
- All 3 new interfaces exported from shared
- Handler method registered in `register()`

---

## Batch 2: Frontend State Service Rewrite

**Developer**: frontend-developer
**Tasks**: 1 | **Dependencies**: Batch 1
**Status**: IMPLEMENTED

### Task 2.1: Rewrite SessionAnalyticsStateService for direct RPC calls

**File**: `D:\projects\ptah-extension\libs\frontend\dashboard\src\lib\services\session-analytics-state.service.ts` (REWRITE)
**Spec Reference**: implementation-plan-v2.md lines 295-487
**Pattern to Follow**: The existing v1 service structure at same file; `ClaudeRpcService.call()` pattern from `@ptah-extension/core`

**Quality Requirements**:

- Signal-based reactivity (Angular signals, not RxJS)
- No dependency on `ISessionDataProvider` or `SESSION_DATA_PROVIDER` (v1 legacy)
- Direct RPC calls via `ClaudeRpcService`
- All interfaces exported for use in components and index.ts

**Implementation Details**:

Complete rewrite. Remove ALL v1 content and replace with:

1. **New imports**:

   ```typescript
   import { Injectable, signal, computed, inject } from '@angular/core';
   import { ClaudeRpcService, AppStateManager } from '@ptah-extension/core';
   import { SessionStatsEntry, formatModelDisplayName } from '@ptah-extension/shared';
   import { formatCost, formatTokenCount } from '../utils/format.utils';
   ```

2. **New exported interfaces**:

   - `DashboardSessionEntry` -- merged session data (sessionId, name, createdAt, lastActivityAt, model, modelDisplayName, totalCost, tokens, messageCount)
   - `AggregateTotals` -- computed aggregates (totalCost, totalTokens, totalInput, totalOutput, totalCacheRead, totalCacheCreation, totalMessages, sessionCount)

3. **New service body** (`@Injectable({ providedIn: 'root' })`):

   - Injects `ClaudeRpcService` and `AppStateManager` (via `inject()`)
   - Private signals: `_allSessions`, `_displayCount` (default 5), `_isLoading`, `_loadError`
   - Public readonly signals: `isLoading`, `loadError`, `displayCount`, `allSessions`
   - Computed: `displayedSessions` (sliced by displayCount), `hasMoreToShow`, `aggregates` (single-pass loop)
   - Methods: `setDisplayCount(count: 5 | 10)`, `loadDashboardData()` (async)

4. **`loadDashboardData()` flow**:

   - Get `workspacePath` from `appState.workspaceInfo()?.path || ''`
   - Call `this.rpc.call('session:list', { workspacePath, limit: 30, offset: 0 })`
   - Extract session IDs, call `this.rpc.call('session:stats-batch', { sessionIds, workspacePath })`
   - Merge metadata + stats into `DashboardSessionEntry[]` using `Map` lookup
   - Use `formatModelDisplayName()` for model display names
   - Set `_allSessions` signal

5. **Remove completely**: `SortField` type, `SessionWithCost` interface, `TokenBreakdownData` interface, all sort-related code, `ISessionDataProvider` injection, `SESSION_DATA_PROVIDER` injection

**Acceptance Criteria**:

- No import of `SESSION_DATA_PROVIDER` or `ISessionDataProvider`
- `DashboardSessionEntry` and `AggregateTotals` are exported
- `loadDashboardData()` calls both `session:list` and `session:stats-batch`
- `displayedSessions` computed signal slices by `_displayCount`
- `aggregates` computed signal aggregates totals from displayed sessions
- `nx typecheck dashboard` passes (may show errors for components not yet updated -- that is expected)

---

**Batch 2 Verification**:

- Service file compiles without errors for its own types
- All exported interfaces available for Batch 3 components

---

## Batch 3: Frontend Component Rewrite + Cleanup

**Developer**: frontend-developer
**Tasks**: 6 | **Dependencies**: Batch 2
**Status**: PENDING

### Task 3.1: Create SessionStatsCardComponent

**File**: `D:\projects\ptah-extension\libs\frontend\dashboard\src\lib\components\session-analytics\session-stats-card.component.ts` (CREATE)
**Spec Reference**: implementation-plan-v2.md lines 492-592
**Pattern to Follow**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\session\session-stats-summary.component.ts` for design system

**Quality Requirements**:

- Standalone component with `ChangeDetectionStrategy.OnPush`
- Uses `input.required<DashboardSessionEntry>()`
- Matches Ptah design system: `bg-base-200/50`, `border-{color}/20`, `text-[10px] uppercase tracking-wider`, `tabular-nums`
- Uses `formatCost()` and `formatTokenCount()` from `../../utils/format.utils`

**Implementation Details**:

1. **Selector**: `ptah-session-stats-card`
2. **Input**: `session = input.required<DashboardSessionEntry>()`
3. **Template structure**:
   - Header row: session name (truncated), date, model badge (purple, conditional)
   - 2x2 stats grid: Cost (success/green), Messages (info/blue), Input tokens (cyan), Output tokens (purple)
   - Conditional cache stats row (only when cacheRead or cacheCreation > 0)
4. **Methods**:
   - `formatDate(timestamp: number): string` -- uses `toLocaleDateString` with month/day/year/hour/minute
   - `formatCost = formatCost` (delegate)
   - `formatTokenCount = formatTokenCount` (delegate)

**Acceptance Criteria**:

- Component file created at specified path
- Standalone, OnPush, no external dependencies beyond Angular core
- Uses `DashboardSessionEntry` from state service
- `formatCost` and `formatTokenCount` imported from `../../utils/format.utils`
- Model badge conditionally shown with `@if (session().model)`
- Cache stats row conditionally shown

---

### Task 3.2: Rewrite MetricsCardsComponent for aggregate totals

**File**: `D:\projects\ptah-extension\libs\frontend\dashboard\src\lib\components\session-analytics\metrics-cards.component.ts` (REWRITE)
**Spec Reference**: implementation-plan-v2.md lines 594-647
**Pattern to Follow**: Existing file at same path (v1 version)

**Quality Requirements**:

- Accept single `AggregateTotals` input instead of 5 individual inputs
- Simplify to 4 cards: Total Cost, Total Tokens, Messages, Sessions

**Implementation Details**:

Complete rewrite of the component:

1. **Input change**: Replace 5 `input.required<number>()` with single `aggregates = input.required<AggregateTotals>()`
2. **Template**: 4 cards in `grid-cols-2 sm:grid-cols-4` (was `grid-cols-2 sm:grid-cols-3 lg:grid-cols-5`):
   - Total Cost (`border-success/20`, `text-success`)
   - Total Tokens (`border-cyan-600/20`, `text-cyan-400`)
   - Messages (`border-info/20`, `text-info`)
   - Sessions (`border-purple-600/20`, `text-purple-400`)
3. **Bindings**: `aggregates().totalCost`, `aggregates().totalTokens`, `aggregates().totalMessages`, `aggregates().sessionCount`
4. **Keep**: `formatCost` and `formatTokenCount` references

**Acceptance Criteria**:

- Single `aggregates` input of type `AggregateTotals`
- 4 metric cards (removed Avg Cost/Session card)
- Grid is `grid-cols-2 sm:grid-cols-4`
- Imports `AggregateTotals` from `../../services/session-analytics-state.service`

---

### Task 3.3: Rewrite SessionAnalyticsDashboardViewComponent

**File**: `D:\projects\ptah-extension\libs\frontend\dashboard\src\lib\components\session-analytics\session-analytics-dashboard-view.component.ts` (REWRITE)
**Spec Reference**: implementation-plan-v2.md lines 649-747
**Pattern to Follow**: Existing file at same path (v1 version)

**Quality Requirements**:

- Remove `SessionHistoryTableComponent` and `TokenUsageBreakdownComponent` imports
- Add `SessionStatsCardComponent` import
- Wire new signals from v2 state service
- Include 5/10 display toggle with DaisyUI `join` pattern

**Implementation Details**:

Complete rewrite of the component:

1. **Imports array change**:

   - REMOVE: `SessionHistoryTableComponent`, `TokenUsageBreakdownComponent`
   - ADD: `SessionStatsCardComponent`
   - KEEP: `MetricsCardsComponent`, `LucideAngularModule`

2. **Signal delegates from state service**:

   - `isLoading`, `loadError` (same as v1)
   - `displayedSessions` (NEW -- replaces `sessions`)
   - `aggregates` (NEW -- replaces individual metric signals)
   - `displayCount` (NEW)
   - `allSessionCount = computed(() => this.analyticsState.allSessions().length)` (NEW)
   - REMOVE: `totalEstimatedCost`, `totalInputTokens`, `totalOutputTokens`, `totalSessions`, `avgCostPerSession`, `tokenBreakdown`, `sortedSessions`, `sortField`, `sortDirection`, `hasMoreSessions`, `isLoadingMore`

3. **Template changes**:

   - Header badge text: "Real costs from JSONL" (was "Estimated costs (default pricing)")
   - Loading text: "Reading session history..." (was "Loading session data...")
   - Empty state: check `displayedSessions().length === 0`
   - Aggregate cards: `<ptah-session-metrics-cards [aggregates]="aggregates()" />`
   - Display toggle: DaisyUI `join` with buttons for 5/10, showing "of X sessions"
   - Card grid: `grid grid-cols-1 sm:grid-cols-2 gap-3` with `@for` over `displayedSessions()`, tracked by `session.sessionId`
   - REMOVE: `<ptah-token-usage-breakdown>`, `<ptah-session-history-table>`

4. **Method changes**:
   - `ngOnInit()` calls `this.analyticsState.loadDashboardData()` (was `ensureSessionsLoaded`)
   - `retry()` calls `this.analyticsState.loadDashboardData()` (was `ensureSessionsLoaded`)
   - ADD: `setDisplayCount(count: 5 | 10)` delegating to state service
   - REMOVE: `onSortChanged()`, `onLoadMore()`

**Acceptance Criteria**:

- No import of `SessionHistoryTableComponent` or `TokenUsageBreakdownComponent`
- `SessionStatsCardComponent` in imports array
- `@for` loop renders `ptah-session-stats-card` for each displayed session
- 5/10 toggle with DaisyUI `join` pattern
- `ngOnInit` calls `loadDashboardData()`

---

### Task 3.4: Delete SessionHistoryTableComponent

**File**: `D:\projects\ptah-extension\libs\frontend\dashboard\src\lib\components\session-analytics\session-history-table.component.ts` (DELETE)
**Spec Reference**: implementation-plan-v2.md line 774
**Dependencies**: Task 3.3 (must remove import first)

**Quality Requirements**:

- Verify no external consumers outside dashboard library before deleting

**Verification**: Only imported by:

1. `session-analytics-dashboard-view.component.ts` (removed in Task 3.3)
2. `index.ts` (updated in Task 3.6)

**Acceptance Criteria**:

- File deleted from disk
- No remaining references in codebase

---

### Task 3.5: Delete TokenUsageBreakdownComponent

**File**: `D:\projects\ptah-extension\libs\frontend\dashboard\src\lib\components\session-analytics\token-usage-breakdown.component.ts` (DELETE)
**Spec Reference**: implementation-plan-v2.md line 775
**Dependencies**: Task 3.3 (must remove import first)

**Quality Requirements**:

- Verify no external consumers outside dashboard library before deleting

**Verification**: Only imported by:

1. `session-analytics-dashboard-view.component.ts` (removed in Task 3.3)
2. `index.ts` (updated in Task 3.6)

**Acceptance Criteria**:

- File deleted from disk
- No remaining references in codebase

---

### Task 3.6: Update dashboard index.ts exports

**File**: `D:\projects\ptah-extension\libs\frontend\dashboard\src\index.ts` (MODIFY)
**Spec Reference**: implementation-plan-v2.md lines 843-846
**Dependencies**: Tasks 3.1, 3.2, 3.3, 3.4, 3.5

**Quality Requirements**:

- All new components and types exported
- All deleted components and types removed

**Implementation Details**:

Update the Session Analytics section (lines 13-25):

1. **ADD export**:

   ```typescript
   export { SessionStatsCardComponent } from './lib/components/session-analytics/session-stats-card.component';
   ```

2. **REMOVE exports**:

   ```typescript
   // DELETE these lines:
   export { SessionHistoryTableComponent } from './lib/components/session-analytics/session-history-table.component';
   export { TokenUsageBreakdownComponent } from './lib/components/session-analytics/token-usage-breakdown.component';
   ```

3. **UPDATE type exports** (replace old types with new):
   ```typescript
   // REPLACE:
   //   type SortField, type SessionWithCost, type TokenBreakdownData
   // WITH:
   //   type DashboardSessionEntry, type AggregateTotals
   export { SessionAnalyticsStateService, type DashboardSessionEntry, type AggregateTotals } from './lib/services/session-analytics-state.service';
   ```

**Acceptance Criteria**:

- `SessionStatsCardComponent` exported
- `SessionHistoryTableComponent` export removed
- `TokenUsageBreakdownComponent` export removed
- `SortField`, `SessionWithCost`, `TokenBreakdownData` type exports removed
- `DashboardSessionEntry`, `AggregateTotals` type exports added
- `nx typecheck dashboard` passes
- `nx build ptah-extension-webview` passes (or at minimum no dashboard-related errors)

---

**Batch 3 Verification**:

- All files exist at specified paths (new and modified)
- Deleted files no longer exist
- `nx typecheck dashboard` passes
- No references to deleted components remain in codebase
- code-logic-reviewer approved
