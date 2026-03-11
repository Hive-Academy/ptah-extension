# Code Logic Review - TASK_2025_158

## Review Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall Score       | 6/10           |
| Assessment          | NEEDS_REVISION |
| Critical Issues     | 2              |
| Serious Issues      | 4              |
| Moderate Issues     | 3              |
| Failure Modes Found | 8              |

## The 5 Paranoid Questions

### 1. How does this fail silently?

**Codex SDK import failure is cached permanently.** The module-level `codexSdkImport` variable caches the import promise. If `import('@openai/codex-sdk')` fails (package not installed, ESM resolution error), that rejected promise is cached forever. Every subsequent call to `getCodexSdk()` returns the same rejected promise. The adapter's `detect()` method checks for the `codex` CLI binary, not SDK availability, so detection succeeds but `runSdk()` always fails.

**VS Code LM `onOutput` registration race.** The `done` promise IIFE starts executing immediately (line 127 of `vscode-lm.adapter.ts`), but `onOutput` callbacks are registered by `AgentProcessManager.doSpawnSdk()` only after `runSdk()` resolves. If `model.sendRequest()` resolves instantly and starts emitting chunks before `doSpawnSdk` calls `sdkHandle.onOutput()`, those chunks are lost. Same issue exists in `codex-cli.adapter.ts`.

**Sanitization strips legitimate characters from SDK tasks.** `sanitizeTask()` removes `$`, `()`, `{}`, etc. This was designed for shell injection prevention on `child_process.spawn()`. But SDK-based adapters never touch a shell -- they pass the task string directly to an API. Characters like `$`, `()`, `{}` are legitimate in task descriptions (e.g., "implement the `getData()` function" becomes "implement the `getData` function"). The sanitization silently corrupts the prompt.

### 2. What user action causes unexpected behavior?

**Spawning vscode-lm when no Copilot subscription is active.** `detect()` calls `vscode.lm.selectChatModels()`, which may return models when Copilot is installed but not authenticated. Then `runSdk()` calls it again and gets models, but `model.sendRequest()` throws an auth error. The user sees `[VS Code LM Error] ...` in the agent output buffer rather than a clear pre-spawn error.

**Stopping an SDK agent that is in the `runSdk()` await phase.** If a user calls `ptah_agent_stop` while `doSpawnSdk` is still awaiting `runSdk()` (which itself awaits `getCodexSdk()` or `vscode.lm.selectChatModels()`), the agent is not yet in the `agents` map. `stop()` throws "Agent not found" because the agent ID hasn't been registered yet. The `spawning` counter prevents exceeding concurrency limits but doesn't enable cancellation of in-flight spawns.

### 3. What data makes this produce wrong results?

**Empty model list between detect and runSdk.** VS Code LM `detect()` returns `installed: true` based on available models at detection time. By the time `runSdk()` is called (could be minutes later), models may no longer be available (Copilot extension disabled, subscription expired). `runSdk()` throws, but the error propagates through the `done` promise's rejection handler in `doSpawnSdk`, which calls `handleExit(agentId, 1, null)` -- setting status to `failed` with no clear indication of why.

**Codex SDK returning unexpected event types.** The local `CodexThreadEvent` type union is a subset of what the actual SDK may emit. If the SDK adds new event types in a future version, they silently fall through the `default` branch of `handleStreamEvent`. This is acceptable for unknown events, but if the SDK renames existing events (e.g., `turn.failed` becomes `turn.error`), failures become invisible.

### 4. What happens when dependencies fail?

**Codex SDK network error mid-stream.** If network drops during `for await (const event of streamedTurn.events)`, the async generator throws. The catch block in `done` handles this correctly -- emits error output and returns exit code 1. However, there's no retry or reconnect logic. For a 30-minute task that fails at minute 29, all work is lost with only an error message.

**VS Code extension host restart.** If the VS Code extension host restarts (crash, reload), all in-memory `TrackedAgent` state is lost. SDK-based agents have no PID (process is null), so they can't be recovered. CLI-based agents at least have orphaned processes that can be found. SDK agents simply vanish with no trace.

### 5. What's missing that the requirements didn't mention?

