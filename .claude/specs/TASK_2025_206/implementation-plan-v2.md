# Implementation Plan v2 - TASK_2025_206: Dashboard Redesign with Per-Session Stats Cards

## Why v1 Failed and What v2 Fixes

**v1 Problem**: The v1 dashboard relied on `ChatStore.sessions` signal which returns `ChatSessionSummary[]` from `session:list`. But `session:list` only returns metadata from `SessionMetadataStore` -- it has `messageCount: 0` (hardcoded) and empty `tokenUsage` because `addStats()` is never called during live sessions consistently. Result: a flat table showing `--` everywhere.

**v2 Solution**: Bypass the broken metadata pipeline entirely. Instead:

1. Call `session:list` to get session IDs and names (metadata we trust: name, dates, workspace)
2. Call a NEW `session:stats-batch` RPC that reads JSONL files directly via `SessionHistoryReaderService.readSessionHistory()` to get real per-session stats (cost, tokens, model, message count)
3. Replace the flat table with rich per-session cards displaying real data

---

## Codebase Investigation Summary

### Backend Evidence

| Item                                                | Location                                                                                                     | Finding                                                                                                                                                                                                            |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `SessionHistoryReaderService.readSessionHistory()`  | `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\session-history-reader.service.ts:86-160`         | Returns `{ events, stats }` where stats has `totalCost`, `tokens: { input, output, cacheRead, cacheCreation }`, `messageCount`, `model`                                                                            |
| `SessionHistoryReaderService.aggregateUsageStats()` | Same file, lines 271-363                                                                                     | Private method. Aggregates main + agent session stats. Uses `extractTokenUsage()` and `calculateMessageCost()` with `resolveActualModelForPricing()`                                                               |
| `SDK_TOKENS.SDK_SESSION_HISTORY_READER`             | `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\di\tokens.ts:35`                                  | DI token for injecting `SessionHistoryReaderService`                                                                                                                                                               |
| `SessionRpcHandlers`                                | `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\session-rpc.handlers.ts`              | Existing handler class. Injects `TOKENS.LOGGER`, `TOKENS.RPC_HANDLER`, `SDK_TOKENS.SDK_SESSION_METADATA_STORE`. Has `register()` method that registers all session methods                                         |
| `chat-rpc.handlers.ts` readSessionHistory pattern   | `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\chat-rpc.handlers.ts:79-80,1061-1064` | Shows injection via `@inject(SDK_TOKENS.SDK_SESSION_HISTORY_READER) private readonly historyReader: SessionHistoryReaderService` and usage `await this.historyReader.readSessionHistory(sessionId, workspacePath)` |
| `RpcMethodRegistry`                                 | `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc.types.ts:1585`                                     | Interface mapping method names to `{ params, result }` types. New methods MUST be added here                                                                                                                       |
| `RPC_METHOD_NAMES`                                  | Same file, line 2034                                                                                         | Array of all method names. New methods MUST be added here too                                                                                                                                                      |
| `SessionMetadataStore.getForWorkspace()`            | `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\session-metadata-store.ts:168-179`                | Returns `SessionMetadata[]` sorted by `lastActiveAt` desc. Each has `sessionId`, `name`, `workspaceId`, `createdAt`, `lastActiveAt`                                                                                |
| `formatModelDisplayName()`                          | `D:\projects\ptah-extension\libs\shared\src\lib\utils\pricing.utils.ts:385-469`                              | Converts model IDs to display names (e.g., `"claude-sonnet-4-20250514"` -> `"Sonnet 4"`)                                                                                                                           |

### Frontend Evidence

