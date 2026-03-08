# TASK_2025_077: Deprecated Code Removal (Pre-Launch Cleanup)

## Status: COMPLETED

## Summary

Removed all backward compatibility, migration, and deprecated code from the codebase. The project is not live yet, so there were no users to migrate - this code was unnecessary complexity that caused an activation failure.

**Root Cause of Crash**: `main.ts` migration code tried to write to `ptah.migration.secretsV1.completed` config key which was never registered in `package.json`.

**User's Rule**: No backward compatibility code allowed since project is not live.

## Changes Made

### Batch 1: Fix Activation Crash (Critical)

**File**: `apps/ptah-extension-vscode/src/main.ts`

- Removed migration block (lines 34-71)
- Removed `IAuthSecretsService`, `ConfigManager` imports (no longer needed)
- **Impact**: Fixes extension activation crash

### Batch 2: Remove Migration Infrastructure

**File**: `libs/backend/vscode-core/src/services/auth-secrets.service.ts`

- Removed `migrateFromConfigManager()` from `IAuthSecretsService` interface
- Removed `migrateFromConfigManager()` implementation (123 lines)
- Removed `ConfigManager` import and constructor injection
- Removed `getConfigKey()` private method (only used by migration)
- **Impact**: Simplified auth secrets service

### Batch 3: Delete Deprecated Types

**File**: `libs/shared/src/lib/types/common.types.ts`

- Deleted `ChatMessage` interface (deprecated, replaced by `StrictChatMessage`)
- Deleted `ChatSession` interface (deprecated, replaced by `StrictChatSession`)
- Deleted `SessionInfo` interface (dead code, referenced deleted `ChatMessage`)
- Removed imports from `message.types.ts` (no longer needed)
- **Impact**: Cleaner type definitions, no confusion from deprecated types

### Batch 4: Delete Deprecated Service

**File**: `libs/frontend/core/src/lib/services/dropdown-interaction.service.ts`

- Deleted entire file (272 lines)
- Service was deprecated in favor of CDK Overlay components (TASK_2025_048)

**File**: `libs/frontend/core/src/lib/services/index.ts`

- Removed export of `DropdownInteractionService` and related types

### Batch 5: Remove Legacy Tokens

**File**: `libs/backend/vscode-core/src/di/tokens.ts`

- Deleted `CLAUDE_SERVICE` token definition (unused)
- Deleted `WORKSPACE_ANALYZER` token definition (superseded by `WORKSPACE_ANALYZER_SERVICE`)
- Removed from `TOKENS` object

**File**: `libs/backend/template-generation/src/lib/services/template-generator.service.ts`

- Changed `TOKENS.WORKSPACE_ANALYZER` to `TOKENS.WORKSPACE_ANALYZER_SERVICE`
- **Impact**: Uses active token instead of legacy token

## Lines Removed

| File                            | Lines Removed           |
| ------------------------------- | ----------------------- |
| main.ts                         | ~40 lines               |
| auth-secrets.service.ts         | ~130 lines              |
| common.types.ts                 | ~55 lines               |
| dropdown-interaction.service.ts | 272 lines (entire file) |
| index.ts (core services)        | 6 lines                 |
| tokens.ts                       | ~5 lines                |

**Total**: ~508 lines of unnecessary code removed

## Verification

- `npm run typecheck:all` - PASSED
- `npm run build:all` - PASSED
- Extension activation - Should no longer crash

## Files Modified

1. `apps/ptah-extension-vscode/src/main.ts`
2. `libs/backend/vscode-core/src/services/auth-secrets.service.ts`
3. `libs/shared/src/lib/types/common.types.ts`
4. `libs/frontend/core/src/lib/services/index.ts`
5. `libs/backend/vscode-core/src/di/tokens.ts`
6. `libs/backend/template-generation/src/lib/services/template-generator.service.ts`

## Files Deleted

1. `libs/frontend/core/src/lib/services/dropdown-interaction.service.ts`
