# Implementation Plan: Copilot CLI Adapter via @github/copilot-sdk

## Codebase Investigation Summary

### Libraries & Patterns Discovered

- **CLI Adapter Interface**: `libs/backend/llm-abstraction/src/lib/services/cli-adapters/cli-adapter.interface.ts`

  - Defines `CliAdapter`, `CliCommandOptions`, `CliCommand`, `SdkHandle`
  - SDK-based adapters implement `runSdk()` which returns `SdkHandle`
  - `SdkHandle` contract: `{ abort: AbortController, done: Promise<number>, onOutput: (cb) => void }`

- **Existing SDK Adapter (Codex)**: `libs/backend/llm-abstraction/src/lib/services/cli-adapters/codex-cli.adapter.ts`

  - Pattern: Dynamic ESM import with cached module reference (lines 100-121)
  - Local type interfaces mirror SDK types to avoid ESM import at module level (lines 26-93)
  - Output buffering pattern with flush-on-register (lines 219-241)
  - Event handler dispatches to `emitOutput()` (lines 281-342)

- **Existing SDK Adapter (VS Code LM)**: `libs/backend/llm-abstraction/src/lib/services/cli-adapters/vscode-lm.adapter.ts`

  - Same output buffering pattern (lines 244-267)
  - Bridges AbortController to CancellationToken (lines 234-241)

- **CliType union**: `libs/shared/src/lib/types/agent-process.types.ts:60`

  - Current: `'gemini' | 'codex' | 'vscode-lm'`

- **Registration**: `libs/backend/llm-abstraction/src/lib/services/cli-detection.service.ts:33-45`

  - Adapters instantiated in constructor and added to `Map<CliType, CliAdapter>`

- **Consumer**: `libs/backend/llm-abstraction/src/lib/services/agent-process-manager.service.ts`

  - `doSpawn()` checks `typeof adapter.runSdk === 'function'` to branch SDK vs CLI (line 179)
  - `doSpawnSdk()` wires `SdkHandle.onOutput` to buffer, `SdkHandle.done` to `handleExit` (lines 303-399)
  - Auto-detect priority: gemini > codex > first available (lines 813-829)

- **Shared utilities**: `libs/backend/llm-abstraction/src/lib/services/cli-adapters/cli-adapter.utils.ts`
  - `stripAnsiCodes()`, `buildTaskPrompt()` - reusable by all adapters

### Files That Reference CliType (Full Change Scope)

1. `libs/shared/src/lib/types/agent-process.types.ts` - CliType definition
2. `libs/backend/llm-abstraction/src/lib/services/cli-detection.service.ts` - Adapter registration
3. `libs/backend/llm-abstraction/src/lib/services/agent-process-manager.service.ts` - Auto-detect priority
4. `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-handlers/tool-description.builder.ts` - MCP tool enum
5. `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/system-namespace.builders.ts` - Docs
6. `libs/frontend/chat/src/lib/settings/settings.component.ts` - Settings UI dropdown
7. `libs/shared/src/lib/types/rpc.types.ts` - RPC config types (no code change needed, uses `CliType` import)

---

## Architecture Design

### Design Philosophy

Follow the **exact same pattern** as `codex-cli.adapter.ts`:

- Dynamic ESM import with cached module reference
- Local type interfaces mirroring SDK types
- Output buffering with flush-on-register
- Event-to-text mapping via `handleStreamEvent()`

The Copilot SDK (`@github/copilot-sdk`) uses a `CopilotClient` that spawns `copilot --headless --stdio` and communicates via JSON-RPC 2.0. It emits 41+ typed events. The adapter maps relevant events to text output for the agent monitor.

---

## Component Specifications

### Component 1: CopilotCliAdapter

**File**: `libs/backend/llm-abstraction/src/lib/services/cli-adapters/copilot-cli.adapter.ts` (CREATE)

**Purpose**: Adapter that integrates the `@github/copilot-sdk` CopilotClient as an SDK-based agent in Ptah's agent orchestration system.

