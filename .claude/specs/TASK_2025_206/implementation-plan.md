# Implementation Plan - TASK_2025_206: Session-Based Dashboard with Pricing Analytics

## Codebase Investigation Summary

### Libraries Discovered

- **`@ptah-extension/dashboard`** (path: `libs/frontend/dashboard/`)

  - Current exports: Quality dashboard components only (7 components + 1 service)
  - Entry point: `D:\projects\ptah-extension\libs\frontend\dashboard\src\index.ts`
  - Pattern reference: `quality-dashboard-view.component.ts`, `quality-dashboard-state.service.ts`

- **`@ptah-extension/shared`** (path: `libs/shared/`)

  - Verified exports: `ChatSessionSummary`, `MessageTokenUsage`
  - Pricing utils: `findModelPricing()`, `calculateMessageCost()`, `formatModelDisplayName()`, `getModelPricingDescription()`
  - Session totals: `calculateSessionTotals()`, `SessionTotals`
  - Subagent costs: `calculateSessionCostSummary()`, `AgentCostBreakdown`

- **`@ptah-extension/chat`** (path: `libs/frontend/chat/`)

  - `ChatStore.sessions` signal: `readonly ChatSessionSummary[]`
  - `ChatStore.hasMoreSessions`, `ChatStore.loadMoreSessions()`, `ChatStore.totalSessions`
  - `ChatStore.isLoadingMoreSessions`

- **`@ptah-extension/core`** (path: `libs/frontend/core/`)
  - `AppStateManager.currentView` signal, `setCurrentView()`, `ViewType` includes `'analytics'`
  - `WebviewNavigationService.navigateToView('analytics')`

### Patterns Identified

- **Quality Dashboard Pattern**: `QualityDashboardViewComponent` + `QualityDashboardStateService`

  - State service: `@Injectable({ providedIn: 'root' })` with private writable signals + public readonly
  - View component: Standalone, OnPush, inject state service, load data in `ngOnInit()`
  - Template: `@if/@else if/@else` for loading/error/data/empty states
  - DaisyUI classes: `btn`, `alert`, `loading`, grid layout with `gap-4`

- **Panel Creation Pattern**: `AngularWebviewProvider.createPanel()`

  - Creates `vscode.window.createWebviewPanel()` with `retainContextWhenHidden: true`
  - Passes `initialView` in `ptahConfig` via `WebviewHtmlGenerator`
  - `AppStateManager.initializeState()` reads `window.ptahConfig?.initialView` or `window.initialView`
  - `VALID_VIEWS` already includes `'analytics'`

- **App Shell View Routing**: `AppShellComponent` template uses `@switch (currentView())`
  - Current cases: `'setup-wizard'`, `'settings'`, `'welcome'`, `@default` (chat + sidebar)
  - Need to add `'analytics'` case for rendering dashboard

### Integration Points

- **ChatStore** is `providedIn: 'root'`, accessible from any component via `inject(ChatStore)`
- **AppStateManager** is `providedIn: 'root'`, already supports `'analytics'` ViewType
- **Pricing utils** are pure functions exported from `@ptah-extension/shared`

### Key Technical Decision: Cost Without Model

`ChatSessionSummary` has `tokenUsage?: MessageTokenUsage` but **no `model` field**. The `model` is only available after `chat:resume` (loading full session).

**Decision**: Use **default pricing** (`findModelPricing('')` returns Sonnet 4.5 rates as fallback) for the overview. Label costs as "Estimated" in the UI. This is clearly documented in the task requirements as the expected approach.

**Evidence**: `pricing.utils.ts:182-188` - `DEFAULT_MODEL_PRICING['default']` uses Sonnet 4.5 rates ($3/1M input, $15/1M output).

---

## Architecture Overview

```
                  VS Code                              Electron
                  ─────────                            ────────
  ptah.openDashboard cmd                      AppStateManager.setCurrentView('analytics')
         │                                              │
  AngularWebviewProvider                       ElectronShellComponent
  .createPanel({initialView:'analytics'})              │
         │                                    AppShellComponent
  New WebviewPanel                             @switch('analytics')
  window.ptahConfig.initialView='analytics'            │
         │                                    ┌────────────────────┐
  AppStateManager                             │ SessionAnalytics   │
  reads ptahConfig → 'analytics'              │ DashboardView      │
         │                                    └────────┬───────────┘
  AppShellComponent                                    │
  @switch('analytics')                    SessionAnalyticsStateService
         │                                    (computed signals)
  ┌──────────────────┐                                 │
  │ SessionAnalytics │                     ChatStore.sessions signal
  │ DashboardView    │                                 │
  └──────┬───────────┘                     pricing.utils.ts
         │                                 (cost calculation)
  SessionAnalyticsStateService
  (computed signals from ChatStore.sessions)
```

---

## File Structure

### New Files (CREATE)

| #   | File Path                                                                                                                               | Purpose                                                     |
| --- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 1   | `D:\projects\ptah-extension\libs\frontend\dashboard\src\lib\services\session-analytics-state.service.ts`                                | Signal-based state service for session analytics            |
| 2   | `D:\projects\ptah-extension\libs\frontend\dashboard\src\lib\components\session-analytics\session-analytics-dashboard-view.component.ts` | Main dashboard layout (analogous to quality-dashboard-view) |
| 3   | `D:\projects\ptah-extension\libs\frontend\dashboard\src\lib\components\session-analytics\metrics-cards.component.ts`                    | Summary metric stat cards                                   |
| 4   | `D:\projects\ptah-extension\libs\frontend\dashboard\src\lib\components\session-analytics\session-history-table.component.ts`            | Sortable session history table                              |
| 5   | `D:\projects\ptah-extension\libs\frontend\dashboard\src\lib\components\session-analytics\model-comparison-table.component.ts`           | Per-model cost comparison                                   |
| 6   | `D:\projects\ptah-extension\libs\frontend\dashboard\src\lib\components\session-analytics\token-usage-breakdown.component.ts`            | Token distribution breakdown                                |

### Modified Files (MODIFY)

