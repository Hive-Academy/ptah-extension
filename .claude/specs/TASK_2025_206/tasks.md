# Tasks - TASK_2025_206: Session-Based Dashboard with Pricing Analytics

**Total Tasks**: 10 | **Batches**: 5 | **Status**: 5/5 complete (ALL IMPLEMENTED)

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS

### Assumptions Verified

- `ChatStore.sessions` signal exists and returns `readonly ChatSessionSummary[]`: VERIFIED at `chat.store.ts:148`
- `ChatStore.hasMoreSessions` signal exists: VERIFIED at `chat.store.ts:149`
- `ChatStore.loadMoreSessions()` method exists: VERIFIED at `chat.store.ts:352`
- `ChatStore.isLoadingMoreSessions` signal exists: VERIFIED at `chat.store.ts:151`
- `ChatStore.loadSessions()` method exists: VERIFIED at `chat.store.ts:344`
- `calculateMessageCost(modelId, tokens)` signature correct: VERIFIED at `pricing.utils.ts:305-308`
- `findModelPricing('')` returns default Sonnet 4.5 pricing: VERIFIED at `pricing.utils.ts:244-246`
- `ChatSessionSummary` has `tokenUsage?: MessageTokenUsage`: VERIFIED at `execution-node.types.ts:380`
- `MessageTokenUsage` has `input`, `output`, `cacheRead?`, `cacheCreation?`: VERIFIED at `execution-node.types.ts:79-88`
- `AppStateManager.setCurrentView('analytics')` works: VERIFIED (VALID_VIEWS includes 'analytics')
- `WebviewHtmlGenerator` supports `initialView` option: VERIFIED at `webview-html-generator.ts:13,41`
- `VALID_VIEWS` includes `'analytics'`: VERIFIED at `webview-html-generator.ts:120`
- `AppShellComponent` uses `@switch (currentView())`: VERIFIED at `app-shell.component.html:17`

### Risks Identified

| Risk                                                                                                           | Severity | Mitigation                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Circular dependency: `dashboard -> chat` (ChatStore) AND `chat -> dashboard` (AppShell imports dashboard view) | MEDIUM   | Pragmatic approach: both are independently-built Nx libraries. If Nx reports cycle, fallback to injection token in `@ptah-extension/core`. Developer should run `nx typecheck chat` and `nx typecheck dashboard` after Batch 4 to verify. |
| `ChatSessionSummary` lacks `model` field - costs are estimated using default (Sonnet 4.5) pricing              | LOW      | Label all costs as "Estimated" in UI. Model comparison table deferred from v1.                                                                                                                                                            |
| `tokenUsage` may be null for older sessions                                                                    | LOW      | Gracefully skip sessions without tokenUsage in cost calculations. Display "--" for missing data.                                                                                                                                          |
| `createPanel()` does not currently accept `initialView` parameter                                              | LOW      | Batch 5 Task 5.1 adds `initialView` to the options type. Already verified that downstream `WebviewHtmlGenerator` supports it.                                                                                                             |

### Edge Cases to Handle

- [ ] Empty sessions list (zero sessions loaded) -> Show empty state message
- [ ] All sessions have null tokenUsage -> Show zero values, hide cache bars
- [ ] tokenUsage with zero cache tokens -> Hide cache read/creation progress bars
- [ ] Very small costs (sub-cent) -> Format with 4 decimal places
- [ ] Very large token counts (millions) -> Format as "1.2M"
- [ ] Session name is UUID -> Already handled by AppShellComponent pattern

---

## Batch 1: State Service (Foundation) -- IMPLEMENTED

**Developer**: frontend-developer
**Tasks**: 1 | **Dependencies**: None
**Verification**: `npx nx typecheck dashboard`

### Task 1.1: Create SessionAnalyticsStateService -- IMPLEMENTED

