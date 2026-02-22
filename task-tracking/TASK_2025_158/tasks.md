# Development Tasks - TASK_2025_158: Codex SDK + VS Code LM Agent Orchestration

**Total Tasks**: 14 | **Batches**: 4 | **Status**: 4/4 complete
**QA Fix Commit**: 6d0309f6 - fix(vscode): address QA review findings for SDK adapters

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS

### Assumptions Verified

- CliAdapter optional method extension is backward-compatible: VERIFIED
- GeminiCliAdapter compiles without changes after interface extension: VERIFIED
- `appendBuffer()` and `handleExit()` are reusable for SDK path: VERIFIED (they operate on agentId string, not ChildProcess)
- `vscode` import is already used in `agent-process-manager.service.ts`: VERIFIED (line 15)
- `buildTaskPrompt()` utility is reusable for SDK adapters: VERIFIED

### Risks Identified

| Risk                                                                                                      | Severity | Mitigation                                                          |
| --------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------- |
| Codex SDK may be ESM-only, requiring dynamic `import()` from CJS bundle                                   | MEDIUM   | Task 1.1 verifies this; Task 1.3 uses cached dynamic import pattern |
| `TrackedAgent.process` becoming nullable requires null guards in `killProcess()`, `steer()`, and `stop()` | MEDIUM   | Task 2.1 explicitly updates all process-access sites                |
| `getDefaultCli()` at line 523 hardcodes `'gemini' \| 'codex'` check - won't recognize `'vscode-lm'`       | LOW      | Task 4.3 adds vscode-lm to default CLI selection logic              |
| Codex SDK event types may differ from context.md documentation                                            | MEDIUM   | Task 1.3 must verify actual SDK exports before coding               |

### Edge Cases to Handle

- [ ] SDK abort after completion (no-op, not error) -> Task 2.1
- [ ] Timeout firing after SDK already resolved -> Task 2.1 (hasExited guard)
- [ ] VS Code LM model not available (no Copilot subscription) -> Task 4.2
- [ ] Concurrent mix of CLI + SDK agents -> Task 2.1 (concurrent limit includes both)

---

## Batch 1: Extend CliAdapter Interface and Rewrite CodexCliAdapter - COMPLETE

**Developer**: backend-developer
**Tasks**: 4 | **Dependencies**: None
**Commit**: 9de71611

### Task 1.1: Install @openai/codex-sdk - COMPLETE

**File**: `D:\projects\ptah-extension\package.json`
**Spec Reference**: implementation-plan.md: Task 1.1

**Quality Requirements**:

- Package installs successfully with no peer dependency conflicts
- Verify ESM vs CJS: check if `require('@openai/codex-sdk')` works or if dynamic `import()` is needed
- Verify SDK exports: `Codex` class, `startThread()`, `thread.runStreamed()`

**Implementation Details**:

- Run `npm install @openai/codex-sdk`
- Check `node_modules/@openai/codex-sdk/package.json` for `"type": "module"` (ESM indicator)
- If ESM-only, confirm `await import('@openai/codex-sdk')` pattern works

---

### Task 1.2: Extend CliAdapter Interface with SdkHandle and runSdk - COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-adapters\cli-adapter.interface.ts`
**Spec Reference**: implementation-plan.md: Task 1.2
**Pattern to Follow**: Existing `CliAdapter` interface at lines 24-50

**Quality Requirements**:

- `SdkHandle` interface exported with `abort`, `done`, and `onOutput` fields
- `runSdk` is optional on `CliAdapter` (using `?` syntax)
- GeminiCliAdapter still compiles without changes
- All types are readonly where appropriate

**Implementation Details**:

- Add `SdkHandle` interface before `CliAdapter`
- Add `runSdk?(options: CliCommandOptions): Promise<SdkHandle>` to `CliAdapter`
- `SdkHandle.abort`: `AbortController`
- `SdkHandle.done`: `Promise<number>` (exit code 0=success, 1=error)
- `SdkHandle.onOutput`: `(callback: (data: string) => void) => void`

---

