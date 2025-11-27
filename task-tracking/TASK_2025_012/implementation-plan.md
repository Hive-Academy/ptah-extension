# TASK_2025_012 - Implementation Plan

## Overview

This implementation plan provides technical architecture and sequencing for completing 11 sub-tasks across 6 batches. All batches are independent except Batch 6, which has the highest complexity and criticality.

**Total Estimated Effort**: 15-21 hours
**Complexity Level**: Medium (5 batches) to High (Batch 6)
**Risk Level**: Low (most batches) to Medium (Batch 6 - architectural bridge pattern)

---

## Batch Sequencing Strategy

### Recommended Execution Order

1. **Batch 1** (Angular Modernization) - 2 hours - LOW RISK
2. **Batch 2** (Code Consolidation) - 2-3 hours - LOW RISK
3. **Batch 4** (Provider Integration) - 2-3 hours - LOW RISK
4. **Batch 5** (Analytics Integration) - 2-3 hours - LOW RISK
5. **Batch 3** (State Restoration) - 3-4 hours - MEDIUM RISK (depends on EventBus)
6. **Batch 6** (Workspace Intelligence) - 4-6 hours - **HIGH PRIORITY + MEDIUM RISK**

**Rationale**:

- Batches 1-2 are isolated refactoring (no cross-component dependencies)
- Batches 4-5 are additive features (no breaking changes)
- Batch 3 depends on stable EventBus infrastructure
- Batch 6 requires architectural bridge pattern (save for when team is fresh)

### Parallel Execution Opportunities

**Phase 1 (Parallel)**: Batches 1 + 2 (independent refactoring)
**Phase 2 (Parallel)**: Batches 4 + 5 (independent features)
**Phase 3 (Sequential)**: Batch 3 → Batch 6 (depends on EventBus stability)

---

## Batch 1: Angular Modernization

### Objective

Migrate 2 container components from `destroy$` Subject pattern to Angular 20 `DestroyRef` API.

### Technical Design

#### Pattern: Before (Current)

```typescript
export class ChatComponent implements OnDestroy {
  private readonly destroy$ = new Subject<void>();

  ngOnInit() {
    this.someObservable$.pipe(takeUntil(this.destroy$)).subscribe(/* ... */);
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
```

#### Pattern: After (Target)

```typescript
export class ChatComponent {
  private readonly destroyRef = inject(DestroyRef);

  ngOnInit() {
    this.someObservable$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(/* ... */);
  }
  // No ngOnDestroy needed!
}
```

### Implementation Steps

#### REQ-1.1: ChatComponent Migration

1. Add import: `import { DestroyRef, inject } from '@angular/core';`
2. Add import: `import { takeUntilDestroyed } from '@angular/core/rxjs-interop';`
3. Replace class property:
   ```typescript
   - private readonly destroy$ = new Subject<void>();
   + private readonly destroyRef = inject(DestroyRef);
   ```
4. Find all `takeUntil(this.destroy$)` instances (should be ~8 occurrences based on typical container patterns)
5. Replace each with `takeUntilDestroyed(this.destroyRef)`
6. Remove `ngOnDestroy()` method entirely
7. Remove unused imports: `Subject` from rxjs, `OnDestroy` from @angular/core

**Files Modified**: `libs/frontend/chat/src/lib/containers/chat/chat.component.ts`

**Verification**:

```bash
nx run chat:typecheck
grep -n "destroy\$" libs/frontend/chat/src/lib/containers/chat/chat.component.ts
# Expected: 0 results
```

#### REQ-1.2: DashboardComponent Migration

Same steps as REQ-1.1, applied to DashboardComponent.

**Files Modified**: `libs/frontend/dashboard/src/lib/containers/dashboard/dashboard.component.ts`

**Verification**:

```bash
nx run dashboard:typecheck
grep -n "destroy\$" libs/frontend/dashboard/src/lib/containers/dashboard/dashboard.component.ts
# Expected: 0 results
```

### Benefits

- 12 fewer lines of code (2x6 lines removed: property + ngOnDestroy)
- Automatic cleanup via Angular framework
- Aligns with Angular 20+ best practices

### Risks

- **NONE** - This is a safe, well-documented Angular pattern migration

---

## Batch 2: Code Consolidation

### Objective

Eliminate `formatDuration()` duplication across 3 components by creating shared utility.

### Technical Design

#### Current State (Duplication)

3 components have identical `formatDuration()` methods (~9 lines each, total 27 lines duplicated):

**agent-tree.component.ts:101-109**

```typescript
formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}
```

**agent-status-badge.component.ts** - identical method
**agent-timeline.component.ts** - identical method

#### Target Architecture

**Shared Utility Pattern**:

