VERDICT: APPROVED

Score: 10/10
Defect counts:

- Blocking: 0
- Serious: 0
- Moderate: 0
- Minor: 0

---

## Executive Summary

Batch 6 implements the MCP surface, `ptah_agent_report` fallback, and host shutdown hooks for child chat sessions (`TASK_2026_584`, Tasks 6.1–6.6).
All acceptance criteria, strict zod validation contracts, transport caller isolation guarantees, held-completion guarantees (including transcript tail ordering under budget cuts), shutdown lifecycle ordering, and lazy DI container lookup contracts are verified and confirmed with passing unit, contract, and audit suites.

---

## Detailed Logic Analysis & Evidence

### 1. Caller Session ID Isolation (Transport Only)

- **Contract**: The caller session ID must originate solely from the MCP HTTP transport (`/session/{id}` via `AsyncLocalStorage` and `getCallerSessionId()`), never from tool arguments or sandbox arguments (`execute_code`).
- **Evidence**:
  - `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/session-tool-args.schema.ts:32-74`: All 5 tool argument schemas (`SessionStartArgsSchema`, `SessionSendArgsSchema`, `SessionStatusArgsSchema`, `SessionReadArgsSchema`, `SessionStopArgsSchema`) enforce `.strict()`. No schema declares `callerSessionId` or `parentSessionId`. Any attempt by a caller to pass a caller id in tool arguments is rejected with Zod validation failure (`invalid ptah_session_* arguments`).
  - `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/session-namespace.builder.ts:37-40, 97-137`: `SessionStartInput` explicitly omits `callerSessionId` (`Omit<SessionChildStartRequest, 'callerSessionId'>`). Every namespace method derives the caller through `caller = () => deps.getCallerSessionId()`. Neither tools nor `execute_code` can override or supply the caller ID.
  - `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.ts:895-901`: Wires `buildSessionNamespace` passing `getCallerSessionId` from `mcp-request-context.ts`.
  - `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.spec.ts:7575-7603`: Verified with tests ensuring caller is extracted from context and caller keys in arguments are rejected with `isError: true`.

### 2. Byte-Identical Tool Definitions

- **Contract**: The tool definitions in `tools/list` must be deterministic, static, and byte-identical regardless of caller session, agent ID, or workspace root.
- **Evidence**:
  - `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/session-tools.ts:44-51, 58-134`: `inputSchemaOf` uses `z.toJSONSchema` and strips `$schema`, ensuring valid Draft-7 schema. No runtime caller, workspace, or host values are interpolated into descriptions or schemas.
  - `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts:457-462`: The 5 session tools are registered in the static `agent` tool group (under `!disabled.has('agent')`).
  - `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.spec.ts:7553-7573`: Explicitly asserts `tools/list` serialization identity across `{}`, `{ _callerSessionId: ... }`, `{ _callerAgentId: ... }`, `{ _callerWorkspaceRoot: ... }`.
  - `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-contract.sweep.spec.ts:1777-1830`: Pinned total served tool count is 61 (58 without IDE capabilities), verified across all caller kinds in the matrix sweep.

### 3. Held Completions Preservation & Deliberate Ordering in `ptah_session_read`

- **Contract**: Any completions produced by child sessions while the caller was inactive must be appended to all `ptah_session_*` responses (including errors). In `ptah_session_read`, held completions must precede the transcript so that budget cuts truncate only the transcript tail and never drop held completion envelopes.
- **Evidence**:
  - `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/session-tool-handlers.ts:403-428`: `handleSessionToolCall` invokes `takeHeld(session, logger)` regardless of whether `runTool` succeeded or threw, and regardless of whether the reply is an error or normal output.
  - `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/session-tool-handlers.ts:418-423`: In `ptah_session_read`, the reply is constructed as `joinBlocks(body.head, held, body.transcript)`.
  - `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-result-budget.ts:110-114`: The five session tools are marked `'preformatted'` in `TOOL_CONTENT_HINTS`. Under `applyToolResultBudget`, `'preformatted'` tools bypass the markdown-outline reducer and apply only `fitWindow` prefix cutting from the end of the text. Because `held` sits before `body.transcript`, an over-budget transcript is truncated at its tail, ensuring held completion envelopes are preserved without risk of budget truncation.
  - `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/session-tool-handlers.ts:381-395`: Swallowing catch in `takeHeld` logs at `warn` with `// degradation-audit: reported` marker and returns `[]`, ensuring failure to take held completions never aborts the tool's main reply.
  - `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/session-tools.spec.ts:432-441`: Explicit test asserts `reply.text.indexOf(HELD.text) < reply.text.indexOf('TRANSCRIPT')`.

