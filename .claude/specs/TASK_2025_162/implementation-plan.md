# Implementation Plan - TASK_2025_162: Copilot SDK Integration

## Codebase Investigation Summary

### Libraries Discovered

- **@ptah-extension/llm-abstraction** (`libs/backend/llm-abstraction/`)

  - Key exports: `CliDetectionService`, `AgentProcessManager`, `CliAdapter`, `SdkHandle`
  - CLI adapters: `gemini-cli.adapter.ts`, `codex-cli.adapter.ts`, `copilot-cli.adapter.ts`
  - Utilities: `cli-adapter.utils.ts` (cross-spawn, ANSI stripping, task prompt builder)
  - Documentation: `libs/backend/llm-abstraction/CLAUDE.md`

- **@ptah-extension/shared** (`libs/shared/`)

  - Agent types: `agent-process.types.ts` (AgentId, AgentProcessInfo, SpawnAgentRequest, CliOutputSegment)
  - Message protocol: `message.types.ts` (MESSAGE_TYPES constants, StrictMessageType union)
  - Permission types: `permission.types.ts` (PermissionRequest, PermissionResponse -- existing SDK permissions)
  - Documentation: `libs/shared/CLAUDE.md`

- **@ptah-extension/chat** (`libs/frontend/chat/`)

  - Agent monitoring: `agent-monitor.store.ts` (MonitoredAgent, signal-based store)
  - Agent display: `agent-card.component.ts` (structured segments rendering, RenderSegment)
  - Monitor panel: `agent-monitor-panel.component.ts` (sidebar panel)
  - Documentation: `libs/frontend/chat/CLAUDE.md`

- **ptah-extension-vscode** (`apps/ptah-extension-vscode/`)
  - RPC orchestrator: `rpc-method-registration.service.ts` (setupAgentMonitorListeners, event forwarding)
  - Agent handlers: `handlers/agent-rpc.handlers.ts` (getConfig, setConfig, detectClis)

### Patterns Identified

1. **CLI Adapter Pattern** (verified: 3 adapters follow identical structure)

   - Implements `CliAdapter` interface (`cli-adapter.interface.ts:59-98`)
   - Has `detect()`, `buildCommand()`, `runSdk()`, `listModels()`, `parseOutput()`
   - `runSdk()` returns `SdkHandle` with `abort`, `done`, `onOutput`, optional `onSegment`, `getSessionId`
   - Registered in `CliDetectionService` constructor (`cli-detection.service.ts:33-35`)

2. **SdkHandle Consumption Pattern** (verified: `agent-process-manager.service.ts:345-474`)

   - `doSpawnSdk()` receives the handle, wires `onOutput` to buffer, `onSegment` to accumulator
   - Captures `getSessionId()` both initially and on each segment
   - Wires `done` promise to `handleExit()`
   - Abort via `AbortController`

3. **Event Forwarding Pattern** (verified: `rpc-method-registration.service.ts:161-222`)

   - `AgentProcessManager.events` emits `agent:spawned`, `agent:output`, `agent:exited`
   - `setupAgentMonitorListeners()` forwards to webview via `broadcastMessage()`
   - MESSAGE_TYPES: `AGENT_MONITOR_SPAWNED`, `AGENT_MONITOR_OUTPUT`, `AGENT_MONITOR_EXITED`

4. **Frontend Store Pattern** (verified: `agent-monitor.store.ts`)

   - Signal-based with `signal()` and `computed()`
   - Immutable updates via `Map` copy pattern
   - `onAgentSpawned()`, `onAgentOutput()`, `onAgentExited()` methods

5. **Permission Pattern** (verified: `permission.types.ts`, `message.types.ts:204-227`)
   - Two permission systems exist: SDK permissions and MCP permissions
   - Both use `PermissionRequest`/`PermissionResponse` types
   - Different response message types: `SDK_PERMISSION_RESPONSE` vs `MCP_PERMISSION_RESPONSE`
   - The Copilot agent permission system will be a THIRD system with its own message types

### Integration Points

- **SDK already in package.json**: `"@github/copilot-sdk": "^0.1.25"` (verified: `package.json:76`)
- **VS Code GitHub auth**: `vscode.authentication.getSession('github', ['copilot'])` for token
- **Feature flag**: Will use `ptah.copilot.useSdk` VS Code configuration setting
- **CliDetectionService**: Conditional adapter registration based on feature flag

---

## Architecture Design

### Design Philosophy

**Chosen Approach**: New `CopilotSdkAdapter` class alongside existing `CopilotCliAdapter`, selected at registration time via a VS Code configuration flag.

**Rationale**: The SDK is in Technical Preview (v0.1.x). Keeping the CLI adapter as a fallback is essential. The adapter pattern already supports this -- `CliDetectionService` registers adapters by `CliType` key, so we swap which implementation is registered. No backward compatibility layers needed; the feature flag picks one or the other at startup.