```typescript
// libs/frontend/shared-ui/src/lib/utils/time-formatting.utils.ts
/**
 * Formats a duration in milliseconds into a human-readable string.
 *
 * @param ms - Duration in milliseconds
 * @returns Formatted string (e.g., "1h 5m", "2m 30s", "45s")
 *
 * @example
 * formatDuration(3661000) // "1h 1m"
 * formatDuration(125000)  // "2m 5s"
 * formatDuration(45000)   // "45s"
 */
export function formatDuration(ms: number): string {
  if (ms < 0) return '0s'; // Guard against negative values

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}
```

### Implementation Steps

#### REQ-2.1: Create Shared Utility

1. **CREATE** `libs/frontend/shared-ui/src/lib/utils/time-formatting.utils.ts`

   - Add formatDuration function with JSDoc
   - Add edge case handling (negative values, 0ms, very large values)

2. **MODIFY** `libs/frontend/shared-ui/src/index.ts`

   ```typescript
   export * from './lib/utils/time-formatting.utils';
   ```

3. **MODIFY** `libs/frontend/chat/src/lib/components/agent-tree/agent-tree.component.ts`

   - Add import: `import { formatDuration } from '@ptah-extension/shared-ui';`
   - Remove local `formatDuration()` method (lines 101-109)
   - Update all calls to use imported function

4. **MODIFY** `libs/frontend/chat/src/lib/components/agent-status-badge/agent-status-badge.component.ts`

   - Same pattern as step 3

5. **MODIFY** `libs/frontend/chat/src/lib/components/agent-timeline/agent-timeline.component.ts`
   - Same pattern as step 3

### Verification

```bash
nx run-many --target=typecheck --all
grep -rn "formatDuration(" libs/frontend/chat/src/lib/components --include="*.ts"
# Expected: All results show imports, no local method definitions
```

### Benefits

- Eliminates 27 lines of duplicated code
- Single source of truth for time formatting
- Easier to enhance (e.g., add millisecond precision, i18n)

### Risks

- **NONE** - Pure function with no side effects

---

## Batch 3: State Restoration

### Objective

Implement backend handler for `REQUEST_INITIAL_DATA` message to restore webview state on reload.

### Technical Design

#### Architecture Pattern

**Message Flow**:

```
WebView Reload
  ↓
ChatStateManager.ngOnInit()
  ↓
vscodeService.postMessage(REQUEST_INITIAL_DATA)
  ↓
[EventBus Transport]
  ↓
MessageHandlerService.subscribeToChatMessages()
  ↓
Handler: Gather session data, provider info, workspace root
  ↓
eventBus.publish(INITIAL_DATA)
  ↓
[EventBus Transport]
  ↓
ChatStateManager receives INITIAL_DATA
  ↓
Restore state: sessions, currentSession, providerInfo
```

#### Current State Analysis

**Frontend (COMPLETE)**:

```typescript
// libs/frontend/core/src/lib/services/chat-state-manager.service.ts:341
ngOnInit() {
  this.vscodeService.postMessage({
    type: SYSTEM_MESSAGE_TYPES.REQUEST_INITIAL_DATA,
  });
}
```

**Backend (MISSING)**:
No handler exists in `message-handler.service.ts` for `REQUEST_INITIAL_DATA`.

### Implementation Steps

#### REQ-3.1: Backend Handler Implementation

**MODIFY** `libs/backend/claude-domain/src/messaging/message-handler.service.ts`

Add handler in `subscribeToChatMessages()` method:

```typescript
private subscribeToChatMessages(): void {
  // ... existing handlers ...

  // REQUEST_INITIAL_DATA: Restore webview state on reload
  this.eventBus
    .onRequest<RequestInitialDataPayload, RequestInitialDataResult>(
      SYSTEM_MESSAGE_TYPES.REQUEST_INITIAL_DATA
    )
    .subscribe({
      next: async (event) => {
        try {
          // 1. Get current session
          const currentSessionId = this.sessionManager.getCurrentSessionId();
          const currentSession = currentSessionId
            ? await this.sessionManager.getSession(currentSessionId)
            : null;

          // 2. Get all sessions for workspace
          const workspaceId = await this.getWorkspaceId();
          const allSessions = await this.sessionManager.getAllSessions(workspaceId);

          // 3. Get provider info
          const providerInfo = await this.providerOrchestration.getCurrentProvider({});

          // 4. Get workspace root
          const workspaceRoot = this.workspaceService.getWorkspaceRoot();

          // 5. Publish INITIAL_DATA event
          this.eventBus.publish({
            type: SYSTEM_MESSAGE_TYPES.INITIAL_DATA,
            payload: {
              currentSession,
              sessions: allSessions,
              providerInfo,
              workspaceRoot,
            },
            timestamp: Date.now(),
          });

          // 6. Send acknowledgment
          event.respond({
            success: true,
            timestamp: Date.now(),
          });
        } catch (error) {
          this.logger.error('Failed to gather initial data', error);
          event.respond({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      },
    });
}
```

