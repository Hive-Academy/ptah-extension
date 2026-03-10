# TASK_2025_187: Permission & Question UI Session Routing

## Strategy: BUGFIX

## Workflow: Minimal (Direct implementation)

## Complexity: Medium (3-5 files, clear solution)

## User Request

Permissions and AskUserQuestion requests from Ptah CLI subagent sessions appear in the main chat session UI instead of being routed to the correct session context. The backend SDK routing is already correct (promise-based requestId resolution routes answers back to the correct SDK query). The fix is purely a UI display routing problem.

## Root Cause

1. **`SdkPermissionHandler.createCallback()`** returns a closure with no `sessionId` captured — all permissions go to `'ptah.main'` webview globally
2. **`PermissionRequest` and `AskUserQuestionRequest` types** have no `sessionId` field
3. **Frontend `PermissionHandlerService`** displays ALL incoming permissions regardless of which session they belong to — no session filtering

### What already works

- SDK answer routing: `requestId`-based promise resolution correctly routes user responses back to the correct SDK query
- Streaming messages: carry `sessionId` through the entire chain via `SessionLifecycleManager`
- Agent monitor: CLI agent permissions (`AgentPermissionRequest`) route correctly because they include `agentId`

## Fix Strategy

1. **Add `sessionId` to types** — `PermissionRequest`, `AskUserQuestionRequest`
2. **Make `createCallback(sessionId)` capture session context** in closure and inject into requests
3. **Update callers** — `SdkQueryOptionsBuilder`, `PtahCliAdapter`, `PtahCliRegistry` to pass sessionId
4. **Filter permissions by active session** in frontend `PermissionHandlerService`

## Key Files

### Backend (add sessionId to requests)

- `libs/shared/src/lib/types/permission.types.ts` — Add `sessionId` to `PermissionRequest`
- `libs/backend/agent-sdk/src/lib/sdk-permission-handler.ts` — `createCallback(sessionId)`, inject into payloads
- `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts` — Pass sessionId to createCallback
- `libs/backend/agent-sdk/src/lib/ptah-cli/ptah-cli-adapter.ts` — Pass sessionId to createCallback
- `libs/backend/agent-sdk/src/lib/ptah-cli/ptah-cli-registry.ts` — Pass sessionId to createCallback

### Frontend (filter by session)

- `libs/frontend/chat/src/lib/services/chat-store/permission-handler.service.ts` — Filter by active tab's sessionId
