VERDICT: APPROVED
Score: 9.5/10

# Code Logic Review — `TASK_2026_580_9f77` (Batch C0.1)

## Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 9.5/10   |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 0        |
| Failure modes found | 0        |

Batch C0.1 implements Step 1 of the AC8 board-start session-to-task link chain (plan Component 10 :901-902, :930-931; D11 :142; L10 :1507). It extends `ChatPromptRequest` with optional `taskId?: string` in `@ptah-extension/core` and wires `TaskStartService.launchPrompt` to pass `taskId` on every task launch.

The implementation is surgical, type-safe, fully backward-compatible, adheres strictly to architectural boundaries (`tasks-ui` does not import `chat`), preserves the busy/re-entrancy guard, and passes the task ID faithfully through the `AppStateManager` signal bridge.

---

## Numbered Findings

### Finding 1 (Nit) — Test assertion coverage on `isolate=true` and explicit orchestrator target

- **Severity**: Nit
- **File**: `libs/frontend/tasks-ui/src/lib/services/task-start.service.spec.ts:115-133,177-188`
- **Evidence**:
  ```ts
  it('isolate=true: appends the worktree-isolation directive and makes NO addWorktree RPC call', async () => { ... });
  it('treats an explicit orchestrator target exactly like no target', async () => { ... });
  ```
- **Context**: The plain launch, specialist target, and CLI lane target tests all assert `expect(lastPromptRequest?.taskId).toBe('TASK_2026_xxx')`. The `isolate=true` test and the explicit orchestrator target test verify prompt contents and command formatting, but do not explicitly assert `lastPromptRequest?.taskId`.
- **Impact**: None; `launchPrompt` is identical across all branching. Adding the assertion would provide 100% variant assertion symmetry.
- **Fix**: Add `expect(lastPromptRequest?.taskId).toBe('TASK_2026_201');` and `expect(lastPromptRequest?.taskId).toBe('TASK_2026_208');` to those test cases.

### Finding 2 (Nit) — Immutability modifier on `ChatPromptRequest.taskId`

- **Severity**: Nit
- **File**: `libs/frontend/core/src/lib/services/app-state.service.ts:184`
- **Evidence**:
  ```ts
  export interface ChatPromptRequest {
    prompt: string;
    sessionName?: string;
    taskId?: string;
    resolve?: (result: { success: boolean; error?: string }) => void;
  }
  ```
- **Context**: `taskId` is declared mutable. While consistent with existing properties on `ChatPromptRequest` (`prompt`, `sessionName`), marking `readonly taskId?: string` (or all payload fields) prevents accidental mutation across asynchronous consumers.
- **Impact**: None in current usage.

---

## Five Logic Questions

### 1. How does this fail silently?

- In `TaskStartService.launchPrompt`, `new Promise` wraps `requestChatPrompt`. If a consumer never settles `request.resolve`, the launch promise would stall. However, the existing chat consumer `TaskPromptBridgeService.consume` wraps all logic in `try ... catch ... finally` and unconditionally invokes `request.resolve?.(outcome)` in `finally`.
- In Batch C0.1 itself, `taskId` is purely additive. If `taskId` is not set on a prompt request from non-task origins, it is `undefined`. When C0.2 lands, `TaskPromptBridgeService` checks `when request.taskId is set`, guaranteeing that non-task prompts never create a primary session link.

### 2. What user action produces unexpected behaviour?

- **Rapid double-click on "Start"**: Guarded by `this._busyTaskId()`. The second click is rejected immediately while the first launch is in flight.
- **Clicking "Start" on Task B while Task A is launching**: The busy guard is scoped to the service instance (`_busyTaskId = signal<string | null>(null)`), so initiating a second task while one is launching is safely ignored until the prompt is prefilled.
- **User closes or reloads composer before sending**: The task ID will be held in memory in C0.2 (cap 20) awaiting `session:id-resolved`. If the user reloads before sending, the in-memory entry is discarded as specified by Decision D11 and Constraint L10.

### 3. What input data produces a wrong answer?

