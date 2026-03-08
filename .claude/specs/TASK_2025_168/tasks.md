# Development Tasks - TASK_2025_168: CLI Session Linking Bugfixes

**Total Tasks**: 4 | **Batches**: 2 | **Status**: COMPLETE

---

## Batch 1: Backend Fixes -- COMPLETE

**Developer**: backend-developer
**Tasks**: 3 | **Dependencies**: None

### Task 1.1: Fix agent:setConfig race condition with unsaved settings -- COMPLETE

**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\agent-rpc.handlers.ts`
**Lines**: 122-197

**Problem**: Multiple sequential `config.update()` calls fail when `settings.json` has unsaved changes. VS Code rejects writes with "Unable to write into user settings because the file has unsaved changes." Error repeats 6 times.

**Fix**: Save the settings document before writing, and wrap all updates with retry logic for the specific "unsaved changes" error. Use `vscode.workspace.save()` on the settings URI before the update batch.

### Task 1.2: Add agent:backgroundList to RPC registry -- COMPLETE

**Files**:

- `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc.types.ts`

**Problem**: `agent:backgroundList` handler is registered in `ChatRpcHandlers.registerBackgroundAgentHandlers()` but is not listed in `RpcMethodRegistry` or `RPC_METHOD_NAMES`. This causes the orphan handler warning during verification.

**Fix**: Add `agent:backgroundList` to both `RpcMethodRegistry` interface and `RPC_METHOD_NAMES` array.

### Task 1.3: Surface CLI sessions in chat:resume response -- COMPLETE

**Files**:

- `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc.types.ts` (ChatResumeResult)
- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\chat-rpc.handlers.ts` (chat:resume handler)

**Problem**: TASK_2025_161 persists CLI sessions to `SessionMetadata.cliSessions[]` via `SessionMetadataStore.addCliSession()`, but `chat:resume` handler never queries this data. The frontend has no way to see or resume CLI sessions from loaded sessions.

**Fix**:

1. Add `cliSessions?: CliSessionReference[]` to `ChatResumeResult` type
2. In `chat:resume` handler, inject `SessionMetadataStore` and query `metadata.cliSessions` for the session
3. Return `cliSessions` in the response

---

## Batch 2: Frontend Display -- COMPLETE

**Developer**: frontend-developer
**Tasks**: 1 | **Dependencies**: Batch 1

### Task 2.1: Display CLI sessions when loading saved sessions -- COMPLETE

**Files**: TBD (session-loader.service.ts, session history UI)

**Problem**: Even after Batch 1 surfaces `cliSessions` in the `ChatResumeResult`, the frontend doesn't display them or offer resume functionality.

**Fix**: Process `cliSessions` from the resume response and display them in the session UI (either in the agent card or as a separate section).

---
