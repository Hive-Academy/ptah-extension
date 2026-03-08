# Development Tasks - TASK_2025_161: Gemini CLI Session Linking

**Total Tasks**: 12 | **Batches**: 5 | **Status**: 5/5 COMPLETE
**Commit**: fef5ebef (all batches in single commit)

---

## Plan Validation Summary

**Validation Status**: PASSED

### Assumptions Verified

- `GeminiStreamEvent.session_id` field exists at `gemini-cli.adapter.ts:48` -- VERIFIED
- `handleJsonLine()` case 'init' at lines 425-431 discards `session_id` -- VERIFIED (the gap)
- `SdkHandle` interface at `cli-adapter.interface.ts:44-53` supports optional extensions -- VERIFIED (`onSegment?` pattern)
- `AgentProcessInfo` supports optional fields (e.g., `taskFolder?: string` at line 71) -- VERIFIED
- `SessionLifecycleManager.getActiveSessionIds()` exists at line 236 -- VERIFIED
- `SDK_TOKENS.SDK_SESSION_METADATA_STORE` exists at `di/tokens.ts:33` -- VERIFIED
- `SDK_TOKENS` already imported in `rpc-method-registration.service.ts:28` -- VERIFIED
- `buildAgentNamespace` called at `ptah-api-builder.service.ts:231-234` with simple deps object -- VERIFIED
- `SessionMetadataStore` uses `vscode.Memento` storage with `save()`/`get()` pattern -- VERIFIED

### Risks Identified

| Risk                                                               | Severity | Mitigation                                                                                                 |
| ------------------------------------------------------------------ | -------- | ---------------------------------------------------------------------------------------------------------- |
| session_id arrives after agent:spawned event fires                 | MEDIUM   | Late-capture via onSegment callback updates TrackedAgent in-place (Batch 2 Task 2.2)                       |
| Multiple concurrent SDK sessions (getActiveSessionIds ambiguity)   | LOW      | Currently single-session; `getActiveSessionIds()[0]` is safe                                               |
| Older Gemini CLI versions may not emit session_id                  | LOW      | Field is optional, graceful degradation                                                                    |
| PtahAPIBuilder needs SessionLifecycleManager but doesn't inject it | MEDIUM   | Batch 3 adds `getActiveSessionId` callback; requires injecting SessionLifecycleManager into PtahAPIBuilder |

### Edge Cases to Handle

- [x] session_id not present in init event (older Gemini CLI) -- handled by optional field
- [x] Resume with invalid/expired session ID -- Gemini CLI returns error, agent exits with code 1
- [x] cliSessionId not yet available when agent:spawned fires -- late-capture via onSegment
- [x] Duplicate CLI session references in metadata -- deduplication by cliSessionId in addCliSession()
- [x] Parent session not found when persisting CLI session -- warn and skip gracefully

---

## Batch 1: Foundation Types -- COMPLETE

**Developer**: backend-developer
**Tasks**: 2 | **Dependencies**: None

### Task 1.1: Extend shared types with session linking fields -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\shared\src\lib\types\agent-process.types.ts`
**Spec Reference**: implementation-plan.md lines 84-175
**Pattern to Follow**: Existing optional field pattern at line 71 (`taskFolder?: string`)

**Quality Requirements**:

- All new fields MUST be `readonly` and optional to maintain backward compatibility
- JSDoc comments on every new field
- `CliSessionReference` interface placed after the existing types section with proper section header comment

**Implementation Details**:

1. Add `cliSessionId?: string` and `parentSessionId?: string` to `AgentProcessInfo` (after `pid` at line 75):

```typescript
/** CLI-native session ID (e.g., Gemini's UUID from init event). Enables session resume. */
readonly cliSessionId?: string;
/** Parent Ptah Claude SDK session that spawned this CLI agent via ptah_agent_spawn. */
readonly parentSessionId?: string;
```

2. Add `resumeSessionId?: string` and `parentSessionId?: string` to `SpawnAgentRequest` (after `model` at line 96):

```typescript
/** Resume a previous CLI session by its CLI-native session ID (e.g., Gemini --resume <id>) */
readonly resumeSessionId?: string;
/** Parent Ptah Claude SDK session ID. Injected by MCP server, NOT set by callers. */
readonly parentSessionId?: string;
```

