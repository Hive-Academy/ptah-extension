# Implementation Plan - TASK_2025_103: Subagent Resumption

## Executive Summary

This plan implements subagent resumption capability allowing users to continue interrupted subagent executions. The feature leverages Claude SDK's native `resume: sessionId` parameter combined with the prompt `Resume agent ${agentId}`.

## Architecture Overview

### Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         SUBAGENT RESUMPTION FLOW                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────┐      SubagentStart Hook                                 │
│  │ AgentSession    │───────────────────────────────────┐                     │
│  │ WatcherService  │                                   │                     │
│  └─────────────────┘                                   ▼                     │
│                                               ┌───────────────────┐          │
│  ┌─────────────────┐      SubagentStop Hook   │  SubagentRegistry │          │
│  │ SDK Session     │─────────────────────────►│  Service (NEW)    │          │
│  │ (streaming)     │                          │                   │          │
│  └─────────────────┘                          │  Map<sessionId,   │          │
│                                               │    SubagentRecord[]>         │
│         ▲                                     └─────────┬─────────┘          │
│         │                                               │                    │
│         │  Resume SDK Query                             │ Query              │
│         │  (resume: parentSessionId)                    │                    │
│         │                                               ▼                    │
│  ┌──────┴──────────┐      subagent:resume     ┌─────────────────┐           │
│  │ SdkAgentAdapter │◄─────────────────────────│ SubagentRpc     │           │
│  │ .resumeSubagent │     RPC Call             │ Handlers (NEW)  │           │
│  └─────────────────┘                          └────────▲────────┘           │
│                                                        │                    │
│                                     subagent:list-resumable                 │
│                                                        │                    │
│  ┌─────────────────────────────────────────────────────┴────────────────┐   │
│  │                         FRONTEND (Webview)                            │   │
│  │                                                                       │   │
│  │   ┌────────────────┐    "Resume"     ┌─────────────────────────┐     │   │
│  │   │InlineAgentBubble│───────────────►│ ClaudeRpcService        │     │   │
│  │   │.component       │    click        │ .resumeSubagent()       │     │   │
│  │   │                 │                 └─────────────────────────┘     │   │
│  │   │ @if(isInterrupt)│                                                │   │
│  │   │  <Resume btn>  │                                                 │   │
│  │   └────────────────┘                                                 │   │
│  │                                                                       │   │
│  │   ┌────────────────────────────────────────────────────────────┐     │   │
│  │   │ ChatStore                                                   │     │   │
│  │   │                                                             │     │   │
│  │   │  - resumableSubagents: Signal<ResumableSubagent[]>         │     │   │
│  │   │  - showResumeBanner: Signal<boolean>                        │     │   │
│  │   │                                                             │     │   │
│  │   └────────────────────────────────────────────────────────────┘     │   │
│  │                                                                       │   │
│  └───────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Key Components

1. **SubagentRegistryService** (NEW) - Backend registry tracking subagent state
2. **SubagentRpcHandlers** (NEW) - RPC handlers for resume and query operations
3. **SdkAgentAdapter.resumeSubagent** (MODIFY) - SDK method for subagent resumption
4. **InlineAgentBubbleComponent** (MODIFY) - UI resume button on interrupted agents
5. **ChatStore** (MODIFY) - Frontend state for resumable subagents
6. **ClaudeRpcService** (MODIFY) - Frontend RPC methods for resume operations

---

## Codebase Investigation Summary

### Libraries Discovered

| Library       | Purpose         | Key Files                                              |
| ------------- | --------------- | ------------------------------------------------------ |
| `agent-sdk`   | SDK integration | `sdk-agent-adapter.ts`, `session-lifecycle-manager.ts` |
| `vscode-core` | Infrastructure  | `agent-session-watcher.service.ts`, `di/tokens.ts`     |
| `chat`        | Frontend UI     | `inline-agent-bubble.component.ts`, `chat.store.ts`    |
| `shared`      | Types           | `execution-node.types.ts`, `ai-provider.types.ts`      |

### Patterns Identified

**Backend Registry Pattern** (Evidence: `libs/backend/llm-abstraction/src/lib/registry/provider-registry.ts`):