**Evidence**:

- `CliDetectionService` constructor (`cli-detection.service.ts:33-35`) registers adapters by key
- All consumers only interact via `CliAdapter` interface (`cli-adapter.interface.ts:59-98`)
- `AgentProcessManager.doSpawnSdk()` is fully generic -- works with any `SdkHandle`

### Data Flow Architecture

```
User Request (Claude Agent → ptah_agent_spawn → AgentProcessManager)
    │
    ▼
CliDetectionService.getAdapter('copilot')
    │ ── feature flag: ptah.copilot.useSdk ──
    │                                          │
    ▼                                          ▼
CopilotCliAdapter (existing)            CopilotSdkAdapter (NEW)
  │ spawn CLI process                     │ CopilotClient.createSession()
  │ raw text stdout                       │ typed events + hooks
  │ no permission control                 │
  ▼                                       ▼
SdkHandle { abort, done, onOutput }    SdkHandle { abort, done, onOutput, onSegment, getSessionId }
    │                                      │
    ▼                                      ▼
AgentProcessManager.doSpawnSdk()           │
    │ wires onOutput → buffer              │ onPreToolUse → PermissionBridge
    │ wires onSegment → accumulator        │ onAskUserInput (Phase 3 optional)
    │ done → handleExit                    │
    ▼                                      ▼
events: agent:spawned, agent:output, agent:exited
    │
    ▼
RpcMethodRegistrationService → broadcastMessage() → webview
    │
    ▼
AgentMonitorStore → AgentCardComponent (with permission UI)
```

### Permission Bridge Architecture (Phase 2)

```
CopilotSdkAdapter.onPreToolUse(event)
    │ (called by SDK when Copilot wants to use a tool)
    │
    ▼
PermissionBridge.requestPermission({
  agentId, toolName, toolArgs, description
})
    │ creates Promise with stored resolver
    │ emits event: 'agent:permission-request'
    │
    ▼
AgentProcessManager.events → RpcMethodRegistrationService
    │ broadcastMessage(AGENT_MONITOR_PERMISSION_REQUEST)
    │
    ▼
AgentMonitorStore.onPermissionRequest()
    │ stores pending request on agent
    │
    ▼
AgentCardComponent renders permission dialog
    │ user clicks Allow/Deny
    │
    ▼
VSCodeService.rpc('agent:permissionResponse', { agentId, requestId, decision })
    │
    ▼
AgentRpcHandlers (NEW method) → PermissionBridge.resolvePermission()
    │ resolves stored Promise
    │
    ▼
CopilotSdkAdapter: onPreToolUse returns { permissionDecision: decision }
```

---

## Component Specifications

### Component 1: CopilotSdkAdapter

**Purpose**: SDK-based Copilot adapter that uses `@github/copilot-sdk` instead of raw CLI spawning. Provides structured streaming events, permission hooks, session management, and crash recovery.

**Pattern**: CliAdapter interface (verified: `cli-adapter.interface.ts:59-98`)
**Evidence**: GeminiCliAdapter (`gemini-cli.adapter.ts:71`), CodexCliAdapter, CopilotCliAdapter (`copilot-cli.adapter.ts:40`) all follow this pattern.

**File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-adapters\copilot-sdk.adapter.ts` (CREATE)

**Responsibilities**:

- Initialize `CopilotClient` singleton (shared across sessions, auto-restart)
- Authenticate via VS Code GitHub auth API
- Create SDK sessions with `sessionId` linking to Ptah AgentId
- Map SDK streaming events to `CliOutputSegment` types
- Implement `onPreToolUse` hook for permission routing
- Implement `onAskUserInput` hook for user input routing (if Phase 3 included)
- Support session resume via `resumeSession()`
- Graceful shutdown: stop client on abort

**Implementation Pattern**:

```typescript
// Pattern source: copilot-cli.adapter.ts:40-104, gemini-cli.adapter.ts:71-100
import { CopilotClient } from '@github/copilot-sdk';
import * as vscode from 'vscode';
import type { CliDetectionResult, CliOutputSegment } from '@ptah-extension/shared';
import type { CliAdapter, CliCommand, CliCommandOptions, CliModelInfo, SdkHandle } from './cli-adapter.interface';
import { resolveCliPath, buildTaskPrompt, stripAnsiCodes } from './cli-adapter.utils';
import type { CopilotPermissionBridge } from './copilot-permission-bridge';

export class CopilotSdkAdapter implements CliAdapter {
  readonly name = 'copilot' as const;
  readonly displayName = 'Copilot SDK';

  private client: CopilotClient | null = null;
  private permissionBridge: CopilotPermissionBridge;

  constructor(permissionBridge: CopilotPermissionBridge) {
    this.permissionBridge = permissionBridge;
  }