**Pattern**: Follows `codex-cli.adapter.ts` exactly (verified: lines 26-343)

**Implementation**:

```typescript
/**
 * Copilot CLI Adapter
 * Uses @github/copilot-sdk CopilotClient for in-process execution.
 *
 * CLI fallback: copilot "task description" (headless mode)
 * SDK path: CopilotClient spawns copilot --headless --stdio, JSON-RPC 2.0
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { CliDetectionResult } from '@ptah-extension/shared';
import type { CliAdapter, CliCommand, CliCommandOptions, SdkHandle } from './cli-adapter.interface';
import { stripAnsiCodes, buildTaskPrompt } from './cli-adapter.utils';

const execFileAsync = promisify(execFile);

// ========================================
// Local SDK Type Mirrors (avoid ESM import at module level)
// ========================================

/**
 * Minimal type for the dynamically imported @github/copilot-sdk module.
 * Mirrors the actual SDK exports but avoids importing ESM at module level.
 */
interface CopilotSdkModule {
  CopilotClient: new (options?: CopilotClientOptions) => CopilotClientInstance;
}

interface CopilotClientOptions {
  /** Custom binary path for copilot CLI */
  binaryPath?: string;
  /** Environment variables to pass to the copilot process */
  env?: Record<string, string>;
}

interface CopilotClientInstance {
  /**
   * Create a new session.
   * Returns a session object with sendMessage and event iteration.
   */
  createSession(options?: CopilotSessionOptions): Promise<CopilotSession>;
  /**
   * Disconnect from the copilot process.
   */
  disconnect(): Promise<void>;
}

interface CopilotSessionOptions {
  /** Working directory for the session */
  workingDirectory?: string;
  /** Custom instructions / system prompt */
  instructions?: string;
}

interface CopilotSession {
  /** Session ID for potential resume */
  readonly id: string;
  /**
   * Send a message and receive an async iterable of events.
   */
  sendMessage(message: string, options?: { signal?: AbortSignal }): AsyncIterable<CopilotEvent>;
}

/**
 * Union of Copilot SDK events we handle.
 * The SDK emits 41+ event types; we handle the most relevant ones.
 * See: @github/copilot-sdk event documentation
 */
type CopilotEvent = { type: 'assistant.message_start' } | { type: 'assistant.message_delta'; delta: string } | { type: 'assistant.message_end' } | { type: 'thinking.start' } | { type: 'thinking.delta'; delta: string } | { type: 'thinking.end' } | { type: 'tool.execution_start'; tool: string; input?: Record<string, unknown> } | { type: 'tool.execution_end'; tool: string; output?: string } | { type: 'tool.error'; tool: string; error: string } | { type: 'session.idle' } | { type: 'session.error'; error: string } | { type: 'confirmation.request'; id: string; tool: string; message: string } | { type: string; [key: string]: unknown }; // Catch-all for unhandled events

// ========================================
// Cached SDK Import
// ========================================

/**
 * Cached successful import of the ESM-only Copilot SDK.
 * Only successful imports are cached; failures are not stored
 * so that a transient failure does not permanently break the SDK path.
 */
let copilotSdkModule: CopilotSdkModule | null = null;

/**
 * Lazily import the ESM-only @github/copilot-sdk package.
 * Only caches successful imports so a failed import can be retried.
 */
async function getCopilotSdk(): Promise<CopilotSdkModule> {
  if (copilotSdkModule) {
    return copilotSdkModule;
  }
  try {
    const mod = (await import('@github/copilot-sdk')) as CopilotSdkModule;
    copilotSdkModule = mod;
    return mod;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load @github/copilot-sdk: ${message}. ` + `Ensure the package is installed: npm install @github/copilot-sdk`);
  }
}

// ========================================
// Adapter Implementation
// ========================================

export class CopilotCliAdapter implements CliAdapter {
  readonly name = 'copilot' as const;
  readonly displayName = 'Copilot CLI';

