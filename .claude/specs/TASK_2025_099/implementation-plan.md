# Implementation Plan - TASK_2025_099

## Real-Time Subagent Text Streaming via SDK Hooks

---

## Codebase Investigation Summary

### Libraries Discovered

| Library                          | Purpose                             | Key Files                                          |
| -------------------------------- | ----------------------------------- | -------------------------------------------------- |
| `@ptah-extension/agent-sdk`      | SDK integration, session management | `sdk-agent-adapter.ts`, `di/register.ts`           |
| `@ptah-extension/vscode-core`    | Infrastructure, watcher service     | `agent-session-watcher.service.ts`, `di/tokens.ts` |
| `@anthropic-ai/claude-agent-sdk` | Official SDK (v0.1.69)              | `agentSdkTypes.d.ts` - hook types                  |

### SDK Hook Types (Verified from `agentSdkTypes.d.ts:234-244`)

```typescript
// SubagentStart - fires when subagent initializes
type SubagentStartHookInput = BaseHookInput & {
  hook_event_name: 'SubagentStart';
  agent_id: string; // Unique subagent identifier
  agent_type: string; // e.g., "software-architect"
};

// SubagentStop - fires when subagent completes
type SubagentStopHookInput = BaseHookInput & {
  hook_event_name: 'SubagentStop';
  stop_hook_active: boolean;
  agent_id: string;
  agent_transcript_path: string; // Path to JSONL (available at completion)
};

// BaseHookInput (common fields)
type BaseHookInput = {
  session_id: string;
  transcript_path: string;
  cwd: string;
  permission_mode?: string;
};

// Hook configuration format (agentSdkTypes.d.ts:177-182)
interface HookCallbackMatcher {
  matcher?: string;
  hooks: HookCallback[];
  timeout?: number;
}

// Hook callback signature (agentSdkTypes.d.ts:174-176)
type HookCallback = (input: HookInput, toolUseID: string | undefined, options: { signal: AbortSignal }) => Promise<HookJSONOutput>;
```

### Existing Infrastructure Analysis

**AgentSessionWatcherService** (`libs/backend/vscode-core/src/services/agent-session-watcher.service.ts`)

| Component                      | Status                 | Evidence                                         |
| ------------------------------ | ---------------------- | ------------------------------------------------ |
| Directory watcher (`fs.watch`) | Exists                 | Lines 170-174                                    |
| Active watches Map             | Exists                 | Line 55: `Map<string, ActiveWatch>`              |
| File tailing (200ms)           | Exists                 | Lines 340-342                                    |
| Text extraction                | Exists                 | Lines 420-435                                    |
| `summary-chunk` event emission | Exists                 | Line 396                                         |
| `startWatching()` signature    | **Needs modification** | Line 83-86: accepts `toolUseId`, needs `agentId` |
| Pending file cache             | Exists                 | Lines 64-67                                      |

**Current `startWatching()` Signature (Line 83-109)**:

```typescript
async startWatching(
  toolUseId: string,   // Currently primary key
  sessionId: string,   // Used for file matching
  workspacePath: string
): Promise<void>
```

**RpcMethodRegistrationService** (`apps/ptah-extension-vscode/src/services/rpc/rpc-method-registration.service.ts`)

| Component                          | Status | Evidence      |
| ---------------------------------- | ------ | ------------- |
| Agent watcher listener             | Exists | Lines 220-234 |
| `AGENT_SUMMARY_CHUNK` message type | Exists | Line 227      |

**SdkAgentAdapter** (`libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts`)

| Component                    | Status      | Evidence                  |
| ---------------------------- | ----------- | ------------------------- |
| `buildQueryOptions()` method | Exists      | Lines 161-279             |
| Hooks configuration          | **Missing** | Not in return object      |
| DI injection points          | Exist       | Constructor lines 136-155 |

---

## Architecture Design

### Design Philosophy

**Chosen Approach**: Inject `AgentSessionWatcherService` into `SdkAgentAdapter` via DI, add hooks configuration to `buildQueryOptions()`.

**Rationale**:

1. Minimal changes - infrastructure is 90% complete
2. Follows existing DI patterns (evidence: `SdkPermissionHandler` injection at line 154)
3. Single directory watcher shared across agents (efficiency)

**Evidence**: Similar service injection pattern at lines 150-154 of `sdk-agent-adapter.ts`.

### Data Flow Diagram