### Task 1.3: Rewrite CodexCliAdapter to Use Codex SDK - COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-adapters\codex-cli.adapter.ts`
**Spec Reference**: implementation-plan.md: Task 1.3
**Pattern to Follow**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-adapters\gemini-cli.adapter.ts`

**Quality Requirements**:

- Keep existing `detect()`, `buildCommand()`, `supportsSteer()`, `parseOutput()` methods working
- NEW `runSdk(options)` method that:
  1. Dynamically imports `@openai/codex-sdk` (cached)
  2. Creates Codex client instance
  3. Starts thread with `workingDirectory`
  4. Runs streamed with built task prompt
  5. Wires async generator events to `onOutput` callback
  6. Returns `SdkHandle` with abort controller and done promise
- No `any` types
- Error handling: SDK errors resolve `done` with exit code 1, not reject

**Validation Notes**:

- RISK: SDK may be ESM-only - use cached `import()` pattern
- RISK: Event types may differ from docs - verify `item.completed` has text content
- Must verify SDK's actual abort/cancellation mechanism (AbortController? thread.cancel()?)

**Implementation Details**:

- Cache the dynamic import promise in a module-level variable
- Use `buildTaskPrompt(options)` from `cli-adapter.utils.ts`
- Iterate `thread.runStreamed()` async generator
- For `item.completed` events with text content, push to `onOutput`
- Wrap generator iteration in try/catch for `done` promise resolution

---

### Task 1.4: Update CLI Adapter Barrel Exports - COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-adapters\index.ts`
**Spec Reference**: implementation-plan.md: Task 1.4

**Quality Requirements**:

- `SdkHandle` type exported from barrel
- All existing exports unchanged

**Implementation Details**:

- Add `SdkHandle` to the type export from `./cli-adapter.interface`

---

**Batch 1 Verification**:

- All files exist and compile
- `nx run llm-abstraction:typecheck` passes
- GeminiCliAdapter unchanged and still compiles
- `SdkHandle` importable from barrel

---

## Batch 2: Update AgentProcessManager for SDK Execution Path - COMPLETE

**Developer**: backend-developer
**Tasks**: 2 | **Dependencies**: Batch 1
**Commit**: 4d5d00fb

### Task 2.1: Extend TrackedAgent and doSpawn() for SDK Path - COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\agent-process-manager.service.ts`
**Spec Reference**: implementation-plan.md: Task 2.1
**Pattern to Follow**: Existing `doSpawn()` at lines 97-225

**Quality Requirements**:

- `TrackedAgent.process` becomes `ChildProcess | null` (null for SDK agents)
- `TrackedAgent.sdkAbortController?: AbortController` added
- `doSpawn()` branches: if `adapter.runSdk` exists, call new `doSpawnSdk()` private method
- New `doSpawnSdk()` method:
  - Calls `adapter.runSdk(options)` -> gets `SdkHandle`
  - Creates `TrackedAgent` with `process: null`, `sdkAbortController: sdkHandle.abort`
  - Wires `sdkHandle.onOutput` to `appendBuffer()`
  - Wires `sdkHandle.done` to `handleExit()`
  - Sets up timeout (same as CLI path)
  - Returns `SpawnAgentResult`