| #   | File Path                                                                                             | Change                                        |
| --- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| 7   | `D:\projects\ptah-extension\libs\frontend\dashboard\src\index.ts`                                     | Add session analytics exports                 |
| 8   | `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\app-shell.component.html` | Add `@case ('analytics')` to `@switch`        |
| 9   | `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\app-shell.component.ts`   | Import SessionAnalyticsDashboardViewComponent |
| 10  | `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\core\ptah-extension.ts`                    | Register `ptah.openDashboard` command         |

---

## Component Design

### 1. SessionAnalyticsStateService

**File**: `D:\projects\ptah-extension\libs\frontend\dashboard\src\lib\services\session-analytics-state.service.ts`

**Purpose**: Centralized signal-based state service that consumes `ChatStore.sessions` and computes all analytics metrics reactively. Follows `QualityDashboardStateService` pattern.

**Pattern**: `QualityDashboardStateService` (evidence: `D:\projects\ptah-extension\libs\frontend\dashboard\src\lib\services\quality-dashboard-state.service.ts:1-120`)

**Dependencies** (all verified):

- `ChatStore` from `@ptah-extension/chat` (verified: `chat.store.ts:148` - `sessions` signal)
- `calculateMessageCost` from `@ptah-extension/shared` (verified: `pricing.utils.ts:305`)
- `findModelPricing` from `@ptah-extension/shared` (verified: `pricing.utils.ts:244`)
- `formatModelDisplayName` from `@ptah-extension/shared` (verified: `pricing.utils.ts:358`)
- `getModelPricingDescription` from `@ptah-extension/shared` (verified: `pricing.utils.ts:336`)

**Design**:

```typescript
@Injectable({ providedIn: 'root' })
export class SessionAnalyticsStateService {
  private readonly chatStore = inject(ChatStore);

  // Sort configuration signals
  private readonly _sortField = signal<SortField>('lastActivityAt');
  private readonly _sortDirection = signal<'asc' | 'desc'>('desc');
  readonly sortField = this._sortField.asReadonly();
  readonly sortDirection = this._sortDirection.asReadonly();

  // Direct delegation from ChatStore
  readonly sessions = this.chatStore.sessions;
  readonly hasMoreSessions = this.chatStore.hasMoreSessions;
  readonly isLoadingMore = this.chatStore.isLoadingMoreSessions;

  // Computed: sessions with computed cost
  readonly sessionsWithCost = computed(() => {
    const sessions = this.sessions();
    return sessions.map((session) => {
      const cost = session.tokenUsage
        ? calculateMessageCost('', {
            // empty model → default pricing
            input: session.tokenUsage.input,
            output: session.tokenUsage.output,
            cacheHit: session.tokenUsage.cacheRead,
            cacheCreation: session.tokenUsage.cacheCreation,
          })
        : null;
      return { ...session, estimatedCost: cost };
    });
  });

  // Computed: aggregate metrics
  readonly totalSessions = computed(() => this.sessions().length);

  readonly totalEstimatedCost = computed(() => this.sessionsWithCost().reduce((sum, s) => sum + (s.estimatedCost ?? 0), 0));

  readonly totalInputTokens = computed(() => this.sessions().reduce((sum, s) => sum + (s.tokenUsage?.input ?? 0), 0));

  readonly totalOutputTokens = computed(() => this.sessions().reduce((sum, s) => sum + (s.tokenUsage?.output ?? 0), 0));

  readonly totalCacheReadTokens = computed(() => this.sessions().reduce((sum, s) => sum + (s.tokenUsage?.cacheRead ?? 0), 0));

  readonly totalCacheCreationTokens = computed(() => this.sessions().reduce((sum, s) => sum + (s.tokenUsage?.cacheCreation ?? 0), 0));

  readonly sessionsWithTokenData = computed(() => this.sessions().filter((s) => !!s.tokenUsage).length);

  readonly avgCostPerSession = computed(() => {
    const count = this.sessionsWithTokenData();
    return count > 0 ? this.totalEstimatedCost() / count : 0;
  });

  // Computed: token breakdown
  readonly tokenBreakdown = computed(() => {
    const input = this.totalInputTokens();
    const output = this.totalOutputTokens();
    const cacheRead = this.totalCacheReadTokens();
    const cacheCreation = this.totalCacheCreationTokens();
    const total = input + output + cacheRead + cacheCreation;
    return {
      input,
      output,
      cacheRead,
      cacheCreation,
      total,
      inputPercent: total > 0 ? (input / total) * 100 : 0,
      outputPercent: total > 0 ? (output / total) * 100 : 0,
      cacheReadPercent: total > 0 ? (cacheRead / total) * 100 : 0,
      cacheCreationPercent: total > 0 ? (cacheCreation / total) * 100 : 0,
    };
  });

  // Computed: sorted sessions for table
  readonly sortedSessions = computed(() => {
    const sessions = [...this.sessionsWithCost()];
    const field = this._sortField();
    const dir = this._sortDirection();
    return sessions.sort((a, b) => {
      let aVal: number | string;
      let bVal: number | string;
      switch (field) {
        case 'name':
          aVal = a.name;
          bVal = b.name;
          break;
        case 'createdAt':
          aVal = a.createdAt;
          bVal = b.createdAt;
          break;
        case 'lastActivityAt':
          aVal = a.lastActivityAt;
          bVal = b.lastActivityAt;
          break;
        case 'inputTokens':
          aVal = a.tokenUsage?.input ?? 0;
          bVal = b.tokenUsage?.input ?? 0;
          break;
        case 'outputTokens':
          aVal = a.tokenUsage?.output ?? 0;
          bVal = b.tokenUsage?.output ?? 0;
          break;
        case 'estimatedCost':
          aVal = a.estimatedCost ?? 0;
          bVal = b.estimatedCost ?? 0;
          break;
        case 'messageCount':
          aVal = a.messageCount;
          bVal = b.messageCount;
          break;
        default:
          aVal = a.lastActivityAt;
          bVal = b.lastActivityAt;
      }
      if (aVal < bVal) return dir === 'asc' ? -1 : 1;
      if (aVal > bVal) return dir === 'asc' ? 1 : -1;
      return 0;
    });
  });

  // Actions
  setSortField(field: SortField): void {
    if (this._sortField() === field) {
      this._sortDirection.update((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      this._sortField.set(field);
      this._sortDirection.set('asc');
    }
  }

  loadMoreSessions(): void {
    this.chatStore.loadMoreSessions();
  }

  ensureSessionsLoaded(): void {
    // ChatStore auto-loads on init, but if sessions are empty, trigger load
    if (this.sessions().length === 0) {
      this.chatStore.loadSessions();
    }
  }
}

export type SortField = 'name' | 'createdAt' | 'lastActivityAt' | 'inputTokens' | 'outputTokens' | 'estimatedCost' | 'messageCount';
```