### Message Type Definitions

**CHECK**: Ensure these exist in `libs/shared/src/lib/constants/message-types.ts`:

```typescript
export const SYSTEM_MESSAGE_TYPES = {
  REQUEST_INITIAL_DATA: 'system:requestInitialData', // Should exist
  INITIAL_DATA: 'system:initialData', // Should exist
};
```

**CHECK**: Ensure payload types exist in `libs/shared/src/lib/types/message-payload.types.ts`:

```typescript
export interface RequestInitialDataPayload {
  // Empty payload - just a trigger
}

export interface RequestInitialDataResult {
  success: boolean;
  timestamp: number;
  error?: string;
}

export interface InitialDataPayload {
  currentSession: StrictChatSession | null;
  sessions: StrictChatSession[];
  providerInfo: ProviderInfo;
  workspaceRoot: string;
}
```

### Verification

**Manual Testing**:

1. Start extension with active session
2. Reload webview (Developer: Reload Webviews)
3. Verify state restored:
   - Current session still selected
   - Session list populated
   - Provider info displayed
   - No visible state loss

**Automated Checks**:

```bash
nx run claude-domain:typecheck
grep -n "REQUEST_INITIAL_DATA.*subscribe" libs/backend/claude-domain/src/messaging/message-handler.service.ts
# Expected: 1 result showing handler implementation
```

### Risks

- **MEDIUM**: Depends on SessionManager API stability
- **Mitigation**: Wrap in try-catch, log errors, return graceful error response

---

## Batch 4: Provider Integration

### Objective

Add `SELECT_MODEL` message type and backend handler for model selection.

### Technical Design

#### Message Flow

```
User selects model from dropdown
  ↓
ModelSelectorComponent.onModelChange()
  ↓
vscodeService.postMessage(SELECT_MODEL)
  ↓
[EventBus Transport]
  ↓
MessageHandlerService.subscribeToProviderMessages()
  ↓
Handler: Validate model exists
  ↓
providerOrchestration.selectModel()
  ↓
Update current model selection
  ↓
eventBus.publish(MODEL_CHANGED)
  ↓
[EventBus Transport]
  ↓
Frontend updates UI with new model
```

### Implementation Steps

#### REQ-4.1: Add Message Type

**MODIFY** `libs/shared/src/lib/constants/message-types.ts`

```typescript
export const PROVIDER_MESSAGE_TYPES = {
  // ... existing types ...
  SELECT_MODEL: 'providers:selectModel', // ADD THIS
};
```

**MODIFY** `libs/shared/src/lib/types/message-payload.types.ts`

```typescript
// Request payload
export interface ProviderSelectModelPayload {
  modelId: string;
  providerId?: string; // Optional - use current provider if omitted
}

// Response payload
export interface ProviderSelectModelResult {
  success: boolean;
  modelId?: string;
  error?: string;
}

// Add to MessagePayloadMap
export interface MessagePayloadMap {
  // ... existing mappings ...
  [PROVIDER_MESSAGE_TYPES.SELECT_MODEL]: {
    request: ProviderSelectModelPayload;
    response: ProviderSelectModelResult;
  };
}
```

**Verification**:

```bash
nx run shared:typecheck
grep -n "SELECT_MODEL" libs/shared/src/lib/constants/message-types.ts
# Expected: 1 result showing constant definition
```

#### REQ-4.2: Backend Handler Implementation

**MODIFY** `libs/backend/claude-domain/src/messaging/message-handler.service.ts`

Add handler in `subscribeToProviderMessages()` method:

```typescript
private subscribeToProviderMessages(): void {
  // ... existing handlers ...

  // SELECT_MODEL: Change current model
  this.eventBus
    .onRequest<ProviderSelectModelPayload, ProviderSelectModelResult>(
      PROVIDER_MESSAGE_TYPES.SELECT_MODEL
    )
    .subscribe({
      next: async (event) => {
        try {
          const { modelId, providerId } = event.payload;

          // Delegate to orchestration service
          const result = await this.providerOrchestration.selectModel({
            modelId,
            providerId,
          });

          event.respond({
            success: result.success,
            modelId: result.modelId,
            error: result.error,
          });
        } catch (error) {
          this.logger.error('Failed to select model', error);
          event.respond({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      },
    });
}
```

**MODIFY** `libs/backend/claude-domain/src/provider/provider-orchestration.service.ts`

Add `selectModel()` method:

```typescript
export class ProviderOrchestrationService {
  // ... existing methods ...

  /**
   * Select a model for the current or specified provider.
   *
   * @param request - Model selection request
   * @returns Selection result with success status
   */
  async selectModel(request: { modelId: string; providerId?: string }): Promise<{ success: boolean; modelId?: string; error?: string }> {
    try {
      const { modelId, providerId } = request;

      // Use current provider if not specified
      const targetProviderId = providerId || this.currentProvider?.id;

      if (!targetProviderId) {
        return {
          success: false,
          error: 'No provider available',
        };
      }

      // Get provider
      const provider = this.providers.get(targetProviderId);
      if (!provider) {
        return {
          success: false,
          error: `Provider ${targetProviderId} not found`,
        };
      }

      // Validate model exists for provider
      const models = await provider.getAvailableModels();
      const modelExists = models.some((m) => m.id === modelId);

      if (!modelExists) {
        return {
          success: false,
          error: `Model ${modelId} not available for provider ${targetProviderId}`,
        };
      }

      // Update current model
      this.currentModel = modelId;

      // Publish MODEL_CHANGED event
      this.eventBus.publish({
        type: PROVIDER_MESSAGE_TYPES.MODEL_CHANGED,
        payload: {
          modelId,
          providerId: targetProviderId,
        },
        timestamp: Date.now(),
      });

      return {
        success: true,
        modelId,
      };
    } catch (error) {
      this.logger.error('Error selecting model', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}
```

### Verification

**Type Checks**:

```bash
nx run claude-domain:typecheck
nx run shared:typecheck
```

**Manual Testing**:

1. Open provider settings
2. Select different model from dropdown
3. Verify MODEL_CHANGED event published
4. Verify UI reflects new model selection

### Risks

- **LOW**: Well-defined provider abstraction already exists
- **Mitigation**: Comprehensive model validation before selection

---

## Batch 5: Analytics Integration

### Objective

Replace hardcoded analytics values (12, 47, 1234) with real data from analytics service.

### Technical Design

#### Current State (Hardcoded)

**analytics.component.ts:200-218**:

```typescript
getStatsData() {
  // TODO: Replace with real analytics data from service
  return {
    todayStats: { sessions: 12, label: 'Chat Sessions', timeframe: 'Today' },
    weekStats: { messages: 47, label: 'Messages Sent', timeframe: 'This Week' },
    totalStats: { tokens: 1234, label: 'Tokens Used', timeframe: 'Total' },
  };
}
```

#### Target Architecture

**Service-Based Data Fetching**:

```typescript
export class AnalyticsComponent implements OnInit {
  private readonly analyticsService = inject(AnalyticsService);

  // Signals for reactive data
  readonly analyticsData = signal<AnalyticsData | null>(null);
  readonly isLoading = signal(true);
  readonly error = signal<string | null>(null);

  // Computed stats
  readonly statsData = computed(() => {
    const data = this.analyticsData();
    if (!data) return this.getEmptyStats();

    return {
      todayStats: {
        sessions: data.todaySessions,
        label: 'Chat Sessions',
        timeframe: 'Today',
      },
      weekStats: {
        messages: data.weekMessages,
        label: 'Messages Sent',
        timeframe: 'This Week',
      },
      totalStats: {
        tokens: data.totalTokens,
        label: 'Tokens Used',
        timeframe: 'Total',
      },
    };
  });

  ngOnInit() {
    this.loadAnalytics();
  }

  private async loadAnalytics() {
    try {
      this.isLoading.set(true);
      this.error.set(null);

      const data = await this.analyticsService.fetchAnalyticsData();
      this.analyticsData.set(data);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to load analytics');
    } finally {
      this.isLoading.set(false);
    }
  }

  private getEmptyStats() {
    return {
      todayStats: { sessions: 0, label: 'Chat Sessions', timeframe: 'Today' },
      weekStats: { messages: 0, label: 'Messages Sent', timeframe: 'This Week' },
      totalStats: { tokens: 0, label: 'Tokens Used', timeframe: 'Total' },
    };
  }
}
```

### Implementation Steps

#### REQ-5.1: Create AnalyticsService (if not exists)

**CREATE** `libs/frontend/analytics/src/lib/services/analytics.service.ts`

```typescript
import { Injectable, inject } from '@angular/core';
import { VSCodeService } from '@ptah-extension/core';
import { ANALYTICS_MESSAGE_TYPES } from '@ptah-extension/shared';

export interface AnalyticsData {
  todaySessions: number;
  weekMessages: number;
  totalTokens: number;
}

@Injectable({ providedIn: 'root' })
export class AnalyticsService {
  private readonly vscodeService = inject(VSCodeService);

  /**
   * Fetch analytics data from backend.
   *
   * @returns Promise resolving to analytics data
   * @throws Error if fetch fails
   */
  async fetchAnalyticsData(): Promise<AnalyticsData> {
    try {
      const response = await this.vscodeService.postMessage({
        type: ANALYTICS_MESSAGE_TYPES.GET_STATS,
      });

      if (!response.success) {
        throw new Error(response.error || 'Failed to fetch analytics');
      }

      return {
        todaySessions: response.data.todaySessions || 0,
        weekMessages: response.data.weekMessages || 0,
        totalTokens: response.data.totalTokens || 0,
      };
    } catch (error) {
      console.error('Analytics fetch error:', error);
      throw error;
    }
  }
}
```

