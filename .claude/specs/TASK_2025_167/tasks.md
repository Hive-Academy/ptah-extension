# Development Tasks - TASK_2025_167: Review Fix Issues

**Total Tasks**: 15 | **Batches**: 4 | **Status**: 4/4 complete
**Type**: BUGFIX (Triple review fixes)
**Branch**: feature/sdk-only-migration

---

## Plan Validation Summary

**Validation Status**: PASSED

### Assumptions Verified

- validateWorkingDirectory() exists at agent-process-manager.service.ts:1076 but is NOT called in spawnFromSdkHandle() -- confirmed issue #3
- cliLabel formatting is repeated 3x in mcp-response-formatter.ts (lines 436, 480, 546) -- confirmed issue #15
- ptah_agent_list is referenced in 5 places but has NO tool definition, handler, or formatter -- confirmed issue #4
- generateAgentId() uses Date.now() + Math.random() with no crypto import -- confirmed issue #8
- container.resolve<any>() at ptah-api-builder.service.ts:301 -- confirmed issue #7
- process.cwd() fallback at agent-namespace.builder.ts:106 -- confirmed issue #14
- process.env spread at custom-agent-registry.ts:612 -- confirmed issue #1
- bypassPermissions at custom-agent-registry.ts:608 -- confirmed issue #2
- AgentNamespace.list already exists at agent-namespace.builder.ts:143 -- confirmed ptah_agent_list just needs MCP wiring

### Risks Identified

| Risk                                                                                                                | Severity | Mitigation                                                              |
| ------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------- |
| Changing permissionMode from bypassPermissions may break custom agent spawning if SDK requires permission callbacks | MEDIUM   | Use 'default' mode which triggers permission handler already registered |
| Reducing env vars may break provider authentication if provider needs unexpected env vars                           | MEDIUM   | Keep authEnv (provider-specific) + PATH/HOME/TEMP only                  |
| Spawn mutex could introduce deadlocks if not properly released on error                                             | MEDIUM   | Use try/finally pattern for mutex release                               |

### Edge Cases to Handle

- [x] Edge case: spawnAgent() discriminated union must handle ALL 4 failure modes
- [x] Edge case: Error sanitization must strip stack traces but preserve actionable info
- [x] Edge case: Task string validation must reject null/undefined as well as overlength
- [x] Edge case: Mutex must release even on exception during spawn

---

## Batch 1: Critical Security Fixes COMPLETE

**Developer**: backend-developer
**Tasks**: 3 | **Dependencies**: None
**Priority**: CRITICAL -- Must go first, these are security vulnerabilities

### Task 1.1: Fix full process.env exposure to third-party providers COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\custom-agent\custom-agent-registry.ts`
**Spec Reference**: Issue #1 (CRITICAL)
**Lines**: 612 (spawnAgent method) and 444 (testConnection method)

**What to Change**:
Replace `{ ...process.env, ...authEnv }` with a minimal allow-listed env object. Only pass PATH, HOME, USERPROFILE, TEMP, TMP, APPDATA, LOCALAPPDATA (platform essentials) plus the authEnv vars. Do NOT spread all of process.env.

**Implementation Details**:

1. Create a private helper method `buildSafeEnv(authEnv: Record<string, string | undefined>): Record<string, string | undefined>` that:
   - Picks only: `PATH`, `HOME`, `USERPROFILE`, `TEMP`, `TMP`, `APPDATA`, `LOCALAPPDATA`, `SystemRoot`, `COMSPEC` from process.env
   - Spreads authEnv on top (provider-specific keys like ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL, model mappings)
   - Returns the combined minimal env
2. Replace line 612: `env: { ...process.env, ...authEnv }` with `env: this.buildSafeEnv(authEnv)`
3. Replace line 444: `env: { ...process.env, ...testAdapter['authEnv'] }` with `env: this.buildSafeEnv(testAdapter['authEnv'])`