3. Add `cliSessionId?: string` to `SpawnAgentResult` (after `startedAt` at line 121):

```typescript
/** CLI-native session ID captured from init event (e.g., Gemini UUID). Null if not yet available. */
readonly cliSessionId?: string;
```

4. Add new `CliSessionReference` interface after `AgentOutputDelta` (after line 183), with section header comment:

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

5. Export `CliSessionReference` from the shared library barrel file (`libs/shared/src/index.ts`).

---

### Task 1.2: Extend CLI adapter interfaces with session support -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-adapters\cli-adapter.interface.ts`
**Spec Reference**: implementation-plan.md lines 179-218
**Pattern to Follow**: Existing optional `onSegment?` on SdkHandle (line 52)

**Quality Requirements**:

- Both additions are optional -- existing Codex and Copilot adapters require ZERO changes
- JSDoc comments on every new field

**Implementation Details**:

1. Add `getSessionId?` to `SdkHandle` (after `onSegment` at line 52):

```typescript
/** Get CLI-native session ID (e.g., Gemini session UUID from init event). Returns undefined if not yet available or not supported by this adapter. */
readonly getSessionId?: () => string | undefined;
```

2. Add `resumeSessionId?` to `CliCommandOptions` (after `mcpPort` at line 31):

```typescript
/** Resume a previous CLI session by its CLI-native session ID. When set, the adapter adds appropriate resume flags (e.g., --resume for Gemini). */
readonly resumeSessionId?: string;
```

---

**Batch 1 Verification**:

- All files exist at paths
- Build passes: `npx nx build shared` and `npx nx build llm-abstraction`
- No runtime behavior changes (pure type additions)
- All new fields are readonly and optional

---

## Batch 2: Backend Capture + Resume -- COMPLETE

**Developer**: backend-developer
**Tasks**: 2 | **Dependencies**: Batch 1

### Task 2.1: Gemini adapter -- capture session_id and add --resume support -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-adapters\gemini-cli.adapter.ts`
**Spec Reference**: implementation-plan.md lines 228-387
**Pattern to Follow**: Existing `handleJsonLine` case 'init' at lines 425-431, existing `runSdk` at lines 248-401

**Quality Requirements**:

- `capturedSessionId` is a closure variable in `runSdk()` (NOT class-level state)
- `handleJsonLine` returns `string | undefined` (session_id or undefined)
- `--resume` flag replaces `--prompt=` when `resumeSessionId` is provided
- stdin still writes task prompt for both fresh and resume modes (Gemini appends stdin to the --resume context)

**Validation Notes**:

- RISK: session_id arrives in init event which is the first JSONL line. The closure variable pattern ensures capture before the SdkHandle is used.
- Edge case: If Gemini CLI doesn't emit session_id in init event, `capturedSessionId` remains undefined and `getSessionId()` returns undefined gracefully.

**Implementation Details**:

1. In `runSdk()` method, add closure variable after `abortController` (line 258):

```typescript
// Session ID captured from init event (closure scoped per invocation)
let capturedSessionId: string | undefined;
```

2. Replace args construction (lines 263-268) to support resume mode:

```typescript
const args = ['--output-format', 'stream-json', '--yolo'];

// Resume mode: use --resume <id> instead of --prompt=
if (options.resumeSessionId) {
  args.push('--resume', options.resumeSessionId);
} else {
  args.push('--prompt='); // Headless mode trigger -- actual prompt comes from stdin
}
```

3. Keep model flag unchanged (lines 271-273).

4. Replace stdin writing section (lines 335-336) to handle resume:

```typescript
// Write prompt to stdin (both fresh and resume mode -- Gemini appends stdin to context)
child.stdin?.write(taskPrompt + '\n');
child.stdin?.end();
```

5. Modify `handleJsonLine` signature and 'init' case to return session_id:

- Change return type from `void` to `string | undefined`
- In case 'init', capture and return `event.session_id`
- Emit info segment for session_id: `emitSegment({ type: 'info', content: 'Session: ${event.session_id}' })`
- All other cases return `undefined`
- Add `return undefined;` at method end