- **Status**: IMPLEMENTED
- **File(s)**: `D:\projects\ptah-extension\libs\frontend\dashboard\src\lib\services\session-analytics-state.service.ts`
- **Action**: CREATE
- **Pattern to Follow**: `D:\projects\ptah-extension\libs\frontend\dashboard\src\lib\services\quality-dashboard-state.service.ts`
- **Description**: Create a signal-based state service that consumes `ChatStore.sessions` and computes all analytics metrics reactively. The service must be `@Injectable({ providedIn: 'root' })` with private writable signals for sort state and public computed signals for all derived metrics.

  **Imports**:

  - `Injectable, signal, computed, inject` from `@angular/core`
  - `ChatStore` from `@ptah-extension/chat`
  - `calculateMessageCost` from `@ptah-extension/shared`
  - `ChatSessionSummary, MessageTokenUsage` from `@ptah-extension/shared`

  **Exported type**: `SortField = 'name' | 'createdAt' | 'lastActivityAt' | 'inputTokens' | 'outputTokens' | 'estimatedCost' | 'messageCount'`

  **Exported interface**: `SessionWithCost` extending `ChatSessionSummary` with `estimatedCost: number | null`

  **Exported interface**: `TokenBreakdownData` with fields: `input`, `output`, `cacheRead`, `cacheCreation`, `total`, `inputPercent`, `outputPercent`, `cacheReadPercent`, `cacheCreationPercent` (all numbers)

  **Private writable signals**:

  - `_sortField = signal<SortField>('lastActivityAt')`
  - `_sortDirection = signal<'asc' | 'desc'>('desc')`

  **Public readonly signals** (delegated from ChatStore):

  - `sessions = this.chatStore.sessions`
  - `hasMoreSessions = this.chatStore.hasMoreSessions`
  - `isLoadingMore = this.chatStore.isLoadingMoreSessions`
  - `sortField = this._sortField.asReadonly()`
  - `sortDirection = this._sortDirection.asReadonly()`

  **Computed signals**:

  - `sessionsWithCost`: Maps each session, computing cost via `calculateMessageCost('', { input, output, cacheHit: cacheRead, cacheCreation })` when `tokenUsage` exists, else `null`. Note: `calculateMessageCost` uses `cacheHit` param name (not `cacheRead`) -- see `pricing.utils.ts:39`.
  - `totalSessions`: `sessions().length`
  - `totalEstimatedCost`: Sum of all `estimatedCost` values from `sessionsWithCost()`
  - `totalInputTokens`: Sum of `tokenUsage?.input ?? 0` across sessions
  - `totalOutputTokens`: Sum of `tokenUsage?.output ?? 0` across sessions
  - `totalCacheReadTokens`: Sum of `tokenUsage?.cacheRead ?? 0` across sessions
  - `totalCacheCreationTokens`: Sum of `tokenUsage?.cacheCreation ?? 0` across sessions
  - `sessionsWithTokenData`: Count of sessions where `tokenUsage` is truthy
  - `avgCostPerSession`: `totalEstimatedCost / sessionsWithTokenData` (or 0 if none)
  - `tokenBreakdown`: Returns `TokenBreakdownData` with absolute counts and percentages
  - `sortedSessions`: Copies `sessionsWithCost()`, sorts by `_sortField` and `_sortDirection`. Sorting logic per field as specified in the implementation plan (lines 218-258).

  **Methods**:

  - `setSortField(field: SortField)`: If same field, toggle direction; if new field, set field and reset to `'asc'`
  - `loadMoreSessions()`: Delegates to `this.chatStore.loadMoreSessions()`
  - `ensureSessionsLoaded()`: If `sessions().length === 0`, calls `this.chatStore.loadSessions()`

- **Acceptance Criteria**:
  - [ ] File exists at the specified path
  - [ ] Service is `@Injectable({ providedIn: 'root' })`
  - [ ] Service injects `ChatStore` from `@ptah-extension/chat`
  - [ ] All computed signals are defined using Angular `computed()` function
  - [ ] `SortField` type and `SessionWithCost` interface are exported
  - [ ] `TokenBreakdownData` interface is exported
  - [ ] Cost calculation uses `calculateMessageCost('', { input, output, cacheHit: tokenUsage.cacheRead, cacheCreation: tokenUsage.cacheCreation })` -- note `cacheHit` not `cacheRead`
  - [ ] Sessions with null `tokenUsage` get `estimatedCost: null`
  - [ ] `avgCostPerSession` divides by sessions WITH token data, not total sessions
  - [ ] `tokenBreakdown` handles zero total (returns 0 percentages)
  - [ ] Sort toggle logic: same field toggles direction, new field resets to `'asc'`
  - [ ] `npx nx typecheck dashboard` passes

