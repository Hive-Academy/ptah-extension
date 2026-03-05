# Research Report: Ptah CLI Agent Failures - TASK_2025_172

## 1. Architecture Overview - How Ptah CLI Agents Work End-to-End

### Spawning Flow

The Ptah CLI agent spawning follows this chain:

```
Claude SDK Session (main agent)
  -> Uses MCP tool: ptah_agent_spawn(task, ptahCliId, workingDirectory, ...)
    -> protocol-handlers.ts: handleIndividualTool('ptah_agent_spawn', args)
      -> ptahAPI.agent.spawn(request)
        -> agent-namespace.builder.ts: buildAgentNamespace().spawn(request)
          -> IF request.ptahCliId:
              -> PtahCliRegistry.spawnAgent(id, task, projectGuidance)
                -> Creates SDK query via queryFn({prompt, options})  [*** MISSING CWD ***]
                -> Returns SdkHandle
              -> AgentProcessManager.spawnFromSdkHandle(handle, meta)
                -> Tracks lifecycle, output, timeout
          -> ELSE (standard CLI like Gemini):
              -> AgentProcessManager.spawn(request)
                -> spawnCli(binary, args, {cwd: workingDirectory}) [CWD CORRECTLY SET]
```

### Key Architecture Components

**MCP Tool Layer** (`libs/backend/vscode-lm-tools`):

- `protocol-handlers.ts` - Routes `ptah_agent_spawn` MCP tool calls
- `agent-namespace.builder.ts` - Builds the `ptah.agent.spawn()` API, enriches request with `parentSessionId` and `projectGuidance`

**Agent SDK Layer** (`libs/backend/agent-sdk`):

- `PtahCliRegistry` - Manages lifecycle of PtahCliAdapter instances and spawns headless agents
- `PtahCliAdapter` - IAIProvider for Anthropic-compatible providers (interactive chat sessions)
- `SdkPermissionHandler` - Bridges SDK's `canUseTool` callback to VS Code webview UI
- `SdkQueryOptionsBuilder` - Builds complete SDK query options (used by SdkAgentAdapter, NOT by PtahCliRegistry.spawnAgent)

**LLM Abstraction Layer** (`libs/backend/llm-abstraction`):

- `AgentProcessManager` - Manages all agent processes (CLI + SDK), tracks lifecycle, output, timeouts
- `CliDetectionService` - Detects installed CLIs (Gemini, Copilot)
- CLI adapters (Gemini, Copilot) - Build commands for CLI subprocess spawning

### Two Separate Spawn Paths

There are two distinct paths for spawning agents, and they have very different configuration completeness:

**Path A: Standard CLI Agents (Gemini/Copilot)** - Works correctly

- Uses `AgentProcessManager.spawn()` or `doSpawnSdk()`
- Working directory correctly set via `spawnCli(binary, args, {cwd: workingDirectory})` for CLI
- For SDK adapters, `cwd` is passed through `CliCommandOptions`

**Path B: Ptah CLI Agents** - Has critical bugs

- Uses `PtahCliRegistry.spawnAgent()` then `AgentProcessManager.spawnFromSdkHandle()`
- SDK query in `PtahCliRegistry.spawnAgent()` is MISSING critical options (see Root Cause Analysis)

---

## 2. Root Cause Analysis

### Failure 1: Working Directory Not Respected (CRITICAL)

**Root Cause**: `PtahCliRegistry.spawnAgent()` does NOT pass `cwd` to the SDK query options.

**Evidence** (file: `libs/backend/agent-sdk/src/lib/ptah-cli/ptah-cli-registry.ts`, lines 690-710):

```typescript
const sdkQuery = queryFn({
  prompt: task,
  options: {
    abortController,
    model,
    maxTurns: 25,
    systemPrompt: { type: 'preset', preset: 'claude_code', ... },
    tools: { type: 'preset', preset: 'claude_code' },
    permissionMode: 'default',
    includePartialMessages: false,
    persistSession: false,
    env: buildSafeEnv(authEnv),
    // *** MISSING: cwd ***
    // *** MISSING: canUseTool ***
    // *** MISSING: settingSources ***
  } as Options,
});
```

