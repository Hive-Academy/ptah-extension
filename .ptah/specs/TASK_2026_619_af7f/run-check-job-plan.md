# Implementation Plan - TASK_2026_619 follow-up: `ptah_run_check` as a job over HTTP

All paths are relative to `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\vscode-lm-tools\src\lib\code-execution\`.

## Inputs and constraints

- Requirements used: the launch prompt (the problem is measured: the HTTP client aborts after about 60 s) and root `CLAUDE.md` (one heavy check at a time).
- Missing decision-critical input: none. The product questions are listed at the end, each with a recommendation.

## Codebase evidence

| Evidence | Location | Implication |
| --- | --- | --- |
| The HTTP reply is a single `res.end(JSON)` after `onMCPRequest` resolves. Abort fires on `close` when `!writableFinished`. | `mcp-http/http-server.handler.ts:327-333, 411-418` | A long tool cannot stream. A client timeout looks the same as a user cancel. |
| The HTTP `ptah_run_check` passes `signal: getRequestAbortSignal()` into `runCheck`. | `mcp-core/protocol-dispatcher.ts:1401-1431` | Any check longer than about 60 s is killed and its verdict is lost. |
| `runCheck(args, deps)` is pure over its deps: `signal`, `workspaceRoot`, `now`, and so on. It resolves a `RunCheckOutcome` with `structured.verdict` set to passed, failed, timed_out, cancelled or not_run. | `mcp-core/run-check.tool.ts:98-143, 191-304` | A job can own the promise and its own `AbortController`. `runCheck` needs almost no change. |
| `liveChecks` and `killRunningChecks()` stop every live tree by pid, through each run's own stop path. | `run-check.tool.ts:409-431` | Host dispose already kills job-owned runs. No new dispose hook is needed. |
| The log path comes from `openLog` inside `runCheck`, under `.ptah/tmp/checks`. | `run-check.tool.ts:228-233, 762` | The "running" reply needs the log path, so a small `onLogOpened` hook is needed. |
| `HTTP_MAX_AGENT_WAIT_SEC = 45`, `WAIT_SUMMARY_MAX_CHARS = 4000`. The run-check schema is `.strict()`. | `mcp-core/wait-tools-args.schema.ts:17, 30, 78-100` | Reuse the 45 s cap and the 4000-char budget. |
| Agent-wait precedent: the dispatcher clamps to 45 s and passes `cappedFromTimeoutSec`. The builder takes `{ transport }` and adds an HTTP-only sentence. | `protocol-dispatcher.ts:1372-1399`, `agent-wait.tool.ts:72-123` | Use the same transport-aware builder shape for run_check. |
| Parity spec: the stdio and HTTP run_check schemas and descriptions must be identical. The advertised keys must equal `RunCheckArgsSchema.shape`. | `mcp-core/agent-spawn-surface-parity.spec.ts:292-340` | That spec must be updated to an agent_wait-style branch, which is intended. |
| `resolveRunCheckRoot` is the caller's declared root only, with no fallback. Identity comes only from the URL (`_callerSessionId`, `_callerAgentId`, `_callerWorkspaceRoot`). | `protocol-dispatcher.ts:3469-3499`, `http-server.handler.ts:394-411`, `mcp-request-context.ts:84-102` | Build the job owner key from transport-owned identity, never from arguments. |
| Stdio `run_check` blocks on the peer's `_abortSignal`. | `mcp-stdio/agent-tool.dispatcher.ts:819-856`, `mcp-stdio/tool-builders.ts:125` | Stdio has no 60 s limit, so it stays unchanged. |

## Architecture decision

**Chosen approach: a hybrid, HTTP-only job model with a separate collect tool.**

- HTTP `ptah_run_check` starts a **job** that is detached from the request. It then waits on that job for at most `HTTP_MAX_AGENT_WAIT_SEC` (45 s).
  - If the check finishes in time, the reply is exactly today's reply. Fast lint runs see no change.
  - If not, it returns `RUNNING`, the `jobId`, the elapsed time and the log path. `structured.verdict` is `'running'` and `structured.jobId` is set.
- A new HTTP tool `ptah_run_check_wait { jobId, timeoutSec?, cancel? }` waits up to 45 s per call.
  - It returns either the final `runCheck` reply, or a short `RUNNING` partial that is safe to repeat.
  - `cancel: true` aborts the job and returns the `cancelled` verdict.
- A request abort (a client timeout or ESC) ends **only the wait**. The job keeps running up to its own `timeoutSec`, and the user cancels it explicitly.
- Stdio `run_check` is unchanged: it still blocks, and the peer's cancel still kills the run.

Options compared:

- **New `ptah_run_check_wait` (chosen).**
  - The `ptah_run_check` input schema is untouched, so existing callers and the strict zod object stay valid.
  - Collecting is idempotent, while starting is not. Separate tools let each carry correct `idempotentHint` annotations.
  - It mirrors the `ptah_agent_wait` "repeat while running" pattern that agents already follow.
  - Cost: one more tool in the `agent` group.
- **Reuse `ptah_agent_wait` (rejected).**
  - Its contract is `AgentProcessManager.waitForAgents` over agent ids (`agent-wait.tool.ts:48-70`), with per-lane deliverables and a different reply format.
  - Mixing two id spaces and two reply formats would couple run-check to the cli-agent-runtime boundary.
- **A `jobId` argument on `ptah_run_check` (rejected).**
  - It turns the strict object into a union in which either `project` and `targets` are required, or `jobId` is.
  - The advertised `required: ['project','targets']` breaks, and so does the "keys equal schema shape" parity test.
  - One tool would mix a non-idempotent start with an idempotent collect.
- **Pure start/collect on HTTP, with no 45 s inline wait (rejected).**
  - Every check would cost two round trips, including a 10 s lint.
  - The hybrid keeps today's single-call behaviour for short checks.

Effect on existing code:

- The HTTP `RUN_CHECK_TOOL_NAME` case is rewritten to go through the job registry.
- `runCheck` gains one optional hook.
- Stdio, `killRunningChecks` and `resolveRunCheckRoot` are left alone.

Assumption: "about 60 s" is the client limit, and 45 s leaves enough margin. This is measured for agent_wait in 13i, and the same constant is reused.

## Component specifications

### 1. Run-check job registry (CREATE `mcp-core/run-check-jobs.ts`)

**Purpose:** own the in-memory job lifecycle for one host process.

**Job record:**
- `id`: `crypto.randomUUID()`
- `ownerKey`
- `args`
- `root`
- `startedAt`
- `controller: AbortController`
- `done: Promise<RunCheckOutcome>`
- `outcome?`, `finishedAt?`, `logPath?`

**Owner key:**
- It is `canonicalRoot | sessionId ?? '' | agentId ?? ''`.
- Every part comes from transport-owned context (`getCallerWorkspaceRoot`, `getCallerSessionId`, `getCallerAgentId`) and from `resolveRunCheckRoot`'s result.
- A lookup with a different owner key returns the same "unknown job id" text as an id that does not exist. This leaves no existence oracle across workspaces or sessions.

**API:**
- `start(args, root, ownerKey, run)` returns `{ job } | { busy }`.
- `get(id, ownerKey)`
- `waitFor(job, ms, signal)` resolves on the outcome, the timeout, or the abort, whichever comes first. The timer and the listener are always released.
- `cancel(job)`

**Concurrency:**
- At most **one running job per host**.
- A `start` while a job runs is answered as follows:
  - **Same owner and same project and targets:** the call attaches and returns the existing `jobId`. A retry after a dropped reply is therefore safe.
  - **Same owner, different check:** rejected as busy, naming its own `jobId`, project, targets and elapsed time.
  - **Different owner:** rejected as busy with no id, project or path. The reply says only "another check is running on this host, started N s ago".
- A blocking stdio run in the same process also counts as busy (check `runningCheckPids().length > 0`).
- Assumption: stdio normally runs in a separate CLI process. The implementer confirms where `StdioMcpServerService` is hosted.

**Expiry:**
- A finished job is kept for 15 min after `finishedAt`, and collecting it is idempotent within that window.
- At most 16 finished records are kept, and the oldest is evicted first.
- Sweeping is lazy, on every `start`, `get` and `wait`. There is **no timer**.
- A running job is bounded by its own `timeoutSec`: `runCheck` kills it at `timeoutSec`.

**Dispose:** nothing new. `killRunningChecks()` stops the job's tree through `liveChecks`, `done` settles as `cancelled`, and the record then expires.

**Failure behaviour:**
- If `run` rejects, the record stores an `isError` outcome built from the message, so `done` never rejects.
- The finished-record cap bounds memory.

**Verification seam:** `run-check-jobs.spec.ts`, with a fake `run`, a fake clock and Jest fake timers.

### 2. `runCheck` log hook (MODIFY `mcp-core/run-check.tool.ts`)

- Add an optional `onLogOpened?: (path: string | undefined) => void` to `RunCheckDependencies`. It is called right after `openLog` (around line 228).
- Add `'running'` to `RunCheckStructuredResult.verdict`, plus an optional `jobId`.
- `buildRunCheckTool({ transport })` adds an HTTP-only sentence to the existing description: "HTTP calls block at most 45 s; a longer check returns a jobId — collect it with ptah_run_check_wait." The text follows `agent-wait.tool.ts:75-78`.
- Add `formatRunCheckRunning({ jobId, project, targets, elapsedMs, logPath, cwd })`, at most 600 chars, well inside `WAIT_SUMMARY_MAX_CHARS`.
- **Verification seam:** extend `run-check.tool.spec.ts` to check that the hook fires with the log path, the transport descriptions, and the length of the running reply.

### 3. `ptah_run_check_wait` tool (CREATE `mcp-core/run-check-wait.tool.ts`; MODIFY `mcp-core/wait-tools-args.schema.ts`)

- **Schema:** `RunCheckWaitArgsSchema`, a `.strict()` object.
  - `jobId`: a uuid string, at most 128 chars.
  - `timeoutSec`: an int from 0 to `MAX_WAIT_TIMEOUT_SEC`, default 45, clamped to `HTTP_MAX_AGENT_WAIT_SEC` with `cappedFromTimeoutSec`, as agent_wait does.
  - `cancel`: optional boolean.
- **Builder:** `buildRunCheckWaitTool()` sets `destructiveHint: false` and `idempotentHint: true`.
- **Reply:**
  - Finished: the job's stored `outcome.text` and `structured`.
  - Running: `formatRunCheckRunning`. `isError` stays false; this is a partial result, as with agent_wait.
  - Unknown or expired id: `toolErrorResponse` with the text "unknown or expired job id; the full log stays under .ptah/tmp/checks".
- **Verification seam:** `run-check-wait.tool.spec.ts`.

### 4. HTTP dispatcher wiring (MODIFY `mcp-core/protocol-dispatcher.ts`)

- **`RUN_CHECK_TOOL_NAME` case:**
  1. Parse the arguments.
  2. Call `resolveRunCheckRoot`. It is unchanged, and any error it returns stays an error reply.
  3. Build the owner key.
  4. Call `registry.start` with `run = (signal, onLogOpened) => runCheck(args, { workspaceRoot, signal, onLogOpened })`. The signal is the **job's** controller, not the request's.
  5. Wait with `registry.waitFor(job, 45 s, getRequestAbortSignal())`.
  6. Reply with the final result or the running result, and attach the structured content.
- **New `ptah_run_check_wait` case:**
  1. Parse the arguments.
  2. Resolve the root. If that fails, reply "unknown job id"; never reveal anything.
  3. Look up the job with `get`, then optionally `cancel`, then `waitFor`.
- Register `buildRunCheckWaitTool()` next to `buildRunCheckTool({ transport: 'http' })` at around line 527, in the same `agent` group.
- **Verification seam:** `protocol-dispatcher.spec.ts` cases, with `runCheck` mocked.

### 5. Stdio surface (MODIFY `mcp-stdio/tool-builders.ts` only)

- Call `buildRunCheckTool({ transport: 'stdio' })`. The description stays the same as today, and the stdio handler is unchanged.
- Stdio does not get `run_check_wait`.

## Integration architecture

**Data flow:**
1. The HTTP POST arrives, and `resolveMcpCaller` reads the identity from the URL.
2. The dispatcher resolves the root and starts the registry job.
3. `runCheck` runs in the background (its pid is in `liveChecks`) and writes to the `.ptah/tmp/checks/<ts>-<project>.log` file.
4. The request waits for at most 45 s, and the reply is either the final result or the running result.
5. Later `ptah_run_check_wait` calls do get, then wait, then reply.

**State:** module-level and per process, like `liveChecks`. Nothing is persisted. A host restart loses the job ids, but the log files survive.

**Trust and validation:**
- Every argument is validated with zod at the boundary.
- The job id is never used in a path or a command.
- The owner key comes only from the URL.
- Cross-owner lookups and busy replies reveal nothing.

**Failure paths:**

| Event | Behaviour |
| --- | --- |
| Client abort during a wait | The wait ends and the job continues. |
| `cancel: true` | The job is aborted, and the reply carries the `cancelled` verdict after the tree kill settles (at most `KILL_SETTLE_MS`, 10 s). |
| Host dispose | `killRunningChecks` runs. |
| Kill failure | Existing behaviour: `killFailedPid` appears in the stored outcome. |

**Observability:**
- Every reply, running or final, carries the log path.
- The log already records the exit, cancel or timeout line (`run-check.tool.ts:250-254`).

## Tests to add

- **`run-check-jobs.spec.ts`:**
  - Start, then a finished result within the wait.
  - Start, then running after the wait, then the result is collected later.
  - A same-owner duplicate attaches.
  - A same-owner different check is rejected as busy, with its `jobId`.
  - A cross-owner start is rejected as busy, with no id or project in the text.
  - A cross-owner `get` returns the same text as an id that does not exist.
  - Expiry after 15 min, and FIFO eviction.
  - Cancel.
  - A request abort ends the wait without aborting the job.
  - No timers are left behind (`jest.getTimerCount()` is 0 after the wait).
- **`run-check-wait.tool.spec.ts`:**
  - Schema strictness.
  - The 45 s clamp, and the `cappedFromTimeoutSec` text.
  - Each reply stays within `WAIT_SUMMARY_MAX_CHARS`.
- **`protocol-dispatcher.spec.ts`:**
  - HTTP run_check returns a final reply when the check finishes in under 45 s, and a running reply plus `jobId` when it takes longer.
  - **Regression test:** a request abort no longer kills the tree. The fake `killTree` is not called.
  - The tools list contains `ptah_run_check_wait`.
- **`agent-spawn-surface-parity.spec.ts`:**
  - Give run_check the agent_wait-style branch: the HTTP description contains the 45 s sentence and the stdio one does not, and the schemas stay equal.
  - `ptah_run_check_wait` is HTTP-only.
- **`stdio-mcp-server.service.spec.ts`:** the existing run_check cancel and dispose cases must still pass, unchanged.
- **Verification:** `npx nx test vscode-lm-tools --parallel=1` and `npx nx typecheck vscode-lm-tools --parallel=1`, one at a time.

## Risks

1. **An orphaned job runs to its `timeoutSec` (up to 900 s) after the agent gives up.** It is bounded and killed on dispose, and the user can cancel it explicitly. This is decision Q2.
2. **The one-job cap blocks a second workspace for up to 15 min.** This is intended by `CLAUDE.md`, and the busy reply gives the elapsed time. This is decision Q3.
3. **Agents may not call the collect tool.** The running reply and the tool description name `ptah_run_check_wait` explicitly, and `structured.jobId` is machine-readable.
4. **`structured.verdict` gains `'running'`.** Any consumer that switches on verdict must handle it. Grep found no in-repo consumer outside the specs (an assumption; re-grep `verdict` in `libs/` and `apps/`).
5. **A tool-profile or tool-count snapshot might list the agent-group tools.** The implementer greps `ptah_agent_wait` in the specs and in `mcp-contract.sweep.spec.ts`, and adds the new tool wherever agent_wait is listed.

## Team-leader handoff

- **Executor:** backend-developer for all components. It is one library, and the components are file-disjoint apart from the dispatcher.
- **Complexity:** MEDIUM. There is a new lifecycle module, but `runCheck` and the kill paths are reused unchanged.
- **Order:** 1 and 2, then 3, then 4 and 5. 5 can run in parallel with 4.

**Files:**

| Change | Files |
| --- | --- |
| CREATE | `mcp-core/run-check-jobs.ts` and its spec; `mcp-core/run-check-wait.tool.ts` and its spec |
| MODIFY | `mcp-core/run-check.tool.ts` and its spec; `mcp-core/wait-tools-args.schema.ts`; `mcp-core/protocol-dispatcher.ts` and its spec; `mcp-stdio/tool-builders.ts`; `mcp-core/agent-spawn-surface-parity.spec.ts`; `src/index.ts`, only if the hosts need a new export (none are expected) |

## Product-contract decisions for the user

1. **Q1. Hybrid or pure start/collect on HTTP?** Recommended: the **hybrid**. It blocks for 45 s, then returns a `jobId`, so short checks stay one call.
2. **Q2. Should a client abort or ESC during a wait kill the check?** Recommended: **no**. It ends only the wait, because the 60 s client timeout is indistinguishable from a user cancel. Stopping needs `cancel: true`.
3. **Q3. When a check is already running on the host: reject or queue?** Recommended: **reject with a busy reply**, and attach when the owner and check are the same. A queue hides wait time and needs its own timeout rules.
4. **Q4. Should collection be a new tool or an argument?** Recommended: a **new `ptah_run_check_wait`**, with `cancel` folded in rather than a separate stop tool.
5. **Q5. How long should a finished result be kept?** Recommended: **15 min, collectable more than once, at most 16 records**. After that, only the log file remains.
6. **Q6. Should stdio get job mode too?** Recommended: **no**. Stdio has no 60 s limit, so it keeps blocking with no change.