---

## Batch 2: Presentational Child Components -- PENDING

**Developer**: frontend-developer
**Tasks**: 3 | **Dependencies**: Batch 1 (uses `SortField`, `SessionWithCost`, `TokenBreakdownData` types)
**Verification**: `npx nx typecheck dashboard`

### Task 2.1: Create MetricsCardsComponent -- PENDING

- **Status**: PENDING
- **File(s)**: `D:\projects\ptah-extension\libs\frontend\dashboard\src\lib\components\session-analytics\metrics-cards.component.ts`
- **Action**: CREATE
- **Pattern to Follow**: `D:\projects\ptah-extension\libs\frontend\dashboard\src\lib\components\quality\quality-score-card.component.ts`
- **Description**: Create a presentational component displaying 5 stat cards in a responsive grid. Uses Angular `input()` signal function for all inputs. No service injection -- purely presentational.

  **Imports**: `Component, ChangeDetectionStrategy, input` from `@angular/core`

  **Component metadata**:

  - `selector: 'ptah-session-metrics-cards'`
  - `standalone: true`
  - `changeDetection: ChangeDetectionStrategy.OnPush`
  - Inline template (no separate HTML file)
  - `imports: []` (no child components needed)

  **Inputs** (using `input()` signal function):

  - `totalCost = input.required<number>()`
  - `totalInputTokens = input.required<number>()`
  - `totalOutputTokens = input.required<number>()`
  - `sessionCount = input.required<number>()`
  - `avgCostPerSession = input.required<number>()`

  **Template**: Grid of 5 stat cards using DaisyUI classes.

  - Layout: `<div class="grid grid-cols-2 lg:grid-cols-5 gap-3" role="region" aria-label="Usage metrics">`
  - Each card: `<div class="stat bg-base-200 rounded-lg p-3">` with `<div class="stat-title text-xs">` and `<div class="stat-value text-lg">`
  - Cards: Total Est. Cost, Input Tokens, Output Tokens, Sessions, Avg Cost/Session

  **Helper methods** (in component class):

  - `formatCost(cost: number): string` -- Returns `$0.00` for zero, `$X.XXXX` for sub-cent, `$X.XX` for normal
  - `formatTokenCount(count: number): string` -- Returns `X.XM` for millions, `X.XK` for thousands, raw number otherwise

- **Acceptance Criteria**:
  - [ ] File exists at the specified path
  - [ ] Component is standalone with `OnPush` change detection
  - [ ] Uses `input()` signal function (not `@Input()` decorator)
  - [ ] Renders 5 stat cards with DaisyUI `stat`, `stat-title`, `stat-value` classes
  - [ ] Grid layout: `grid-cols-2 lg:grid-cols-5`
  - [ ] Has `role="region"` and `aria-label="Usage metrics"` on container
  - [ ] `formatCost` handles zero, sub-cent (<0.01), and normal amounts
  - [ ] `formatTokenCount` handles millions (M suffix), thousands (K suffix), and small numbers
  - [ ] No service injections -- purely presentational

### Task 2.2: Create SessionHistoryTableComponent -- PENDING

