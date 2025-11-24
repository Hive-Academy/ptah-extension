# Development Tasks - TASK_2025_023

**Task Type**: Bugfix (Backend)
**Total Tasks**: 6
**Total Batches**: 2
**Batching Strategy**: Layer-based (adapter creation → service updates)
**Status**: 2/2 batches complete (100%) - ALL COMPLETE

---

## Batch 1: Create FileSystemAdapter & Fix Token Import ✅ COMPLETE

**Assigned To**: backend-developer
**Tasks in Batch**: 2
**Dependencies**: None (foundation work)
**Git Commit**: 5968207
**Commit Message**: fix(template-generation): create filesystem adapter and fix token

### Task 1.1: Fix DI token import in template-file-manager.service.ts ✅ COMPLETE

**File(s)**: `D:\projects\ptah-extension\libs\backend\template-generation\src\lib\services\template-file-manager.service.ts`

**Specification Reference**:

- Error: template-file-manager.service.ts:17:20 - Property 'FILE_SYSTEM' does not exist on type TOKENS
- Solution: TOKENS.FILE_SYSTEM → TOKENS.FILE_SYSTEM_SERVICE (exists at libs/backend/vscode-core/src/di/tokens.ts:49)

**Implementation Details**:

- **Line to Change**: Line 17
- **Current Code**: `@inject(TOKENS.FILE_SYSTEM) private readonly fileSystem: FileSystemService,`
- **New Code**: `@inject(TOKENS.FILE_SYSTEM_SERVICE) private readonly fileSystem: FileSystemService,`
- **Import to Verify**: `FileSystemService` imported from `@ptah-extension/workspace-intelligence` (line 7)

**Expected Commit Pattern**: `fix(template-generation): correct DI token for FileSystemService injection`

**Quality Requirements**:

- ✅ Token reference resolves to `TOKENS.FILE_SYSTEM_SERVICE`
- ✅ No TypeScript errors on injection line
- ✅ Imports remain unchanged (FileSystemService from workspace-intelligence)

---

### Task 1.2: Create FileSystemAdapter service ✅ COMPLETE

**File(s)**: `D:\projects\ptah-extension\libs\backend\template-generation\src\lib\adapters\file-system.adapter.ts` (NEW FILE)

**Specification Reference**:

- Solution for errors: Missing methods (createDirectory, writeFile, copyDirectoryRecursive)
- Pattern: Adapter wraps workspace-intelligence FileSystemService, converts string paths → vscode.Uri

**Implementation Details**:

**Create new file**: `D:\projects\ptah-extension\libs\backend\template-generation\src\lib\adapters\file-system.adapter.ts`

**File Structure**:

```typescript
import { injectable, inject } from 'tsyringe';
import * as vscode from 'vscode';
import { Result } from '@ptah-extension/shared';
import { TOKENS } from '@ptah-extension/vscode-core';
import { FileSystemService } from '@ptah-extension/workspace-intelligence';

/**
 * FileSystemAdapter - Adapter for workspace-intelligence FileSystemService
 *
 * Bridges the API gap between template-generation (string paths, Result returns)
 * and workspace-intelligence FileSystemService (Uri-based, throws errors).
 *
 * Responsibilities:
 * - Convert string file paths to vscode.Uri
 * - Wrap FileSystemService calls with Result<T, Error> pattern
 * - Implement missing methods (createDirectory, writeFile, copyDirectoryRecursive)
 * - Catch thrown errors and return as Result.err()
 */
@injectable()
export class FileSystemAdapter {
  constructor(@inject(TOKENS.FILE_SYSTEM_SERVICE) private readonly fileSystemService: FileSystemService) {}

  /**
   * Read file contents as string
   * @param filePath - Absolute file path (string)
   * @returns Result containing file content or error
   */
  async readFile(filePath: string): Promise<Result<string, Error>> {
    try {
      const uri = vscode.Uri.file(filePath);
      const content = await this.fileSystemService.readFile(uri);
      return Result.ok(content);
    } catch (error) {
      return Result.err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Write file contents (creates parent directories if needed)
   * @param filePath - Absolute file path (string)
   * @param content - File content to write
   * @returns Result indicating success or error
   */
  async writeFile(filePath: string, content: string): Promise<Result<void, Error>> {
    try {
      const uri = vscode.Uri.file(filePath);
      const bytes = new TextEncoder().encode(content);
      await vscode.workspace.fs.writeFile(uri, bytes);
      return Result.ok(undefined);
    } catch (error) {
      return Result.err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Create directory (including parent directories)
   * @param dirPath - Absolute directory path (string)
   * @returns Result indicating success or error
   */
  async createDirectory(dirPath: string): Promise<Result<void, Error>> {
    try {
      const uri = vscode.Uri.file(dirPath);
      await vscode.workspace.fs.createDirectory(uri);
      return Result.ok(undefined);
    } catch (error) {
      return Result.err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Recursively copy directory from source to destination
   * @param sourceDir - Source directory path (string)
   * @param destDir - Destination directory path (string)
   * @returns Result indicating success or error
   */
  async copyDirectoryRecursive(sourceDir: string, destDir: string): Promise<Result<void, Error>> {
    try {
      const sourceUri = vscode.Uri.file(sourceDir);
      const destUri = vscode.Uri.file(destDir);

      // Read source directory
      const entries = await this.fileSystemService.readDirectory(sourceUri);

      // Create destination directory
      await vscode.workspace.fs.createDirectory(destUri);

      // Copy each entry recursively
      for (const [name, type] of entries) {
        const srcPath = vscode.Uri.joinPath(sourceUri, name);
        const dstPath = vscode.Uri.joinPath(destUri, name);

        if (type === vscode.FileType.Directory) {
          // Recursive copy for directories
          const recursiveResult = await this.copyDirectoryRecursive(srcPath.fsPath, dstPath.fsPath);
          if (recursiveResult.isErr()) {
            return recursiveResult;
          }
        } else {
          // Copy file
          await vscode.workspace.fs.copy(srcPath, dstPath, { overwrite: true });
        }
      }

      return Result.ok(undefined);
    } catch (error) {
      return Result.err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Check if file/directory exists
   * @param filePath - File or directory path (string)
   * @returns Result containing boolean or error
   */
  async exists(filePath: string): Promise<Result<boolean, Error>> {
    try {
      const uri = vscode.Uri.file(filePath);
      const exists = await this.fileSystemService.exists(uri);
      return Result.ok(exists);
    } catch (error) {
      return Result.err(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
```

