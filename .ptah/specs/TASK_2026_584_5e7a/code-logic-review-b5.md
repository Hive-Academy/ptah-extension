VERDICT: APPROVED
Score: 9/10

# Code Logic Review — `TASK_2026_584_5e7a` (Batch 5)

## Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 9/10     |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate / Minor    | 1        |
| Failure modes found | 3        |

---

## Five logic questions

### 1. How does this fail silently?

- **Unregistered MCP root retention**: If `rootRegistrar.retainRoot` throws an unhandled error or returns `{ registered: false }` (`libs/backend/cli-agent-runtime/src/lib/session-children/session-spawner.service.ts:461-471`), the child session still starts and `subagentPtahTools` is recorded as `'unavailable'`. This is by design (optional capability degradation), but subagents spawned within the worktree will silently lack access to Ptah subagent tools.
- **Transcript reading before SDK id resolution**: When `read()` is invoked before `SessionIdResolved` arrives (`libs/backend/cli-agent-runtime/src/lib/session-children/session-spawner.service.ts:653-664`), it returns `{ available: false }` with `"No transcript yet"` instead of failing, accurately reflecting that the backing JSONL is not yet identifiable.

### 2. What user action produces unexpected behaviour?

- **User deleting or moving the worktree externally**: If a user manually removes the git worktree directory while a child session is active, subsequent git commands, tool operations, or file writes from the child will fail with disk errors. At turn settlement, `signalSessionChild` checks deliverables which will report missing.

### 3. What input data produces a wrong answer?

- **Invalid branch or baseRef argument**: If a branch name starts with `-` or contains invalid git ref characters (`libs/backend/cli-agent-runtime/src/lib/session-children/child-worktree.provisioner.ts:83-89`), git ref formatting fails fast and returns `invalid-arguments`.
- **Escaping task folder or deliverables**: If `taskFolder` is absolute or escapes the worktree root (`libs/backend/cli-agent-runtime/src/lib/session-children/session-spawner.service.ts:1326-1354`), `resolveChildPaths` fails fast and returns `invalid-arguments` before any git work or worktree creation occurs.

### 4. What happens when a dependency fails?

- **Host start throws or returns `{ started: false }`**: `session-spawner.service.ts:475-511` triggers a full reverse rollback: releasing the MCP root, releasing the unattended policy, removing the link in `SessionChildRegistry`, removing the git worktree (`git worktree remove --force`), and deleting the branch (`git branch -D`). Every rollback step is individually reported and wrapped so it never throws.
- **Parent session inactive at turn completion**: `notifier.signalSessionChild` returns `parent-session-not-active`. `recordDelivery` (`libs/backend/cli-agent-runtime/src/lib/session-children/session-spawner.service.ts:1032-1044`) stores the completion as `heldCompletion` (latest per child, replacing any older held completion) and marks it undelivered. The parent collects it via `takeHeldCompletions` upon its next request.

### 5. What is missing that the requirements never mentioned?

- **Handling early resolution of `SESSION_SPAWNER` before `CHILD_CHAT_SESSION_HOST` registration**: In a setup where `SESSION_SPAWNER` is resolved before `registerChatServices` has registered `CHILD_CHAT_SESSION_HOST`, the singleton captures `host = null` permanently. Today all three host bootstrap flows resolve `ChatRpcHandlers` after `registerChatServices`, but an explicit lazy lookup prevents potential race conditions in future container configurations or test environments.

---

## Numbered defects

### Defect 1 (MINOR) — Eager constructor injection of optional `CHILD_CHAT_SESSION_HOST` creates singleton boot-ordering hazard