- **No progress indication.** SDK agents can run for 30 minutes. There's no heartbeat, progress event, or "last activity" timestamp. The caller has no way to distinguish a stuck agent from a working one.
- **No token usage tracking.** Codex SDK emits `turn.completed` events with `usage` (input/output tokens), but `handleStreamEvent` ignores them completely (`default` branch). This is cost-relevant data being discarded.
- **No model selection for VS Code LM.** `models[0]` is always used. There's no way for the user to prefer a specific model family (Claude vs GPT) when multiple are available.
- **No API key handling for Codex SDK.** `new sdk.Codex()` is called with no `apiKey` parameter. It relies on the environment variable `OPENAI_API_KEY` being set. If it's not, the error message from the SDK will be cryptic.

## Failure Mode Analysis

### Failure Mode 1: Cached SDK Import Rejection

- **Trigger**: `@openai/codex-sdk` not installed, or ESM/CJS resolution failure
- **Symptoms**: Every Codex SDK spawn fails with the same import error, even if the package is installed later during the session
- **Impact**: Codex SDK permanently broken for the VS Code session; requires extension reload
- **Current Handling**: Rejected promise cached at module level (line 96-107 of `codex-cli.adapter.ts`)
- **Recommendation**: Clear `codexSdkImport` on rejection so the next call retries:
  ```typescript
  function getCodexSdk(): Promise<CodexSdkModule> {
    if (!codexSdkImport) {
      codexSdkImport = import('@openai/codex-sdk').catch((err) => {
        codexSdkImport = null; // Allow retry
        throw err;
      }) as Promise<CodexSdkModule>;
    }
    return codexSdkImport;
  }
  ```

### Failure Mode 2: Output Callback Registration Race

- **Trigger**: SDK returns data before `doSpawnSdk` registers the output callback
- **Symptoms**: First chunk(s) of output silently lost; agent output appears to start mid-sentence
- **Impact**: Partial output loss -- mild for text output, potentially serious if the first chunk contains error messages or headers
- **Current Handling**: None. `emitOutput` fires to empty `outputCallbacks` array
- **Recommendation**: Buffer output internally and flush when first callback is registered, or change the API to accept the callback as a parameter to `runSdk()` instead of registering it after the fact

### Failure Mode 3: Sanitization Corrupting SDK Prompts

- **Trigger**: Task description contains `$`, `()`, `{}`, `|`, `&`, `<`, `>`, `;`, backticks
- **Symptoms**: Characters stripped from task prompt, causing AI agent to receive garbled instructions
- **Impact**: Agent works on wrong/incomplete task; user doesn't know the prompt was modified
- **Current Handling**: Same `sanitizeTask()` applied to both CLI and SDK paths (line 145 of `agent-process-manager.service.ts`)
- **Recommendation**: Skip sanitization for SDK-based adapters. The sanitization exists to prevent shell injection in `child_process.spawn()`, but SDK adapters never invoke a shell. Add a check:
  ```typescript
  const sanitizedTask = runSdk ? request.task : this.sanitizeTask(request.task);
  ```

### Failure Mode 4: Double-Exit Timing with Timeout

- **Trigger**: Timeout fires at the exact moment the SDK `done` promise resolves
- **Symptoms**: `handleTimeout` sets status to `timeout` and calls `killProcess` (which aborts), then `handleExit` fires from the `done` promise resolution but is blocked by `hasExited` guard -- this is correct. However, `handleTimeout` calls `killProcess` which aborts, which causes the `done` promise to resolve with exit code 1, which calls `handleExit` again -- also blocked by `hasExited`. The race is handled.
- **Impact**: Low -- the `hasExited` guard works correctly here
- **Current Handling**: Adequate via `hasExited` boolean guard
- **Recommendation**: No change needed, but worth noting this was analyzed

### Failure Mode 5: CancellationTokenSource Not Disposed on Abort-Before-Request

