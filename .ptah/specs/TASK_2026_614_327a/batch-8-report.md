# Batch 8 report: cancellable waits (E.3, S4-a M5)

Tasks 8.1 and 8.2 are done. Task 8.3 is not implemented: `execute_code` has no cancellation hook to forward (gap below).

## Changed files

- MODIFIED `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts`
  - `AgentWaitResult` has a new optional field, `cancelled?: boolean`. `waitForAgents` always sets it. When it is absent, treat it as false: results built outside the manager, such as spec fixtures, stay valid.
  - `waitForAgents(agentIds, mode, timeoutMs, signal?: AbortSignal)`:
    - If the signal is already aborted on entry and the wait is not already satisfied, the call returns at once with `cancelled: true`. No listener or timer is attached.
    - An abort during the wait sets `cancelled` and runs the shared `finish`. `finish` removes the `agent:exited` listener and the abort listener and clears the timer.
    - The abort listener is attached `{ once: true }` and is removed on every exit path (exit event, timer, abort).
    - The entries are built exactly as on a timeout. `timedOut` stays false, so the two outcomes stay distinct.
    - Without a signal, nothing changes.
- MODIFIED `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.wait.spec.ts`: three new tests.
  - Abort mid-wait: the wait resolves without any timer advance, the result is `cancelled` and partial (exited lane plus running lane), the `agent:exited` listener count returns to the baseline, the `abort` listener count (`events.getEventListeners`) is 0, and no timer is left.
  - A signal already aborted on entry returns at once.
  - The abort listener is removed when the lanes end first.
- MODIFIED `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-wait.tool.ts`
  - `AgentWaitDependencies.waitForAgents` takes an optional 4th `signal` parameter, and `AgentWaitDependencies` has a new optional `signal`. `runAgentWait` passes `deps.signal` to `waitForAgents`.
  - The reply header for a cancelled result reads `WAIT CANCELLED after <d> waiting for <mode>: X of N known lane(s) ended, M still running. Partial result; the lanes themselves were not stopped.`
- MODIFIED `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-wait.tool.spec.ts`
  - The existing "passes ids..." assertion now expects the 4th argument (`undefined`).
  - New test: the signal is forwarded, and a fired signal produces the cancelled summary (no "TIMED OUT", no output read for the running lane).

No caller passes a signal yet:
- `protocol-dispatcher.ts:1341` and `agent-tool.dispatcher.ts:740` have no request abort signal to forward. Batch 10 (Task 10.1) adds the signal to the MCP request context. Wiring it into these two `runAgentWait` deps is a one-line `signal:` addition per call site once that exists.

## Task 8.3: progress note (not implemented, exact gap)

`execute_code` has no cancellation or timeout hook that a namespace method could receive:

- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/code-execution.engine.ts:394-402`
  - The timeout is a bare `setTimeout` that rejects `timeoutPromise`, combined with `Promise.race([executionPromise, timeoutPromise])`.
  - There is no `AbortController`. When the race loses, the sandbox promise is abandoned, not cancelled.
  - The `finally` at `:415-424` clears only sandbox-created timers.
  - The race timer itself is never cleared or unref'd, and nothing notifies in-flight bridge calls.
- `code-execution.engine.ts:284` `createBridge(ptahAPI)` routes sandbox calls to the shared, long-lived `ptahAPI` object. It has no per-run context, so `agent-namespace.builder.ts:476-505` (`waitFor`) cannot tell which `execute_code` run called it.
- `protocol-dispatcher.ts:3634-3655` (`handleExecuteCode`) clamps the timeout to 30 s and calls `executeCode(code, actualTimeout, { ptahAPI, logger })`. It has no signal to pass, and the MCP request context does not carry one either (Batch 10, Task 10.1).

What 8.3 needs (a design choice for the planner, not made here):

1. `executeCode` owns an `AbortController` per run and aborts it when the race timer fires and in `finally`.
2. That signal reaches `waitFor`/`waitForAgents` through one of two routes:
   - a per-run bridge context, for example an AsyncLocalStorage around `run(wrappedCode)`, which `agent-namespace.builder.ts` reads;
   - or a per-run `ptahAPI` view.
3. `waitFor` then calls `agentProcessManager.waitForAgents([id], 'all', timeoutMs, signal)`. The manager side (8.1) already supports this.

The `MAX_AGENT_WAIT_MS` default was not lowered, as the batch requires.

## Checks (run from the worktree root)

| Command | Exit |
| --- | --- |
| `npx nx run-many -t typecheck,lint,test -p cli-agent-runtime,vscode-lm-tools --parallel=2` | 0 (6/6 tasks succeeded, cache 0/6, so the tests ran fresh) |
| `npx nx run di-lint:lint` | 0 |
| `npx nx run degradation-audit:lint` | 0 (cache hit) |

The Nx Cloud 401 notice ("organization disabled") printed on stderr is unrelated to the checks and does not change the exit codes.

## Out of scope, not touched

- In `code-execution.engine.ts:394-399`, the `execute_code` race timer is never cleared after a successful run. Each call keeps a timer of up to 30 s alive. This belongs with the 8.3 follow-up.
