# Implementation Plan - TASK_2025_161: Gemini CLI Session Linking

## Overview

This feature captures Gemini CLI session IDs from JSONL `init` events, persists them in Ptah's SessionMetadata, links CLI agent processes to their parent Claude SDK sessions, and enables session resumption via the `--resume <session_id>` flag. When the main Claude agent spawns a Gemini CLI agent via the `ptah_agent_spawn` MCP tool, the resulting Gemini session ID is captured, stored, and made available for future resumption -- both programmatically (via MCP tool) and visually (in the frontend agent monitor panel).

## Architecture Data Flow

```
User sends message to Claude SDK session (SessionId: "abc-123")
  |
  v
Claude calls ptah_agent_spawn MCP tool
  |
  v
protocol-handlers.ts: ptah_agent_spawn handler
  - Reads parentSessionId from AgentNamespace context
  - Passes { task, cli, parentSessionId, resumeSessionId } to AgentProcessManager.spawn()
  |
  v
AgentProcessManager.spawn()
  - Creates AgentId, stores parentSessionId on AgentProcessInfo
  - Passes resumeSessionId to CliCommandOptions
  - Calls GeminiCliAdapter.runSdk(options)
  |
  v
GeminiCliAdapter.runSdk()
  - If options.resumeSessionId: adds --resume <id> to args
  - Spawns gemini process
  - On init event: captures session_id, stores on SdkHandle via getSessionId()
  |
  v
AgentProcessManager.doSpawnSdk()
  - After SdkHandle returned, queries handle.getSessionId()
  - Stores cliSessionId on TrackedAgent.info
  - Emits 'agent:spawned' with full AgentProcessInfo (includes cliSessionId, parentSessionId)
  |
  v
RpcMethodRegistrationService.setupAgentMonitorListeners()
  - Forwards AgentProcessInfo to webview via AGENT_MONITOR_SPAWNED
  |
  v
Frontend: AgentMonitorStore.onAgentSpawned()
  - Stores parentSessionId, cliSessionId on MonitoredAgent
  - Agent card displays session linkage info
  |
  v
On agent exit:
  - AgentProcessManager emits 'agent:exited' with final info (including cliSessionId)
  - SessionMetadataStore receives cliSession reference for persistence
```

## Codebase Investigation Summary

### Libraries Analyzed

- **shared** (`libs/shared/`) - Foundation types: AgentProcessInfo, SpawnAgentRequest, SpawnAgentResult at `src/lib/types/agent-process.types.ts`
- **llm-abstraction** (`libs/backend/llm-abstraction/`) - GeminiCliAdapter at `src/lib/services/cli-adapters/gemini-cli.adapter.ts`, CliAdapter interface at `cli-adapter.interface.ts`, AgentProcessManager at `src/lib/services/agent-process-manager.service.ts`
- **agent-sdk** (`libs/backend/agent-sdk/`) - SessionMetadataStore at `src/lib/session-metadata-store.ts`, SessionLifecycleManager at `src/lib/helpers/session-lifecycle-manager.ts`
- **vscode-lm-tools** (`libs/backend/vscode-lm-tools/`) - MCP handlers at `src/lib/code-execution/mcp-handlers/protocol-handlers.ts`, tool descriptions at `tool-description.builder.ts`, agent namespace at `namespace-builders/agent-namespace.builder.ts`
- **chat** (`libs/frontend/chat/`) - AgentMonitorStore at `src/lib/services/agent-monitor.store.ts`, AgentCardComponent at `src/lib/components/molecules/agent-card.component.ts`

### Patterns Verified

- **Branded types**: AgentId uses `string & { readonly __brand: 'AgentId' }` pattern (agent-process.types.ts:15)
- **SdkHandle interface**: Returns `{ abort, done, onOutput, onSegment? }` (cli-adapter.interface.ts:44-53)
- **AgentProcessInfo**: Readonly interface with optional fields (agent-process.types.ts:66-76)
- **Signal-based state**: Frontend uses Angular signals, immutable updates (agent-monitor.store.ts:37-38)
- **Event pipeline**: AgentProcessManager emits events -> RpcMethodRegistrationService forwards to webview (rpc-method-registration.service.ts:161-217)

### Key Discovery: session_id Already Parsed but Discarded

- GeminiStreamEvent interface at line 48 has `session_id?: string`
- handleJsonLine() case 'init' at line 426-431 extracts `event.model` but ignores `event.session_id`
- This is the primary gap to close

---

## File-by-File Specifications

### Batch 1: Foundation Types (shared + cli-adapter interface)

These are pure type additions with zero runtime impact. All other batches depend on these types.

---

#### File 1.1: `D:\projects\ptah-extension\libs\shared\src\lib\types\agent-process.types.ts`

**Action**: MODIFY - Add 3 optional fields to 3 interfaces, add 1 new interface

**Changes**:

1. Add `cliSessionId` and `parentSessionId` to `AgentProcessInfo`:

```typescript
export interface AgentProcessInfo {
  readonly agentId: AgentId;
  readonly cli: CliType;
  readonly task: string;
  readonly workingDirectory: string;
  readonly taskFolder?: string;
  status: AgentStatus;
  readonly startedAt: string; // ISO timestamp
  exitCode?: number;
  readonly pid?: number;
  /** CLI-native session ID (e.g., Gemini's UUID from init event). Enables session resume. */
  readonly cliSessionId?: string;
  /** Parent Ptah Claude SDK session that spawned this CLI agent via ptah_agent_spawn. */
  readonly parentSessionId?: string;
}
```

2. Add `resumeSessionId` and `parentSessionId` to `SpawnAgentRequest`:

```typescript
export interface SpawnAgentRequest {
  /** Task description for the CLI agent */
  readonly task: string;
  /** Which CLI to use (auto-detected if omitted) */
  readonly cli?: CliType;
  /** Working directory (defaults to workspace root) */
  readonly workingDirectory?: string;
  /** Timeout in milliseconds (default: 600000 = 10min, max: 1800000 = 30min) */
  readonly timeout?: number;
  /** Files the agent should focus on */
  readonly files?: string[];
  /** Task-tracking folder for shared workspace */
  readonly taskFolder?: string;
  /** Model identifier for CLI agents (e.g., 'gemini-2.5-pro', 'claude-sonnet-4.6'). Passed as --model flag. */
  readonly model?: string;
  /** Resume a previous CLI session by its CLI-native session ID (e.g., Gemini --resume <id>) */
  readonly resumeSessionId?: string;
  /** Parent Ptah Claude SDK session ID. Injected by MCP server, NOT set by callers. */
  readonly parentSessionId?: string;
}
```

3. Add `cliSessionId` to `SpawnAgentResult`:

```typescript
export interface SpawnAgentResult {
  readonly agentId: AgentId;
  readonly cli: CliType;
  readonly status: AgentStatus;
  readonly startedAt: string;
  /** CLI-native session ID captured from init event (e.g., Gemini UUID). Null if not yet available. */
  readonly cliSessionId?: string;
}
```

4. Add new `CliSessionReference` interface (for SessionMetadata persistence):

```typescript
// ========================================
// CLI Session Reference (for session metadata persistence)
// ========================================

/**
 * Reference to a CLI agent session linked to a parent Ptah session.
 * Stored in SessionMetadata.cliSessions[] for resume capability.
 */
export interface CliSessionReference {
  /** CLI-native session ID (e.g., Gemini's UUID) */
  readonly cliSessionId: string;
  /** Which CLI produced this session */
  readonly cli: CliType;
  /** Ptah's branded AgentId that ran this session */
  readonly agentId: string;
  /** Task description the agent was given */
  readonly task: string;
  /** ISO timestamp when the session started */
  readonly startedAt: string;
  /** Final agent status */
  readonly status: AgentStatus;
}
```

**Rationale**: All fields are `readonly` and optional to maintain backward compatibility. The `CliSessionReference` reuses existing `CliType` and `AgentStatus` types (agent-process.types.ts:49-54, 60).

---

#### File 1.2: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-adapters\cli-adapter.interface.ts`

**Action**: MODIFY - Add `getSessionId` to SdkHandle, add `resumeSessionId` to CliCommandOptions

**Changes**:

1. Extend `SdkHandle` with optional `getSessionId`:

```typescript
export interface SdkHandle {
  /** Abort controller to cancel the SDK operation */
  readonly abort: AbortController;
  /** Promise that resolves when SDK execution completes. Resolves with exit code (0=success, 1=error). */
  readonly done: Promise<number>;
  /** Register a callback to receive output data from the SDK execution. */
  readonly onOutput: (callback: (data: string) => void) => void;
  /** Register a callback to receive structured output segments. Optional -- only SDK adapters with structured event data implement this. */
  readonly onSegment?: (callback: (segment: CliOutputSegment) => void) => void;
  /** Get CLI-native session ID (e.g., Gemini session UUID from init event). Returns undefined if not yet available or not supported by this adapter. */
  readonly getSessionId?: () => string | undefined;
}
```

2. Extend `CliCommandOptions` with `resumeSessionId`:

```typescript
export interface CliCommandOptions {
  readonly task: string;
  readonly workingDirectory: string;
  readonly files?: string[];
  readonly taskFolder?: string;
  readonly model?: string;
  readonly binaryPath?: string;
  readonly mcpPort?: number;
  /** Resume a previous CLI session by its CLI-native session ID. When set, the adapter adds appropriate resume flags (e.g., --resume for Gemini). */
  readonly resumeSessionId?: string;
}
```

**Rationale**: Both additions are optional, so existing Codex and Copilot adapters require zero changes. Verified that `SdkHandle` is only returned from `CliAdapter.runSdk()` (cli-adapter.interface.ts:87) and consumed by `AgentProcessManager.doSpawnSdk()` (agent-process-manager.service.ts:344-455).

---