**Expected Commit Pattern**: Will be included in batch commit

**Quality Requirements**:

- ✅ All methods convert string paths to vscode.Uri
- ✅ All methods return Result<T, Error> (no thrown exceptions)
- ✅ Implements 5 methods: readFile, writeFile, createDirectory, copyDirectoryRecursive, exists
- ✅ Uses @injectable() decorator for DI
- ✅ Injects TOKENS.FILE_SYSTEM_SERVICE correctly
- ✅ TypeScript compiles without errors

---

**Batch 1 Verification Requirements**:

- ✅ Token import fixed in template-file-manager.service.ts
- ✅ New file created: `D:\projects\ptah-extension\libs\backend\template-generation\src\lib\adapters\file-system.adapter.ts`
- ✅ FileSystemAdapter exports correctly
- ✅ No compilation errors in batch files
- ✅ ONE git commit for entire batch

**Batch 1 Commit Message Format**:

```
fix(template-generation): batch 1 - create filesystem adapter and fix token

- Task 1.1: correct DI token from FILE_SYSTEM to FILE_SYSTEM_SERVICE
- Task 1.2: add FileSystemAdapter to bridge workspace-intelligence API
```

---

## Batch 2: Update Services to Use FileSystemAdapter ✅ COMPLETE

**Assigned To**: backend-developer
**Tasks in Batch**: 4
**Dependencies**: Batch 1 complete (FileSystemAdapter must exist)
**Git Commit**: 88418b8
**Commit Message**: fix(template-generation): integrate filesystem adapter into services
**Additional Fix Commit**: 9bb65ab (TypeScript type errors in template-manager)

### Task 2.1: Update template-file-manager to use FileSystemAdapter ✅ COMPLETE

**File(s)**: `D:\projects\ptah-extension\libs\backend\template-generation\src\lib\services\template-file-manager.service.ts`

**Specification Reference**:

- Fix errors: Lines 67, 110, 121 (createDirectory, writeFile calls)
- Solution: Change injected type from FileSystemService to FileSystemAdapter

**Dependencies**: Task 1.2 (FileSystemAdapter must exist)

**Implementation Details**:

**Changes Required**:

1. **Line 7 - Update import**:

   - **Current**: `import { FileSystemService } from '@ptah-extension/workspace-intelligence';`
   - **New**: `import { FileSystemAdapter } from '../adapters/file-system.adapter';`

2. **Line 17 - Update injected type**:

   - **Current**: `@inject(TOKENS.FILE_SYSTEM_SERVICE) private readonly fileSystem: FileSystemService,`
   - **New**: `@inject(TOKENS.FILE_SYSTEM_SERVICE) private readonly fileSystem: FileSystemAdapter,`