**MODIFY** `libs/frontend/analytics/src/index.ts`

```typescript
export * from './lib/services/analytics.service';
```

#### REQ-5.2: Refactor AnalyticsComponent

**MODIFY** `libs/frontend/analytics/src/lib/containers/analytics/analytics.component.ts`

Replace hardcoded `getStatsData()` method with signal-based approach (see Target Architecture above).

### Verification

**Type Checks**:

```bash
nx run analytics:typecheck
```

**Hardcoded Value Check**:

```bash
grep -n "sessions: 12\|messages: 47\|tokens: 1234" libs/frontend/analytics/src/lib/containers/analytics/analytics.component.ts
# Expected: 0 results
```

**Manual Testing**:

1. Open analytics view
2. Verify loading state appears
3. Verify real session/message/token counts displayed
4. Verify error handling if backend unavailable

### Risks

- **LOW**: Analytics service is read-only, no state mutations
- **Mitigation**: Graceful error handling, loading states, fallback to 0 values

---

## Batch 6: Workspace Intelligence Integration (CRITICAL)

### Objective

Enable file include/exclude functionality for @ mentions by creating architectural bridge between EventBus (string paths) and workspace-intelligence (vscode.Uri objects).

### Problem Statement

**Architectural Constraint**:

- `message-handler.service.ts` is in `claude-domain` library (domain logic layer)
- `claude-domain` MUST NOT depend on VS Code modules (architectural boundary)
- `workspace-intelligence` services require `vscode.Uri` objects
- EventBus messages contain string file paths (not Uri objects)
- **Result**: File include/exclude handlers commented out (lines 584-634)

**TODO Comment in message-handler.service.ts:584-634**:

```typescript
// TODO: This handler requires refactoring - includeFile needs VS Code Uri object
// MessageHandlerService is in claude-domain and can't create VS Code objects
// Solution: Main app should create Uri and call contextOrchestration directly
```

### Solution: Context Message Bridge Pattern

**Architecture**:

```
Frontend (@ mention)
  ↓
INCLUDE_FILE message (filePath: string)
  ↓
[EventBus - cross-process transport]
  ↓
❌ message-handler.service.ts (claude-domain)
   CAN'T handle - needs vscode.Uri
  ↓
✅ ContextMessageBridgeService (main app layer)
   - Subscribes to INCLUDE_FILE / EXCLUDE_FILE
   - Converts filePath → vscode.Uri
   - Delegates to contextOrchestration
   - Publishes response events
  ↓
contextOrchestration.includeFile(uri)
  ↓
workspace-intelligence services
  ↓
Success → FILE_INCLUDED event
```

### Technical Design

#### Component: ContextMessageBridgeService

**Purpose**: Architectural bridge that enables cross-boundary communication while maintaining clean separation of concerns.

**Responsibilities**:

1. Subscribe to context-related EventBus messages (INCLUDE_FILE, EXCLUDE_FILE)
2. Convert string file paths to vscode.Uri objects
3. Delegate to contextOrchestration service
4. Publish response events (FILE_INCLUDED, FILE_EXCLUDED)
5. Handle errors gracefully

**Location**: `apps/ptah-extension-vscode/src/services/context-message-bridge.service.ts` (main app layer, can import vscode)

### Implementation Steps

#### Step 6.1.1: Create ContextMessageBridgeService

**CREATE** `apps/ptah-extension-vscode/src/services/context-message-bridge.service.ts`