- **Status**: PENDING
- **File(s)**: `D:\projects\ptah-extension\libs\frontend\dashboard\src\lib\components\session-analytics\session-history-table.component.ts`
- **Action**: CREATE
- **Description**: Create a presentational sortable table of sessions. Uses `input()` for data and `output()` for events. No service injection.

  **Imports**: `Component, ChangeDetectionStrategy, input, output` from `@angular/core`. Import `SortField`, `SessionWithCost` from the state service file (relative import `../../services/session-analytics-state.service`).

  **Component metadata**:

  - `selector: 'ptah-session-history-table'`
  - `standalone: true`
  - `changeDetection: ChangeDetectionStrategy.OnPush`
  - Inline template
  - `imports: []`

  **Inputs**:

  - `sessions = input.required<SessionWithCost[]>()`
  - `sortField = input.required<SortField>()`
  - `sortDirection = input.required<'asc' | 'desc'>()`
  - `hasMore = input.required<boolean>()`
  - `isLoadingMore = input.required<boolean>()`

  **Outputs**:

  - `sortChanged = output<SortField>()`
  - `loadMore = output<void>()`

  **Template**: DaisyUI table with sort indicators.

  - Table wrapper: `<div class="overflow-x-auto">`
  - Table: `<table class="table table-sm table-zebra w-full" role="table" aria-label="Session history">`
  - Column headers with `(click)="sortChanged.emit('fieldName')"` and `[attr.aria-sort]` binding
  - Columns: Name, Date, In Tokens, Out Tokens, Est. Cost, Msgs
  - Body rows: `@for (session of sessions(); track session.id)` with truncated name (`max-w-[200px] truncate`), formatted date, mono font token/cost values, "--" for missing data
  - Load More button: `@if (hasMore())` with loading spinner when `isLoadingMore()`

  **Helper methods**:

  - `formatCost(cost: number): string` -- Same as MetricsCardsComponent
  - `formatTokenCount(count: number): string` -- Same as MetricsCardsComponent
  - `formatDate(timestamp: number): string` -- Returns short date string (e.g., "Mar 15, 2026")
  - `getSortIndicator(field: SortField): string` -- Returns arrow indicator based on current sort state
  - `getSortAria(field: SortField): string | null` -- Returns 'ascending', 'descending', or null for `aria-sort`

- **Acceptance Criteria**:
  - [ ] File exists at the specified path
  - [ ] Component is standalone with `OnPush` change detection
  - [ ] Uses `input()` and `output()` signal functions
  - [ ] Table uses DaisyUI `table`, `table-sm`, `table-zebra` classes
  - [ ] Column headers are clickable and emit `sortChanged` with the field name
  - [ ] `aria-sort` attribute set on sorted column header
  - [ ] Session name column truncates with `max-w-[200px] truncate` and `[title]` attribute
  - [ ] Token/cost values use `font-mono text-xs` and `text-right` alignment
  - [ ] Missing data (null tokenUsage/estimatedCost) shows "--"
  - [ ] "Load More" button shows loading spinner when `isLoadingMore()` is true
  - [ ] "Load More" button is disabled when loading
  - [ ] No service injections -- purely presentational

### Task 2.3: Create TokenUsageBreakdownComponent -- PENDING

- **Status**: PENDING
- **File(s)**: `D:\projects\ptah-extension\libs\frontend\dashboard\src\lib\components\session-analytics\token-usage-breakdown.component.ts`
- **Action**: CREATE
- **Description**: Create a presentational component showing token distribution with DaisyUI progress bars. Hides cache bars when zero.

  **Imports**: `Component, ChangeDetectionStrategy, input` from `@angular/core`, `DecimalPipe` from `@angular/common`. Import `TokenBreakdownData` from the state service file.

  **Component metadata**:

  - `selector: 'ptah-token-usage-breakdown'`
  - `standalone: true`
  - `changeDetection: ChangeDetectionStrategy.OnPush`
  - Inline template
  - `imports: [DecimalPipe]`

  **Input**:

  - `breakdown = input.required<TokenBreakdownData>()`

  **Template**: Card with progress bars for each token type.

  - Container: `<div class="card bg-base-200 p-4" role="region" aria-label="Token usage breakdown">`
  - Heading: `<h3 class="text-sm font-semibold mb-3">Token Usage Breakdown</h3>`
  - Empty state: `@if (breakdown().total === 0)` shows "No token data available."
  - For each token type (input, output, cacheRead, cacheCreation):
    - Label row: `<div class="flex justify-between text-xs mb-1">` with name and `formatTokenCount(count) (XX.X%)`
    - Progress bar: `<progress class="progress progress-[color] w-full" [value]="percent" max="100">`
    - Colors: `progress-primary` (input), `progress-secondary` (output), `progress-accent` (cacheRead), `progress-info` (cacheCreation)
  - Cache bars hidden with `@if (breakdown().cacheRead > 0)` and `@if (breakdown().cacheCreation > 0)`
  - Total row: bordered top separator with total count

  **Helper method**:

  - `formatTokenCount(count: number): string` -- Same formatting as other components

