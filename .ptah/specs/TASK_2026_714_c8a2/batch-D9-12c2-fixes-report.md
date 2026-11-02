# Batch D9 12c-2 fixes

## Changes and evidence

- `libs/backend/agent-sdk/src/lib/codex-app-server/session-history-router.spec.ts:19` now uses `SessionId.from` with a valid UUID for the branded execution ID. The whole fixture and spec were reread for strict typing; `codexExecution` and `codexThread` have explicit real metadata types.
- `libs/backend/agent-sdk/src/lib/codex-app-server/session-history-router.ts:70-85` checks the persisted execution thread ID and compares the context path after `normalizeCodexWorkspaceKey(..., process.platform)`. A normalization failure or workspace mismatch becomes the user-safe `invalidNativeIdentity` error. The redundant metadata-row session ID check is gone. When `codexThread` is absent, the router uses `codexExecution.sessionId`, which the real `SessionRuntimeIdentity` type carries; the Electron port must read by that ID. A mismatched execution ID fails explicitly and never reads Claude history.
- `libs/backend/agent-sdk/src/lib/codex-app-server/session-history-router.ts:90-95` makes `nativeHistory` async and resolves its optional port through a getter on each native read. `libs/backend/agent-sdk/src/lib/di/register.ts:312-323` supplies the container-backed getter; `libs/backend/agent-sdk/src/lib/di/tokens.ts:63` records the binding timing. A router resolved before the Electron port is bound can use a later binding.
- `libs/backend/agent-sdk/src/lib/codex-app-server/session-history-router.spec.ts:127-243` covers a real two-turn tail plus older-page selection, a non-canonical Windows or POSIX workspace path, missing mapping, late port binding, rejecting port, mismatched execution ID, invalid or mismatched context path, and a missing metadata row. The native route fetches and projects the complete snapshot on each `readSessionEvents` call; `selectHistoryPage` and `resolveHistoryCursorEndIndex` select the older page from that full list. It currently rereads the thread for each page.
- The paging spec exposed JSON punctuation in native root-user message IDs, which the shared `h1:` cursor decoder rejects. `libs/backend/agent-sdk/src/lib/codex-app-server/codex-history-projector.ts:191-195` now emits a stable URL-safe SHA-256 ID for those user messages. Assistant live-stream IDs are unchanged.
- `.ptah/specs/TASK_2026_714_c8a2/plan-d9-history.md:31` records M3 coded RPC error mapping for 12d-2 and the 12d-1 guard and host-port requirements: `ELECTRON_CODEX_BOUND_TOKENS`, `surface-composition` length 7, `useValue` binding with lazy read-scope resolution, saved `normalizedHome` check, timeout/cancellation, and execution-ID fallback.

## Files touched and line endings

| Absolute file | CR count | UTF-8 BOM |
| --- | ---: | --- |
| `D:\projects\ptah-extension\.claude-worktrees\codex-removal-a\libs\backend\agent-sdk\src\lib\codex-app-server\session-history-router.ts` | 0 | no |
| `D:\projects\ptah-extension\.claude-worktrees\codex-removal-a\libs\backend\agent-sdk\src\lib\codex-app-server\session-history-router.spec.ts` | 0 | no |
| `D:\projects\ptah-extension\.claude-worktrees\codex-removal-a\libs\backend\agent-sdk\src\lib\codex-app-server\codex-history-projector.ts` | 0 | no |
| `D:\projects\ptah-extension\.claude-worktrees\codex-removal-a\libs\backend\agent-sdk\src\lib\di\register.ts` | 0 | no |
| `D:\projects\ptah-extension\.claude-worktrees\codex-removal-a\libs\backend\agent-sdk\src\lib\di\tokens.ts` | 0 | no |
| `D:\projects\ptah-extension\.claude-worktrees\codex-removal-a\.ptah\specs\TASK_2026_714_c8a2\plan-d9-history.md` | 0 | no |
| `D:\projects\ptah-extension\.claude-worktrees\codex-removal-a\.ptah\specs\TASK_2026_714_c8a2\batch-D9-12c2-fixes-report.md` | 0 | no |

## UNCONFIRMED

- TypeScript compilation, spec execution, lint, and full host compatibility: the task forbids running verify, tests, lint, typecheck, build, Nx, npm, npx, Jest, and `ptah_get_diagnostics`.
- Live pinned-binary `thread/read` payload and paginated child discovery; packaged Electron reload and rendered parity. The Electron history port and RPC consumer remain in 12d-1 and 12d-2.
- Coded RPC mapping of router and native-port errors is deferred to 12d-2 (M3). The native port must return user-safe typed errors; this batch only preserves its rejection without a Claude fallback.
- No CLI skill invocation tool was exposed. The local `agent-lanes` skill was inspected; it governs spawning lanes, not this router implementation.

No app files, `HANDOFF.md`, or MCP behavior were changed. No commit or push was made.