- Injectable singleton with Map-based storage
- Typed registration/lookup methods
- Cleanup/dispose lifecycle

**RPC Handler Pattern** (Evidence: `apps/ptah-extension-vscode/src/services/rpc/handlers/chat-rpc.handlers.ts`):

- Injectable class with handler methods
- Methods registered to RPC method names
- Return typed response objects

**Frontend Signal Pattern** (Evidence: `libs/frontend/chat/src/lib/services/chat.store.ts`):

- `signal()` for mutable state
- `computed()` for derived state
- `inject()` for dependencies

**UI Component Pattern** (Evidence: `libs/frontend/chat/src/lib/components/organisms/inline-agent-bubble.component.ts`):

- `ChangeDetectionStrategy.OnPush`
- `input()` for required inputs
- `computed()` for derived values
- DaisyUI + Tailwind for styling

---

## Component Specifications

### Component 1: SubagentRegistryService

**Purpose**: Backend service tracking subagent lifecycle state across sessions.

**Location**: `libs/backend/vscode-core/src/services/subagent-registry.service.ts`

**Pattern Evidence**:

- Registry pattern from `provider-registry.ts:51-381`
- Injectable singleton with Map storage
- Typed record structure with TTL-based expiration

**Responsibilities**:

1. Store SubagentRecord on SubagentStart hook
2. Update status on SubagentStop hook
3. Mark agents as 'interrupted' on session abort
4. Query resumable agents (status='interrupted', age < 24h)
5. Auto-cleanup expired records (24h TTL)

**Type Definitions**:

```typescript
// libs/shared/src/lib/types/subagent-registry.types.ts

/**
 * Subagent lifecycle status
 */
export type SubagentStatus = 'running' | 'completed' | 'interrupted' | 'expired';

/**
 * Record tracking a subagent's lifecycle
 */
export interface SubagentRecord {
  /** Parent session ID (SDK UUID) */
  parentSessionId: string;
  /** Agent identifier (e.g., "adcecb2") */
  agentId: string;
  /** Agent type (e.g., "Explore", "Plan", "software-architect") */
  agentType: string;
  /** Agent description */
  agentDescription: string;
  /** Timestamp when agent started */
  startTime: number;
  /** Timestamp when agent stopped/interrupted */
  endTime?: number;
  /** Current lifecycle status */
  status: SubagentStatus;
  /** Task tool_use ID for correlation */
  toolUseId?: string;
  /** Preview of agent's last output (first 200 chars) */
  summaryPreview?: string;
}

/**
 * Resumable subagent info returned to frontend
 */
export interface ResumableSubagent {
  /** Agent identifier */
  agentId: string;
  /** Agent type */
  agentType: string;
  /** Agent description */
  agentDescription: string;
  /** When agent was interrupted */
  interruptedAt: number;
  /** Preview of agent's last output */
  summaryPreview?: string;
  /** Whether agent session has expired (24h+) */
  isExpired: boolean;
}
```

**Service Implementation Pattern**:

```typescript
// libs/backend/vscode-core/src/services/subagent-registry.service.ts

import { injectable, inject } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import { SubagentRecord, SubagentStatus, ResumableSubagent } from '@ptah-extension/shared';

const EXPIRATION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

@injectable()
export class SubagentRegistryService {
  /** Map<parentSessionId, SubagentRecord[]> */
  private readonly registry = new Map<string, SubagentRecord[]>();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {
    this.startCleanupTimer();
  }

  /**
   * Register a new subagent when SubagentStart hook fires
   */
  registerSubagent(record: Omit<SubagentRecord, 'status' | 'endTime'>): void;

  /**
   * Update subagent status when SubagentStop hook fires
   */
  completeSubagent(parentSessionId: string, agentId: string): void;

  /**
   * Mark all running subagents as interrupted for a session
   */
  interruptSessionSubagents(parentSessionId: string): void;

  /**
   * Get all resumable (interrupted, non-expired) subagents for a session
   */
  getResumableSubagents(parentSessionId: string): ResumableSubagent[];

  /**
   * Mark subagent as running again (on resume)
   */
  markAsRunning(parentSessionId: string, agentId: string): void;

  /**
   * Cleanup expired records (24h+)
   */
  private cleanupExpired(): void;

  /**
   * Dispose and cleanup
   */
  dispose(): void;
}
```