- **File**: `libs/backend/cli-agent-runtime/src/lib/session-children/session-spawner.service.ts:192-195`
- **Scenario**: `SessionSpawnerService` is registered as `Lifecycle.Singleton` in `cli-agent-runtime/src/lib/di/register.ts:113`. Its constructor injects `@inject(CLI_AGENT_RUNTIME_TOKENS.CHILD_CHAT_SESSION_HOST, { isOptional: true }) private readonly host`. If any consumer or early initializer resolves `SESSION_SPAWNER` before `registerChatServices` has executed, `host` is resolved as `null` and locked in for the lifetime of the singleton.
- **Impact**: In the current codebase across all three production hosts (VS Code, Electron, and CLI engine), `registerChatServices` is called before `registerRpcSurface` resolves `ChatRpcHandlers` (the sole resolver today). However, this creates a latent ordering hazard for any future early subscriber or unit test that instantiates `SESSION_SPAWNER` prior to `registerChatServices`.
- **Fix**: Resolve `CHILD_CHAT_SESSION_HOST` lazily when `start()` runs (via `container.resolve` or an injected provider/factory), or document the strict host registration order requirement.

---

## Deviation rulings

### (1) Prompt ordering for tasks starting with "/"

- **Ruling**: **ACCEPTABLE**
- **Rationale**: In `composeSessionChildPrompt` (`session-child-contract.ts:83-85`), when `task` starts with `/`, the command (e.g. `/orchestrate TASK_...`) is prepended before the `<ptah-session-contract>` block. This is required because the Claude Agent SDK slash-command parser requires the slash command to be at the start of the prompt message to trigger command expansion. The contract is appended immediately after (`${trimmed}\n\n${contract}`), so the entire contract remains visible to the model.

### (2) `pendingPermission.deniesAt` is `'unbounded'` when `timeoutMs === undefined`

- **Ruling**: **ACCEPTABLE**
- **Rationale**: `SessionChildPendingPermission.deniesAt` is typed as `string` in `session-spawner.port.ts:42`. When `event.timeoutMs` is undefined, setting `deniesAt: 'unbounded'` fulfills the `string` type. In runtime operation, Batch 1's `UnattendedSessionPolicy` always enforces `denyWindowMs` (default 60,000 ms, clamped 0..600,000 ms) for child sessions, ensuring that prompts generated under policy have a finite timeout. The fallback gracefully handles any out-of-spec or synthetic lifecycle events.

### (3) `read()` truncates by characters (`tailKiB * 1024`), not bytes

- **Ruling**: **ACCEPTABLE**
- **Rationale**: `transcripts.read` already clamps byte reads via `tailBytes: tailKiB * TRANSCRIPT_BYTES_PER_OUTPUT_KIB`. Slicing the resulting markdown text string with `.slice(-limit)` (where `limit = tailKiB * 1024`) avoids truncating in the middle of multi-byte UTF-8 sequences, preventing string corruption while enforcing the output budget.

### (4) "ended while working" derived from turn-state phase `'generating'`

- **Ruling**: **ACCEPTABLE**
- **Rationale**: In `session-spawner.service.ts:871,911`, `phaseOf(child) === 'generating'` is used to detect whether the session was actively working when it ended or timed out. In the implementation plan (lines 641-642), the `generating` phase corresponds directly to status `working`. Thus, mapping `generating` to determine whether to push `failed` or `timeout` matches the plan specification.

### (5) Provisioner returns `worktree-failed` when target directory already exists

- **Ruling**: **ACCEPTABLE**
- **Rationale**: In `child-worktree.provisioner.ts:128-132`, if `worktreePath` already exists, the provisioner returns `{ ok: false, refusal: 'worktree-failed', detail: 'the worktree directory ... already exists' }`. `SessionSpawnRefusalCode` does not define a separate `directory-exists` refusal code. Returning `worktree-failed` with the descriptive explanation in `detail` accurately maps to the domain contract.

---

## Construction order

Analysis of `CHILD_CHAT_SESSION_HOST` and `SESSION_SPAWNER` across hosts:

1. **Resolution site of `SESSION_SPAWNER`**:
   - `libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.handlers.ts:135` (`@inject(CLI_AGENT_RUNTIME_TOKENS.SESSION_SPAWNER, { isOptional: true })`).
