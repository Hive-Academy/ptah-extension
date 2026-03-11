# Task Context - TASK_2025_168

## User Request

Fix 3 bugs found in VS Code extension log related to TASK_2025_161 CLI session linking:

1. **`agent:setConfig` RPC fails with "unsaved changes"** - Sequential `config.update()` calls race when settings.json has unsaved changes
2. **`agent:backgroundList` orphan handler warning** - Handler registered but not in RPC registry validation
3. **CLI sessions from Task 161 not surfaced in session resume** - `chat:resume` doesn't query/return `SessionMetadata.cliSessions[]`

## Task Type

BUGFIX

## Complexity Assessment

Medium (~3 hours estimated)

## Strategy Selected

BUGFIX (Minimal) - Direct developer invocation (bugs well-analyzed, root causes identified)

## Key Files to Modify

### Bug 1: agent:setConfig race condition

- `apps/ptah-extension-vscode/src/services/rpc/handlers/agent-rpc.handlers.ts` (lines 122-197)

### Bug 2: agent:backgroundList orphan handler

- `apps/ptah-extension-vscode/src/services/rpc/rpc-method-registration.service.ts` (RPC registry validation)

### Bug 3: CLI sessions not surfaced

- `apps/ptah-extension-vscode/src/services/rpc/handlers/chat-rpc.handlers.ts` (chat:resume handler)
- `libs/shared/src/lib/types/rpc.types.ts` (ChatResumeResult type)
- Frontend: session-loader.service.ts, streaming-handler or agent-card (display)

## Related Tasks

- TASK_2025_161: Gemini CLI Session Linking (parent feature)
- TASK_2025_157: Async Agent Orchestration

## Created

2026-03-01
