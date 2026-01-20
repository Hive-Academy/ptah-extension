# Implementation Plan - TASK_2025_098: SDK Session Compaction

## Overview

Enable SDK built-in session compaction for long-running conversations to prevent context window exhaustion. The SDK handles compaction automatically - we need to configure it and surface notifications to the UI.

## Codebase Investigation Summary

### Libraries Analyzed

| Library     | Path                        | Key Exports Verified                                                                  |
| ----------- | --------------------------- | ------------------------------------------------------------------------------------- |
| agent-sdk   | `libs/backend/agent-sdk/`   | SdkAgentAdapter, SdkQueryOptionsBuilder, SubagentHookHandler, SessionLifecycleManager |
| shared      | `libs/shared/`              | FlatStreamEventUnion, StreamEventType, SessionId                                      |
| vscode-core | `libs/backend/vscode-core/` | TOKENS, Logger                                                                        |

### Patterns Identified

**1. Hook Implementation Pattern**

- **Evidence**: `libs/backend/agent-sdk/src/lib/helpers/subagent-hook-handler.ts:91-182`
- **Pattern**: Create hook callbacks in dedicated handler class, return from `createHooks()` method
- **Key Insight**: Hooks NEVER throw (would break SDK), always return `{ continue: true }`

**2. SDK Query Options Pattern**

- **Evidence**: `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:129-198`
- **Pattern**: Build options object with hooks, permissions, MCP servers
- **Key Insight**: `hooks` property accepts `Partial<Record<HookEvent, HookCallbackMatcher[]>>`

**3. Event Emission Pattern**

- **Evidence**: `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts:169-351`
- **Pattern**: Transform SDK messages to `FlatStreamEventUnion` for frontend consumption
- **Key Insight**: Events flow through RPC to webview via event emitter

**4. VS Code Settings Pattern**

- **Evidence**: `apps/ptah-extension-vscode/package.json:116-166`
- **Pattern**: Settings defined in `contributes.configuration.properties`
- **Key Insight**: Settings accessed via `ConfigManager.get<T>('settingName')`

### SDK Types Already Available

**From `libs/backend/agent-sdk/src/lib/types/sdk-types/claude-sdk.types.ts`**:

- `PreCompactHookInput` (lines 1034-1038) - Hook input for compaction events
- `SDKStatusMessage` with `status: 'compacting'` (lines 387-393) - Status during compaction
- `SDKCompactBoundaryMessage` (lines 373-382) - Boundary marker after compaction
- `HookEvent` includes `'PreCompact'` (line 813)

---

## Architecture Design

### Design Philosophy

**Chosen Approach**: Leverage SDK's built-in compaction with minimal custom code

**Rationale**:

1. SDK already implements automatic compaction (no custom algorithm needed)
2. We only need to configure thresholds and surface UI notifications
3. Matches existing hook patterns (SubagentHookHandler) for consistency

**Evidence**:

- SDK compaction documented in context.md research
- Existing hook pattern at subagent-hook-handler.ts:91-182

---

## Phase 1: Enable SDK Compaction (REQUIRED)

### Component 1: CompactionConfigProvider

**Purpose**: Provide compaction configuration from VS Code settings

**Pattern**: Configuration provider (similar to AuthManager configuration)

**Evidence**:

- AuthManager pattern at `libs/backend/agent-sdk/src/lib/helpers/auth-manager.ts`
- ConfigManager usage at sdk-agent-adapter.ts:173-176, 200

**Specification**:

```typescript
// Location: libs/backend/agent-sdk/src/lib/helpers/compaction-config-provider.ts

export interface CompactionConfig {
  /** Enable automatic compaction (default: true) */
  enabled: boolean;
  /** Token threshold to trigger compaction (default: 100000) */
  contextTokenThreshold: number;
}

@injectable()
export class CompactionConfigProvider {
  constructor(@inject(TOKENS.CONFIG_MANAGER) private readonly config: ConfigManager, @inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  getConfig(): CompactionConfig {
    return {
      enabled: this.config.get<boolean>('compaction.enabled') ?? true,
      contextTokenThreshold: this.config.get<number>('compaction.threshold') ?? 100000,
    };
  }
}
```

**Files Affected**:

- `libs/backend/agent-sdk/src/lib/helpers/compaction-config-provider.ts` (CREATE)
- `libs/backend/agent-sdk/src/lib/helpers/index.ts` (MODIFY - add export)
- `libs/backend/agent-sdk/src/lib/di/tokens.ts` (MODIFY - add token)
- `libs/backend/agent-sdk/src/lib/di/register.ts` (MODIFY - register service)

### Component 2: SdkQueryOptionsBuilder Enhancement

**Purpose**: Add compactionControl to SDK query options

**Pattern**: Extend existing options builder

**Evidence**: `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:167-198`

**Specification**:

```typescript
// Modify: libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts

// Add to SdkQueryOptions interface (line ~55-78):
compactionControl?: {
  enabled: boolean;
  contextTokenThreshold: number;
};

// Add to build() method (after line 153):
// Build compaction configuration
const compactionConfig = this.compactionConfigProvider.getConfig();

// In return options object (after hooks):
compactionControl: compactionConfig.enabled ? {
  enabled: true,
  contextTokenThreshold: compactionConfig.contextTokenThreshold,
} : undefined,
```

**Files Affected**:

- `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts` (MODIFY)

### Component 3: VS Code Settings

**Purpose**: Allow users to configure compaction behavior

**Pattern**: VS Code configuration properties

**Evidence**: `apps/ptah-extension-vscode/package.json:116-166`

**Specification**:

```json
// Add to apps/ptah-extension-vscode/package.json contributes.configuration.properties:

"ptah.compaction.enabled": {
  "type": "boolean",
  "default": true,
  "description": "Enable automatic context compaction for long sessions. When enabled, Claude will summarize conversation history to stay within context limits."
},
"ptah.compaction.threshold": {
  "type": "number",
  "default": 100000,
  "minimum": 50000,
  "maximum": 500000,
  "description": "Token threshold to trigger automatic compaction (default: 100,000 tokens)."
}
```

**Files Affected**:

- `apps/ptah-extension-vscode/package.json` (MODIFY)

---

## Phase 2: UI Notification (RECOMMENDED)

### Component 4: CompactionHookHandler

**Purpose**: Handle PreCompact hooks and emit events to webview

**Pattern**: Hook handler (same as SubagentHookHandler)

**Evidence**: `libs/backend/agent-sdk/src/lib/helpers/subagent-hook-handler.ts:91-182`

**Specification**:

```typescript
// Location: libs/backend/agent-sdk/src/lib/helpers/compaction-hook-handler.ts

import type { PreCompactHookInput, HookCallbackMatcher, HookEvent, HookJSONOutput, HookInput } from '../types/sdk-types/claude-sdk.types';

@injectable()
export class CompactionHookHandler {
  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger, @inject(TOKENS.EVENT_BUS) private readonly eventBus: EventBus) {}

  /**
   * Create PreCompact hook for SDK query options
   * Emits 'session:compacting' event when compaction starts
   */
  createHooks(sessionId: string): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
    return {
      PreCompact: [
        {
          hooks: [
            async (input: HookInput): Promise<HookJSONOutput> => {
              if (input.hook_event_name !== 'PreCompact') {
                return { continue: true };
              }

              const preCompactInput = input as PreCompactHookInput;

              this.logger.info('[CompactionHookHandler] PreCompact hook triggered', {
                sessionId,
                trigger: preCompactInput.trigger,
              });

              // Emit event for UI notification
              this.eventBus.emit('session:compacting', {
                sessionId,
                trigger: preCompactInput.trigger, // 'manual' | 'auto'
                timestamp: Date.now(),
              });

              // Never block compaction
              return { continue: true };
            },
          ],
        },
      ],
    };
  }
}
```

**Files Affected**:

- `libs/backend/agent-sdk/src/lib/helpers/compaction-hook-handler.ts` (CREATE)
- `libs/backend/agent-sdk/src/lib/helpers/index.ts` (MODIFY - add export)
- `libs/backend/agent-sdk/src/lib/di/tokens.ts` (MODIFY - add token)
- `libs/backend/agent-sdk/src/lib/di/register.ts` (MODIFY - register service)

### Component 5: Hook Integration in SdkQueryOptionsBuilder

**Purpose**: Merge compaction hooks with existing hooks

**Pattern**: Hook composition

**Evidence**: `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:249-265`

**Specification**:

```typescript
// Modify createHooks() in sdk-query-options-builder.ts to merge hooks:

private createHooks(
  cwd: string,
  sessionId: string
): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  // Existing subagent hooks
  const subagentHooks = this.subagentHookHandler.createHooks(cwd);

  // New compaction hooks
  const compactionHooks = this.compactionHookHandler.createHooks(sessionId);

  // Merge hooks - both can coexist on different events
  const mergedHooks: Partial<Record<HookEvent, HookCallbackMatcher[]>> = {
    ...subagentHooks,
    ...compactionHooks,
  };

  this.logger.info('[SdkQueryOptionsBuilder] SDK hooks created for session', {
    cwd,
    sessionId,
    hookEvents: Object.keys(mergedHooks),
  });

  return mergedHooks;
}
```

**Files Affected**:

- `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts` (MODIFY)

### Component 6: New Event Type for Compaction

**Purpose**: Define typed event for compaction notifications

**Pattern**: Event type definition

**Evidence**: `libs/shared/src/lib/types/execution-node.types.ts:718-907` (FlatStreamEventUnion)

**Specification**:

```typescript
// Add to libs/shared/src/lib/types/execution-node.types.ts

/**
 * Compaction event - notifies UI that context compaction is starting
 * TASK_2025_098: SDK Session Compaction
 */
export interface CompactionStartEvent extends FlatStreamEvent {
  readonly eventType: 'compaction_start';
  readonly trigger: 'manual' | 'auto';
}

// Update FlatStreamEventUnion to include:
export type FlatStreamEventUnion = MessageStartEvent | TextDeltaEvent | ThinkingStartEvent | ThinkingDeltaEvent | ToolStartEvent | ToolDeltaEvent | ToolResultEvent | AgentStartEvent | MessageCompleteEvent | MessageDeltaEvent | SignatureDeltaEvent | CompactionStartEvent; // NEW

// Update StreamEventType to include:
export type StreamEventType = 'message_start' | 'text_delta' | 'thinking_start' | 'thinking_delta' | 'tool_start' | 'tool_delta' | 'tool_result' | 'agent_start' | 'message_complete' | 'message_delta' | 'signature_delta' | 'compaction_start'; // NEW
```

**Files Affected**:

- `libs/shared/src/lib/types/execution-node.types.ts` (MODIFY)

### Component 7: Frontend Notification Component

**Purpose**: Display toast/banner when compaction occurs

**Pattern**: Notification banner (similar to ResumeNotificationBannerComponent)

**Evidence**: `libs/frontend/chat/src/lib/components/molecules/resume-notification-banner.component.ts`

**Specification**:

```typescript
// Location: libs/frontend/chat/src/lib/components/molecules/compaction-notification.component.ts

@Component({
  selector: 'ptah-compaction-notification',
  imports: [LucideAngularModule],
  template: `
    @if (isCompacting()) {
    <div class="alert alert-warning shadow-lg mb-4 py-2 px-3 animate-pulse">
      <div class="flex items-center gap-2">
        <lucide-angular [img]="RefreshCwIcon" class="w-5 h-5 animate-spin" />
        <div>
          <h3 class="font-bold text-sm">Optimizing Context</h3>
          <p class="text-xs opacity-80">Summarizing conversation history to continue...</p>
        </div>
      </div>
    </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CompactionNotificationComponent {
  readonly isCompacting = input.required<boolean>();
  protected readonly RefreshCwIcon = RefreshCw;
}
```

**Files Affected**:

- `libs/frontend/chat/src/lib/components/molecules/compaction-notification.component.ts` (CREATE)
- `libs/frontend/chat/src/lib/components/index.ts` (MODIFY - add export)

### Component 8: ChatStore Compaction State

**Purpose**: Track compaction state in frontend store

**Pattern**: Signal-based state

**Evidence**: `libs/frontend/chat/src/lib/services/chat.store.ts`

**Specification**:

```typescript
// Add to ChatStore:

// State signal
private readonly _isCompacting = signal(false);
readonly isCompacting = this._isCompacting.asReadonly();

// Method to handle compaction event
handleCompactionStart(sessionId: string): void {
  if (sessionId === this.activeSessionId()) {
    this._isCompacting.set(true);

    // Auto-clear after 10 seconds (compaction typically completes quickly)
    setTimeout(() => this._isCompacting.set(false), 10000);
  }
}

// Method called when new message received (compaction complete)
handleMessageReceived(): void {
  this._isCompacting.set(false);
}
```

**Files Affected**:

- `libs/frontend/chat/src/lib/services/chat.store.ts` (MODIFY)

### Component 9: RPC Event Handler

**Purpose**: Route compaction events from backend to frontend

**Pattern**: RPC event subscription

**Evidence**: Existing pattern in RpcMethodRegistrationService for session events

**Specification**:

```typescript
// Backend: Emit event via RPC
// In stream-transformer.ts or rpc-method-registration.service.ts:

// Listen for EventBus 'session:compacting' and forward to webview
this.eventBus.on('session:compacting', (data) => {
  this.rpcProvider.sendToWebview('session:compacting', data);
});

// Frontend: Subscribe in ChatStore or dedicated service
this.rpcService.on<{ sessionId: string; trigger: string }>('session:compacting', (data) => {
  this.chatStore.handleCompactionStart(data.sessionId);
});
```

**Files Affected**:

- Backend RPC registration (MODIFY)
- Frontend RPC subscription (MODIFY)

---

## Phase 3: Server-Side Context Editing (OPTIONAL)

**Status**: DEFERRED

**Rationale**:

1. Requires beta API header `context-management-2025-06-27`
2. SDK compaction (Phase 1-2) provides 84% token reduction already
3. Can be added later if needed for file-heavy sessions

**Future Implementation Notes**:

- Add beta header to SDK options
- Configure `context_management.edits` for tool result clearing
- Track which tools to preserve (e.g., web_search results)

---

## Phase 4: Extended Context Beta (OPTIONAL)

**Status**: DEFERRED

**Rationale**:

1. Requires beta header `context-1m-2025-08-07`
2. 1M context is overkill for most sessions
3. Higher cost per token
4. Can be added as user preference later

**Future Implementation Notes**:

- Add VS Code setting `ptah.context.extendedContextBeta`
- Add beta header when enabled
- Update UI to show 1M limit instead of 200K

---

## Integration Points Summary

### Data Flow

```
VS Code Settings
       |
       v
CompactionConfigProvider
       |
       v
SdkQueryOptionsBuilder ---> SDK query() with compactionControl
       |
       v
SDK detects threshold exceeded
       |
       v
PreCompact hook fires
       |
       v
CompactionHookHandler
       |
       v
EventBus.emit('session:compacting')
       |
       v
RPC to Webview
       |
       v
ChatStore.handleCompactionStart()
       |
       v
CompactionNotificationComponent shows banner
       |
       v
SDK completes compaction
       |
       v
New message received
       |
       v
ChatStore.handleMessageReceived() clears banner
```

### Dependencies

```
CompactionConfigProvider
  └── ConfigManager (TOKENS.CONFIG_MANAGER)
  └── Logger (TOKENS.LOGGER)

CompactionHookHandler
  └── Logger (TOKENS.LOGGER)
  └── EventBus (TOKENS.EVENT_BUS)

SdkQueryOptionsBuilder (modified)
  └── CompactionConfigProvider (NEW)
  └── CompactionHookHandler (NEW)
  └── SubagentHookHandler (existing)
```

---

## Quality Requirements

### Functional Requirements

1. **Automatic Compaction**: Sessions exceeding threshold must compact automatically
2. **User Notification**: UI must show indicator when compaction is active
3. **Configuration**: Users must be able to enable/disable and set threshold
4. **Seamless Resume**: Conversation must continue normally after compaction

### Non-Functional Requirements

1. **Performance**: Hook handler must not block SDK (<10ms execution)
2. **Reliability**: Compaction must not fail silently (log all events)
3. **UX**: Notification must auto-dismiss when compaction completes
4. **Backward Compatibility**: Default enabled with 100K threshold

### Pattern Compliance

- Hook handlers never throw (evidence: subagent-hook-handler.ts:271-276)
- Signal-based state in frontend (evidence: chat.store.ts patterns)
- Injectable services with DI tokens (evidence: di/tokens.ts, di/register.ts)
- VS Code settings in package.json (evidence: existing settings structure)

---

## Testing Considerations

### Unit Tests

1. **CompactionConfigProvider**

   - Default values when settings not set
   - Custom values from ConfigManager
   - Invalid values handled gracefully

2. **CompactionHookHandler**

   - Hook returns `{ continue: true }` always
   - EventBus.emit called with correct payload
   - Handles non-PreCompact inputs gracefully

3. **SdkQueryOptionsBuilder**
   - compactionControl included when enabled
   - compactionControl omitted when disabled
   - Hooks merged correctly

### Integration Tests

1. **End-to-End Compaction Flow**
   - Simulate session approaching threshold
   - Verify SDK receives compactionControl options
   - Verify PreCompact hook fires
   - Verify frontend receives notification

### Manual Testing

1. Start long session with many tool calls
2. Monitor token usage approaching 100K
3. Observe compaction notification appears
4. Verify conversation continues normally
5. Test with compaction disabled - verify no compaction occurs

---

## Risk Assessment

| Risk                               | Impact | Likelihood | Mitigation                                |
| ---------------------------------- | ------ | ---------- | ----------------------------------------- |
| SDK compactionControl API changes  | Medium | Low        | Pin SDK version, monitor changelog        |
| Hook throws and breaks SDK         | High   | Low        | Wrap in try-catch, always return continue |
| Frontend notification never clears | Low    | Medium     | Auto-dismiss timeout (10s)                |
| Compaction loses important context | Medium | Low        | SDK handles summary generation            |
| Performance impact from hooks      | Low    | Low        | Hooks are async, non-blocking             |

---

## Files Affected Summary

### CREATE

| File                                                                                   | Purpose                 |
| -------------------------------------------------------------------------------------- | ----------------------- |
| `libs/backend/agent-sdk/src/lib/helpers/compaction-config-provider.ts`                 | Configuration provider  |
| `libs/backend/agent-sdk/src/lib/helpers/compaction-hook-handler.ts`                    | PreCompact hook handler |
| `libs/frontend/chat/src/lib/components/molecules/compaction-notification.component.ts` | UI notification         |

### MODIFY

| File                                                                     | Change                             |
| ------------------------------------------------------------------------ | ---------------------------------- |
| `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts`    | Add compactionControl, merge hooks |
| `libs/backend/agent-sdk/src/lib/helpers/index.ts`                        | Export new services                |
| `libs/backend/agent-sdk/src/lib/di/tokens.ts`                            | Add DI tokens                      |
| `libs/backend/agent-sdk/src/lib/di/register.ts`                          | Register services                  |
| `libs/shared/src/lib/types/execution-node.types.ts`                      | Add CompactionStartEvent           |
| `libs/frontend/chat/src/lib/services/chat.store.ts`                      | Add compaction state               |
| `libs/frontend/chat/src/lib/components/index.ts`                         | Export notification component      |
| `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts` | Add notification component         |
| `apps/ptah-extension-vscode/package.json`                                | Add compaction settings            |
| Backend RPC registration                                                 | Forward compaction events          |
| Frontend RPC subscription                                                | Handle compaction events           |

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: backend-developer (Phase 1-2), frontend-developer (Phase 2 UI)

**Rationale**:

- Phase 1 is entirely backend (SDK options, configuration)
- Phase 2 hooks are backend but UI notification is frontend
- Can be done sequentially: backend first, then frontend

### Complexity Assessment

**Complexity**: MEDIUM
**Estimated Effort**: 6-8 hours

**Breakdown**:

- Phase 1 (Enable SDK Compaction): 2-3 hours
- Phase 2 (UI Notification): 3-4 hours
- Testing & Integration: 1-2 hours

### Critical Verification Points

**Before Implementation, Team-Leader Must Ensure Developer Verifies**:

1. **All imports exist in codebase**:

   - `HookEvent`, `HookCallbackMatcher`, `HookJSONOutput` from `claude-sdk.types.ts`
   - `PreCompactHookInput` from `claude-sdk.types.ts:1034-1038`
   - `ConfigManager` from `@ptah-extension/vscode-core`
   - `EventBus` from `@ptah-extension/vscode-core`

2. **All patterns verified from examples**:

   - SubagentHookHandler for hook implementation pattern
   - AuthManager for configuration provider pattern
   - ResumeNotificationBannerComponent for UI notification pattern

3. **Library documentation consulted**:

   - `libs/backend/agent-sdk/CLAUDE.md`
   - `libs/frontend/chat/CLAUDE.md`

4. **No hallucinated APIs**:
   - All SDK types verified in `claude-sdk.types.ts`
   - All event bus methods verified in vscode-core
   - All config manager methods verified

### Architecture Delivery Checklist

- [x] All components specified with evidence
- [x] All patterns verified from codebase
- [x] All imports/decorators verified as existing
- [x] Quality requirements defined
- [x] Integration points documented
- [x] Files affected list complete
- [x] Developer type recommended
- [x] Complexity assessed
- [x] Risk assessment included