### 4. `ptah_agent_report` Fallback Precedence & Normalization

- **Contract**: Agent ID from transport URL (`/agent/{id}`) takes precedence; if absent, calling chat session ID from transport URL (`/session/{id}`) maps to `{ childSessionId, message, summary }`; if neither is present (including whitespace-only strings), falls back to `unattributed-caller`.
- **Evidence**:
  - `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts:1223-1240`:
    - `callerAgentId = getCallerAgentId()`.
    - `callerSessionId = getCallerSessionId()?.trim() || undefined`.
    - If `callerAgentId !== undefined`: `{ agentId: callerAgentId, message, summary }`.
    - Else if `callerSessionId !== undefined`: `{ childSessionId: callerSessionId, message, summary }`.
    - Else returns success response with `{ delivered: false, reason: 'unattributed-caller' }`.
  - `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/agent-namespace.builder.ts:334-347` & `types.ts:351`: `AgentNamespace.report` parameter type is widened to `AgentReportInput`.
  - `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.spec.ts:7424-7478`: Tests verify precedence of URL agent id, routing of child session id, and fallback to `unattributed-caller` when session id is whitespace-only.

### 5. Shutdown Order & Non-Fatal Disposal

- **Contract**: `SessionSpawnerService.dispose()` must execute before `agentProcessManager.disposeAll()` (or `reapAll()`) in both VS Code extension and Electron desktop hosts. Must be non-fatal. In Electron, handle must be eagerly captured in `wire-runtime.ts` and verified in `main.quit-path.spec.ts`.
- **Evidence**:
  - `apps/ptah-extension-vscode/src/main.ts:144-165`: In `deactivate()`, `SESSION_SPAWNER.dispose()` is executed inside a non-fatal `try/catch` with `// degradation-audit: reported` warning, before resolving `TOKENS.AGENT_PROCESS_MANAGER` and awaiting `disposeAll()`.
  - `apps/ptah-electron/src/activation/wire-runtime.ts:613-634`: Eagerly captures `sessionSpawner` in `coordinator.refs.sessionSpawner` during startup with non-fatal try/catch and `// degradation-audit: reported` warning.
  - `apps/ptah-electron/src/activation/shutdown.ts:231-245`: `nonFatal('Session spawner dispose', () => refs.sessionSpawner?.dispose())` is placed before `nonFatal('Agent process manager reap', ...)`.
  - `apps/ptah-electron/src/main.quit-path.spec.ts:220-221, 304`: `EXPECTED_LIFO_ORDER` verifies `'sessionSpawner'` precedes `'agentProcessManager'`.

### 6. Lazy Lookups via Optional `PLATFORM_TOKENS.DI_CONTAINER` (Task 6.6)

