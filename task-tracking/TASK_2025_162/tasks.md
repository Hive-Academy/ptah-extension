# Development Tasks - TASK_2025_162: Copilot SDK Integration

**Total Tasks**: 15 | **Batches**: 5 | **Status**: 1/5 complete

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS

### Assumptions Verified

- `@github/copilot-sdk` v0.1.25 installed at `node_modules/@github/copilot-sdk/` -- VERIFIED
- `CopilotClient` exported from `@github/copilot-sdk` -- VERIFIED (`dist/index.d.ts:6`)
- `CopilotSession` exported with `on()`, `send()`, `sendAndWait()`, `abort()`, `destroy()` -- VERIFIED (`dist/session.d.ts`)
- `SessionConfig` has `hooks: SessionHooks`, `onPermissionRequest`, `onUserInputRequest`, `tools`, `sessionId`, `model`, `streaming`, `workingDirectory`, `mcpServers` -- VERIFIED (`dist/types.d.ts:497-586`)
- `resumeSession(sessionId: string, config?: ResumeSessionConfig)` signature -- VERIFIED (`dist/client.d.ts:171`) -- NOTE: first arg is `sessionId` string directly, NOT `{ sessionId }` object
- `PermissionHandler` type: `(request: PermissionRequest, invocation: { sessionId: string }) => Promise<PermissionRequestResult>` -- VERIFIED (`dist/types.d.ts:179-181`)
- `PermissionRequest` has `kind: "shell" | "write" | "mcp" | "read" | "url"` and `toolCallId?` -- VERIFIED (`dist/types.d.ts:170-174`)
- `PermissionRequestResult` has `kind: "approved" | "denied-by-rules" | "denied-no-approval-rule-and-could-not-request-from-user" | "denied-interactively-by-user"` -- VERIFIED (`dist/types.d.ts:175-178`) -- NOTE: NOT `permissionDecision` as research doc states for handler return
- `PreToolUseHookInput` has `toolName: string`, `toolArgs: unknown` (NOT string) -- VERIFIED (`dist/types.d.ts:229-232`)
- `PreToolUseHookOutput` has `permissionDecision?: "allow" | "deny" | "ask"` -- VERIFIED (`dist/types.d.ts:237-242`)
- Session events: `assistant.message_delta`, `assistant.message`, `tool.execution_start`, `tool.execution_complete`, `session.idle`, `session.error`, `session.start` -- VERIFIED (`dist/generated/session-events.d.ts`)
- `assistant.message_delta.data.deltaContent` -- VERIFIED (line 381)
- `tool.execution_start.data.toolName`, `tool.execution_start.data.toolCallId` -- VERIFIED (lines 450-458)
- `tool.execution_complete.data.toolCallId`, `tool.execution_complete.data.success` -- VERIFIED (lines 484-543)
- `UserInputHandler` type: `(request: UserInputRequest, invocation: { sessionId }) => Promise<UserInputResponse>` -- VERIFIED (`dist/types.d.ts:216-218`)
- `UserInputRequest` has `question: string`, `choices?: string[]` -- VERIFIED (`dist/types.d.ts:185-199`)
- `UserInputResponse` has `answer: string`, `wasFreeform: boolean` -- VERIFIED (`dist/types.d.ts:203-212`)
- `ModelInfo` has `id: string`, `name: string` -- VERIFIED (`dist/types.d.ts:795-810`)
- `CliAdapter` interface supports `runSdk?()` method -- VERIFIED (`cli-adapter.interface.ts:93`)
- `SdkHandle` interface supports `onSegment?` and `getSessionId?` -- VERIFIED (`cli-adapter.interface.ts:56-58`)
- `CliDetectionService` registers adapters in constructor -- VERIFIED (`cli-detection.service.ts:33-35`)
- `AgentProcessManager.doSpawnSdk()` handles `onSegment`, `getSessionId`, `done`, `abort` -- VERIFIED (`agent-process-manager.service.ts:347-483`)
- `AgentMonitorMessageHandler` routes messages to `AgentMonitorStore` -- VERIFIED (`agent-monitor-message-handler.service.ts`)
- `MonitoredAgent` already has `parentSessionId` and `cliSessionId` fields -- VERIFIED (`agent-monitor.store.ts:32-41`)
- `AgentCardComponent` already imports `SlicePipe` and uses it -- VERIFIED (`agent-card.component.ts:22,61`)

### Critical API Differences from Research Doc

| Research Doc Says                                                   | Actual SDK API                                                                | Impact                                                   |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------- |
| `onPreToolUse` hook in `createSession({ hooks: { onPreToolUse } })` | `hooks.onPreToolUse` exists in `SessionHooks` (`types.d.ts:363`)              | Confirmed correct                                        |
| `toolArgs` is `string`                                              | `toolArgs` is `unknown` in `PreToolUseHookInput`                              | Must serialize to string for our types                   |
| Return `{ permissionDecision: 'allow' }` from hook                  | `PreToolUseHookOutput` with `permissionDecision?: "allow" \| "deny" \| "ask"` | Confirmed correct                                        |
| `onPermissionRequest` handler returns `{ permissionDecision }`      | `PermissionRequestResult` has `kind: "approved" \| "denied-*"`                | Different return format! Two separate permission systems |
| `resumeSession({ sessionId: 'id' })`                                | `resumeSession(sessionId: string, config?)`                                   | First arg is string, not object                          |
| `client.listModels()` returns `{ id, name }[]`                      | Returns `ModelInfo[]` with `id`, `name`, `capabilities`, `policy`, `billing`  | Richer type, still has `id` and `name`                   |

### Risks Identified

| Risk                                                                                                      | Severity | Mitigation                                                                                               |
| --------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------- |
| SDK is Technical Preview (v0.1.25), API may change                                                        | HIGH     | Feature flag `ptah.copilot.useSdk: false` by default; all SDK code in single adapter file                |
| Two permission systems: `onPermissionRequest` (PermissionHandler) and `hooks.onPreToolUse` (SessionHooks) | MEDIUM   | Use `hooks.onPreToolUse` for tool interception; `onPermissionRequest` for file/shell permission requests |
| `toolArgs` is `unknown` not `string` in SDK hooks                                                         | LOW      | JSON.stringify in adapter before passing to bridge                                                       |
| SDK `autoRestart: true` may reconnect during permission wait                                              | LOW      | Permission bridge timeout handles stale requests                                                         |
| VS Code GitHub auth token may not have `copilot` scope                                                    | LOW      | Fallback to `useLoggedInUser: true` (SDK default)                                                        |
| `session.idle` may fire before all tool results are processed                                             | MEDIUM   | Wire `done` promise to `session.idle` + add timeout fallback                                             |