6. Update the stdout data handler (lines 349-360) to capture returned session_id:

```typescript
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

7. Also update the flush in the 'close' handler (lines 382-384) to capture session_id:

```typescript
if (lineBuf.trim()) {
  const sessionId = this.handleJsonLine(lineBuf.trim(), emitOutput, emitSegment);
  if (sessionId) {
    capturedSessionId = sessionId;
  }
  lineBuf = '';
}
```

8. Update return statement (line 400) to include `getSessionId`:

```typescript
return { abort: abortController, done, onOutput, onSegment, getSessionId: () => capturedSessionId };
```

---

### Task 2.2: AgentProcessManager -- thread parentSessionId, resumeSessionId, capture cliSessionId -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\agent-process-manager.service.ts`
**Spec Reference**: implementation-plan.md lines 390-503
**Pattern to Follow**: Existing `doSpawnSdk` at lines 344-455, existing `doSpawn` at lines 134-338

**Quality Requirements**:

- `parentSessionId` is set on `AgentProcessInfo` in BOTH the SDK path (`doSpawnSdk`) and the CLI subprocess path (`doSpawn`)
- `cliSessionId` uses late-capture pattern via `onSegment` callback (not just initial capture)
- `resumeSessionId` is passed through to `CliCommandOptions` in the SDK path
- `SpawnAgentResult` includes `cliSessionId` (may be undefined initially)
- TrackedAgent.info is updated in-place (immutable spread) when late session_id arrives

**Validation Notes**:

- RISK: session_id may arrive after `agent:spawned` fires. The late-capture in `onSegment` updates `tracked.info` immutably. By the time `agent:exited` fires, the cliSessionId should be populated.
- The `getSessionId?.()` optional chain means non-Gemini adapters (Codex, Copilot) return undefined safely.

**Implementation Details**:

1. In `doSpawnSdk()` (line 356-364), add `parentSessionId` to the info object:

```typescript
const info: AgentProcessInfo = {
  agentId,
  cli,
  task: request.task,
  workingDirectory,
  taskFolder: request.taskFolder,
  status: 'running',
  startedAt,
  parentSessionId: request.parentSessionId,
};
```

2. In `doSpawnSdk()` SDK call (lines 386-394), add `resumeSessionId`:

```typescript
const sdkHandle = await runSdk({
  task,
  workingDirectory,
  files: request.files,
  taskFolder: request.taskFolder,
  model: resolvedModel,
  binaryPath,
  mcpPort,
  resumeSessionId: request.resumeSessionId,
});
```

3. After sdkHandle returned (after line 394), capture initial cliSessionId:

```typescript
// Capture CLI session ID immediately if available (e.g., from sync init)
const initialCliSessionId = sdkHandle.getSessionId?.();
```

4. Update tracked agent info (line 403-414) to conditionally include `cliSessionId`:

```typescript
const tracked: TrackedAgent = {
  info: initialCliSessionId ? { ...info, cliSessionId: initialCliSessionId } : info,
  process: null,
  sdkAbortController: sdkHandle.abort,
  stdoutBuffer: '',
  stderrBuffer: '',
  timeoutHandle,
  stdoutLineCount: 0,
  stderrLineCount: 0,
  truncated: false,
  hasExited: false,
};
```

5. In the `onSegment` handler (lines 424-428), add late-capture logic:

```typescript
if (sdkHandle.onSegment) {
  sdkHandle.onSegment((segment: CliOutputSegment) => {
    this.accumulateSegment(agentId, segment);

    // Late capture: session_id arrives in init event (first JSONL line).
    if (!tracked.info.cliSessionId) {
      const sessionId = sdkHandle.getSessionId?.();
      if (sessionId) {
        tracked.info = { ...tracked.info, cliSessionId: sessionId };
      }
    }
  });
}
```

6. Update `SpawnAgentResult` (lines 445-450) to include `cliSessionId`:

```typescript
const spawnResult: SpawnAgentResult = {
  agentId,
  cli,
  status: 'running',
  startedAt,
  cliSessionId: initialCliSessionId,
};
```