- **Trigger**: AbortController aborted before `model.sendRequest()` is called (e.g., during the async gap between `selectChatModels()` and `sendRequest()` in `runSdk()`)
- **Symptoms**: `CancellationTokenSource` is disposed in the `finally` block of the `done` IIFE, but `onAbort` listener fires `cancellationTokenSource.cancel()` -- `cancel()` on a not-yet-used token is fine. However, `sendRequest()` receives an already-cancelled token and throws immediately. The error is caught, `abortController.signal.aborted` is true, so exit code 1 is returned. Cleanup happens in `finally`. This path is correct.
- **Impact**: None -- handled correctly
- **Current Handling**: Adequate

### Failure Mode 6: VS Code LM Error Masking

- **Trigger**: `vscode.lm.selectChatModels()` throws in `detect()` (not just empty array -- actual throw)
- **Symptoms**: `detect()` catches all errors and returns `installed: false`. This is fine for detection. But there's no distinction between "no models" and "extension host error" -- the user just sees the CLI as unavailable
- **Impact**: Low -- detection is best-effort
- **Current Handling**: Catch-all returns `installed: false`
- **Recommendation**: Log the error in `detect()` for debugging (currently silently swallowed)

### Failure Mode 7: Unbounded Output Callbacks Array

- **Trigger**: Multiple calls to `sdkHandle.onOutput()` register multiple callbacks
- **Symptoms**: Output emitted multiple times if `onOutput` called more than once
- **Impact**: Currently `doSpawnSdk` only calls `onOutput` once (line 306), so this is theoretical. But the interface allows it and nothing prevents it.
- **Current Handling**: Array accumulates, all callbacks fire
- **Recommendation**: Document that `onOutput` should only be called once, or enforce single-callback semantics

### Failure Mode 8: Codex startThread Failure

- **Trigger**: `codex.startThread()` throws (invalid working directory, no git repo and `skipGitRepoCheck` not set)
- **Symptoms**: `runSdk()` throws before creating the AbortController, so the error propagates to `doSpawnSdk`'s `await runSdk()` call. But `doSpawnSdk` doesn't wrap this in a try-catch -- it will propagate up to `doSpawn`, then to `spawn()`, then to the MCP handler. The error is not user-friendly.
- **Impact**: User sees raw SDK error in MCP response
- **Current Handling**: Unhandled -- relies on outer MCP error handling
- **Recommendation**: Wrap `runSdk()` call in try-catch within `doSpawnSdk` to provide a friendlier error message:
  ```typescript
  let sdkHandle: SdkHandle;
  try {
    sdkHandle = await runSdk({...});
  } catch (error) {
    throw new Error(`Failed to start ${cli} SDK agent: ${error instanceof Error ? error.message : String(error)}`);
  }
  ```

## Critical Issues

### Issue 1: Cached SDK Import Failure is Permanent