  async detect(): Promise<CliDetectionResult> {
    try {
      // Check for the copilot CLI binary
      const whichCmd = process.platform === 'win32' ? 'where' : 'which';
      const { stdout: pathOutput } = await execFileAsync(whichCmd, ['copilot'], {
        timeout: 5000,
      });
      const binaryPath = pathOutput.trim().split('\n')[0];

      // Try to get version
      let version: string | undefined;
      try {
        const { stdout: versionOutput } = await execFileAsync('copilot', ['--version'], { timeout: 5000 });
        version = versionOutput.trim().split('\n')[0];
      } catch {
        // Version check failed, CLI still usable
      }

      // Verify the SDK npm package is importable (needed for runSdk path)
      let sdkAvailable = false;
      try {
        await getCopilotSdk();
        sdkAvailable = true;
      } catch {
        // SDK not available - CLI binary exists but npm package is missing
      }

      return {
        cli: 'copilot',
        installed: true,
        path: binaryPath,
        version: sdkAvailable ? version : version ? `${version} (SDK unavailable - install @github/copilot-sdk)` : 'SDK unavailable - install @github/copilot-sdk',
        supportsSteer: false,
      };
    } catch {
      return {
        cli: 'copilot',
        installed: false,
        supportsSteer: false,
      };
    }
  }

  buildCommand(options: CliCommandOptions): CliCommand {
    const taskPrompt = buildTaskPrompt(options);

    // copilot CLI headless mode: copilot "prompt"
    return {
      binary: 'copilot',
      args: [taskPrompt],
    };
  }

  supportsSteer(): boolean {
    return false;
  }

  parseOutput(raw: string): string {
    return stripAnsiCodes(raw);
  }

  /**
   * Run task via Copilot SDK instead of CLI subprocess.
   *
   * Uses @github/copilot-sdk CopilotClient to create a session
   * and stream events. The SDK spawns copilot --headless --stdio
   * and communicates via JSON-RPC 2.0.
   *
   * Abort is achieved by disconnecting the client and signaling
   * the AbortController.
   */
  async runSdk(options: CliCommandOptions): Promise<SdkHandle> {
    const sdk = await getCopilotSdk();
    const client = new sdk.CopilotClient();

    const session = await client.createSession({
      workingDirectory: options.workingDirectory,
    });

    const taskPrompt = buildTaskPrompt(options);
    const abortController = new AbortController();

    // Output buffering (same pattern as codex-cli.adapter.ts:219-241)
    const outputBuffer: string[] = [];
    const outputCallbacks: Array<(data: string) => void> = [];

    const onOutput = (callback: (data: string) => void): void => {
      outputCallbacks.push(callback);
      if (outputBuffer.length > 0) {
        for (const buffered of outputBuffer) {
          callback(buffered);
        }
        outputBuffer.length = 0;
      }
    };

    const emitOutput = (data: string): void => {
      if (outputCallbacks.length === 0) {
        outputBuffer.push(data);
      } else {
        for (const cb of outputCallbacks) {
          cb(data);
        }
      }
    };

    // Start event iteration
    const done = (async (): Promise<number> => {
      try {
        const events = session.sendMessage(taskPrompt, {
          signal: abortController.signal,
        });

        for await (const event of events) {
          if (abortController.signal.aborted) {
            return 1;
          }
          this.handleStreamEvent(event, emitOutput);
        }

        return 0;
      } catch (error: unknown) {
        // AbortError is expected when we cancel
        if (error instanceof Error && (error.name === 'AbortError' || abortController.signal.aborted)) {
          return 1;
        }

        const errorMessage = error instanceof Error ? error.message : String(error);
        emitOutput(`\n[Copilot SDK Error] ${errorMessage}\n`);
        return 1;
      } finally {
        // Disconnect the client to clean up the child process
        try {
          await client.disconnect();
        } catch {
          // Ignore disconnect errors during cleanup
        }
      }
    })();

    return { abort: abortController, done, onOutput };
  }