### Batch 2: Gemini Adapter + AgentProcessManager (backend capture + resume)

This batch implements the core session capture and resume logic in the backend.

---

#### File 2.1: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-adapters\gemini-cli.adapter.ts`

**Action**: MODIFY - Capture session_id from init event, add --resume flag support, expose via getSessionId()

**Changes**:

1. Add private field to store captured session ID:

```typescript
export class GeminiCliAdapter implements CliAdapter {
  readonly name = 'gemini' as const;
  readonly displayName = 'Gemini CLI';

  // No class-level state needed -- session ID is captured per-invocation via closure
```

2. Modify `runSdk()` to accept and pass `resumeSessionId`, and return `getSessionId` on the handle:

In the `runSdk()` method, replace the args construction (lines 263-268):

```typescript
  async runSdk(options: CliCommandOptions): Promise<SdkHandle> {
    // ... existing trust + MCP setup ...

    const taskPrompt = buildTaskPrompt(options);
    const abortController = new AbortController();

    // Session ID captured from init event (closure scoped per invocation)
    let capturedSessionId: string | undefined;

    const args = [
      '--output-format',
      'stream-json',
      '--yolo',
    ];

    // Resume mode: use --resume <id> instead of --prompt=
    if (options.resumeSessionId) {
      args.push('--resume', options.resumeSessionId);
    } else {
      args.push('--prompt='); // Headless mode trigger -- actual prompt comes from stdin
    }

    // Add model if specified
    if (options.model) {
      args.push('--model', options.model);
    }

    // ... existing output/segment buffering code unchanged ...
```

3. Modify the `handleJsonLine` case 'init' to capture session_id:

Replace lines 425-431:

```typescript
      case 'init':
        if (event.model) {
          emitOutput(`[Model: ${event.model}]\n`);
          emitSegment({ type: 'info', content: `Model: ${event.model}` });
        }
        if (event.session_id) {
          capturedSessionId = event.session_id;
          emitOutput(`[Session: ${event.session_id}]\n`);
          emitSegment({ type: 'info', content: `Session: ${event.session_id}` });
        }
        break;
```

Note: `handleJsonLine` is a private method that takes `emitOutput` and `emitSegment` callbacks. Since `capturedSessionId` is a closure variable in `runSdk()`, we need to refactor slightly. The cleanest approach is to have `handleJsonLine` return the session_id when it finds one, or use a mutable ref object.

Preferred approach -- pass a setter callback to `handleJsonLine`:

```typescript
// In runSdk(), replace the handleJsonLine call:
child.stdout?.on('data', (data: string) => {
  lineBuf += data;
  const lines = lineBuf.split('\n');
  lineBuf = lines.pop() ?? '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const sessionId = this.handleJsonLine(trimmed, emitOutput, emitSegment);
    if (sessionId) {
      capturedSessionId = sessionId;
    }
  }
});
```

And modify `handleJsonLine` to return `string | undefined`:

```typescript
  private handleJsonLine(
    line: string,
    emitOutput: (data: string) => void,
    emitSegment: (segment: CliOutputSegment) => void
  ): string | undefined {
    // ... existing parse logic ...

    switch (event.type) {
      case 'init': {
        let sessionId: string | undefined;
        if (event.model) {
          emitOutput(`[Model: ${event.model}]\n`);
          emitSegment({ type: 'info', content: `Model: ${event.model}` });
        }
        if (event.session_id) {
          sessionId = event.session_id;
          emitOutput(`[Session: ${event.session_id}]\n`);
          emitSegment({ type: 'info', content: `Session: ${event.session_id}` });
        }
        return sessionId;
      }

      // ... all other cases return undefined ...
    }
    return undefined;
  }
```

4. Return `getSessionId` on the SdkHandle:

Replace the return statement (line 400):

```typescript
return {
  abort: abortController,
  done,
  onOutput,
  onSegment,
  getSessionId: () => capturedSessionId,
};
```

5. Handle stdin for resume vs fresh mode:

After spawning, modify the stdin write (lines 335-336):

```typescript
// Write prompt to stdin only for fresh sessions (not resume)
if (!options.resumeSessionId) {
  child.stdin?.write(taskPrompt + '\n');
  child.stdin?.end();
} else {
  // Resume mode: Gemini CLI loads existing session context.
  // If there's a new prompt, write it; otherwise just close stdin.
  if (taskPrompt.trim()) {
    child.stdin?.write(taskPrompt + '\n');
  }
  child.stdin?.end();
}
```

**Evidence**:

- `GeminiStreamEvent.session_id` already defined at line 48
- `handleJsonLine` case 'init' at lines 425-431 currently discards session_id
- `--resume` flag compatible with `--output-format stream-json` and `--yolo` per research doc

---

#### File 2.2: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\agent-process-manager.service.ts`

**Action**: MODIFY - Thread parentSessionId and resumeSessionId through spawn, capture cliSessionId from SdkHandle

**Changes**:

1. In `doSpawnSdk()` (line 344), pass `resumeSessionId` to the SDK adapter and capture `cliSessionId`:

```typescript
  private async doSpawnSdk(
    runSdk: (options: CliCommandOptions) => Promise<SdkHandle>,
    request: SpawnAgentRequest,
    task: string,
    workingDirectory: string,
    cli: CliType,
    binaryPath?: string,
    mcpPort?: number
  ): Promise<SpawnAgentResult> {
    const agentId = AgentId.create();
    const startedAt = new Date().toISOString();

    const info: AgentProcessInfo = {
      agentId,
      cli,
      task: request.task,
      workingDirectory,
      taskFolder: request.taskFolder,
      status: 'running',
      startedAt,
      parentSessionId: request.parentSessionId,  // NEW: link to parent
    };

    // ... existing model resolution ...

    const sdkHandle = await runSdk({
      task,
      workingDirectory,
      files: request.files,
      taskFolder: request.taskFolder,
      model: resolvedModel,
      binaryPath,
      mcpPort,
      resumeSessionId: request.resumeSessionId,  // NEW: pass resume ID
    });

    // Capture CLI session ID immediately if available (e.g., from sync init)
    const initialCliSessionId = sdkHandle.getSessionId?.();

    // ... existing timeout and tracking setup ...

    const tracked: TrackedAgent = {
      info: initialCliSessionId
        ? { ...info, cliSessionId: initialCliSessionId }
        : info,
      process: null,
      sdkAbortController: sdkHandle.abort,
      // ... rest unchanged ...
    };

    this.agents.set(agentId, tracked);

    // Wire SDK output to buffer
    sdkHandle.onOutput((data: string) => {
      this.appendBuffer(agentId, 'stdout', data);
    });

    // Wire structured segments
    if (sdkHandle.onSegment) {
      sdkHandle.onSegment((segment: CliOutputSegment) => {
        this.accumulateSegment(agentId, segment);

        // Late capture: session_id arrives in init event (first JSONL line).
        // The init event is typically the very first segment, but we check on
        // every segment to be safe (idempotent -- only captures once).
        if (!tracked.info.cliSessionId) {
          const sessionId = sdkHandle.getSessionId?.();
          if (sessionId) {
            tracked.info = { ...tracked.info, cliSessionId: sessionId };
          }
        }
      });
    }

    // ... existing done/error wiring ...

    const spawnResult: SpawnAgentResult = {
      agentId,
      cli,
      status: 'running',
      startedAt,
      cliSessionId: initialCliSessionId,  // NEW: may be undefined initially
    };

    this.events.emit('agent:spawned', tracked.info);
    return spawnResult;
  }
```

2. In the CLI subprocess path (`doSpawn`, around line 257), also add `parentSessionId`:

```typescript
const info: AgentProcessInfo = {
  agentId,
  cli,
  task: request.task,
  workingDirectory,
  taskFolder: request.taskFolder,
  status: 'running',
  startedAt,
  parentSessionId: request.parentSessionId, // NEW
};
```

**Rationale**: The `getSessionId?.()` pattern means adapters that don't implement it (Codex, Copilot) simply return undefined. The late-capture via `onSegment` callback handles the async nature of the init event -- by the time `agent:spawned` fires, the session_id may not yet be available. The cliSessionId is updated in-place on the tracked info when it arrives.

---

### Batch 3: MCP Server + Session Metadata (parentSessionId injection + persistence)

This batch injects the parent session context into the MCP spawn flow and persists CLI sessions.

---

#### File 3.1: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\agent-namespace.builder.ts`

**Action**: MODIFY - Add `parentSessionId` to AgentNamespaceDependencies and inject into spawn calls

**Changes**:

```typescript
/**
 * Dependencies for agent namespace
 */
export interface AgentNamespaceDependencies {
  agentProcessManager: AgentProcessManager;
  cliDetectionService: CliDetectionService;
  /** Active parent Claude SDK session ID. Injected so CLI agents are linked to their parent session. */
  activeSessionId?: string;
}

/**
 * Build the agent namespace for ptah.agent.*
 */
export function buildAgentNamespace(deps: AgentNamespaceDependencies): AgentNamespace {
  const { agentProcessManager, cliDetectionService, activeSessionId } = deps;

  return {
    spawn: async (request) => {
      // Inject parentSessionId from the active SDK session context
      const enrichedRequest = activeSessionId ? { ...request, parentSessionId: activeSessionId } : request;
      return agentProcessManager.spawn(enrichedRequest);
    },

    // ... status, read, steer, stop, list, waitFor remain unchanged ...
  };
}
```

**Rationale**: The `activeSessionId` is passed at build time. The `PtahAPIBuilder` constructs the agent namespace once per MCP server lifecycle or per-request. We need to ensure it captures the current active session. Let me check how `buildAgentNamespace` is called.

Let me verify how the agent namespace is built:

```typescript
// In ptah-api-builder.service.ts, the agent namespace is built with deps.
// The activeSessionId needs to be provided by whoever constructs the PtahAPI.
```