- **File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-adapters\codex-cli.adapter.ts:96-107`
- **Scenario**: `@openai/codex-sdk` is not installed when first Codex SDK spawn is attempted. User installs it via npm. All subsequent spawns still fail because the rejected promise is cached in the module-level variable.
- **Impact**: Codex SDK permanently broken for the VS Code session. User must reload the VS Code window.
- **Evidence**:

  ```typescript
  let codexSdkImport: Promise<CodexSdkModule> | null = null;

  function getCodexSdk(): Promise<CodexSdkModule> {
    if (!codexSdkImport) {
      codexSdkImport = import('@openai/codex-sdk') as Promise<CodexSdkModule>;
      // If this rejects, codexSdkImport remains set to the rejected promise
    }
    return codexSdkImport;
  }
  ```

- **Fix**: Clear cache on rejection:
  ```typescript
  function getCodexSdk(): Promise<CodexSdkModule> {
    if (!codexSdkImport) {
      codexSdkImport = import('@openai/codex-sdk').catch((err) => {
        codexSdkImport = null;
        throw err;
      }) as Promise<CodexSdkModule>;
    }
    return codexSdkImport;
  }
  ```

### Issue 2: Shell Sanitization Applied to SDK Prompts

- **File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\agent-process-manager.service.ts:145`
- **Scenario**: User asks Claude to spawn an agent with task: "Implement the `getData()` function that returns `${config.baseUrl}/api`". The sanitization strips `()`, `$`, `{}`, backticks, resulting in: "Implement the getData function that returns config.baseUrl/api". The AI agent receives a corrupted prompt.
- **Impact**: Agent works on wrong task. User doesn't know their prompt was modified. This corruption is silent.
- **Evidence**:
  ```typescript
  const SHELL_METACHAR_PATTERN = /[`$(){}|&<>^;%!]/g;
  // ...
  const sanitizedTask = this.sanitizeTask(request.task);
  // sanitizedTask is passed to both CLI spawn AND SDK runSdk paths
  ```
- **Fix**: Only sanitize for CLI (spawn) path, not SDK path:
  ```typescript
  const runSdk = adapter.runSdk?.bind(adapter);
  const taskForExecution = runSdk ? request.task : this.sanitizeTask(request.task);
  ```

## Serious Issues

### Issue 1: Output Callback Registration Race Condition

- **File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-adapters\codex-cli.adapter.ts:191-235` and `vscode-lm.adapter.ts:114-162`
- **Scenario**: `runSdk()` creates the `done` IIFE which begins executing immediately. The IIFE can emit output (via `emitOutput`) before the caller (`doSpawnSdk`) registers a callback via `onOutput`. This is especially likely if the SDK's `thread.runStreamed()` or `model.sendRequest()` resolves synchronously or very fast (e.g., from cache).
- **Impact**: First chunk(s) of output lost silently
- **Evidence**:

  ```typescript
  // In runSdk():
  const done = (async (): Promise<number> => {
    // This starts executing NOW
    const streamedTurn = await thread.runStreamed(taskPrompt, ...);
    for await (const event of streamedTurn.events) {
      this.handleStreamEvent(event, emitOutput); // emits to empty callbacks array
    }
  })();
  return { abort: abortController, done, onOutput }; // caller registers callback AFTER

  // In doSpawnSdk():
  const sdkHandle = await runSdk({...}); // runSdk resolves, done IIFE already running
  // ...
  sdkHandle.onOutput((data) => { ... }); // registered AFTER done IIFE started
  ```

- **Fix**: Either (a) accept the callback as a parameter to `runSdk()`, or (b) buffer output until first callback registration:
  ```typescript
  const pendingBuffer: string[] = [];
  let flushed = false;
  const onOutput = (callback: (data: string) => void): void => {
    outputCallbacks.push(callback);
    if (!flushed) {
      flushed = true;
      for (const buffered of pendingBuffer) callback(buffered);
      pendingBuffer.length = 0;
    }
  };
  const emitOutput = (data: string): void => {
    if (outputCallbacks.length === 0) {
      pendingBuffer.push(data);
      return;
    }
    for (const cb of outputCallbacks) cb(data);
  };
  ```

### Issue 2: Codex detect() Checks CLI Binary, Not SDK Availability

- **File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-adapters\codex-cli.adapter.ts:113-149`
- **Scenario**: User has the `codex` CLI binary installed but NOT the `@openai/codex-sdk` npm package. `detect()` returns `installed: true`. `AgentProcessManager` sees `adapter.runSdk` exists and routes to SDK path. `runSdk()` fails on `getCodexSdk()` import. The agent is created, starts, and immediately fails.
- **Impact**: Agent appears to start but immediately fails with an import error. User confusion.
- **Evidence**: `detect()` checks `which codex` / `where codex`. It never checks if `@openai/codex-sdk` is importable. But `runSdk()` always uses the SDK, never the CLI binary.
- **Fix**: Either (a) check SDK import in `detect()`:
  ```typescript
  // After CLI detection, verify SDK is importable
  try {
    await getCodexSdk();
  } catch {
    /* SDK not available, still return installed for CLI fallback */
  }
  ```
  Or (b) try SDK first, fall back to CLI spawn if SDK import fails (requires the adapter to conditionally implement `runSdk`).

### Issue 3: No Token/Usage Tracking for Codex SDK

- **File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-adapters\codex-cli.adapter.ts:291-293`
- **Scenario**: Codex SDK emits `turn.completed` with `usage: { input_tokens, cached_input_tokens, output_tokens }`. This data is discarded in the `default` branch of `handleStreamEvent`.
- **Impact**: No cost visibility for Codex SDK usage. In a multi-agent orchestration scenario, users have no way to track how much each agent costs.
- **Evidence**:
  ```typescript
  default:
    // thread.started, turn.started, turn.completed, item.started, item.updated - no output
    break;
  ```
  `turn.completed` with usage data falls through to default.