2. **Timing in VS Code** (`apps/ptah-extension-vscode`):
   - `phase-2-libraries.ts:201`: `registerCliAgentRuntimeServices(container)` registers `SESSION_SPAWNER`.
   - `phase-3-handlers.ts:62`: `registerChatServices(container)` registers `CHILD_CHAT_SESSION_HOST`.
   - `activation/bootstrap.ts:158`: `registerRpcSurface(container)` resolves `ChatRpcHandlers`, which resolves `SESSION_SPAWNER`.
   - _Status_: Safe. `registerChatServices` runs strictly before `ChatRpcHandlers` is resolved.
3. **Timing in Electron** (`apps/ptah-electron`):
   - `phase-2-libraries.ts:287`: `registerCliAgentRuntimeServices(container)` registers `SESSION_SPAWNER`.
   - `phase-4-handlers.ts:89`: `registerChatServices(container)` registers `CHILD_CHAT_SESSION_HOST`.
   - `activation/wire-runtime.ts:325`: `registerRpcSurface(container)` resolves `ChatRpcHandlers`.
   - _Status_: Safe. `registerChatServices` runs strictly before `ChatRpcHandlers` is resolved.
4. **Timing in CLI engine** (`libs/backend/cli-engine`):
   - `container.ts:688`: `registerCliAgentRuntimeServices(container)` registers `SESSION_SPAWNER`.
   - `container.ts:892`: `registerChatServices(container)` registers `CHILD_CHAT_SESSION_HOST`.
   - `container.ts:901`: `registerRpcSurface(container)` resolves `ChatRpcHandlers`.
   - _Status_: Safe. `registerChatServices` runs strictly before `ChatRpcHandlers` is resolved.

_Verdict_: No active boot failure in current wiring. However, because `SessionSpawnerService` is a singleton capturing `this.host` in its constructor, resolving the host lazily at `start()` time is recommended to make the service robust against future wiring reorders or isolated test setups.

---

## Task 5.6 follow-ups

| Item                                                                                                                                                                                                                               | Status       | Verification Evidence                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **F1** `chat:agent-sessions` rejects non-object params (`42`, `"some/path"`, `null`) with `RpcUserError('params must be an object', 'INVALID_PARAMS')`; `undefined` and `{}` return all live sessions                              | **RESOLVED** | `libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.handlers.ts:333-338`; covered by spec cases in `chat-rpc.handlers.spec.ts:455-475`.                                                                     |
| **F2** `startAgentChildSession` checks `isAuthorizedWorkspace(workspaceRoot)` before any launch work; returns `{ success: false, error: 'Access denied: workspace root is not inside an open folder.' }`; `startSession` unchanged | **RESOLVED** | `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:604-613`; spec verified in `chat-session-agent-child.spec.ts:373-388` proving `startChatSession` and collaborators are never called. |
| **F3** `child-chat-session-host.adapter.ts:86`: `// degradation-audit:` marker added                                                                                                                                               | **RESOLVED** | `libs/backend/rpc-handlers/src/lib/chat/session/child-chat-session-host.adapter.ts:87-89` contains `// degradation-audit: optional-capability - a failed broadcast degrades to a headless start...`.         |

---

## Failure modes

### 1. Host start failure after partial provisioning

- **Trigger**: `host.startChildSession` rejects or returns `{ started: false }`.
- **Symptom**: Child session fails to start; caller receives `session-start-failed`.
- **Evidence**: `libs/backend/cli-agent-runtime/src/lib/session-children/session-spawner.service.ts:475-511`.
- **Current handling**: Executes reverse rollback: `release-mcp-root`, `release-policy`, `remove-link`, `remove-worktree`, `delete-branch`. Reports array of completed/failed steps to caller. Slot is released.
- **Recommendation**: Current handling is complete and correct.

### 2. Parent session inactive at completion push

- **Trigger**: Child completes settled turn while parent session is inactive or terminated.
- **Symptom**: `signalSessionChild` returns `parent-session-not-active`.
- **Evidence**: `libs/backend/cli-agent-runtime/src/lib/session-children/session-spawner.service.ts:1032-1044`.
- **Current handling**: Child record stores completion in `heldCompletion` (latest replaces older). Does not discard or throw. Handed to parent upon next `takeHeldCompletions`.
- **Recommendation**: Current handling is complete and correct.