- `killProcess()` updated: if `tracked.process` is null, call `tracked.sdkAbortController?.abort()` instead
- `steer()` updated: guard against null process (SDK agents don't support stdin)
- `stop()` works for both CLI and SDK agents

**Validation Notes**:

- EDGE CASE: `hasExited` guard in `handleExit()` prevents double-exit from timeout + SDK done racing
- EDGE CASE: `killProcess()` must handle null process gracefully (early return if no process and no abort controller)
- Concurrent limit must count SDK agents the same as CLI agents (already does via `getRunningCount()`)

**Implementation Details**:

- Import `SdkHandle` from `./cli-adapters/cli-adapter.interface`
- Branch point is after line 139 (after `adapter` is obtained), BEFORE `buildCommand()`
- The SDK path skips `buildCommand()`, `binaryPath` resolution, and `spawn()` entirely
- SDK path still sanitizes the task, validates working directory, creates agentId/info

---

### Task 2.2: Update getDefaultCli() for vscode-lm Recognition - COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\agent-process-manager.service.ts`
**Spec Reference**: Plan Validation finding (not in original plan)

**Quality Requirements**:

- `getDefaultCli()` at line 519-540 updated to recognize `'vscode-lm'` as valid preferred CLI
- Auto-detect preference order: gemini > codex > vscode-lm (vscode-lm only when explicitly set or others unavailable)

**Implementation Details**:

- Line 523: Change `preferred === 'gemini' || preferred === 'codex'` to include `preferred === 'vscode-lm'`
- Or better: validate against known CliType values from detection service adapters map
- Auto-detect: keep gemini > codex preference, add vscode-lm as last fallback

---

**Batch 2 Verification**:

- SDK-based adapters (Codex) use `runSdk()` path
- CLI adapters (Gemini) use existing `spawn()` path unchanged
- `stop()` works for SDK agents via AbortController
- Timeout works for SDK agents
- `steer()` gives clear error for SDK agents
- `nx run llm-abstraction:typecheck` passes

---

## Batch 3: Testing and Quality Gates - COMPLETE

**Developer**: backend-developer
**Tasks**: 3 | **Dependencies**: Batch 2
**Commit**: a14ae357

### Task 3.1: Unit Tests for CodexCliAdapter.runSdk() - COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-adapters\codex-cli.adapter.spec.ts` (CREATE)
**Spec Reference**: implementation-plan.md: Task 3.1

**Quality Requirements**:

- Test `runSdk()` creates Codex client and thread
- Test output events from SDK are pushed to `onOutput` callback
- Test `SdkHandle.done` resolves with 0 on success
- Test `SdkHandle.done` resolves with 1 on error
- Test `SdkHandle.abort` cancels the thread
- Test `detect()` still works
- Test dynamic import is cached (only one `import()` call)
- No `any` in test types

**Implementation Details**:

- Mock `import('@openai/codex-sdk')` to return fake Codex class
- Fake thread yields test events via async generator
- Test abort by checking AbortController signal

---

### Task 3.2: Unit Tests for AgentProcessManager SDK Path - COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\agent-process-manager.service.spec.ts` (CREATE)
**Spec Reference**: implementation-plan.md: Task 3.2

**Quality Requirements**:

- Test `spawn()` with SDK adapter calls `runSdk()` instead of `child_process.spawn`
- Test output from SDK appears in `readOutput()`
- Test `stop()` on SDK agent calls `AbortController.abort()`
- Test timeout triggers `handleExit()` for SDK agents
- Test `steer()` on SDK agent throws appropriate error
- Test `shutdownAll()` handles mix of CLI and SDK agents
- Test concurrent limit includes SDK agents

**Implementation Details**:

- Create mock CliDetectionService with fake SDK adapter
- Mock vscode.workspace.getConfiguration
- Verify no `child_process.spawn` called for SDK adapters

---

### Task 3.3: Quality Gates - COMPLETE

**Quality Requirements**:

- `npx nx run llm-abstraction:typecheck` passes with zero errors
- `npx nx lint llm-abstraction` passes with zero errors
- `npx nx test llm-abstraction` passes with all tests green
- `npx nx run shared:typecheck` passes
- `npm run typecheck:all` passes
- `npm run lint:all` passes

---

**Batch 3 Verification**:

- All tests pass
- Zero TypeScript errors
- Zero lint errors
- No regressions in existing tests

---

## Batch 4: VS Code LM as Spawnable Agent via ptah_agent_spawn - COMPLETE

**Developer**: backend-developer
**Tasks**: 5 | **Dependencies**: Batch 2
**Commit**: cb40734a

### Task 4.1: Extend CliType to Include 'vscode-lm' - COMPLETE

**File**: `D:\projects\ptah-extension\libs\shared\src\lib\types\agent-process.types.ts`
**Spec Reference**: implementation-plan.md: Task 4.1

**Quality Requirements**:

- `CliType = 'gemini' | 'codex' | 'vscode-lm'`
- `nx run shared:typecheck` passes

**Implementation Details**:

- Line 60: Add `| 'vscode-lm'` to CliType union

---

### Task 4.2: Create VsCodeLmAdapter - COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-adapters\vscode-lm.adapter.ts` (CREATE)
**Spec Reference**: implementation-plan.md: Task 4.2
**Pattern to Follow**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-adapters\codex-cli.adapter.ts`

**Quality Requirements**:

- Implements `CliAdapter` interface
- `detect()`: Check `vscode.lm.selectChatModels()` for available models, return `{ cli: 'vscode-lm', installed: true/false, version: modelName }`
- `buildCommand()`: Return dummy (not used for SDK-based adapters)
- `supportsSteer()`: Return `false`
- `parseOutput()`: Return raw (no ANSI from VS Code LM)
- `runSdk(options)`: Use SdkHandle pattern:
  1. Get VS Code LM model via `vscode.lm.selectChatModels()`
  2. Build prompt from `buildTaskPrompt(options)`
  3. Create `CancellationTokenSource` for abort
  4. Send request via `model.sendRequest(messages, {}, token)`
  5. Stream response text chunks to `onOutput` callback
  6. Return `SdkHandle` with abort (wrapping CancellationTokenSource) and done promise

**Validation Notes**:

- EDGE CASE: No models available -> `detect()` returns `installed: false`
- VS Code LM API uses `CancellationToken`, not `AbortController` - adapter must bridge these
- The `SdkHandle.abort` is an `AbortController`; on abort, call `cancellationTokenSource.cancel()`

**Implementation Details**:

- Import `* as vscode` for LM API access
- Use `vscode.LanguageModelChatMessage.User()` for message construction
- Stream via `for await (const chunk of response.stream)` pattern
- Bridge AbortController -> CancellationTokenSource: listen to `abort.signal.addEventListener('abort', () => cts.cancel())`

---

### Task 4.3: Register VsCodeLmAdapter in CliDetectionService - COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-detection.service.ts`
**Spec Reference**: implementation-plan.md: Task 4.3

**Quality Requirements**:

- `getAdapter('vscode-lm')` returns VsCodeLmAdapter
- `detectAll()` includes vscode-lm detection result
- Auto-detect preference order unchanged for CLI agents (gemini > codex)
- vscode-lm available when explicitly requested

**Implementation Details**:

- Import `VsCodeLmAdapter` from `./cli-adapters/vscode-lm.adapter`
- In constructor: `const vscodeLm = new VsCodeLmAdapter(); this.adapters.set('vscode-lm', vscodeLm);`
- Update logger message to include vscode-lm

---

### Task 4.4: Update ptah_agent_spawn Tool Description - COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-handlers\tool-description.builder.ts`
**Spec Reference**: implementation-plan.md: Task 4.4

**Quality Requirements**:

- `cli` enum includes `'vscode-lm'`: `enum: ['gemini', 'codex', 'vscode-lm']`
- Tool description updated to mention VS Code LM as third agent type
- Description explains when to use vscode-lm (no external CLI needed, uses VS Code's built-in LM)

**Implementation Details**:

- Update `buildAgentSpawnTool()` function at line 251
- Update `cli.enum` array
- Update `cli.description` to mention vscode-lm option
- Update top-level `description` to mention all 3 agent types

---

### Task 4.5: Unit Tests for VsCodeLmAdapter - COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-adapters\vscode-lm.adapter.spec.ts` (CREATE)
**Spec Reference**: implementation-plan.md: Task 4.5

**Quality Requirements**:

- Test `detect()` returns installed when VS Code LM models available
- Test `detect()` returns not installed when no models available
- Test `runSdk()` sends request to VS Code LM and streams output
- Test abort cancels the request via CancellationTokenSource
- Test output pushed via onOutput callback
- Mock `vscode.lm` API for all tests

**Implementation Details**:

- Mock `vscode.lm.selectChatModels()` to return fake model
- Fake model's `sendRequest()` returns async iterable of text chunks
- Test cancellation by checking CancellationToken state

---

**Batch 4 Verification**:

- `CliType` includes `'vscode-lm'`
- `ptah_agent_spawn` accepts `cli: 'vscode-lm'`
- VsCodeLmAdapter detects available models
- VsCodeLmAdapter runs tasks via VS Code LM API
- All tests pass
- `npm run typecheck:all` passes
- `npm run lint:all` passes

---

## Batch Dependency Graph

```
Batch 1 (Interface + Codex SDK) ──> Batch 2 (Process Manager SDK path)
                                         |
                                         ├──> Batch 3 (Tests for Batches 1-2)
                                         └──> Batch 4 (VS Code LM adapter)
```

Batch 3 and Batch 4 can run in parallel after Batch 2.