- **Fix**: Extract and emit usage data, or store it on the tracked agent for later retrieval:
  ```typescript
  case 'turn.completed':
    emitOutput(`[Usage] Input: ${event.usage.input_tokens}, Output: ${event.usage.output_tokens}, Cached: ${event.usage.cached_input_tokens}\n`);
    break;
  ```

### Issue 4: VS Code LM Adapter Always Uses First Model

- **File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-adapters\vscode-lm.adapter.ts:99`
- **Scenario**: User has GitHub Copilot (GPT-4o) and a Claude extension both providing models. `selectChatModels()` returns both. `models[0]` is used, which may not be the user's preferred model. There is no way to specify model preference.
- **Impact**: User cannot control which model is used for VS Code LM agents. Nondeterministic model selection.
- **Evidence**:
  ```typescript
  const model = models[0]; // Always first model, order not guaranteed
  ```
- **Fix**: Accept model family/vendor preference, either via adapter constructor or through the `CliCommandOptions`:
  ```typescript
  const preferred = models.find((m) => m.vendor === 'copilot') ?? models[0];
  ```

## Data Flow Analysis

```
ptah_agent_spawn MCP call
  |
  v
AgentProcessManager.spawn(request)
  |
  +-- sanitizeTask(request.task)        <-- ISSUE: strips valid chars for SDK path
  |
  +-- adapter.runSdk exists?
  |     |
  |     YES --> doSpawnSdk()
  |     |         |
  |     |         +-- await runSdk(options)
  |     |         |     |
  |     |         |     +-- [Codex] getCodexSdk()     <-- ISSUE: cached rejection
  |     |         |     |     +-- new Codex()
  |     |         |     |     +-- startThread()       <-- ISSUE: no try-catch for bad workdir
  |     |         |     |     +-- thread.runStreamed()
  |     |         |     |     +-- for await events     <-- ISSUE: IIFE starts before callback
  |     |         |     |
  |     |         |     +-- [VS Code LM] selectChatModels()
  |     |         |           +-- models[0]           <-- ISSUE: no model selection
  |     |         |           +-- sendRequest()
  |     |         |           +-- for await chunks     <-- ISSUE: IIFE starts before callback
  |     |         |
  |     |         +-- agents.set(agentId, tracked)
  |     |         +-- sdkHandle.onOutput(cb)           <-- registered AFTER done IIFE starts
  |     |         +-- sdkHandle.done.then(handleExit)
  |     |
  |     NO --> doSpawn() [existing CLI spawn path]
  |
  v
TrackedAgent in agents map
  |
  +-- output buffered via appendBuffer
  +-- timeout via setTimeout -> handleTimeout -> killProcess -> abort
  +-- exit via handleExit (guarded by hasExited)
  +-- cleanup via scheduleCleanup (30min TTL)