We need to find where `buildAgentNamespace` is called and inject the session ID there.

---

#### File 3.2: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-handlers\protocol-handlers.ts`

**Action**: MODIFY - Pass `resumeSessionId` and `parentSessionId` through ptah_agent_spawn handler

**Changes** to the `ptah_agent_spawn` case (lines 314-363):

```typescript
      case 'ptah_agent_spawn': {
        const {
          task,
          cli,
          workingDirectory,
          timeout,
          files,
          taskFolder,
          model,
          resume_session_id,  // NEW: resume parameter
        } = args as {
          task: string;
          cli?: string;
          workingDirectory?: string;
          timeout?: number;
          files?: string[];
          taskFolder?: string;
          model?: string;
          resume_session_id?: string;  // NEW
        };

        logger.info('[MCP] ptah_agent_spawn invoked', 'CodeExecutionMCP', {
          cli: cli ?? 'auto-detect',
          model: model ?? 'default',
          task: task.substring(0, 100) + (task.length > 100 ? '...' : ''),
          timeout,
          files: files?.length ?? 0,
          taskFolder,
          resumeSessionId: resume_session_id,  // NEW: log it
        });

        const result = await ptahAPI.agent.spawn({
          task,
          cli: cli as CliType | undefined,
          workingDirectory,
          timeout,
          files,
          taskFolder,
          model,
          resumeSessionId: resume_session_id,  // NEW: pass through
          // parentSessionId is injected by buildAgentNamespace, not by MCP args
        });

        logger.info('[MCP] ptah_agent_spawn result', 'CodeExecutionMCP', {
          agentId: result.agentId,
          cli: result.cli,
          status: result.status,
          cliSessionId: result.cliSessionId,  // NEW: log captured session
        });

        return createToolSuccessResponse(
          request,
          formatAgentSpawn(result),
          deps
        );
      }
```

**Note**: The `parentSessionId` is NOT passed as an MCP tool argument. It is injected by `buildAgentNamespace` from the active session context. This is the correct approach per the architecture research (research-cli-session-linking-architecture.md section 5.1, Option B).

---

#### File 3.3: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-handlers\tool-description.builder.ts`

**Action**: MODIFY - Add `resume_session_id` parameter to ptah_agent_spawn tool

**Changes** to `buildAgentSpawnTool()` (lines 258-314):

Add new property inside `inputSchema.properties`:

```typescript
        resume_session_id: {
          type: 'string',
          description:
            'Resume a previous CLI agent session by its CLI-native session ID. ' +
            'For Gemini, this is the UUID from the init event. ' +
            'The agent will continue from where the previous session left off.',
        },
```

Update the description to mention resume:

```typescript
    description:
      'Spawn a headless CLI agent (Gemini, Codex, or Copilot) to work on a task in the background. ' +
      'The agent runs while you continue working. ' +
      'Use ptah_agent_status to check progress and ptah_agent_read to get output. ' +
      'To resume a previous session, pass resume_session_id with the CLI session ID ' +
      '(available from previous spawn results or session metadata). ' +
      'Ideal for delegating: code reviews, test generation, documentation, ' +
      'and other independent subtasks.',
```

---

#### File 3.4: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\session-metadata-store.ts`

**Action**: MODIFY - Add `cliSessions` array to SessionMetadata, add method to append CLI session references

**Changes**:

1. Import the new type:

```typescript
import type { CliSessionReference } from '@ptah-extension/shared';
```

2. Extend `SessionMetadata` interface:

```typescript
export interface SessionMetadata {
  readonly sessionId: string;
  readonly name: string;
  readonly workspaceId: string;
  readonly createdAt: number;
  readonly lastActiveAt: number;
  readonly totalCost: number;
  readonly totalTokens: {
    readonly input: number;
    readonly output: number;
  };
  /** CLI agent sessions linked to this parent session. Enables resume. */
  readonly cliSessions?: readonly CliSessionReference[];
}
```

3. Add new method `addCliSession()`:

```typescript
  /**
   * Add a CLI session reference to a parent session's metadata.
   * Called when a CLI agent exits with a captured cliSessionId.
   */
  async addCliSession(
    sessionId: string,
    cliSession: CliSessionReference
  ): Promise<void> {
    const metadata = await this.get(sessionId);
    if (!metadata) {
      this.logger.warn(
        `[SessionMetadataStore] Cannot add CLI session - parent session not found: ${sessionId}`
      );
      return;
    }

    const existing = metadata.cliSessions ?? [];
    // Deduplicate by cliSessionId
    const alreadyExists = existing.some(
      (s) => s.cliSessionId === cliSession.cliSessionId
    );
    if (alreadyExists) {
      this.logger.debug(
        `[SessionMetadataStore] CLI session ${cliSession.cliSessionId} already linked to ${sessionId}`
      );
      return;
    }

    await this.save({
      ...metadata,
      lastActiveAt: Date.now(),
      cliSessions: [...existing, cliSession],
    });

    this.logger.info(
      `[SessionMetadataStore] Linked CLI session ${cliSession.cliSessionId} (${cliSession.cli}) to session ${sessionId}`
    );
  }
```