7. Emit `tracked.info` (not just `info`) in the spawned event (line 452):

```typescript
this.events.emit('agent:spawned', tracked.info);
```

8. In `doSpawn()` (line 257-265), also add `parentSessionId` to the info object:

```typescript
const info: AgentProcessInfo = {
  agentId,
  cli,
  task: request.task,
  workingDirectory,
  taskFolder: request.taskFolder,
  status: 'running',
  startedAt,
  parentSessionId: request.parentSessionId,
};
```

---

**Batch 2 Verification**:

- All files exist at paths
- Build passes: `npx nx build llm-abstraction`
- code-logic-reviewer approved (no stubs/placeholders)
- Gemini adapter captures session_id from init event
- --resume flag added when resumeSessionId provided
- AgentProcessManager threads parentSessionId and cliSessionId through both spawn paths

---

## Batch 3: MCP Server + Session Metadata -- COMPLETE

**Developer**: backend-developer
**Tasks**: 5 | **Dependencies**: Batch 1, Batch 2

### Task 3.1: Agent namespace builder -- inject getActiveSessionId for parentSessionId -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\agent-namespace.builder.ts`
**Spec Reference**: implementation-plan.md lines 513-775
**Pattern to Follow**: Existing `buildAgentNamespace` at lines 32-113

**Quality Requirements**:

- Use `getActiveSessionId` callback (not static value) so session ID is resolved at spawn time
- Existing spawn/status/read/steer/stop/list/waitFor methods remain unchanged

**Implementation Details**:

1. Add `getActiveSessionId` to `AgentNamespaceDependencies`:

```typescript
export interface AgentNamespaceDependencies {
  agentProcessManager: AgentProcessManager;
  cliDetectionService: CliDetectionService;
  /** Function that returns the currently active SDK session ID. Called at spawn time. */
  getActiveSessionId?: () => string | undefined;
}
```

2. Destructure `getActiveSessionId` in `buildAgentNamespace`:

```typescript
const { agentProcessManager, cliDetectionService, getActiveSessionId } = deps;
```

3. Modify the `spawn` method to inject `parentSessionId`:

```typescript
spawn: async (request) => {
  const activeSessionId = getActiveSessionId?.();
  const enrichedRequest = activeSessionId
    ? { ...request, parentSessionId: activeSessionId }
    : request;
  return agentProcessManager.spawn(enrichedRequest);
},
```

---

### Task 3.2: Protocol handlers -- pass resume_session_id through ptah_agent_spawn -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-handlers\protocol-handlers.ts`
**Spec Reference**: implementation-plan.md lines 565-630
**Pattern to Follow**: Existing `ptah_agent_spawn` case at lines 314-363

**Quality Requirements**:

- `resume_session_id` is destructured from args and passed as `resumeSessionId` in the spawn request
- Log the `resumeSessionId` in the invocation log and `cliSessionId` in the result log
- `parentSessionId` is NOT passed as an MCP arg -- it is injected by buildAgentNamespace

**Implementation Details**:

1. Add `resume_session_id` to the destructured args (around line 315-331):

```typescript
const { task, cli, workingDirectory, timeout, files, taskFolder, model, resume_session_id } = args as {
  task: string;
  cli?: string;
  workingDirectory?: string;
  timeout?: number;
  files?: string[];
  taskFolder?: string;
  model?: string;
  resume_session_id?: string;
};
```

2. Add `resumeSessionId` to the log (line 333-340):

```typescript
resumeSessionId: resume_session_id,
```

3. Add `resumeSessionId` to the spawn call (lines 342-350):

```typescript
const result = await ptahAPI.agent.spawn({
  task,
  cli: cli as CliType | undefined,
  workingDirectory,
  timeout,
  files,
  taskFolder,
  model,
  resumeSessionId: resume_session_id,
});
```

4. Add `cliSessionId` to the result log (lines 352-356):

```typescript
cliSessionId: result.cliSessionId,
```

---

### Task 3.3: Tool description builder -- add resume_session_id parameter -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-handlers\tool-description.builder.ts`
**Spec Reference**: implementation-plan.md lines 634-665
**Pattern to Follow**: Existing `buildAgentSpawnTool` at lines 258-314