**Acceptance Criteria**:

- process.env is never spread wholesale into custom agent environment
- Only essential platform vars + auth vars are passed
- Custom agent spawning still works (PATH must be present for SDK resolution)

---

### Task 1.2: Fix bypassPermissions with full claude_code toolset COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\custom-agent\custom-agent-registry.ts`
**Spec Reference**: Issue #2 (CRITICAL)
**Lines**: 604-609 (spawnAgent), 438-442 (testConnection)

**What to Change**:
Change `permissionMode: 'bypassPermissions'` to `permissionMode: 'default'` and remove `allowDangerouslySkipPermissions: true` in the spawnAgent() method. For testConnection(), keep bypassPermissions since it is a minimal one-shot test query with `maxTurns: 1` and `tools: []`.

**Implementation Details**:

1. In spawnAgent() (around line 604-609):
   - Change `permissionMode: 'bypassPermissions'` to `permissionMode: 'default'`
   - Remove `allowDangerouslySkipPermissions: true`
   - The permission handler injected via constructor will handle permission requests
2. In testConnection() (around line 438-442):
   - KEEP `permissionMode: 'bypassPermissions'` and `allowDangerouslySkipPermissions: true`
   - Rationale: test query uses `maxTurns: 1`, `tools: []`, and a harmless "Say ok" prompt
   - Add a comment explaining why bypass is acceptable here

**Acceptance Criteria**:

- spawnAgent() uses 'default' permission mode, no bypass
- testConnection() retains bypass with clear justification comment
- No `allowDangerouslySkipPermissions: true` in spawnAgent()

---

### Task 1.3: Fix working directory validation bypass in spawnFromSdkHandle() COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\agent-process-manager.service.ts`
**Spec Reference**: Issue #3 (CRITICAL)
**Line**: 489 (spawnFromSdkHandle method, inside the try block before creating agentId)

**What to Change**:
Add `this.validateWorkingDirectory(meta.workingDirectory)` call to `spawnFromSdkHandle()`, matching the existing validation in `doSpawn()` at line 207.

**Implementation Details**:

1. Add `this.validateWorkingDirectory(meta.workingDirectory);` after the concurrent limit check (after line 514) and before `const agentId = AgentId.create();` (line 516)
2. This matches the pattern already used in doSpawn() at line 207

**Acceptance Criteria**:

- spawnFromSdkHandle() validates working directory same as doSpawn()
- Working directory must be within workspace root
- Error thrown if directory is outside workspace

---

**Batch 1 Verification**:

- All 3 files compile without errors
- Build passes: `npx nx build agent-sdk` and `npx nx build llm-abstraction`
- code-logic-reviewer approved
- No process.env leak, no permission bypass in spawn, working directory validated

---

## Batch 2: Blocking + Serious Refactoring COMPLETE

**Developer**: backend-developer
**Tasks**: 3 | **Dependencies**: Batch 1
**Priority**: BLOCKING + SERIOUS -- ptah_agent_list tool + code dedup + error types

### Task 2.1: Add ptah_agent_list MCP tool COMPLETE

**Files**:

- `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-handlers\tool-description.builder.ts`
- `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-handlers\protocol-handlers.ts`
- `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-handlers\mcp-response-formatter.ts`

**Spec Reference**: Issue #4 (BLOCKING)

**What to Change**:
The system prompt references `ptah_agent_list` in 5 places but the tool doesn't exist. The underlying API already exists (`ptahAPI.agent.list()` in agent-namespace.builder.ts:143) -- we just need the MCP wiring.

**Implementation Details**:

**In tool-description.builder.ts**:

1. Add a new export function `buildAgentListTool(): MCPToolDefinition` that returns:
   ```typescript
   {
     name: 'ptah_agent_list',
     description: 'List all available CLI agents and custom agents. Returns installed CLIs (Gemini, Codex, Copilot) and user-configured custom agents with their IDs, names, and provider info. Use this to discover available agents before spawning.',
     inputSchema: { type: 'object', properties: {} },
     annotations: { readOnlyHint: true },
   }
   ```