  async detect(): Promise<CliDetectionResult> {
    // Same detection as CopilotCliAdapter -- SDK needs the CLI binary
    const binaryPath = await resolveCliPath('copilot');
    if (!binaryPath) {
      return { cli: 'copilot', installed: false, supportsSteer: false };
    }
    // ... version check
    return { cli: 'copilot', installed: true, path: binaryPath, version, supportsSteer: false };
  }

  buildCommand(options: CliCommandOptions): CliCommand {
    // Fallback only -- runSdk() is always preferred
    return { binary: 'copilot', args: ['-p', buildTaskPrompt(options), '--yolo', '--autopilot'] };
  }

  supportsSteer(): boolean {
    return false;
  }
  parseOutput(raw: string): string {
    return stripAnsiCodes(raw);
  }

  async listModels(): Promise<CliModelInfo[]> {
    // Use SDK's listModels() if client is initialized, else static list
    if (this.client) {
      try {
        const models = await this.client.listModels();
        return models.map((m) => ({ id: m.id, name: m.name }));
      } catch {
        /* fallback */
      }
    }
    return COPILOT_MODELS; // static fallback list from existing adapter
  }

  async runSdk(options: CliCommandOptions): Promise<SdkHandle> {
    await this.ensureClient(options.binaryPath);

    const sessionId = `ptah-${options.task.substring(0, 20)}-${Date.now()}`;
    const abortController = new AbortController();
    const outputCallbacks: Array<(data: string) => void> = [];
    const segmentCallbacks: Array<(seg: CliOutputSegment) => void> = [];
    const outputBuffer: string[] = [];

    // Resume or create session
    const session = options.resumeSessionId
      ? await this.client!.resumeSession({ sessionId: options.resumeSessionId })
      : await this.client!.createSession({
          sessionId,
          model: options.model ?? 'claude-sonnet-4.6',
          streaming: true,
          hooks: {
            onPreToolUse: async (event) => this.handlePreToolUse(event, options),
          },
        });

    // Wire SDK events → SdkHandle callbacks
    session.on('assistant.message_delta', (ev) => {
      /* emit text segment */
    });
    session.on('tool.execution_start', (ev) => {
      /* emit tool-call segment */
    });
    session.on('tool.execution_complete', (ev) => {
      /* emit tool-result segment */
    });

    // Send the task
    const taskPrompt = buildTaskPrompt(options);
    await session.send({ prompt: taskPrompt });

    // Done promise
    const done = new Promise<number>((resolve) => {
      session.on('session.idle', () => resolve(0));
      session.on('session.error', () => resolve(1));
    });

    // Abort handler
    abortController.signal.addEventListener('abort', () => {
      // SDK session cleanup
    });

    return {
      abort: abortController,
      done,
      onOutput: (cb) => {
        outputCallbacks.push(cb); /* flush buffer */
      },
      onSegment: (cb) => {
        segmentCallbacks.push(cb);
      },
      getSessionId: () => sessionId,
    };
  }

  private async ensureClient(binaryPath?: string): Promise<void> {
    if (this.client) return;
    const token = await this.getGitHubToken();
    this.client = new CopilotClient({
      cliPath: binaryPath,
      githubToken: token,
      autoRestart: true,
      autoStart: true,
    });
    await this.client.start();
  }

  private async getGitHubToken(): Promise<string> {
    const session = await vscode.authentication.getSession('github', ['copilot'], { createIfNone: false });
    if (session) return session.accessToken;
    throw new Error('GitHub authentication required for Copilot SDK');
  }

  private async handlePreToolUse(event: { toolName: string; toolArgs: string }, options: CliCommandOptions) {
    return this.permissionBridge.requestPermission({
      agentId: options.task, // Will be resolved to actual agentId
      toolName: event.toolName,
      toolArgs: event.toolArgs,
    });
  }

  /** Stop the client (called on extension deactivation) */
  async dispose(): Promise<void> {
    if (this.client) {
      await this.client.stop();
      this.client = null;
    }
  }
}
```

**Quality Requirements**:

- Client must be singleton (one CLI process per extension lifetime)
- Auto-restart on crash (SDK built-in `autoRestart: true`)
- Token must be refreshed if expired
- All SDK event types must map to existing `CliOutputSegment` types
- Session IDs must be deterministic for resume capability
- Abort must clean up both the SDK session and the client connection

**Files Affected**:

- `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-adapters\copilot-sdk.adapter.ts` (CREATE)

---

### Component 2: CopilotPermissionBridge

**Purpose**: Bidirectional async communication bridge between the SDK's `onPreToolUse` hook (which blocks waiting for a decision) and the webview UI (which displays an allow/deny dialog).

**Pattern**: Promise-based request/response with event emission (similar to `PermissionPromptService` in vscode-core for MCP permissions, but for CLI agent context).
**Evidence**: `permission.types.ts:19-60` (existing PermissionRequest/Response types), `rpc-method-registration.service.ts:161-222` (event forwarding pattern)

**File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-adapters\copilot-permission-bridge.ts` (CREATE)

