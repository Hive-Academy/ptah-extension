# Batch 5 report: host broadcast wiring (cli-agent-runtime)

Executor: backend-developer (sub-agent). No git commands were run, and `batches.md` was not edited.

## Tasks

### Task 5.1: `wireLiveStatsCallback`: COMPLETE

File: MODIFIED `libs/backend/cli-agent-runtime/src/lib/wiring/sdk-callbacks.ts`

- Added `wireLiveStatsCallback(sdkAdapter, webviewManager, logger, tag)` at `:162`.
- `wireSdkCallbacks` calls it at `:99`, directly after `wireResultStatsCallback` and before `wireSessionIdResolvedCallback`.
- It registers through `sdkAdapter.setLiveStatsCallback`, the port member added in Batch 4 (`agent-adapter.types.ts:368`).
  - The callback calls `webviewManager.broadcastMessage(MESSAGE_TYPES.SESSION_STATS_LIVE, payload)` and passes the payload through unchanged.
  - The broadcast is fire-and-forget. A `.catch` logs `logger.debug('<tag> Live session stats broadcast dropped: <sessionId>', { errorName })`.
  - `errorName` is `error.name` for an `Error`, otherwise `typeof error`. The error message and the payload are never logged.
- The new function has no `retryWithBackoff` and no per-publish `info` log. The doc comment gives the reasons: a retried estimate is already stale, and the callback fires at up to 1/s.
- The summary log line (`:121`) now reads `SDK callbacks wired (stats, live stats, sessionId, compaction[, worktree])`.
- The file header now lists `setLiveStatsCallback`.
- A synchronous throw from `broadcastMessage` needs no guard here. `LiveSessionStatsPublisher.emit` already wraps the callback in try/catch and handles a rejected thenable (`live-session-stats-publisher.ts:541-559`).

### Task 5.2: Spec: COMPLETE

File: MODIFIED `libs/backend/cli-agent-runtime/src/lib/wiring/sdk-callbacks.spec.ts`

- Added `setLiveStatsCallback: jest.fn()` to all 5 existing adapter mocks:
  - `buildHarness`
  - the two re-persist / unscoped-registry harnesses (`replace_all` on the identical 10-space block)
  - `wireResultStats`
  - `wireWorktree`

  Without it, `wireSdkCallbacks`' try block would throw at the new call and skip the session-id, compaction and worktree wiring. That would break those existing cases.
- New `describe('wireSdkCallbacks — live session stats broadcast (TASK_2026_626)')`:
  - **Exactly-once case:** broadcasts `'session:stats-live'` exactly once, and `mock.calls[0][1]` is the same payload object (`toBe`). A provisional snapshot with `context` is used. It also asserts that `setSessionIdResolvedCallback` and `setCompactionStartCallback` were still wired after the live callback.
  - **Rejection case:** the broadcast rejects with `TypeError('webview disposed: secret detail')`.
    - `onLive(payload)` does not throw.
    - After two macrotask flushes, `broadcastMessage` was called exactly once, so there is no retry.
    - `logger.debug` was called with a message containing the session id and `{ errorName: 'TypeError' }`.
    - The debug calls do not contain the error message.
    - No `info` log mentions live stats.

## Risks and assumptions carried by this batch

| Item (from plan validation) | Handling |
| --- | --- |
| Assumption: the harness adapter mock must gain `setLiveStatsCallback`, or the try block aborts the later wiring | Confirmed. Added to every mock, and the exactly-once case checks that the later callbacks are still wired. All 15 existing cases pass. |
| Live estimate lands after the authoritative snapshot | There is no retry, so the backend never sends a stale estimate late. The frontend revision floor (Batches 6/7) remains the guard. |
| Live path triggers result-path side effects | The live callback only broadcasts `SESSION_STATS_LIVE`. It does not use `sendStatsWithRetry` or `SESSION_STATS`, and it logs no `info`. |
| Secrets / internal diagnostics in logs | Only the session id and the error name are logged. |
| Parallel tracks exhaust RAM | Checks ran one at a time with `--maxWorkers=2` / `--parallel=1`. |

Edge cases: the plan lists none at the host-wiring layer. A dropped broadcast (no window, disposed webview) is logged at debug and discarded. The next publish or the authoritative `session:stats` corrects the header.