  /**
   * Process a single Copilot SDK event and emit relevant output text.
   *
   * Event mapping:
   * - assistant.message_delta -> streamed text output
   * - thinking.delta -> [Thinking] prefix
   * - tool.execution_start -> [Tool: name] prefix
   * - tool.execution_end -> tool output
   * - tool.error -> error message
   * - session.error -> error message
   * - confirmation.request -> auto-confirm (agent mode, no user interaction)
   */
  private handleStreamEvent(event: CopilotEvent, emitOutput: (data: string) => void): void {
    switch (event.type) {
      case 'assistant.message_delta':
        if (event.delta) {
          emitOutput(event.delta);
        }
        break;

      case 'assistant.message_end':
        // Ensure message ends with newline
        emitOutput('\n');
        break;

      case 'thinking.delta':
        if (event.delta) {
          emitOutput(`[Thinking] ${event.delta}\n`);
        }
        break;

      case 'tool.execution_start':
        emitOutput(`[Tool: ${event.tool}]\n`);
        break;

      case 'tool.execution_end':
        if (event.output) {
          emitOutput(event.output);
          if (!event.output.endsWith('\n')) {
            emitOutput('\n');
          }
        }
        break;

      case 'tool.error':
        emitOutput(`[Tool Error: ${event.tool}] ${event.error}\n`);
        break;

      case 'session.error':
        emitOutput(`[Session Error] ${event.error}\n`);
        break;

      case 'session.idle':
        // Session complete, no output needed
        break;

      case 'confirmation.request':
        // In agent mode, we auto-confirm tool executions.
        // The SDK handles confirmation responses internally.
        emitOutput(`[Confirm: ${event.tool}] ${event.message}\n`);
        break;

      default:
        // Unhandled events (assistant.message_start, thinking.start, thinking.end, etc.)
        break;
    }
  }
}
```

**Quality Requirements**:

- All imports verified from `cli-adapter.interface.ts` and `cli-adapter.utils.ts`
- Output buffering pattern matches Codex adapter (verified: codex-cli.adapter.ts:219-241)
- Event handling pattern matches Codex adapter (verified: codex-cli.adapter.ts:281-342)
- Dynamic ESM import pattern matches Codex adapter (verified: codex-cli.adapter.ts:100-121)

---

### Component 2: CliType Extension

**File**: `libs/shared/src/lib/types/agent-process.types.ts` (MODIFY)

**Change**: Add `'copilot'` to the `CliType` union (line 60)

```typescript
// BEFORE:
export type CliType = 'gemini' | 'codex' | 'vscode-lm';

// AFTER:
export type CliType = 'gemini' | 'codex' | 'copilot' | 'vscode-lm';
```

**Impact**: This is the single source of truth. All files importing `CliType` will automatically accept `'copilot'` values. No changes needed in:

- `rpc.types.ts` (uses `import('./agent-process.types').CliType`)
- `cli-adapter.interface.ts` (uses `CliType` from shared)
- `agent-process-manager.service.ts` (uses `CliType` from shared)

---

### Component 3: Adapter Registration

**File**: `libs/backend/llm-abstraction/src/lib/services/cli-detection.service.ts` (MODIFY)

**Changes**:

1. Add import for `CopilotCliAdapter` (after line 16)
2. Register the adapter in constructor (after line 44)

```typescript
// Add import (line 17):
import { CopilotCliAdapter } from './cli-adapters/copilot-cli.adapter';

// Add registration in constructor (after line 44):
const copilot = new CopilotCliAdapter();
this.adapters.set('copilot', copilot);

// Update log message (line 57-59):
this.logger.info('[CliDetection] Service initialized with adapters: gemini, codex, copilot, vscode-lm');
```

---

### Component 4: Auto-Detect Priority Update

**File**: `libs/backend/llm-abstraction/src/lib/services/agent-process-manager.service.ts` (MODIFY)

**Change**: Add copilot to the auto-detect priority chain (lines 822-829)

```typescript
// BEFORE (lines 822-829):
// Prefer gemini, then codex, then fall back to first available
const gemini = installed.find((c) => c.cli === 'gemini');
if (gemini) return 'gemini';