**Integration Points**:

- Listen to `AgentSessionWatcherService` events ('agent-start', 'agent-stop')
- Called by `SessionLifecycleManager.endSession()` to mark as interrupted
- Queried by `SubagentRpcHandlers` for resumable list

**Quality Requirements**:

- Memory efficient: Map storage with TTL cleanup
- Thread-safe: Sequential event processing
- No persistence: In-memory only (cleared on restart)

**Files Affected**:

- `libs/backend/vscode-core/src/services/subagent-registry.service.ts` (CREATE)
- `libs/backend/vscode-core/src/di/tokens.ts` (MODIFY - add SUBAGENT_REGISTRY token)
- `libs/backend/vscode-core/src/index.ts` (MODIFY - export)
- `libs/shared/src/lib/types/subagent-registry.types.ts` (CREATE)
- `libs/shared/src/index.ts` (MODIFY - export types)

---

### Component 2: SubagentRpcHandlers

**Purpose**: Backend RPC handlers exposing subagent resume and query operations to frontend.

**Location**: `apps/ptah-extension-vscode/src/services/rpc/handlers/subagent-rpc.handlers.ts`

**Pattern Evidence**:

- RPC handler pattern from `chat-rpc.handlers.ts`
- Injectable class with method handlers
- Typed request/response structures

**RPC Methods**:

| Method                    | Request                                                       | Response                               | Description                       |
| ------------------------- | ------------------------------------------------------------- | -------------------------------------- | --------------------------------- |
| `subagent:list-resumable` | `{ sessionId: string }`                                       | `ResumableSubagent[]`                  | List resumable agents for session |
| `subagent:resume`         | `{ parentSessionId: string, agentId: string, tabId: string }` | `{ success: boolean, error?: string }` | Resume specific subagent          |

**Implementation Pattern**:

```typescript
// apps/ptah-extension-vscode/src/services/rpc/handlers/subagent-rpc.handlers.ts

import { injectable, inject } from 'tsyringe';
import { TOKENS, SubagentRegistryService } from '@ptah-extension/vscode-core';
import { SdkAgentAdapter } from '@ptah-extension/agent-sdk';
import { ResumableSubagent, SessionId } from '@ptah-extension/shared';

@injectable()
export class SubagentRpcHandlers {
  constructor(@inject(TOKENS.SUBAGENT_REGISTRY) private readonly registry: SubagentRegistryService, @inject(SDK_TOKENS.SDK_AGENT_ADAPTER) private readonly sdkAdapter: SdkAgentAdapter, @inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  /**
   * Handler for subagent:list-resumable
   */
  async handleListResumable(params: { sessionId: string }): Promise<ResumableSubagent[]> {
    return this.registry.getResumableSubagents(params.sessionId);
  }

  /**
   * Handler for subagent:resume
   * Invokes SDK with resume parameter and specific prompt
   */
  async handleResume(params: { parentSessionId: string; agentId: string; tabId: string }): Promise<{ success: boolean; error?: string }> {
    try {
      // Mark as running in registry
      this.registry.markAsRunning(params.parentSessionId, params.agentId);

      // Resume via SDK adapter
      await this.sdkAdapter.resumeSubagent(params.parentSessionId as SessionId, params.agentId, params.tabId);

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}
```

**Registration** (in `rpc-method-registration.service.ts`):

```typescript
// Register subagent handlers
rpcService.registerMethod('subagent:list-resumable', (params) => subagentHandlers.handleListResumable(params));
rpcService.registerMethod('subagent:resume', (params) => subagentHandlers.handleResume(params));
```

**Files Affected**:

- `apps/ptah-extension-vscode/src/services/rpc/handlers/subagent-rpc.handlers.ts` (CREATE)
- `apps/ptah-extension-vscode/src/services/rpc/rpc-method-registration.service.ts` (MODIFY)
- `apps/ptah-extension-vscode/src/di/container.ts` (MODIFY - register handlers)