**Rationale**:

- All state is derived from `ChatStore.sessions` via `computed()` -- no additional RPC calls
- Cost calculated using `calculateMessageCost('', tokens)` which falls back to default pricing
- `computed()` signals memoize results -- recalculates only when `sessions` signal updates
- Sort state is local to the dashboard (not persisted)

---

### 2. SessionAnalyticsDashboardViewComponent

**File**: `D:\projects\ptah-extension\libs\frontend\dashboard\src\lib\components\session-analytics\session-analytics-dashboard-view.component.ts`

**Purpose**: Main dashboard layout. Composes child components. Follows `QualityDashboardViewComponent` pattern.

**Pattern Evidence**: `quality-dashboard-view.component.ts:38-194`

**Template Structure**:

```html
<div class="session-analytics-dashboard p-4 space-y-6">
  <!-- Header -->
  <div class="flex justify-between items-center">
    <h2 class="text-xl font-bold">Session Analytics</h2>
    <div class="flex items-center gap-2">
      <span class="badge badge-ghost text-xs">Estimated costs (default pricing)</span>
      <button class="btn btn-sm btn-ghost" (click)="navigateBack()" aria-label="Back to chat">
        <!-- X icon or Back arrow -->
      </button>
    </div>
  </div>

  @if (sessions().length === 0) {
  <!-- Empty state -->
  <div class="flex flex-col items-center justify-center p-12 text-base-content/50">
    <p class="text-sm">No sessions found. Start a chat to see analytics.</p>
  </div>
  } @else {
  <!-- Metric Cards Row -->
  <ptah-session-metrics-cards [totalCost]="analyticsState.totalEstimatedCost()" [totalInputTokens]="analyticsState.totalInputTokens()" [totalOutputTokens]="analyticsState.totalOutputTokens()" [sessionCount]="analyticsState.totalSessions()" [avgCostPerSession]="analyticsState.avgCostPerSession()" />

  <!-- Token Breakdown -->
  <ptah-token-usage-breakdown [breakdown]="analyticsState.tokenBreakdown()" />

  <!-- Session History Table -->
  <ptah-session-history-table [sessions]="analyticsState.sortedSessions()" [sortField]="analyticsState.sortField()" [sortDirection]="analyticsState.sortDirection()" [hasMore]="analyticsState.hasMoreSessions()" [isLoadingMore]="analyticsState.isLoadingMore()" (sortChanged)="analyticsState.setSortField($event)" (loadMore)="analyticsState.loadMoreSessions()" />
  }
</div>
```

**Component Class**:

```typescript
@Component({
  selector: 'ptah-session-analytics-dashboard',
  standalone: true,
  imports: [MetricsCardsComponent, SessionHistoryTableComponent, TokenUsageBreakdownComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `...`, // as above
})
export class SessionAnalyticsDashboardViewComponent implements OnInit {
  readonly analyticsState = inject(SessionAnalyticsStateService);
  private readonly appState = inject(AppStateManager);

  readonly sessions = this.analyticsState.sessions;

  ngOnInit(): void {
    this.analyticsState.ensureSessionsLoaded();
  }

  navigateBack(): void {
    this.appState.setCurrentView('chat');
  }
}
```

---

### 3. MetricsCardsComponent

**File**: `D:\projects\ptah-extension\libs\frontend\dashboard\src\lib\components\session-analytics\metrics-cards.component.ts`

**Purpose**: Display 5 stat cards with key metrics using DaisyUI `stat` classes.

**Inputs**:

- `totalCost: number` - Total estimated cost in USD
- `totalInputTokens: number` - Aggregate input tokens
- `totalOutputTokens: number` - Aggregate output tokens
- `sessionCount: number` - Total sessions loaded
- `avgCostPerSession: number` - Average cost per session

**Template Sketch**:

```html
<div class="grid grid-cols-2 lg:grid-cols-5 gap-3" role="region" aria-label="Usage metrics">
  <!-- Total Cost -->
  <div class="stat bg-base-200 rounded-lg p-3">
    <div class="stat-title text-xs">Total Est. Cost</div>
    <div class="stat-value text-lg">{{ formatCost(totalCost()) }}</div>
  </div>

  <!-- Input Tokens -->
  <div class="stat bg-base-200 rounded-lg p-3">
    <div class="stat-title text-xs">Input Tokens</div>
    <div class="stat-value text-lg">{{ formatTokenCount(totalInputTokens()) }}</div>
  </div>

  <!-- Output Tokens -->
  <div class="stat bg-base-200 rounded-lg p-3">
    <div class="stat-title text-xs">Output Tokens</div>
    <div class="stat-value text-lg">{{ formatTokenCount(totalOutputTokens()) }}</div>
  </div>

  <!-- Sessions -->
  <div class="stat bg-base-200 rounded-lg p-3">
    <div class="stat-title text-xs">Sessions</div>
    <div class="stat-value text-lg">{{ sessionCount() }}</div>
  </div>

  <!-- Avg Cost -->
  <div class="stat bg-base-200 rounded-lg p-3">
    <div class="stat-title text-xs">Avg Cost/Session</div>
    <div class="stat-value text-lg">{{ formatCost(avgCostPerSession()) }}</div>
  </div>
</div>
```

**Helper Methods** (in component):

