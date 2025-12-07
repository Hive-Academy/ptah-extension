# ChatStore Refactoring Implementation Plan

## Goal Description

Refactor the monolithic `ChatStore` (currently ~1500 lines) by extracting remaining logic into specialized child services following the Facade pattern. This will improve maintainability, testability, and separation of concerns.

## Proposed Changes

### [libs/frontend/chat]

#### [NEW] [session-loader.service.ts](file:///d:/projects/ptah-extension/libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts)

- **Responsibilities**:
  - Loading sessions list from backend
  - Pagination of sessions
  - Switching sessions (loading details)
  - Managing pending session resolutions
- **State**:
  - `_sessions`, `_hasMoreSessions`, `_totalSessions`, `_sessionsOffset`, `_isLoadingMoreSessions`
  - `pendingSessionResolutions`
- **Dependencies**: `ClaudeRpcService`, `VSCodeService`, `SessionReplayService`, `TabManagerService`, `SessionManager`

#### [NEW] [conversation.service.ts](file:///d:/projects/ptah-extension/libs/frontend/chat/src/lib/services/chat-store/conversation.service.ts)

- **Responsibilities**:
  - Starting new conversations
  - Continuing existing conversations
  - Handling queue vs send logic (`sendOrQueueMessage`)
- **Dependencies**: `ClaudeRpcService`, `VSCodeService`, `TabManagerService`, `SessionManager`

#### [NEW] [permission-handler.service.ts](file:///d:/projects/ptah-extension/libs/frontend/chat/src/lib/services/chat-store/permission-handler.service.ts)

- **Responsibilities**:
  - Managing permission requests
  - correlating permissions with tools
  - identifying unmatched permissions
- **State**: `_permissionRequests`
- **Computed**: `permissionRequestsByToolId`, `unmatchedPermissions`
- **Dependencies**: `TabManagerService` (to access messages/executionTree for correlation)

#### [NEW] [index.ts](file:///d:/projects/ptah-extension/libs/frontend/chat/src/lib/services/chat-store/index.ts)

- Barrel file for exporting all child services.

#### [MODIFY] [chat.store.ts](file:///d:/projects/ptah-extension/libs/frontend/chat/src/lib/services/chat.store.ts)

- **Changes**:
  - Remove inline implementation of extracted logic.
  - Inject new child services.
  - Expose signals from child services as readonly properties (maintaining public API).
  - Delegate method calls to child services (Facade pattern).

## Verification Plan

### Automated Tests

- Run type check for the chat library:
  ```bash
  npx nx run chat:typecheck
  ```
  (assuming `typecheck` target exists, otherwise `tsc -p libs/frontend/chat/tsconfig.lib.json --noEmit`)
- Run linting:
  ```bash
  npx nx lint chat
  ```
- Run unit tests:
  ```bash
  npx nx test chat
  ```

### Manual Verification

1.  **Session Loading**: Verify sessions load on startup and pagination ('Load More') works.
2.  **Session Switching**: Click a different session, verify messages load correctly.
3.  **New Conversation**: Start a new chat, verify it switches to new tab and sends message.
4.  **Permissions**: Trigger a tool requiring permission (e.g. `bash`), verify permission request appears.