**Responsibilities**:

- Store pending permission requests as Map<requestId, Promise resolver>
- Emit permission request events that `AgentProcessManager` can forward
- Receive permission responses and resolve the corresponding Promise
- Auto-deny after configurable timeout (prevent hanging SDK hook)
- Support read-only tool auto-approval list

**Implementation Pattern**:

```typescript
import { EventEmitter } from 'eventemitter3';
import { v4 as uuidv4 } from 'uuid';
import type { AgentPermissionRequest, AgentPermissionDecision } from '@ptah-extension/shared';

/** Default timeout for permission requests: 60 seconds */
const PERMISSION_TIMEOUT = 60_000;

/** Tools that are always auto-approved (read-only operations) */
const AUTO_APPROVE_TOOLS = new Set(['View', 'Read', 'Glob', 'Grep', 'LS', 'view', 'read', 'glob', 'grep', 'ls']);

export class CopilotPermissionBridge {
  readonly events = new EventEmitter();
  private readonly pending = new Map<
    string,
    {
      resolve: (decision: AgentPermissionDecision) => void;
      timeout: NodeJS.Timeout;
    }
  >();

  async requestPermission(params: { agentId: string; toolName: string; toolArgs: string }): Promise<{ permissionDecision: 'allow' | 'deny'; permissionDecisionReason?: string }> {
    // Auto-approve read-only tools
    if (AUTO_APPROVE_TOOLS.has(params.toolName)) {
      return { permissionDecision: 'allow' };
    }

    const requestId = uuidv4();
    const request: AgentPermissionRequest = {
      requestId,
      agentId: params.agentId,
      toolName: params.toolName,
      toolArgs: params.toolArgs,
      description: `Copilot wants to use ${params.toolName}`,
      timestamp: Date.now(),
      timeoutAt: Date.now() + PERMISSION_TIMEOUT,
    };

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        resolve({ permissionDecision: 'deny', permissionDecisionReason: 'Timed out waiting for user response' });
      }, PERMISSION_TIMEOUT);

      this.pending.set(requestId, {
        resolve: (decision) => {
          clearTimeout(timeout);
          this.pending.delete(requestId);
          resolve({
            permissionDecision: decision.decision === 'allow' ? 'allow' : 'deny',
            permissionDecisionReason: decision.reason,
          });
        },
        timeout,
      });

      // Emit event for RPC forwarding to webview
      this.events.emit('permission-request', request);
    });
  }

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
      entry.resolve({ decision: 'deny', reason: 'Agent stopped' });
    }
    this.pending.clear();
  }
}
```

**Files Affected**:

- `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-adapters\copilot-permission-bridge.ts` (CREATE)

---

### Component 3: Shared Types (Agent Permission & User Input)

**Purpose**: Type definitions for the Copilot agent permission and user input routing system. These are distinct from the existing SDK permission types (which handle Claude tool permissions).

**Pattern**: Type-only definitions in shared library (verified: `permission.types.ts`, `agent-process.types.ts`)
**Evidence**: All cross-library types defined in `libs/shared/src/lib/types/` and exported from `src/index.ts`

**File**: `D:\projects\ptah-extension\libs\shared\src\lib\types\agent-permission.types.ts` (CREATE)

**Type Definitions**:

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
  /** Tool name the agent wants to use (e.g., "bash", "edit", "create") */
  readonly toolName: string;
  /** JSON string of tool arguments */
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

/** User input request from a CLI agent (Copilot SDK onAskUserInput hook) */
export interface AgentUserInputRequest {
  /** Unique request ID */
  readonly requestId: string;
  /** Agent asking for input */
  readonly agentId: string;
  /** The question/prompt from the agent */
  readonly prompt: string;
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
  readonly response: string;
}
```

**Files Affected**:

- `D:\projects\ptah-extension\libs\shared\src\lib\types\agent-permission.types.ts` (CREATE)
- `D:\projects\ptah-extension\libs\shared\src\index.ts` (MODIFY -- add export)
- `D:\projects\ptah-extension\libs\shared\src\lib\types\message.types.ts` (MODIFY -- add new MESSAGE_TYPES)

**New MESSAGE_TYPES** (add to `message.types.ts`):

```typescript
// ---- Agent Permission Messages (TASK_2025_162) ----
// CLI agent tool permission routing (Copilot SDK onPreToolUse)
AGENT_MONITOR_PERMISSION_REQUEST: 'agent-monitor:permission-request',
AGENT_MONITOR_PERMISSION_RESPONSE: 'agent-monitor:permission-response',
// CLI agent user input routing (Copilot SDK onAskUserInput)
AGENT_MONITOR_USER_INPUT_REQUEST: 'agent-monitor:user-input-request',
AGENT_MONITOR_USER_INPUT_RESPONSE: 'agent-monitor:user-input-response',
```

---

### Component 4: CliDetectionService Conditional Registration

**Purpose**: Register `CopilotSdkAdapter` instead of `CopilotCliAdapter` when the feature flag is enabled.

**Pattern**: Constructor-time adapter registration (verified: `cli-detection.service.ts:33-35`)
**Evidence**: Current registration is `this.adapters.set('copilot', new CopilotCliAdapter())`

**File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-detection.service.ts` (MODIFY)

