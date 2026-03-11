# Task Context - TASK_2025_077

## User Intent

Remove all backward compatibility, migration, and deprecated code from the codebase. The project is not live yet, so there are no users to migrate - this code is unnecessary complexity that caused an activation failure.

**User's exact words**:

> "what is this migrations? why we have that and we are not even live? we have also a rule to prevent any backward compatible code as we are not live yet!"
> "we need to get this removal properly handled without leaving behind any tangled code again"

## Problem Statement

The extension fails to activate with error:

```
CodeExpectedError: Unable to write to Workspace Settings because ptah.migration.secretsV1.completed is not a registered configuration.
```

Root cause: `main.ts:51` uses `configManager.set()` for a key not declared in `package.json`. But the real fix is to DELETE this migration code entirely since we have no users to migrate.

## Conversation Summary

From previous analysis, the following deprecated/backward-compat code was identified:

1. **Migration code in main.ts** (CRITICAL - causes crash)

   - Lines 28-56: Migration block that writes to unregistered config key
   - This is the ROOT CAUSE of the activation failure

2. **Migration method in auth-secrets.service.ts**

   - `migrateFromConfigManager()` method - unnecessary pre-launch
   - Already has rollback mechanism (over-engineered for non-existent users)

3. **Deprecated types in common.types.ts**

   - `ChatMessage` interface marked `@deprecated`
   - Should use `StrictChatMessage` instead

4. **Deprecated service: dropdown-interaction.service.ts**

   - 272-line service marked `@deprecated`
   - Should use CDK Overlay instead (already implemented in TASK_2025_048)

5. **Legacy tokens in vscode-core/di/tokens.ts**
   - Lines 196-198: `CLAUDE_SERVICE` and `WORKSPACE_ANALYZER` tokens marked as legacy

## Technical Context

- Branch: feature/sdk-only-migration
- Created: 2025-12-16
- Type: REFACTORING
- Complexity: Medium (multiple files, but straightforward deletions)
- Related: TASK_2025_076 (exposed the issue during code review)

## Execution Strategy

REFACTORING - Direct cleanup without project-manager phase since scope is clearly defined.

## Files to Modify

| File                                                                  | Action                       | Lines      |
| --------------------------------------------------------------------- | ---------------------------- | ---------- |
| `apps/ptah-extension-vscode/src/main.ts`                              | Delete migration block       | ~30 lines  |
| `libs/backend/vscode-core/src/services/auth-secrets.service.ts`       | Delete migration method      | ~120 lines |
| `libs/shared/src/lib/types/common.types.ts`                           | Delete deprecated interfaces | ~50 lines  |
| `libs/frontend/core/src/lib/services/dropdown-interaction.service.ts` | Delete entire file           | 272 lines  |
| `libs/backend/vscode-core/src/di/tokens.ts`                           | Delete legacy tokens         | ~3 lines   |

**Total**: ~475 lines of unnecessary code to remove
