# Batch 23 report: `execute_code` cancel reaches `ptah.agent.waitFor` (G.8, Task 8.3 gap)

Status: COMPLETE (Tasks 23.1, 23.2). Not committed.

## Files changed (all under `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\libs\backend\vscode-lm-tools\src\lib\code-execution\`)

- `mcp-core\code-execution.engine.ts`
  - `CodeExecutionDependencies.signal?: AbortSignal` added.
  - New engine-owned `AsyncLocalStorage` and exported `getExecutionAbortSignal()`. The bridge binds the run's signal
    around every host `ptah.*` method call (`executionSignal.run(signal, () => method.apply(...))`), so namespaces read
    it without relying on async context surviving the vm realm.
  - New exported `EXECUTION_CANCELLED_MESSAGE`. An already-aborted signal refuses to start the run; an abort during the
    run rejects the race with that message (third racer next to the result and the timer).
  - Timer and abort listener are set up before the sandbox code starts (its synchronous part can already reach a ptah
    method and abort there). The run is started inside the `try`, so `finally` always clears the timeout timer (it
    used to stay armed for the full timeout after a fast result) and removes the abort listener.
- `mcp-core\protocol-dispatcher.ts` (`handleExecuteCodeCall`): passes `signal: getRequestAbortSignal()` into
  `executeCode` (Task 23.1).
- `namespace-builders\agent-namespace.builder.ts` (`waitFor`): forwards `getExecutionAbortSignal()` to
  `agentProcessManager.waitForAgents` as the 4th argument. When the result is `cancelled` and the lane has not exited,
  it throws `waitFor cancelled for agent <id>: the caller stopped waiting. The agent keeps running.` An exited lane is
  still returned (Task 23.2).
- Specs:
  - `mcp-core\code-execution.engine.spec.ts`: new `executeCode — abort signal` block (signal visible to a ptah method
    and unset outside the run; abort mid-run rejects with the cancel message; pre-aborted signal never calls the method).
  - `namespace-builders\agent-namespace.builder.spec.ts`: the two exact `waitForAgents` call assertions now include the
    4th `undefined` argument; new tests for cancelled-and-running (throws), cancelled-but-exited (returns the record),
    and an end-to-end run through `executeCode` where the wait receives the run's signal and ends `cancelled` on abort.
  - `mcp-core\protocol-dispatcher.spec.ts`: one test; an `execute_code` call with `_abortSignal` hands that signal to
    the ptah method it calls.

## Checks (cwd = worktree)

| Command | Exit |
| --- | --- |
| `npx nx run-many -t typecheck,lint -p vscode-lm-tools --parallel=2` | 0 |
| `npx nx run vscode-lm-tools:test --maxWorkers=2` | 0 (87 suites, 2852 tests passed) |
| `npx nx run di-lint:lint` | 0 |
| `npx nx run degradation-audit:lint` | 0 |

The first full test run hit a real bug in the change: the abort listener was attached after the code started, so an
abort during the synchronous part was missed. The ordering fix is the one described above. The same run also showed
several "Test suite failed to run" suites that then passed both alone and in the full rerun. That looks like load
from other agents on the machine, not this change. Jest prints a "worker failed to exit gracefully" warning on the
full run. The run still passes.

## Open notes

- The `waitFor` JSDoc in `code-execution\types.ts` (around 389-396) does not yet list the new cancellation throw. That
  file is not in this batch, so it was left unchanged.
- The design choice: the engine exposes the signal through its own `getExecutionAbortSignal()` instead of a new
  builder dependency. The builder dependency would need wiring in `ptah-api-builder.service.ts`, which is outside
  this batch.
- A cancelled `execute_code` now also logs `Code execution failed` through the injected Logger, the same path a
  timeout takes. A synchronous throw from the sandbox runner is now logged there too.