**Changes**:

```typescript
// In constructor:
import { CopilotSdkAdapter } from './cli-adapters/copilot-sdk.adapter';
import { CopilotPermissionBridge } from './cli-adapters/copilot-permission-bridge';

// Check feature flag
const useSdk = vscode.workspace.getConfiguration('ptah.copilot').get<boolean>('useSdk', false);

if (useSdk) {
  const permissionBridge = new CopilotPermissionBridge();
  this.adapters.set('copilot', new CopilotSdkAdapter(permissionBridge));
  this.logger.info('[CliDetection] Copilot SDK adapter registered (feature flag enabled)');
} else {
  this.adapters.set('copilot', new CopilotCliAdapter());
  this.logger.info('[CliDetection] Copilot CLI adapter registered (default)');
}
```

**VS Code Setting** (add to `apps/ptah-extension-vscode/package.json` contributes.configuration):

```json
"ptah.copilot.useSdk": {
  "type": "boolean",
  "default": false,
  "description": "Use the Copilot SDK (Technical Preview) instead of CLI spawning. Enables permission routing, structured events, and session resume."
}
```

**Files Affected**:

- `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-detection.service.ts` (MODIFY)
- `D:\projects\ptah-extension\apps\ptah-extension-vscode\package.json` (MODIFY -- add setting)

---

### Component 5: Permission Event Forwarding (RPC Layer)

**Purpose**: Forward Copilot agent permission requests from extension to webview, and route user decisions back from webview to extension.

**Pattern**: Event forwarding via `broadcastMessage()` + RPC method for responses (verified: `rpc-method-registration.service.ts:161-222` for event forwarding, `agent-rpc.handlers.ts` for RPC registration)
**Evidence**: Existing `agent:spawned` → `AGENT_MONITOR_SPAWNED` pattern

**Files**:

- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\rpc-method-registration.service.ts` (MODIFY)
- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\agent-rpc.handlers.ts` (MODIFY)

**Changes to rpc-method-registration.service.ts** (`setupAgentMonitorListeners`):

```typescript
// After existing event listeners, add permission bridge listener:
// The permission bridge is accessed via the SDK adapter.
// We check if the registered copilot adapter has a permissionBridge property.
const copilotAdapter = agentProcessManager['cliDetection']?.getAdapter?.('copilot');
if (copilotAdapter && 'permissionBridge' in copilotAdapter) {
  const bridge = (copilotAdapter as { permissionBridge: { events: EventEmitter } }).permissionBridge;

  bridge.events.on('permission-request', (request: AgentPermissionRequest) => {
    this.webviewManager.broadcastMessage(MESSAGE_TYPES.AGENT_MONITOR_PERMISSION_REQUEST, request).catch((error) => {
      this.logger.error('Failed to send agent permission request to webview', error instanceof Error ? error : new Error(String(error)));
    });
  });
}
```

**Changes to agent-rpc.handlers.ts** (new `agent:permissionResponse` method):

```typescript
private registerPermissionResponse(): void {
  this.rpcHandler.registerMethod<AgentPermissionDecision, { success: boolean }>(
    'agent:permissionResponse',
    async (params) => {
      try {
        const copilotAdapter = this.cliDetection.getAdapter('copilot');
        if (copilotAdapter && 'permissionBridge' in copilotAdapter) {
          const bridge = (copilotAdapter as any).permissionBridge as CopilotPermissionBridge;
          bridge.resolvePermission(params.requestId, params);
          return { success: true };
        }
        return { success: false, error: 'SDK adapter not active' };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }
  );
}
```

---

### Component 6: Frontend Permission UI

**Purpose**: Display permission request dialogs in the agent card when Copilot wants to use a tool. Show Allow/Deny buttons. Route decisions back to extension via RPC.

**Pattern**: Signal-based component state with `MonitoredAgent` (verified: `agent-monitor.store.ts`, `agent-card.component.ts`)
**Evidence**: Existing `permission-request-card.component.ts` in molecules folder provides a UI pattern reference

**Files**:

- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\agent-monitor.store.ts` (MODIFY)
- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\agent-card.component.ts` (MODIFY)

**Changes to MonitoredAgent interface**:

```typescript
export interface MonitoredAgent {
  // ... existing fields ...
  /** Pending permission request from the agent (Copilot SDK onPreToolUse) */
  pendingPermission?: {
    readonly requestId: string;
    readonly toolName: string;
    readonly toolArgs: string;
    readonly description: string;
    readonly timestamp: number;
    readonly timeoutAt: number;
  } | null;
}
```

**New store methods**:

```typescript
onPermissionRequest(request: AgentPermissionRequest): void {
  this._agents.update((map) => {
    const agent = map.get(request.agentId);
    if (!agent) return map;
    const next = new Map(map);
    next.set(request.agentId, {
      ...agent,
      pendingPermission: {
        requestId: request.requestId,
        toolName: request.toolName,
        toolArgs: request.toolArgs,
        description: request.description,
        timestamp: request.timestamp,
        timeoutAt: request.timeoutAt,
      },
    });
    return next;
  });
}

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

**AgentCardComponent permission UI** (add to template after status badge section):

```html
@if (agent().pendingPermission) {
<div class="border-t border-warning/20 bg-warning/5 px-3 py-2 flex-shrink-0">
  <div class="flex items-center gap-2 mb-1.5">
    <span class="badge badge-sm badge-warning">Permission</span>
    <span class="text-[10px] text-base-content/60"> {{ agent().pendingPermission!.description }} </span>
  </div>
  <div class="flex items-center gap-1.5">
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

**AgentCardComponent methods**:

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

---

### Component 7: Adapter Barrel Export Update

**Purpose**: Export the new adapter and permission bridge from the library's barrel files.

**Files**:

- `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-adapters\index.ts` (MODIFY -- add exports)
- `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\index.ts` (MODIFY -- export permission bridge if needed)

---

## Batching Strategy

### Batch 1: Foundation Types & Feature Flag (Backend + Shared)

**Scope**: Create the new shared types, message constants, and VS Code setting. No behavioral changes yet.

**Files**:

1. `libs/shared/src/lib/types/agent-permission.types.ts` (CREATE) -- new types
2. `libs/shared/src/index.ts` (MODIFY) -- export new types
3. `libs/shared/src/lib/types/message.types.ts` (MODIFY) -- add 4 new MESSAGE_TYPES constants
4. `apps/ptah-extension-vscode/package.json` (MODIFY) -- add `ptah.copilot.useSdk` setting

**Verification**: `nx typecheck shared` passes. No runtime changes.

### Batch 2: SDK Adapter + Permission Bridge (Backend)

**Scope**: Create the `CopilotSdkAdapter` and `CopilotPermissionBridge`. Wire into `CliDetectionService` with feature flag. This is the core SDK integration.

**Dependencies**: Batch 1 (types must exist)

**Files**:

1. `libs/backend/llm-abstraction/src/lib/services/cli-adapters/copilot-sdk.adapter.ts` (CREATE) -- main adapter
2. `libs/backend/llm-abstraction/src/lib/services/cli-adapters/copilot-permission-bridge.ts` (CREATE) -- permission bridge
3. `libs/backend/llm-abstraction/src/lib/services/cli-adapters/index.ts` (MODIFY) -- export new files
4. `libs/backend/llm-abstraction/src/lib/services/cli-detection.service.ts` (MODIFY) -- conditional registration
5. `libs/backend/llm-abstraction/src/index.ts` (MODIFY) -- export if needed

**Verification**: `nx typecheck llm-abstraction` passes. Extension compiles. With `ptah.copilot.useSdk: true`, the SDK adapter is registered. CLI adapter remains default.

### Batch 3: RPC Event Forwarding (Extension App)

**Scope**: Wire permission events through the RPC layer. Forward permission requests to webview, handle responses.

**Dependencies**: Batch 2 (adapter + bridge must exist)

**Files**:

1. `apps/ptah-extension-vscode/src/services/rpc/rpc-method-registration.service.ts` (MODIFY) -- add permission event forwarding in `setupAgentMonitorListeners()`
2. `apps/ptah-extension-vscode/src/services/rpc/handlers/agent-rpc.handlers.ts` (MODIFY) -- add `agent:permissionResponse` RPC method

**Verification**: Extension compiles. Permission events flow from extension to webview. Permission responses flow back.

### Batch 4: Frontend Permission UI (Webview)

**Scope**: Display permission dialogs in agent cards. Handle user decisions and route back.

**Dependencies**: Batch 3 (RPC methods must exist)

**Files**:

1. `libs/frontend/chat/src/lib/services/agent-monitor.store.ts` (MODIFY) -- add `pendingPermission` field, new methods
2. `libs/frontend/chat/src/lib/components/molecules/agent-card.component.ts` (MODIFY) -- add permission UI in template, allow/deny handlers
3. `libs/frontend/chat/src/lib/components/organisms/agent-monitor-panel.component.ts` (MODIFY) -- wire permission message handling (if messages are received at panel level)

**Verification**: `nx typecheck chat` passes. Permission dialog renders in agent card. Allow/Deny buttons send decisions.

### Batch 5 (OPTIONAL): Session Resume + Dispose Lifecycle

**Scope**: Wire session resume through the existing `resumeSessionId` infrastructure (from TASK_2025_161). Add `dispose()` lifecycle to stop the SDK client on extension deactivation.

**Dependencies**: Batch 2 (adapter must exist)

**Files**:

1. `libs/backend/llm-abstraction/src/lib/services/cli-adapters/copilot-sdk.adapter.ts` (MODIFY) -- ensure `resumeSession` works
2. `libs/backend/llm-abstraction/src/lib/services/agent-process-manager.service.ts` (MODIFY) -- call `dispose()` on SDK adapter in `shutdownAll()` if applicable

**Verification**: Resuming a Copilot session works. Extension deactivation stops the CLI process cleanly.

---

## Phase 3: Direct Tool Injection (OPTIONAL -- Deferred)

**Scope**: Build Ptah tool definitions (workspace analysis, search, diagnostics, etc.) as Zod schemas and inject them into the SDK's `tools` config instead of routing through MCP.

**Status**: DEFERRED. This is a significant additional scope that requires:

- Mapping all `ptah_*` MCP tools to Zod schema definitions
- Building async handlers that call the existing Ptah API services
- Removing `--additional-mcp-config` and `--disable-mcp-server` flags from the SDK path
- Testing that Copilot actually discovers and uses the injected tools

**Recommendation**: Implement Phases 1+2+4 first. Validate SDK stability. Then consider Phase 3 as a follow-up task (TASK_2025_163 or similar).

---

## Risk Mitigation

### SDK Technical Preview (HIGH)

**Risk**: Breaking API changes in `@github/copilot-sdk` v0.1.x.
**Mitigation**:

- Feature flag (`ptah.copilot.useSdk: false` by default) keeps CLI as default
- Pin SDK version in package.json (`^0.1.25`)
- All SDK interactions isolated in `copilot-sdk.adapter.ts` -- single file to update on API changes
- Graceful fallback: if SDK initialization fails, log error and fall back to CLI

### Permission Hook Blocking (MEDIUM)

**Risk**: `onPreToolUse` blocks the SDK event loop waiting for user response. If user doesn't respond, the agent hangs.
**Mitigation**:

- 60-second timeout on all permission requests (auto-deny)
- Timeout countdown displayed in UI
- `cleanup()` method called on agent abort/exit to resolve all pending promises

### Authentication Token Expiry (LOW)

**Risk**: GitHub token expires mid-session.
**Mitigation**:

- SDK handles token refresh internally when `autoRestart` is enabled
- Fallback: catch auth errors and prompt user to re-authenticate

### Bundle Size Impact (LOW)

**Risk**: `@github/copilot-sdk` increases extension bundle size.
**Mitigation**:

- SDK is already in `package.json` (`"@github/copilot-sdk": "^0.1.25"`)
- SDK uses `vscode-jsonrpc` which is already a VS Code ecosystem dependency
- Tree-shaking: only import what's needed

---

## Testing Considerations

### Unit Tests

1. **CopilotSdkAdapter**: Mock `CopilotClient` and verify:

   - `runSdk()` creates session with correct options
   - SDK events map to correct `CliOutputSegment` types
   - `getSessionId()` returns the custom session ID
   - Resume path calls `resumeSession()` correctly
   - Abort triggers cleanup

2. **CopilotPermissionBridge**:

   - `requestPermission()` emits event and returns Promise
   - `resolvePermission()` resolves the correct Promise
   - Timeout auto-denies after PERMISSION_TIMEOUT
   - `cleanup()` resolves all pending with 'deny'
   - Auto-approve for read-only tools

3. **AgentMonitorStore**:
   - `onPermissionRequest()` adds permission to correct agent
   - `clearPermission()` removes it
   - Permission state is immutable (new Map on update)

### Integration Tests

1. **Feature Flag Toggle**: Verify that toggling `ptah.copilot.useSdk` switches between adapters
2. **Event Flow**: Permission request flows from adapter → bridge → RPC → webview → RPC → bridge → adapter
3. **Session Linking**: `cliSessionId` captured from SDK and persisted to session metadata

### Manual Testing

1. Enable `ptah.copilot.useSdk: true`
2. Spawn a Copilot agent via Claude
3. Verify structured segments appear in agent card (not raw text)
4. Verify permission dialog appears for write operations
5. Click Allow -- verify agent continues
6. Click Deny -- verify agent receives denial
7. Verify session ID displayed in agent card
8. Disable feature flag -- verify CLI adapter works as before

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: backend-developer (primary), frontend-developer (Batch 4 only)

**Rationale**:

- Batch 1-3: Pure TypeScript backend work (types, adapter, RPC)
- Batch 4: Angular component modification (permission UI in agent card)
- Batch 5: Backend lifecycle management

**Alternative**: A full-stack developer can handle all batches.

### Complexity Assessment

**Complexity**: HIGH
**Estimated Effort**: 16-20 hours

**Breakdown**:

- Batch 1 (Foundation): 1-2 hours
- Batch 2 (SDK Adapter + Bridge): 6-8 hours (core complexity)
- Batch 3 (RPC Forwarding): 2-3 hours
- Batch 4 (Frontend UI): 3-4 hours
- Batch 5 (Session Resume): 2-3 hours

### Files Affected Summary

**CREATE**:

- `libs/backend/llm-abstraction/src/lib/services/cli-adapters/copilot-sdk.adapter.ts`
- `libs/backend/llm-abstraction/src/lib/services/cli-adapters/copilot-permission-bridge.ts`
- `libs/shared/src/lib/types/agent-permission.types.ts`

**MODIFY**:

- `libs/shared/src/index.ts` (add export)
- `libs/shared/src/lib/types/message.types.ts` (add 4 MESSAGE_TYPES)
- `libs/backend/llm-abstraction/src/lib/services/cli-detection.service.ts` (conditional registration)
- `libs/backend/llm-abstraction/src/lib/services/cli-adapters/index.ts` (barrel export)
- `libs/backend/llm-abstraction/src/index.ts` (barrel export)
- `apps/ptah-extension-vscode/package.json` (add setting)
- `apps/ptah-extension-vscode/src/services/rpc/rpc-method-registration.service.ts` (permission forwarding)
- `apps/ptah-extension-vscode/src/services/rpc/handlers/agent-rpc.handlers.ts` (permission response RPC)
- `libs/frontend/chat/src/lib/services/agent-monitor.store.ts` (permission state)
- `libs/frontend/chat/src/lib/components/molecules/agent-card.component.ts` (permission UI)

### Critical Verification Points

**Before Implementation, Developer Must Verify**:

1. **SDK API compatibility**: `import { CopilotClient } from '@github/copilot-sdk'` resolves correctly

   - The package is `@github/copilot-sdk` v0.1.25+ (verified: `package.json:76`)
   - Check actual exported API matches research (constructor options, session methods, event names)

2. **VS Code GitHub auth**: `vscode.authentication.getSession('github', ['copilot'])` returns a valid token

   - Requires GitHub Copilot extension installed
   - Scopes: `['copilot']` may need to be adjusted based on SDK requirements

3. **SDK event names**: Verify actual event type strings from SDK TypeScript definitions:

   - `assistant.message_delta` -- is this the correct event name?
   - `tool.execution_start` / `tool.execution_complete` -- correct?
   - `session.idle` / `session.error` -- correct?
   - **Check**: `node_modules/@github/copilot-sdk/dist/types.d.ts` for actual event discriminators

4. **onPreToolUse hook signature**: Verify the actual hook input/output types:

   - Input: `{ toolName: string; toolArgs: string }` -- is `toolArgs` a string or object?
   - Output: `{ permissionDecision: 'allow' | 'deny' | 'ask' }` -- verify enum values

5. **resumeSession API**: Verify it accepts `{ sessionId: string }`:

   - Research says `client.resumeSession('session-id')` or `client.resumeSession({ sessionId: '...' })`
   - Check actual TypeScript signature

6. **All imports verified**:
   - `CliOutputSegment` from `@ptah-extension/shared` (verified: `agent-process.types.ts:169`)
   - `CliAdapter`, `SdkHandle` from `./cli-adapter.interface` (verified: `cli-adapter.interface.ts:46-98`)
   - `buildTaskPrompt`, `resolveCliPath`, `stripAnsiCodes` from `./cli-adapter.utils` (verified: `cli-adapter.utils.ts`)
   - `MESSAGE_TYPES` from `@ptah-extension/shared` (verified: `message.types.ts:166`)

### Architecture Delivery Checklist

- [x] All components specified with evidence
- [x] All patterns verified from codebase
- [x] All imports/decorators verified as existing
- [x] Quality requirements defined
- [x] Integration points documented
- [x] Files affected list complete
- [x] Developer type recommended
- [x] Complexity assessed
- [x] No step-by-step implementation (that's team-leader's job)
- [x] SDK already in package.json (no npm install needed)
- [x] Feature flag architecture prevents regressions
- [x] Phase 3 (tool injection) clearly marked as OPTIONAL/DEFERRED