### Edge Cases to Handle

- [x] Permission request timeout (60s auto-deny) -- handled by CopilotPermissionBridge
- [x] Agent abort while permission pending -- cleanup() resolves all pending with deny
- [x] SDK client crash mid-session -- autoRestart: true reconnects; stale permission requests auto-denied
- [x] Read-only tool auto-approval (View, Read, Glob, Grep, LS) -- skip permission UI
- [x] Multiple concurrent sessions on same client -- each session has unique sessionId
- [x] resumeSession with invalid ID -- SDK throws, adapter catches and reports error
- [x] Feature flag toggle requires extension reload -- CLI adapter remains default until reload

---

## Batch 1: Foundation Types & Feature Flag -- COMPLETE

**Developer**: backend-developer
**Tasks**: 4 | **Dependencies**: None

### Task 1.1: Create agent permission types -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\shared\src\lib\types\agent-permission.types.ts` (CREATE)
**Spec Reference**: implementation-plan.md lines 460-523
**Pattern to Follow**: `D:\projects\ptah-extension\libs\shared\src\lib\types\agent-process.types.ts` (readonly interface pattern)

**Quality Requirements**:

- All fields must be `readonly`
- JSDoc comments on every field
- Types are standalone (no imports from other libraries except shared)

**Implementation Details**:

Create the file with these types:

```typescript
/**
 * Agent Permission Types for CLI Agent Tool Approval
 * TASK_2025_162: Copilot SDK Integration
 *
 * These types handle Copilot agent tool permission requests routed to the
 * webview UI. Distinct from SDK permissions (Claude tool approval) and
 * MCP permissions (code execution approval).
 */

/** Permission request from a CLI agent (Copilot SDK onPreToolUse hook) */
export interface AgentPermissionRequest {
  /** Unique request ID for correlation */
  readonly requestId: string;
  /** Agent that is requesting permission */
  readonly agentId: string;
  /** Permission kind from SDK: "shell", "write", "mcp", "read", "url" */
  readonly kind: string;
  /** Tool name the agent wants to use (e.g., "bash", "edit", "create") */
  readonly toolName: string;
  /** Serialized tool arguments (JSON string) */
  readonly toolArgs: string;
  /** Human-readable description */
  readonly description: string;
  /** Request timestamp */
  readonly timestamp: number;
  /** Auto-deny deadline (Unix ms) */
  readonly timeoutAt: number;
}

/** User's decision on an agent permission request */
export interface AgentPermissionDecision {
  /** Must match requestId from AgentPermissionRequest */
  readonly requestId: string;
  /** User decision */
  readonly decision: 'allow' | 'deny';
  /** Optional reason */
  readonly reason?: string;
}

/** User input request from a CLI agent (Copilot SDK onUserInputRequest hook) */
export interface AgentUserInputRequest {
  /** Unique request ID */
  readonly requestId: string;
  /** Agent asking for input */
  readonly agentId: string;
  /** The question/prompt from the agent */
  readonly question: string;
  /** Optional multiple choice options */
  readonly choices?: readonly string[];
  /** Request timestamp */
  readonly timestamp: number;
  /** Auto-timeout deadline (Unix ms) */
  readonly timeoutAt: number;
}

/** User's response to an agent input request */
export interface AgentUserInputResponse {
  /** Must match requestId from AgentUserInputRequest */
  readonly requestId: string;
  /** The user's text response */
  readonly answer: string;
  /** Whether the answer was freeform (not from choices) */
  readonly wasFreeform: boolean;
}
```

---

### Task 1.2: Export agent permission types from shared barrel -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\shared\src\index.ts` (MODIFY)
**Spec Reference**: implementation-plan.md line 528
**Pattern to Follow**: Line 17 (`export * from './lib/types/agent-process.types';`)

**Quality Requirements**:

- Export must be added after the existing type exports (after line 20)
- Single-line export following existing pattern

**Implementation Details**:

Add this line after line 20 (after `export * from './lib/types/custom-agent.types';`):

```typescript
export * from './lib/types/agent-permission.types';
```

---

### Task 1.3: Add agent permission MESSAGE_TYPES constants -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\shared\src\lib\types\message.types.ts` (MODIFY)
**Spec Reference**: implementation-plan.md lines 531-541
**Pattern to Follow**: Lines 335-337 (existing `AGENT_MONITOR_*` constants)

**Quality Requirements**:

- Constants must follow the existing naming convention (`AGENT_MONITOR_*`)
- String values follow the `agent-monitor:*` pattern
- Add section comment for clarity

**Implementation Details**:

Add after line 337 (`AGENT_MONITOR_EXITED: 'agent-monitor:exited',`):

```typescript
  // ---- Agent Permission Messages (TASK_2025_162: Copilot SDK) ----
  // CLI agent tool permission routing (Copilot SDK permission hooks)
  AGENT_MONITOR_PERMISSION_REQUEST: 'agent-monitor:permission-request',
  AGENT_MONITOR_PERMISSION_RESPONSE: 'agent-monitor:permission-response',
  // CLI agent user input routing (Copilot SDK onUserInputRequest)
  AGENT_MONITOR_USER_INPUT_REQUEST: 'agent-monitor:user-input-request',
  AGENT_MONITOR_USER_INPUT_RESPONSE: 'agent-monitor:user-input-response',
```

Also add these 4 new types to the `StrictMessageType` union (search for the type definition, around line 51). Add:

```typescript
  | 'agent-monitor:permission-request'
  | 'agent-monitor:permission-response'
  | 'agent-monitor:user-input-request'
  | 'agent-monitor:user-input-response'
```

---

### Task 1.4: Add ptah.copilot.useSdk feature flag to package.json -- COMPLETE

**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\package.json` (MODIFY)
**Spec Reference**: implementation-plan.md lines 574-582
**Pattern to Follow**: Lines 301-329 (existing `ptah.agentOrchestration.*` settings)

**Quality Requirements**:

- Setting name: `ptah.copilot.useSdk`
- Default: `false` (CLI remains default)
- Boolean type
- Descriptive help text

**Implementation Details**:

Add after the `ptah.agentOrchestration.copilotModel` block (after line 330), before `ptah.customAgents`:

```json
        "ptah.copilot.useSdk": {
          "type": "boolean",
          "default": false,
          "description": "Use the Copilot SDK (Technical Preview) instead of CLI spawning. Enables structured events, permission routing, session resume, and crash recovery. Requires extension reload to take effect."
        },