- **Acceptance Criteria**:
  - [ ] File exists at the specified path
  - [ ] Component is standalone with `OnPush` change detection
  - [ ] Uses `input()` signal function
  - [ ] Imports `DecimalPipe` for percentage formatting (pipe: `number:'1.1-1'`)
  - [ ] Progress bars use DaisyUI `progress` classes with distinct colors per category
  - [ ] Cache Read bar hidden when `cacheRead === 0`
  - [ ] Cache Creation bar hidden when `cacheCreation === 0`
  - [ ] Empty state shown when `total === 0`
  - [ ] Total row displayed with separator
  - [ ] Has `role="region"` and `aria-label` on container
  - [ ] No service injections -- purely presentational

---

## Batch 3: Dashboard View + Exports (Assembly) -- PENDING

**Developer**: frontend-developer
**Tasks**: 2 | **Dependencies**: Batch 1 + Batch 2
**Verification**: `npx nx typecheck dashboard` and `npx nx build dashboard`

### Task 3.1: Create SessionAnalyticsDashboardViewComponent -- PENDING

- **Status**: PENDING
- **File(s)**: `D:\projects\ptah-extension\libs\frontend\dashboard\src\lib\components\session-analytics\session-analytics-dashboard-view.component.ts`
- **Action**: CREATE
- **Pattern to Follow**: `D:\projects\ptah-extension\libs\frontend\dashboard\src\lib\components\quality\quality-dashboard-view.component.ts`
- **Description**: Create the main dashboard layout component that composes all child components and wires the state service. Follows the QualityDashboardViewComponent pattern.

  **Imports**:

  - `Component, ChangeDetectionStrategy, inject, OnInit` from `@angular/core`
  - `SessionAnalyticsStateService` from `../../services/session-analytics-state.service`
  - `MetricsCardsComponent` from `./metrics-cards.component`
  - `SessionHistoryTableComponent` from `./session-history-table.component`
  - `TokenUsageBreakdownComponent` from `./token-usage-breakdown.component`
  - `AppStateManager` from `@ptah-extension/core`

  **Component metadata**:

  - `selector: 'ptah-session-analytics-dashboard'`
  - `standalone: true`
  - `imports: [MetricsCardsComponent, SessionHistoryTableComponent, TokenUsageBreakdownComponent]`
  - `changeDetection: ChangeDetectionStrategy.OnPush`
  - Inline template

  **Class**:

  - `readonly analyticsState = inject(SessionAnalyticsStateService)`
  - `private readonly appState = inject(AppStateManager)`
  - `readonly sessions = this.analyticsState.sessions`

  **ngOnInit()**: Call `this.analyticsState.ensureSessionsLoaded()`

  **navigateBack()**: Call `this.appState.setCurrentView('chat')`

  **Template**:

  - Root: `<div class="session-analytics-dashboard p-4 space-y-6">`
  - Header row: Title "Session Analytics" + badge "Estimated costs (default pricing)" + back button
  - Empty state: `@if (sessions().length === 0)` shows centered message "No sessions found. Start a chat to see analytics."
  - Data state: `@else` block with:
    - `<ptah-session-metrics-cards>` with all 5 metric inputs bound to state service signals
    - `<ptah-token-usage-breakdown>` with `[breakdown]="analyticsState.tokenBreakdown()"`
    - `<ptah-session-history-table>` with all inputs and event bindings

- **Acceptance Criteria**:
  - [ ] File exists at the specified path
  - [ ] Component is standalone with `OnPush` change detection
  - [ ] Imports all 3 child components
  - [ ] Injects `SessionAnalyticsStateService` and `AppStateManager`
  - [ ] Calls `ensureSessionsLoaded()` in `ngOnInit()`
  - [ ] Has empty state for zero sessions
  - [ ] Has "Estimated costs (default pricing)" badge in header
  - [ ] Has back button that calls `appState.setCurrentView('chat')`
  - [ ] All child component inputs are correctly bound to state service signals
  - [ ] `sortChanged` event calls `analyticsState.setSortField($event)`
  - [ ] `loadMore` event calls `analyticsState.loadMoreSessions()`

### Task 3.2: Update Dashboard Library Exports -- PENDING