| Item                           | Location                                                                                                                | Finding                                                                                                                                                                                                                                                                                                               |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ClaudeRpcService.call()`      | `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\claude-rpc.service.ts:166-170`                          | `call<T extends RpcMethodName>(method: T, params: RpcMethodParams<T>): Promise<RpcResult<RpcMethodResult<T>>>` -- fully type-safe against `RpcMethodRegistry`                                                                                                                                                         |
| `ISessionDataProvider`         | `D:\projects\ptah-extension\libs\frontend\core\src\lib\tokens\session-data.token.ts`                                    | Interface with `sessions`, `hasMoreSessions`, `isLoadingMoreSessions` signals + `loadSessions()`, `loadMoreSessions()` methods                                                                                                                                                                                        |
| `SessionAnalyticsStateService` | `D:\projects\ptah-extension\libs\frontend\dashboard\src\lib\services\session-analytics-state.service.ts`                | Current v1 service. Injects `SESSION_DATA_PROVIDER`, computes cost from tokens using default pricing. All signals will be redesigned                                                                                                                                                                                  |
| `SessionStatsSummaryComponent` | `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\session\session-stats-summary.component.ts` | **Design reference**. Shows: Model card (purple border), Context card (cyan border), Tokens card, Cost card (success/green border), Duration, Agents (info/blue border). Uses `text-[10px] uppercase tracking-wider text-base-content/50` for labels, `bg-base-200/50 rounded px-2 py-1.5 border border-X/20` pattern |
| `MetricsCardsComponent`        | `D:\projects\ptah-extension\libs\frontend\dashboard\src\lib\components\session-analytics\metrics-cards.component.ts`    | Current aggregate metrics. Uses same design system: `border-success/20` for cost, `border-cyan-600/20` for input, `border-purple-600/20` for output, `border-info/20` for sessions                                                                                                                                    |
| `format.utils.ts`              | `D:\projects\ptah-extension\libs\frontend\dashboard\src\lib\utils\format.utils.ts`                                      | `formatCost()` and `formatTokenCount()` -- reuse these                                                                                                                                                                                                                                                                |
| Dashboard index.ts             | `D:\projects\ptah-extension\libs\frontend\dashboard\src\index.ts`                                                       | Current exports include all session analytics components and service                                                                                                                                                                                                                                                  |
| `AppStateManager`              | From `@ptah-extension/core`                                                                                             | `setCurrentView('analytics')` navigates to dashboard. `ViewType` includes `'analytics'`                                                                                                                                                                                                                               |

### Design System Evidence (from `session-stats-summary.component.ts`)

```
Cards: bg-base-200/50 rounded px-2 py-1.5 border border-{color}/20
Labels: text-[10px] uppercase tracking-wider text-base-content/50 leading-tight
Values: text-sm font-semibold tabular-nums leading-tight mt-0.5
Colors:
  - Model: border-purple-600/20, text-purple-400
  - Context/Input: border-cyan-600/20, text-cyan-400
  - Cost: border-success/20, text-success
  - Agents: border-info/20, text-info
  - Output: border-purple-600/20 (reuse)
  - Neutral: border-base-content/10
```

---

## Architecture Overview

```
                        Frontend                                    Backend
                        ─────────                                   ────────

            SessionAnalyticsDashboardViewComponent
                          │
                SessionAnalyticsStateService (v2)
                     │              │
          ┌──────────┘              └────────────┐
          │                                      │
  ClaudeRpcService                     ClaudeRpcService
  .call('session:list',...)            .call('session:stats-batch',...)
          │                                      │
          ▼                                      ▼
  ┌─────────────────┐               ┌──────────────────────┐
  │ session:list    │               │ session:stats-batch   │
  │ (existing)      │               │ (NEW RPC method)      │
  │                 │               │                       │
  │ Returns:        │               │ Params:               │
  │ - sessionId     │               │ - sessionIds[]        │
  │ - name          │               │ - workspacePath       │
  │ - createdAt     │               │                       │
  │ - lastActiveAt  │               │ Returns per session:  │
  └────────┬────────┘               │ - totalCost           │
           │                        │ - tokens (in/out/     │
           │                        │   cacheRead/Creation) │
           │                        │ - messageCount        │
           │                        │ - model               │
           │                        └───────────┬───────────┘
           │                                    │
           │                         SessionHistoryReaderService
           │                         .readSessionHistory(id, path)
           │                                    │
           │                         ~/.claude/projects/*.jsonl
           │                                    │
           └───────────┬────────────────────────┘
                       │
                       ▼
             Merged into signal:
             SessionStatsEntry[] (id, name, dates, model, cost, tokens, msgs)
                       │
          ┌────────────┼─────────────────┐
          │            │                 │
          ▼            ▼                 ▼
  AggregateCards   SessionStatsCards  Show5/10Toggle
  (top summary)    (per-session)      (display count)
```

---

## Data Flow (Step by Step)

1. **Dashboard opens** -> `SessionAnalyticsDashboardViewComponent.ngOnInit()` calls `state.loadDashboardData()`
2. **State service** calls `ClaudeRpcService.call('session:list', { workspacePath, limit: 30 })` to get session metadata
3. **State service** takes the first N session IDs (N = displayCount signal, default 5)
4. **State service** calls `ClaudeRpcService.call('session:stats-batch', { sessionIds, workspacePath })` with those IDs
5. **Backend handler** iterates session IDs, calls `readSessionHistory(id, workspace)` for each, returns `{ sessionStats: [...] }`
6. **State service** merges metadata (name, dates) with stats (cost, tokens, model, messageCount) into `SessionStatsEntry[]`
7. **Computed signals** derive: aggregate totals, display list, sorted order
8. **UI renders**: Aggregate summary cards at top, then per-session stat cards, then Show 5/10 toggle

---

## RPC Type Definitions (Exact TypeScript)

### New types to add in `rpc.types.ts`

```typescript
// ============================================================
// Session Stats Batch RPC Types (TASK_2025_206 v2)
// ============================================================

/** Per-session stats returned from JSONL reading */
export interface SessionStatsEntry {
  /** Session ID */
  readonly sessionId: string;
  /** Detected model from JSONL init message */
  readonly model: string | null;
  /** Total cost in USD (calculated with model-aware pricing) */
  readonly totalCost: number;
  /** Token breakdown */
  readonly tokens: {
    readonly input: number;
    readonly output: number;
    readonly cacheRead: number;
    readonly cacheCreation: number;
  };
  /** Number of assistant messages */
  readonly messageCount: number;
}