```

---

**Batch 1 Verification**:

- All files exist at paths
- Build passes: `npx nx typecheck shared`
- No runtime behavior changes (pure types + config)
- All new fields are readonly

---

## Batch 2: SDK Adapter + Permission Bridge -- IN PROGRESS

**Developer**: backend-developer
**Tasks**: 5 | **Dependencies**: Batch 1

### Task 2.1: Create CopilotPermissionBridge -- PENDING

**File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-adapters\copilot-permission-bridge.ts` (CREATE)
**Spec Reference**: implementation-plan.md lines 349-445
**Pattern to Follow**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-adapters\copilot-cli.adapter.ts` (class structure)

**Quality Requirements**:

- Promise-based with stored resolvers in a Map
- 60-second timeout auto-denies pending requests
- `cleanup()` resolves all pending with deny (called on agent abort/exit)
- Read-only tool auto-approval list
- EventEmitter for forwarding to RPC layer
- No dependencies on vscode API (pure TypeScript)

**Validation Notes**:

- The bridge handles BOTH permission systems: `onPermissionRequest` (PermissionHandler with `kind` field) and `hooks.onPreToolUse` (with `toolName` and `toolArgs`)
- `toolArgs` from SDK is `unknown`, must be serialized to string with `JSON.stringify`

**Implementation Details**:

```typescript
import { EventEmitter } from 'eventemitter3';
import { v4 as uuidv4 } from 'uuid';
import type { AgentPermissionRequest, AgentPermissionDecision } from '@ptah-extension/shared';

/** Default timeout for permission requests: 60 seconds */
const PERMISSION_TIMEOUT = 60_000;

/** Tool names that are always auto-approved (read-only operations) */
const AUTO_APPROVE_TOOLS = new Set(['View', 'Read', 'Glob', 'Grep', 'LS', 'view', 'read', 'glob', 'grep', 'ls']);

/** Permission kinds that are always auto-approved */
const AUTO_APPROVE_KINDS = new Set(['read']);

export class CopilotPermissionBridge {
  readonly events = new EventEmitter();
  private readonly pending = new Map<
    string,
    {
      resolve: (decision: AgentPermissionDecision) => void;
      timeout: NodeJS.Timeout;
    }
  >();

  /**
   * Request permission for a tool use (from hooks.onPreToolUse).
   * Returns the hook output format expected by the SDK.
   */
  async requestToolPermission(params: { agentId: string; toolName: string; toolArgs: unknown }): Promise<{ permissionDecision: 'allow' | 'deny'; permissionDecisionReason?: string }> {
    if (AUTO_APPROVE_TOOLS.has(params.toolName)) {
      return { permissionDecision: 'allow' };
    }

    const decision = await this.requestPermissionInternal({
      agentId: params.agentId,
      kind: 'write',
      toolName: params.toolName,
      toolArgs: typeof params.toolArgs === 'string' ? params.toolArgs : JSON.stringify(params.toolArgs ?? {}),
      description: `Copilot wants to use ${params.toolName}`,
    });

    return {
      permissionDecision: decision.decision === 'allow' ? 'allow' : 'deny',
      permissionDecisionReason: decision.reason,
    };
  }

  /**
   * Request permission for a shell/file operation (from onPermissionRequest).
   * Returns the PermissionRequestResult format expected by the SDK.
   */
  async requestFilePermission(params: { agentId: string; kind: string; toolCallId?: string; details: Record<string, unknown> }): Promise<{ kind: 'approved' | 'denied-interactively-by-user' }> {
    if (AUTO_APPROVE_KINDS.has(params.kind)) {
      return { kind: 'approved' };
    }

    const decision = await this.requestPermissionInternal({
      agentId: params.agentId,
      kind: params.kind,
      toolName: params.kind,
      toolArgs: JSON.stringify(params.details),
      description: `Copilot requests ${params.kind} permission`,
    });

    return {
      kind: decision.decision === 'allow' ? 'approved' : 'denied-interactively-by-user',
    };
  }

  private async requestPermissionInternal(params: { agentId: string; kind: string; toolName: string; toolArgs: string; description: string }): Promise<AgentPermissionDecision> {
    const requestId = uuidv4();
    const now = Date.now();
    const request: AgentPermissionRequest = {
      requestId,
      agentId: params.agentId,
      kind: params.kind,
      toolName: params.toolName,
      toolArgs: params.toolArgs,
      description: params.description,
      timestamp: now,
      timeoutAt: now + PERMISSION_TIMEOUT,
    };

    return new Promise<AgentPermissionDecision>((resolve) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        resolve({
          requestId,
          decision: 'deny',
          reason: 'Timed out waiting for user response',
        });
      }, PERMISSION_TIMEOUT);

      this.pending.set(requestId, {
        resolve: (decision) => {
          clearTimeout(timeout);
          this.pending.delete(requestId);
          resolve(decision);
        },
        timeout,
      });

