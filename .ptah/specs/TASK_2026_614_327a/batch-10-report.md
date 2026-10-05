# Batch 10 report: request abort plumbing (HTTP and stdio) and the dispose kill

Worktree: `D:/projects/ptah-extension/.claude-worktrees/task-614-d-e`. Tasks 10.1 and 10.2 are done. No git was run.

**No MCP SDK signal to reuse.** `@modelcontextprotocol/sdk` is not used anywhere in `vscode-lm-tools`. Both surfaces are hand-rolled JSON-RPC: `http-server.handler.ts` on `node:http`, and `apps/ptah-cli/src/cli/jsonrpc/server.ts` for stdio. There is no `extra.signal`, so the signal is built at each transport.

## Design

- **The request carries the signal.** `MCPRequest._abortSignal?: AbortSignal` is transport-owned, like the `_caller*` fields. The HTTP handler drops it from the body and sets it only from its own controller.
- **The context copies it.** `McpRequestContext.signal` takes the request's signal, and `getRequestAbortSignal()` reads it back. `handleMCPRequest` copies `request._abortSignal` into the context for each `tools/call`.
- **Stdio stays out of the request context.** It binds no AsyncLocalStorage store on purpose (`isMcpRequestInFlight` relies on that), so the stdio dispatcher reads `request._abortSignal` directly.

## Changed files

All `libs/...` paths are under `libs/backend/vscode-lm-tools/src/`.

| File | Change |
| --- | --- |
| `lib/code-execution/mcp-core/types/mcp-protocol.types.ts` | 10.1: adds `MCPRequest._abortSignal?: AbortSignal` (transport-owned). |
| `lib/code-execution/mcp-core/mcp-request-context.ts` | 10.1: adds `McpRequestContext.signal?` and `getRequestAbortSignal()`. |
| `lib/code-execution/mcp-core/mcp-request-context.spec.ts` | 10.1: the signal is isolated between concurrent calls, and is undefined outside a call or when the transport gave none. |
| `lib/code-execution/mcp-http/http-server.handler.ts` | 10.1: new `abortOnEarlyClose(res)`. It returns a signal that aborts on `res` `close` when `!res.writableFinished`, so a written reply never aborts. A body `_abortSignal` is stripped, and the signal is set on every request. The reply is skipped when `res.destroyed`. |
| `lib/code-execution/mcp-http/http-server.handler.spec.ts` | 10.1 regression, over a real `http` server on port 0. (1) The client destroys the socket mid-`run_check`: `killTree(5150)` is called and the verdict is `cancelled`. (2) Socket destroyed mid-`agent_wait`: the signal is aborted, `getEventListeners(signal,'abort')` is 0, and the reply reads "WAIT CANCELLED". (3) A written reply does not abort. (4) A body `_abortSignal` is ignored. |
| `lib/code-execution/mcp-core/protocol-dispatcher.ts` | 10.1: the context gets `signal: request._abortSignal`. `ptah_agent_wait` passes the signal through `waitForAgents` and `deps.signal`, and `ptah_run_check` passes `signal: getRequestAbortSignal()`. |
| `lib/code-execution/mcp-stdio/agent-tool.dispatcher.ts` | 10.1: `agent_wait` and `run_check` pass `request._abortSignal`. `agent_wait` structured content gains `cancelled`. |
| `lib/code-execution/mcp-stdio/stdio-mcp-server.service.ts` | 10.1: `handleToolsCall` holds one `AbortController` per wrapper call in `inFlightCalls` (keyed by JSON-RPC id, removed in `finally`) and passes its signal on the request. `handleCancelled` aborts a matching call; otherwise it falls through to the session-submit handler as before. 10.2: new `dispose()` aborts every call in flight and runs `await killRunningChecks()`, fail-open with one warn. |
| `lib/code-execution/mcp-stdio/stdio-mcp-server.service.spec.ts` | 10.1: a cancel naming the call's id aborts the `agent_wait` signal; the reply is "WAIT CANCELLED" with `cancelled: true`; the session-submit `cancel` is not called. A cancel naming another id leaves the call alone, and `dispose()` then aborts it. 10.2: `dispose()` with a live `run_check`: `killTree(6161)` is called, the verdict is `cancelled`, and the pid leaves `runningCheckPids()`. |
| `lib/code-execution/mcp-http/http-mcp-server.service.ts` | 10.2: `disposeAsync()` runs `await killRunningChecks()` before `stop()`. A failure is logged once at warn and teardown continues. |
| `lib/code-execution/mcp-http/http-mcp-server.service.spec.ts` | 10.2: `killRunningChecks` is mocked (`requireActual` plus override). Tests: the kill is called once and before `stopHttpServer`; a rejected kill gives exactly one warn, and `disposeAsync` still resolves and stops. |
| `lib/code-execution/types.ts` | `AgentNamespace.waitForAgents` gains an optional 4th `signal`. |
| `lib/code-execution/namespace-builders/agent-namespace.builder.ts` | Forwards `signal` to `AgentProcessManager.waitForAgents` (Batch 8 API). |
| `lib/code-execution/namespace-builders/agent-namespace.builder.spec.ts` | Existing assertion now expects a 4th `undefined`. New test: the signal is forwarded to the manager. |
| `lib/code-execution/mcp-core/agent-spawn-surface-parity.spec.ts` | Assertion updated for the 4th `undefined` arg and the new `cancelled: false` structured field. |
| `index.ts` | Exports `killRunningChecks` for the hosts. |
| `apps/ptah-cli/src/cli/jsonrpc/server.ts` | `RpcHandler` gets an optional 2nd arg `{ id }`. `dispatchRequest` passes the peer's JSON-RPC id. Additive: existing one-arg handlers are unchanged. |
| `apps/ptah-cli/src/cli/commands/mcp-serve.ts` | `tools/call` builds the `MCPRequest` with the peer's id (`envelope?.id ?? randomId()`). The drain calls `await stdioServer.dispose()` before `transport.stop()`. |
| `apps/ptah-cli/src/cli/commands/mcp-serve.spec.ts` | The fake stdio server gains `dispose`. |
| `apps/ptah-extension-vscode/src/main.ts` | `deactivate()` runs `await killRunningChecks()` before the agent reap, fail-open with one warn. |