const codex = installed.find((c) => c.cli === 'codex');
if (codex) return 'codex';

return installed[0].cli;

// AFTER:
// Prefer gemini, then codex, then copilot, then fall back to first available
const gemini = installed.find((c) => c.cli === 'gemini');
if (gemini) return 'gemini';

const codex = installed.find((c) => c.cli === 'codex');
if (codex) return 'codex';

const copilot = installed.find((c) => c.cli === 'copilot');
if (copilot) return 'copilot';

return installed[0].cli;
```

---

### Component 5: MCP Tool Description Update

**File**: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-handlers/tool-description.builder.ts` (MODIFY)

**Change**: Add `'copilot'` to the enum and update description (lines 272-276)

```typescript
// BEFORE (line 272):
enum: ['gemini', 'codex', 'vscode-lm'],

// AFTER:
enum: ['gemini', 'codex', 'copilot', 'vscode-lm'],

// BEFORE (lines 273-276):
description:
  'Which agent to use. "gemini" and "codex" require their CLI installed. ' +
  '"vscode-lm" uses VS Code\'s built-in language model (no external CLI needed). ' +
  'Omit to use the default (auto-detected or user-configured).',

// AFTER:
description:
  'Which agent to use. "gemini", "codex", and "copilot" require their CLI installed. ' +
  '"vscode-lm" uses VS Code\'s built-in language model (no external CLI needed). ' +
  'Omit to use the default (auto-detected or user-configured).',
```

Also update the model description (line 302-303):

```typescript
// BEFORE:
'Matched against model id, family, or name. Ignored for CLI agents (gemini, codex).',

// AFTER:
'Matched against model id, family, or name. Ignored for CLI agents (gemini, codex, copilot).',
```

---

### Component 6: System Namespace Docs Update

**File**: `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/system-namespace.builders.ts` (MODIFY)

**Change**: Update documentation string (line 189)

```typescript
// BEFORE (line 189):
request: { task: string, cli?: 'gemini'|'codex', workingDirectory?: string, ...

// AFTER:
request: { task: string, cli?: 'gemini'|'codex'|'copilot', workingDirectory?: string, ...
```

---

### Component 7: Package Dependency

**File**: `package.json` (MODIFY)

**Change**: Add `@github/copilot-sdk` to dependencies

```json
"@github/copilot-sdk": "^0.1.0"
```

**Note**: The exact version should be confirmed from npm at implementation time. The package is in technical preview. Also ensure `@github/copilot` CLI is documented as a prerequisite (installed globally: `npm install -g @github/copilot`).

---

### Component 8: TypeScript Declaration (if needed)

**File**: `libs/backend/llm-abstraction/src/lib/services/cli-adapters/copilot-sdk.d.ts` (CREATE - only if needed)

If the `@github/copilot-sdk` package does not ship its own type declarations, create a minimal ambient declaration:

```typescript
declare module '@github/copilot-sdk' {
  export class CopilotClient {
    constructor(options?: { binaryPath?: string; env?: Record<string, string> });
    createSession(options?: { workingDirectory?: string; instructions?: string }): Promise<CopilotSession>;
    disconnect(): Promise<void>;
  }

  export interface CopilotSession {
    readonly id: string;
    sendMessage(message: string, options?: { signal?: AbortSignal }): AsyncIterable<CopilotEvent>;
  }

  export type CopilotEvent = {
    type: string;
    [key: string]: unknown;
  };
}
```

**Note**: This file is only needed if the SDK lacks types. The Codex adapter does NOT have a `.d.ts` file because `@openai/codex-sdk` ships its own types. Check `@github/copilot-sdk` at implementation time.

---

## Files Affected Summary

### CREATE

| File                                                                                | Purpose                                 |
| ----------------------------------------------------------------------------------- | --------------------------------------- |
| `libs/backend/llm-abstraction/src/lib/services/cli-adapters/copilot-cli.adapter.ts` | Copilot CLI adapter (SDK-based)         |
| `libs/backend/llm-abstraction/src/lib/services/cli-adapters/copilot-sdk.d.ts`       | Ambient types (only if SDK lacks types) |