## Host-forwarding check (read-only)

All three hosts reach `wireSdkCallbacks`. The only call site is `libs/backend/rpc-handlers/src/lib/host-profile/register-rpc-surface.ts:244` (`wireBridges`, called from `registerRpcSurface` `:147`). `registerRpcSurface` is called by:

- VS Code: `apps/ptah-extension-vscode/src/activation/bootstrap.ts:177`
- Electron: `apps/ptah-electron/src/activation/wire-runtime.ts:328`
- CLI/TUI: `libs/backend/cli-engine/src/lib/container.ts:941`

Forwarding per host:

- **VS Code:** `WebviewManager.broadcastMessage` (`libs/backend/vscode-core/src/api-wrappers/webview-manager.ts:294-315`) posts `{ type, payload }` to every panel and view. `sendMessage` (`:191-227`) does not filter by type. No allowlist.
- **Electron:** `ElectronWebviewManagerAdapter.broadcastMessage` (`apps/ptah-electron/src/ipc/webview-manager-adapter.ts:88-90`) passes to `IpcBridge.sendToRenderer` (`ipc-bridge.ts:160-176`). That method only diverts stream events to its batch queue. Everything else goes out as `webContents.send('to-renderer', message)`. The preload (`apps/ptah-electron/src/preload.ts:68-70`) re-dispatches any message as a window `MessageEvent`. No type allowlist.
- **CLI/TUI:** `CliWebviewManagerAdapter.broadcastMessage` (`libs/backend/cli-engine/src/lib/transport/cli-webview-manager-adapter.ts:38-40, 71-82`) emits on an EventEmitter under the type name, so any type is delivered. Nothing in `apps/ptah-cli` or `apps/ptah-tui` subscribes to `session:stats-live`. The TUI listens only to `session:stats` (`apps/ptah-tui/src/hooks/use-sessions.ts:250`), which the plan keeps out of scope (C6). The emit is a harmless no-op.
- **Webview receiving side:** `MESSAGE_TYPES.SESSION_STATS_LIVE` is in `handledMessageTypes` (Batch 7, `batch-7-report.md`).
- **`host-source-registry.baseline.ts:555`** lists `'session:stats'`. It is a contract baseline, not a forwarding allowlist, and decisions.md D8 says to leave it unchanged.

No host file changed.

## Verification

The worktree had no `node_modules`. A temporary junction was created with `mklink /J`, then removed afterwards with `cmd /c rmdir`; the target `D:\projects\ptah-extension\node_modules` is still intact. Checks ran serially:

1. `npx jest -c libs/backend/cli-agent-runtime/jest.config.ts libs/backend/cli-agent-runtime/src/lib/wiring/sdk-callbacks.spec.ts --coverage=false --maxWorkers=2`
   - `Test Suites: 1 passed, 1 total` / `Tests: 17 passed, 17 total` (15 existing + 2 new)
2. `npx nx typecheck @ptah-extension/cli-agent-runtime --parallel=1`
   - `Successfully ran target typecheck for project @ptah-extension/cli-agent-runtime`
3. `npx nx lint @ptah-extension/cli-agent-runtime --parallel=1`
   - `✖ 45 problems (0 errors, 45 warnings)`, `Successfully ran target lint`
   - `npx eslint` on the two changed files printed nothing (0 warnings in them).
   - `npx prettier --check` on both files: "All matched files use Prettier code style!"

Nx Cloud printed its known "organization disabled" notice. It did not affect the local runs.

## Files changed

- `D:/projects/ptah-extension/.claude-worktrees/fix-live-session-stats-a1634d3869cb/libs/backend/cli-agent-runtime/src/lib/wiring/sdk-callbacks.ts`
- `D:/projects/ptah-extension/.claude-worktrees/fix-live-session-stats-a1634d3869cb/libs/backend/cli-agent-runtime/src/lib/wiring/sdk-callbacks.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/fix-live-session-stats-a1634d3869cb/.ptah/specs/TASK_2026_626_7b3e/batch-5-report.md` (this report)

## Plan deviations

None.

## Out-of-scope observations

The CLI/TUI host delivers `session:stats-live` to an EventEmitter that nothing listens to. The plan accepts this: TUI live stats are out of scope.