**In protocol-handlers.ts**:

1. Add import: `buildAgentListTool` from tool-description.builder
2. Add import: `formatAgentList` from mcp-response-formatter
3. In `handleToolsList()`: add `buildAgentListTool()` to the tools array (after agent stop, before execute_code)
4. In `handleIndividualTool()`: add case `'ptah_agent_list'` that calls `ptahAPI.agent.list()` and returns `formatAgentList(result)`

**In mcp-response-formatter.ts**:

1. Add import: `CliDetectionResult` from `@ptah-extension/shared`
2. Add export function `formatAgentList(agents: CliDetectionResult[]): string` that formats the results as markdown using json2md, showing each agent with cli type, installed status, and custom agent details

**Acceptance Criteria**:

- `ptah_agent_list` appears in tools/list response
- Calling `ptah_agent_list` returns formatted list of available agents
- Custom agents show their customAgentId, name, and providerName

---

### Task 2.2: Extract shared trackSdkHandle() to eliminate 80% code duplication COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\agent-process-manager.service.ts`
**Spec Reference**: Issue #5 (SERIOUS)

**What to Change**:
`spawnFromSdkHandle()` (lines 489-601) duplicates ~80% of `doSpawnSdk()` (lines 347-483). Extract the shared logic into a private `trackSdkHandle()` method.

**Implementation Details**:

1. Create private method `trackSdkHandle(sdkHandle: SdkHandle, info: AgentProcessInfo, timeout: number): SpawnAgentResult` that contains:
   - Timeout setup (setTimeout + handleTimeout)
   - TrackedAgent creation (process: null, sdkAbortController, buffers, etc.)
   - agents.set()
   - Wire sdkHandle.onOutput to appendBuffer
   - Wire sdkHandle.onSegment (if available) to accumulateSegment
   - Wire sdkHandle.done to handleExit
   - Create and return SpawnAgentResult
2. Refactor `doSpawnSdk()` to:
   - Keep: model resolution, CLI detection, adapter.runSdk() call, cliSessionId capture, info creation
   - Replace: duplicated tracking code with `return this.trackSdkHandle(sdkHandle, info, timeout)`
3. Refactor `spawnFromSdkHandle()` to:
   - Keep: spawning counter increment/decrement, concurrent limit check, validateWorkingDirectory (from Task 1.3), info creation
   - Replace: duplicated tracking code with `return this.trackSdkHandle(sdkHandle, info, timeout)`

**Note**: `doSpawnSdk()` also captures late cliSessionId via sdkHandle.getSessionId() inside onSegment callback. The trackSdkHandle method should accept an optional `captureSessionId?: () => string | undefined` parameter to handle this.

**Acceptance Criteria**:

- No duplicated tracking logic between doSpawnSdk() and spawnFromSdkHandle()
- Both methods delegate to trackSdkHandle()
- All existing behavior preserved (timeout, output capture, exit handling, event emission)
- doSpawnSdk() still captures late cliSessionId

---

### Task 2.3: Return discriminated union from spawnAgent() instead of undefined COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\custom-agent\custom-agent-registry.ts`
**Spec Reference**: Issue #6 (SERIOUS)
**Lines**: 506-546 (spawnAgent method)

**What to Change**:
Replace the 4 `return undefined` paths with a discriminated union result type so callers know WHY spawning failed.

**Implementation Details**:

1. Define a new type at the top of the file (after the constants):
   ```typescript
   export type SpawnAgentFailure = {
     status: 'not_found' | 'disabled' | 'no_api_key' | 'unknown_provider';
     message: string;
   };
   ```
