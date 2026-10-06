# Batch 24A report: Do not answer a cancelled stdio request (G.8, moved from Task 21.2)

Executor: backend-developer. Worktree: `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g`. Not committed.

Verdict: Task 24A.1 is done. All scoped checks exit 0.

## Files changed

- `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\apps\ptah-cli\src\cli\jsonrpc\server.ts`: exports `NO_RESPONSE` (a `unique symbol`). `dispatchRequest` returns without calling `send` when a handler returns it. Every other return value is encoded as before. The `RpcHandler` doc now mentions it.
- `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\apps\ptah-cli\src\cli\jsonrpc\server.spec.ts`: new test `sends nothing for a request whose handler returns NO_RESPONSE`. A silent request and an echo request go in, and exactly one line (the echo reply, id 7) comes out.
- `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\apps\ptah-cli\src\cli\commands\mcp-serve.ts`: in `tools/call`, right after `handleToolsCall`, `if (stdioServer.wasCancelledByPeer(resp)) return NO_RESPONSE;`. This runs before the error and result mapping, so a cancelled call sends neither a result nor an error.
- `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\apps\ptah-cli\src\cli\commands\mcp-serve.spec.ts`: the fake stdio server gains `wasCancelledByPeer` (defaults to `false`). New test `sends no reply for a tools/call the peer cancelled`: two calls go in, one is flagged, only the other id is answered, and both reach `handleToolsCall`.
- `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-stdio\stdio-mcp-server.service.ts`:
  - New public `wasCancelledByPeer(response: MCPResponse): boolean`, backed by a `WeakSet<MCPResponse>`. No ids are stored, so nothing leaks and an id reused after a call settles cannot be misread.
  - Wrapper tools: `handleCancelled` adds the aborted controller to `peerCancelledCalls` (a `WeakSet<AbortController>`). After dispatch, the reply (or the "unrouted" fallback) is flagged through a private `settle(...)`, which also logs `debug` `[StdioMcpServer] tools/call cancelled by peer` `{ id, tool }` through the injected Logger.
  - `session_submit`: the call is tracked in `inFlightSubmits` (by id, removed in `finally` only if the entry is the same one). `handleCancelled` marks it `cancelledByPeer` and still forwards `cancel(...)` to the handler as before. The reply is flagged the same way.
  - Not flagged: an abort by `dispose()` (shutdown, not the peer), and a call that settled before the cancel arrived. Those are answered normally.
  - `handleToolsCall` still returns `Promise<MCPResponse>`. Returning `null` was rejected because about 40 call sites read `resp.result` without a null check, including `mcp-core\mcp-contract.sweep.spec.ts`, which is outside this batch.
- `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-stdio\stdio-mcp-server.service.spec.ts`:
  - The test `aborts the agent_wait whose id the peer cancels, not the session-submit handler` now asserts `wasCancelledByPeer(resp) === true` instead of the `WAIT CANCELLED` text.
  - `leaves a call alone when the cancel names another id` also asserts that a reply aborted by `dispose()` is not flagged.
  - New: `does not flag a call that settled before the cancel arrived`.
  - New: `flags a session_submit reply the peer cancelled while it ran, and still forwards the cancel`. The cancelled call is flagged, a later call is not, and `handler.cancel` receives `{ requestId: 's-1' }`.
  - Imports `MCPResponse` as a type.

## Checks (run in the worktree)

- `npx nx run-many -t typecheck,lint,test -p ptah-cli vscode-lm-tools --parallel=2 --outputStyle=static`: exit 0. vscode-lm-tools: 2855 tests passed. ptah-cli: 1126 passed, 3 skipped.
  - The first run exited 1 for two reasons. I had passed `-- --maxWorkers=2`, which reached `tsc` (TS5023). And one spec mock had the wrong arity (TS2322). I fixed the mock and dropped the flag, then reran.
- `npx nx run di-lint:lint`: exit 0. The first attempt exited 1 only because the `@nx/eslint/plugin` worker failed to start (transient). The retry passed.
- `npx nx run degradation-audit:lint`: exit 0.

## Open notes

- When the peer cancels, the server sends no reply but the work still finishes. The dispatcher still builds its reply (for example `WAIT CANCELLED`), which is then dropped. Nothing else changes for the dispatchers.
- Race: if the call settles before `notifications/cancelled` is processed, the reply has already been sent. The MCP spec allows this.
- If a dispatcher throws after a peer cancel, `server.ts` still sends an InternalError reply. The wrapper dispatchers return error envelopes rather than throwing, so this path is not expected. It was left as is.
- No console output was added. The new log line goes through the injected Logger at `debug`.