3. **Verify method calls still work** (no changes needed, adapter has same signatures):
   - Line 67: `this.fileSystem.createDirectory(templatesDir)` ✅
   - Line 110: `this.fileSystem.createDirectory(dirPath)` ✅
   - Line 121: `this.fileSystem.writeFile(filePath, content)` ✅
   - Line 150: `this.fileSystem.readFile(filePath)` ✅
   - Line 205: `this.fileSystem.copyDirectoryRecursive(sourceDir, destDir)` ✅

**Expected Commit Pattern**: Will be included in batch commit

**Quality Requirements**:

- ✅ Import changed from FileSystemService to FileSystemAdapter
- ✅ Injected type changed to FileSystemAdapter
- ✅ All method calls resolve correctly
- ✅ No TypeScript errors in file
- ✅ Result<T, Error> pattern maintained

---

### Task 2.2: Fix token import in template-manager.service.ts ✅ COMPLETE

**File(s)**: `D:\projects\ptah-extension\libs\backend\template-generation\src\lib\services\template-manager.service.ts`

**Specification Reference**:

- Error: template-manager.service.ts:19 - Property 'FILE_SYSTEM' does not exist
- Solution: TOKENS.FILE_SYSTEM → TOKENS.FILE_SYSTEM_SERVICE

**Implementation Details**:

**Changes Required**:

1. **Line 4 - Fix import (remove FileSystemService from vscode-core)**:

   - **Current**: `import { Logger, FileSystemService, TOKENS } from '@ptah-extension/vscode-core';`
   - **New**: `import { Logger, TOKENS } from '@ptah-extension/vscode-core';`

2. **Line 19 - Fix token reference**:

   - **Current**: `@inject(TOKENS.FILE_SYSTEM) private readonly fileSystem: FileSystemService,`
   - **New**: `@inject(TOKENS.FILE_SYSTEM_SERVICE) private readonly fileSystem: FileSystemService,`

3. **Add import for FileSystemService** (after line 3):
   - **New Line**: `import { FileSystemService } from '@ptah-extension/workspace-intelligence';`

**Expected Commit Pattern**: Will be included in batch commit

**Quality Requirements**:

- ✅ FileSystemService imported from correct library (workspace-intelligence)
- ✅ Token changed to FILE_SYSTEM_SERVICE
- ✅ No TypeScript errors
- ✅ vscode-core import cleaned (no FileSystemService)

---

### Task 2.3: Update template-manager to use FileSystemAdapter ✅ COMPLETE

**File(s)**: `D:\projects\ptah-extension\libs\backend\template-generation\src\lib\services\template-manager.service.ts`

**Specification Reference**:

- Fix API mismatch: readFile expects vscode.Uri but receives string (line 53)
- Solution: Use FileSystemAdapter which handles string paths

**Dependencies**: Task 1.2 (FileSystemAdapter must exist), Task 2.2 (token fix)

**Implementation Details**:

**Changes Required**:

1. **After Task 2.2, update import again**:

   - **Current (after 2.2)**: `import { FileSystemService } from '@ptah-extension/workspace-intelligence';`
   - **New**: `import { FileSystemAdapter } from '../adapters/file-system.adapter';`

2. **Line 19 - Update injected type**:

   - **Current**: `@inject(TOKENS.FILE_SYSTEM_SERVICE) private readonly fileSystem: FileSystemService,`
   - **New**: `@inject(TOKENS.FILE_SYSTEM_SERVICE) private readonly fileSystem: FileSystemAdapter,`

3. **Verify method call works** (no changes needed):
   - Line 53: `this.fileSystem.readFile(templatePath)` ✅ (adapter accepts string)

**Expected Commit Pattern**: Will be included in batch commit

**Quality Requirements**:

- ✅ Import changed from FileSystemService to FileSystemAdapter
- ✅ Injected type changed to FileSystemAdapter
- ✅ readFile() call resolves correctly with string path
- ✅ No TypeScript errors

---

### Task 2.4: Register FileSystemAdapter in DI container ✅ COMPLETE

**File(s)**:

- `D:\projects\ptah-extension\libs\backend\template-generation\src\lib\di\registration.ts`
- `D:\projects\ptah-extension\libs\backend\template-generation\src\index.ts` (if needed for export)

**Specification Reference**:

- Ensure FileSystemAdapter is properly registered for injection
- Pattern: Follow existing template-generation service registrations

**Implementation Details**:

1. **Check registration.ts** (read it first to see current structure)
2. **Add FileSystemAdapter registration**:

   ```typescript
   import { FileSystemAdapter } from '../adapters/file-system.adapter';

   // In registration function:
   container.registerSingleton(TOKENS.FILE_SYSTEM_SERVICE, FileSystemAdapter);
   ```

   **CRITICAL**: Use `TOKENS.FILE_SYSTEM_SERVICE` (shared token) NOT a new token