---

### Component 3: SdkAgentAdapter.resumeSubagent

**Purpose**: SDK method to resume a specific subagent using SDK's native resume capability.

**Location**: `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts`

**Pattern Evidence**:

- `resumeSession` method at line 384-438 shows resume pattern
- Uses `SessionLifecycleManager.executeQuery()` for orchestration
- Returns `AsyncIterable<FlatStreamEventUnion>` for streaming

**Method Specification**:

```typescript
/**
 * Resume a specific subagent within a parent session.
 * Uses SDK's native resume option with agent-specific prompt.
 *
 * @param parentSessionId - The parent session ID (SDK UUID)
 * @param agentId - The subagent identifier (e.g., "adcecb2")
 * @param tabId - Frontend tab ID for routing
 * @returns AsyncIterable<FlatStreamEventUnion> for streaming responses
 */
async resumeSubagent(
  parentSessionId: SessionId,
  agentId: string,
  tabId: string
): Promise<AsyncIterable<FlatStreamEventUnion>> {
  if (!this.initialized) {
    throw new Error('SdkAgentAdapter not initialized. Call initialize() first.');
  }

  this.logger.info(`[SdkAgentAdapter] Resuming subagent ${agentId} in session ${parentSessionId}`);

  // Execute query with resume option and agent prompt
  const { sdkQuery, initialModel } = await this.sessionLifecycle.executeQueryForSubagentResume({
    parentSessionId,
    agentId,
    tabId,
  });

  // Return transformed stream
  return this.streamTransformer.transform({
    sdkQuery,
    sessionId: parentSessionId,
    initialModel,
    onSessionIdResolved: this.sessionIdResolvedCallback || undefined,
    onResultStats: this.resultStatsCallback || undefined,
    tabId,
  });
}
```

**SessionLifecycleManager Extension**:

```typescript
// libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts

/**
 * Execute SDK query for subagent resumption
 */
async executeQueryForSubagentResume(config: {
  parentSessionId: string;
  agentId: string;
  tabId: string;
}): Promise<ExecuteQueryResult> {
  const { parentSessionId, agentId, tabId } = config;

  // Build resume prompt per SDK docs
  const resumePrompt = `Resume agent ${agentId} and continue where you left off`;

  // Build query options with resume parameter
  const queryOptions = await this.queryOptionsBuilder.build({
    userMessageStream: this.createUserMessageStream(parentSessionId as SessionId, abortController),
    abortController,
    sessionConfig: { tabId },
    resumeSessionId: parentSessionId, // SDK resume option
  });

  // Queue the resume prompt
  const session = this.getActiveSession(parentSessionId as SessionId);
  if (session) {
    const sdkUserMessage = await this.messageFactory.createUserMessage({
      content: resumePrompt,
      sessionId: parentSessionId as SessionId,
    });
    session.messageQueue.push(sdkUserMessage);
  }

  // Start SDK query with resume option
  const sdkQuery: Query = queryFn({
    prompt: queryOptions.prompt,
    options: queryOptions.options as Options,
  });

  return { sdkQuery, initialModel: queryOptions.options.model, abortController };
}
```

**Files Affected**:

- `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts` (MODIFY)
- `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts` (MODIFY)

---

### Component 4: InlineAgentBubbleComponent Resume Button

**Purpose**: Add "Resume" button to interrupted agent bubbles in the UI.

**Location**: `libs/frontend/chat/src/lib/components/organisms/inline-agent-bubble.component.ts`

**Pattern Evidence**:

- Component at lines 1-413 shows existing structure
- Uses `computed()` for derived state (e.g., `isInterrupted` at line 326)
- Uses DaisyUI badge/button classes
- Emits events via `output()` for parent handling

**UI Specification**:

```typescript
// Add to template (after streaming badge section, around line 107)

} @else if (isInterrupted()) {
  @if (isResumable()) {
    <button
      type="button"
      class="btn btn-xs btn-primary gap-1 flex-shrink-0"
      [disabled]="isResuming() || isExpired()"
      (click)="onResumeClick($event)"
      [title]="isExpired() ? 'Agent session expired (24+ hours)' : 'Resume agent execution'"
    >
      @if (isResuming()) {
        <lucide-angular [img]="LoaderIcon" class="w-2.5 h-2.5 animate-spin" />
        <span class="text-[9px]">Resuming</span>
      } @else {
        <lucide-angular [img]="PlayIcon" class="w-2.5 h-2.5" />
        <span class="text-[9px]">Resume</span>
      }
    </button>
  } @else {
    <span class="badge badge-xs badge-warning gap-1 flex-shrink-0">
      <lucide-angular [img]="StopCircleIcon" class="w-2.5 h-2.5" />
      <span class="text-[9px]">Stopped</span>
    </span>
  }
}
```

**Component Additions**:

```typescript
// Icons
import { Play, RefreshCw } from 'lucide-angular';
readonly PlayIcon = Play;
readonly RefreshIcon = RefreshCw;

// Inputs
readonly parentSessionId = input<string | undefined>();
readonly resumeInfo = input<ResumableSubagent | undefined>();

// Outputs
readonly resumeRequested = output<{ parentSessionId: string; agentId: string }>();

// State
readonly isResuming = signal(false);

// Computed
readonly isResumable = computed(() => {
  const info = this.resumeInfo();
  return !!info && !info.isExpired;
});

readonly isExpired = computed(() => {
  const info = this.resumeInfo();
  return info?.isExpired ?? false;
});

// Methods
protected onResumeClick(event: Event): void {
  event.stopPropagation(); // Prevent collapse toggle

  const sessionId = this.parentSessionId();
  const agentId = this.node().agentId;

  if (!sessionId || !agentId) {
    console.error('[InlineAgentBubble] Cannot resume: missing sessionId or agentId');
    return;
  }

  this.isResuming.set(true);
  this.resumeRequested.emit({ parentSessionId: sessionId, agentId });
}

// Called by parent when resume fails
public resetResumeState(): void {
  this.isResuming.set(false);
}
```

**Files Affected**:

- `libs/frontend/chat/src/lib/components/organisms/inline-agent-bubble.component.ts` (MODIFY)

---

### Component 5: ChatStore Resumable Subagents State

**Purpose**: Frontend state management for resumable subagents and notification banner.

**Location**: `libs/frontend/chat/src/lib/services/chat.store.ts`

**Pattern Evidence**:

- Facade pattern with child services (lines 24-74)
- Signal-based state (e.g., `permissionRequests` at line 140)
- RPC calls via `ClaudeRpcService`

**State Additions**:

```typescript
// New signals
private readonly _resumableSubagents = signal<ResumableSubagent[]>([]);
readonly resumableSubagents = this._resumableSubagents.asReadonly();

private readonly _showResumeBanner = signal(false);
readonly showResumeBanner = this._showResumeBanner.asReadonly();

private readonly _bannerDismissedSessions = signal<Set<string>>(new Set());

// Computed
readonly resumableCount = computed(() => this._resumableSubagents().length);

readonly shouldShowBanner = computed(() => {
  const sessionId = this.currentSessionId();
  if (!sessionId) return false;

  const dismissed = this._bannerDismissedSessions();
  if (dismissed.has(sessionId)) return false;

  return this._resumableSubagents().length > 0;
});
```

**Methods**:

```typescript
/**
 * Load resumable subagents for current session
 * Called when session is loaded
 */
async loadResumableSubagents(sessionId: string): Promise<void> {
  try {
    const resumable = await this.claudeRpcService.listResumableSubagents(sessionId);
    this._resumableSubagents.set(resumable);

    if (resumable.length > 0) {
      this._showResumeBanner.set(true);
    }
  } catch (error) {
    console.error('[ChatStore] Failed to load resumable subagents:', error);
    this._resumableSubagents.set([]);
  }
}

/**
 * Resume a specific subagent
 */
async resumeSubagent(parentSessionId: string, agentId: string): Promise<boolean> {
  const tabId = this.tabManager.activeTabId();
  if (!tabId) {
    console.error('[ChatStore] Cannot resume: no active tab');
    return false;
  }

  try {
    const result = await this.claudeRpcService.resumeSubagent({
      parentSessionId,
      agentId,
      tabId,
    });

    if (result.success) {
      // Update tab to streaming state
      this.tabManager.updateTab(tabId, { status: 'streaming' });

      // Remove from resumable list
      this._resumableSubagents.update(list =>
        list.filter(s => s.agentId !== agentId)
      );

      return true;
    } else {
      console.error('[ChatStore] Resume failed:', result.error);
      return false;
    }
  } catch (error) {
    console.error('[ChatStore] Resume error:', error);
    return false;
  }
}

/**
 * Dismiss the resume notification banner for current session
 */
dismissResumeBanner(): void {
  const sessionId = this.currentSessionId();
  if (sessionId) {
    this._bannerDismissedSessions.update(set => {
      const newSet = new Set(set);
      newSet.add(sessionId);
      return newSet;
    });
  }
  this._showResumeBanner.set(false);
}

/**
 * Scroll to first interrupted agent
 */
scrollToFirstInterruptedAgent(): void {
  // Implementation uses DOM query to find first interrupted agent bubble
  const element = document.querySelector('[data-agent-status="interrupted"]');
  element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
```

**Files Affected**:

- `libs/frontend/chat/src/lib/services/chat.store.ts` (MODIFY)
- `libs/frontend/chat/src/lib/services/chat.types.ts` (MODIFY - add types)

---

### Component 6: ClaudeRpcService Resume Methods

**Purpose**: Frontend RPC client methods for subagent operations.

**Location**: `libs/frontend/core/src/lib/services/claude-rpc.service.ts`

**Pattern Evidence**:

- Existing RPC methods use typed request/response
- Methods wrap VSCode postMessage with Promise resolution

**Method Additions**:

```typescript
/**
 * List resumable subagents for a session
 */
async listResumableSubagents(sessionId: string): Promise<ResumableSubagent[]> {
  return this.invoke<{ sessionId: string }, ResumableSubagent[]>(
    'subagent:list-resumable',
    { sessionId }
  );
}

/**
 * Resume a specific subagent
 */
async resumeSubagent(params: {
  parentSessionId: string;
  agentId: string;
  tabId: string;
}): Promise<{ success: boolean; error?: string }> {
  return this.invoke<typeof params, { success: boolean; error?: string }>(
    'subagent:resume',
    params
  );
}
```

**Files Affected**:

- `libs/frontend/core/src/lib/services/claude-rpc.service.ts` (MODIFY)

---

### Component 7: Streaming State Continuation

**Purpose**: Ensure resumed subagent content appends to existing ExecutionNode children.

**Location**: `libs/frontend/chat/src/lib/services/streaming-handler.service.ts`

**Pattern Evidence**:

- `processStreamEvent` at lines 73-401 handles event routing
- Events are stored in `StreamingState.events` Map
- Tree builder reads from StreamingState at render time

**Implementation Notes**:

The existing architecture already supports streaming continuation:

1. Events are stored flat in `StreamingState.events` Map
2. `ExecutionTreeBuilderService.buildTree()` builds tree at render time
3. New events from resumed subagent will append to existing events
4. Tree builder will include new children when rebuilding

**Verification**:

- Confirm `agentId` is preserved across resume (same agent node)
- Confirm `parentToolUseId` links events to correct agent
- Confirm tree cache invalidates on new events (cache key includes event count)

**No Code Changes Required** - existing architecture handles this.

---

### Component 8: Resume Notification Banner

**Purpose**: UI banner notifying users when session has resumable agents.

**Location**: `libs/frontend/chat/src/lib/components/molecules/resume-notification-banner.component.ts`

**Pattern Evidence**:

- DaisyUI alert component pattern
- Click handler to scroll to agent
- Dismissible via close button

**Template**:

```typescript
@Component({
  selector: 'ptah-resume-notification-banner',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (show()) {
    <div class="alert alert-info flex justify-between items-center px-4 py-2 text-sm">
      <div class="flex items-center gap-2">
        <lucide-angular [img]="InfoIcon" class="w-4 h-4" />
        <span> {{ count() }} agent {{ count() === 1 ? 'task' : 'tasks' }} can be resumed </span>
      </div>
      <div class="flex items-center gap-2">
        <button type="button" class="btn btn-xs btn-ghost" (click)="onScrollClick()">Show</button>
        <button type="button" class="btn btn-xs btn-ghost btn-square" (click)="onDismiss()">
          <lucide-angular [img]="XIcon" class="w-3 h-3" />
        </button>
      </div>
    </div>
    }
  `,
})
export class ResumeNotificationBannerComponent {
  readonly show = input.required<boolean>();
  readonly count = input.required<number>();

  readonly scrollRequested = output<void>();
  readonly dismissed = output<void>();

  readonly InfoIcon = Info;
  readonly XIcon = X;

  protected onScrollClick(): void {
    this.scrollRequested.emit();
  }

  protected onDismiss(): void {
    this.dismissed.emit();
  }
}
```

**Files Affected**:

- `libs/frontend/chat/src/lib/components/molecules/resume-notification-banner.component.ts` (CREATE)
- `libs/frontend/chat/src/index.ts` (MODIFY - export)

---

## Integration Architecture

### Event Flow: SubagentStart -> Registry

```
AgentSessionWatcherService
  │
  ├─ emit('agent-start', { agentId, agentType, sessionId, toolUseId })
  │
  ▼
SubagentRegistryService.registerSubagent({
  parentSessionId: sessionId,
  agentId,
  agentType,
  startTime: Date.now(),
  status: 'running'
})
```

### Event Flow: Session Abort -> Mark Interrupted

```
SessionLifecycleManager.endSession(sessionId)
  │
  ├─ permissionHandler.cleanupPendingPermissions(sessionId)
  ├─ abortController.abort()
  ├─ query.interrupt()
  │
  ├─ NEW: subagentRegistry.interruptSessionSubagents(sessionId)
  │
  ▼
Registry marks all 'running' agents as 'interrupted'
```

### Event Flow: User Clicks Resume

```
InlineAgentBubble: (click)="onResumeClick()"
  │
  ▼
ChatStore.resumeSubagent(parentSessionId, agentId)
  │
  ▼
ClaudeRpcService.resumeSubagent({ parentSessionId, agentId, tabId })
  │
  ▼
SubagentRpcHandlers.handleResume()
  │
  ├─ registry.markAsRunning(parentSessionId, agentId)
  ├─ sdkAdapter.resumeSubagent(parentSessionId, agentId, tabId)
  │
  ▼
SDK query starts with resume option
  │
  ▼
Streaming events flow to StreamingHandler
  │
  ▼