- **Status**: PENDING
- **File(s)**: `D:\projects\ptah-extension\libs\frontend\dashboard\src\index.ts`
- **Action**: MODIFY
- **Description**: Add all session analytics exports to the dashboard library's public API. Add after the existing quality dashboard exports.

  **Add these exports** after line 11:

  ```typescript
  // Session Analytics Components (TASK_2025_206)
  export { SessionAnalyticsDashboardViewComponent } from './lib/components/session-analytics/session-analytics-dashboard-view.component';
  export { MetricsCardsComponent } from './lib/components/session-analytics/metrics-cards.component';
  export { SessionHistoryTableComponent } from './lib/components/session-analytics/session-history-table.component';
  export { TokenUsageBreakdownComponent } from './lib/components/session-analytics/token-usage-breakdown.component';

  // Session Analytics Services (TASK_2025_206)
  export { SessionAnalyticsStateService, type SortField, type SessionWithCost, type TokenBreakdownData } from './lib/services/session-analytics-state.service';
  ```

- **Acceptance Criteria**:
  - [ ] `index.ts` exports `SessionAnalyticsDashboardViewComponent`
  - [ ] `index.ts` exports `MetricsCardsComponent`
  - [ ] `index.ts` exports `SessionHistoryTableComponent`
  - [ ] `index.ts` exports `TokenUsageBreakdownComponent`
  - [ ] `index.ts` exports `SessionAnalyticsStateService`
  - [ ] `index.ts` exports `SortField`, `SessionWithCost`, `TokenBreakdownData` types
  - [ ] Existing quality dashboard exports are preserved (not removed)
  - [ ] `npx nx typecheck dashboard` passes
  - [ ] `npx nx build dashboard` passes

---

## Batch 4: App Shell Integration (Wiring) -- PENDING

**Developer**: frontend-developer
**Tasks**: 2 | **Dependencies**: Batch 3
**Verification**: `npx nx typecheck chat`

**Validation Notes**: This batch creates the `chat -> dashboard` dependency. Since `dashboard -> chat` already exists (Task 1.1 imports ChatStore), this creates a circular dependency between the two libraries. If `nx typecheck chat` fails with a circular dependency error, the fallback is to use an injection token approach (define a sessions provider token in `@ptah-extension/core`). Try the direct import first.

### Task 4.1: Add Analytics View to App Shell Template -- PENDING

- **Status**: PENDING
- **File(s)**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\app-shell.component.html`
- **Action**: MODIFY
- **Description**: Add a new `@case ('analytics')` block to the `@switch (currentView())` in the app shell template. Insert it BEFORE the `@default` case (after the `@case ('welcome')` block, before line 40).

  **Add this block** between line 37 (`}`) and line 39 (`<!-- Chat (default) -->`):

  ```html
  <!-- Analytics: Full-width dashboard layout (no sidebar) -->
  @case ('analytics') {
  <div class="h-full w-full overflow-y-auto">
    <ptah-session-analytics-dashboard />
  </div>
  }
  ```

- **Acceptance Criteria**:
  - [ ] `@case ('analytics')` exists in the `@switch` block
  - [ ] It is placed BEFORE the `@default` case
  - [ ] Dashboard component is rendered inside a `div` with `h-full w-full overflow-y-auto` classes
  - [ ] Uses the correct selector: `ptah-session-analytics-dashboard`
  - [ ] No sidebar or tab bar shown for analytics view (full-width standalone)
  - [ ] Existing cases (setup-wizard, settings, welcome, default) are unchanged

### Task 4.2: Import Dashboard Component in App Shell -- PENDING

- **Status**: PENDING
- **File(s)**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\app-shell.component.ts`
- **Action**: MODIFY
- **Description**: Add the `SessionAnalyticsDashboardViewComponent` import to the AppShellComponent.

  **Add import statement** near the top imports (after line 37 which imports WizardViewComponent):

  ```typescript
  import { SessionAnalyticsDashboardViewComponent } from '@ptah-extension/dashboard';
  ```

  **Add to the `imports` array** in the `@Component` decorator (after `ResizeHandleComponent` on approximately line 103):

  ```typescript
  SessionAnalyticsDashboardViewComponent,
  ```

- **Acceptance Criteria**:
  - [ ] `SessionAnalyticsDashboardViewComponent` is imported from `@ptah-extension/dashboard`
  - [ ] Component is added to the `imports` array in `@Component` decorator
  - [ ] `npx nx typecheck chat` passes (no circular dependency error)
  - [ ] All existing imports are preserved