### MODIFY

| File                                                                                                  | Change                                |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `libs/shared/src/lib/types/agent-process.types.ts`                                                    | Add `'copilot'` to `CliType` union    |
| `libs/backend/llm-abstraction/src/lib/services/cli-detection.service.ts`                              | Import + register `CopilotCliAdapter` |
| `libs/backend/llm-abstraction/src/lib/services/agent-process-manager.service.ts`                      | Add copilot to auto-detect priority   |
| `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-handlers/tool-description.builder.ts`        | Add copilot to enum + descriptions    |
| `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/system-namespace.builders.ts` | Update docs string                    |
| `package.json`                                                                                        | Add `@github/copilot-sdk` dependency  |

### NO CHANGE NEEDED

| File                                                                         | Reason                                                                                     |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `libs/shared/src/lib/types/rpc.types.ts`                                     | Uses `CliType` import, auto-inherits                                                       |
| `libs/frontend/chat/src/lib/settings/settings.component.ts`                  | Dropdown is driven by `detectedClis` from detection service; new CLI appears automatically |
| `apps/ptah-extension-vscode/src/services/rpc/handlers/agent-rpc.handlers.ts` | Uses `CliType` from shared, auto-inherits                                                  |

---

## Integration Architecture

### Data Flow

```
User selects "copilot" in settings or MCP tool specifies cli: "copilot"
  -> AgentProcessManager.spawn({ cli: 'copilot', task: '...' })
    -> CliDetectionService.getAdapter('copilot') -> CopilotCliAdapter
    -> adapter.runSdk() exists -> doSpawnSdk()
      -> CopilotClient.createSession()
      -> session.sendMessage(taskPrompt)
      -> events streamed -> handleStreamEvent() -> emitOutput()
        -> AgentProcessManager.appendBuffer() -> agent:output events
          -> Webview receives output deltas in real-time
```

### Event Mapping (Copilot SDK -> Agent Monitor Output)

| Copilot Event             | Output Text                      |
| ------------------------- | -------------------------------- |
| `assistant.message_delta` | Raw delta text (streamed)        |
| `assistant.message_end`   | `\n` (newline)                   |
| `thinking.delta`          | `[Thinking] {delta}\n`           |
| `tool.execution_start`    | `[Tool: {name}]\n`               |
| `tool.execution_end`      | `{output}\n`                     |
| `tool.error`              | `[Tool Error: {name}] {error}\n` |
| `session.error`           | `[Session Error] {error}\n`      |
| `confirmation.request`    | `[Confirm: {tool}] {message}\n`  |
| `session.idle`            | (no output, signals completion)  |

### Confirmation Handling

The Copilot SDK emits `confirmation.request` events when a tool needs user approval. In Ptah's agent orchestration mode, agents run autonomously. The adapter logs the confirmation but does not block execution. If the SDK requires an explicit confirmation response, this will need to be handled via `session.confirm(id)` (verify SDK API at implementation time).

---

## Quality Requirements

### Functional Requirements

1. `detect()` correctly identifies `copilot` CLI binary on Windows (`where`) and Unix (`which`)
2. `detect()` reports SDK availability separately from binary detection
3. `runSdk()` creates a CopilotClient session and streams events to output
4. `runSdk()` supports abort via AbortController
5. `runSdk()` disconnects client on completion or error (cleanup)
6. All 8 handled event types produce correct output text
7. Copilot appears in auto-detect priority after codex, before fallback
8. Copilot appears in MCP tool `cli` enum and descriptions

### Non-Functional Requirements

1. **No module-level ESM import**: Dynamic import only, cached after first success
2. **Graceful degradation**: If SDK not installed, detection returns version warning string
3. **Memory safety**: Output buffering with flush-on-register pattern prevents unbounded growth
4. **Process cleanup**: Client disconnected in `finally` block

### Pattern Compliance