Without `cwd`, the SDK defaults to `process.cwd()` which in VS Code extensions is the VS Code installation directory (e.g., `C:\Users\abdal\AppData\Local\Programs\Microsoft VS Code`).

**Contrast with working path**: `SdkQueryOptionsBuilder.build()` (used for interactive chat sessions) correctly sets `cwd`:

```typescript
const cwd = sessionConfig?.projectPath || process.cwd();
// ... later ...
options: { cwd, ... }
```

And `PtahCliAdapter.buildQueryOptions()` also correctly sets it:

```typescript
const cwd = projectPath || process.cwd();
// ... later ...
options: { cwd, ... }
```

**Fix**: Pass `cwd` from `workingDirectory` parameter into the SDK query options in `PtahCliRegistry.spawnAgent()`. The `workingDirectory` is available from the caller chain - `agent-namespace.builder.ts` resolves it as `request.workingDirectory ?? workspaceRoot ?? process.cwd()`, BUT it never passes it to `registry.spawnAgent()`.

The fix requires changes in TWO places:

1. `agent-namespace.builder.ts`: Pass `workingDirectory` to `registry.spawnAgent()`
2. `ptah-cli-registry.ts`: Accept `workingDirectory` param and set `cwd` in SDK options

### Failure 2: AskUserQuestion Fails for CLI Agents

**Root Cause**: `PtahCliRegistry.spawnAgent()` does NOT pass a `canUseTool` callback to the SDK query options.

**Evidence** (same file, lines 690-710): The options object has `permissionMode: 'default'` but NO `canUseTool` callback.

When `permissionMode: 'default'` without `canUseTool`:

- The SDK falls back to its built-in interactive permission behavior
- For `AskUserQuestion`, the SDK tries to prompt the user via its own terminal-based mechanism
- Since there's no terminal (this is an SDK session running in-process), it fails with "Answer questions?"

**The existing AskUserQuestion infrastructure is fully built** (TASK_2025_136):

1. **Backend handler**: `SdkPermissionHandler.handleAskUserQuestion()` (lines 743-827 of `sdk-permission-handler.ts`)

   - Validates input using `isAskUserQuestionToolInput()` type guard
   - Sends `ASK_USER_QUESTION_REQUEST` message to webview
   - Awaits user response via `awaitQuestionResponse()` with 5-minute timeout
   - Returns `PermissionResult` with `updatedInput.answers` populated

2. **Message routing**: `WebviewMessageHandler.handleAskUserQuestionResponse()` (lines 331-360 of `webview-message-handler.service.ts`)

   - Receives `ASK_USER_QUESTION_RESPONSE` from webview
   - Routes to `SdkPermissionHandler.handleQuestionResponse()`

3. **Frontend handler**: `ChatMessageHandlerService` handles `ASK_USER_QUESTION_REQUEST` (lines 63+ of `chat-message-handler.service.ts`)

4. **Frontend UI**: `QuestionCardComponent` (in `libs/frontend/chat/src/lib/components/molecules/question-card.component.ts`)

5. **Frontend permission service**: `PermissionHandlerService.handleQuestionResponse()` (lines 381+ of `permission-handler.service.ts`)
   - Sends response back via `ASK_USER_QUESTION_RESPONSE` message type

The entire pipeline works for interactive SDK chat sessions because `SdkQueryOptionsBuilder.build()` properly wires `canUseTool`:

```typescript
const canUseToolCallback: CanUseTool = this.permissionHandler.createCallback();
// ... later ...
options: { canUseTool: canUseToolCallback, ... }
```

**Fix**: Add `canUseTool: this.permissionHandler.createCallback()` to the SDK query options in `PtahCliRegistry.spawnAgent()`.

### Failure 3: Security Sandbox Allows Only VS Code Directory

**Root Cause**: This is a direct consequence of Failure 1. The SDK sets the allowed working directories based on the `cwd` option. Since `cwd` defaults to the VS Code installation directory, the sandbox only allows access to that directory.

When the SDK starts with `cwd = 'C:\Users\abdal\AppData\Local\Programs\Microsoft VS Code'`:

- It sets the sandbox root to that directory
- Any file operations outside that directory are blocked with: "For security, Claude Code may only list files in the allowed working directories for this session"
- The actual project directory (`d:/projects/SellTime_Portal_Workspace`) is completely inaccessible

**Fix**: Same as Failure 1 - setting `cwd` correctly will automatically fix the sandbox.

### Failure 4: ExitPlanMode Fails

**Root Cause**: Without `canUseTool`, the SDK uses its built-in interactive permission handling. `ExitPlanMode` is classified as a SAFE_TOOL in `SdkPermissionHandler` (auto-approved), but since the spawned agent has NO `canUseTool` callback, the SDK falls back to its interactive prompt mechanism which fails in the non-interactive SDK session.

**Evidence**: In `SdkPermissionHandler`, `ExitPlanMode` is in the `SAFE_TOOLS` list (line 131):

```typescript
const SAFE_TOOLS = [
  'Read',
  'Grep',
  'Glob',
  'TodoWrite',
  'ExitPlanMode', // <-- Auto-approved
  'EnterPlanMode',
  // ...
];
```

When `canUseTool` is properly wired, `ExitPlanMode` would be auto-approved instantly. Without it, the SDK prompts for user confirmation with "Exit plan mode?" which fails.

**Fix**: Same as Failure 2 - wiring `canUseTool` will auto-approve `ExitPlanMode` just like it does for interactive sessions.

---

## 3. Existing Infrastructure

### AskUserQuestion Pipeline (TASK_2025_136 - Complete)

The full request/response pipeline for AskUserQuestion already exists:

```
SDK Agent calls AskUserQuestion tool
  -> canUseTool callback invoked (SdkPermissionHandler)
    -> handleAskUserQuestion(input, toolUseId)
      -> Validates input with isAskUserQuestionToolInput()
      -> Sends ASK_USER_QUESTION_REQUEST to webview via WebviewManager
      -> Awaits awaitQuestionResponse(requestId, 5min timeout)
        -> Promise stored in pendingQuestionRequests map
        -> Webview shows QuestionCardComponent with options
        -> User selects answers, clicks submit
        -> Frontend sends ASK_USER_QUESTION_RESPONSE message
        -> WebviewMessageHandler routes to handleAskUserQuestionResponse()
        -> SdkPermissionHandler.handleQuestionResponse() resolves promise
      -> Returns PermissionResult with answers in updatedInput
```

### Permission Pipeline (Working for interactive sessions)

```
SDK Agent calls tool (Write, Bash, etc.)
  -> canUseTool callback invoked
    -> SdkPermissionHandler classifies tool
    -> Safe tools: auto-approved instantly
    -> Dangerous/Network/MCP tools: sends PERMISSION_REQUEST to webview
    -> User approves/denies in webview
    -> Response flows back via SDK_PERMISSION_RESPONSE -> handleResponse()
```

### Key Message Types (from `libs/shared/src/lib/types/message.types.ts`)

```typescript
MESSAGE_TYPES = {
  ASK_USER_QUESTION_REQUEST: 'ask-user-question:request',
  ASK_USER_QUESTION_RESPONSE: 'ask-user-question:response',
  PERMISSION_REQUEST: 'sdk-permission:request',
  SDK_PERMISSION_RESPONSE: 'sdk-permission:response',
  PLAN_MODE_CHANGED: 'plan-mode:changed',
  // ...
};
```

### Type Guards (from `libs/shared/src/lib/type-guards/tool-input-guards.ts`)

```typescript
isAskUserQuestionToolInput(input); // Validates AskUserQuestion tool input
isBashToolInput(input); // Validates Bash tool input
isWriteToolInput(input); // etc.
```

---

## 4. Fix Strategy

### Fix 1: Pass `cwd` and `canUseTool` to `PtahCliRegistry.spawnAgent()` (CRITICAL)

**File**: `libs/backend/agent-sdk/src/lib/ptah-cli/ptah-cli-registry.ts`

**Change**: Update `spawnAgent()` method signature to accept `workingDirectory` and wire `cwd` + `canUseTool` in SDK query options.

Current signature:

```typescript
async spawnAgent(
  id: string,
  task: string,
  projectGuidance?: string
): Promise<{ handle: SdkHandle; agentName: string } | SpawnAgentFailure>
```

New signature:

```typescript
async spawnAgent(
  id: string,
  task: string,
  options?: {
    projectGuidance?: string;
    workingDirectory?: string;
  }
): Promise<{ handle: SdkHandle; agentName: string } | SpawnAgentFailure>
```

SDK query options changes (inside `spawnAgent()`):

```typescript
const sdkQuery = queryFn({
  prompt: task,
  options: {
    abortController,
    model,
    maxTurns: 25,
    cwd: options?.workingDirectory || process.cwd(),  // FIX 1: Set working directory
    systemPrompt: { ... },
    tools: { type: 'preset', preset: 'claude_code' },
    permissionMode: 'default',
    canUseTool: this.permissionHandler.createCallback(),  // FIX 2: Wire permission handler
    includePartialMessages: false,
    persistSession: false,
    settingSources: ['user', 'project', 'local'],  // FIX 3: Load CLAUDE.md settings
    env: buildSafeEnv(authEnv),
    stderr: (data: string) => {                    // FIX 4: Capture stderr for debugging
      this.logger.error(`[PtahCliRegistry] stderr: ${data}`);
    },
  } as Options,
});
```

### Fix 2: Pass `workingDirectory` through the spawn chain

**File**: `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/agent-namespace.builder.ts`

**Change**: Pass `workingDirectory` to `registry.spawnAgent()`.

Current code:

```typescript
const result = await registry.spawnAgent(request.ptahCliId, request.task, projectGuidance);
```

New code:

```typescript
const workingDirectory = request.workingDirectory ?? workspaceRoot ?? process.cwd();

const result = await registry.spawnAgent(request.ptahCliId, request.task, {
  projectGuidance,
  workingDirectory,
});
```

### Fix 3: Update `PtahCliRegistryLike` interface

**File**: `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/agent-namespace.builder.ts`

Update the interface to match the new signature:

```typescript
interface PtahCliRegistryLike {
  listAgents(): Promise<PtahCliListEntry[]>;
  spawnAgent(
    id: string,
    task: string,
    options?: {
      projectGuidance?: string;
      workingDirectory?: string;
    }
  ): Promise<{ handle: SdkHandle; agentName: string } | SpawnAgentFailure>;
}
```

### Fix 4: Add `stderr` capture for debugging

Already included in Fix 1 above. Adding `stderr` callback will capture SDK error output that currently goes to /dev/null.

### Summary of All Changes

| #   | File                         | Change                                 | Fixes                                      |
| --- | ---------------------------- | -------------------------------------- | ------------------------------------------ |
| 1   | `ptah-cli-registry.ts`       | Add `cwd` to SDK query options         | Working directory, Sandbox                 |
| 2   | `ptah-cli-registry.ts`       | Add `canUseTool` callback              | AskUserQuestion, ExitPlanMode, Permissions |
| 3   | `ptah-cli-registry.ts`       | Add `settingSources`                   | CLAUDE.md loading                          |
| 4   | `ptah-cli-registry.ts`       | Add `stderr` callback                  | Debug visibility                           |
| 5   | `ptah-cli-registry.ts`       | Update `spawnAgent()` signature        | Accept workingDirectory                    |
| 6   | `agent-namespace.builder.ts` | Pass workingDirectory to spawnAgent    | Plumbing                                   |
| 7   | `agent-namespace.builder.ts` | Update `PtahCliRegistryLike` interface | Type safety                                |

---

## 5. Key Files Map

### Files That Need Changes

| File                    | Absolute Path                                                                                                                  | Change Type                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| PtahCliRegistry         | `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\ptah-cli\ptah-cli-registry.ts`                                      | CRITICAL: Add cwd, canUseTool, settingSources, stderr to SDK query; update spawnAgent signature |
| Agent Namespace Builder | `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\agent-namespace.builder.ts` | Pass workingDirectory to registry.spawnAgent(); update PtahCliRegistryLike interface            |

### Files for Reference (No Changes Needed)

