# Implementation Plan - TASK_2025_158: Codex SDK for Agent Orchestration

## Scope Correction

**This plan REPLACES the previous IAIProvider-based plan entirely.**

This task is narrowly scoped: replace the `child_process.spawn('codex', ['--quiet', task])` call in the agent orchestration system with the Codex SDK (`@openai/codex-sdk`). There is NO IAIProvider, NO provider switching UI, NO chat integration, and NO new top-level provider.

The Codex adapter stays within `libs/backend/llm-abstraction/` alongside the existing `GeminiCliAdapter`. The `AgentProcessManager` is the only consumer.

---

## Codebase Investigation Summary

### Current Architecture

**CliAdapter interface** (`cli-adapter.interface.ts:24-50`):

- `detect()` -> `CliDetectionResult` (is CLI installed?)
- `buildCommand(options)` -> `CliCommand` (binary + args)
- `supportsSteer()` -> boolean
- `parseOutput(raw)` -> string

**AgentProcessManager** (`agent-process-manager.service.ts:67-575`):

- Gets adapter via `this.cliDetection.getAdapter(cli)` (line 127)
- Calls `adapter.buildCommand(options)` (line 140)
- Spawns via `spawn(binaryPath, command.args, ...)` (line 173)
- Tracks via `TrackedAgent` (line 51-64): has `process: ChildProcess`, stdout/stderr buffers, timeout, exit handling
- Output read via `readOutput()` which calls `adapter.parseOutput()` (line 262)
- Steering via `steer()` which writes to `process.stdin` (line 309)
- Kill via `killProcess()` which does SIGTERM/taskkill (line 454)

**TrackedAgent interface** (line 51-64):

```typescript
interface TrackedAgent {
  info: AgentProcessInfo;
  process: ChildProcess; // <-- tightly coupled to child_process
  stdoutBuffer: string;
  stderrBuffer: string;
  timeoutHandle: NodeJS.Timeout;
  stdoutLineCount: number;
  stderrLineCount: number;
  truncated: boolean;
  hasExited: boolean;
  cleanupHandle?: NodeJS.Timeout;
}
```

**CliDetectionService** (`cli-detection.service.ts:16-104`):

- Maintains `Map<CliType, CliAdapter>` (line 17)
- Registers adapters in constructor (lines 22-25)
- Exposes `getAdapter(cli)` (line 94)

**CliType** (`agent-process.types.ts:60`): `'gemini' | 'codex'`

### Key Problem

The Codex SDK is a Node.js API (`thread.run(task)`), not a CLI binary. It doesn't produce a `CliCommand` (binary + args). The `AgentProcessManager.doSpawn()` method (line 97-225) is hardwired to:

1. Get a `CliCommand` from the adapter
2. Resolve binary path from detection
3. `spawn(binaryPath, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] })`
4. Wire stdout/stderr/exit handlers to a `ChildProcess`

The SDK produces an async generator of events, not stdout/stderr streams.

---

## Architecture Decision

### Chosen: Option A -- Keep CliAdapter, Add SDK Execution Path in AgentProcessManager

**Rationale**:

- Minimal API surface change -- `CliAdapter` stays as-is, `GeminiCliAdapter` untouched
- The `AgentProcessManager` already owns all process lifecycle logic (spawn, track, output, kill, timeout). Adding SDK lifecycle here keeps everything in one place
- `TrackedAgent` is a private internal interface -- we can extend it without breaking any public API
- The SDK adapter signals "I'm SDK-based" via a new optional method, and the process manager branches on it
- Only 3 files need meaningful changes; 1 new file created

**Rejected alternatives**:

- **Option B** (new SdkAdapter interface): Over-engineered for one adapter. Creates two parallel hierarchies that the process manager must juggle.
- **Option C** (generic AgentAdapter refactor): High risk -- refactors a working system to accommodate one new adapter. Violates the scope constraint of "much smaller."

### Design