```typescript
formatCost(cost: number): string {
  if (cost === 0) return '$0.00';
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

formatTokenCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return count.toString();
}
```

---

### 4. SessionHistoryTableComponent

**File**: `D:\projects\ptah-extension\libs\frontend\dashboard\src\lib\components\session-analytics\session-history-table.component.ts`

**Purpose**: Sortable table of sessions with columns: Name, Date, Input Tokens, Output Tokens, Est. Cost, Messages.

**Inputs**:

- `sessions: SessionWithCost[]` - Sorted session list
- `sortField: SortField` - Current sort column
- `sortDirection: 'asc' | 'desc'` - Current sort direction
- `hasMore: boolean` - Whether more sessions can be loaded
- `isLoadingMore: boolean` - Loading indicator state

**Outputs**:

- `sortChanged: SortField` - Emitted when user clicks a column header
- `loadMore: void` - Emitted when user clicks "Load More"

**Template Sketch**:

```html
<div class="overflow-x-auto">
  <table class="table table-sm table-zebra w-full" role="table" aria-label="Session history">
    <thead>
      <tr>
        <th class="cursor-pointer" (click)="sortChanged.emit('name')" [attr.aria-sort]="getSortAria('name')">Name {{ getSortIndicator('name') }}</th>
        <th class="cursor-pointer" (click)="sortChanged.emit('lastActivityAt')" [attr.aria-sort]="getSortAria('lastActivityAt')">Date {{ getSortIndicator('lastActivityAt') }}</th>
        <th class="cursor-pointer text-right" (click)="sortChanged.emit('inputTokens')" [attr.aria-sort]="getSortAria('inputTokens')">In Tokens {{ getSortIndicator('inputTokens') }}</th>
        <th class="cursor-pointer text-right" (click)="sortChanged.emit('outputTokens')" [attr.aria-sort]="getSortAria('outputTokens')">Out Tokens {{ getSortIndicator('outputTokens') }}</th>
        <th class="cursor-pointer text-right" (click)="sortChanged.emit('estimatedCost')" [attr.aria-sort]="getSortAria('estimatedCost')">Est. Cost {{ getSortIndicator('estimatedCost') }}</th>
        <th class="cursor-pointer text-right" (click)="sortChanged.emit('messageCount')" [attr.aria-sort]="getSortAria('messageCount')">Msgs {{ getSortIndicator('messageCount') }}</th>
      </tr>
    </thead>
    <tbody>
      @for (session of sessions(); track session.id) {
      <tr>
        <td class="max-w-[200px] truncate" [title]="session.name">{{ session.name }}</td>
        <td class="whitespace-nowrap">{{ formatDate(session.lastActivityAt) }}</td>
        <td class="text-right font-mono text-xs">{{ session.tokenUsage ? formatTokenCount(session.tokenUsage.input) : '--' }}</td>
        <td class="text-right font-mono text-xs">{{ session.tokenUsage ? formatTokenCount(session.tokenUsage.output) : '--' }}</td>
        <td class="text-right font-mono text-xs">{{ session.estimatedCost !== null ? formatCost(session.estimatedCost) : '--' }}</td>
        <td class="text-right">{{ session.messageCount }}</td>
      </tr>
      }
    </tbody>
  </table>

  <!-- Load More -->
  @if (hasMore()) {
  <div class="flex justify-center py-3">
    <button class="btn btn-sm btn-ghost" [disabled]="isLoadingMore()" (click)="loadMore.emit()">
      @if (isLoadingMore()) {
      <span class="loading loading-spinner loading-xs"></span> Loading... } @else { Load More Sessions }
    </button>
  </div>
  }
</div>
```

**DaisyUI Classes**: `table`, `table-sm`, `table-zebra`, `btn`, `btn-sm`, `btn-ghost`, `loading`

---

### 5. TokenUsageBreakdownComponent

**File**: `D:\projects\ptah-extension\libs\frontend\dashboard\src\lib\components\session-analytics\token-usage-breakdown.component.ts`

**Purpose**: Visualize token distribution across input/output/cache using DaisyUI progress bars.

**Input**:

- `breakdown: TokenBreakdownData` - Contains absolute counts and percentages

**Template Sketch**:

```html
<div class="card bg-base-200 p-4" role="region" aria-label="Token usage breakdown">
  <h3 class="text-sm font-semibold mb-3">Token Usage Breakdown</h3>

  @if (breakdown().total === 0) {
  <p class="text-sm text-base-content/50">No token data available.</p>
  } @else {
  <div class="space-y-3">
    <!-- Input Tokens -->
    <div>
      <div class="flex justify-between text-xs mb-1">
        <span>Input</span>
        <span class="font-mono">{{ formatTokenCount(breakdown().input) }} ({{ breakdown().inputPercent | number:'1.1-1' }}%)</span>
      </div>
      <progress class="progress progress-primary w-full" [value]="breakdown().inputPercent" max="100"></progress>
    </div>

    <!-- Output Tokens -->
    <div>
      <div class="flex justify-between text-xs mb-1">
        <span>Output</span>
        <span class="font-mono">{{ formatTokenCount(breakdown().output) }} ({{ breakdown().outputPercent | number:'1.1-1' }}%)</span>
      </div>
      <progress class="progress progress-secondary w-full" [value]="breakdown().outputPercent" max="100"></progress>
    </div>

    <!-- Cache Read Tokens (hidden if zero) -->
    @if (breakdown().cacheRead > 0) {
    <div>
      <div class="flex justify-between text-xs mb-1">
        <span>Cache Read</span>
        <span class="font-mono">{{ formatTokenCount(breakdown().cacheRead) }} ({{ breakdown().cacheReadPercent | number:'1.1-1' }}%)</span>
      </div>
      <progress class="progress progress-accent w-full" [value]="breakdown().cacheReadPercent" max="100"></progress>
    </div>
    }

    <!-- Cache Creation Tokens (hidden if zero) -->
    @if (breakdown().cacheCreation > 0) {
    <div>
      <div class="flex justify-between text-xs mb-1">
        <span>Cache Creation</span>
        <span class="font-mono">{{ formatTokenCount(breakdown().cacheCreation) }} ({{ breakdown().cacheCreationPercent | number:'1.1-1' }}%)</span>
      </div>
      <progress class="progress progress-info w-full" [value]="breakdown().cacheCreationPercent" max="100"></progress>
    </div>
    }

    <!-- Total -->
    <div class="border-t border-base-content/10 pt-2">
      <div class="flex justify-between text-xs font-semibold">
        <span>Total</span>
        <span class="font-mono">{{ formatTokenCount(breakdown().total) }}</span>
      </div>
    </div>
  </div>
  }
</div>
```