**Quality Requirements**:

- New `resume_session_id` property added to inputSchema.properties
- Tool description updated to mention resume capability

**Implementation Details**:

1. Add `resume_session_id` to `inputSchema.properties` (after `model` around line 309):

```typescript
resume_session_id: {
  type: 'string',
  description:
    'Resume a previous CLI agent session by its CLI-native session ID. ' +
    'For Gemini, this is the UUID from the init event. ' +
    'The agent will continue from where the previous session left off.',
},
```

2. Update the tool description (lines 262-266) to mention resume:

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

### Task 3.4: Session metadata store -- add cliSessions array and addCliSession method -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\session-metadata-store.ts`
**Spec Reference**: implementation-plan.md lines 667-739
**Pattern to Follow**: Existing `addStats()` method at lines 155-171, `save()` at lines 98-112

**Quality Requirements**:

- Import `CliSessionReference` from `@ptah-extension/shared`
- `cliSessions` field on `SessionMetadata` is optional and readonly
- `addCliSession()` deduplicates by `cliSessionId`
- If parent session not found, warn and return (do not throw)
- Log at info level when session linked successfully

**Implementation Details**:

1. Import `CliSessionReference`:

```typescript
import type { CliSessionReference } from '@ptah-extension/shared';
```

2. Add `cliSessions` to `SessionMetadata` (after `totalTokens` at line 67):

```typescript
/** CLI agent sessions linked to this parent session. Enables resume. */
readonly cliSessions?: readonly CliSessionReference[];
```

3. Add `addCliSession()` method (after `addStats` method, around line 172):

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

### Task 3.5: PtahAPI builder -- wire getActiveSessionId into agent namespace -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\ptah-api-builder.service.ts`
**Spec Reference**: implementation-plan.md lines 743-792
**Pattern to Follow**: Existing agent namespace construction at lines 231-234, existing DI injection pattern in constructor

**Quality Requirements**:

- Inject `SessionLifecycleManager` via `SDK_TOKENS.SDK_SESSION_LIFECYCLE_MANAGER`
- Pass `getActiveSessionId` callback that reads active sessions at spawn time (lazy, not at build time)
- Import `SDK_TOKENS` from `@ptah-extension/agent-sdk`
- Import `SessionLifecycleManager` type from `@ptah-extension/agent-sdk`

**Implementation Details**:

1. Add import for SDK_TOKENS:

```typescript
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
```

2. Add import for SessionLifecycleManager type. Check what's exported:

```typescript
import type { SessionLifecycleManager } from '@ptah-extension/agent-sdk';
```

Note: The developer must verify this type is exported from the barrel. If not, use inline type.

3. Add constructor parameter (after `cliDetectionService` at line 149):

```typescript
@inject(SDK_TOKENS.SDK_SESSION_LIFECYCLE_MANAGER)
private readonly sessionLifecycleManager: { getActiveSessionIds(): string[] }
```

Note: Use interface type to avoid hard dependency on the full class. The developer should check the actual export and use the narrowest type possible.

4. Update agent namespace construction (lines 231-234):

```typescript
agent: buildAgentNamespace({
  agentProcessManager: this.agentProcessManager,
  cliDetectionService: this.cliDetectionService,
  getActiveSessionId: () => {
    const ids = this.sessionLifecycleManager.getActiveSessionIds();
    return ids.length > 0 ? (ids[0] as string) : undefined;
  },
}),
```

---

**Batch 3 Verification**:

- All files exist at paths
- Build passes: `npx nx build vscode-lm-tools` and `npx nx build agent-sdk`
- code-logic-reviewer approved (no stubs/placeholders)
- parentSessionId injected at spawn time from active session
- resume_session_id parameter available in MCP tool
- CLI sessions persisted to session metadata with deduplication

---

## Batch 4: Frontend Display -- COMPLETE

**Developer**: frontend-developer
**Tasks**: 2 | **Dependencies**: Batch 1