3. **Update index.ts** (if adapter needs to be exported):
   - Check if internal adapters should be exported
   - Likely NOT needed (internal implementation detail)

**Expected Commit Pattern**: Will be included in batch commit

**Quality Requirements**:

- ✅ FileSystemAdapter registered with TOKENS.FILE_SYSTEM_SERVICE
- ✅ Uses .registerSingleton() (only one instance needed)
- ✅ Registration follows existing pattern in file
- ✅ No duplicate registrations for same token
- ✅ TypeScript compiles correctly

---

**Batch 2 Verification Requirements**:

- ✅ All 4 service files updated correctly
- ✅ FileSystemAdapter registered in DI container
- ✅ Build passes: `npx nx build template-generation` (0 errors)
- ✅ All files use FileSystemAdapter (not FileSystemService directly)
- ✅ All token references use FILE_SYSTEM_SERVICE
- ✅ ONE git commit for entire batch

**Batch 2 Commit Message Format**:

```
fix(template-generation): batch 2 - integrate filesystem adapter into services

- Task 2.1: update template-file-manager to use adapter
- Task 2.2: fix token import in template-manager
- Task 2.3: update template-manager to use adapter
- Task 2.4: register adapter in DI container
```

---

## Batch Execution Protocol

**For Each Batch**:

1. Team-leader assigns entire batch to backend-developer
2. Developer executes ALL tasks in batch (in order)
3. Developer stages files progressively (git add after each task)
4. Developer creates ONE commit for entire batch (after all tasks complete)
5. Developer returns with batch git commit SHA
6. Team-leader verifies entire batch
7. If verification passes: Assign next batch
8. If verification fails: Create fix batch

**Commit Strategy**:

- ONE commit per batch (not per task)
- Commit message lists all completed tasks
- Follows commitlint rules: `fix(template-generation): batch N - description`
- All lowercase, proper scope, imperative mood

**Completion Criteria**:

- All batch statuses are "✅ COMPLETE"
- All batch commits verified (2 commits total)
- All files exist at specified paths
- Build passes: `npx nx build template-generation` (0 errors)
- No TypeScript compilation errors

---

## Verification Protocol

**After Batch Completion**:

1. Developer updates all task statuses in batch to "✅ COMPLETE"
2. Developer adds git commit SHA to batch header
3. Team-leader verifies:
   - Batch commit exists: `git log --oneline -1`
   - All files in batch exist: `Read([file-path])` for each task
   - Build passes: `npx nx build template-generation`
   - Token references correct: All use FILE_SYSTEM_SERVICE
   - API calls resolve: No "does not exist" errors
4. If all pass: Update batch status to "✅ COMPLETE", assign next batch
5. If any fail: Mark batch as "❌ PARTIAL", create fix batch

---

## Final Build Verification

**After Both Batches Complete**:

```bash
# Full build (should pass with 0 errors)
npx nx build template-generation

# Verify affected projects still build
npx nx run-many --target=build --projects=tag:backend

# Type check
npx nx run template-generation:lint
```

**Expected Results**:

- ✅ 0 TypeScript errors (currently 20+ errors)
- ✅ All imports resolve correctly
- ✅ All DI tokens resolve correctly
- ✅ FileSystemAdapter correctly bridges workspace-intelligence API
- ✅ Result<T, Error> pattern maintained throughout

---

## Architecture Notes

**Adapter Pattern Benefits**:

1. **Separation of Concerns**: template-generation doesn't need to know about vscode.Uri
2. **API Stability**: Changes to workspace-intelligence don't break template-generation
3. **Testability**: Can mock FileSystemAdapter easily in tests
4. **Consistency**: All template-generation code uses string paths (familiar pattern)
5. **Error Handling**: Unified Result<T, Error> pattern (no mixed throw/Result)

**Alternative Approaches Rejected**:

- ❌ **Option A (Extend workspace-intelligence)**: Pollutes shared library with template-specific methods
- ❌ **Option C (Refactor to Uri)**: Large refactor, breaks existing code patterns, high risk

**Token Strategy**:

- Use existing `TOKENS.FILE_SYSTEM_SERVICE` (shared token)
- Register FileSystemAdapter with this token in template-generation
- workspace-intelligence's FileSystemService uses same token elsewhere
- DI container resolves correct implementation based on registration order

---

## Success Metrics

**Before Fix**:

- ❌ 20+ TypeScript errors
- ❌ Build fails
- ❌ Can't use template-generation library

**After Fix**:

- ✅ 0 TypeScript errors
- ✅ Build succeeds
- ✅ template-generation ready for use
- ✅ Clean separation of concerns
- ✅ Future-proof architecture