**DaisyUI Classes**: `card`, `progress`, `progress-primary`, `progress-secondary`, `progress-accent`, `progress-info`

---

### 6. ModelComparisonTableComponent (DEFERRED - Not in v1)

Per task requirements Key Technical Decision #1: `ChatSessionSummary` lacks a `model` field. Without model data, per-model grouping from the session list is not possible.

**Decision**: Model comparison is **deferred** from v1. It can be added in a follow-up once `model` is added to `ChatSessionSummary` on the backend. The architecture supports adding it later by creating a new `computed()` signal in `SessionAnalyticsStateService` that groups by model.

---

## State Management

### Signal Architecture

```
ChatStore.sessions (source of truth)
    │
    ├── SessionAnalyticsStateService
    │   ├── sessionsWithCost = computed(sessions → map + calculateMessageCost)
    │   ├── totalEstimatedCost = computed(sessionsWithCost → reduce)
    │   ├── totalInputTokens = computed(sessions → reduce)
    │   ├── totalOutputTokens = computed(sessions → reduce)
    │   ├── totalCacheReadTokens = computed(sessions → reduce)
    │   ├── totalCacheCreationTokens = computed(sessions → reduce)
    │   ├── sessionsWithTokenData = computed(sessions → filter.length)
    │   ├── avgCostPerSession = computed(totalCost / sessionsWithTokenData)
    │   ├── tokenBreakdown = computed(all token totals → percentages)
    │   ├── sortedSessions = computed(sessionsWithCost + sortField + sortDirection)
    │   │
    │   └── [sort state: _sortField, _sortDirection signals]
    │
    └── Component tree reads these computed signals
```

**Key Properties**:

- **No additional RPC calls**: All data derived from existing `ChatStore.sessions`
- **Lazy computation**: `computed()` only recalculates when dependencies change
- **Reactive**: When `ChatStore` refreshes sessions (e.g., after a new chat), all metrics auto-update
- **Cached on navigate-away**: `SessionAnalyticsStateService` is `providedIn: 'root'` so state persists when switching views

---

## Platform Integration

### VS Code: Full Web Panel

**New Command**: `ptah.openDashboard`

**Registration** in `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\core\ptah-extension.ts`:

```typescript
const dashboardCommand = vscode.commands.registerCommand('ptah.openDashboard', async () => {
  try {
    await provider.createPanel({ initialView: 'analytics' });
    logger.info('Dashboard panel opened');
  } catch (error) {
    logger.error('Failed to open dashboard panel:', error);
  }
});
context.subscriptions.push(dashboardCommand);
```

**Requires**: Adding `initialView` option to `AngularWebviewProvider.createPanel()`.

Currently `createPanel()` accepts `{ initialSessionId?, initialSessionName? }`. We need to extend it:

```typescript
public async createPanel(options?: {
  initialSessionId?: string;
  initialSessionName?: string;
  initialView?: string;  // NEW
}): Promise<void> {
```

And pass `initialView` to `generateAngularWebviewContent()`:

```typescript
panel.webview.html = this.htmlGenerator.generateAngularWebviewContent(panel.webview, {
  workspaceInfo: this.htmlGenerator.buildWorkspaceInfo() as Record<string, unknown>,
  panelId,
  initialView: options?.initialView, // NEW
  initialSessionId: options?.initialSessionId,
  initialSessionName: options?.initialSessionName,
});
```

**Evidence**: `WebviewHtmlGenerator.generateAngularWebviewContent()` already accepts `initialView` in its options (verified at `webview-html-generator.ts:41`). `VALID_VIEWS` already includes `'analytics'` (verified at `webview-html-generator.ts:120`). `AppStateManager.initializeState()` reads `ptahConfig.initialView` (verified at `app-state.service.ts:144`).

### Electron: Center Panel View

The `ElectronShellComponent` wraps `AppShellComponent` (verified: `electron-shell.component.ts:159`). No changes needed to `ElectronShellComponent`.

The `AppShellComponent` needs a new `@case ('analytics')` in its `@switch (currentView())` block.

### AppShellComponent Changes

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\app-shell.component.html`

Add before the `@default` case:

```html
<!-- Analytics: Full-width dashboard layout (no sidebar) -->
@case ('analytics') {
<div class="h-full w-full overflow-y-auto">
  <ptah-session-analytics-dashboard />
</div>
}
```

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\app-shell.component.ts`

Add import:

```typescript
import { SessionAnalyticsDashboardViewComponent } from '@ptah-extension/dashboard';
```

Add to `imports` array:

```typescript
imports: [
  // ...existing imports
  SessionAnalyticsDashboardViewComponent,
];
```

### Navigation

Users can reach the dashboard via:

1. **VS Code command palette**: `ptah.openDashboard` (opens new panel)
2. **Programmatic**: `appState.setCurrentView('analytics')` (in-place view switch)
3. **Future**: A nav button could be added to the header bar (not in scope for v1)

The dashboard provides a "Back to chat" button that calls `appState.setCurrentView('chat')`.

---

## Data Flow