Tree builder appends to existing agent node
```

---

## Quality Requirements

### Functional Requirements

1. **Subagent Tracking**: All SubagentStart/Stop events captured in registry
2. **Interrupt Detection**: Session abort marks all running subagents as interrupted
3. **Resume Capability**: Interrupted agents (< 24h) can be resumed via UI
4. **Streaming Continuation**: Resumed content appends to existing agent node
5. **UI Feedback**: Loading states, error handling, success indication

### Non-Functional Requirements

| Requirement    | Target                 | Verification     |
| -------------- | ---------------------- | ---------------- |
| Resume Latency | < 3s to first event    | Manual testing   |
| Query Latency  | < 100ms                | Manual testing   |
| Memory Usage   | < 5MB for 1000 records | Memory profiling |
| TTL Cleanup    | 24h automatic          | Unit test        |

### Pattern Compliance

- **Injectable Services**: All services use `@injectable()` and constructor injection
- **Signal State**: Frontend state uses Angular signals exclusively
- **OnPush Components**: All components use `ChangeDetectionStrategy.OnPush`
- **Typed RPC**: Request/response types defined in shared library

---

## Files Affected Summary

### CREATE (6 files)

| Path                                                                                      | Purpose          |
| ----------------------------------------------------------------------------------------- | ---------------- |
| `libs/shared/src/lib/types/subagent-registry.types.ts`                                    | Type definitions |
| `libs/backend/vscode-core/src/services/subagent-registry.service.ts`                      | Backend registry |
| `apps/ptah-extension-vscode/src/services/rpc/handlers/subagent-rpc.handlers.ts`           | RPC handlers     |
| `libs/frontend/chat/src/lib/components/molecules/resume-notification-banner.component.ts` | Banner UI        |

### MODIFY (10 files)

| Path                                                                               | Changes                           |
| ---------------------------------------------------------------------------------- | --------------------------------- |
| `libs/shared/src/index.ts`                                                         | Export new types                  |
| `libs/backend/vscode-core/src/di/tokens.ts`                                        | Add SUBAGENT_REGISTRY token       |
| `libs/backend/vscode-core/src/index.ts`                                            | Export registry service           |
| `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts`                              | Add resumeSubagent method         |
| `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts`              | Add executeQueryForSubagentResume |
| `apps/ptah-extension-vscode/src/services/rpc/rpc-method-registration.service.ts`   | Register handlers                 |
| `apps/ptah-extension-vscode/src/di/container.ts`                                   | Register services                 |
| `libs/frontend/core/src/lib/services/claude-rpc.service.ts`                        | Add RPC methods                   |
| `libs/frontend/chat/src/lib/services/chat.store.ts`                                | Add resumable state               |
| `libs/frontend/chat/src/lib/components/organisms/inline-agent-bubble.component.ts` | Add resume button                 |

---

## Testing Strategy

### Unit Tests

| Component               | Test Cases                                        |
| ----------------------- | ------------------------------------------------- |
| SubagentRegistryService | Register, complete, interrupt, query, TTL cleanup |
| SubagentRpcHandlers     | List resumable, resume success/failure            |
| ChatStore               | Load resumable, resume, dismiss banner            |

### Integration Tests

1. **Full Resume Flow**: Start agent -> Interrupt -> Resume -> Verify stream
2. **TTL Expiration**: Register -> Wait 24h -> Verify not resumable
3. **Multi-Agent**: Multiple agents -> Interrupt all -> Resume specific

### Manual Testing

1. Start session with subagent task
2. Interrupt mid-execution (abort button)
3. Verify "Stopped" badge appears on agent bubble
4. Verify "Resume" button is enabled
5. Click "Resume" and verify streaming continues
6. Verify content appends to existing agent bubble

---

## Risk Mitigations

| Risk                                 | Mitigation                                       |
| ------------------------------------ | ------------------------------------------------ |
| SDK resume API changes               | Pin SDK version, monitor changelog               |
| Memory leak in registry              | 24h TTL cleanup, dispose on extension deactivate |
| Race condition on concurrent resumes | Mutex on resume operation in registry            |
| Lost events during resume            | Buffer events during state transition            |

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: **Both frontend-developer AND backend-developer**

**Rationale**:

- Backend: SubagentRegistryService, RPC handlers, SDK adapter changes
- Frontend: InlineAgentBubble, ChatStore, notification banner, RPC service

**Suggested Split**:

1. Backend developer: Components 1, 2, 3 (Registry, RPC, SDK)
2. Frontend developer: Components 4, 5, 6, 8 (UI, Store, RPC client, Banner)
3. Integration testing: Both together

### Complexity Assessment

**Complexity**: MEDIUM
**Estimated Effort**: 12-16 hours total (6-8 backend, 6-8 frontend)

### Critical Verification Points

**Before Implementation, Verify**:

1. **SDK resume parameter exists**:

   - Check SDK types for `resume` option in query options
   - Verify `sdk-query-options-builder.ts` can accept resume parameter

2. **AgentSessionWatcherService events available**:

   - Confirm 'agent-start' and 'agent-stop' events are emitted
   - Verify event payload includes required fields (agentId, sessionId, toolUseId)

3. **ExecutionNode.agentId populated**:
   - Verify `execution-node.types.ts` has `agentId` field
   - Confirm tree builder populates it from events

### Architecture Delivery Checklist

- [x] All components specified with evidence
- [x] All patterns verified from codebase
- [x] All imports/decorators verified as existing
- [x] Quality requirements defined
- [x] Integration points documented
- [x] Files affected list complete
- [x] Developer type recommended
- [x] Complexity assessed
- [x] Testing strategy defined
- [x] Risk mitigations documented