1. Follows `CliAdapter` interface exactly (verified: cli-adapter.interface.ts:39-72)
2. Dynamic ESM import pattern matches Codex (verified: codex-cli.adapter.ts:100-121)
3. Output buffering pattern matches Codex (verified: codex-cli.adapter.ts:219-241)
4. Event handler pattern matches Codex (verified: codex-cli.adapter.ts:281-342)
5. Detection pattern matches both Gemini and Codex adapters

---

## Critical Implementation Notes

### 1. SDK API Verification Required

The `@github/copilot-sdk` is in technical preview. The exact API surface (class names, method signatures, event types) MUST be verified against the actual package at implementation time. The local type interfaces in this plan are based on the SDK research provided but may need adjustment.

**Verification steps**:

1. `npm install @github/copilot-sdk`
2. Inspect `node_modules/@github/copilot-sdk/dist/index.d.ts`
3. Adjust `CopilotSdkModule`, `CopilotClientInstance`, `CopilotSession`, and `CopilotEvent` types to match actual exports

### 2. Authentication

The Copilot SDK requires a GitHub account with an active Copilot subscription (Individual, Business, or Enterprise). Authentication is handled by the `copilot` CLI binary (GitHub OAuth flow). No API key management is needed in Ptah's `LlmSecretsService`.

### 3. Confirmation.request Handling

The SDK may require explicit confirmation responses for tool executions. If `session.confirm(id: string)` or similar API exists, the adapter should auto-confirm in agent mode. Verify at implementation time.

### 4. MCP Server Registration (Future Enhancement)

The Copilot SDK supports registering custom MCP servers and tools. A future enhancement could register Ptah's MCP tools (workspace, search, symbols, etc.) with the Copilot session so it can use Ptah APIs directly. This is NOT in scope for the initial adapter but the session creation point is the natural extension point:

```typescript
// Future: Register Ptah MCP tools with Copilot session
const session = await client.createSession({
  workingDirectory: options.workingDirectory,
  mcpServers: [{ name: 'ptah', command: 'node', args: ['ptah-mcp-server'] }],
  tools: [{ name: 'ptah_execute_code', schema: {...} }],
});
```

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: backend-developer

**Rationale**:

- Pure TypeScript/Node.js work (no Angular components)
- Follows established adapter pattern with verified examples
- SDK integration with event streaming
- No UI changes needed (frontend auto-discovers new CLI from detection service)

### Complexity Assessment

**Complexity**: LOW-MEDIUM
**Estimated Effort**: 2-4 hours

**Breakdown**:

- Adapter file creation (following Codex template): 1-2 hours
- Type + registration changes (5 files, small changes): 30 minutes
- SDK API verification + adjustment: 30-60 minutes
- Testing (detection, SDK mock, event mapping): 30-60 minutes

### Critical Verification Points

1. **All imports exist in codebase**:

   - `CliAdapter`, `CliCommand`, `CliCommandOptions`, `SdkHandle` from `./cli-adapter.interface` (verified: cli-adapter.interface.ts:11-72)
   - `stripAnsiCodes`, `buildTaskPrompt` from `./cli-adapter.utils` (verified: cli-adapter.utils.ts:11-35)
   - `CliDetectionResult` from `@ptah-extension/shared` (verified: agent-process.types.ts:128-134)

2. **All patterns verified from examples**:

   - Dynamic ESM import: codex-cli.adapter.ts:100-121
   - Output buffering: codex-cli.adapter.ts:219-241
   - Event streaming: codex-cli.adapter.ts:244-276
   - Event dispatch: codex-cli.adapter.ts:281-342
   - Detection with binary + SDK check: codex-cli.adapter.ts:127-176

3. **SDK package verification required**:

   - `@github/copilot-sdk` API must be verified post-install
   - Local type interfaces may need adjustment
   - Event type names must be confirmed from actual SDK

4. **No hallucinated APIs**:
   - All Ptah APIs verified from codebase
   - Copilot SDK types are explicitly marked as "mirrors" requiring verification