### Task 4.1: Agent monitor store -- add parentSessionId and cliSessionId to MonitoredAgent -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\agent-monitor.store.ts`
**Spec Reference**: implementation-plan.md lines 802-875
**Pattern to Follow**: Existing `MonitoredAgent` interface at lines 20-32, existing `onAgentSpawned` at lines 108-134, existing `onAgentExited` at lines 165-180

**Quality Requirements**:

- `parentSessionId` is readonly (set once at spawn)
- `cliSessionId` is mutable (may arrive late via exit event)
- Signal-based immutable update pattern maintained (new Map spread)
- `onAgentExited` updates `cliSessionId` if info has one but existing agent doesn't

**Implementation Details**:

1. Add fields to `MonitoredAgent` (after `segments` at line 31):

```typescript
/** Parent Ptah Claude SDK session that spawned this agent */
readonly parentSessionId?: string;
/** CLI-native session ID (e.g., Gemini UUID). Enables resume. */
cliSessionId?: string;
```

2. Update `onAgentSpawned()` (lines 114-124) to capture the new fields:

```typescript
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
  parentSessionId: info.parentSessionId,
  cliSessionId: info.cliSessionId,
});
```

3. Update `onAgentExited()` (lines 171-176) to capture late-arriving cliSessionId:

```typescript
next.set(info.agentId, {
  ...agent,
  status: info.status,
  exitCode: info.exitCode,
  cliSessionId: info.cliSessionId ?? agent.cliSessionId,
});
```

---

### Task 4.2: Agent card component -- display session linkage info -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\agent-card.component.ts`
**Spec Reference**: implementation-plan.md lines 879-923
**Pattern to Follow**: Existing header button template at lines 68-103, existing imports at lines 22-23, line 61

**Quality Requirements**:

- CLI session ID badge shows truncated UUID (first 8 chars + ...)
- Badge uses ghost style with monospace font to match existing UI
- "Linked to parent session" is a subtle indicator, not prominent
- SlicePipe imported from @angular/common
- DaisyUI styling consistent with existing badges

**Implementation Details**:

1. Add `SlicePipe` to import from `@angular/common` (line 22):

```typescript
import { NgClass, SlicePipe } from '@angular/common';
```

2. Add `SlicePipe` to component imports array (line 61):

```typescript
imports: [LucideAngularModule, MarkdownModule, NgClass, SlicePipe],
```

3. Add CLI session ID badge in the header button, after the elapsed time span (after line 102):

```html
<!-- CLI Session ID badge (Gemini resume capability) -->
@if (agent().cliSessionId) {
<span class="badge badge-xs badge-ghost font-mono text-[9px] text-base-content/30 ml-1 flex-shrink-0" [title]="'CLI Session: ' + agent().cliSessionId"> {{ agent().cliSessionId! | slice:0:8 }}... </span>
}
```

4. Add "Linked to parent session" indicator in the task description area (modify lines 107-113):

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

**Batch 4 Verification**:

- All files exist at paths
- Build passes: `npx nx build chat`
- code-logic-reviewer approved (no stubs/placeholders)
- Agent card displays truncated CLI session ID badge
- "Linked to parent session" indicator visible when parentSessionId is set

---

## Batch 5: RPC Persistence Wiring -- COMPLETE

**Developer**: backend-developer
**Tasks**: 1 | **Dependencies**: Batch 3, Batch 4

### Task 5.1: RPC service -- persist CLI session references on agent exit -- COMPLETE

**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\rpc-method-registration.service.ts`
**Spec Reference**: implementation-plan.md lines 933-1014
**Pattern to Follow**: Existing `agent:exited` listener at lines 195-206, existing SDK_TOKENS import at line 28

**Quality Requirements**:

- Persistence is async and fire-and-forget (catch errors, do not block exit event forwarding)
- Only persist when BOTH `cliSessionId` AND `parentSessionId` are present
- Use `SDK_TOKENS.SDK_SESSION_METADATA_STORE` to resolve `SessionMetadataStore` from container
- Use inline type for `addCliSession` method (avoid importing SessionMetadataStore class)
- Wrap container.resolve in try/catch (SessionMetadataStore may not be available in all configurations)

**Implementation Details**:

1. SDK_TOKENS already imported at line 28 -- verify this includes `SDK_SESSION_METADATA_STORE`.

2. In the `agent:exited` listener (lines 195-206), add CLI session persistence after the broadcastMessage call:

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

3. Add a new private method `persistCliSessionReference` (after `setupAgentMonitorListeners`):

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
    }>(SDK_TOKENS.SDK_SESSION_METADATA_STORE);

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
    // SessionMetadataStore may not be available in all configurations
    this.logger.warn(
      '[RPC] Could not persist CLI session reference',
      error instanceof Error ? error : new Error(String(error))
    );
  }
}
```

