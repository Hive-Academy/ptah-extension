# TASK_2025_171: Tasks

## Batch 1: Backend Fixes (Issues 1-5, 8, 10)

### Task 1.1: Update package.json settings key + migration [CRITICAL]

- **Status**: COMPLETE
- **File**: `apps/ptah-extension-vscode/package.json`
- **File**: `libs/backend/agent-sdk/src/lib/ptah-cli/ptah-cli-registry.ts`
- **Changes**:
  - Renamed `ptah.customAgents` to `ptah.ptahCliAgents` in package.json contributes section
  - Added `migrateFromLegacyKeys()` method with lazy `ensureMigrated()` guard
  - Migration reads `customAgents` config, copies to `ptahCliAgents`, migrates secret prefixes
  - Called at top of `listAgents()`, `createAgent()`, and `getAdapter()`

### Task 1.2: Extract duplicated merge logic [SERIOUS]

- **Status**: COMPLETE
- **File**: `apps/ptah-extension-vscode/src/services/rpc/handlers/agent-rpc.handlers.ts`
- **Changes**: Extracted `private async mergePtahCliAgents()` method, both `registerGetConfig` and `registerDetectClis` now call it

### Task 1.3: Fix testConnection redundant adapter [SERIOUS]

- **Status**: COMPLETE
- **File**: `libs/backend/agent-sdk/src/lib/ptah-cli/ptah-cli-registry.ts`
- **Changes**: Removed redundant `getAdapter()` call, now only creates test adapter

### Task 1.4: Fix createAgent atomicity [SERIOUS]

- **Status**: COMPLETE
- **File**: `libs/backend/agent-sdk/src/lib/ptah-cli/ptah-cli-registry.ts`
- **Changes**: Save key first, then config. Rollback key if config save fails.

### Task 1.5: Change ca- prefix to pc- [MODERATE]

- **Status**: COMPLETE
- **File**: `libs/backend/agent-sdk/src/lib/ptah-cli/ptah-cli-registry.ts`
- **Changes**: `generateAgentId()` now uses `pc-` prefix

### Task 1.6: Clean ptahCliSessions on stream completion [MODERATE]

- **Status**: COMPLETE
- **File**: `apps/ptah-extension-vscode/src/services/rpc/handlers/chat-rpc.handlers.ts`
- **Changes**: Added `finally` block in `streamExecutionNodesToWebview()` to clean up sessions on completion

## Batch 2: Frontend Fixes (Issues 6-7, 9, 11)

### Task 2.1: Fix catch blocks to propagate errors [SERIOUS]

- **Status**: COMPLETE
- **File**: `libs/frontend/chat/src/lib/settings/ptah-ai/ptah-cli-config.component.ts`
- **Changes**: 6 catch blocks now have `(err)` parameter with `console.error` and error details in user messages

### Task 2.2: Fix component selector stutter [SERIOUS]

- **Status**: COMPLETE
- **File**: `libs/frontend/chat/src/lib/settings/ptah-ai/ptah-cli-config.component.ts`
- **File**: `libs/frontend/chat/src/lib/settings/settings.component.html`
- **Changes**: Selector changed from `ptah-ptah-cli-config` to `ptah-cli-config`

### Task 2.3: Add ngOnDestroy for timer cleanup [MODERATE]

- **Status**: COMPLETE
- **File**: `libs/frontend/chat/src/lib/settings/ptah-ai/ptah-cli-config.component.ts`
- **Changes**: Added `OnDestroy` + `ngOnDestroy()` that clears success timer

### Task 2.4: Add concurrency guard for toggle [MODERATE]

- **Status**: COMPLETE
- **File**: `libs/frontend/chat/src/lib/settings/ptah-ai/ptah-cli-config.component.ts`
- **Changes**: Added `isUpdating` signal guard + `[disabled]="isUpdating()"` on toggle

## Verification

- **Build (vscode)**: PASSING
- **Build (webview)**: PASSING
- **Typecheck (5 projects)**: PASSING
- **Lint (5 projects)**: PASSING (0 errors, 48 pre-existing warnings)
