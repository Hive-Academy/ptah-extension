# Batch 8p-2 report

GAP-I (false Codex busy on the first follow-up after restart) and S1 (Codex question card left up when the turn ends or Stop). Claude resume and Claude question dismissal are unchanged. No tests or typecheck were run (lane rule).

## Task 2.1 — deliver the Codex follow-up once

`autoResumeIfInactive` now returns `{ justResumed, promptDelivered? }` on success. `promptDelivered` is true only when `execution.runtime === 'codex-app-server'` and the prompt passed into the resume config has `length > 0` (`chat-session.service.ts:1947-1950`). The early “already live” return stays `{ justResumed: false }` with the field omitted. Failure stays `{ error }`.

Codex resume config includes `params.files` and `params.images` only when those fields are present (`chat-session.service.ts:1923-1928`). The Claude branch of the same spread does not add those keys. `AgentSessionResumeConfig` gained optional `files` and `images` (`agent-adapter.types.ts:245-254`), documented as delivered by runtimes that start a turn on resume; Claude ignores them like `prompt`. `AutoResumePreflight` carries the same two fields (`chat-session.service.ts:156-158`) so `chat:continue`’s `{ ...params }` can supply them. Host ports already read `'files' in config` / `'images' in config` (`codex-chat-host-ports.ts:400-406`). That file was not edited.

`chat:continue` stores `promptDelivered` (`chat-session.service.ts:1206-1219`). Slash commands still skip resume and go through `endDeadRecordBeforeSlashCommand`, then the slash router. After the router and the interrupted-agent injector, a delivered Codex prompt returns `{ success: true, sessionId }` and does not call `sendMessageToSession` or the stop-intent branch (`chat-session.service.ts:1248-1252`). Comment at that return and at `1947` says why: native Codex thread resume starts the turn.

### Callers of `autoResumeIfInactive`

All three are in `chat-session.service.ts`.

| Caller | Lines | Effect |
| --- | --- | --- |
| `continueSession` | 1210-1219, skip at 1250-1252 | Reads `promptDelivered`. Skips the second send only when it is true. |
| `resumeSession` (`activate: true`) | 1424-1438 | Passes `''`. Still branches on `'justResumed' in activateResult` and `activateResult.justResumed`. `promptDelivered` is false and unused. `activated` is unchanged. |
| `ensureSessionActiveForRewind` | 1683-1699 | Passes `''`. Still branches on `'error' in outcome`, then returns `{ resumed: true }`. `promptDelivered` is false and unused. |

### Specs

`chat-continue-codex-resume-once.spec.ts`:

- (a) line 140: inactive Codex — `resumeSession` once with prompt, files, and images; slash router still runs after resume; `sendMessageToSession` not called; `{ success: true, sessionId }`.
- (b) line 162: inactive Claude — same attachments on the continue params; resume config has no `files` or `images` keys; `sendMessageToSession` once with those attachments.
- (c) line 180: live Codex (active and streaming, no resume) — `sendMessageToSession` once; `resumeSession` not called.

`chat-session.native.spec.ts` asserted the old exact `{ justResumed: true }`. Those four expectations now include `promptDelivered` (true for the Codex resumes at 352, 432, 473; false for the Claude resume at 556).

## Task 2.2 — dismiss an unanswered Codex question card

`CodexChatUserQuestionsDeps.permissionHandler` is now `Pick<SdkPermissionHandler, 'createCallback' | 'cleanupPendingPermissions'>` (`codex-chat-user-questions.ts:20-23`).

After `ask` returns, if the signal is aborted and the result is `null` or not `behavior: 'allow'`, the port calls `deps.permissionHandler.cleanupPendingPermissions(sessionId)` once with the thread id already parsed in that function (`codex-chat-user-questions.ts:71-73`). That is Claude’s `PERMISSION_SESSION_CLEANUP` path. A throw is `deps.logger.warn`’d and does not reject (`74-79`). An allow result, a deny that is not an abort, and an invalid request (returned before `ask`) do not call it.

`apps/ptah-electron/src/di/codex-runtime-composition.ts` passes the real `SdkPermissionHandler`, so that construction site was left as-is. `codex-chat-native-contract.spec.ts` builds a `Pick` and needed `cleanupPendingPermissions: jest.fn()` so the widened Pick typechecks.

### Specs (`codex-chat-user-questions.spec.ts`)

- Abort before an answer (line 99): cleanup once with the session id; the port resolves `{}`.
- Answered (line 70): cleanup not called.
- Invalid request, including an already-aborted signal (line 134): cleanup not called; resolves `{}`.
- Throwing cleanup (line 144): warn includes the request id and the error message; the port still resolves `{}`.

## Files modified

- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\shared\src\lib\types\agent-adapter.types.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\rpc-handlers\src\lib\chat\session\chat-session.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\rpc-handlers\src\lib\chat\session\chat-continue-codex-resume-once.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\rpc-handlers\src\lib\chat\session\chat-session.native.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\rpc-handlers\src\lib\chat\codex-host\codex-chat-user-questions.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\rpc-handlers\src\lib\chat\codex-host\codex-chat-user-questions.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\rpc-handlers\src\lib\chat\codex-host\codex-chat-native-contract.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\.ptah\specs\TASK_2026_714_c8a2\batch-8p-2-report.md`

## Not done

- Did not run `npm run verify` or any test, lint, or typecheck (lane rule). The team-leader verifies.
- Did not edit `codex-chat-adapter.ts` or `codex-chat-host-ports.ts`.
- `ptah_agent_report` is not registered on this session (`ptah_agent_report` is not a qualified MCP name; `ptah__ptah_agent_report` was not found). The same summary is in the agent’s final message. `search_tool` only listed the `tasks` automation server.