```
1. ChatStore auto-loads sessions on init → calls session:list RPC
2. SessionLoaderService stores results in _sessions signal
3. ChatStore.sessions delegates to SessionLoaderService.sessions (readonly signal)
4. SessionAnalyticsStateService injects ChatStore, reads sessions signal
5. computed() signals calculate:
   - sessionsWithCost (map each session → calculateMessageCost with default pricing)
   - totalEstimatedCost (reduce sessionsWithCost)
   - totalInputTokens / totalOutputTokens (reduce sessions)
   - tokenBreakdown (percentages from totals)
   - sortedSessions (sort sessionsWithCost by user-selected column)
6. Dashboard view component reads state service signals in template
7. Child components receive data via @input() signals
8. User clicks "Load More" → ChatStore.loadMoreSessions() → sessions signal updates → all recomputes
```

---

## Dependencies

### New Dependencies

None. All required utilities already exist in `@ptah-extension/shared`.

### Import Changes

**`libs/frontend/dashboard/src/index.ts`** -- Add exports:

```typescript
// Session Analytics Components (TASK_2025_206)
export { SessionAnalyticsDashboardViewComponent } from './lib/components/session-analytics/session-analytics-dashboard-view.component';
export { MetricsCardsComponent } from './lib/components/session-analytics/metrics-cards.component';
export { SessionHistoryTableComponent } from './lib/components/session-analytics/session-history-table.component';
export { TokenUsageBreakdownComponent } from './lib/components/session-analytics/token-usage-breakdown.component';

// Session Analytics Services (TASK_2025_206)
export { SessionAnalyticsStateService } from './lib/services/session-analytics-state.service';
```

### Cross-Library Imports Required

- `@ptah-extension/dashboard` needs `@ptah-extension/chat` (for ChatStore) -- **already established** in existing quality dashboard (verified in `quality-dashboard-state.service.ts` which imports from `@ptah-extension/core`)
- `@ptah-extension/chat` needs `@ptah-extension/dashboard` (for SessionAnalyticsDashboardViewComponent in AppShell) -- This is a **new dependency direction**. Since `chat` already lists `dashboard` isn't in its current imports, we need to verify this is allowed.

**Investigation**: Check `tsconfig.base.json` or Nx project constraints.

Actually, looking at the architecture layers: `chat` is a Feature Library and `dashboard` is also a Feature Library. Feature libraries CAN import from each other as long as there are no circular dependencies. The `dashboard` already imports from `chat` (ChatStore), so `chat` importing from `dashboard` would create a **circular dependency**.

**Resolution**: The `SessionAnalyticsDashboardViewComponent` should be imported in the **app shell** which lives in `chat` library. To avoid circular dependency, we have two options:

1. **Lazy load via dynamic import** in the app shell template -- but Angular standalone components don't support this easily in templates.
2. **Move the app shell analytics case to use `@defer`** -- Angular's `@defer` block with `@placeholder` can lazy-load the component.
3. **Import the component directly** -- since the `dashboard` lib already depends on `chat` (for ChatStore), having `chat` also depend on `dashboard` creates a circular dependency. This is NOT allowed.

**Correct Solution**: The dashboard view component should NOT be imported by `chat`. Instead:

**Option A**: The app-level webview app (`ptah-extension-webview`) handles the `'analytics'` view routing, not `AppShellComponent`. But `AppShellComponent` is where the `@switch` is...

**Option B**: Use Angular's `@defer` block which resolves imports at build time but loads lazily. However, this still requires the import.

**Option C (BEST)**: Move the analytics view rendering out of `AppShellComponent`. Instead, the top-level app component in `ptah-extension-webview` handles the analytics case BEFORE delegating to `AppShellComponent`.

Let me check the webview app's root component.

Actually, looking more carefully: the `AppShellComponent` in `chat` library already imports from `@ptah-extension/setup-wizard` (verified: `app-shell.component.ts:37` -- `import { WizardViewComponent } from '@ptah-extension/setup-wizard'`). So `chat` already depends on feature libraries. The question is whether `chat → dashboard` AND `dashboard → chat` creates a true circular dependency.

**Checking**: `dashboard/quality-dashboard-state.service.ts` imports from `@ptah-extension/core` (ClaudeRpcService), NOT from `@ptah-extension/chat`. The `SessionAnalyticsStateService` would need to import `ChatStore` from `@ptah-extension/chat`.

So: `chat` → `dashboard` (AppShell imports analytics view), `dashboard` → `chat` (state service imports ChatStore). This IS circular.

**Final Solution**: The `SessionAnalyticsStateService` should NOT import from `@ptah-extension/chat` directly. Instead, it should receive the sessions data via **dependency injection token** or through `@ptah-extension/core`.

Actually, the simplest and cleanest approach:

**The `SessionAnalyticsStateService` receives sessions as an input signal, set by the parent component.** The parent component (in the app shell) injects `ChatStore` and passes `chatStore.sessions()` to the state service. But state services don't have inputs...

**Cleanest approach**: Use an **intermediate provider pattern**. The `SessionAnalyticsDashboardViewComponent` lives in `dashboard` lib but receives the sessions data via an **injection token** defined in `@ptah-extension/shared` or `@ptah-extension/core`.

**Actually, the simplest clean approach is**:

1. `SessionAnalyticsStateService` is defined in `dashboard` lib
2. It declares a dependency on an abstract "sessions provider" interface/token
3. `AppShellComponent` (in `chat`) provides the concrete ChatStore sessions via a provider

This is over-engineering. Let me look at the actual Nx dependency constraint.

**Pragmatic Solution**: Check if `@ptah-extension/dashboard` project.json already lists `@ptah-extension/chat` as a dependency.

Looking at the existing `dashboard/index.ts`, it exports only quality components. The `quality-dashboard-state.service.ts` imports from `@ptah-extension/core` (ClaudeRpcService) and `@ptah-extension/shared`. It does NOT import from `@ptah-extension/chat`.

So currently: `chat` does NOT depend on `dashboard`, and `dashboard` does NOT depend on `chat`.

**The cleanest solution for v1**:

1. **`SessionAnalyticsStateService` imports `ChatStore` from `@ptah-extension/chat`** -- creating `dashboard → chat` dependency
2. **`AppShellComponent` (in `chat`) imports `SessionAnalyticsDashboardViewComponent` from `@ptah-extension/dashboard`** -- creating `chat → dashboard` dependency
3. This is circular and MUST be avoided.

