# Batch 21 report: `run_check` kill failure; stdio cancel Minors (G.3, G.8)

Executor: backend-developer. Worktree: `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g`. Not committed.

Verdict: Tasks 21.1 and 21.3 are done and pass their checks. Task 21.2 is NOT done because the fix needs files outside this batch (see Open notes).

## Files changed

- MODIFIED `libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\run-check.tool.ts`
- MODIFIED `libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\run-check.tool.spec.ts`
- MODIFIED `libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-stdio\stdio-mcp-server.service.ts`
- MODIFIED `libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-stdio\stdio-mcp-server.service.spec.ts`

## Task 21.1: a failed kill is reported and remembered (G.3 / B-1): DONE

- The default `killTree` is now `killTreeOrThrow(pid)`. It calls `killProcessTree(pid, 'SIGTERM', onError)` and rejects with the first error that `onError` reports. Before this change no `onError` was passed, so failures were swallowed. The `RunCheckDependencies.killTree` doc now states the contract: the promise rejects when the kill failed.
- `stop()` records `killFailure` when `killTree` rejects, then starts the same 10 s settle backstop as before. `RunResult.killFailed = { pid, reason }`.
- Reply verdicts (the old lines 321 and 325) now read `TIMED OUT after Ns; kill failed (pid N may still be running)` and `CANCELLED; kill failed (pid N may still be running)`. A kill that works still reads `the process tree was killed`. New summary input field: `killFailedPid`.
- The check's own log file gets `, tree kill of pid N failed: <reason>` on its closing line. `runCheck` has no logger; the per-run log file is its diagnostic channel.
- `liveChecks` now has two helpers, `register` and `unregister`, and each run tracks its own entry so that a reused pid's entry is never touched:
  - A `close` always unlists the pid, even if the run had already settled on the backstop.
  - If the run settles on the backstop after a failed kill and without a `close`, the pid stays listed with a bare retry (`retryKill`). On dispose, `killRunningChecks` retries the tree kill. A successful retry unlists the pid; a failed one keeps it listed. The retry never rejects, so `killRunningChecks` still does not throw.
- Specs:
  - `says a failed kill failed, keeps the pid listed, and dispose retries it`: the kill rejects, the process never closes, and the run settles at 10 s. The test checks the reply text, the log line, and that the pid is still listed. `killRunningChecks` then retries and the pid leaves.
  - `keeps a pid whose retry kill fails, and unlists it once the process closes`: the timeout path with a kill that always fails. The test checks the reply, that the pid survives a failed retry, and that a later `close` unlists it.

## Task 21.2: do not answer a cancelled stdio request: NOT DONE (needs files outside the batch)

- `StdioMcpServerService.handleToolsCall` returns `Promise<MCPResponse>`. The JSON-RPC response is written by `apps\ptah-cli\src\cli\jsonrpc\server.ts:205-206`, which always calls `encodeResponse` on whatever the handler returns, by way of `apps\ptah-cli\src\cli\commands\mcp-serve.ts:369-381`. That code reads `resp.error` and `resp.result` without a null guard.
- The server has no "send nothing" path. If the service returned `null` or a sentinel, then either:
  - ptah-cli's typecheck would fail, or
  - at runtime `resp.error` on `null` throws, and the server sends an InternalError response instead of nothing.
- So the service cannot suppress the reply alone. Two pieces need to change together, outside this batch:
  - `server.ts`: a way for a handler to say "no response", for example a `NO_RESPONSE` symbol that `dispatchRequest` checks before `send`.
  - `mcp-serve.ts` `tools/call`: return that symbol when the call was cancelled. The service can expose the fact by returning `null` from `handleToolsCall`, or through an `isCancelled(id)` check.
- The existing spec `stdio-mcp-server.service.spec.ts` "aborts the agent_wait whose id the peer cancels" asserts that the cancelled call still returns a `WAIT CANCELLED` result. It would change with the fix.
- Recommendation: a small follow-up batch that owns `server.ts` (+ spec), `mcp-serve.ts` (+ spec) and this service. Impact today is cosmetic (review B, FM6).

## Task 21.3: a duplicate in-flight id does not orphan a controller: DONE

- In `handleToolsCall`, before a controller is created: if `inFlightCalls` already holds `request.id`, the second call is refused. It gets a WARN through the injected Logger (`[StdioMcpServer] tools/call id already in flight`, `{ id, tool }`) and a JSON-RPC `-32600 Invalid Request` reply. The first call keeps its controller, so a later `notifications/cancelled` still reaches it.
- `mcp-serve.ts` already turns a non-`-32602` `resp.error` into a thrown error that carries `code`, so the peer receives a `-32600`-coded error. `server.ts` encodes thrown non-InvalidParams errors as InternalError (-32603) with this message.
- Once the first call has settled, the same id is accepted again: the `finally` block deletes the entry.
- Specs:
  - `refuses a second call that reuses an id in flight, and the cancel still reaches the first`
  - `accepts an id again once the call that used it has settled`

## Checks (run in the worktree)

| Command | Exit |
| --- | --- |
| `npx nx run-many -t typecheck,lint,test -p @ptah-extension/vscode-lm-tools --parallel=2 -- --maxWorkers=2` | 1: typecheck only, because my forwarded `--maxWorkers=2` reached `tsc` (TS5023 unknown option). lint passed, test passed. |
| `npx nx run @ptah-extension/vscode-lm-tools:typecheck --outputStyle=static` | 0 |
| `npx jest -c libs/backend/vscode-lm-tools/jest.config.ts --maxWorkers=2 run-check.tool.spec stdio-mcp-server.service.spec` | 0 (2 suites, 67 tests passed) |
| `npx nx run di-lint:lint --outputStyle=static` | 0 |
| `npx nx run degradation-audit:lint --outputStyle=static` | 0 |

The Nx Cloud 401 ("organization disabled") banner appears on every run. It does not affect the exit codes. No baseline PNGs were touched, and no TASK_2026_609_c495 files were touched.

## Open notes

- Task 21.2 is still open (above). It needs `server.ts` and `mcp-serve.ts` in ptah-cli.
- `killTreeOrThrow` (the default kill that turns `onError` into a rejection) has no direct unit test. Testing it means mocking `@ptah-extension/platform-core`, and the real end-to-end test in the same spec relies on the real reaper. The behaviour is pinned through injected rejecting `killTree`s.
- The structured result (`RunCheckStructuredResult`) does not carry the kill failure; only the reply text and the log do. The batch asked for the reply text only. A `killFailed` field would be additive if a consumer needs it.
- G.4 (Batch 29) owns the shutdown contract. After this batch, the retry entries for failed kills also run inside `killRunningChecks`, under whatever timeout that batch adds.