---

#### File 3.5: Wiring activeSessionId into PtahAPI builder

We need to identify where `buildAgentNamespace` is called and inject the active session ID. Let me trace the call chain:

The `PtahAPIBuilder` (`ptah-api-builder.service.ts`) constructs the PtahAPI object. The `CodeExecutionMCP` service builds this API once during MCP server startup. To inject the active session ID, we need the `SessionLifecycleManager` to provide the current active session.

**Approach**: In the `AgentNamespaceDependencies`, we add a function `getActiveSessionId` instead of a static value. This way, the namespace reads the current session at spawn time (not at build time).

Updated `agent-namespace.builder.ts`:

```typescript
export interface AgentNamespaceDependencies {
  agentProcessManager: AgentProcessManager;
  cliDetectionService: CliDetectionService;
  /** Function that returns the currently active SDK session ID. Called at spawn time. */
  getActiveSessionId?: () => string | undefined;
}

export function buildAgentNamespace(deps: AgentNamespaceDependencies): AgentNamespace {
  const { agentProcessManager, cliDetectionService, getActiveSessionId } = deps;

  return {
    spawn: async (request) => {
      const activeSessionId = getActiveSessionId?.();
      const enrichedRequest = activeSessionId ? { ...request, parentSessionId: activeSessionId } : request;
      return agentProcessManager.spawn(enrichedRequest);
    },
    // ... rest unchanged
  };
}
```

Then in the PtahAPI builder, pass:

```typescript
agent: buildAgentNamespace({
  agentProcessManager,
  cliDetectionService,
  getActiveSessionId: () => {
    // SessionLifecycleManager.getActiveSessionIds() returns all active sessions.
    // In single-session mode (current), there's at most one.
    const ids = sessionLifecycleManager.getActiveSessionIds();
    return ids.length > 0 ? (ids[0] as string) : undefined;
  },
}),
```

The PtahAPI builder file will need the `SessionLifecycleManager` injected. This is a minor addition to its dependency list.

---

### Batch 4: Frontend Display (MonitoredAgent + AgentCard)

This batch extends the frontend to display session linkage information.

---

#### File 4.1: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\agent-monitor.store.ts`

**Action**: MODIFY - Add `parentSessionId` and `cliSessionId` to MonitoredAgent

**Changes**:

```typescript
export interface MonitoredAgent {
  readonly agentId: string;
  readonly cli: CliType;
  readonly task: string;
  status: AgentStatus;
  readonly startedAt: number;
  stdout: string;
  stderr: string;
  exitCode?: number;
  expanded: boolean;
  segments: CliOutputSegment[];
  /** Parent Ptah Claude SDK session that spawned this agent */
  readonly parentSessionId?: string;
  /** CLI-native session ID (e.g., Gemini UUID). Enables resume. */
  cliSessionId?: string;
}
```

Update `onAgentSpawned()` to capture the new fields:

```typescript
  onAgentSpawned(info: AgentProcessInfo): void {
    const hadAgents = this._agents().size > 0;

    this._agents.update((map) => {
      const next = new Map(map);
      next.set(info.agentId, {
        agentId: info.agentId,
        cli: info.cli,
        task: info.task,
        status: info.status,
        startedAt: new Date(info.startedAt).getTime(),
        stdout: '',
        stderr: '',
        expanded: true,
        segments: [],
        parentSessionId: info.parentSessionId,    // NEW
        cliSessionId: info.cliSessionId,           // NEW
      });
      return next;
    });

    // ... rest unchanged ...
  }
```

Update `onAgentExited()` to capture late-arriving cliSessionId:

```typescript
  onAgentExited(info: AgentProcessInfo): void {
    this._agents.update((map) => {
      const agent = map.get(info.agentId);
      if (!agent) return map;

      const next = new Map(map);
      next.set(info.agentId, {
        ...agent,
        status: info.status,
        exitCode: info.exitCode,
        cliSessionId: info.cliSessionId ?? agent.cliSessionId,  // NEW: update if now available
      });
      return next;
    });

    this.syncTick();
  }
```

---

#### File 4.2: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\agent-card.component.ts`

**Action**: MODIFY - Display cliSessionId badge when available

**Changes** to the template, inside the header button (after the elapsed time span):

```html
<!-- CLI Session ID badge (Gemini resume capability) -->
@if (agent().cliSessionId) {
<span class="badge badge-xs badge-ghost font-mono text-[9px] text-base-content/30 ml-1 flex-shrink-0" title="CLI Session: {{ agent().cliSessionId }}"> {{ agent().cliSessionId | slice:0:8 }}... </span>
}
```

Add `SlicePipe` import:

```typescript
import { NgClass, SlicePipe } from '@angular/common';
```

Update the `imports` array:

```typescript
  imports: [LucideAngularModule, MarkdownModule, NgClass, SlicePipe],
```

Also, add a "Linked to session" indicator in the task description area:

```html
<!-- Task description -->
<div class="px-3 py-1.5 border-t border-base-content/10 flex-shrink-0">
  @if (agent().parentSessionId) {
  <div class="flex items-center gap-1 mb-1">
    <span class="text-[9px] text-base-content/30">Linked to parent session</span>
  </div>
  }
  <p class="text-[11px] leading-relaxed text-base-content/60 line-clamp-2">{{ agent().task }}</p>
</div>
```

---

### Batch 5: RPC + Session Persistence Wiring

This batch connects the agent exit event to session metadata persistence.

---

#### File 5.1: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\rpc-method-registration.service.ts`

**Action**: MODIFY - Add CLI session persistence on agent exit

**Changes** to `setupAgentMonitorListeners()`:

In the `agent:exited` listener, add logic to persist CLI session references:

```typescript
agentProcessManager.events.on('agent:exited', (info: AgentProcessInfo) => {
  // Forward to webview (existing)
  this.webviewManager.broadcastMessage(MESSAGE_TYPES.AGENT_MONITOR_EXITED, info).catch((error) => {
    this.logger.error('Failed to send agent-monitor:exited to webview', error instanceof Error ? error : new Error(String(error)));
  });

  // NEW: Persist CLI session reference to parent session metadata
  if (info.cliSessionId && info.parentSessionId) {
    this.persistCliSessionReference(info);
  }
});
```

Add a new private method:

```typescript
  /**
   * Persist a CLI session reference to the parent session's metadata.
   * Enables session resume when loading saved sessions.
   */
  private persistCliSessionReference(info: AgentProcessInfo): void {
    try {
      const metadataStore = this.container.resolve<{
        addCliSession(sessionId: string, ref: {
          cliSessionId: string;
          cli: string;
          agentId: string;
          task: string;
          startedAt: string;
          status: string;
        }): Promise<void>;
      }>(SDK_TOKENS.SESSION_METADATA_STORE);

      metadataStore
        .addCliSession(info.parentSessionId!, {
          cliSessionId: info.cliSessionId!,
          cli: info.cli,
          agentId: info.agentId,
          task: info.task,
          startedAt: info.startedAt,
          status: info.status,
        })
        .catch((error) => {
          this.logger.error(
            '[RPC] Failed to persist CLI session reference',
            error instanceof Error ? error : new Error(String(error))
          );
        });
    } catch (error) {
      // SessionMetadataStore may not be available
      this.logger.warn(
        '[RPC] Could not persist CLI session reference',
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }
```

Import the `SDK_TOKENS`:

```typescript
import { SdkAgentAdapter, SDK_TOKENS } from '@ptah-extension/agent-sdk';
```

(Already imported on line 28.)

---

## Batching Strategy for Team-Leader

### Batch 1: Foundation Types (1-2 hours)

**Files**: agent-process.types.ts, cli-adapter.interface.ts
**Dependencies**: None
**Developer**: Backend developer
**Scope**: Pure type additions. Zero runtime changes. All other batches depend on this.

### Batch 2: Backend Capture + Resume (3-4 hours)

**Files**: gemini-cli.adapter.ts, agent-process-manager.service.ts
**Dependencies**: Batch 1
**Developer**: Backend developer
**Scope**: Core implementation -- capture session_id from Gemini init events, add --resume flag support, thread parentSessionId through spawn flow. This is the most complex batch.

### Batch 3: MCP + Session Persistence (2-3 hours)

**Files**: agent-namespace.builder.ts, protocol-handlers.ts, tool-description.builder.ts, session-metadata-store.ts, ptah-api-builder.service.ts
**Dependencies**: Batch 1, Batch 2
**Developer**: Backend developer
**Scope**: Wire parentSessionId injection into MCP context, add resume_session_id MCP parameter, persist CLI sessions to metadata store.

### Batch 4: Frontend Display (1-2 hours)

**Files**: agent-monitor.store.ts, agent-card.component.ts
**Dependencies**: Batch 1
**Developer**: Frontend developer
**Scope**: Display parentSessionId and cliSessionId in agent cards. Pure UI additions.

### Batch 5: RPC Persistence Wiring (1 hour)

**Files**: rpc-method-registration.service.ts
**Dependencies**: Batch 3, Batch 4
**Developer**: Backend developer
**Scope**: Connect agent exit events to session metadata persistence.

### Batch Dependency Graph

```
Batch 1 (Types)
  |
  +---> Batch 2 (Backend Capture + Resume)
  |       |
  |       +---> Batch 3 (MCP + Persistence)
  |                |
  |                +---> Batch 5 (RPC Wiring)
  |
  +---> Batch 4 (Frontend Display)
```

Batches 2 and 4 can run in parallel after Batch 1 is complete.

---

## Testing Considerations

### Unit Tests