```typescript
import { injectable, inject } from 'tsyringe';
import * as vscode from 'vscode';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { EventBus } from '@ptah-extension/vscode-core';
import type { ContextOrchestrationService } from '@ptah-extension/workspace-intelligence';
import { CONTEXT_MESSAGE_TYPES, type ContextIncludeFilePayload, type ContextExcludeFilePayload, type ContextIncludeFileResult, type ContextExcludeFileResult } from '@ptah-extension/shared';

/**
 * Architectural bridge service that handles context-related EventBus messages.
 *
 * **Purpose**: Enable file include/exclude functionality while maintaining clean
 * separation of concerns. This service exists in the main app layer where it can
 * safely import VS Code modules, unlike MessageHandlerService which is in the
 * claude-domain library.
 *
 * **Architecture**:
 * - Subscribes to INCLUDE_FILE and EXCLUDE_FILE messages from EventBus
 * - Converts filePath strings to vscode.Uri objects
 * - Delegates to contextOrchestration service (workspace-intelligence)
 * - Publishes response events back through EventBus
 *
 * **Why Bridge Pattern?**
 * - MessageHandlerService (claude-domain) can't depend on vscode module
 * - ContextOrchestrationService requires vscode.Uri objects
 * - EventBus messages contain string file paths
 * - Bridge converts between these layers without violating boundaries
 *
 * @see {@link https://en.wikipedia.org/wiki/Bridge_pattern Bridge Pattern}
 */
@injectable()
export class ContextMessageBridgeService {
  constructor(
    @inject(TOKENS.EVENT_BUS) private readonly eventBus: EventBus,
    @inject(TOKENS.CONTEXT_ORCHESTRATION_SERVICE)
    private readonly contextOrchestration: ContextOrchestrationService,
    @inject(TOKENS.LOGGER) private readonly logger: any
  ) {}

  /**
   * Initialize bridge by subscribing to context messages.
   * Called during extension activation.
   */
  initialize(): void {
    this.subscribeToIncludeFile();
    this.subscribeToExcludeFile();
    this.logger.info('ContextMessageBridge initialized');
  }

  /**
   * Handle INCLUDE_FILE messages.
   * Converts filePath string to vscode.Uri and delegates to contextOrchestration.
   */
  private subscribeToIncludeFile(): void {
    this.eventBus.onRequest<ContextIncludeFilePayload, ContextIncludeFileResult>(CONTEXT_MESSAGE_TYPES.INCLUDE_FILE).subscribe({
      next: async (event) => {
        try {
          const { filePath } = event.payload;

          // Convert string path to vscode.Uri
          const uri = vscode.Uri.file(filePath);

          // Delegate to workspace-intelligence service
          const result = await this.contextOrchestration.includeFile({ uri });

          // Publish success event
          this.eventBus.publish({
            type: CONTEXT_MESSAGE_TYPES.FILE_INCLUDED,
            payload: {
              filePath,
              success: result.success,
            },
            timestamp: Date.now(),
          });

          // Respond to request
          event.respond({
            success: result.success,
            filePath,
            error: result.error,
          });
        } catch (error) {
          this.logger.error('Failed to include file', error);
          event.respond({
            success: false,
            filePath: event.payload.filePath,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      },
    });
  }

  /**
   * Handle EXCLUDE_FILE messages.
   * Converts filePath string to vscode.Uri and delegates to contextOrchestration.
   */
  private subscribeToExcludeFile(): void {
    this.eventBus.onRequest<ContextExcludeFilePayload, ContextExcludeFileResult>(CONTEXT_MESSAGE_TYPES.EXCLUDE_FILE).subscribe({
      next: async (event) => {
        try {
          const { filePath } = event.payload;

          // Convert string path to vscode.Uri
          const uri = vscode.Uri.file(filePath);

          // Delegate to workspace-intelligence service
          const result = await this.contextOrchestration.excludeFile({ uri });

          // Publish success event
          this.eventBus.publish({
            type: CONTEXT_MESSAGE_TYPES.FILE_EXCLUDED,
            payload: {
              filePath,
              success: result.success,
            },
            timestamp: Date.now(),
          });

          // Respond to request
          event.respond({
            success: result.success,
            filePath,
            error: result.error,
          });
        } catch (error) {
          this.logger.error('Failed to exclude file', error);
          event.respond({
            success: false,
            filePath: event.payload.filePath,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      },
    });
  }

  /**
   * Cleanup subscriptions on extension deactivation.
   */
  dispose(): void {
    // Subscriptions auto-cleanup via EventBus
    this.logger.info('ContextMessageBridge disposed');
  }
}
```

#### Step 6.1.2: Register Bridge in Extension Activation

**MODIFY** `apps/ptah-extension-vscode/src/extension.ts`

```typescript
// Add import
import { ContextMessageBridgeService } from './services/context-message-bridge.service';

export async function activate(context: vscode.ExtensionContext) {
  // ... existing setup ...

  // Register ContextMessageBridgeService (after EventBus and ContextOrchestration setup)
  const contextBridge = container.resolve(ContextMessageBridgeService);
  contextBridge.initialize();
  context.subscriptions.push({ dispose: () => contextBridge.dispose() });

  // ... rest of activation ...
}
```

#### Step 6.1.3: Add DI Token (if needed)

**MODIFY** `libs/backend/vscode-core/src/di/tokens.ts`

Check if `CONTEXT_MESSAGE_BRIDGE` token exists. If not:

```typescript
export const TOKENS = {
  // ... existing tokens ...
  CONTEXT_MESSAGE_BRIDGE: Symbol.for('CONTEXT_MESSAGE_BRIDGE'),
};
```

**Note**: Token may not be needed if service is not injected elsewhere. Only add if other services need to inject ContextMessageBridgeService.

#### Step 6.1.4: Remove Commented Code from MessageHandler

**MODIFY** `libs/backend/claude-domain/src/messaging/message-handler.service.ts`

Remove commented-out code at lines 584-634 and replace with documentation comment:

```typescript
/**
 * FILE INCLUDE/EXCLUDE HANDLERS
 *
 * These handlers are intentionally NOT implemented in MessageHandlerService.
 * Reason: includeFile/excludeFile require vscode.Uri objects, but MessageHandlerService
 * is in the claude-domain library and must not depend on VS Code modules.
 *
 * Solution: ContextMessageBridgeService in the main app layer handles these messages.
 * See: apps/ptah-extension-vscode/src/services/context-message-bridge.service.ts
 *
 * Architecture:
 *   Frontend → INCLUDE_FILE (string path) → EventBus
 *   → ContextMessageBridgeService (converts to Uri, delegates to contextOrchestration)
 *   → ContextOrchestrationService (workspace-intelligence)
 *   → EventBus FILE_INCLUDED event → Frontend
 *
 * This pattern maintains clean separation of concerns while enabling full functionality.
 */
```

### Verification

#### Type Checks

```bash
nx run-many --target=typecheck --all
# Expected: 0 errors
```

#### VS Code Import Check

```bash
grep -rn "import.*vscode" libs/backend/claude-domain/src --include="*.ts"
# Expected: 0 results (no vscode imports in claude-domain)
```

#### Integration Testing

**Test Scenario 1: Include File via @ Mention**

1. Open chat input
2. Type `@` to trigger file suggestions
3. Select a file (e.g., `libs/shared/src/index.ts`)
4. Verify:
   - INCLUDE_FILE message sent with filePath string
   - ContextMessageBridgeService receives message
   - vscode.Uri created from filePath
   - contextOrchestration.includeFile() called
   - FILE_INCLUDED event published
   - File appears in context panel

**Test Scenario 2: Exclude File from Context**

1. Open context panel with multiple files
2. Click remove button on a file
3. Verify:
   - EXCLUDE_FILE message sent
   - ContextMessageBridgeService handles message
   - File removed from context panel

**Test Scenario 3: Error Handling**

1. Include invalid file path (e.g., `/nonexistent/path`)
2. Verify:
   - Error caught by bridge service
   - Error response sent with descriptive message
   - No crash or unhandled rejection

### Risks & Mitigations

**Risk 1: Bridge Complexity**

- **Impact**: Medium - New architectural pattern
- **Probability**: Low - Well-documented bridge pattern
- **Mitigation**: Comprehensive JSDoc, clear architecture comments, integration tests

**Risk 2: Message Type Mismatches**

- **Impact**: High - Runtime errors if payload types wrong
- **Probability**: Low - TypeScript ensures type safety
- **Mitigation**: Thorough type checks, EventBus type guards

**Risk 3: Context Orchestration API Changes**

- **Impact**: Medium - Bridge depends on stable API
- **Probability**: Low - workspace-intelligence is stable
- **Mitigation**: Error handling, logging, graceful degradation

### Benefits