2. Change spawnAgent return type from `Promise<{ handle: SdkHandle; agentName: string } | undefined>` to `Promise<{ handle: SdkHandle; agentName: string } | SpawnAgentFailure>`
3. Replace the 4 `return undefined` with specific failures:
   - Config not found: `return { status: 'not_found', message: \`Agent config not found: ${id}\` }`
   - Agent disabled: `return { status: 'disabled', message: \`Agent is disabled: ${id}\` }`
   - No API key: `return { status: 'no_api_key', message: \`No API key configured for agent: ${id}\` }`
   - Unknown provider: `return { status: 'unknown_provider', message: \`Unknown provider: ${agentConfig.providerId}\` }`
4. Update the caller in `agent-namespace.builder.ts` (line 93-102):
   - Change from checking `if (!result)` to checking `if ('status' in result)` for failure
   - Include the failure message in the error: `throw new Error(\`Custom agent spawn failed: ${result.message}\`)`
5. Update the `CustomAgentRegistryLike` interface in `agent-namespace.builder.ts` (line 41-48) to match the new return type

**Acceptance Criteria**:

- spawnAgent() never returns undefined
- All 4 failure modes return typed discriminated union
- Caller in agent-namespace.builder.ts handles the new return type
- Error messages to the user include the specific reason

---

**Batch 2 Verification**:

- All modified files compile
- Build passes: `npx nx build llm-abstraction` and `npx nx build vscode-lm-tools` and `npx nx build agent-sdk`
- code-logic-reviewer approved
- ptah_agent_list tool works end-to-end
- No duplicated tracking code in agent-process-manager
- spawnAgent() returns specific failure reasons

---

## Batch 3: Remaining Serious Fixes COMPLETE

**Developer**: backend-developer
**Tasks**: 4 | **Dependencies**: Batch 2
**Priority**: SERIOUS -- Type safety, secure IDs, error sanitization, race condition

### Task 3.1: Fix container.resolve<any>() type safety COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\ptah-api-builder.service.ts`
**Spec Reference**: Issue #7 (SERIOUS)
**Line**: 301

**What to Change**:
Replace `container.resolve<any>(SDK_CUSTOM_AGENT_REGISTRY)` with a properly typed resolution using the `CustomAgentRegistryLike` interface pattern already defined in agent-namespace.builder.ts.

**Implementation Details**:

1. Import or define (inline) a `CustomAgentRegistryLike` interface in ptah-api-builder.service.ts that matches the one in agent-namespace.builder.ts:
   ```typescript
   interface CustomAgentRegistryLike {
     listAgents(): Promise<{ id: string; name: string; providerName: string; hasApiKey: boolean; enabled: boolean }[]>;
     spawnAgent(id: string, task: string, projectGuidance?: string): Promise<{ handle: SdkHandle; agentName: string } | SpawnAgentFailure>;
   }
   ```
   Note: After Task 2.3, spawnAgent returns SpawnAgentFailure instead of undefined. Since this is a duck-typed interface for DI resolution, and the actual consumer (agent-namespace.builder.ts) handles the return type, the interface here should match.
2. Replace line 301: `return container.resolve<any>(SDK_CUSTOM_AGENT_REGISTRY);` with `return container.resolve<CustomAgentRegistryLike>(SDK_CUSTOM_AGENT_REGISTRY);`
3. Remove the eslint-disable comment on line 300

**Acceptance Criteria**:

- No `any` type in DI resolution
- TypeScript strict mode satisfied
- eslint @typescript-eslint/no-explicit-any rule not suppressed

---

### Task 3.2: Replace predictable agent IDs with crypto.randomUUID() COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\custom-agent\custom-agent-registry.ts`
**Spec Reference**: Issue #8 (SERIOUS)
**Line**: 59-61

**What to Change**:
Replace `Date.now() + Math.random()` with `crypto.randomUUID()` for unpredictable agent IDs.

**Implementation Details**:

1. Add import at top: `import { randomUUID } from 'crypto';`
2. Replace the generateAgentId function body:
   ```typescript
   function generateAgentId(): string {
     return `ca-${randomUUID()}`;
   }
   ```
