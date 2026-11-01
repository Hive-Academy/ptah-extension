# Batch D9 12c-2: session history route

## Result

Added `SessionHistoryRouter` with the existing `readSessionHistory` and `readSessionEvents` method shapes. It reads the persisted `SessionMetadata` row, routes `codexExecution.runtime === 'codex-app-server'` to an optional `NativeSessionHistoryPort`, and projects the returned complete `CodexSessionHistory` with `projectCodexHistory`. Other sessions call `SessionHistoryReaderService` with the original arguments and receive its original result. A native row without a host port or a complete persisted identity throws `SessionHistoryRouteError` with a stable code and user-safe message. There is no Claude fallback for a native row.

The native read returns `{ events, stats: null }`, matching the reader's result type. The projector states that `thread/read` has no token usage (`libs/backend/agent-sdk/src/lib/codex-app-server/codex-history-projector.ts:11-19,52-101`). Native `readSessionEvents` fetches and projects the *full* snapshot each time. In 12d-2, `ChatHistoryReadService.readPage` can continue applying `resolveHistoryCursorEndIndex` and `selectHistoryPage` to that full event list (`libs/backend/rpc-handlers/src/lib/chat/session/chat-history-read.service.ts:82-102`). Thus older pages use the existing whole-turn cursor behavior; the router itself has no page cursor. The Codex runtime reader follows App Server pagination before returning its snapshot (`libs/backend/codex-runtime/src/lib/codex-session-history.ts:76-94,104-177`).

## Persisted identity and source evidence

- The native chat metadata writer saves `version: 1`, `runtime: 'codex-app-server'`, the thread id as `sessionId`, provider and normalized workspace, and `codex.normalizedHome` via `updateCodexExecution` (`libs/backend/agent-sdk/src/lib/wiring/codex-chat-metadata-port.ts:11-25`).
- `SessionMetadata` stores that value beside `codexThread`; the latter is the persisted context-to-thread mapping (`libs/backend/agent-sdk/src/lib/session-metadata-store.ts:110-128,260-266`). The router requires the row key, execution session id, and mapping workspace to agree (`libs/backend/agent-sdk/src/lib/codex-app-server/session-history-router.ts:64-76`).
- The Claude reader returns events, nullable stats and optional replay metadata from `readSessionHistory`, and raw events from `readSessionEvents` (`libs/backend/agent-sdk/src/lib/session-history-reader.service.ts:345-366,582-594`). The router preserves both Claude calls (`libs/backend/agent-sdk/src/lib/codex-app-server/session-history-router.ts:41-61`).
- `CodexHistoryReader.readHistory(profile, resume)` returns `CodexSessionHistory` (`libs/backend/codex-runtime/src/lib/codex-runtime.types.ts:294-303`). `CodexRuntime.readHistory` checks home identity, starts a read-only process, calls the complete reader, and closes the process in `finally` (`libs/backend/codex-runtime/src/lib/codex-runtime.ts:58-86`).
- `registerSdkServices` already binds the Claude reader and now binds a cached router; it resolves the native port only when registered (`libs/backend/agent-sdk/src/lib/di/register.ts:303-322`). Tokens use `Symbol.for` (`libs/backend/agent-sdk/src/lib/di/tokens.ts:61-64`).

## Exact 12d-1 Electron binding contract

In `apps/ptah-electron/src/di/codex-runtime-composition.ts`, bind an object implementing the exported `NativeSessionHistoryPort` under `SDK_TOKENS.NATIVE_SESSION_HISTORY_PORT` **before** first resolution of `SDK_TOKENS.SESSION_HISTORY_ROUTER`. Its single method is `readHistory(session: SessionMetadata): Promise<CodexSessionHistory>`. The router passes the saved row, including `codexExecution` and `codexThread`; the host must reject inconsistent or unavailable saved identity rather than return an empty snapshot.