---

**Batch 5 Verification**:

- All files exist at paths
- Build passes: `npx nx build ptah-extension-vscode`
- code-logic-reviewer approved (no stubs/placeholders)
- CLI session references persisted on agent exit when both IDs are present
- Errors caught and logged, no crash on missing metadata store

---

## Batch Dependency Graph

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

## Developer Prompts

### Batch 1 Developer Prompt (backend-developer)

```
You are assigned Batch 1 for TASK_2025_161.

**Task Folder**: D:\projects\ptah-extension\task-tracking\TASK_2025_161\

## Your Responsibilities

1. Read tasks.md - find Batch 1 (marked IN PROGRESS)
2. Read implementation-plan.md for context
3. Implement ALL tasks in Batch 1 IN ORDER (Task 1.1 then 1.2)
4. Write REAL code (NO stubs, placeholders, TODOs)
5. Update each task status in tasks.md: PENDING -> IMPLEMENTED
6. Return implementation report with file paths

## Files to Modify

- Task 1.1: D:\projects\ptah-extension\libs\shared\src\lib\types\agent-process.types.ts
  - Also export CliSessionReference from D:\projects\ptah-extension\libs\shared\src\index.ts
- Task 1.2: D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-adapters\cli-adapter.interface.ts

## CRITICAL RULES

- You do NOT create git commits (team-leader handles)
- Focus 100% on code quality
- All fields MUST be readonly and optional
- All new fields MUST have JSDoc comments
- Use exact code from implementation plan as reference, but verify against actual file contents
- After implementing, verify the changes compile (mentally check import paths)

## Return Format

BATCH 1 IMPLEMENTATION COMPLETE
- Files created/modified: [list paths]
- All tasks marked: IMPLEMENTED
- Ready for team-leader verification
```

### Batch 2 Developer Prompt (backend-developer)

```
You are assigned Batch 2 for TASK_2025_161.

**Task Folder**: D:\projects\ptah-extension\task-tracking\TASK_2025_161\

## Your Responsibilities

1. Read tasks.md - find Batch 2 (marked IN PROGRESS)
2. Read implementation-plan.md for context (esp. lines 228-503)
3. READ the Plan Validation Summary - note any risks/assumptions
4. Implement ALL tasks in Batch 2 IN ORDER (Task 2.1 then 2.2)
5. Write REAL code (NO stubs, placeholders, TODOs)
6. Handle edge cases listed in validation
7. Update each task status in tasks.md: PENDING -> IMPLEMENTED
8. Return implementation report with file paths

## Files to Modify

- Task 2.1: D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-adapters\gemini-cli.adapter.ts
- Task 2.2: D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\agent-process-manager.service.ts

## CRITICAL RULES

- You do NOT create git commits (team-leader handles)
- Focus 100% on code quality
- handleJsonLine() return type changes from void to string | undefined
- capturedSessionId is a CLOSURE variable, NOT class-level state
- Late-capture pattern in onSegment is critical for async session_id arrival
- Both doSpawnSdk AND doSpawn must set parentSessionId on AgentProcessInfo

## Validation Risks to Address

- session_id arrives async via init event -- use late-capture in onSegment
- getSessionId?.() must be optional chained for non-Gemini adapters

## Return Format

BATCH 2 IMPLEMENTATION COMPLETE
- Files created/modified: [list paths]
- All tasks marked: IMPLEMENTED
- Validation risks addressed: [list how each was handled]
- Ready for team-leader verification
```

### Batch 3 Developer Prompt (backend-developer)

