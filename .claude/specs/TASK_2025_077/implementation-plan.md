# Implementation Plan - TASK_2025_077

## Deprecated Code Removal (Pre-Launch Cleanup)

### Problem

The extension fails to activate with:

```
CodeExpectedError: Unable to write to Workspace Settings because ptah.migration.secretsV1.completed is not a registered configuration.
```

Root cause: Migration code in `main.ts` tries to write to an unregistered config key. But per user's rule - **no backward compatibility code since we're not live yet**.

### Scope Analysis

| File                                                                  | Issue                                   | Lines            | Action           |
| --------------------------------------------------------------------- | --------------------------------------- | ---------------- | ---------------- |
| `apps/ptah-extension-vscode/src/main.ts`                              | Migration block (ROOT CAUSE)            | 28-71            | DELETE 40 lines  |
| `libs/backend/vscode-core/src/services/auth-secrets.service.ts`       | `migrateFromConfigManager()` method     | 262-385          | DELETE 123 lines |
| `libs/shared/src/lib/types/common.types.ts`                           | Deprecated `ChatMessage`, `ChatSession` | 3-45             | DELETE 42 lines  |
| `libs/frontend/core/src/lib/services/dropdown-interaction.service.ts` | Entire file deprecated                  | All              | DELETE 272 lines |
| `libs/frontend/core/src/lib/services/index.ts`                        | Export of deleted service               | 40-45            | DELETE 6 lines   |
| `libs/backend/vscode-core/src/di/tokens.ts`                           | Legacy tokens                           | 196-198, 343-344 | DELETE 5 lines   |

**Total**: ~488 lines of unnecessary code

### Dependency Analysis

#### `dropdown-interaction.service.ts`

- **Usage**: NONE in code (only in documentation/examples)
- **Safe to delete**: YES - CDK Overlay components replaced this

#### `ChatMessage` / `ChatSession` deprecated types

- **Usage**: Only in `docs/guides/LIBRARY_EXTRACTION_CHECKLIST.md` (documentation)
- **Safe to delete**: YES - code uses `ExecutionChatMessage`, `StrictChatMessage` instead

#### Legacy tokens `CLAUDE_SERVICE`, `WORKSPACE_ANALYZER`

- **Usage**: NONE in code (only defined, never injected)
- **Safe to delete**: YES - `WORKSPACE_ANALYZER_SERVICE` is the active token

#### `migrateFromConfigManager()` interface member

- **Usage**: Only in `main.ts` migration block (being deleted)
- **Safe to delete**: YES - remove from interface AND implementation

### Batch Plan

**Batch 1: Fix Activation Crash (Critical)**

- Delete migration code from `main.ts` (lines 34-71)
- Also remove `ConfigManager` import since it's no longer needed

**Batch 2: Remove Migration Infrastructure**

- Delete `migrateFromConfigManager()` from `IAuthSecretsService` interface
- Delete `migrateFromConfigManager()` implementation from `AuthSecretsService`

**Batch 3: Delete Deprecated Types**

- Delete `ChatMessage` interface from `common.types.ts`
- Delete `ChatSession` interface from `common.types.ts`
- Keep `ContextInfo`, `OptimizationSuggestion`, `WorkspaceInfo`, `TokenUsage`, `SessionInfo`

**Batch 4: Delete Deprecated Service**

- Delete `dropdown-interaction.service.ts` file entirely
- Remove export from `libs/frontend/core/src/lib/services/index.ts`

**Batch 5: Remove Legacy Tokens**

- Delete `CLAUDE_SERVICE` token definition and TOKENS entry
- Delete `WORKSPACE_ANALYZER` token definition and TOKENS entry

### Verification Steps

After each batch:

1. Run `npm run typecheck:all` - should pass
2. Run `npm run lint:all` - should pass
3. Run `npm run build:all` - should pass

After all batches:

1. Test extension activation (F5 in VS Code)
2. Verify no "Unable to write to Workspace Settings" error
3. Verify webview loads correctly
