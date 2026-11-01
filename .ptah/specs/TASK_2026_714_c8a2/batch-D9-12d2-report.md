# D9 12d-2 RPC report

## Design and result

- `libs/backend/rpc-handlers/src/lib/chat/session/chat-history-read.service.ts:67,103,129` injects `SESSION_HISTORY_ROUTER` and uses it for resume and older-page reads. The saved session folder resolution, resume options, page cursor selection, page size and resumable-agent result remain in that service. Claude sessions still reach `SessionHistoryReaderService` through `session-history-router.ts:52-53,64-65`.
- `libs/backend/rpc-handlers/src/lib/chat/session/chat-history-read.service.ts:34-59` maps only recognized native and router failures to fixed `RpcUserError` messages. `session-history-router.ts:93-115` replaces unexpected native read and projection exceptions with `nativeReadFailed`, preventing native text or paths from reaching RPC.
- `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:1791,1972` already turns a `RpcUserError` from the resume read into `ChatResumeResult { success: false, error, errorCode }`; no edit was needed. `libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.handlers.ts:314-325` passes other typed page errors to the RPC wrapper. `session:load` and `session:validate` were not changed; `session-rpc.handlers.ts:718-767,1074-1083` retains metadata validation and empty load arrays.
- `libs/backend/rpc-handlers/src/lib/handlers/session-native-history.spec.ts:93-159` covers native full projection, tail selection with a base64url cursor, the older page, missing port, every Electron port code, router codes, and an unexpected native error. `chat-history-read.service.spec.ts` continues to cover Claude delegation, saved folder choice, block-owner option, and older-page selection. `session-history-router.spec.ts` now expects the safe coded failure for an unknown port exception.

## Error mapping

| Source code | RPC code | Fixed user message |
| --- | --- | --- |
| `nativePortUnavailable` | `HISTORY_UNAVAILABLE` | Session history is unavailable in this host. |
| `invalidNativeIdentity`, `invalidIdentity` | `HISTORY_UNAVAILABLE` | Saved session identity is incomplete. |
| `homeMismatch` | `HISTORY_UNAVAILABLE` | The saved session belongs to a different home. |
| `binaryUnavailable` | `HISTORY_UNAVAILABLE` | The history reader is unavailable. |
| `pathUnavailable` | `HISTORY_UNAVAILABLE` | The saved session location is unavailable. |
| `threadNotFound` | `HISTORY_NOT_FOUND` | The saved session history could not be found. |
| `busy` | `HISTORY_BUSY` | Too many history reads are in progress. Try again. |
| `timeout` | `HISTORY_TIMEOUT` | Reading session history timed out. Try again. |
| `cancelled` | `HISTORY_CANCELLED` | Reading session history was cancelled. |
| `runtimeFailed`, `nativeReadFailed`, unknown Electron code | `HISTORY_FAILED` | Session history could not be read. |

The provider-neutral codes were added in `libs/shared/src/lib/types/rpc/rpc-error-codes.types.ts:38-43`. VS Code and CLI resolve a null native port; the router emits `nativePortUnavailable`, which becomes `HISTORY_UNAVAILABLE` for both RPC reads.

## Census and frontend

- Added `SESSION_HISTORY_ROUTER` to `apps/ptah-electron/src/di/expected-resolvable.ts:45` and `apps/ptah-extension-vscode/src/di/expected-resolvable.ts:32`. The CLI census only lists handler classes and null Codex chat ports; it does not list chat-history consumers, so no CLI census edit was made. No registration change was needed because `libs/backend/agent-sdk/src/lib/di/register.ts` already registers the router and the optional port default.
- No frontend source edit. `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts:1162-1171` uses the generic failed-resume branch and its safe `error` text. `history-paging.service.ts:86-91` treats any failed older-page RPC as a failed load; it has no Codex branch. Its current UI does not display the specific new page error text or automatically retry `HISTORY_BUSY`; this is a frontend limitation outside this batch's no-frontend-edit scope.

## Files touched and static evidence

| File | Purpose | CR count |
| --- | --- | ---: |
| `libs/backend/rpc-handlers/src/lib/chat/session/chat-history-read.service.ts` | Router delegation and coded mapping | 0 |
| `libs/backend/rpc-handlers/src/lib/chat/session/chat-history-read.service.spec.ts` | Claude-path fixture adaptation and Windows paths | 0 |
| `libs/backend/rpc-handlers/src/lib/handlers/session-native-history.spec.ts` | Native RPC cases | 0 |
| `libs/backend/agent-sdk/src/lib/codex-app-server/session-history-router.ts` | Safe unknown native failure | 0 |
| `libs/backend/agent-sdk/src/lib/codex-app-server/session-history-router.spec.ts` | Updated safe-failure expectation | 0 |
| `libs/shared/src/lib/types/rpc/rpc-error-codes.types.ts` | Provider-neutral history codes | 0 |
| `apps/ptah-electron/src/di/expected-resolvable.ts` | Electron token census | 0 |
| `apps/ptah-extension-vscode/src/di/expected-resolvable.ts` | VS Code token census | 0 |
| `.ptah/specs/TASK_2026_714_c8a2/batch-D9-12d2-report.md` | This report | 0 |

All touched files were reread. `git diff --check` found no whitespace error. All touched files have no BOM. No tests, lint, typecheck, build, Nx, npm, Jest, Electron, Codex, App Server or paid request was run, as explicitly prohibited for this lane.
No callable CLI skill invocation tool was exposed; I read and applied the local `.claude/skills/execute-phase-gated-task/SKILL.md` directly, with the user's no-check and no-commit rules taking precedence.

## UNCONFIRMED

- TypeScript/Jest execution and host compilation remain unconfirmed because verification commands were prohibited.
- The release gate still requires an authorized pinned-binary `thread/read` response, paginated and child-thread cases, and a packaged Electron reload/render comparison. M1, M2 and M4 from the D9 review remain deferred to that gate.
- Actual busy retry behavior in the frontend is unconfirmed; the current older-page handler returns a generic failed outcome and does not automatically retry.