1. **GeminiCliAdapter.handleJsonLine** - Verify session_id is extracted from init event and returned
2. **GeminiCliAdapter.runSdk** - Verify `--resume` flag is added when `resumeSessionId` is provided
3. **GeminiCliAdapter.runSdk** - Verify `getSessionId()` returns captured session_id after init event
4. **AgentProcessManager.doSpawnSdk** - Verify `parentSessionId` is stored on AgentProcessInfo
5. **AgentProcessManager.doSpawnSdk** - Verify `cliSessionId` is captured from SdkHandle
6. **SessionMetadataStore.addCliSession** - Verify deduplication by cliSessionId
7. **buildAgentNamespace** - Verify `parentSessionId` is injected from `getActiveSessionId()`

### Integration Tests

1. **End-to-end spawn with session capture**: Spawn a Gemini agent, verify cliSessionId appears in the SpawnAgentResult and agent:exited event
2. **Resume flow**: Spawn with `resumeSessionId`, verify `--resume` flag is in process args
3. **MCP flow**: Call ptah_agent_spawn with `resume_session_id`, verify it reaches AgentProcessManager

### Manual Testing

1. Install Gemini CLI, spawn agent via Ptah chat
2. Verify agent card shows truncated session ID badge
3. Verify "Linked to parent session" indicator appears
4. Check session metadata in VS Code Developer Tools (`workspaceState`)
5. Test `--resume` by spawning with a known session ID

---

## Risk Analysis

| Risk                                                         | Level  | Mitigation                                                        |
| ------------------------------------------------------------ | ------ | ----------------------------------------------------------------- |
| session_id not emitted by older Gemini CLI versions          | Low    | Field is optional, graceful degradation                           |
| Race: session_id arrives after agent:spawned event           | Medium | Late-capture via onSegment callback updates TrackedAgent in-place |
| Resume with deleted/expired Gemini session                   | Low    | Gemini CLI returns error, agent fails gracefully with exit code 1 |
| Multiple concurrent SDK sessions (activeSessionId ambiguity) | Low    | Currently single-session; getActiveSessionIds()[0] is safe        |
| Session metadata storage growth (many CLI sessions)          | Low    | CliSessionReference is ~200 bytes; sessions are per-workspace     |

---

## Complexity Assessment

**Complexity**: MEDIUM
**Estimated Effort**: 8-12 hours across 5 batches
**Files Modified**: 10-12 files
**New Files**: 0 (all changes are extensions of existing files)
**Breaking Changes**: None (all additions are optional fields)

---

## Developer Type Recommendation

**Recommended Developer**: Backend developer (primary), Frontend developer (Batch 4 only)

**Rationale**:

- 80% of changes are in backend libraries (shared types, CLI adapter, process manager, MCP handlers, session metadata)
- Only Batch 4 (2 files) is frontend work
- Batch 4 can be done in parallel by a frontend developer while backend batches proceed sequentially

---

## Files Affected Summary

**MODIFY**:

- `D:\projects\ptah-extension\libs\shared\src\lib\types\agent-process.types.ts` (add fields + new interface)
- `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-adapters\cli-adapter.interface.ts` (extend SdkHandle, CliCommandOptions)
- `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-adapters\gemini-cli.adapter.ts` (capture session_id, add --resume)
- `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\agent-process-manager.service.ts` (thread parentSessionId, capture cliSessionId)
- `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\agent-namespace.builder.ts` (inject activeSessionId)
- `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-handlers\protocol-handlers.ts` (pass resume_session_id)
- `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-handlers\tool-description.builder.ts` (add resume param)
- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\session-metadata-store.ts` (add cliSessions, addCliSession method)
- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\agent-monitor.store.ts` (extend MonitoredAgent)
- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\agent-card.component.ts` (display session info)
- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\rpc-method-registration.service.ts` (persist CLI session on exit)

**CREATE**: None

---

## Critical Verification Points

Before implementation, the developer must verify:

1. **All imports exist in codebase**:

   - `CliSessionReference` from `@ptah-extension/shared` (new type, added in Batch 1)
   - `SDK_TOKENS.SESSION_METADATA_STORE` token exists (verify in `libs/backend/agent-sdk/src/lib/di/tokens.ts`)
   - `SessionLifecycleManager.getActiveSessionIds()` exists (verified at `session-lifecycle-manager.ts:236`)

2. **All patterns verified from examples**:

   - Optional field extension pattern: matches existing `taskFolder?: string` on AgentProcessInfo (line 71)
   - SdkHandle extension pattern: matches existing `onSegment?` optional method (line 52)
   - Signal-based store update pattern: matches existing `onAgentExited` immutable update (line 165-180)

3. **No hallucinated APIs**:
   - `SdkHandle.getSessionId` is NEW (added in Batch 1) -- does not exist yet
   - `CliCommandOptions.resumeSessionId` is NEW (added in Batch 1) -- does not exist yet
   - `SessionMetadataStore.addCliSession` is NEW (added in Batch 3) -- does not exist yet
   - All other APIs are verified as existing in current codebase
