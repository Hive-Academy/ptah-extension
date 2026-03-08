# Task Context - TASK_2025_093

## User Intent

Remove the temp*id pattern from chat session initialization and use real SDK UUIDs directly. Currently, `chat-rpc.handlers.ts` creates a temporary session ID (`temp*${Date.now()}_${random}`) before starting the SDK session, then waits for the real UUID from SDK's system init message. This is confusing and potentially problematic. The goal is to ensure all events always have real SDK UUIDs from the start.

## Conversation Summary

- User questioned why temp_id exists in streaming when we should work with real UUIDs directly
- Investigation revealed the temp_id is a workaround because SDK's `query()` is asynchronous
- Real UUID comes from SDK via `system init` message during streaming
- Frontend uses `tabId` for event routing (not sessionId) - so temp_id is vestigial
- Events already use real UUID via `effectiveSessionId` in stream-transformer.ts (line 287-289)
- User confirmed: want to remove temp_id and ensure all events have real SDK UUIDs
- Must verify this doesn't break previous sessions loading (session history)

## Technical Context

- Branch: feature/sdk-only-migration (current)
- Created: 2025-12-28
- Type: REFACTORING
- Complexity: Medium (multiple files, affects streaming and session loading)

## Execution Strategy

REFACTORING strategy:

1. researcher-expert → Search all temp_id usages, analyze impact
2. software-architect → Design migration plan
3. USER VALIDATES
4. team-leader MODE 1-3 → Decompose and implement
5. USER CHOOSES QA
6. modernization-detector → Future enhancements

## Key Files to Investigate

**Backend (temp_id creation & handling):**

- apps/ptah-extension-vscode/src/services/rpc/handlers/chat-rpc.handlers.ts (temp_id creation)
- libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts (effectiveSessionId handling)
- libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts (session lifecycle)
- libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts (pre-registration)

**Frontend (session loading):**

- libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts
- libs/frontend/chat/src/lib/services/chat-store/streaming-handler.service.ts

## Requirements

1. Must not break live streaming
2. Must not break session history loading
3. Must maintain backward compatibility with existing sessions
4. Frontend should continue using tabId for event routing
5. All events should have real SDK UUIDs (no temp_xxx IDs)

## Success Criteria

1. No `temp_${timestamp}` pattern anywhere in codebase
2. All streaming events use real SDK UUIDs
3. Live streaming continues to work
4. Session history loading continues to work
5. No breaking changes to frontend
