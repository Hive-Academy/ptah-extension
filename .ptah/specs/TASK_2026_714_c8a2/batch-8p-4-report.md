# Batch 8p-4 report

## Task 4.1 — typed resume error consumers

- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts:793` now classifies the exported typed error with `isCodexResumeProfileChangedError`. Its adapter error code union already included `resume-profile-changed` at line 52.
- `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:628-636` checks the adapter code or typed cause and uses `CODEX_RESUME_PROFILE_CHANGED_MESSAGE` for `RpcUserError`, retaining `CODEX_RUNTIME_FAILED`.
- Specs: `codex-chat-adapter.spec.ts:191` asserts the typed error maps to the adapter code; `chat-session.native.spec.ts:676,694` asserts the exact exported message for the code and typed-cause paths.

Production-text grep proof: `rg -n -F 'Codex cannot resume this chat because its execution profile has changed. Start a new chat to use the current permission policy.' . --glob '*.ts' --glob '!*.spec.ts'` returned exactly one line: `libs/backend/codex-runtime/src/lib/codex-resume-profile-error.ts:2`.

## Task 4.2 — StreamlessFollowUpAdmission

- `libs/backend/agent-sdk/src/lib/codex-app-server/session-runtime-router.ts:22-29` exports the interface and has `SessionRuntimeRouter` implement it.
- `libs/backend/agent-sdk/src/index.ts:168` exports the type. `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:60,348` imports it and uses it for the injected router; the local interface is gone.

## Task 4.3 — GAP-I follow-ups

- `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:1207-1214,1754,1946-1949` passes explicit `deliversFollowUp` intent only from `chat:continue`. A successful Codex resume marks the turn delivered even when prompt text is empty; activation and rewind use the default false value.
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts:245-253` maps `config.files` and `config.images` to turn attachments when the thread is already open.
- Specs: `chat-continue-codex-resume-once.spec.ts:162` asserts an attachment-only follow-up resumes once and skips `sendMessageToSession`; `codex-chat-adapter.spec.ts:202` asserts the open-thread resume starts a turn with file and image attachments.

## Files written

- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\agent-sdk\src\lib\codex-app-server\codex-chat-adapter.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\agent-sdk\src\lib\codex-app-server\codex-chat-adapter.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\agent-sdk\src\lib\codex-app-server\session-runtime-router.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\agent-sdk\src\index.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\rpc-handlers\src\lib\chat\session\chat-session.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\rpc-handlers\src\lib\chat\session\chat-continue-codex-resume-once.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\rpc-handlers\src\lib\chat\session\chat-session.native.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\.ptah\specs\TASK_2026_714_c8a2\batch-8p-4-report.md`

Tests, lint, typecheck, build, diagnostics, and Git commands were not run because this lane prohibits them. Team leader verification remains pending.
