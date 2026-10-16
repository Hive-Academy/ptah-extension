# Batch 6 report

## Task 6.1 — Session coordinator

- Added a page-scoped `CommandCenterSessionCoordinator` that checks the active marked tab, validates a recorded SDK session with `session:list`, resumes it through `ChatStore.switchSession`, or creates a marked tab (`session-coordinator.ts:47-85`). A failed list read gets three bounded attempts with timeout and backoff, then leaves the saved record intact and shows a safe error (`:88-105`). New Command Center creates another marked tab and switches to it (`:107-119`).
- Voice start engages the root lock with an owner token; mute, Stop, New Command Center, and page teardown release it (`:29-31`, `:107-110`, `:121-151`). Sends use `MessageSenderService` with the marked tab and owner token (`:154-171`), so its existing start/continue routing applies the same persona and ordinary chat remains writable. Stop sends `chat:abort` for the latest root SDK ID (`:139-151`). Status turns alone prepend the supplied context block (`:173-177`); the Task 8.2 builder will supply the bounded block. `sendLaunchTurn` is the Task 8.3 entry after registration (`:179-181`).
- R3 and interleaved two-tab events: question answers explicitly pass the marked tab ID to `ChatStore.handleQuestionResponse` (`:183-186`); all session reads and sends are keyed to that root, and no event listener or other-tab state is claimed. The spec exercises a second tab and the explicit deciding ID (`session-coordinator.spec.ts:46-55`). R8: the coordinator uses existing tab/ChatStore routing; it adds no `MESSAGE_HANDLERS`, `surfaceMode`, private listener, or claim. The lock, resume, new-tab, failed-read, status, and Stop behavior have focused specs (`session-coordinator.spec.ts:57-108`).
- AC16 is covered by the tab marker/last-session record resume path; AC25 by owner-token lock acquisition and release; AC2 by using the marked-tab persona on the sender's first start and subsequent continue. The page, status-context builder, and Tribunal registration/once guard are later batches; the coordinator exposes their specified entry points.

## Task 6.2 — First-start persona

- The sender resolves `commandCenterPersonaFor(activeTab)` before `chat:start` and adds `options.systemPrompt` only when the tab carries a valid Command Center marker (`message-sender.service.ts:455-475`). Marked and unmarked first-start cases are covered by `message-sender.command-center.spec.ts:68-81`; the existing continue assertion at `:53-66` checks the same fixed persona. This closes L2 and D9, including the racing regular-chat start: both callers reach the same sender branch with the same resolver.
- `ChatStartParams.options.systemPrompt` is typed at `libs/shared/src/lib/types/rpc/rpc-chat.types.ts:70-73`. The `chat:start` schema accepts the options object via passthrough at `libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.schema.ts:64-71`; its handler parses and passes params to `startSession` at `libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.handlers.ts:235-241`. The backend reads `options?.systemPrompt` into session configuration at `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:885`. Thus the key is accepted and consumed on start.

## Verification

- `ptah_get_diagnostics` was attempted on changed files after edits; its TypeScript source timed out after 45 seconds and reported files unchecked. The scoped Nx typecheck, test, and lint targets completed successfully.
- Header: `Running targets test, typecheck, lint for 2 projects` (`@ptah-extension/command-center`, `@ptah-extension/chat`). Final result: `Successfully ran targets test, typecheck, lint for 2 projects`; exit code 0; six successful targets; 0 code errors and 0 lint warnings reported. Nx Cloud separately reported its organization disabled (401), without failing local targets.

## Files written

- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/model/session-coordinator.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/model/session-coordinator.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/index.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/chat/src/lib/services/message-sender.service.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/chat/src/lib/services/message-sender.command-center.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/.ptah/specs/TASK_2026_678_9083/reports/batch-6-report.md`

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Use the existing sender for coordinator start/continue | Direct coordinator RPC; sender with marked tab and owner token | `message-sender.service.ts:325-364,455-475,711-719` already handles first start, continue, lock, and tab routing; plan line 15 requires ordinary tab routing | Yes |
| Keep saved session on a failed `session:list` read | Create new tab; show safe error and retain saved session | `command-center-records.ts:78-87` stores last session; failed network reads do not prove the session is absent | Yes |
| Resume history through `ChatStore.switchSession` | Direct `chat:resume`; established ChatStore loader | `chat.store.ts:220-224` delegates to the session loader, preserving transcript replay behavior | Yes |
| Pass the root tab explicitly for answers | Use active tab; marked root | R3 and `chat.store.ts:500-509` show active tab may differ from deciding tab | Yes |