- A malformed or blank `taskId` string. However, `start(taskId)` is invoked directly by board components (`TaskCardComponent`, `TaskDetailComponent`) with the validated `task.id` from the store/specs. Downstream, RPC handlers in Batch A4.2 validate task ID against the task ID regex.

### 4. What happens when a dependency fails?

- If `TaskPromptContextService.buildContextBlock` throws or rejects, `TaskStartService.start` catches the exception in `catch (error: unknown)`, formats an error message onto `this._error`, and resets `this._busyTaskId.set(null)` in `finally`.
- If the chat consumer resolves with `{ success: false, error }`, `TaskStartService` reports the error in `this._error` and frees `_busyTaskId`.

### 5. What is missing that the requirements never mentioned?

- Nothing within the scope of Batch C0.1. C0.1 only provides the producer and data carrier (`ChatPromptRequest.taskId`). Batch C0.2 implements the consumer (`TaskPromptBridgeService.consume` calling `boardTaskLinkCapture.expect(tabId, request.taskId)`).

---

## Failure Modes

No active failure modes found.

- Scope examined: All 4 changed files plus consumers in `libs/frontend/chat` and barrel exports in `libs/frontend/core`.
- Diagnostics: 0 errors in the four files under review.

---

## Blocking Issues

None.

---

## Serious Issues

None.

---

## Moderate and Minor Issues

See Numbered Findings (2 Nits).

---

## Data Flow

1. Board user clicks "Start" on a task card / detail modal.
2. `TaskStartService.start(taskId, isolate, targetAgent)` checks `_busyTaskId()` -> [OK: re-entrancy protected].
3. `TaskStartService.buildPrompt(taskId, isolate, targetAgent)` formats orchestrator command, isolation directive if requested, and appends context block -> [OK].
4. `TaskStartService.launchPrompt(taskId, isolate, targetAgent)` creates `ChatPromptRequest` with `{ prompt, sessionName: taskId, taskId, resolve }` -> [OK: `taskId` strictly matches board task id].
5. `AppStateManager.requestChatPrompt(request)` publishes `request` directly to `_chatPromptRequest.set(request)` without transformation or dropping properties -> [OK: reference preserved].
6. (Future Batch C0.2): `TaskPromptBridgeService` effect wakes, reads `request.taskId`, and registers `(tabId -> taskId)` -> [OK: prepared for C0.2 consumption].

---

## Requirements Fulfilment

| Requirement                                                                      | Status   | Gap  |
| -------------------------------------------------------------------------------- | -------- | ---- |
| Optional `taskId?: string` on `ChatPromptRequest` (`implementation-plan.md:901`) | COMPLETE | None |
| `TaskStartService.launchPrompt` sets `taskId` (`implementation-plan.md:902`)     | COMPLETE | None |
| AC8 board-start chain step 1 (`implementation-plan.md:930-931`)                  | COMPLETE | None |
| No `@ptah-extension/chat` import in `tasks-ui` (layering / NFR-11)               | COMPLETE | None |
| Existing producers/callers compile & behave identically                          | COMPLETE | None |
| Unit tests verify `taskId` presence on launch variants                           | COMPLETE | None |

---

## Edge Cases

| Case                      | Handled | How                                                            | Concern |
| ------------------------- | ------- | -------------------------------------------------------------- | ------- |
| Non-task prompt request   | YES     | `taskId` is optional, `undefined` when omitted                 | None    |
| Specialist agent launch   | YES     | `start()` forwards `taskId` identically                        | None    |
| CLI lane launch           | YES     | `start()` forwards `taskId` identically                        | None    |
| Isolated worktree launch  | YES     | `start()` forwards `taskId` identically                        | None    |
| Re-entrant / rapid launch | YES     | `_busyTaskId` guard prevents overlapping launches              | None    |
| Bridge consumption error  | YES     | `try...catch...finally` in consumer + caller handles rejection | None    |

---

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: None for Batch C0.1. (The consumer in Batch C0.2 must register the link before the session id resolves).
- What a robust implementation would add: Optional assertion additions for `isolate=true` and `orchestrator` target test cases as noted in Finding 1.