For each call, reconstruct the `CodexExecutionProfile` and `CodexThreadIdentity` from the saved execution home, workspace, provider, thread id, context mapping and fingerprint, using the existing Electron settings/profile path; verify the pinned binary and keep the saved `CODEX_HOME` and configured MCP settings. Allocate an ephemeral Codex runtime child scope (or reuse a matching open context), call the runtime's `CodexHistoryReader.readHistory(profile, resume)` without starting a turn, and dispose the scope in `finally`. The current scope factory and binary verifier are at `apps/ptah-electron/src/di/codex-runtime-composition.ts:220-276,372-411`; `CodexRuntime.readHistory` closes its read process in its own `finally` (`libs/backend/codex-runtime/src/lib/codex-runtime.ts:58-86`). Do not bind this port on VS Code, CLI or TUI. Runtime errors must remain explicit and user-safe through the RPC error path; never map them to empty history.

## DI guard follow-up (app files outside this batch)

No app guard edit is needed to compile 12c-2 because the new router has no consumer until 12d-2 and the native port is optional. The guard lists should be extended when those batches wire the route:

1. Add `SDK_TOKENS.SESSION_HISTORY_ROUTER` to Electron and VS Code `EXPECTED_RUNTIME_TOKENS` (`apps/ptah-electron/src/di/expected-resolvable.ts:116-119`; `apps/ptah-extension-vscode/src/di/expected-resolvable.ts:28-31`) and assert it resolves in their `container.smoke.spec.ts` loops (`apps/ptah-electron/src/di/container.smoke.spec.ts:1481-1484`; `apps/ptah-extension-vscode/src/di/container.smoke.spec.ts:437-443`). The CLI smoke test has a hand-built container and no equivalent SDK token list; add a direct router registration/resolution assertion after `registerSdkServices` in `apps/ptah-cli/src/di/container.smoke.spec.ts`. Its `expected-resolvable.ts` list is handler classes, so do not put a symbol there.
2. After 12d-1 binds the Electron port, add `SDK_TOKENS.NATIVE_SESSION_HISTORY_PORT` to `ELECTRON_CODEX_BOUND_TOKENS` (`apps/ptah-electron/src/di/expected-resolvable.ts:121-129`) and assert it is registered in the Electron composition smoke test. For VS Code and CLI assert `isRegistered(..., true) === false` on their legacy containers. Do **not** put this absent port in `EXPECTED_NULL_RUNTIME_TOKENS`: it is deliberately unregistered, not a resolvable-null default.

## Files written

- `D:\projects\ptah-extension\.claude-worktrees\codex-removal-a\libs\backend\agent-sdk\src\lib\codex-app-server\session-history-router.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-removal-a\libs\backend\agent-sdk\src\lib\codex-app-server\session-history-router.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-removal-a\libs\backend\agent-sdk\src\lib\di\tokens.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-removal-a\libs\backend\agent-sdk\src\lib\di\register.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-removal-a\libs\backend\agent-sdk\src\index.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-removal-a\.ptah\specs\TASK_2026_714_c8a2\batch-D9-12c2-report.md`

## Review and limits

The spec covers the unchanged Claude route, native projected events, complete native event replay for older-page selection, absent native port, and incomplete persisted identity. It begins with `reflect-metadata` and uses the real `SessionMetadata` and pinned-schema `CodexSessionHistory` shapes. I reread every edited file and inspected the targeted diff. Per the task instruction, I ran no verify, tests, lint, typecheck, build, Nx, npm, npx or Jest command, and did not call `ptah_get_diagnostics`. I did not change app or RPC files. LF and BOM checks appear below.

**UNCONFIRMED:** Spec execution and TypeScript compilation; the live pinned-binary `thread/read` shape, paginated child discovery, and packaged Electron reload/render parity. The release gate in `plan-d9-history.md` remains open pending authorized live capture and the 12d batches. The local skill files were discoverable, but this CLI exposed no skill invocation mechanism; no matching skill was loaded through that mechanism.

| File | CR count | BOM |
| --- | ---: | --- |
| `session-history-router.ts` | 0 | no |
| `session-history-router.spec.ts` | 0 | no |
| `di/tokens.ts` | 0 | no |
| `di/register.ts` | 0 | no |
| `src/index.ts` | 0 | no |
| `batch-D9-12c2-report.md` | 0 | no |