3. The `ca-` prefix is kept for visual identification as a custom agent ID

**Acceptance Criteria**:

- Agent IDs use cryptographically random UUIDs
- IDs still start with `ca-` prefix for identification
- No Date.now() or Math.random() in ID generation

---

### Task 3.3: Sanitize error messages forwarded to output callbacks COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\custom-agent\custom-agent-registry.ts`
**Spec Reference**: Issue #9 (SERIOUS)
**Line**: 671

**What to Change**:
Error messages from SDK queries may contain provider API keys, internal URLs, or stack traces. Sanitize before forwarding to output callbacks.

**Implementation Details**:

1. Create a private method `sanitizeErrorMessage(message: string): string` that:
   - Strips any string that looks like an API key (sk-_, key-_, token patterns longer than 20 chars)
   - Removes stack traces (lines starting with "at " or containing file paths)
   - Truncates to max 500 characters
   - Keeps the first line (usually the actionable error message)
2. Replace line 671: `cb(\`\n[Error: ${message}]\n\`)`with`cb(\`\n[Error: ${this.sanitizeErrorMessage(message)}]\n\`)`
3. Also sanitize the error in testConnection() at line 478-484: replace `error: errorMsg` with `error: this.sanitizeErrorMessage(errorMsg)`

**Acceptance Criteria**:

- No API keys or auth tokens leaked in error output
- No stack traces in user-facing error messages
- Error messages remain useful (first line preserved)
- Messages capped at 500 characters

---

### Task 3.4: Fix race condition in concurrent limit check with spawn mutex COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\agent-process-manager.service.ts`
**Spec Reference**: Issue #10 (SERIOUS)

**What to Change**:
The concurrent limit check in spawn() and spawnFromSdkHandle() has a TOCTOU (time-of-check-time-of-use) gap. Between checking the limit and actually registering the agent in the map, another spawn could pass the check. Add a simple mutex/lock pattern.

**Implementation Details**:

1. Add a private spawn mutex field:
   ```typescript
   private spawnMutex: Promise<void> = Promise.resolve();
   ```
2. Create a private method `acquireSpawnLock<T>(fn: () => Promise<T>): Promise<T>` that serializes spawn operations:
   ```typescript
   private acquireSpawnLock<T>(fn: () => Promise<T>): Promise<T> {
     const release = this.spawnMutex;
     let resolve: () => void;
     this.spawnMutex = new Promise<void>((r) => { resolve = r; });
     return release.then(async () => {
       try {
         return await fn();
       } finally {
         resolve!();
       }
     });
   }
   ```
3. Wrap the body of `spawn()` in acquireSpawnLock
4. Wrap the body of `spawnFromSdkHandle()` in acquireSpawnLock
5. The `spawning` counter can be removed since the mutex serializes spawn operations, but keeping it is also fine for backwards compatibility -- just ensure the mutex prevents the TOCTOU gap

**Acceptance Criteria**:

- No two spawn operations can pass the concurrent limit check simultaneously
- Mutex properly releases on both success and error (try/finally)
- No deadlocks possible (Promise-based mutex is inherently non-blocking)
- spawn() and spawnFromSdkHandle() both use the mutex

---

**Batch 3 Verification**:

- All modified files compile
- Build passes: `npx nx build agent-sdk`, `npx nx build llm-abstraction`, `npx nx build vscode-lm-tools`
- code-logic-reviewer approved
- No `any` types in DI resolution
- Agent IDs are cryptographically random
- Error messages sanitized
- Race condition eliminated

---

## Batch 4: Moderate Improvements COMPLETE

**Developer**: backend-developer
**Tasks**: 5 | **Dependencies**: Batch 3
**Priority**: MODERATE -- Code quality improvements

### Task 4.1: Add verification comments for duplicated Symbol.for() DI tokens COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\ptah-api-builder.service.ts`
**Spec Reference**: Issue #11 (MODERATE)
**Lines**: 91-105