      this.events.emit('permission-request', request);
    });
  }

  /** Resolve a pending permission request (called from RPC handler) */
  resolvePermission(requestId: string, decision: AgentPermissionDecision): void {
    const entry = this.pending.get(requestId);
    if (entry) {
      entry.resolve(decision);
    }
  }

  /** Cleanup all pending requests (called on agent abort/exit) */
  cleanup(): void {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timeout);
      entry.resolve({ requestId: id, decision: 'deny', reason: 'Agent stopped' });
    }
    this.pending.clear();
  }

  /** Number of pending requests (for testing/diagnostics) */
  get pendingCount(): number {
    return this.pending.size;
  }
}
```

---

### Task 2.2: Create CopilotSdkAdapter -- PENDING

**File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-adapters\copilot-sdk.adapter.ts` (CREATE)
**Spec Reference**: implementation-plan.md lines 161-331
**Pattern to Follow**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-adapters\copilot-cli.adapter.ts` (existing Copilot adapter), `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-adapters\gemini-cli.adapter.ts` (onSegment pattern)

**Quality Requirements**:

- Implements `CliAdapter` interface fully
- `CopilotClient` must be singleton (shared across sessions)
- All SDK event types must map to existing `CliOutputSegment` types
- `getSessionId()` must return the session ID from `createSession`
- Abort must clean up SDK session via `session.abort()` and `session.destroy()`
- `dispose()` method for extension deactivation
- Auth via VS Code GitHub auth API with fallback to `useLoggedInUser: true`
- Reuse `detect()`, `buildCommand()`, `parseOutput()`, `listModels()` logic from existing `CopilotCliAdapter`

**Validation Notes**:

- CRITICAL: `resumeSession(sessionId: string, config?)` -- first arg is string directly, NOT an object
- CRITICAL: `toolArgs` is `unknown` in `PreToolUseHookInput`, must JSON.stringify for CliOutputSegment
- CRITICAL: `session.on('session.idle', handler)` uses typed event overload
- RISK: `session.idle` may fire before all events are processed. Use it for done promise resolution.
- SDK `CopilotClientOptions` does NOT have `githubToken` wired via constructor; use env var approach or `useLoggedInUser: true`
- Actually `CopilotClientOptions.githubToken` IS available (`types.d.ts:66`). Use VS Code auth API to get token.

**Implementation Details**:

The adapter must:

1. Import `CopilotClient` from `@github/copilot-sdk` and `CopilotSession` from `@github/copilot-sdk`
2. Import `* as vscode` for auth API
3. Implement all `CliAdapter` interface methods
4. In `runSdk()`:

   - Call `ensureClient()` to get/create singleton client
   - Generate `sessionId = 'ptah-' + Date.now()`
   - Create or resume session with hooks
   - Wire SDK events to `onOutput` and `onSegment` callbacks
   - Map `assistant.message_delta` -> text segment + raw output
   - Map `tool.execution_start` -> tool-call segment
   - Map `tool.execution_complete` -> tool-result or tool-result-error segment
   - Map `session.error` -> error segment
   - Map `session.start` -> info segment
   - Wire `session.idle` to resolve done promise with exit code 0
   - Wire `session.error` to resolve done promise with exit code 1 (only if done not already resolved)
   - Send task prompt via `session.send({ prompt: taskPrompt })`
   - Wire abort controller to `session.abort()` + `session.destroy()`
   - Return `SdkHandle` with `abort`, `done`, `onOutput`, `onSegment`, `getSessionId`

5. `ensureClient()` gets GitHub token via `vscode.authentication.getSession('github', ['copilot'], { createIfNone: false })`
6. `dispose()` calls `client.stop()` for graceful shutdown
7. Delegate `detect()`, `buildCommand()`, `parseOutput()`, `supportsSteer()` to a static `CopilotCliAdapter` instance or duplicate the logic

Key SDK event type -> CliOutputSegment mapping:

| SDK Event                                 | CliOutputSegment type | Content source                                                                    |
| ----------------------------------------- | --------------------- | --------------------------------------------------------------------------------- |
| `assistant.message_delta`                 | `text`                | `event.data.deltaContent`                                                         |
| `assistant.message`                       | `text`                | `event.data.content` (full message, skip if streaming)                            |
| `tool.execution_start`                    | `tool-call`           | `toolName: event.data.toolName`, `toolArgs: JSON.stringify(event.data.arguments)` |
| `tool.execution_complete` (success=true)  | `tool-result`         | `event.data.result?.content`                                                      |
| `tool.execution_complete` (success=false) | `tool-result-error`   | `event.data.error?.message`                                                       |
| `session.error`                           | `error`               | `event.data.message`                                                              |
| `session.start`                           | `info`                | `'Session started: ' + event.data.sessionId`                                      |

---

### Task 2.3: Update CLI adapters barrel export -- PENDING

**File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-adapters\index.ts` (MODIFY)
**Spec Reference**: implementation-plan.md lines 766-768
**Pattern to Follow**: Lines 14-16 (existing adapter exports)

**Quality Requirements**:

- Export both new files
- Maintain alphabetical order within adapter exports

**Implementation Details**:

Add after line 16 (`export { CopilotCliAdapter } from './copilot-cli.adapter';`):

```typescript
export { CopilotSdkAdapter } from './copilot-sdk.adapter';
export { CopilotPermissionBridge } from './copilot-permission-bridge';
```

---

### Task 2.4: Conditional adapter registration in CliDetectionService -- PENDING

**File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-detection.service.ts` (MODIFY)
**Spec Reference**: implementation-plan.md lines 548-572
**Pattern to Follow**: Lines 31-39 (constructor adapter registration)

**Quality Requirements**:

- Read feature flag at construction time
- If `ptah.copilot.useSdk` is true, register `CopilotSdkAdapter` instead of `CopilotCliAdapter`
- Log which adapter was registered
- `CopilotPermissionBridge` must be created and passed to the SDK adapter
- The bridge instance must be accessible for RPC wiring (exposed via getter or adapter property)

**Implementation Details**:

1. Add imports at top:

```typescript
import { CopilotSdkAdapter } from './cli-adapters/copilot-sdk.adapter';
import { CopilotPermissionBridge } from './cli-adapters/copilot-permission-bridge';
```

2. Replace line 35 (`this.adapters.set('copilot', new CopilotCliAdapter());`) with:

```typescript
// Feature flag: use SDK adapter for Copilot if enabled
const useCopilotSdk = vscode.workspace.getConfiguration('ptah.copilot').get<boolean>('useSdk', false);

if (useCopilotSdk) {
  const permissionBridge = new CopilotPermissionBridge();
  this.adapters.set('copilot', new CopilotSdkAdapter(permissionBridge));
  this.logger.info('[CliDetection] Copilot SDK adapter registered (feature flag enabled)');
} else {
  this.adapters.set('copilot', new CopilotCliAdapter());
  this.logger.info('[CliDetection] Copilot CLI adapter registered (default)');
}
```

3. Update service header comment (line 2) to include `TASK_2025_162`:

```typescript
 * TASK_2025_162: Added Copilot SDK adapter with feature flag
```

---

### Task 2.5: Update llm-abstraction barrel export -- PENDING

**File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\index.ts` (MODIFY)
**Spec Reference**: implementation-plan.md lines 767-768
**Pattern to Follow**: Lines 71-78 (existing Agent Orchestration exports)

**Quality Requirements**:

- Export `CopilotPermissionBridge` for RPC layer access
- Do NOT export `CopilotSdkAdapter` (internal implementation detail)

**Implementation Details**:

Add after line 78 (after existing CLI adapter type exports):

```typescript
// Copilot SDK Permission Bridge (TASK_2025_162)
export { CopilotPermissionBridge } from './lib/services/cli-adapters';
```