```
You are assigned Batch 3 for TASK_2025_161.

**Task Folder**: D:\projects\ptah-extension\task-tracking\TASK_2025_161\

## Your Responsibilities

1. Read tasks.md - find Batch 3 (marked IN PROGRESS)
2. Read implementation-plan.md for context (esp. lines 507-792)
3. Implement ALL tasks in Batch 3 IN ORDER (3.1, 3.2, 3.3, 3.4, 3.5)
4. Write REAL code (NO stubs, placeholders, TODOs)
5. Update each task status in tasks.md: PENDING -> IMPLEMENTED
6. Return implementation report with file paths

## Files to Modify

- Task 3.1: D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\agent-namespace.builder.ts
- Task 3.2: D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-handlers\protocol-handlers.ts
- Task 3.3: D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-handlers\tool-description.builder.ts
- Task 3.4: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\session-metadata-store.ts
- Task 3.5: D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\ptah-api-builder.service.ts

## CRITICAL RULES

- You do NOT create git commits (team-leader handles)
- Focus 100% on code quality
- getActiveSessionId is a CALLBACK (not static value) -- resolved at spawn time
- parentSessionId is NOT passed as an MCP tool arg -- injected by buildAgentNamespace
- addCliSession() MUST deduplicate by cliSessionId
- SessionLifecycleManager injection in PtahAPIBuilder -- verify the type is exported from @ptah-extension/agent-sdk barrel

## Return Format

BATCH 3 IMPLEMENTATION COMPLETE
- Files created/modified: [list paths]
- All tasks marked: IMPLEMENTED
- Ready for team-leader verification
```

### Batch 4 Developer Prompt (frontend-developer)

```
You are assigned Batch 4 for TASK_2025_161.

**Task Folder**: D:\projects\ptah-extension\task-tracking\TASK_2025_161\

## Your Responsibilities

1. Read tasks.md - find Batch 4 (marked IN PROGRESS)
2. Read implementation-plan.md for context (esp. lines 796-923)
3. Implement ALL tasks in Batch 4 IN ORDER (Task 4.1 then 4.2)
4. Write REAL code (NO stubs, placeholders, TODOs)
5. Update each task status in tasks.md: PENDING -> IMPLEMENTED
6. Return implementation report with file paths

## Files to Modify

- Task 4.1: D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\agent-monitor.store.ts
- Task 4.2: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\agent-card.component.ts

## CRITICAL RULES

- You do NOT create git commits (team-leader handles)
- Focus 100% on code quality
- Signal-based immutable updates (new Map spread)
- SlicePipe must be imported from @angular/common AND added to component imports
- cliSessionId badge uses badge-xs badge-ghost font-mono text-[9px] styling
- parentSessionId indicator is subtle (text-[9px] text-base-content/30)
- OnPush change detection is already set -- signal updates handle re-rendering

## Return Format

BATCH 4 IMPLEMENTATION COMPLETE
- Files created/modified: [list paths]
- All tasks marked: IMPLEMENTED
- Ready for team-leader verification
```

### Batch 5 Developer Prompt (backend-developer)

```
You are assigned Batch 5 for TASK_2025_161.

**Task Folder**: D:\projects\ptah-extension\task-tracking\TASK_2025_161\

## Your Responsibilities

1. Read tasks.md - find Batch 5 (marked IN PROGRESS)
2. Read implementation-plan.md for context (esp. lines 927-1014)
3. Implement Task 5.1
4. Write REAL code (NO stubs, placeholders, TODOs)
5. Update task status in tasks.md: PENDING -> IMPLEMENTED
6. Return implementation report with file paths

## Files to Modify

- Task 5.1: D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\rpc-method-registration.service.ts

## CRITICAL RULES

- You do NOT create git commits (team-leader handles)
- Focus 100% on code quality
- Persistence is fire-and-forget (catch errors, do not block exit event forwarding)
- Only persist when BOTH cliSessionId AND parentSessionId are present
- Use inline type for addCliSession method (avoid importing SessionMetadataStore class)
- Wrap container.resolve in try/catch (may not be available)

## Return Format

BATCH 5 IMPLEMENTATION COMPLETE
- Files created/modified: [list paths]
- All tasks marked: IMPLEMENTED
- Ready for team-leader verification
```
