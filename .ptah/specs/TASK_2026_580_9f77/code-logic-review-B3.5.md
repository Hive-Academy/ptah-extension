VERDICT: APPROVED
Score: 9.5/10

# Code Logic Review — `TASK_2026_580_9f77` Batch B3.5

## Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 9.5/10   |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 0        |
| Failure modes found | 4        |

## Five logic questions

### 1. How does this fail silently?

It does not fail silently.

- In [protocol-dispatcher.ts:2347-2362](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts#L2347-L2362), whether `result.ok` is true or false, the tool returns formatted text via `createToolSuccessResponse`. Refusals (`result.ok === false`) are rendered explicitly as `Not linked (<code>): <message>`, exactly matching the refusal patterns of task tools (`ptah_task_create`, `ptah_task_update`, etc. at [protocol-dispatcher.ts:2284-2306](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts#L2284-L2306)), so the LLM agent receives actionable diagnostic feedback rather than a protocol-level crash.
- On success, [session-organization-tools.ts:63-68](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/session-organization-tools.ts#L63-L68) explicitly states: `"Link recorded for this session (${result.sessionId}): task ${result.taskId}, role ${result.role}. The task folder is not checked; a missing task shows as missing in the UI."` This prevents the agent from assuming the task was validated to exist on disk.

### 2. What user action produces unexpected behaviour?

- An agent attempting to pass a spoofed or explicit `sessionId` argument (e.g. `{ taskId: 'TASK_1', sessionId: 'other-session' }`) has the request rejected immediately with `Not linked (invalid-args): unrecognized_keys` because `SessionLinkTaskArgsSchema` in [session-organization-namespace.builder.ts:66-72](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/session-organization-namespace.builder.ts#L66-L72) enforces `.strict()`. The caller is resolved exclusively from the MCP transport context.
- An agent invoking the tool on VS Code (where SQLite is absent) receives `Not linked (organization-unavailable): Session organization is not available on this host.`, per D5/D12.
- An agent invoking the tool before the chat session's SDK session ID is assigned by the lifecycle manager receives `Not linked (unattributed-caller): The calling session has no SDK session id yet, so the link cannot be attributed. Retry after the session has started.`.

### 3. What input data produces a wrong answer?

- An invalid `role` (not `'primary'` or `'related'`) or missing `taskId` produces an explicit `invalid-args` refusal via Zod validation, never a malformed record.
- A non-existent task ID that conforms to the single-segment regex (e.g. `TASK_9999_999_dead`) is accepted by the recorder, but this is intended by design (L11/D12): the link is recorded per-user in SQLite, and missing tasks are flagged in the UI upon presentation.

### 4. What happens when a dependency fails?

- If the underlying session-organization recorder throws (e.g. SQLite database locked `SQLITE_BUSY`), the error is trapped in [session-organization-namespace.builder.ts:153-159](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/session-organization-namespace.builder.ts#L153-L159) and returned as `error: 'link-failed'`.
- In [protocol-dispatcher.ts:2348-2356](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts#L2348-L2356), the dispatcher logs the underlying error message to `logger.warn('[MCP] ptah_session_link_task: the recorder threw', 'CodeExecutionMCP', { message: result.message })` inside `runObserver()`.
- The agent is returned sanitised, fixed text: `Not linked (link-failed): The link could not be recorded because the session-organization store failed. Retry later.` (defined in [session-organization-tools.ts:53-54](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/session-organization-tools.ts#L53-L54)), ensuring internal database paths or errors are not leaked to LLM context.

### 5. What is missing that the requirements never mentioned?

- The overview count in [system-namespace.builders.ts:50](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/system-namespace.builders.ts#L50) still states `Ptah IDE Access - 22 Namespaces:`, but line 62 added `SESSION ORGANIZATION: ptah.sessionOrganization.*`, bringing the listed namespaces to 23. This is a harmless doc nit.

---

## Failure modes

### FM-1: Database write failure / SQLite error in recorder

- Trigger: SQLite lock, filesystem read-only, or corrupted database when `recorder.linkTask` is executed.
- Symptom: Call fails gracefully with fixed user-facing message, full error details logged.
- Evidence: [session-organization-namespace.builder.ts:153-159](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/session-organization-namespace.builder.ts#L153-L159), [protocol-dispatcher.ts:2348-2356](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts#L2348-L2356), [session-organization-tools.ts:53-54](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/session-organization-tools.ts#L53-L54).
- Current handling: Namespace catches error, returns `error: 'link-failed'`. Dispatcher logs `logger.warn` via `runObserver()`. Output formatter masks internal details and emits `LINK_FAILED_TEXT`.
- Recommendation: Current handling is exemplary and secure.

### FM-2: Host lacking session organization store (e.g. VS Code)

- Trigger: Host environment does not register or inject `ISessionOrganizationRecorder`.
- Symptom: Tool returns refusal `Not linked (organization-unavailable): Session organization is not available on this host.`.
- Evidence: [session-organization-namespace.builder.ts:123-130](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/session-organization-namespace.builder.ts#L123-L130).
- Current handling: `deps.getRecorder()` returns undefined, resulting in `organization-unavailable` error.
- Recommendation: Correct per D5/D12.

### FM-3: Unattributed caller / Early invocation

- Trigger: MCP request lacks caller session context or tab cannot be mapped to SDK session ID.
- Symptom: Refusal `Not linked (unattributed-caller): The calling session has no SDK session id yet, so the link cannot be attributed. Retry after the session has started.`.
- Evidence: [session-organization-namespace.builder.ts:132-140](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/session-organization-namespace.builder.ts#L132-L140).
- Current handling: Checks `deps.resolveCallerSessionId()` and returns typed refusal.
- Recommendation: Correct; prevents orphaned or spoofed links.

### FM-4: Caller attempts to specify session ID or extra arguments

- Trigger: Tool call arguments include `sessionId` or unexpected keys.
- Symptom: Refusal `Not linked (invalid-args): ... Unrecognized key(s) in object ...`.
- Evidence: [session-organization-namespace.builder.ts:66-72](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/session-organization-namespace.builder.ts#L66-L72).
- Current handling: `safeParse` rejects unrecognized keys due to `.strict()`.
- Recommendation: Correct; prevents privilege escalation or caller spoofing.

---

## Numbered findings

### Finding 1: Stale namespace count in system help documentation

- Severity: Nit
- File: [libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/system-namespace.builders.ts:50](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/system-namespace.builders.ts#L50)
- Scenario: A user/agent invokes `ptah.help('overview')` and reads `Ptah IDE Access - 22 Namespaces:`, but 23 namespaces are listed below it after adding `SESSION ORGANIZATION`.
- Impact: Minor cosmetic inconsistency in help overview string; no logic or runtime effect.
- Fix: Update `Ptah IDE Access - 22 Namespaces:` to `Ptah IDE Access - 23 Namespaces:`.

---

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

None (beyond Finding 1 Nit).

---

## Analysis of specific review aspects

### (a) Caller resolution strictly from transport

- The dispatcher at [protocol-dispatcher.ts:2347](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts#L2347) delegates `args` directly to `ptahAPI.sessionOrganization.linkTask(args)`.
- In `linkTask`, caller identity is resolved entirely via `deps.resolveCallerSessionId()`, which reads from AsyncLocalStorage context (`getCallerSessionId()`).
- Any `sessionId` passed in `args` is rejected by Zod (`SessionLinkTaskArgsSchema.strict()`).
- [protocol-dispatcher.spec.ts:953-965](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.spec.ts#L953-L965) specifically verifies that passing `sessionId: 'someone-else'` results in `Not linked (invalid-args)` and `linkTask` on the recorder is not called.

### (b) Always-on placement & identical tool list across callers

- In [protocol-dispatcher.ts:423](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts#L423), `buildSessionLinkTaskTool()` is placed in `buildToolDefinitions` immediately after `buildTaskCheckTool()`.
- It has no capability gate or namespace toggle check, ensuring it is present for all callers.
- [mcp-contract.sweep.spec.ts:1725,1750](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-contract.sweep.spec.ts#L1725-L1750) tests confirm per-caller tool lists remain byte-identical across all caller kinds, with counts updated from 56 -> 57 (with IDE capabilities) and 53 -> 54 (without IDE capabilities).

### (c) Result formatting & error masking

- Refusals (`ok: false`) return standard tool responses (`createToolSuccessResponse`) formatted as `Not linked (<code>): <message>`, consistent with task specs routing.
- For `link-failed`, `result.message` is safely logged via `logger.warn` inside `runObserver()`, while the agent receives the sanitised static message `LINK_FAILED_TEXT`.
- Success text echoes the SDK session ID and explicitly disclaims checking task existence on disk.

### (d) Executor deviations

- `tool-result-budget.ts`: Unchanged. As documented in lines 71-76 of `tool-result-budget.ts`, only tools exceeding default bounds have overrides. `ptah_session_link_task` returns ~150 characters, far below the 8000-char / 2000-token default.
- `additionalProperties: false` removal from `inputSchema`: `MCPToolDefinition.inputSchema` type definition restricts properties to `type`, `properties`, and `required`. Adding `additionalProperties` would violate TypeScript checks. Backend argument validation is strictly enforced by Zod `.strict()`, and tool description warns against passing session ID. No capability or security is lost.
- "22 Namespaces" count: Documented under Finding 1 as a cosmetic nit.

### (e) MCP contract sweep

- `TOOL_DRIVERS.ptah_session_link_task` ([mcp-contract.sweep.spec.ts:849-864](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-contract.sweep.spec.ts#L849-L864)) injects an oversized string exceeding 280,000 characters, actively exercising the dispatcher's budget trimming and spooling paths.
- `DESCRIPTION_BUDGETS.ptah_session_link_task` is pinned to 585 (measured description is 522 characters).
- Pinned counts (57/54) are verified and accurately noted for merge coordination.
- No premature 584 lines were introduced (R-TL8 respected).

### (f) Dispatcher spec coverage & non-vacuity

- The 6 tests in [protocol-dispatcher.spec.ts:909-1011](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.spec.ts#L909-L1011) exercise:
  1. Always-on presence even when all namespace toggles are disabled.
  2. Success via caller resolved from context and verified against recorder args and response text.
  3. Rejection of explicit `sessionId` argument without calling recorder.
  4. Reporting `organization-unavailable` when recorder is null.
  5. Reporting `unattributed-caller` for missing or unknown caller tab ID.
  6. Logging recorder errors to `logger.warn` while returning sanitized text.
- None of these tests can pass vacuously; all make concrete assertions against mocks, logger calls, and exact output regexes.

---

## Data flow

1. Client sends `tools/call` for `ptah_session_link_task` with `{ taskId, role? }`. [OK]
2. Transport wraps call in `runWithMcpRequestContext({ callerSessionId: request._callerSessionId, ... })`. [OK]
3. `handleIndividualTool` matches `SESSION_LINK_TASK_TOOL_NAME` and invokes `ptahAPI.sessionOrganization.linkTask(args)`. [OK]
4. `SessionLinkTaskArgsSchema.safeParse` validates input (rejects extra keys or invalid formats). [OK]
5. `resolveCallerSessionId()` extracts tab ID from context and maps to SDK session ID. [OK]
6. `getRecorder()` resolves host recorder instance. [OK]
7. Recorder executes `recorder.linkTask({ sessionId, taskId, role, source: 'agent' })`. [OK]
8. On success: returns `{ ok: true, sessionId, taskId, role }`. Output formatted with confirmation and disclaimer. [OK]
9. On error: catches failure, logs raw error via `logger.warn` if `link-failed`, and returns sanitized `Not linked (<code>): <message>`. [OK]

---

## Requirements fulfilment

| Requirement                                            | Status   | Gap  |
| ------------------------------------------------------ | -------- | ---- |
| Always-on MCP tool definition `ptah_session_link_task` | COMPLETE | None |
| Strict caller resolution from transport only           | COMPLETE | None |
| Default role `'primary'`, demoting existing            | COMPLETE | None |
| Refusal returned as structured tool output             | COMPLETE | None |
| Raw recorder error logged and masked in tool output    | COMPLETE | None |
| Success text avoids claiming task exists on disk       | COMPLETE | None |
| Pinned tool count & description sweep update           | COMPLETE | None |
| Spec coverage across all error & success branches      | COMPLETE | None |

---

## Edge cases

| Case                                        | Handled | How                                        | Concern                                  |
| ------------------------------------------- | ------- | ------------------------------------------ | ---------------------------------------- |
| Spoofed `sessionId` in args                 | YES     | Zod `.strict()` returns `invalid-args`     | None                                     |
| Empty args `{}` or `null`                   | YES     | Zod validates required `taskId`            | None                                     |
| Non-existent task folder                    | YES     | Recorded; UI handles missing status        | Explicitly disclaimed in success message |
| Calling before SDK session ID assigned      | YES     | Returns `unattributed-caller` refusal      | None                                     |
| Invocation on host without SQLite (VS Code) | YES     | Returns `organization-unavailable` refusal | None                                     |
| Recorder throws SQLite error                | YES     | Trapped, logged to warn, masked to client  | None                                     |

---

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: None in Batch B3.5 scope.
- What a robust implementation would add: Trivial update of `system-namespace.builders.ts` overview count from 22 to 23 (Finding 1).