**What to Change**:
The three `Symbol.for()` tokens duplicate values from SDK_TOKENS. Add `@see` JSDoc comments linking to the canonical definitions and a brief explanation of why duplication is necessary (to avoid circular dependency).

**Implementation Details**:

1. For each of the three constants (SDK_SESSION_LIFECYCLE_MANAGER, SDK_ENHANCED_PROMPTS_SERVICE, SDK_CUSTOM_AGENT_REGISTRY), enhance the existing comments:
   - Add: `@see SDK_TOKENS.SDK_SESSION_LIFECYCLE_MANAGER in libs/backend/agent-sdk/src/lib/di/tokens.ts`
   - Add: `WARNING: If the string in Symbol.for() changes in tokens.ts, it MUST be updated here too.`
2. Keep the existing comments explaining WHY the duplication exists (circular dependency avoidance)

**Acceptance Criteria**:

- All 3 duplicated tokens have @see links to canonical definitions
- WARNING comments about keeping in sync
- No functional changes

---

### Task 4.2: Add @see JSDoc comments to shadow type contracts COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\agent-namespace.builder.ts`
**Spec Reference**: Issue #12 (MODERATE)
**Lines**: 29-48

**What to Change**:
The `CustomAgentListEntry` and `CustomAgentRegistryLike` interfaces are "shadow" contracts that must match the real types in agent-sdk. Add @see JSDoc comments linking to source types.

**Implementation Details**:

1. Add to `CustomAgentListEntry` interface:
   ```typescript
   /**
    * Minimal summary returned by CustomAgentRegistry.listAgents().
    * Only includes fields needed by the agent namespace builder.
    * @see CustomAgentSummary in @ptah-extension/shared for the full type
    * @see CustomAgentRegistry.listAgents() in libs/backend/agent-sdk/src/lib/custom-agent/custom-agent-registry.ts
    */
   ```
2. Add to `CustomAgentRegistryLike` interface:
   ```typescript
   /**
    * Minimal interface for CustomAgentRegistry to avoid circular dependency
    * between vscode-lm-tools -> agent-sdk.
    * @see CustomAgentRegistry in libs/backend/agent-sdk/src/lib/custom-agent/custom-agent-registry.ts
    * WARNING: If CustomAgentRegistry's public API changes, this interface MUST be updated.
    */
   ```
3. Update the spawnAgent return type in the interface to match the new discriminated union from Task 2.3

**Acceptance Criteria**:

- Both shadow types have @see links to canonical definitions
- WARNING comment about keeping in sync
- Return types match Task 2.3 changes

---

### Task 4.3: Add task string length validation at MCP handler level COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-handlers\protocol-handlers.ts`
**Spec Reference**: Issue #13 (MODERATE)
**Lines**: In handleIndividualTool(), ptah_agent_spawn case (around line 314)

**What to Change**:
Add max length validation (100KB) for the task string at the MCP handler level, before passing to the agent namespace.

**Implementation Details**:

1. In the `ptah_agent_spawn` case of handleIndividualTool(), after extracting `task` from args:
   ```typescript
   const MAX_TASK_LENGTH = 100 * 1024; // 100KB
   if (!task || typeof task !== 'string') {
     throw new Error('task parameter is required and must be a string');
   }
   if (task.length > MAX_TASK_LENGTH) {
     throw new Error(`task parameter exceeds maximum length of ${MAX_TASK_LENGTH} characters (got ${task.length})`);
   }
   ```
2. Place this validation before the logger.info call (around line 337)

**Acceptance Criteria**:

- Tasks over 100KB are rejected with a clear error
- Null/undefined task values are rejected
- Valid tasks pass through unchanged

---

### Task 4.4: Replace process.cwd() fallback with workspace root from deps COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\agent-namespace.builder.ts`
**Spec Reference**: Issue #14 (MODERATE)
**Line**: 106