---

**Batch 2 Verification**:

- All files exist at paths
- Build passes: `npx nx typecheck llm-abstraction`
- Extension compiles with both feature flag states
- With `ptah.copilot.useSdk: true`, SDK adapter is registered
- With `ptah.copilot.useSdk: false` (default), CLI adapter is used

---

## Batch 3: RPC Event Forwarding -- PENDING

**Developer**: backend-developer
**Tasks**: 2 | **Dependencies**: Batch 2

### Task 3.1: Forward permission events from extension to webview -- PENDING

**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\rpc-method-registration.service.ts` (MODIFY)
**Spec Reference**: implementation-plan.md lines 596-618
**Pattern to Follow**: Lines 165-226 (`setupAgentMonitorListeners()` method)

**Quality Requirements**:

- Permission bridge events forwarded to webview via `broadcastMessage()`
- Must check if the copilot adapter is the SDK variant before wiring
- Error handling with `.catch()` pattern matching existing listeners
- Fire-and-forget (do not block agent lifecycle)

**Validation Notes**:

- The permission bridge is accessed via `CliDetectionService.getAdapter('copilot')` and then checking for `permissionBridge` property
- Must import `AgentPermissionRequest` from `@ptah-extension/shared`
- Must import `CopilotPermissionBridge` from `@ptah-extension/llm-abstraction`

**Implementation Details**:

1. Add to imports at top of file:

```typescript
import type { AgentPermissionRequest } from '@ptah-extension/shared';
import { CopilotPermissionBridge, CliDetectionService } from '@ptah-extension/llm-abstraction';
```

Note: `CliDetectionService` may already be imported indirectly. Check if `TOKENS.CLI_DETECTION_SERVICE` is used. The developer must resolve the import path.

2. In `setupAgentMonitorListeners()`, after line 217 (`this.logger.info('[RPC] Agent monitor listeners registered');`), add:

```typescript
// Wire Copilot SDK permission bridge events (TASK_2025_162)
this.setupCopilotPermissionForwarding();
```

3. Add new private method after `persistCliSessionReference()`:

```typescript
  /**
   * Wire Copilot SDK permission bridge events to webview.
   * Only active when the Copilot SDK adapter is registered (feature flag enabled).
   * TASK_2025_162
   */
  private setupCopilotPermissionForwarding(): void {
    try {
      const cliDetection = this.container.resolve<CliDetectionService>(
        TOKENS.CLI_DETECTION_SERVICE
      );
      const copilotAdapter = cliDetection.getAdapter('copilot');

      if (copilotAdapter && 'permissionBridge' in copilotAdapter) {
        const bridge = (copilotAdapter as { permissionBridge: CopilotPermissionBridge }).permissionBridge;

        bridge.events.on('permission-request', (request: AgentPermissionRequest) => {
          this.webviewManager
            .broadcastMessage(MESSAGE_TYPES.AGENT_MONITOR_PERMISSION_REQUEST, request)
            .catch((error) => {
              this.logger.error(
                '[RPC] Failed to send agent permission request to webview',
                error instanceof Error ? error : new Error(String(error))
              );
            });
        });

        this.logger.info('[RPC] Copilot SDK permission forwarding registered');
      }
    } catch (error) {
      // CliDetectionService may not be available
      this.logger.debug(
        '[RPC] Copilot SDK permission forwarding not available',
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }
```

---

### Task 3.2: Add agent:permissionResponse RPC method -- PENDING

**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\agent-rpc.handlers.ts` (MODIFY)
**Spec Reference**: implementation-plan.md lines 621-641
**Pattern to Follow**: Lines 46-50 (`register()` method pattern), Lines 68-103 (`registerGetConfig()` pattern)

**Quality Requirements**:

- New RPC method: `agent:permissionResponse`
- Accepts `AgentPermissionDecision` params
- Routes to `CopilotPermissionBridge.resolvePermission()`
- Returns `{ success: boolean; error?: string }`
- Must be registered in `register()` method
- Must be added to the logged methods array

**Implementation Details**:

1. Add imports at top:

```typescript
import type { AgentPermissionDecision } from '@ptah-extension/shared';
import { CopilotPermissionBridge } from '@ptah-extension/llm-abstraction';
```

2. In `register()` method (line 47), add:

```typescript
this.registerPermissionResponse();
```

3. Update the logged methods array (line 53) to include `'agent:permissionResponse'`.

4. Add new private method:

```typescript
  /**
   * agent:permissionResponse - Route user's permission decision to Copilot SDK bridge
   * TASK_2025_162: Copilot SDK Integration
   */
  private registerPermissionResponse(): void {
    this.rpcHandler.registerMethod<
      AgentPermissionDecision,
      { success: boolean; error?: string }
    >('agent:permissionResponse', async (params) => {
      try {
        this.logger.debug('RPC: agent:permissionResponse called', {
          requestId: params.requestId,
          decision: params.decision,
        });

        const copilotAdapter = this.cliDetection.getAdapter('copilot');
        if (copilotAdapter && 'permissionBridge' in copilotAdapter) {
          const bridge = (copilotAdapter as { permissionBridge: CopilotPermissionBridge })
            .permissionBridge;
          bridge.resolvePermission(params.requestId, params);
          return { success: true };
        }

        return { success: false, error: 'Copilot SDK adapter not active' };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.error(
          'RPC: agent:permissionResponse failed',
          error instanceof Error ? error : new Error(errorMessage)
        );
        return { success: false, error: errorMessage };
      }
    });
  }
```

---

**Batch 3 Verification**:

- All files exist at paths
- Build passes: `npx nx typecheck ptah-extension-vscode`
- Permission events flow from extension to webview when SDK adapter active
- Permission responses flow back from webview to extension

---

## Batch 4: Frontend Permission UI -- PENDING

**Developer**: frontend-developer
**Tasks**: 2 | **Dependencies**: Batch 1

### Task 4.1: Add permission request handling to AgentMonitorStore -- PENDING

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\agent-monitor.store.ts` (MODIFY)
**Spec Reference**: implementation-plan.md lines 655-707
**Pattern to Follow**: Lines 118-146 (`onAgentSpawned()` method pattern), lines 177-193 (`onAgentExited()` method pattern)

**Quality Requirements**:

- Add `pendingPermission` field to `MonitoredAgent` interface
- Signal-based immutable update pattern maintained (new Map spread)
- `onPermissionRequest()` stores pending permission on correct agent
- `clearPermission()` removes it
- Permission state is null when no request pending

**Implementation Details**:

1. Add import for `AgentPermissionRequest` (line 10):

```typescript
import type { AgentProcessInfo, AgentOutputDelta, AgentStatus, CliType, CliOutputSegment, AgentPermissionRequest } from '@ptah-extension/shared';
```

2. Add `pendingPermission` field to `MonitoredAgent` interface (after line 41, after `cliSessionId`):

```typescript
  /** Pending permission request from the agent (Copilot SDK) */
  pendingPermission?: AgentPermissionRequest | null;
```

3. Add `onPermissionRequest()` method (after `onAgentExited()`, after line 193):

```typescript
  /** Handle incoming permission request from Copilot SDK agent */
  onPermissionRequest(request: AgentPermissionRequest): void {
    this._agents.update((map) => {
      const agent = map.get(request.agentId);
      if (!agent) return map;
      const next = new Map(map);
      next.set(request.agentId, {
        ...agent,
        pendingPermission: request,
      });
      return next;
    });
  }

  /** Clear pending permission from agent (after user responds) */
  clearPermission(agentId: string): void {
    this._agents.update((map) => {
      const agent = map.get(agentId);
      if (!agent) return map;
      const next = new Map(map);
      next.set(agentId, { ...agent, pendingPermission: null });
      return next;
    });
  }
```

4. Also update `onAgentExited()` to clear any pending permission when the agent exits (modify lines 183-189):

```typescript
next.set(info.agentId, {
  ...agent,
  status: info.status,
  exitCode: info.exitCode,
  cliSessionId: info.cliSessionId || agent.cliSessionId,
  pendingPermission: null,
});
```

5. Update `AgentMonitorMessageHandler` at `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\agent-monitor-message-handler.service.ts` to handle the new message types:

```typescript
import { MESSAGE_TYPES, type AgentProcessInfo, type AgentOutputDelta, type AgentPermissionRequest } from '@ptah-extension/shared';
```

Add to `handledMessageTypes` array:

```typescript
    MESSAGE_TYPES.AGENT_MONITOR_PERMISSION_REQUEST,
```

Add to `handleMessage()` switch:

```typescript
      case MESSAGE_TYPES.AGENT_MONITOR_PERMISSION_REQUEST:
        this.store.onPermissionRequest(message.payload as AgentPermissionRequest);
        break;
```

---

### Task 4.2: Add permission UI to AgentCardComponent -- PENDING

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\agent-card.component.ts` (MODIFY)
**Spec Reference**: implementation-plan.md lines 709-756
**Pattern to Follow**: Lines 104-112 (existing CLI session ID badge pattern), Lines 117-133 (task description area)

**Quality Requirements**:

- Permission dialog renders inside the agent card (below task description, above output)
- DaisyUI styling consistent with existing badges
- Allow/Deny buttons with success/error styling
- Permission request description and tool name displayed
- `VSCodeService` used to post permission response message
- Store `clearPermission()` called after user responds
- OnPush change detection works via signal updates

**Implementation Details**:

1. Add import for `VSCodeService` from `@ptah-extension/core` (if not already imported) and `MESSAGE_TYPES` from `@ptah-extension/shared`:

```typescript
import { VSCodeService } from '@ptah-extension/core';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
```

2. Add the permission UI block to the template, after the task description div (after line 133, before the Output section):

```html
<!-- Permission request (Copilot SDK) -->
@if (agent().pendingPermission) {
<div class="border-t border-warning/20 bg-warning/5 px-3 py-2 flex-shrink-0">
  <div class="flex items-center gap-2 mb-1.5">
    <span class="badge badge-sm badge-warning">Permission</span>
    <span class="text-[10px] text-base-content/60"> {{ agent().pendingPermission!.description }} </span>
  </div>
  <div class="flex items-center gap-1.5 mb-1">
    <code class="text-[10px] font-mono text-accent bg-base-200/60 px-1.5 py-0.5 rounded"> {{ agent().pendingPermission!.toolName }} </code>
    @if (agent().pendingPermission!.toolArgs) {
    <span class="text-[10px] text-base-content/40 font-mono truncate max-w-[200px]"> {{ agent().pendingPermission!.toolArgs }} </span>
    }
  </div>
  <div class="flex gap-2 mt-2">
    <button class="btn btn-xs btn-success" (click)="allowPermission()">Allow</button>
    <button class="btn btn-xs btn-error btn-outline" (click)="denyPermission()">Deny</button>
  </div>
</div>
}
```

3. Add `VSCodeService` injection and permission methods to the component class (after the `store` injection on line 347):

```typescript
  private readonly vscode = inject(VSCodeService);

  allowPermission(): void {
    const perm = this.agent().pendingPermission;
    if (!perm) return;
    this.vscode.postMessage({
      type: MESSAGE_TYPES.AGENT_MONITOR_PERMISSION_RESPONSE,
      payload: { requestId: perm.requestId, decision: 'allow' },
    });
    this.store.clearPermission(this.agent().agentId);
  }

  denyPermission(): void {
    const perm = this.agent().pendingPermission;
    if (!perm) return;
    this.vscode.postMessage({
      type: MESSAGE_TYPES.AGENT_MONITOR_PERMISSION_RESPONSE,
      payload: { requestId: perm.requestId, decision: 'deny', reason: 'User denied' },
    });
    this.store.clearPermission(this.agent().agentId);
  }
```

Note: The developer must verify how `VSCodeService.postMessage()` works. Check `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\vscode.service.ts` for the exact method signature.

---

**Batch 4 Verification**:

- All files exist at paths
- Build passes: `npx nx typecheck chat`
- Permission dialog renders in agent card when `pendingPermission` is set
- Allow/Deny buttons send correct message types
- Permission is cleared from store after user responds
- Permission is cleared when agent exits

---

## Batch 5: Session Resume + Dispose Lifecycle -- PENDING

**Developer**: backend-developer
**Tasks**: 2 | **Dependencies**: Batch 2

### Task 5.1: Verify session resume in CopilotSdkAdapter -- PENDING

**File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-adapters\copilot-sdk.adapter.ts` (MODIFY)
**Spec Reference**: implementation-plan.md lines 836-838

**Quality Requirements**:

- `resumeSession()` call uses correct signature: `client.resumeSession(sessionId, config)` where first arg is string
- Hooks and tools are re-registered on resume via `ResumeSessionConfig`
- Session ID from resume is the same as original (getSessionId returns it)
- If resume fails, log error and throw (AgentProcessManager handles the exit)

**Validation Notes**:

- `ResumeSessionConfig` supports: `model`, `tools`, `systemMessage`, `hooks`, `onPermissionRequest`, `onUserInputRequest`, `workingDirectory`, `mcpServers`, `streaming`
- Resume preserves conversation history

**Implementation Details**:

Verify that `runSdk()` in the adapter correctly handles the `options.resumeSessionId` branch:

```typescript
const session = options.resumeSessionId
  ? await this.client!.resumeSession(options.resumeSessionId, {
      model: options.model,
      streaming: true,
      hooks: {
        onPreToolUse: async (input, invocation) =>
          this.permissionBridge.requestToolPermission({
            agentId,
            toolName: input.toolName,
            toolArgs: input.toolArgs,
          }),
      },
      onPermissionRequest: async (request, invocation) =>
        this.permissionBridge.requestFilePermission({
          agentId,
          kind: request.kind,
          toolCallId: request.toolCallId,
          details: request as Record<string, unknown>,
        }),
      workingDirectory: options.workingDirectory,
    })
  : await this.client!.createSession({
      sessionId,
      model: options.model ?? 'claude-sonnet-4.6',
      streaming: true,
      hooks: {
        /* same hooks */
      },
      onPermissionRequest: async (request, invocation) => {
        /* same */
      },
      workingDirectory: options.workingDirectory,
    });
```

---

### Task 5.2: Wire dispose lifecycle for SDK adapter -- PENDING

**File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\agent-process-manager.service.ts` (MODIFY)
**Spec Reference**: implementation-plan.md lines 838-839
**Pattern to Follow**: Lines 610-629 (`shutdownAll()` method)

**Quality Requirements**:

- On `shutdownAll()`, if the copilot adapter has a `dispose()` method, call it
- Fire-and-forget: catch errors, do not block shutdown
- Only call dispose if the adapter is the SDK variant

**Implementation Details**:

In `shutdownAll()` method (after line 616, after stopping all agents), add:

```typescript
// Dispose SDK adapters that need cleanup (TASK_2025_162)
try {
  const copilotAdapter = this.cliDetection.getAdapter('copilot');
  if (copilotAdapter && 'dispose' in copilotAdapter && typeof (copilotAdapter as { dispose: () => Promise<void> }).dispose === 'function') {
    await(copilotAdapter as { dispose: () => Promise<void> }).dispose();
    this.logger.info('[AgentProcessManager] Copilot SDK adapter disposed');
  }
} catch (error) {
  this.logger.warn('[AgentProcessManager] Failed to dispose Copilot SDK adapter', error instanceof Error ? error : new Error(String(error)));
}
```

---

**Batch 5 Verification**:

- All files exist at paths
- Build passes: `npx nx typecheck llm-abstraction`
- Resuming a Copilot session calls `client.resumeSession(id, config)` correctly
- Extension deactivation stops the SDK client cleanly
- Permission bridge cleanup is called on agent abort

---

## Batch Dependency Graph

```
Batch 1 (Types + Feature Flag)
  |
  +---> Batch 2 (SDK Adapter + Permission Bridge)
  |       |
  |       +---> Batch 3 (RPC Event Forwarding)
  |       |
  |       +---> Batch 5 (Session Resume + Dispose)
  |
  +---> Batch 4 (Frontend Permission UI)
```

Batches 2 and 4 can run in parallel after Batch 1 is complete.
Batches 3 and 5 can run in parallel after Batch 2 is complete.

---

## Developer Prompts

### Batch 1 Developer Prompt (backend-developer)

```
You are assigned Batch 1 for TASK_2025_162.

**Task Folder**: D:\projects\ptah-extension\task-tracking\TASK_2025_162\

## Your Responsibilities

1. Read tasks.md - find Batch 1 (marked PENDING, change to IN PROGRESS before starting)
2. Read implementation-plan.md for context
3. READ the Plan Validation Summary - note the API differences from research doc
4. Implement ALL tasks in Batch 1 IN ORDER (1.1, 1.2, 1.3, 1.4)
5. Write REAL code (NO stubs, placeholders, TODOs)
6. Update each task status in tasks.md: PENDING -> IMPLEMENTED
7. Return implementation report with file paths

## Files to Create/Modify

- Task 1.1: D:\projects\ptah-extension\libs\shared\src\lib\types\agent-permission.types.ts (CREATE)
- Task 1.2: D:\projects\ptah-extension\libs\shared\src\index.ts (MODIFY - add export)
- Task 1.3: D:\projects\ptah-extension\libs\shared\src\lib\types\message.types.ts (MODIFY - add 4 MESSAGE_TYPES + 4 StrictMessageType entries)
- Task 1.4: D:\projects\ptah-extension\apps\ptah-extension-vscode\package.json (MODIFY - add ptah.copilot.useSdk setting)

## CRITICAL RULES

- You do NOT create git commits (team-leader handles)
- Focus 100% on code quality
- All new type fields MUST be readonly
- JSDoc on every new field
- Use exact string values from tasks.md for MESSAGE_TYPES
- Verify StrictMessageType union includes the new message type strings
- After implementing, verify no TypeScript errors

## Return Format

BATCH 1 IMPLEMENTATION COMPLETE
- Files created/modified: [list paths]
- All tasks marked: IMPLEMENTED
- Ready for team-leader verification
```

### Batch 2 Developer Prompt (backend-developer)

```
You are assigned Batch 2 for TASK_2025_162.

**Task Folder**: D:\projects\ptah-extension\task-tracking\TASK_2025_162\

## Your Responsibilities

1. Read tasks.md - find Batch 2 (marked PENDING, change to IN PROGRESS before starting)
2. Read implementation-plan.md for context (esp. Components 1-4)
3. READ the Plan Validation Summary - critical SDK API differences listed
4. READ the actual SDK types at D:\projects\ptah-extension\node_modules\@github\copilot-sdk\dist\types.d.ts
5. READ D:\projects\ptah-extension\node_modules\@github\copilot-sdk\dist\generated\session-events.d.ts for actual event types
6. Implement ALL tasks in Batch 2 IN ORDER (2.1, 2.2, 2.3, 2.4, 2.5)
7. Write REAL code (NO stubs, placeholders, TODOs)
8. Update each task status in tasks.md: PENDING -> IMPLEMENTED
9. Return implementation report with file paths

## Files to Create/Modify

- Task 2.1: D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-adapters\copilot-permission-bridge.ts (CREATE)
- Task 2.2: D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-adapters\copilot-sdk.adapter.ts (CREATE)
- Task 2.3: D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-adapters\index.ts (MODIFY)
- Task 2.4: D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-detection.service.ts (MODIFY)
- Task 2.5: D:\projects\ptah-extension\libs\backend\llm-abstraction\src\index.ts (MODIFY)

## CRITICAL RULES

- You do NOT create git commits (team-leader handles)
- Focus 100% on code quality
- CRITICAL: resumeSession first arg is a STRING, not an object
- CRITICAL: toolArgs in PreToolUseHookInput is `unknown`, not string -- JSON.stringify it
- CRITICAL: PermissionRequestResult uses `kind: "approved" | "denied-*"`, NOT `permissionDecision`
- CRITICAL: PreToolUseHookOutput uses `permissionDecision: "allow" | "deny" | "ask"` -- these are DIFFERENT APIs
- CopilotClient must be singleton (one CLI process per extension lifetime)
- Map ALL SDK event types to CliOutputSegment types (see mapping table in Task 2.2)
- Reference the GeminiCliAdapter runSdk() pattern for output buffering

## Validation Risks to Address

- Two separate permission APIs: onPermissionRequest (file/shell) vs hooks.onPreToolUse (tool interception)
- toolArgs is unknown, needs serialization
- session.idle may fire before all events -- use it for done resolution but add error fallback

## Return Format

BATCH 2 IMPLEMENTATION COMPLETE
- Files created/modified: [list paths]
- All tasks marked: IMPLEMENTED
- Validation risks addressed: [list how each was handled]
- Ready for team-leader verification
```

### Batch 3 Developer Prompt (backend-developer)

```
You are assigned Batch 3 for TASK_2025_162.

**Task Folder**: D:\projects\ptah-extension\task-tracking\TASK_2025_162\

## Your Responsibilities

1. Read tasks.md - find Batch 3 (marked PENDING, change to IN PROGRESS before starting)
2. Read implementation-plan.md for context (Component 5: Permission Event Forwarding)
3. Implement ALL tasks in Batch 3 IN ORDER (3.1, 3.2)
4. Write REAL code (NO stubs, placeholders, TODOs)
5. Update each task status in tasks.md: PENDING -> IMPLEMENTED
6. Return implementation report with file paths

## Files to Modify

- Task 3.1: D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\rpc-method-registration.service.ts (MODIFY)
- Task 3.2: D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\agent-rpc.handlers.ts (MODIFY)

## CRITICAL RULES

- You do NOT create git commits (team-leader handles)
- Focus 100% on code quality
- Permission forwarding is fire-and-forget (catch errors, do not block)
- Access the permission bridge through CliDetectionService.getAdapter('copilot')
- Use duck-typing check: `'permissionBridge' in copilotAdapter`
- Follow existing broadcastMessage error handling pattern
- Add 'agent:permissionResponse' to the RPC handler's methods list

## Return Format

BATCH 3 IMPLEMENTATION COMPLETE
- Files created/modified: [list paths]
- All tasks marked: IMPLEMENTED
- Ready for team-leader verification
```

### Batch 4 Developer Prompt (frontend-developer)

```
You are assigned Batch 4 for TASK_2025_162.

**Task Folder**: D:\projects\ptah-extension\task-tracking\TASK_2025_162\

## Your Responsibilities

1. Read tasks.md - find Batch 4 (marked PENDING, change to IN PROGRESS before starting)
2. Read implementation-plan.md for context (Component 6: Frontend Permission UI)
3. Implement ALL tasks in Batch 4 IN ORDER (4.1, 4.2)
4. Write REAL code (NO stubs, placeholders, TODOs)
5. Update each task status in tasks.md: PENDING -> IMPLEMENTED
6. Return implementation report with file paths

## Files to Modify

- Task 4.1: D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\agent-monitor.store.ts (MODIFY)
  - Also: D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\agent-monitor-message-handler.service.ts (MODIFY)
- Task 4.2: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\agent-card.component.ts (MODIFY)

## CRITICAL RULES

- You do NOT create git commits (team-leader handles)
- Focus 100% on code quality
- Signal-based immutable updates (new Map spread pattern)
- OnPush change detection -- signal updates handle re-rendering
- Permission UI uses DaisyUI classes: badge-warning, btn-success, btn-error
- Clear pendingPermission on agent exit (prevent stale permission dialogs)
- VSCodeService.postMessage() for sending permission responses
- Check how VSCodeService works before using it (read the service file)
- Import AgentPermissionRequest from @ptah-extension/shared

## Return Format

BATCH 4 IMPLEMENTATION COMPLETE
- Files created/modified: [list paths]
- All tasks marked: IMPLEMENTED
- Ready for team-leader verification
```

### Batch 5 Developer Prompt (backend-developer)

```
You are assigned Batch 5 for TASK_2025_162.

**Task Folder**: D:\projects\ptah-extension\task-tracking\TASK_2025_162\

## Your Responsibilities

1. Read tasks.md - find Batch 5 (marked PENDING, change to IN PROGRESS before starting)
2. Read implementation-plan.md for context (esp. Batch 5 section)
3. Implement ALL tasks in Batch 5 IN ORDER (5.1, 5.2)
4. Write REAL code (NO stubs, placeholders, TODOs)
5. Update each task status in tasks.md: PENDING -> IMPLEMENTED
6. Return implementation report with file paths

## Files to Modify

- Task 5.1: D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-adapters\copilot-sdk.adapter.ts (MODIFY)
- Task 5.2: D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\agent-process-manager.service.ts (MODIFY)

## CRITICAL RULES

- You do NOT create git commits (team-leader handles)
- Focus 100% on code quality
- resumeSession first arg is a STRING, not an object: client.resumeSession('session-id', config)
- ResumeSessionConfig supports hooks, onPermissionRequest, tools, model, streaming, workingDirectory
- dispose() calls client.stop() which returns Promise<Error[]>
- Dispose is fire-and-forget in shutdownAll() (catch errors, do not block)
- Permission bridge cleanup must be called on agent abort (in the abort handler)

## Return Format

BATCH 5 IMPLEMENTATION COMPLETE
- Files created/modified: [list paths]
- All tasks marked: IMPLEMENTED
- Ready for team-leader verification
```