### 3. Child process ends prematurely

- **Trigger**: Child chat session ends outside spawner (stop button, error, or unhandled exit).
- **Symptom**: `onSessionEnd` callback fires.
- **Evidence**: `libs/backend/cli-agent-runtime/src/lib/session-children/session-spawner.service.ts:866-904`.
- **Current handling**: Arms a 30-second grace timer. If child re-registers (e.g. slash command reload), grace is cancelled. If grace expires without re-registration, marks child ended and releases slot, policy, and MCP root.
- **Recommendation**: Current handling is complete and correct.

---

## Data flow

1. **Guard & Reserve**: `start()` calls `guardStart()` checking host, adapter, caller UUID & liveness, child depth, MCP port, and claims synchronous reservation via `registry.reserveSlot` (**OK**).
2. **Workspace & Paths**: Resolves workspace root within open folders, checks `taskFolder` and deliverables inside future worktree (**OK**).
3. **Git Worktree Provisioning**: `ChildWorktreeProvisioner.create` validates ref format, branch existence, commit sha, and adds worktree using argument arrays via `execGit` (**OK**).
4. **Policy & MCP Registration**: Registers unattended policy and MCP retained root before invoking host start (**OK**).
5. **Host Start**: Calls `host.startChildSession` which broadcasts `agentSession:opened` to webview, runs `startAgentChildSession`, and begins event streaming (**OK**).
6. **Observation & Settle**: Listens on adapter turn events, checks for background tasks and running lanes, pushes or holds settled completion envelopes (**OK**).
7. **Cleanup**: Releases timers, policies, and MCP roots on stop, timeout, or grace expiry (**OK**).

---

## Requirements fulfilment

| Requirement                                                 | Status   | Gap  |
| ----------------------------------------------------------- | -------- | ---- |
| Synchronous slot reservation before first await             | COMPLETE | None |
| Full reverse rollback on host failure                       | COMPLETE | None |
| Settle rules (dedupe, background tasks, running lanes)      | COMPLETE | None |
| Ownership by parent tab id or SDK id                        | COMPLETE | None |
| Parent end never terminates children                        | COMPLETE | None |
| Held completion latest per child                            | COMPLETE | None |
| 30s child grace timer on session end                        | COMPLETE | None |
| `dispose()` synchronous, idempotent, releases all resources | COMPLETE | None |
| Provisioner git argument arrays & path containment          | COMPLETE | None |
| Task 5.6 follow-ups (F1, F2, F3)                            | COMPLETE | None |

---

## Edge cases

| Case                                          | Handled | How                                                                                    | Concern |
| --------------------------------------------- | ------- | -------------------------------------------------------------------------------------- | ------- |
| Two concurrent starts against cap 1           | YES     | Synchronous `reserveSlot` before first await                                           | None    |
| Parent tab reloaded under new tab id          | YES     | Ownership checks parent tab ID and parent SDK session ID via `SessionLifecycleManager` | None    |
| Repeated turn ended event with same timestamp | YES     | Deduped via `runtime.lastSettleTimestamp`                                              | None    |
| Turn ended with background tasks running      | YES     | Defers completion push; status derives `waiting`                                       | None    |
| Worktree path casing mismatch on Windows      | YES     | `retainRoot` and `releaseRoot` receive identical `worktreePath` string                 | None    |
| Stop called multiple times                    | YES     | Idempotent; status remains `stopped`                                                   | None    |

---

## Verdict

- Recommendation: **APPROVE**
- Confidence: **HIGH**
- Top risk: Eager singleton injection of `CHILD_CHAT_SESSION_HOST` in `SessionSpawnerService` could capture `null` if DI registration ordering changes in future updates.
- What a robust implementation would add: Lazy resolution of `CHILD_CHAT_SESSION_HOST` at `start()` invocation time.