**What to Change**:
Replace `request.workingDirectory ?? process.cwd()` with a workspace root from the dependency injection context.

**Implementation Details**:

1. Add `workspaceRoot?: string` to the `AgentNamespaceDependencies` interface
2. In PtahAPIBuilder.build() (ptah-api-builder.service.ts), pass `workspaceRoot: this.getWorkspaceRoot().fsPath` to buildAgentNamespace deps
3. In agent-namespace.builder.ts, destructure `workspaceRoot` from deps
4. Replace line 106: `const workingDirectory = request.workingDirectory ?? process.cwd()` with `const workingDirectory = request.workingDirectory ?? workspaceRoot ?? process.cwd()`
   - Keep process.cwd() as absolute last resort fallback for safety

**Acceptance Criteria**:

- Workspace root is injected via deps, not computed via process.cwd()
- process.cwd() only used as last-resort fallback
- PtahAPIBuilder passes workspace root to agent namespace

---

### Task 4.5: Extract cliLabel formatting helper to eliminate 3x repetition COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-handlers\mcp-response-formatter.ts`
**Spec Reference**: Issue #15 (MODERATE)
**Lines**: 436-439, 480-483, 546-549

**What to Change**:
Extract the repeated cliLabel formatting pattern into a helper function.

**Implementation Details**:

1. Add a private helper function before the agent formatting functions:
   ```typescript
   /**
    * Format CLI label for display: shows custom agent name when applicable
    */
   function formatCliLabel(cli: string, customAgentName?: string): string {
     return cli === 'custom' && customAgentName ? `custom (${customAgentName})` : cli;
   }
   ```
2. Replace all 3 occurrences:
   - formatAgentSpawn (line 436-439): `const cliLabel = formatCliLabel(result.cli, result.customAgentName);`
   - formatAgentStatus (line 480-483): `const cliLabel = formatCliLabel(a.cli, a.customAgentName);`
   - formatAgentStop (line 546-549): `const cliLabel = formatCliLabel(result.cli, result.customAgentName);`

**Acceptance Criteria**:

- cliLabel logic defined once in helper function
- All 3 usages delegate to the helper
- Output unchanged

---

**Batch 4 Verification**:

- All modified files compile
- Build passes: `npx nx build vscode-lm-tools` and `npx nx build agent-sdk`
- code-logic-reviewer approved
- DI tokens have sync warnings
- Shadow types have @see links
- Task validation prevents overlength input
- process.cwd() fallback replaced
- cliLabel formatting not repeated

---

## Summary of Files Modified per Batch

### Batch 1 (3 tasks, 2 files)

- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\custom-agent\custom-agent-registry.ts` (Tasks 1.1, 1.2)
- `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\agent-process-manager.service.ts` (Task 1.3)

### Batch 2 (3 tasks, 5 files)

- `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-handlers\tool-description.builder.ts` (Task 2.1)
- `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-handlers\protocol-handlers.ts` (Task 2.1)
- `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-handlers\mcp-response-formatter.ts` (Task 2.1)
- `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\agent-process-manager.service.ts` (Task 2.2)
- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\custom-agent\custom-agent-registry.ts` (Task 2.3)
- `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\agent-namespace.builder.ts` (Task 2.3)

### Batch 3 (4 tasks, 3 files)

- `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\ptah-api-builder.service.ts` (Task 3.1)
- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\custom-agent\custom-agent-registry.ts` (Tasks 3.2, 3.3)
- `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\agent-process-manager.service.ts` (Task 3.4)

### Batch 4 (5 tasks, 4 files)

- `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\ptah-api-builder.service.ts` (Task 4.1)
- `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\agent-namespace.builder.ts` (Tasks 4.2, 4.4)
- `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-handlers\protocol-handlers.ts` (Task 4.3)
- `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-handlers\mcp-response-formatter.ts` (Task 4.5)