## Checks (run from the worktree root)

| Command | Exit |
| --- | --- |
| `npx nx run-many -t typecheck,lint,test -p vscode-lm-tools --parallel=2` | 0 ("Successfully ran targets typecheck, lint, test") |
| `npx nx run-many -t typecheck -p ptah-extension-vscode,ptah-cli --parallel=2` | 0 |
| `npx nx run ptah-cli:test` | 0 (68 suites passed, 1 skipped; 1122 tests passed). The path filter was ignored, so the full suite ran. |
| `npx nx run di-lint:lint` | 0 |
| `npx nx run degradation-audit:lint --skip-nx-cache` | 0 (only the existing baseline items are listed) |

The first test run failed (exit 1) on two existing assertions that pinned 3-arg `waitForAgents` calls and the old structured shape. Both are updated above. No `agent-sdk` compile errors appeared in these runs.

## Deviations and notes

- **Files outside the batch list.** `types.ts` and `agent-namespace.builder.ts` had to change: `ptah.agent.waitForAgents` had no signal parameter, so the HTTP and stdio signals could not reach the manager. `index.ts` and the vscode, ptah-cli and JSON-RPC server changes are the host dispose and cancel wiring the brief allows.
- **Why stdio cancel needed the CLI change.** Before this batch, `mcp-serve.ts` gave every `tools/call` a fresh `randomId()`, so a peer's `notifications/cancelled` `requestId` could never match anything. That includes the existing session-submit cancel, which tracks by `request.id`. Passing the peer's id fixes both.
- **Electron host not wired (left).** Neither host ever calls `CodeExecutionMCP.dispose`/`disposeAsync` (no `CODE_EXECUTION_MCP` dispose in `apps/`), so the 10.2 change in the service only takes effect if something disposes it.
  - VS Code and the CLI now kill directly.
  - Electron's `will-quit` chain (`apps/ptah-electron/src/activation/shutdown.ts:179` `disposeBeforePersistence`) does not. Wiring it means adding a `killRunningChecks` dep to `QuitSequenceDeps`/`DisposalDeps` and supplying it in `main.ts`, because importing the lib straight into `shutdown.ts` would load it under the quit-path specs.
  - Not done here (R1 budget); this is a one-line follow-up.

## Out of scope, not touched

- `execute_code` → `ptah.agent.waitFor` still gets no signal (the Batch 8 Task 8.3 gap). `getRequestAbortSignal()` is now available for that follow-up.