```
CliAdapter interface (UNCHANGED)
  |
  +-- GeminiCliAdapter (UNCHANGED)
  |
  +-- CodexCliAdapter (MODIFIED: keep detect(), make buildCommand() unused by SDK path)

CliAdapter (EXTENDED with optional method)
  + runSdk?(options): Promise<SdkHandle>   // NEW optional method

AgentProcessManager.doSpawn():
  if adapter has runSdk -> use SDK execution path
  else -> use existing child_process.spawn path (unchanged)

TrackedAgent (EXTENDED):
  + sdkAbortController?: AbortController   // for SDK cancellation
  + sdkCleanup?: () => void                // for SDK thread cleanup
```

The SDK execution path in `AgentProcessManager`:

1. Calls `adapter.runSdk(options)` which returns an `SdkHandle` (abort controller + output promise)
2. Creates a `TrackedAgent` with `process` set to a dummy/null ChildProcess (or we make process optional)
3. The SDK streams output into the same `stdoutBuffer` via a callback
4. When the SDK finishes, it triggers the same `handleExit()` flow
5. Timeout, stop, and cleanup all work the same way

---

## Implementation Batches

### Batch 1: Extend CliAdapter Interface and Rewrite CodexCliAdapter

**Estimated Effort**: 3-4 hours
**Dependency**: None

#### Task 1.1: Install `@openai/codex-sdk`

**Action**: `npm install @openai/codex-sdk`

**Acceptance Criteria**:

- Package installs successfully
- Verify SDK exports: `Codex` class, thread API
- If ESM-only, verify dynamic `import()` works from the CJS extension bundle

#### Task 1.2: Extend CliAdapter Interface with Optional SDK Method

**File**: `libs/backend/llm-abstraction/src/lib/services/cli-adapters/cli-adapter.interface.ts` (MODIFY)

**What to add**:

```typescript
/**
 * Handle returned by SDK-based adapters.
 * AgentProcessManager uses this instead of ChildProcess when present.
 */
export interface SdkHandle {
  /** Abort controller to cancel the SDK operation */
  readonly abort: AbortController;
  /** Promise that resolves when SDK execution completes. Resolves with exit code (0=success, 1=error). */
  readonly done: Promise<number>;
  /** Called by the SDK adapter to push output lines (replaces stdout capture). */
  readonly onOutput: (callback: (data: string) => void) => void;
}

export interface CliAdapter {
  // ... existing methods unchanged ...

  /**
   * Optional: Run task via SDK instead of CLI subprocess.
   * If implemented, AgentProcessManager will use this instead of buildCommand() + spawn().
   * Adapters that return a value here are "SDK-based" adapters.
   */
  runSdk?(options: CliCommandOptions): Promise<SdkHandle>;
}
```

**Evidence**: The `CliAdapter` interface at `cli-adapter.interface.ts:24-50` currently has 4 required methods. Adding an optional 5th method is backward-compatible -- `GeminiCliAdapter` simply doesn't implement it.

**Acceptance Criteria**:

- `SdkHandle` interface exported
- `runSdk` is optional on `CliAdapter` (no `!` required)
- `GeminiCliAdapter` still compiles without changes
- `nx run llm-abstraction:typecheck` passes

#### Task 1.3: Rewrite CodexCliAdapter to Use Codex SDK

**File**: `libs/backend/llm-abstraction/src/lib/services/cli-adapters/codex-cli.adapter.ts` (REWRITE)

**What to implement**:

- Keep `detect()` -- still checks if Codex CLI is installed (which means SDK auth is likely configured too, since they share `OPENAI_API_KEY`)
- Keep `buildCommand()` -- return a dummy command (or keep current implementation as fallback)
- Keep `supportsSteer()` returning `false` (SDK doesn't support mid-run steering in this integration)
- Keep `parseOutput()` -- still strips ANSI codes from SDK output
- **NEW**: Implement `runSdk(options)`:
  1. Dynamically `import('@openai/codex-sdk')` (cache the import)
  2. Create a `Codex` client instance
  3. Start a thread: `codex.startThread({ workingDirectory: options.workingDirectory })`
  4. Build task prompt via `buildTaskPrompt(options)` (reuse existing util)
  5. Run: `thread.runStreamed(taskPrompt)`
  6. Wire the async generator to push output via `onOutput` callback
  7. Return `SdkHandle` with abort controller and done promise

**Key implementation detail**: The `runStreamed()` async generator yields events. For each `item.completed` event with text content, push it to `onOutput`. When the generator ends, resolve the `done` promise with exit code 0 (or 1 on error).

**Evidence**:

- Current adapter: `codex-cli.adapter.ts:20-82`
- `buildTaskPrompt` utility: `cli-adapter.utils.ts:20-35`
- Codex SDK API (from context.md): `Codex({ env, config })`, `codex.startThread()`, `thread.runStreamed(input)`, events: `item.completed`, `turn.completed`

**Acceptance Criteria**:

- `detect()` still works (checks CLI installation, returns version)
- `runSdk()` creates a Codex client, starts a thread, runs streamed
- Output from SDK events is pushed via `onOutput` callback
- `SdkHandle.abort` cancels the running thread
- `SdkHandle.done` resolves with 0 on success, 1 on error
- Dynamic import handles ESM correctly
- No `any` types -- use typed Codex SDK imports or minimal local type definitions

#### Task 1.4: Update CLI Adapter Barrel Exports

**File**: `libs/backend/llm-abstraction/src/lib/services/cli-adapters/index.ts` (MODIFY)

**What to add**: Export `SdkHandle` type from `cli-adapter.interface.ts`

**Acceptance Criteria**:

- `SdkHandle` importable from `@ptah-extension/llm-abstraction`

---

### Batch 2: Update AgentProcessManager for SDK Execution Path

**Estimated Effort**: 3-4 hours
**Dependency**: Batch 1

#### Task 2.1: Extend TrackedAgent and doSpawn() for SDK Path

**File**: `libs/backend/llm-abstraction/src/lib/services/agent-process-manager.service.ts` (MODIFY)

**What to change**:

1. **Extend `TrackedAgent` interface** (line 51-64):

```typescript
interface TrackedAgent {
  info: AgentProcessInfo;
  process: ChildProcess | null; // null for SDK-based agents
  sdkAbortController?: AbortController; // SDK cancellation
  stdoutBuffer: string;
  stderrBuffer: string;
  timeoutHandle: NodeJS.Timeout;
  stdoutLineCount: number;
  stderrLineCount: number;
  truncated: boolean;
  hasExited: boolean;
  cleanupHandle?: NodeJS.Timeout;
}
```

2. **Branch in `doSpawn()`** (after line 140, where `adapter.buildCommand()` is called):

```typescript
// SDK-based adapter path
if (adapter.runSdk) {
  return this.doSpawnSdk(adapter, request, cli, workingDirectory, sanitizedTask);
}

// Existing CLI spawn path (unchanged)
const command = adapter.buildCommand({ ... });
// ... rest of existing code
```

3. **New private method `doSpawnSdk()`**:

- Call `adapter.runSdk({ task, workingDirectory, files, taskFolder })`
- Get back `SdkHandle`
- Create `TrackedAgent` with `process: null`, `sdkAbortController: sdkHandle.abort`
- Wire `sdkHandle.onOutput(data => this.appendBuffer(agentId, 'stdout', data))`
- Set up timeout (same as CLI path)
- Wire `sdkHandle.done.then(code => this.handleExit(agentId, code, null)).catch(err => this.handleExit(agentId, 1, null))`
- Return `SpawnAgentResult`

4. **Update `steer()`** (line 285-310): Add guard for SDK agents (no stdin, throw same "not supported" error)

5. **Update `killProcess()`** (line 454-500): If `tracked.process` is null (SDK agent), call `tracked.sdkAbortController?.abort()` instead of process killing

6. **Update `readOutput()`** (line 250-279): Works as-is since it reads from `stdoutBuffer` which SDK path also populates

**Evidence**:

- `doSpawn()` at line 97-225 -- this is the main spawn method we're branching
- `handleExit()` at line 399-431 -- reusable for SDK completion
- `appendBuffer()` at line 362-387 -- reusable for SDK output
- `killProcess()` at line 454-500 -- needs SDK branch

**Acceptance Criteria**:

- SDK-based adapters (Codex) use `runSdk()` path, CLI adapters (Gemini) use existing `spawn()` path
- SDK output appears in `readOutput()` same as CLI output
- `stop()` works for SDK agents via `AbortController`
- Timeout works for SDK agents
- `shutdownAll()` cleans up SDK agents
- `steer()` gives clear error for SDK agents
- No regression for Gemini CLI adapter

#### Task 2.2: Update Detection for SDK-Based Adapters

**File**: `libs/backend/llm-abstraction/src/lib/services/cli-detection.service.ts` (MODIFY)

**What to change**:

- In `detect()` for Codex: even if CLI binary isn't found, check if SDK can initialize (e.g., `OPENAI_API_KEY` in environment). This makes Codex available via SDK even without the CLI binary installed.
- Add `sdkAvailable` field to detection result (or reuse `installed` with a note)

**Wait -- scope check**: Actually, the simplest approach is to keep detection as-is. If the Codex CLI is installed, the adapter is available. The SDK is used as the execution mechanism instead of `spawn`. The user already has `codex` CLI installed for auth. No detection changes needed.

**Decision**: No changes to `cli-detection.service.ts`. The existing `detect()` in `CodexCliAdapter` already checks CLI installation. SDK usage is an implementation detail of execution, not detection.

**Acceptance Criteria**:

- Detection unchanged
- Codex adapter still requires CLI to be installed (for auth/config)

---

### Batch 3: Testing and Quality Gates

**Estimated Effort**: 2-3 hours
**Dependency**: Batch 2

#### Task 3.1: Unit Tests for CodexCliAdapter.runSdk()

**File**: `libs/backend/llm-abstraction/src/lib/services/cli-adapters/codex-cli.adapter.spec.ts` (CREATE)

**What to test**:

- `runSdk()` creates a Codex client and thread
- Output events from SDK are pushed to `onOutput` callback
- `SdkHandle.done` resolves with 0 on successful completion
- `SdkHandle.done` resolves with 1 on error
- `SdkHandle.abort` cancels the thread
- `detect()` still works (existing behavior)
- Dynamic import is cached (only one `import()` call)

**Mocking strategy**: Mock `import('@openai/codex-sdk')` to return a fake Codex class with fake thread that yields test events.

**Acceptance Criteria**:

- All success and error paths tested
- Abort/cancellation tested
- No `any` in test types

#### Task 3.2: Unit Tests for AgentProcessManager SDK Path

**File**: `libs/backend/llm-abstraction/src/lib/services/agent-process-manager.service.spec.ts` (CREATE or MODIFY if exists)

**What to test**:

- `spawn()` with an SDK adapter calls `runSdk()` instead of `child_process.spawn`
- Output from SDK appears in `readOutput()`
- `stop()` on SDK agent calls `AbortController.abort()`
- Timeout triggers `handleExit()` for SDK agents
- `steer()` on SDK agent throws appropriate error
- `shutdownAll()` handles mix of CLI and SDK agents
- Concurrent limit includes SDK agents

**Acceptance Criteria**:

- SDK spawn path tested end-to-end
- Mix of CLI + SDK agents tested
- Timeout and stop behaviors tested

#### Task 3.3: Quality Gates

**Verification commands**:

```bash
nx run llm-abstraction:typecheck
nx lint llm-abstraction
nx test llm-abstraction
nx run shared:typecheck
npm run typecheck:all
npm run lint:all
```

**Acceptance Criteria**:

- Zero TypeScript errors
- Zero lint errors
- All tests pass
- No regressions in existing tests

---

### Batch 4: VS Code LM as Spawnable Agent via ptah_agent_spawn

**Estimated Effort**: 3-4 hours
**Dependency**: Batch 2 (uses SdkHandle pattern from Batch 1)

#### Rationale

Currently VS Code LM is only accessible inline via `execute_code` + `ptah.ai.chat()`. To enable Claude to orchestrate 3 parallel agents uniformly (all via `ptah_agent_spawn`), we add `'vscode-lm'` as a third agent type. This uses the same `SdkHandle` pattern from Batch 1 — no child process, just an in-process VS Code LM API call wrapped in the adapter interface.

#### Task 4.1: Extend CliType to Include 'vscode-lm'

**File**: `libs/shared/src/lib/types/agent-process.types.ts` (MODIFY)

**What to change**:

- `CliType = 'gemini' | 'codex'` → `CliType = 'gemini' | 'codex' | 'vscode-lm'`

**Acceptance Criteria**:

- `CliType` includes `'vscode-lm'`
- `nx run shared:typecheck` passes

#### Task 4.2: Create VsCodeLmAdapter

**File**: `libs/backend/llm-abstraction/src/lib/services/cli-adapters/vscode-lm.adapter.ts` (CREATE)

**What to implement**:

- `VsCodeLmAdapter` implements `CliAdapter`
- `detect()`: Check if VS Code LM models are available via `vscode.lm.selectChatModels()`. Return `{ cli: 'vscode-lm', installed: true/false, version: model.name }`
- `buildCommand()`: Not used (SDK-based adapter), return dummy
- `supportsSteer()`: Return `false`
- `parseOutput()`: Return raw (no ANSI codes from VS Code LM)
- `runSdk(options)`: **NEW** — use the `SdkHandle` pattern:
  1. Get VS Code LM model via `vscode.lm.selectChatModels()`
  2. Build prompt from `buildTaskPrompt(options)`
  3. Send request via `model.sendRequest(messages, {}, cancellationToken)`
  4. Stream response chunks → push to `onOutput` callback
  5. Return `SdkHandle` with abort via CancellationTokenSource and done promise

**Key difference from CLI adapters**: This runs in-process using the VS Code API, not a child process or external SDK. But the `SdkHandle` interface makes it transparent to `AgentProcessManager`.

**Acceptance Criteria**:

- Detects available VS Code LM models
- Runs task via VS Code LM API and streams output
- Abort cancels the VS Code LM request
- Output appears in `readOutput()` same as CLI agents
- Works even when Gemini/Codex CLIs aren't installed

#### Task 4.3: Register VsCodeLmAdapter in CliDetectionService

**File**: `libs/backend/llm-abstraction/src/lib/services/cli-detection.service.ts` (MODIFY)

**What to change**:

- Add `const vscodeLm = new VsCodeLmAdapter()` in constructor
- Register: `this.adapters.set('vscode-lm', vscodeLm)`

**Acceptance Criteria**:

- `getAdapter('vscode-lm')` returns VsCodeLmAdapter
- `detectAll()` includes vscode-lm detection result
- Auto-detect preference order unchanged for CLI agents (gemini > codex), but vscode-lm available when explicitly requested

#### Task 4.4: Update ptah_agent_spawn Tool Description

**File**: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-handlers/tool-description.builder.ts` (MODIFY)

**What to change**:

- Update `cli` enum in ptah_agent_spawn tool to include `'vscode-lm'`: `enum: ['gemini', 'codex', 'vscode-lm']`
- Update description to mention VS Code LM as an option

**Acceptance Criteria**:

- `ptah_agent_spawn` accepts `cli: 'vscode-lm'`
- Tool description mentions all 3 agent types

#### Task 4.5: Unit Tests for VsCodeLmAdapter

**File**: `libs/backend/llm-abstraction/src/lib/services/cli-adapters/vscode-lm.adapter.spec.ts` (CREATE)

**What to test**:

- `detect()` returns installed when VS Code LM models available
- `runSdk()` sends request to VS Code LM and streams output
- Abort cancels the request
- Output pushed via onOutput callback

**Acceptance Criteria**:

- Mock vscode.lm API for tests
- All paths tested

---

## Files Affected Summary

### CREATE (4 files)

| File                                                                                   | Purpose                           |
| -------------------------------------------------------------------------------------- | --------------------------------- |
| `libs/backend/llm-abstraction/src/lib/services/cli-adapters/codex-cli.adapter.spec.ts` | Unit tests for Codex SDK adapter  |
| `libs/backend/llm-abstraction/src/lib/services/agent-process-manager.service.spec.ts`  | Unit tests for SDK spawn path     |
| `libs/backend/llm-abstraction/src/lib/services/cli-adapters/vscode-lm.adapter.ts`      | VS Code LM agent adapter          |
| `libs/backend/llm-abstraction/src/lib/services/cli-adapters/vscode-lm.adapter.spec.ts` | Unit tests for VS Code LM adapter |

### MODIFY (6 files)

| File                                                                                           | Change                                                                      |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `libs/backend/llm-abstraction/src/lib/services/cli-adapters/cli-adapter.interface.ts`          | Add `SdkHandle` interface and optional `runSdk` method                      |
| `libs/backend/llm-abstraction/src/lib/services/cli-adapters/codex-cli.adapter.ts`              | Add `runSdk()` implementation using Codex SDK                               |
| `libs/backend/llm-abstraction/src/lib/services/agent-process-manager.service.ts`               | Add SDK execution path in `doSpawn()`, update `killProcess()` and `steer()` |
| `libs/backend/llm-abstraction/src/lib/services/cli-adapters/index.ts`                          | Export `SdkHandle` type and VsCodeLmAdapter                                 |
| `libs/shared/src/lib/types/agent-process.types.ts`                                             | Add `'vscode-lm'` to CliType union                                          |
| `libs/backend/llm-abstraction/src/lib/services/cli-detection.service.ts`                       | Register VsCodeLmAdapter                                                    |
| `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-handlers/tool-description.builder.ts` | Add 'vscode-lm' to ptah_agent_spawn cli enum                                |

### UNCHANGED

| File                                                                               | Reason                                             |
| ---------------------------------------------------------------------------------- | -------------------------------------------------- |
| `libs/backend/llm-abstraction/src/lib/services/cli-adapters/gemini-cli.adapter.ts` | No changes -- doesn't implement `runSdk`           |
| All frontend files                                                                 | No changes -- this is purely backend/orchestration |

### INSTALL (1 package)

| Package             | Purpose                                      |
| ------------------- | -------------------------------------------- |
| `@openai/codex-sdk` | Codex SDK for Node.js thread-based execution |

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: backend-developer

**Rationale**:

- All work is in backend library (`llm-abstraction`)
- Node.js SDK integration, async generators, AbortController
- No Angular/frontend/UI work
- No new DI tokens, no new services, no provider switching

### Complexity Assessment

**Complexity**: MEDIUM
**Estimated Total Effort**: 11-15 hours across 4 batches

**Breakdown**:

- Batch 1 (Interface + Codex Adapter): 3-4 hours
- Batch 2 (Process Manager SDK path): 3-4 hours
- Batch 3 (Tests + QA for Batches 1-2): 2-3 hours
- Batch 4 (VS Code LM as spawnable agent): 3-4 hours

### Critical Verification Points

**Before Implementation, Developer Must Verify**:

1. **Codex SDK installs and works**:

   - `npm install @openai/codex-sdk` succeeds
   - Check if ESM-only (may need `await import()` pattern)
   - Verify actual API: `Codex` class, `startThread()`, `thread.runStreamed()`

2. **SDK event types match context.md**:

   - Verify `item.completed` events have text content
   - Verify `turn.completed` events signal completion
   - Check what abort/cancellation mechanism the SDK supports

3. **Auth works without extra config**:

   - Verify SDK picks up `OPENAI_API_KEY` from environment
   - Or verify it reads from `~/.codex/` config directory

4. **All existing patterns verified**:
   - `CliAdapter` interface: `cli-adapter.interface.ts:24-50`
   - `TrackedAgent`: `agent-process-manager.service.ts:51-64`
   - `doSpawn()`: `agent-process-manager.service.ts:97-225`
   - `killProcess()`: `agent-process-manager.service.ts:454-500`
   - `appendBuffer()`: `agent-process-manager.service.ts:362-387`
   - `handleExit()`: `agent-process-manager.service.ts:399-431`

### Architecture Delivery Checklist

- [x] Scope correctly constrained (NO IAIProvider, NO chat, NO UI)
- [x] Architecture decision justified with codebase evidence
- [x] Minimal file changes (3 modify, 2 create for tests)
- [x] Backward compatible (GeminiCliAdapter unchanged)
- [x] No new DI tokens or services needed
- [x] No shared type changes needed (CliType already has 'codex')
- [x] All patterns verified from codebase with line citations
- [x] No hallucinated APIs
- [x] Developer type recommended (backend)
- [x] Complexity assessed (LOW-MEDIUM, 8-11 hours)