| File                   | Absolute Path                                                                                                      | Purpose                                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| SdkPermissionHandler   | `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\sdk-permission-handler.ts`                              | Already handles AskUserQuestion (lines 743-827), ExitPlanMode auto-approve (line 131). No changes needed.       |
| SdkQueryOptionsBuilder | `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\sdk-query-options-builder.ts`                   | Reference for correct SDK query options (cwd, canUseTool, settingSources). Use as template for fix.             |
| PtahCliAdapter         | `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\ptah-cli\ptah-cli-adapter.ts`                           | Reference for buildQueryOptions() with proper cwd and canUseTool. Use as template for fix.                      |
| AgentProcessManager    | `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\agent-process-manager.service.ts`        | Handles agent lifecycle tracking. spawnFromSdkHandle() records workingDirectory in metadata. No changes needed. |
| Protocol Handlers      | `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-handlers\protocol-handlers.ts` | Routes ptah_agent_spawn MCP tool calls. No changes needed.                                                      |
| WebviewMessageHandler  | `D:\projects\ptah-extension\libs\backend\vscode-core\src\services\webview-message-handler.service.ts`              | Routes ASK_USER_QUESTION_RESPONSE to SdkPermissionHandler. No changes needed.                                   |
| ChatMessageHandler     | `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat-message-handler.service.ts`                   | Handles ASK_USER_QUESTION_REQUEST in webview. No changes needed.                                                |
| QuestionCardComponent  | `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\question-card.component.ts`            | UI for displaying questions. No changes needed.                                                                 |
| buildSafeEnv           | `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\build-safe-env.ts`                              | Builds minimal environment. No changes needed.                                                                  |
| Failure Analysis       | `D:\projects\ptah-extension\agent-failure-analysis.md`                                                             | Original failure analysis showing all 4 failures                                                                |
| Message Types          | `D:\projects\ptah-extension\libs\shared\src\lib\types\message.types.ts`                                            | ASK_USER_QUESTION_REQUEST/RESPONSE message type constants                                                       |
| Permission Types       | `D:\projects\ptah-extension\libs\shared\src\lib\types\permission.types.ts`                                         | ISdkPermissionHandler interface with handleQuestionResponse                                                     |
| Tool Input Guards      | `D:\projects\ptah-extension\libs\shared\src\lib\type-guards\tool-input-guards.ts`                                  | isAskUserQuestionToolInput type guard                                                                           |

---

## 6. Impact Assessment

### Scope of Fix

This is a **minimal, focused fix** touching only 2 files:

- `ptah-cli-registry.ts` (~20 lines changed)
- `agent-namespace.builder.ts` (~10 lines changed)

### Risk Analysis

| Risk                                           | Probability | Impact | Mitigation                                                           |
| ---------------------------------------------- | ----------- | ------ | -------------------------------------------------------------------- |
| Breaking existing PtahCliAdapter chat sessions | LOW         | HIGH   | spawnAgent is only called for headless agents, not chat sessions     |
| Permission handler shared state issues         | LOW         | MEDIUM | SdkPermissionHandler is a DI singleton designed for concurrent use   |
| canUseTool callback memory leaks               | LOW         | LOW    | Agent has finite maxTurns (25) and timeout, callback gets GC'd after |

### What This Fix Enables

1. **Agents start in the correct project directory** - All file operations work
2. **AskUserQuestion routes to webview UI** - Users see questions and can answer
3. **ExitPlanMode auto-approved** - Agents can exit plan mode without user interaction
4. **Security sandbox includes project directory** - Agents can access project files
5. **CLAUDE.md and project settings loaded** - Agents get project context
6. **Better debugging** - stderr captured for error diagnosis

### What This Fix Does NOT Address

1. **Agent type case sensitivity** (e.g., 'explore' vs 'Explore') - This is a Task subagent issue, not related to spawn config
2. **Model access for sub-agents** (kimi-k2 not available for Task subagents) - This is a model tier configuration issue
3. **CLI agent transforms** (AskUserQuestion -> CLI equivalent) - Only applies to Gemini/Copilot CLI agents, not Ptah CLI SDK agents