- **Contract**: Avoid construction-order hazard where spawner constructor would capture `null` if resolved before `registerChatServices`. Spawner resolves `CHILD_CHAT_SESSION_HOST` at `start()` time. `PtahAPIBuilder` resolves `SESSION_SPAWNER` per call.
- **Evidence**:
  - `libs/backend/cli-agent-runtime/src/lib/session-children/session-spawner.service.ts:196-197, 242-246, 1298-1311`:
    - Constructor injects `@inject(PLATFORM_TOKENS.DI_CONTAINER, { isOptional: true }) private readonly container: DependencyContainer | null = null`.
    - In `start()`, invokes `this.lookupHost()`.
    - In `lookupHost()`, checks `this.container?.isRegistered(token, true)` and wraps `this.container.resolve` in `try/catch` with `// degradation-audit: reported` logging. Missing container, unregistered token, or resolution error causes `start()` to refuse with `chat-runtime-unavailable`.
  - `libs/backend/cli-agent-runtime/src/lib/session-children/session-spawner.service.spec.ts:296-355`: Comprehensive unit tests verify that host registered after spawner construction is reached at `start()`, unregistered host returns `chat-runtime-unavailable`, missing container returns `chat-runtime-unavailable`, and throwing host resolution logs and returns `chat-runtime-unavailable`.
  - `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.ts:500-501, 895-901, 1062-1067`: `PtahAPIBuilder` injects `@inject(PLATFORM_TOKENS.DI_CONTAINER, { isOptional: true }) container`. `resolveSessionSpawner()` checks `container?.isRegistered(token, true)` on every call.
  - `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/session-namespace.builder.ts:92-96`: `requireSpawner()` calls `deps.getSpawner()` dynamically on every method call (`start`, `send`, `status`, `read`, `stop`), throwing `SESSION_SPAWNER_UNAVAILABLE_MESSAGE` if absent.
  - `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/session-namespace.builder.spec.ts:121-127, 130-154`: Tests verify lazy lookup on every call and named error rejection when spawner is absent.

### 7. Strict Zod Validation, Error Mapping & Degradation Audit

- **Contract**: Zod validation failure -> `isError: true`; operational refusals -> plain text; `session-start-failed`/`worktree-failed` -> `isError: true` with markdown rollback table; catch blocks annotated with `degradation-audit`.
- **Evidence**:
  - `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/session-tool-handlers.ts:57-61, 167-192, 303-313`:
    - `invalid()` returns `{ isError: true, text: 'Error: invalid ... arguments: ...' }`.
    - `START_FAULTS` (`session-start-failed`, `worktree-failed`) produce `{ isError: true, text: ... }` containing formatted Markdown table of rollback steps.
    - Other start refusals produce `{ isError: false, text: ... }` with refusal code and detail.
    - `sessionSendReply`, `sessionStatusReply`, `sessionReadReply`, `sessionStopReply` return `{ isError: false, text: ... }` for operational replies and lookup refusals.
  - Degradation audit annotations:
    - `wire-runtime.ts:625`: `// degradation-audit: reported - logged at warn; a null ref means will-quit has no child sessions to end.`
    - `main.ts:151`: `// degradation-audit: reported - logged at warn; shutdown continues and the agent reap below still runs.`
    - `session-spawner.service.ts:1305`: `// degradation-audit: reported - logged below; the start is refused as chat-runtime-unavailable...`
    - `session-tool-handlers.ts:387`: `// degradation-audit: reported - logged at warn; the tool's own reply is still returned, and nothing was marked delivered by a call that threw.`
    - `session-tool-handlers.ts:408`: `// degradation-audit: reported - the failure is returned to the agent as an isError result naming the cause...`

---

## Verification Results

1. `npx nx run-many -t lint -p di-lint,degradation-audit`:
   - `di-lint`: PASSED (no unregistered `@inject` tokens; Task 6.6 resolved previous B5 warning).
   - `degradation-audit`: PASSED.
2. `npx nx test @ptah-extension/vscode-lm-tools --testFile=session-tools.spec.ts`:
   - 40/40 tests PASSED.
3. `npx nx test @ptah-extension/vscode-lm-tools --testFile=session-namespace.builder.spec.ts`:
   - 10/10 tests PASSED.
4. `npx nx test @ptah-extension/cli-agent-runtime --testFile=session-spawner.service.spec.ts`:
   - 57/57 tests PASSED (including all 4 lazy chat host lookup tests).