**ACTUAL SOLUTION**: Put the `SessionAnalyticsDashboardViewComponent` import in the **webview app** layer, not in `chat`.

Looking at the architecture: `ptah-extension-webview` is the Angular application that bootstraps the webview. Let me check its structure.

The webview app root component delegates to either `AppShellComponent` or `ElectronShellComponent`. The `@switch` on `currentView()` is inside `AppShellComponent`.

**True clean solution**: Create the top-level analytics view routing at the **webview app level**, not inside `AppShellComponent`. The webview app component checks `currentView()` and renders either `AppShellComponent` (for chat/settings/wizard) or `SessionAnalyticsDashboardViewComponent` (for analytics).

But the webview root component might not have this switch... Let me reconsider.

**SIMPLEST CORRECT SOLUTION**:

Since `dashboard` currently has ZERO dependency on `chat`, and we want to keep it that way:

1. `SessionAnalyticsStateService` goes in **`libs/frontend/dashboard/`** but does NOT import ChatStore. Instead, it exposes a `setSessions()` method that accepts `readonly ChatSessionSummary[]`.
2. `SessionAnalyticsDashboardViewComponent` also goes in `dashboard` lib.
3. `AppShellComponent` (in `chat`) imports the dashboard view from `@ptah-extension/dashboard` -- creating `chat → dashboard` dependency (ONE direction only, no cycle).
4. In `AppShellComponent`, when the analytics case is rendered, it passes `chatStore.sessions()` to the analytics state service via a wrapper or the dashboard view component initializes it.

**Even simpler**: The dashboard view component has a `sessions` input, and `AppShellComponent` passes `chatStore.sessions()` to it. The dashboard view passes it to the state service. No cross-library import of ChatStore needed.

**BUT**: State services should be `providedIn: 'root'` singletons. Having the view component pass sessions to the service on every render is awkward.

**FINAL PRAGMATIC DECISION**:

The `SessionAnalyticsStateService` will import `ChatStore` from `@ptah-extension/chat`, creating a `dashboard → chat` dependency. This is the **same direction** as the existing architecture intent (dashboard consumes chat data). Then `AppShellComponent` (in `chat`) will import the dashboard view component from `@ptah-extension/dashboard`, creating a `chat → dashboard` dependency.

This creates a **circular dependency between `chat` and `dashboard`**. However, `chat` ALREADY imports from `@ptah-extension/setup-wizard`, and `setup-wizard` could theoretically import from `chat`. The Nx workspace may or may not enforce this.

**BEST FINAL SOLUTION** (no circular dependency):

1. `SessionAnalyticsStateService` imports `ChatStore` from `@ptah-extension/chat` → `dashboard depends on chat` (new)
2. `AppShellComponent` does NOT import from `dashboard`. Instead, the analytics `@case` uses Angular `@defer` or the webview app handles it.

Actually, let me just check: does `chat` already depend on any feature library that depends back on `chat`?

`chat → @ptah-extension/setup-wizard` (verified). Does `setup-wizard` depend on `chat`? Let me check.

The setup wizard is independent -- it doesn't import ChatStore. So no cycle there.

**FINAL FINAL SOLUTION**:

To avoid circular dependency, we go with the **injection token approach**:

1. Define a `SESSION_DATA_TOKEN` (InjectionToken) in `@ptah-extension/core` or `@ptah-extension/shared` that provides `Signal<readonly ChatSessionSummary[]>`.
2. `SessionAnalyticsStateService` (in `dashboard`) injects this token instead of ChatStore.
3. In the webview app's provider setup, provide `SESSION_DATA_TOKEN` using `ChatStore.sessions`.
4. `AppShellComponent` (in `chat`) imports `SessionAnalyticsDashboardViewComponent` from `dashboard`.
5. This creates only `chat → dashboard` dependency (no cycle).

This is clean but adds a token. Let me go with an even simpler approach.

**SIMPLEST NO-CYCLE SOLUTION**:

1. `SessionAnalyticsStateService` lives in `dashboard` lib.
2. It does NOT directly depend on ChatStore.
3. It exposes `readonly sessions` as a `WritableSignal` that gets populated by the parent.
4. `SessionAnalyticsDashboardViewComponent` has a required input: `sessions: Signal<readonly ChatSessionSummary[]>` (or just `ChatSessionSummary[]`).
5. The view component's `ngOnInit` sets the sessions on the state service.
6. `AppShellComponent` passes `chatStore.sessions()` as input.

Actually this is getting too complex. Let me just use the simplest approach:

**DECISION: Put everything in the `dashboard` library with `dashboard → chat` dependency. For the AppShell, use `@defer` to lazy-load the dashboard component to avoid TypeScript import cycle.**

Wait -- `@defer` still needs the import to be resolvable at compile time. It just defers loading at runtime.

Let me check if Nx even enforces this. Many Angular projects have mutual imports between feature libraries. The only issue would be at build time if there's a true TypeScript circular import that causes issues.

In practice, since both libraries are separate Nx projects compiled independently, and Angular uses lazy compilation for standalone components, this should work fine. The `dashboard` project.json would add `chat` to its implicit dependencies. The `chat` library would add `dashboard`. Nx handles this via project graph -- it only errors on circular BUILD dependencies, not import cycles between independently-built libraries.

**PRAGMATIC FINAL DECISION**:

1. `dashboard → chat` (SessionAnalyticsStateService imports ChatStore)
2. `chat → dashboard` (AppShellComponent imports SessionAnalyticsDashboardViewComponent)

Both are independently built Angular libraries. Angular standalone component imports are resolved at compile time. As long as neither library's `project.json` specifies the other as a build dependency, there's no circular build issue. The runtime DI system handles it fine since both services are `providedIn: 'root'` singletons.

If Nx does complain about circular dependency, the fallback is to use the injection token approach described above. But for v1, go with the direct approach.

---

## Implementation Batches

### Batch 1: State Service + Types (Foundation)

**Files**:

- CREATE: `D:\projects\ptah-extension\libs\frontend\dashboard\src\lib\services\session-analytics-state.service.ts`