```
                    SDK Query Start
                         |
                         v
    +--------------------+--------------------+
    |        SdkAgentAdapter                  |
    |  buildQueryOptions() adds hooks:        |
    |    SubagentStart -> startWatching()     |
    |    SubagentStop  -> stopWatching()      |
    +--------------------+--------------------+
                         |
                         v
    +--------------------+--------------------+
    |     AgentSessionWatcherService          |
    |  - Stores agentId -> watch mapping      |
    |  - Watches ~/.claude/projects/{path}/   |
    |  - Pattern: agent-{agent_id}.jsonl      |
    +--------------------+--------------------+
                         |
              fs.watch detects file
                         |
                         v
    +--------------------+--------------------+
    |         File Tailing (200ms)            |
    |  - Read new JSONL lines                 |
    |  - Extract text blocks                  |
    |  - Emit 'summary-chunk' event           |
    +--------------------+--------------------+
                         |
                         v
    +--------------------+--------------------+
    |    RpcMethodRegistrationService         |
    |  - Listens to 'summary-chunk'           |
    |  - Sends AGENT_SUMMARY_CHUNK to webview |
    +--------------------+--------------------+
                         |
                         v
    +--------------------+--------------------+
    |           Webview (Existing)            |
    |  - Handles AGENT_SUMMARY_CHUNK          |
    |  - Routes to ExecutionNode by toolUseId |
    +--------------------+--------------------+
```

### Component Specifications

#### Component 1: SDK Hook Types

**Purpose**: Add type definitions for SDK hooks to centralized types file.

**Pattern**: Extend existing SDK types (evidence: `claude-sdk.types.ts` lines 1-793)

**Responsibilities**:

- Define `SubagentStartHookInput` type
- Define `SubagentStopHookInput` type
- Define `HookCallbackMatcher` type
- Export from index.ts

**Files Affected**:

- `libs/backend/agent-sdk/src/lib/types/sdk-types/claude-sdk.types.ts` (MODIFY)
- `libs/backend/agent-sdk/src/index.ts` (MODIFY - export new types)

**Quality Requirements**:

- Types must match SDK v0.1.69 exactly
- All type guards must be type-safe

---

#### Component 2: AgentSessionWatcherService Signature Update

**Purpose**: Modify `startWatching()` to accept `agentId` for pattern-based early detection.

**Pattern**: Map-based tracking with agentId as primary key (evidence: existing Map at line 55)

**Current Signature (Line 83-86)**:

```typescript
startWatching(toolUseId: string, sessionId: string, workspacePath: string): Promise<void>
```

**New Signature**:

```typescript
startWatching(
  agentId: string,           // Primary key (from SubagentStart)
  sessionId: string,         // For session context
  workspacePath: string,
  toolUseId?: string         // Optional - may not be known at start
): Promise<void>

// New method for updating toolUseId when SubagentStop provides it
setToolUseId(agentId: string, toolUseId: string): void
```

**Responsibilities**:

- Track watches by `agentId` (primary key)
- Use pattern `agent-{agent_id}.jsonl` for early file detection
- Store `toolUseId` when available (from `SubagentStop`)
- Include `toolUseId` in emitted chunks for UI routing

**Interface Changes**:

```typescript
interface ActiveWatch {
  agentId: string; // NEW: Primary identifier
  sessionId: string;
  toolUseId: string | null; // CHANGED: nullable, set later
  startTime: number;
  agentFilePath: string | null;
  fileOffset: number;
  summaryContent: string;
  tailInterval: NodeJS.Timeout | null;
}
```

**Files Affected**:

- `libs/backend/vscode-core/src/services/agent-session-watcher.service.ts` (MODIFY)

**Quality Requirements**:

- Must handle N concurrent agents (no hardcoded limits)
- `toolUseId` must be included in `summary-chunk` events when available
- Cleanup must be O(1) using Map

---

#### Component 3: Hook Handler Service

**Purpose**: Encapsulate hook callback logic in a dedicated service for testability.

**Pattern**: Injected helper service pattern (evidence: `SdkPermissionHandler` injection)

**Responsibilities**:

- Create `SubagentStart` callback that calls `startWatching()`
- Create `SubagentStop` callback that calls `stopWatching()` and sets `toolUseId`
- Handle errors gracefully (log but don't throw)
- Return `{ continue: true }` for all hooks (don't block SDK)

**Implementation Pattern**:

```typescript
@injectable()
export class SubagentHookHandler {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.AGENT_SESSION_WATCHER_SERVICE)
    private readonly agentWatcher: AgentSessionWatcherService
  ) {}

  createHooks(workspacePath: string): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
    return {
      SubagentStart: [
        {
          hooks: [
            async (input, toolUseId) => {
              const startInput = input as SubagentStartHookInput;
              await this.agentWatcher.startWatching(
                startInput.agent_id,
                startInput.session_id,
                workspacePath,
                toolUseId // May be undefined at start
              );
              return { continue: true };
            },
          ],
        },
      ],
      SubagentStop: [
        {
          hooks: [
            async (input, toolUseId) => {
              const stopInput = input as SubagentStopHookInput;
              if (toolUseId) {
                this.agentWatcher.setToolUseId(stopInput.agent_id, toolUseId);
              }
              this.agentWatcher.stopWatching(stopInput.agent_id);
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

- `libs/backend/agent-sdk/src/lib/helpers/subagent-hook-handler.ts` (CREATE)
- `libs/backend/agent-sdk/src/lib/helpers/index.ts` (MODIFY - export)
- `libs/backend/agent-sdk/src/lib/di/tokens.ts` (MODIFY - add token)
- `libs/backend/agent-sdk/src/lib/di/register.ts` (MODIFY - register)

**Quality Requirements**:

- Hooks must never throw (would break SDK)
- Logging for all lifecycle events (debug level)
- Unit testable without file system access

---

#### Component 4: SdkAgentAdapter Hook Integration

**Purpose**: Inject `SubagentHookHandler` and add hooks to `buildQueryOptions()`.

**Pattern**: Constructor injection (evidence: lines 136-155)

**Responsibilities**:

- Inject `SubagentHookHandler` via DI
- Call `createHooks()` in `buildQueryOptions()`
- Add hooks to query options return value

**Changes to `buildQueryOptions()` (lines 161-279)**:

```typescript
// Add to constructor parameters (line 154)
@inject(SDK_TOKENS.SDK_SUBAGENT_HOOK_HANDLER)
private readonly subagentHookHandler: SubagentHookHandler

// Add to buildQueryOptions return (around line 240)
return {
  prompt: userMessageStream,
  options: {
    // ... existing options ...
    hooks: this.subagentHookHandler.createHooks(cwd),  // NEW
  }
};
```

**Files Affected**:

- `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts` (MODIFY)

**Quality Requirements**:

- Hooks must be optional (SDK works without them)
- No breaking changes to existing `buildQueryOptions()` callers

---

#### Component 5: DI Registration Updates

**Purpose**: Register new services in DI container.

**Pattern**: Token registration (evidence: `register.ts` lines 82-143)

**Responsibilities**:

- Add `SDK_SUBAGENT_HOOK_HANDLER` token
- Register `SubagentHookHandler` as singleton
- Ensure correct dependency resolution order

**Files Affected**:

- `libs/backend/agent-sdk/src/lib/di/tokens.ts` (MODIFY)
- `libs/backend/agent-sdk/src/lib/di/register.ts` (MODIFY)

---

## Integration Architecture

### Integration Points

| From                         | To                           | Pattern         | Evidence                             |
| ---------------------------- | ---------------------------- | --------------- | ------------------------------------ |
| SdkAgentAdapter              | SubagentHookHandler          | DI injection    | Constructor injection pattern        |
| SubagentHookHandler          | AgentSessionWatcherService   | DI injection    | TOKENS.AGENT_SESSION_WATCHER_SERVICE |
| AgentSessionWatcherService   | RpcMethodRegistrationService | Event emitter   | `summary-chunk` event (line 396)     |
| RpcMethodRegistrationService | Webview                      | Message posting | `MESSAGE_TYPES.AGENT_SUMMARY_CHUNK`  |

### Dependency Chain

```
SdkAgentAdapter
  --> SubagentHookHandler (NEW)
      --> AgentSessionWatcherService (EXISTING)
          --> EventEmitter.emit('summary-chunk')
              --> RpcMethodRegistrationService listener (EXISTING)
                  --> WebviewManager.sendMessage() (EXISTING)
```

### Cross-Library Dependency

**New Dependency**: `@ptah-extension/agent-sdk` -> `@ptah-extension/vscode-core`

This dependency already exists (evidence: `sdk-agent-adapter.ts` line 30 imports from `@ptah-extension/vscode-core`).

---

## Quality Requirements

### Functional Requirements

1. **SubagentStart Hook**: Must trigger `startWatching()` within 100ms of SDK callback
2. **SubagentStop Hook**: Must trigger `stopWatching()` and set `toolUseId`
3. **File Detection**: Must detect `agent-{agent_id}.jsonl` pattern within 200ms
4. **Text Streaming**: Must emit `summary-chunk` within 200ms of file write
5. **Concurrent Agents**: Must support N concurrent agents (no hardcoded limit)

### Non-Functional Requirements

| Category    | Requirement            | Evidence                           |
| ----------- | ---------------------- | ---------------------------------- |
| Performance | Detection < 200ms      | Existing 200ms polling (line 342)  |
| Memory      | < 10MB for 10 agents   | Map-based tracking                 |
| CPU         | Native fs.watch        | Existing implementation (line 170) |
| Reliability | Graceful timeout (60s) | Existing timeout logic             |

### Pattern Compliance

- **DI Pattern**: All services injectable via tsyringe (evidence: existing patterns)
- **Event Pattern**: Use EventEmitter for decoupled communication (evidence: line 396)
- **Error Handling**: Log errors, don't throw from hooks (SDK best practice)

---

## Files Affected Summary

### CREATE

| File                                                              | Purpose             |
| ----------------------------------------------------------------- | ------------------- |
| `libs/backend/agent-sdk/src/lib/helpers/subagent-hook-handler.ts` | Hook callback logic |

### MODIFY

| File                                                                     | Changes                                |
| ------------------------------------------------------------------------ | -------------------------------------- |
| `libs/backend/agent-sdk/src/lib/types/sdk-types/claude-sdk.types.ts`     | Add hook types                         |
| `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts`                    | Inject hook handler, add to options    |
| `libs/backend/agent-sdk/src/lib/helpers/index.ts`                        | Export hook handler                    |
| `libs/backend/agent-sdk/src/lib/di/tokens.ts`                            | Add hook handler token                 |
| `libs/backend/agent-sdk/src/lib/di/register.ts`                          | Register hook handler                  |
| `libs/backend/agent-sdk/src/index.ts`                                    | Export hook types                      |
| `libs/backend/vscode-core/src/services/agent-session-watcher.service.ts` | Update signature, add agentId tracking |

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: `backend-developer`

**Rationale**:

1. All changes are in backend libraries (`agent-sdk`, `vscode-core`)
2. No frontend/UI changes required
3. DI configuration and service registration
4. File system watching (Node.js APIs)
5. TypeScript type definitions

### Complexity Assessment

**Complexity**: MEDIUM

**Estimated Effort**: 4-6 hours

**Breakdown**:

- SDK hook types: 30 min
- AgentSessionWatcherService changes: 1.5 hours
- SubagentHookHandler implementation: 1.5 hours
- SdkAgentAdapter integration: 1 hour
- DI registration: 30 min
- Testing & verification: 1 hour

### Critical Verification Points

**Before Implementation, Developer Must Verify**:

1. **Hook types match SDK v0.1.69**:

   - `SubagentStartHookInput` from `agentSdkTypes.d.ts:234-238`
   - `SubagentStopHookInput` from `agentSdkTypes.d.ts:239-244`
   - `HookCallbackMatcher` from `agentSdkTypes.d.ts:177-182`

2. **AgentSessionWatcherService exports**:

   - `AgentSummaryChunk` interface includes `toolUseId` (line 29)
   - Event name is `summary-chunk` (line 396)

3. **DI tokens exist**:

   - `TOKENS.AGENT_SESSION_WATCHER_SERVICE` (verified: `tokens.ts:48`)
   - `TOKENS.LOGGER` (verified: common usage)

4. **SDK query accepts hooks**:
   - `options.hooks` property (verified: `agentSdkTypes.d.ts:806`)

### Architecture Delivery Checklist

- [x] All components specified with evidence
- [x] All patterns verified from codebase
- [x] All imports/decorators verified as existing
- [x] Quality requirements defined
- [x] Integration points documented
- [x] Files affected list complete
- [x] Developer type recommended
- [x] Complexity assessed
- [x] No step-by-step implementation (team-leader's job)

---

## Testing Strategy

### Unit Tests

| Component                  | Test Cases                                                         |
| -------------------------- | ------------------------------------------------------------------ |
| SubagentHookHandler        | Hook callback returns `{ continue: true }`, calls watcher methods  |
| AgentSessionWatcherService | `startWatching()` with agentId, `setToolUseId()`, `stopWatching()` |

### Integration Tests

| Scenario                   | Verification                                 |
| -------------------------- | -------------------------------------------- |
| Single subagent lifecycle  | Start -> file detection -> streaming -> stop |
| Multiple concurrent agents | N agents tracked independently               |
| Agent ID correlation       | Correct toolUseId in summary-chunk events    |

### Manual Testing

1. Run `/orchestrate` command with Task tool
2. Verify subagent text appears in ExecutionNode
3. Verify multiple concurrent subagents stream independently
4. Verify cleanup when agents complete

---

## Appendix: SDK Hook Documentation

From `@anthropic-ai/claude-agent-sdk@0.1.69`:

```typescript
// Hook configuration in query options (agentSdkTypes.d.ts:806)
hooks?: Partial<Record<HookEvent, HookCallbackMatcher[]>>;

// Example from SDK documentation (agentSdkTypes.d.ts:799-801)
// hooks: {
//   SubagentStart: [{
//     hooks: [async (input) => ({ continue: true })]
//   }]
// }
```

**Key Points**:

- Hooks are optional
- Multiple hooks per event supported
- Must return `HookJSONOutput` (typically `{ continue: true }`)
- `toolUseID` parameter available in callback
- `signal: AbortSignal` for cancellation handling