---

## Batch 5: VS Code Panel Command (Backend) -- PENDING

**Developer**: backend-developer
**Tasks**: 2 | **Dependencies**: Batch 4
**Verification**: `npx nx typecheck ptah-extension-vscode`

### Task 5.1: Add initialView to createPanel Options -- PENDING

- **Status**: PENDING
- **File(s)**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\providers\angular-webview.provider.ts`
- **Action**: MODIFY
- **Description**: Extend the `createPanel()` method to accept an `initialView` parameter and pass it through to `generateAngularWebviewContent()`.

  **Change 1**: Update the `createPanel` method signature (line 114) to add `initialView`:

  ```typescript
  public async createPanel(options?: {
    initialSessionId?: string;
    initialSessionName?: string;
    initialView?: string;
  }): Promise<void> {
  ```

  **Change 2**: Update the panel title logic (around line 120) to handle dashboard title:

  ```typescript
  const panelTitle = options?.initialView === 'analytics' ? 'Ptah - Session Analytics' : options?.initialSessionName ? `Ptah - ${options.initialSessionName}` : 'Ptah - AI Coding Orchestra';
  ```

  **Change 3**: Pass `initialView` to `generateAngularWebviewContent()` (around line 176-187):

  ```typescript
  panel.webview.html = this.htmlGenerator.generateAngularWebviewContent(panel.webview, {
    workspaceInfo: this.htmlGenerator.buildWorkspaceInfo() as Record<string, unknown>,
    panelId,
    initialView: options?.initialView,
    initialSessionId: options?.initialSessionId,
    initialSessionName: options?.initialSessionName,
  });
  ```

- **Acceptance Criteria**:
  - [ ] `createPanel()` accepts `initialView?: string` in its options parameter
  - [ ] Panel title is "Ptah - Session Analytics" when `initialView === 'analytics'`
  - [ ] `initialView` is passed to `generateAngularWebviewContent()` options
  - [ ] Existing `initialSessionId` and `initialSessionName` functionality unchanged
  - [ ] `npx nx typecheck ptah-extension-vscode` passes

### Task 5.2: Register ptah.openDashboard Command -- PENDING

- **Status**: PENDING
- **File(s)**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\core\ptah-extension.ts`
- **Action**: MODIFY
- **Description**: Register a new `ptah.openDashboard` VS Code command that opens the analytics dashboard in a new webview panel. Add it in the `registerWebviews()` method, following the pattern of the existing `ptah.openFullPanel` command (lines 125-140).

  **Add after** the existing `panelCommand` registration (after line 140, before line 142):

  ```typescript
  // TASK_2025_206: Register command to open analytics dashboard panel
  const dashboardCommand = vscode.commands.registerCommand('ptah.openDashboard', async () => {
    try {
      await provider.createPanel({ initialView: 'analytics' });
      logger.info('Dashboard panel opened');
    } catch (err) {
      logger.error('Failed to open dashboard panel', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
  this.disposables.push(dashboardCommand);
  ```

- **Acceptance Criteria**:
  - [ ] `ptah.openDashboard` command is registered with `vscode.commands.registerCommand`
  - [ ] Command calls `provider.createPanel({ initialView: 'analytics' })`
  - [ ] Command is pushed to `this.disposables` for cleanup
  - [ ] Error handling follows existing pattern (try/catch with logger.error)
  - [ ] Existing `ptah.openFullPanel` command registration is not modified
  - [ ] `npx nx typecheck ptah-extension-vscode` passes

---

## Verification Summary

| Batch | Verification Command                                    | What to Check                                                |
| ----- | ------------------------------------------------------- | ------------------------------------------------------------ |
| 1     | `npx nx typecheck dashboard`                            | State service compiles, ChatStore import resolves            |
| 2     | `npx nx typecheck dashboard`                            | All 3 child components compile                               |
| 3     | `npx nx typecheck dashboard` + `npx nx build dashboard` | Dashboard view compiles, exports resolve                     |
| 4     | `npx nx typecheck chat`                                 | No circular dependency error, analytics case renders         |
| 5     | `npx nx typecheck ptah-extension-vscode`                | Command registration compiles, createPanel signature updated |