/** Parameters for session:stats-batch RPC method */
export interface SessionStatsBatchParams {
  /** Session IDs to fetch stats for */
  readonly sessionIds: string[];
  /** Workspace path (for locating JSONL files) */
  readonly workspacePath: string;
}

/** Response from session:stats-batch RPC method */
export interface SessionStatsBatchResult {
  /** Stats for each requested session (order matches sessionIds) */
  readonly sessionStats: SessionStatsEntry[];
}
```

### Add to `RpcMethodRegistry` (line ~1610 area, after `session:cli-sessions`)

```typescript
'session:stats-batch': {
  params: SessionStatsBatchParams;
  result: SessionStatsBatchResult;
};
```

### Add to `RPC_METHOD_NAMES` array (line ~2047 area, after `'session:cli-sessions'`)

```typescript
'session:stats-batch',
```

---

## Backend Handler Design

### Modify: `SessionRpcHandlers` in `session-rpc.handlers.ts`

**New injection**: Add `SessionHistoryReaderService` to the constructor.

```typescript
// Add import at top:
import { SessionMetadataStore, SDK_TOKENS, SessionHistoryReaderService } from '@ptah-extension/agent-sdk';
import { SessionStatsBatchParams, SessionStatsBatchResult, SessionStatsEntry } from '@ptah-extension/shared';

// Add to constructor:
@inject(SDK_TOKENS.SDK_SESSION_HISTORY_READER)
private readonly historyReader: SessionHistoryReaderService

// Add to register() method:
this.registerSessionStatsBatch();

// Add to logger methods list:
'session:stats-batch' in the debug log
```

**New method**: `registerSessionStatsBatch()`

```typescript
/**
 * session:stats-batch - Batch fetch real stats for multiple sessions from JSONL files
 *
 * Reads JSONL files via SessionHistoryReaderService to get accurate per-session
 * stats (cost, tokens, model, message count). This bypasses the broken metadata
 * pipeline (addStats never called) and reads directly from source of truth.
 *
 * TASK_2025_206 v2: Dashboard redesign with per-session stats cards
 */