✅ **Clean Architecture**: No VS Code dependencies in claude-domain
✅ **Maintainability**: Single Responsibility Principle (bridge only converts, doesn't contain business logic)
✅ **Extensibility**: Easy to add more context operations (bulk include, filters, etc.)
✅ **Testability**: Bridge is isolated and mockable
✅ **User Value**: @ mention file selection now works end-to-end

---

## Quality Gates

### Type Checking

```bash
nx run-many --target=typecheck --all
# Expected: 0 errors across all 14 projects
```

### Linting

```bash
nx run-many --target=lint --all
# Expected: 0 warnings/errors
```

### Builds

```bash
nx run-many --target=build --all
# Expected: All builds succeed
```

### Architectural Boundaries

```bash
# Verify no VS Code imports in claude-domain
grep -rn "import.*vscode" libs/backend/claude-domain/src --include="*.ts"
# Expected: 0 results

# Verify no frontend imports in backend
grep -rn "@ptah-extension/chat\|@ptah-extension/dashboard" libs/backend --include="*.ts"
# Expected: 0 results
```

### Code Search Validations

```bash
# Verify DestroyRef migration complete
grep -rn "destroy\$" libs/frontend/chat/src/lib/containers --include="*.ts"
grep -rn "destroy\$" libs/frontend/dashboard/src/lib/containers --include="*.ts"
# Expected: 0 results

# Verify formatDuration consolidation
grep -rn "formatDuration(" libs/frontend/chat/src/lib/components --include="*.ts" | grep -v "import"
# Expected: 0 results (only imports)

# Verify no hardcoded analytics
grep -n "sessions: 12\|messages: 47\|tokens: 1234" libs/frontend/analytics/src
# Expected: 0 results

# Verify REQUEST_INITIAL_DATA handler exists
grep -n "REQUEST_INITIAL_DATA.*subscribe" libs/backend/claude-domain/src/messaging/message-handler.service.ts
# Expected: 1 result

# Verify SELECT_MODEL handler exists
grep -n "SELECT_MODEL.*subscribe" libs/backend/claude-domain/src/messaging/message-handler.service.ts
# Expected: 1 result

# Verify ContextMessageBridgeService initialized
grep -n "ContextMessageBridgeService" apps/ptah-extension-vscode/src/extension.ts
# Expected: 2+ results (import + initialization)
```

---

## Rollback Strategy

Each batch is independent (except Batch 6 depends on EventBus stability). Rollback is per-batch:

**Batch 1-2**: Git revert commit (simple refactoring)
**Batch 3-5**: Git revert commit + remove message handlers
**Batch 6**: Git revert commits + re-comment handlers in message-handler.service.ts

No database migrations or persistent state changes in this task.

---

## Documentation Updates

### Files to Update After Completion

1. **libs/backend/claude-domain/CLAUDE.md**

   - Add ContextMessageBridge pattern explanation
   - Update "Integration Points" section

2. **apps/ptah-extension-vscode/CLAUDE.md**

   - Document ContextMessageBridgeService
   - Add to service registry

3. **libs/frontend/shared-ui/CLAUDE.md**

   - Add formatDuration utility to utility functions list

4. **Architecture Decision Records** (if ADR system exists)
   - Create ADR for Context Message Bridge pattern
   - Justification: Maintain architectural boundaries while enabling functionality

---

## Success Criteria Checklist

- [ ] **Batch 1**: ChatComponent and DashboardComponent use DestroyRef (0 destroy$ found)
- [ ] **Batch 2**: formatDuration utility shared (0 local definitions found)
- [ ] **Batch 3**: REQUEST_INITIAL_DATA handler implemented (handler exists in message-handler.service.ts)
- [ ] **Batch 4**: SELECT_MODEL message type + handler implemented (model selection works)
- [ ] **Batch 5**: Analytics displays real data (no hardcoded 12/47/1234 values)
- [ ] **Batch 6**: ContextMessageBridgeService created and registered (@ mention file selection works)
- [ ] **Quality**: All type checks pass (0 errors)
- [ ] **Quality**: All lint checks pass (0 warnings)
- [ ] **Quality**: All builds succeed
- [ ] **Architecture**: No VS Code imports in claude-domain (0 results)
- [ ] **Integration**: @ mention file selection end-to-end functional
- [ ] **Integration**: Webview reload restores state correctly
- [ ] **Integration**: Model selection changes active model

---

## Estimated Timeline

| Batch     | Effort     | Complexity | Risk   | Recommended Developer |
| --------- | ---------- | ---------- | ------ | --------------------- |
| 1         | 2h         | Low        | Low    | Junior+               |
| 2         | 2-3h       | Low        | Low    | Junior+               |
| 3         | 3-4h       | Medium     | Medium | Mid+                  |
| 4         | 2-3h       | Medium     | Low    | Mid+                  |
| 5         | 2-3h       | Medium     | Low    | Mid+                  |
| 6         | 4-6h       | High       | Medium | Senior                |
| **Total** | **15-21h** | -          | -      | -                     |

**Critical Path**: Batch 6 (workspace intelligence integration) should be assigned to senior developer due to architectural complexity.

---

## Appendix: Message Type Reference

### Existing Message Types (Used in This Task)

```typescript
// System Messages
SYSTEM_MESSAGE_TYPES.REQUEST_INITIAL_DATA; // REQ-3.1
SYSTEM_MESSAGE_TYPES.INITIAL_DATA; // REQ-3.1

// Provider Messages
PROVIDER_MESSAGE_TYPES.SELECT_MODEL; // REQ-4.1 (NEW)
PROVIDER_MESSAGE_TYPES.MODEL_CHANGED; // REQ-4.2

// Context Messages
CONTEXT_MESSAGE_TYPES.INCLUDE_FILE; // REQ-6.1
CONTEXT_MESSAGE_TYPES.EXCLUDE_FILE; // REQ-6.1
CONTEXT_MESSAGE_TYPES.FILE_INCLUDED; // REQ-6.1
CONTEXT_MESSAGE_TYPES.FILE_EXCLUDED; // REQ-6.1

// Analytics Messages
ANALYTICS_MESSAGE_TYPES.GET_STATS; // REQ-5.1
```

### Payload Interface Reference

```typescript
// REQ-3.1: State Restoration
interface RequestInitialDataPayload {}
interface RequestInitialDataResult {
  success: boolean;
  timestamp: number;
  error?: string;
}

// REQ-4.1: Model Selection
interface ProviderSelectModelPayload {
  modelId: string;
  providerId?: string;
}
interface ProviderSelectModelResult {
  success: boolean;
  modelId?: string;
  error?: string;
}

// REQ-6.1: File Context
interface ContextIncludeFilePayload {
  filePath: string;
}
interface ContextIncludeFileResult {
  success: boolean;
  filePath: string;
  error?: string;
}
```

---

**Document Version**: 1.0
**Last Updated**: 2025-11-21
**Status**: Ready for Implementation
