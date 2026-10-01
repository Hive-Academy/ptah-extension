VERDICT: APPROVED
SCORE: 8/10

# Code Logic Review — `TASK_2026_584_5e7a` (Batch 4)

## Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 8/10     |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 0        |
| Minor issues        | 2        |
| Failure modes found | 0        |

Score justification: The implementation precisely satisfies the Batch 4 plan requirements and Revision 1 error-broadcast contracts. Extraction of `launchSdkSession` preserves full behavioral parity for `startSession`, the `startAgentChildSession` logic correctly enforces workspace boundaries and auto-edit permissions, `ChildChatSessionHostAdapter` implements the announce-then-start order and one-shot `CHAT_ERROR` error broadcast on start failure, and `chat:agent-sessions` RPC is wired with optional spawner injection. Two minor input-validation edge cases separate this from the 9-10 band.

## Findings Table

| ID  | Severity | File:Line                                                                                                                                                                         | Finding                                                                                                                                                                                                                                                                       | Recommended Fix                                                                                                                                                                                   |
| --- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | MINOR    | [chat-rpc.handlers.ts:331-337](file:///D:/projects/ptah-extension/.claude-worktrees/task-584/libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.handlers.ts#L331-L337)           | Non-object primitive params (e.g. `params: 42` or `params: "some/path"`) in `chat:agent-sessions` evaluates `params?.workspaceRoot` to `undefined`, which silently falls through to returning all live sessions rather than rejecting invalid params with `INVALID_PARAMS`.   | Validate `if (params !== undefined && (typeof params !== 'object'                                                                                                                                 |     | params === null)) throw new RpcUserError('params must be an object', 'INVALID_PARAMS');`. |
| F2  | MINOR    | [chat-session.service.ts:603-617](file:///D:/projects/ptah-extension/.claude-worktrees/task-584/libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts#L603-L617) | `startAgentChildSession` validates that `worktreePath` is an open folder and safe path, but does not explicitly check `workspaceRoot` for open-folder authorization (`isAuthorizedWorkspace(workspaceRoot, this.workspaceProvider)`), relying on upstream spawner validation. | Add defense-in-depth check `if (!isAuthorizedWorkspace(workspaceRoot, this.workspaceProvider)) return { success: false, error: 'Access denied: workspace root is not inside an open folder.' };`. |

## Five logic questions

### 1. How does this fail silently?

No material silent failures exist:

- In `ChildChatSessionHostAdapter.announce` ([child-chat-session-host.adapter.ts:79-96](file:///D:/projects/ptah-extension/.claude-worktrees/task-584/libs/backend/rpc-handlers/src/lib/chat/session/child-chat-session-host.adapter.ts#L79-L96)), if broadcasting `MESSAGE_TYPES.AGENT_SESSION_OPENED` fails (e.g., in a headless CLI context or if the webview is closed), `uiAnnounced` is set to `false`. The session start still proceeds and reports `{ started: true, uiAnnounced: false }`, allowing late tab adoption upon subsequent webview initialization.
- In `ChildChatSessionHostAdapter.reportStartFailure` ([child-chat-session-host.adapter.ts:102-121](file:///D:/projects/ptah-extension/.claude-worktrees/task-584/libs/backend/rpc-handlers/src/lib/chat/session/child-chat-session-host.adapter.ts#L102-L121)), a failure to broadcast `CHAT_ERROR` is logged as a warning; the adapter still returns `{ started: false, error }` to the spawner, ensuring the spawner triggers worktree/slot cleanup.
- In `chat-rpc.handlers.ts` ([chat-rpc.handlers.ts:338](file:///D:/projects/ptah-extension/.claude-worktrees/task-584/libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.handlers.ts#L338)), if `sessionSpawner` is not registered in the host container, `chat:agent-sessions` returns `{ sessions: [] }`.

### 2. What user action produces unexpected behaviour?

- Reloading or closing the webview window precisely when a child session is starting:
  `announce` may fail or resolve just as the webview closes. The child session starts safely in the background. When the webview reloads, late tab adoption queries `chat:agent-sessions` to adopt all live child sessions for the current workspace root.
- Removing or closing the parent workspace folder while a child session start is dispatched:
  `isAuthorizedWorkspace(worktreePath, this.workspaceProvider)` ([chat-session.service.ts:603](file:///D:/projects/ptah-extension/.claude-worktrees/task-584/libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts#L603)) checks against open folders and returns `{ success: false, error: 'Access denied: worktree path is not inside an open folder.' }`, triggering tab error notification and rollback.

### 3. What input data produces a wrong answer?

- In `chat-rpc.handlers.ts` ([chat-rpc.handlers.ts:331-336](file:///D:/projects/ptah-extension/.claude-worktrees/task-584/libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.handlers.ts#L331-L336)), passing a non-object primitive (e.g. `42` or `"root"`) as `params` causes `params?.workspaceRoot` to evaluate to `undefined`. Rather than returning an `INVALID_PARAMS` error, it queries all live descriptors without workspace filtering.
- In `chat-session.service.ts` ([chat-session.service.ts:634](file:///D:/projects/ptah-extension/.claude-worktrees/task-584/libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts#L634)), passing an empty string for `model` (`model: ""`) is treated as falsy, defaulting to the global selected model settings.

### 4. What happens when a dependency fails?

- Webview broadcast failure: Caught in `announce` and `reportStartFailure`, logged, and does not crash the host process.
- SDK session startup failure: Caught in `ChatSessionService.startAgentChildSession` ([chat-session.service.ts:643-653](file:///D:/projects/ptah-extension/.claude-worktrees/task-584/libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts#L643-L653)), captured in Sentry under `ChatSessionService.startAgentChildSession`, and result-shaped as `{ success: false, error }`.
- Session spawner listing failure: Re-thrown to `runRpc`, logged to logger, and reported to Sentry under `ChatRpcHandlers.registerChatAgentSessions`.
- Code execution MCP offline (`getPort() === null`): Child starts with `mcpServerRunning = false` without throwing.

### 5. What is missing that the requirements never mentioned?

- Validation that the outer `params` argument in `chat:agent-sessions` is an object type before accessing `params?.workspaceRoot`.
- Defense-in-depth validation of `workspaceRoot` against `isAuthorizedWorkspace` in `startAgentChildSession`.

## Failure modes

No blocking or major failure modes found. The scope examined includes all 11 modified/created Batch 4 files across `shared` and `rpc-handlers`. Scoped tests, typechecks, and diagnostics are 100% clean.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

### F1: Primitive params in `chat:agent-sessions` bypasses validation

- File: [libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.handlers.ts:331-337](file:///D:/projects/ptah-extension/.claude-worktrees/task-584/libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.handlers.ts#L331-L337)
- Scenario: Client passes a primitive (e.g. number, boolean, string) as the params payload to `chat:agent-sessions`.
- Impact: Evaluates to `workspaceRoot = undefined`, returning unfiltered sessions rather than rejecting with `INVALID_PARAMS`.
- Fix: Add `if (params !== undefined && (typeof params !== 'object' || params === null)) throw new RpcUserError('params must be an object', 'INVALID_PARAMS');`.

### F2: `workspaceRoot` not explicitly checked in `startAgentChildSession`

- File: [libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:603-617](file:///D:/projects/ptah-extension/.claude-worktrees/task-584/libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts#L603-L617)
- Scenario: An internal caller passes an unauthorized or invalid `workspaceRoot` with an authorized `worktreePath`.
- Impact: Prompts and provider profiles would be resolved for an unauthorized path.
- Fix: Add `if (!isAuthorizedWorkspace(workspaceRoot, this.workspaceProvider)) return { success: false, error: 'Access denied: workspace root is not inside an open folder.' };`.

## Data flow

1. **Host child start dispatch**:
   - `ChildChatSessionHostAdapter.startChildSession(input)` receives `ChildChatSessionStartInput`. [OK]
   - `announce(input)` broadcasts `MESSAGE_TYPES.AGENT_SESSION_OPENED` with `input.descriptor` to webview. Catches exceptions and sets `uiAnnounced`. [OK]
   - `startAgentChildSession` called on `ChatSessionService`. [OK]
2. **Authorization and Safety**:
   - `isAuthorizedWorkspace(worktreePath)` checks if worktree is inside open folders. [OK]
   - `rejectIfUnsafeWorkspace(worktreePath)` checks for dangerous filesystem locations. [OK]
3. **Launch Execution**:
   - `launchSdkSession` resolves enhanced prompts, provider profile, and output styles for `workspaceRoot`. [OK]
   - Sets `mcpServerRunning` from `codeExecutionMcp.getPort() !== null`. [OK]
   - Sets `permissionLevel: 'auto-edit'`. [OK]
   - Calls `sdkAdapter.startChatSession`. [OK]
   - Connects `streamBroadcaster.streamEventsToWebview(tabId, stream, tabId)`. [OK]
4. **Error Handling**:
   - If start fails/throws and `uiAnnounced` is true: `reportStartFailure` broadcasts `MESSAGE_TYPES.CHAT_ERROR` for `tabId` to reset the webview tab. [OK]
   - Adapter returns `{ started: false, error }` to caller. [OK]
5. **Late Adoption RPC**:
   - `chat:agent-sessions` delegates to `sessionSpawner.listUiDescriptors(workspaceRoot)`. [OK]
   - Gracefully returns `{ sessions: [] }` if `sessionSpawner` is null. [OK]

## Requirements fulfilment

| Requirement                                                        | Status   | Gap                                                                                                                                                                                 |
| ------------------------------------------------------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Task 4.1: Shared message key, payload map, RPC types               | COMPLETE | None. `AGENT_SESSION_OPENED`, payload map, `chat:agent-sessions` in registry & method entries.                                                                                      |
| Task 4.2: `launchSdkSession` extraction + `startAgentChildSession` | COMPLETE | None. `startSession` behavior strictly preserved; child passes root identity, worktree projectPath, auto-edit, and port-based MCP.                                                  |
| Task 4.3: `ChildChatSessionHostAdapter` + DI registration          | COMPLETE | None. Implements `IChildChatSessionHost`, announce-then-start, single `CHAT_ERROR` on announced start failure. Registered under `CLI_AGENT_RUNTIME_TOKENS.CHILD_CHAT_SESSION_HOST`. |
| Task 4.4: `chat:agent-sessions` RPC                                | COMPLETE | None. Wired in `ChatRpcHandlers`, optional `sessionSpawner` injection.                                                                                                              |

Implicit requirements not addressed: None.

## Edge cases

| Case                             | Handled | How                                                                                  | Concern                                                |
| -------------------------------- | ------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| Broadcast throws on announcement | YES     | Caught in `announce`, logs warning, sets `uiAnnounced: false`, starts session anyway | None; tab adopted late via `chat:agent-sessions`.      |
| Start fails after announcement   | YES     | Sends single `CHAT_ERROR` with `tabId` and `sessionId: tabId`                        | None; resets webview tab state.                        |
| Start fails without announcement | YES     | Does NOT send `CHAT_ERROR`, returns `{ started: false, error }`                      | None; avoids phantom errors in webview.                |
| Broadcast of `CHAT_ERROR` throws | YES     | Caught and logged in `reportStartFailure`, returns `{ started: false, error }`       | None; error does not bubble to spawner.                |
| `startAgentChildSession` throws  | YES     | Result-shaped to `{ success: false, error }`, captured to Sentry                     | None.                                                  |
| `sessionSpawner` absent in host  | YES     | Optional injection defaults to `null`, returns `{ sessions: [] }`                    | None.                                                  |
| Worktree path outside workspace  | YES     | Refused with `Access denied: worktree path is not inside an open folder.`            | None.                                                  |
| Worktree path unsafe root        | YES     | Refused with `Cannot start a session in this folder...`                              | None.                                                  |
| Non-string `workspaceRoot` param | YES     | Throws `RpcUserError` with `INVALID_PARAMS`                                          | Primitive `params` falls through to all sessions (F1). |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: Race between fast first chunk delivery and late tab adoption if the push is missed, which is handled downstream by Batch 7 frontend adoption logic.
- What a robust implementation would add: Explicit validation for `params` being an object in `chat:agent-sessions`, and defense-in-depth authorization check for `workspaceRoot`.