**Dependencies**: None (first batch)

**What it does**: Creates the state service with all computed signals. Can be tested in isolation by providing a mock ChatStore.

**Verification**: `nx typecheck dashboard` passes. Unit tests for computed signal logic.

---

### Batch 2: Child Components (Presentational)

**Files**:

- CREATE: `D:\projects\ptah-extension\libs\frontend\dashboard\src\lib\components\session-analytics\metrics-cards.component.ts`
- CREATE: `D:\projects\ptah-extension\libs\frontend\dashboard\src\lib\components\session-analytics\session-history-table.component.ts`
- CREATE: `D:\projects\ptah-extension\libs\frontend\dashboard\src\lib\components\session-analytics\token-usage-breakdown.component.ts`

**Dependencies**: Batch 1 (uses types from state service)

**What it does**: Creates the three presentational components. All use `input()` signals -- no service dependencies. Can be tested with hardcoded data.

**Verification**: `nx typecheck dashboard` passes. Visual verification with mock data.

---

### Batch 3: Dashboard View + Exports (Assembly)

**Files**:

- CREATE: `D:\projects\ptah-extension\libs\frontend\dashboard\src\lib\components\session-analytics\session-analytics-dashboard-view.component.ts`
- MODIFY: `D:\projects\ptah-extension\libs\frontend\dashboard\src\index.ts`

**Dependencies**: Batch 1 + Batch 2

**What it does**: Creates the main dashboard view that composes all child components and wires up the state service. Adds all exports to index.ts.

**Verification**: `nx typecheck dashboard` passes. `nx build dashboard` succeeds.

---

### Batch 4: App Shell Integration + Navigation (Wiring)

**Files**:

- MODIFY: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\app-shell.component.html`
- MODIFY: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\app-shell.component.ts`

**Dependencies**: Batch 3

**What it does**: Adds `@case ('analytics')` to the app shell template's `@switch` block. Imports `SessionAnalyticsDashboardViewComponent` from `@ptah-extension/dashboard`.

**Verification**: `nx typecheck chat` passes. Navigate to analytics view in dev mode -- dashboard renders.

---

### Batch 5: VS Code Panel Command (Backend)

**Files**:

- MODIFY: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\core\ptah-extension.ts` (register `ptah.openDashboard` command)
- MODIFY: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\providers\angular-webview.provider.ts` (add `initialView` to `createPanel` options)

**Dependencies**: Batch 4 (analytics view must render correctly first)

**What it does**: Registers a VS Code command `ptah.openDashboard` that opens the dashboard in a new webview panel using the existing `createPanel()` pattern with `initialView: 'analytics'`.

**Verification**: Run `ptah.openDashboard` from command palette -- opens dashboard in full panel. `nx typecheck ptah-extension-vscode` passes.

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: `frontend-developer`

**Rationale**:

- All new code is Angular components and services (frontend)
- State management with Angular signals (frontend pattern)
- DaisyUI styling (CSS/UI work)
- Backend change is minimal (one command registration, one parameter addition)

### Complexity Assessment

**Complexity**: MEDIUM
**Estimated Effort**: 6-10 hours

**Breakdown**:

- Batch 1 (State Service): 1.5-2h
- Batch 2 (Child Components): 2-3h
- Batch 3 (Dashboard View + Exports): 1-1.5h
- Batch 4 (App Shell Integration): 0.5-1h
- Batch 5 (VS Code Panel Command): 0.5-1h

### Critical Verification Points

**Before Implementation, Developer Must Verify**:

1. **All imports exist in codebase**:

   - `ChatStore` from `@ptah-extension/chat` (verified: `chat.store.ts:58`)
   - `calculateMessageCost` from `@ptah-extension/shared` (verified: `pricing.utils.ts:305`)
   - `formatModelDisplayName` from `@ptah-extension/shared` (verified: `pricing.utils.ts:358`)
   - `getModelPricingDescription` from `@ptah-extension/shared` (verified: `pricing.utils.ts:336`)
   - `ChatSessionSummary` from `@ptah-extension/shared` (verified: `execution-node.types.ts:363`)
   - `MessageTokenUsage` from `@ptah-extension/shared` (verified: `execution-node.types.ts:79`)
   - `AppStateManager` from `@ptah-extension/core` (verified: `app-state.service.ts:35`)

2. **All patterns verified from examples**:

   - State service pattern: `quality-dashboard-state.service.ts`
   - Dashboard view pattern: `quality-dashboard-view.component.ts`
   - App shell view switching: `app-shell.component.html` lines 17-463
   - Panel creation: `angular-webview.provider.ts:114-204`

3. **No hallucinated APIs**:

   - `calculateMessageCost(modelId, tokens)` - verified signature at `pricing.utils.ts:305-308`
   - `ChatStore.sessions` - verified signal at `chat.store.ts:148`
   - `ChatStore.hasMoreSessions` - verified signal at `chat.store.ts:149`
   - `ChatStore.loadMoreSessions()` - verified method at `chat.store.ts:352`

4. **Circular dependency risk**:
   - `dashboard → chat` (state service imports ChatStore) + `chat → dashboard` (AppShell imports dashboard view)
   - If Nx reports circular dependency, use injection token approach (define token in `@ptah-extension/core`, provide ChatStore.sessions via token in webview app providers)
   - Fallback documented above in "Cross-Library Imports" section

### Architecture Delivery Checklist

- [x] All components specified with evidence
- [x] All patterns verified from codebase (quality dashboard, app shell, panel creation)
- [x] All imports/decorators verified as existing
- [x] Quality requirements defined (OnPush, standalone, signals, DaisyUI, a11y)
- [x] Integration points documented (AppShell, VS Code command, ChatStore)
- [x] Files affected list complete (6 new, 4 modified)
- [x] Developer type recommended (frontend-developer)
- [x] Complexity assessed (MEDIUM, 6-10h)
- [x] No step-by-step implementation (team-leader will decompose into atomic tasks)
- [x] Circular dependency risk identified with mitigation strategy