private registerSessionStatsBatch(): void {
  this.rpcHandler.registerMethod<SessionStatsBatchParams, SessionStatsBatchResult>(
    'session:stats-batch',
    async (params: SessionStatsBatchParams) => {
      try {
        const { sessionIds, workspacePath } = params;
        this.logger.debug('RPC: session:stats-batch called', {
          sessionCount: sessionIds.length,
          workspacePath,
        });

        const sessionStats: SessionStatsEntry[] = [];

        // Process sessions sequentially to avoid overwhelming file system
        for (const sessionId of sessionIds) {
          try {
            const { stats } = await this.historyReader.readSessionHistory(
              sessionId,
              workspacePath
            );

            sessionStats.push({
              sessionId,
              model: stats?.model ?? null,
              totalCost: stats?.totalCost ?? 0,
              tokens: stats?.tokens ?? { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
              messageCount: stats?.messageCount ?? 0,
            });
          } catch (error) {
            // Individual session failure should not break the batch
            this.logger.warn('RPC: session:stats-batch - failed for session', {
              sessionId,
              error: error instanceof Error ? error.message : String(error),
            });
            sessionStats.push({
              sessionId,
              model: null,
              totalCost: 0,
              tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
              messageCount: 0,
            });
          }
        }

        this.logger.debug('RPC: session:stats-batch completed', {
          sessionCount: sessionIds.length,
          successCount: sessionStats.filter(s => s.totalCost > 0 || s.messageCount > 0).length,
        });

        return { sessionStats };
      } catch (error) {
        this.logger.error(
          'RPC: session:stats-batch failed',
          error instanceof Error ? error : new Error(String(error))
        );
        throw new Error(
          `Failed to fetch session stats batch: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
  );
}
```

**Design decisions**:

- Sequential processing (not `Promise.all`) to avoid file system thrashing when reading 5-10 JSONL files
- Individual session failures return zero stats rather than failing the whole batch
- Uses the same `readSessionHistory()` method that `chat:resume` uses (proven, tested)
- `readSessionHistory()` already handles path resolution, JSONL parsing, agent session aggregation, and model-aware cost calculation

---

## State Service Redesign

### Rewrite: `SessionAnalyticsStateService`

The v1 service relied on `ISessionDataProvider` (ChatStore) which had broken data. The v2 service makes its own RPC calls directly.

```typescript
import { Injectable, signal, computed, inject } from '@angular/core';
import { ClaudeRpcService } from '@ptah-extension/core';
import { AppStateManager } from '@ptah-extension/core';
import { SessionStatsEntry, SessionStatsBatchResult, SessionListResult, ChatSessionSummary, formatModelDisplayName } from '@ptah-extension/shared';

/**
 * Merged session data: metadata from session:list + stats from session:stats-batch
 */
export interface DashboardSessionEntry {
  readonly sessionId: string;
  readonly name: string;
  readonly createdAt: number;
  readonly lastActivityAt: number;
  readonly model: string | null;
  readonly modelDisplayName: string;
  readonly totalCost: number;
  readonly tokens: {
    readonly input: number;
    readonly output: number;
    readonly cacheRead: number;
    readonly cacheCreation: number;
  };
  readonly messageCount: number;
}

/**
 * Aggregate totals computed from displayed sessions
 */
export interface AggregateTotals {
  readonly totalCost: number;
  readonly totalTokens: number;
  readonly totalInput: number;
  readonly totalOutput: number;
  readonly totalCacheRead: number;
  readonly totalCacheCreation: number;
  readonly totalMessages: number;
  readonly sessionCount: number;
}

@Injectable({ providedIn: 'root' })
export class SessionAnalyticsStateService {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly appState = inject(AppStateManager);

  // ── Private writable signals ──
  private readonly _allSessions = signal<DashboardSessionEntry[]>([]);
  private readonly _displayCount = signal<5 | 10>(5);
  private readonly _isLoading = signal(false);
  private readonly _loadError = signal<string | null>(null);

  // ── Public readonly signals ──
  readonly isLoading = this._isLoading.asReadonly();
  readonly loadError = this._loadError.asReadonly();
  readonly displayCount = this._displayCount.asReadonly();

  /** All sessions with stats loaded */
  readonly allSessions = this._allSessions.asReadonly();

  /** Sessions to display (sliced by displayCount) */
  readonly displayedSessions = computed(() => {
    return this._allSessions().slice(0, this._displayCount());
  });

  /** Whether there are more sessions than currently displayed */
  readonly hasMoreToShow = computed(() => {
    return this._allSessions().length > this._displayCount();
  });

  /** Aggregate totals across displayed sessions */
  readonly aggregates = computed<AggregateTotals>(() => {
    const sessions = this.displayedSessions();
    let totalCost = 0,
      totalInput = 0,
      totalOutput = 0;
    let totalCacheRead = 0,
      totalCacheCreation = 0,
      totalMessages = 0;

    for (const s of sessions) {
      totalCost += s.totalCost;
      totalInput += s.tokens.input;
      totalOutput += s.tokens.output;
      totalCacheRead += s.tokens.cacheRead;
      totalCacheCreation += s.tokens.cacheCreation;
      totalMessages += s.messageCount;
    }

    return {
      totalCost,
      totalTokens: totalInput + totalOutput + totalCacheRead + totalCacheCreation,
      totalInput,
      totalOutput,
      totalCacheRead,
      totalCacheCreation,
      totalMessages,
      sessionCount: sessions.length,
    };
  });

  // ── Actions ──

  /** Toggle between showing 5 and 10 sessions */
  setDisplayCount(count: 5 | 10): void {
    this._displayCount.set(count);
  }

  /**
   * Load dashboard data: session list + batch stats
   * Called on dashboard mount.
   */
  async loadDashboardData(): Promise<void> {
    if (this._isLoading()) return;

    this._isLoading.set(true);
    this._loadError.set(null);

    try {
      const workspacePath = this.appState.workspaceInfo()?.path || '';

      // Step 1: Get session list (metadata: ids, names, dates)
      const listResult = await this.rpc.call('session:list', {
        workspacePath,
        limit: 30, // Get enough sessions for Show 5/10 toggle
        offset: 0,
      });

      if (!listResult.isSuccess() || !listResult.data) {
        throw new Error(listResult.error || 'Failed to load session list');
      }

      const sessionList = listResult.data.sessions;
      if (sessionList.length === 0) {
        this._allSessions.set([]);
        return;
      }

      // Step 2: Get real stats for all sessions from JSONL files
      const sessionIds = sessionList.map((s) => s.id);
      const statsResult = await this.rpc.call('session:stats-batch', {
        sessionIds,
        workspacePath,
      });

      if (!statsResult.isSuccess() || !statsResult.data) {
        throw new Error(statsResult.error || 'Failed to load session stats');
      }

      // Step 3: Merge metadata + stats
      const statsMap = new Map<string, SessionStatsEntry>();
      for (const stat of statsResult.data.sessionStats) {
        statsMap.set(stat.sessionId, stat);
      }

      const merged: DashboardSessionEntry[] = sessionList.map((session) => {
        const stats = statsMap.get(session.id);
        return {
          sessionId: session.id,
          name: session.name,
          createdAt: session.createdAt,
          lastActivityAt: session.lastActivityAt,
          model: stats?.model ?? null,
          modelDisplayName: stats?.model ? formatModelDisplayName(stats.model) : 'Unknown',
          totalCost: stats?.totalCost ?? 0,
          tokens: stats?.tokens ?? { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
          messageCount: stats?.messageCount ?? 0,
        };
      });

      this._allSessions.set(merged);
    } catch (err) {
      this._loadError.set(err instanceof Error ? err.message : 'Failed to load dashboard data');
    } finally {
      this._isLoading.set(false);
    }
  }
}
```

**Key changes from v1**:

- No longer depends on `ISessionDataProvider` / `SESSION_DATA_PROVIDER` / ChatStore
- Makes its own `session:list` + `session:stats-batch` RPC calls via `ClaudeRpcService`
- `DashboardSessionEntry` is a merged type with both metadata and real stats
- No sort logic (sessions come pre-sorted by `lastActiveAt` desc from `getForWorkspace()`)
- Simple 5/10 toggle instead of pagination

---

## Component Designs

### 1. `SessionStatsCardComponent` (NEW)

Per-session card with model badge, cost, token breakdown, message count.

**File**: `D:\projects\ptah-extension\libs\frontend\dashboard\src\lib\components\session-analytics\session-stats-card.component.ts`

```typescript
@Component({
  selector: 'ptah-session-stats-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [],
  template: `
    <div class="bg-base-200/50 rounded-lg p-3 border border-base-300 space-y-2">
      <!-- Header: Name + Model Badge + Date -->
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0 flex-1">
          <div class="text-sm font-semibold truncate" [title]="session().name">
            {{ session().name }}
          </div>
          <div class="text-[10px] text-base-content/50 mt-0.5">
            {{ formatDate(session().lastActivityAt) }}
          </div>
        </div>
        @if (session().model) {
        <span class="badge badge-sm border-purple-600/30 text-purple-400 bg-purple-600/10 whitespace-nowrap">
          {{ session().modelDisplayName }}
        </span>
        }
      </div>

      <!-- Stats Grid: 2x2 mini cards -->
      <div class="grid grid-cols-2 gap-1.5">
        <!-- Cost -->
        <div class="bg-base-300/30 rounded px-2 py-1.5 border border-success/20">
          <div class="text-[10px] uppercase tracking-wider text-base-content/50 leading-tight">Cost</div>
          <div class="text-sm font-semibold text-success tabular-nums leading-tight mt-0.5">
            {{ formatCost(session().totalCost) }}
          </div>
        </div>

        <!-- Messages -->
        <div class="bg-base-300/30 rounded px-2 py-1.5 border border-info/20">
          <div class="text-[10px] uppercase tracking-wider text-base-content/50 leading-tight">Messages</div>
          <div class="text-sm font-semibold text-info tabular-nums leading-tight mt-0.5">
            {{ session().messageCount }}
          </div>
        </div>

        <!-- Input Tokens -->
        <div class="bg-base-300/30 rounded px-2 py-1.5 border border-cyan-600/20">
          <div class="text-[10px] uppercase tracking-wider text-base-content/50 leading-tight">Input</div>
          <div class="text-sm font-semibold text-cyan-400 tabular-nums leading-tight mt-0.5">
            {{ formatTokenCount(session().tokens.input) }}
          </div>
        </div>

        <!-- Output Tokens -->
        <div class="bg-base-300/30 rounded px-2 py-1.5 border border-purple-600/20">
          <div class="text-[10px] uppercase tracking-wider text-base-content/50 leading-tight">Output</div>
          <div class="text-sm font-semibold text-purple-400 tabular-nums leading-tight mt-0.5">
            {{ formatTokenCount(session().tokens.output) }}
          </div>
        </div>
      </div>

      <!-- Cache stats row (conditional - only show if cache > 0) -->
      @if (session().tokens.cacheRead > 0 || session().tokens.cacheCreation > 0) {
      <div class="flex gap-3 text-[10px] text-base-content/50 px-1">
        @if (session().tokens.cacheRead > 0) {
        <span
          >Cache Read: <span class="text-base-content/70 tabular-nums">{{ formatTokenCount(session().tokens.cacheRead) }}</span></span
        >
        } @if (session().tokens.cacheCreation > 0) {
        <span
          >Cache Write: <span class="text-base-content/70 tabular-nums">{{ formatTokenCount(session().tokens.cacheCreation) }}</span></span
        >
        }
      </div>
      }
    </div>
  `,
})
export class SessionStatsCardComponent {
  readonly session = input.required<DashboardSessionEntry>();

  readonly formatCost = formatCost;
  readonly formatTokenCount = formatTokenCount;

  formatDate(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }
}
```

### 2. `AggregateMetricsComponent` (REWRITE of MetricsCardsComponent)

Aggregate summary cards at the top of the dashboard.

**File**: `D:\projects\ptah-extension\libs\frontend\dashboard\src\lib\components\session-analytics\metrics-cards.component.ts` (REWRITE)

```typescript
@Component({
  selector: 'ptah-session-metrics-cards',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3" role="region" aria-label="Aggregate session metrics">
      <!-- Total Cost -->
      <div class="bg-base-200/50 rounded-lg px-3 py-2.5 border border-success/20">
        <div class="text-[10px] uppercase tracking-wider text-base-content/50 mb-1">Total Cost</div>
        <div class="text-lg font-semibold text-success tabular-nums">
          {{ formatCost(aggregates().totalCost) }}
        </div>
      </div>

      <!-- Total Tokens -->
      <div class="bg-base-200/50 rounded-lg px-3 py-2.5 border border-cyan-600/20">
        <div class="text-[10px] uppercase tracking-wider text-base-content/50 mb-1">Total Tokens</div>
        <div class="text-lg font-semibold text-cyan-400 tabular-nums">
          {{ formatTokenCount(aggregates().totalTokens) }}
        </div>
      </div>

      <!-- Total Messages -->
      <div class="bg-base-200/50 rounded-lg px-3 py-2.5 border border-info/20">
        <div class="text-[10px] uppercase tracking-wider text-base-content/50 mb-1">Messages</div>
        <div class="text-lg font-semibold text-info tabular-nums">
          {{ aggregates().totalMessages }}
        </div>
      </div>

      <!-- Sessions Shown -->
      <div class="bg-base-200/50 rounded-lg px-3 py-2.5 border border-purple-600/20">
        <div class="text-[10px] uppercase tracking-wider text-base-content/50 mb-1">Sessions</div>
        <div class="text-lg font-semibold text-purple-400 tabular-nums">
          {{ aggregates().sessionCount }}
        </div>
      </div>
    </div>
  `,
})
export class MetricsCardsComponent {
  readonly aggregates = input.required<AggregateTotals>();

  readonly formatCost = formatCost;
  readonly formatTokenCount = formatTokenCount;
}
```

### 3. `SessionAnalyticsDashboardViewComponent` (REWRITE)

Main layout component. Composes aggregate cards + session card grid + display toggle.

**File**: `D:\projects\ptah-extension\libs\frontend\dashboard\src\lib\components\session-analytics\session-analytics-dashboard-view.component.ts` (REWRITE)

```typescript
@Component({
  selector: 'ptah-session-analytics-dashboard',
  standalone: true,
  imports: [MetricsCardsComponent, SessionStatsCardComponent, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="bg-base-100 min-h-full p-4 space-y-6">
      <!-- Header -->
      <div class="flex justify-between items-center">
        <div class="flex items-center gap-3">
          <h2 class="text-xl font-bold">Session Analytics</h2>
          <span class="badge badge-outline badge-sm gap-1 text-[10px] text-base-content/50 border-base-content/20"> Real costs from JSONL </span>
        </div>
        <button class="btn btn-sm btn-ghost gap-1" (click)="navigateBack()" aria-label="Back to chat">
          <lucide-angular [img]="ArrowLeftIcon" class="w-4 h-4" aria-hidden="true"></lucide-angular>
          Back
        </button>
      </div>

      @if (isLoading()) {
      <!-- Loading state -->
      <div class="flex flex-col items-center justify-center p-12" aria-label="Loading session analytics">
        <span class="loading loading-spinner loading-lg"></span>
        <p class="text-sm text-base-content/50 mt-4">Reading session history...</p>
      </div>
      } @else if (loadError()) {
      <!-- Error state -->
      <div class="alert alert-error" role="alert">
        <span>{{ loadError() }}</span>
        <button class="btn btn-sm" (click)="retry()" aria-label="Retry loading sessions">Retry</button>
      </div>
      } @else if (displayedSessions().length === 0) {
      <!-- Empty state -->
      <div class="flex flex-col items-center justify-center p-12 text-base-content/50">
        <lucide-angular [img]="ChartColumnIcon" class="w-12 h-12 mb-4" aria-hidden="true"></lucide-angular>
        <p class="text-sm">No sessions found. Start a chat to see analytics.</p>
      </div>
      } @else {
      <!-- Aggregate Metrics Cards -->
      <ptah-session-metrics-cards [aggregates]="aggregates()" />

      <!-- Display Count Toggle -->
      <div class="flex items-center gap-2">
        <span class="text-xs text-base-content/50">Show:</span>
        <div class="join">
          <button class="join-item btn btn-xs" [class.btn-active]="displayCount() === 5" (click)="setDisplayCount(5)">5</button>
          <button class="join-item btn btn-xs" [class.btn-active]="displayCount() === 10" (click)="setDisplayCount(10)">10</button>
        </div>
        <span class="text-[10px] text-base-content/40"> of {{ allSessionCount() }} sessions </span>
      </div>

      <!-- Session Stats Cards Grid -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        @for (session of displayedSessions(); track session.sessionId) {
        <ptah-session-stats-card [session]="session" />
        }
      </div>
      }
    </div>
  `,
})
export class SessionAnalyticsDashboardViewComponent implements OnInit {
  private readonly analyticsState = inject(SessionAnalyticsStateService);
  private readonly appState = inject(AppStateManager);

  readonly ChartColumnIcon = ChartColumn;
  readonly ArrowLeftIcon = ArrowLeft;

  readonly isLoading = this.analyticsState.isLoading;
  readonly loadError = this.analyticsState.loadError;
  readonly displayedSessions = this.analyticsState.displayedSessions;
  readonly aggregates = this.analyticsState.aggregates;
  readonly displayCount = this.analyticsState.displayCount;
  readonly allSessionCount = computed(() => this.analyticsState.allSessions().length);

  ngOnInit(): void {
    this.analyticsState.loadDashboardData();
  }

  navigateBack(): void {
    this.appState.setCurrentView('chat');
  }

  retry(): void {
    this.analyticsState.loadDashboardData();
  }

  setDisplayCount(count: 5 | 10): void {
    this.analyticsState.setDisplayCount(count);
  }
}
```

---

## Complete File List

### New Files (CREATE)

| #   | File Path                                                                                                                 | Purpose                          |
| --- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| 1   | `D:\projects\ptah-extension\libs\frontend\dashboard\src\lib\components\session-analytics\session-stats-card.component.ts` | Per-session stats card component |

### Modified Files (MODIFY)

| #   | File Path                                                                                                                               | Change                                                                                                                                          |
| --- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 2   | `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc.types.ts`                                                                     | Add `SessionStatsEntry`, `SessionStatsBatchParams`, `SessionStatsBatchResult` interfaces; add to `RpcMethodRegistry`; add to `RPC_METHOD_NAMES` |
| 3   | `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\session-rpc.handlers.ts`                                         | Inject `SessionHistoryReaderService` via `SDK_TOKENS.SDK_SESSION_HISTORY_READER`; add `registerSessionStatsBatch()` method; add to `register()` |
| 4   | `D:\projects\ptah-extension\libs\frontend\dashboard\src\lib\services\session-analytics-state.service.ts`                                | Full rewrite: remove `ISessionDataProvider` dependency, add `ClaudeRpcService` calls, new `DashboardSessionEntry` type, new signal structure    |
| 5   | `D:\projects\ptah-extension\libs\frontend\dashboard\src\lib\components\session-analytics\session-analytics-dashboard-view.component.ts` | Rewrite template: remove table, add card grid, add 5/10 toggle, new aggregate cards binding                                                     |
| 6   | `D:\projects\ptah-extension\libs\frontend\dashboard\src\lib\components\session-analytics\metrics-cards.component.ts`                    | Rewrite: accept `AggregateTotals` input instead of individual values; simplify to 4 cards                                                       |
| 7   | `D:\projects\ptah-extension\libs\frontend\dashboard\src\index.ts`                                                                       | Add export for `SessionStatsCardComponent`; update type exports for new interfaces                                                              |

### Deleted Files (REMOVE)

| #   | File Path                                                                                                                    | Reason                                                                                  |
| --- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 8   | `D:\projects\ptah-extension\libs\frontend\dashboard\src\lib\components\session-analytics\session-history-table.component.ts` | Replaced by card-based layout                                                           |
| 9   | `D:\projects\ptah-extension\libs\frontend\dashboard\src\lib\components\session-analytics\token-usage-breakdown.component.ts` | Token info now integrated into per-session cards; aggregate no longer needed separately |

---

## Implementation Batches (Ordered with Dependencies)

### Batch 1: Backend Types and RPC Handler (no frontend dependencies)

**Files**: #2, #3

1. **Add RPC types to `rpc.types.ts`** (#2)

   - Add `SessionStatsEntry`, `SessionStatsBatchParams`, `SessionStatsBatchResult` interfaces
   - Add `'session:stats-batch'` entry to `RpcMethodRegistry`
   - Add `'session:stats-batch'` to `RPC_METHOD_NAMES` array
   - Add exports if needed (check if rpc.types.ts re-exports from index)

2. **Add handler to `session-rpc.handlers.ts`** (#3)
   - Import `SessionHistoryReaderService` and `SDK_TOKENS`
   - Import new RPC types from `@ptah-extension/shared`
   - Add `@inject(SDK_TOKENS.SDK_SESSION_HISTORY_READER) private readonly historyReader: SessionHistoryReaderService` to constructor
   - Add `this.registerSessionStatsBatch()` to `register()` method
   - Add `'session:stats-batch'` to the debug log array
   - Implement `registerSessionStatsBatch()` private method

**Verification**: Run `nx typecheck rpc-handlers` and `nx typecheck shared`

### Batch 2: Frontend State Service Rewrite (depends on Batch 1)

**Files**: #4

1. **Rewrite `session-analytics-state.service.ts`** (#4)
   - Remove `ISessionDataProvider` / `SESSION_DATA_PROVIDER` injection
   - Add `ClaudeRpcService` and `AppStateManager` injection
   - Define `DashboardSessionEntry` and `AggregateTotals` interfaces
   - Implement `_allSessions`, `_displayCount`, `_isLoading`, `_loadError` signals
   - Implement `displayedSessions`, `aggregates` computed signals
   - Implement `loadDashboardData()` method (session:list + session:stats-batch)
   - Implement `setDisplayCount()` method
   - Remove all sort-related code (v1 legacy)

**Verification**: Run `nx typecheck dashboard`

### Batch 3: Frontend Component Rewrite (depends on Batch 2)

**Files**: #1, #5, #6, #7, #8, #9

1. **Create `session-stats-card.component.ts`** (#1)

   - New standalone component with `DashboardSessionEntry` input
   - Design matches `session-stats-summary.component.ts` style system

2. **Rewrite `metrics-cards.component.ts`** (#6)

   - Accept `AggregateTotals` input instead of 5 individual values
   - Simplify to 4 cards: Total Cost, Total Tokens, Messages, Sessions

3. **Rewrite `session-analytics-dashboard-view.component.ts`** (#5)

   - Remove `SessionHistoryTableComponent` and `TokenUsageBreakdownComponent` imports
   - Add `SessionStatsCardComponent` import
   - Replace table template with card grid + 5/10 toggle
   - Wire new signals from state service

4. **Delete `session-history-table.component.ts`** (#8)

5. **Delete `token-usage-breakdown.component.ts`** (#9)

6. **Update `index.ts`** (#7)
   - Add `SessionStatsCardComponent` export
   - Remove `SessionHistoryTableComponent` and `TokenUsageBreakdownComponent` exports
   - Update type exports: remove `SortField`, `SessionWithCost`; add `DashboardSessionEntry`, `AggregateTotals`

**Verification**: Run `nx typecheck dashboard` and `nx build ptah-extension-webview`

---

## Critical Verification Points

### Before Implementation, Developer Must Verify:

1. **All imports exist in codebase**:

   - `SessionHistoryReaderService` from `@ptah-extension/agent-sdk` (verified: `session-history-reader.service.ts`)
   - `SDK_TOKENS.SDK_SESSION_HISTORY_READER` (verified: `di/tokens.ts:35`)
   - `ClaudeRpcService` from `@ptah-extension/core` (verified: `claude-rpc.service.ts`)
   - `formatModelDisplayName` from `@ptah-extension/shared` (verified: `pricing.utils.ts:385`)
   - `formatCost`, `formatTokenCount` from `../../utils/format.utils` (verified: `format.utils.ts`)

2. **RPC pattern matches existing code**:

   - `rpcHandler.registerMethod<Params, Result>('method:name', async (params) => {...})` (verified in `session-rpc.handlers.ts:70`)
   - `RpcMethodRegistry` entry format: `'method:name': { params: Type; result: Type }` (verified at line 1585)
   - `RPC_METHOD_NAMES` array entry (verified at line 2034)

3. **`readSessionHistory()` return type matches design**:

   - Returns `{ events, stats }` where `stats` is `{ totalCost, tokens: { input, output, cacheRead, cacheCreation }, messageCount, model } | null` (verified at line 86-101)

4. **No hallucinated APIs**:

   - All decorators: `@injectable()`, `@inject()` from tsyringe (backend) or `@Injectable()`, `inject()` from Angular (frontend) -- standard patterns used throughout codebase
   - `input.required<T>()` from `@angular/core` -- used in `metrics-cards.component.ts`, `session-history-table.component.ts`
   - `computed()`, `signal()` from `@angular/core` -- used throughout frontend

5. **Check who imports deleted components**:
   - `SessionHistoryTableComponent` -- only imported by `session-analytics-dashboard-view.component.ts` and `index.ts`
   - `TokenUsageBreakdownComponent` -- only imported by `session-analytics-dashboard-view.component.ts` and `index.ts`
   - Neither is used outside the dashboard library

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: Both frontend-developer and backend-developer (or a full-stack developer)

**Rationale**:

- Batch 1 is pure backend (NestJS/tsyringe DI, TypeScript types, RPC handler)
- Batch 2-3 are pure frontend (Angular signals, components, templates)
- The two sides are cleanly separated by the RPC interface

### Complexity Assessment

**Complexity**: MEDIUM
**Estimated Effort**: 3-5 hours

**Breakdown**:

- Batch 1 (Backend types + handler): ~1 hour
- Batch 2 (State service rewrite): ~1 hour
- Batch 3 (Component rewrite): ~1.5 hours
- Testing and verification: ~0.5-1 hour

### Architecture Delivery Checklist

- [x] All components specified with evidence
- [x] All patterns verified from codebase
- [x] All imports/decorators verified as existing
- [x] Quality requirements defined (signal-based, OnPush, DaisyUI design system)
- [x] Integration points documented (RPC boundary, DI tokens)
- [x] Files affected list complete (2 create, 5 modify, 2 delete)
- [x] Developer type recommended
- [x] Complexity assessed
- [x] No step-by-step implementation code (architecture + patterns only)
- [x] Exact TypeScript for RPC types provided (contract is critical)