```

### Gap Points Identified:

1. Sanitization applied to SDK path corrupts prompts (data loss at sanitizeTask)
2. Output lost between IIFE start and callback registration (data loss at emitOutput)
3. Cached import rejection prevents recovery (permanent failure at getCodexSdk)
4. No SDK availability verification during detect() (false positive at detect)

## Requirements Fulfillment

| Requirement                                 | Status   | Concern                                          |
| ------------------------------------------- | -------- | ------------------------------------------------ |
| Codex SDK integration via @openai/codex-sdk | COMPLETE | SDK import caching bug; detect/runSdk mismatch   |
| VS Code LM as spawnable agent               | COMPLETE | No model selection; no system prompt             |
| SdkHandle interface for non-process agents  | COMPLETE | onOutput race condition                          |
| AgentProcessManager SDK branch              | COMPLETE | Sanitization applied incorrectly to SDK path     |
| Abort/cancellation for SDK agents           | COMPLETE | Correct AbortController/CancellationToken bridge |
| Timeout handling for SDK agents             | COMPLETE | Correctly reuses existing timeout infrastructure |
| CliType union extended                      | COMPLETE | Clean addition of 'vscode-lm'                    |
| Tool description updated                    | COMPLETE | Mentions VS Code LM and all three agent types    |

### Implicit Requirements NOT Addressed:

1. **Progress/heartbeat for long-running SDK agents** -- No way to distinguish stuck from working
2. **Token/cost tracking** -- Codex SDK provides usage data that is discarded
3. **Model selection for VS Code LM** -- No user control over which model is used
4. **Fallback from SDK to CLI** -- If SDK import fails, no fallback to `codex --quiet` CLI path
5. **System prompt for VS Code LM** -- `sendRequest()` receives only the task as a User message with no system context about the workspace, conventions, or output format expectations

## Edge Case Analysis

| Edge Case                             | Handled | How                                 | Concern                                             |
| ------------------------------------- | ------- | ----------------------------------- | --------------------------------------------------- |
| SDK package not installed             | PARTIAL | Import error thrown                 | Cached permanently; no fallback to CLI              |
| Empty model list (VS Code LM)         | YES     | Throws clear error in runSdk        | Error message is good                               |
| Abort during runSdk() await           | NO      | Agent not in map yet                | Cannot be stopped; must wait for runSdk to complete |
| Rapid agent spawn (concurrent)        | YES     | spawning counter + maxConcurrent    | Correct                                             |
| Network failure mid-stream            | YES     | Caught in done IIFE                 | No retry; acceptable for v1                         |
| Codex SDK returns unknown event types | YES     | Default branch ignores              | Acceptable                                          |
| Very large SDK output                 | YES     | Rolling buffer with MAX_BUFFER_SIZE | Reuses existing infrastructure correctly            |
| VS Code extension host restart        | NO      | All state lost                      | Acceptable -- same as CLI agents                    |
| AbortController.abort() called twice  | YES     | Second abort is no-op               | Correct                                             |
| Timeout + natural exit race           | YES     | hasExited guard                     | Correct                                             |

## Integration Risk Assessment

| Integration                                 | Failure Probability | Impact                        | Mitigation                         |
| ------------------------------------------- | ------------------- | ----------------------------- | ---------------------------------- |
| Codex SDK import (ESM/CJS)                  | MEDIUM              | Agent type permanently broken | Cache clearing on rejection needed |
| VS Code LM selectChatModels                 | LOW                 | Agent type unavailable        | Adequate error handling            |
| Codex SDK startThread                       | LOW                 | Spawn fails                   | Needs try-catch wrapper            |
| Codex SDK runStreamed                       | LOW                 | Stream fails mid-execution    | Caught, error emitted              |
| VS Code LM sendRequest                      | LOW                 | Request fails                 | Caught, error emitted              |
| AbortController -> CancellationToken bridge | LOW                 | Leak                          | Properly disposed in finally       |

## Verdict

**Recommendation**: NEEDS_REVISION
**Confidence**: HIGH
**Top Risk**: Shell sanitization silently corrupting SDK task prompts (Critical Issue 2) -- this will cause every SDK agent to receive a mangled prompt whenever the task contains common programming characters like `()`, `$`, or backticks, which is extremely likely in a coding assistant context.

## What Robust Implementation Would Include

1. **Separate sanitization paths**: Skip shell metachar stripping for SDK-based adapters since they never touch a shell
2. **Resilient SDK import**: Clear cached rejection so retry is possible without extension reload
3. **Output buffering**: Buffer output in SdkHandle until first callback is registered, then flush
4. **SDK availability check in detect()**: Verify `@openai/codex-sdk` is importable during detection, or conditionally expose `runSdk` only when SDK is available
5. **Usage/token tracking**: Capture Codex SDK `turn.completed` usage data for cost visibility
6. **Model selection**: Allow user preference for VS Code LM model family/vendor
7. **System prompt for VS Code LM**: Provide workspace context and output format instructions as a system message
8. **Detect-time error logging**: Log errors in VS Code LM `detect()` catch block for debugging
9. **Activity timestamp**: Track `lastActivityAt` on TrackedAgent for liveness detection of SDK agents
10. **Fallback strategy**: If SDK import fails for Codex, fall back to CLI spawn path rather than failing entirely
