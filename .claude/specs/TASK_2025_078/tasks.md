# TASK_2025_078: Deprecated Code Cleanup Phase 2 (Configuration & Permissions)

## Status: COMPLETED

## Summary

Remove remaining deprecated code identified in post-TASK_2025_077 review:

1. Orphaned CONFIGURATION_PROVIDER token and stale comments
2. Deprecated `permissionRequestsByToolId` computed signal
3. Deprecated `SessionSummary` type alias
4. Unused DI tokens (12 identified)

## Background

**User Rule**: No backward compatibility code since project is not live yet.

### Investigation Findings

**Configuration System**:

- `ConfigManager` is the sole active configuration mechanism
- `CONFIGURATION_PROVIDER` token was created for `ConfigOrchestrationService` (deleted in commit 44d116f)
- Token definition left behind as cleanup oversight
- Stale comment in `main.ts:95` claims registration that doesn't exist

**Permission System**:

- `permissionRequestsByToolId` computed signal creates new Map on every access
- `getPermissionByToolId()` method is the efficient replacement
- Signal only used internally in `getPermissionForTool()` - no UI components consume it
- Safe to delete after migrating internal usage

## Batches

### Batch 1: Delete CONFIGURATION_PROVIDER Token & Stale Comments

**Files**:

1. `libs/backend/vscode-core/src/di/tokens.ts`

   - Delete `CONFIGURATION_PROVIDER` symbol definition (line 180)
   - Delete from TOKENS constant (line 318)

2. `apps/ptah-extension-vscode/src/main.ts`
   - Delete stale comment (lines 95-96):
     ```typescript
     // NOTE: CONFIGURATION_PROVIDER is now registered in DIContainer.setup()
     // It was moved there to fix dependency injection order (ConfigOrchestrationService depends on it)
     ```

**Verification**: `npm run typecheck:all`

### Batch 2: Migrate & Delete permissionRequestsByToolId

**Files**:

1. `libs/frontend/chat/src/lib/services/chat-store/permission-handler.service.ts`

   - Migrate `getPermissionForTool()` to use `getPermissionByToolId()` instead of computed signal
   - Remove debug logging that uses `permissionRequestsByToolId().keys()`
   - Delete `permissionRequestsByToolId` computed signal (lines 92-105)

2. `libs/frontend/chat/src/lib/services/chat.store.ts`
   - Remove `permissionRequestsByToolId` facade exposure (lines 136-137)

**Verification**: `npm run typecheck:all` + manual test permission flow

### Batch 3: Delete SessionSummary Deprecated Type Alias

**Files**:

1. `libs/shared/src/lib/types/claude-domain.types.ts`

   - Delete `SessionSummary` type alias (lines 333-342)
   - Delete `SessionSummarySchema` alias

2. `libs/shared/src/lib/types/message.types.ts`
   - Replace import `SessionSummary` with `SessionUIData` (line 24)
   - Update `ChatSessionsUpdatedPayload.sessions` type (line 486)

**Verification**: `npm run typecheck:all`

### Batch 4: Delete Unused DI Tokens

**Files**:

1. `libs/backend/vscode-core/src/di/tokens.ts`

   - Delete unused token definitions:
     - `COMMAND_REGISTRY` (line 17)
     - `WEBVIEW_PROVIDER` (line 16)
     - `COMMAND_BUILDER_SERVICE` (line 185)
     - `PRICING_SERVICE` (if unused)
     - `PROCESS_MANAGER` (if unused)
     - `CLAUDE_CLI_DETECTOR` (if unused)
     - `CLAUDE_CLI_SERVICE` (if unused)
     - `SEMANTIC_CONTEXT_EXTRACTOR` (if unused)
     - `FILE_INDEXER_SERVICE` (if unused)
     - `CONTEXT_MANAGER` (if unused)
     - `WEBVIEW_INITIAL_DATA_BUILDER` (if unused)
   - Remove from TOKENS constant

2. `libs/backend/vscode-core/src/di/container.spec.ts`
   - Remove test assertions for deleted tokens (lines 82-83, 94-95, 109)

**Verification**: `npm run typecheck:all` + `npm run test`

### Batch 5: Fix title Field Deprecation

**Decision Required**: Either:

- A) Migrate `tab.title` → `tab.name` everywhere, then delete `title` field
- B) Remove "deprecated" comment since field is actively used

**Files** (if option A):

1. `libs/frontend/chat/src/lib/services/chat.types.ts`

   - Delete `title` field from `TabState` interface (line 72-73)

2. `libs/frontend/chat/src/lib/components/molecules/tab-item.component.ts`

   - Replace `tab().title` with `tab().name` (lines 45-46)

3. `libs/frontend/chat/src/lib/services/tab-manager.service.ts`
   - Replace `tab.title` with `tab.name` (line 347)

**Verification**: `npm run typecheck:all` + manual test tab display

## Pre-Verification Checklist

Before each batch:

- [ ] Read affected files
- [ ] Grep for usages of symbols being deleted
- [ ] Verify no external consumers

After each batch:

- [ ] `npm run typecheck:all` passes
- [ ] `npm run build:all` passes (final verification)

## Estimated Lines Removed

| Batch                               | Lines     |
| ----------------------------------- | --------- |
| Batch 1: CONFIGURATION_PROVIDER     | ~8 lines  |
| Batch 2: permissionRequestsByToolId | ~20 lines |
| Batch 3: SessionSummary             | ~15 lines |
| Batch 4: Unused tokens              | ~40 lines |
| Batch 5: title field                | ~10 lines |
| **Total**                           | ~93 lines |

## Dependencies

- Requires TASK_2025_077 complete (already done)
- No external dependencies

## Risk Assessment

- **Low Risk**: All identified code is confirmed unused/deprecated
- **Batch 2 Medium Risk**: Permission flow should be manually tested after changes
- **Batch 4 Medium Risk**: Some tokens may have hidden usages - verify with grep before deleting
