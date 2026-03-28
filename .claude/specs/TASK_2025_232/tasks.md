# Development Tasks - TASK_2025_232: Bundle SDK Dependencies

**Total Tasks**: 8 | **Batches**: 3 | **Status**: 3/3 complete

---

## Plan Validation Summary

**Validation Status**: PASSED

### Assumptions Verified

- esbuild external array at `project.json:35-43` contains exactly the 3 SDK + 3 tree-sitter + vscode entries: VERIFIED
- Extension `package.json:564-571` dependencies contain exactly the 3 SDK + 3 tree-sitter entries: VERIFIED
- `sdk-module-loader.ts` has `dynamicImport()` (L36-38), `findPackageFromBinary()` (L50-73), `resolveAndImportSdk()` (L228-310), `SDK_PACKAGE_NAME` (L29): VERIFIED
- `sdk-resolver.ts` has `dynamicImport()` (L21-23), `resolveAndImportSdk()` (L35-71), `findPackageFromBinary()` (L83-106): VERIFIED
- `.vscodeignore` SDK exclusion rules at lines 79-97: VERIFIED
- `createRequire` banner polyfill at `project.json:32`: VERIFIED
- `getCliJsPath()` and `preload()` are still needed (independent of SDK import): VERIFIED
- Two callers of `resolveAndImportSdk`: `copilot-sdk.adapter.ts:901`, `codex-cli.adapter.ts:154`: VERIFIED

### Risks Identified

| Risk                                                                                | Severity | Mitigation                                                                                                        |
| ----------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------- |
| esbuild may warn on `import.meta.resolve("@github/copilot/sdk")` inside copilot-sdk | LOW      | esbuild passes through `import.meta.resolve()` for node targets; if it errors, add `@github/copilot` to externals |
| Codex SDK `createRequire().resolve("@openai/codex/package.json")` may cause warning | LOW      | Dead code path (codexPathOverride always provided); if esbuild errors, add `@openai/codex` to externals           |
| Claude SDK `require("ajv/...")` calls need CJS polyfill                             | LOW      | Already handled by `createRequire(import.meta.url)` banner; esbuild will inline ajv modules                       |

### Edge Cases to Handle

- [x] If esbuild cannot resolve `@github/copilot` or `@openai/codex` (CLI binary packages, not SDK), add them to externals -- VERIFIED: build passed with zero errors, no fallbacks needed
- [x] Ensure `import.meta.url` in bundled `main.mjs` works correctly with `createRequire` for tree-sitter resolution -- VERIFIED: tree-sitter correctly external, createRequire banner operational

---

## Batch 1: Build Configuration and Dependency Cleanup -- COMPLETE

**Developer**: backend-developer
**Tasks**: 3 | **Dependencies**: None
**Commit**: e3d7f908

### Task 1.1: Remove SDK packages from esbuild external array -- COMPLETE

**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\project.json`
**Spec Reference**: implementation-plan.md Phase 1 (lines 162-189)

**What to change**:

Remove 3 entries from the `external` array (lines 35-43). Change from:

```json
"external": [
  "vscode",
  "@anthropic-ai/claude-agent-sdk",
  "@github/copilot-sdk",
  "@openai/codex-sdk",
  "tree-sitter",
  "tree-sitter-javascript",
  "tree-sitter-typescript"
]
```

To:

```json
"external": [
  "vscode",
  "tree-sitter",
  "tree-sitter-javascript",
  "tree-sitter-typescript"
]
```

**Quality Requirements**:

- Only remove the 3 SDK entries; keep `vscode` and all 3 `tree-sitter` entries
- JSON must remain valid

---

### Task 1.2: Remove SDK packages from extension package.json dependencies -- COMPLETE

**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\package.json`
**Spec Reference**: implementation-plan.md Phase 4 (lines 275-301)

**What to change**:

Remove 3 SDK entries from `dependencies` (lines 564-571). Change from:

```json
"dependencies": {
  "@anthropic-ai/claude-agent-sdk": "^0.2.81",
  "@github/copilot-sdk": "^0.1.25",
  "@openai/codex-sdk": "^0.104.0",
  "tree-sitter": "^0.21.1",
  "tree-sitter-javascript": "^0.23.1",
  "tree-sitter-typescript": "^0.23.2"
}
```

To:

```json
"dependencies": {
  "tree-sitter": "^0.21.1",
  "tree-sitter-javascript": "^0.23.1",
  "tree-sitter-typescript": "^0.23.2"
}
```

**Quality Requirements**:

- Only remove the 3 SDK entries; keep all 3 tree-sitter entries
- Do NOT modify the root workspace `package.json` -- SDKs must remain there for build-time resolution
- JSON must remain valid

---

### Task 1.3: Remove SDK exclusion rules from .vscodeignore -- COMPLETE

**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\.vscodeignore`
**Spec Reference**: implementation-plan.md Phase 5 (lines 303-333)

**What to change**:

Remove lines 79-97 (the SDK CLI binary exclusion rules). These blocks become unnecessary since the SDK packages will no longer be in `node_modules/` after packaging:

```
# SDK CLI binaries -- only the SDK JS API is needed, not the CLI tools
# @anthropic-ai/claude-agent-sdk: vendor/ has CLI binary (43 MB), cli.js (13 MB)
**/node_modules/@anthropic-ai/claude-agent-sdk/vendor/**
**/node_modules/@anthropic-ai/claude-agent-sdk/cli.js
**/node_modules/@anthropic-ai/claude-agent-sdk/resvg.wasm
# @github/copilot: entire CLI package (128+ MB) -- only copilot-sdk is needed
**/node_modules/@github/copilot/**
**/node_modules/@github/copilot-win32-x64/**
**/node_modules/@github/copilot-linux-x64/**
**/node_modules/@github/copilot-darwin-arm64/**
**/node_modules/@github/copilot-darwin-x64/**
# @openai/codex: CLI binary (102 MB)
**/node_modules/@openai/codex-win32-x64/**
**/node_modules/@openai/codex-linux-x64/**
**/node_modules/@openai/codex-darwin-arm64/**
**/node_modules/@openai/codex-darwin-x64/**
**/node_modules/@openai/codex/**
# @img/sharp: not needed at runtime
**/node_modules/@img/**
```

**Quality Requirements**:

- Remove the entire block from `# SDK CLI binaries` comment through `**/node_modules/@img/**`
- Keep the generic `node_modules/` trimming rules (lines 44-70) -- they are defensive safety
- Keep the `# Native module C source files` section (lines 98-100)
- Keep the `# Monaco Editor` and `# Python scripts` sections above (lines 72-77)

---

**Batch 1 Verification**:

- All 3 files modified at correct locations
- JSON files remain valid (`project.json`, `package.json`)
- `.vscodeignore` retains generic trimming rules and native module rules
- No other files affected
- Build passes: `npx nx build ptah-extension-vscode`

---

## Batch 2: Dead Code Removal -- COMPLETE

**Developer**: backend-developer
**Tasks**: 3 | **Dependencies**: Batch 1 (SDK packages must be bundled for static import to work)
**Commit**: a90d7059

### Task 2.1: Simplify SdkModuleLoader to use static import -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\sdk-module-loader.ts`
**Spec Reference**: implementation-plan.md Phase 2 (lines 191-229)
**Pattern to Follow**: The simplified version uses a top-level static import instead of runtime resolution

**What to change**:

1. **Add static import** at top of file (after existing imports):

   ```typescript
   import { query } from '@anthropic-ai/claude-agent-sdk';
   ```

2. **Remove the `SDK_PACKAGE_NAME` constant** (line 29):

   ```typescript
   const SDK_PACKAGE_NAME = '@anthropic-ai/claude-agent-sdk';
   ```

3. **Remove the `dynamicImport()` function** (lines 36-38):

   ```typescript
   async function dynamicImport(specifier: string): Promise<unknown> {
     return import(specifier);
   }
   ```

4. **Remove the `findPackageFromBinary()` function** (lines 50-73)

5. **Remove unused imports** from line 21-23:
   - Remove: `realpathSync`, `existsSync` from `fs`
   - Remove: `dirname`, `join`, `sep` from `path`
   - Remove: `pathToFileURL` from `url`
   - Keep: `injectable`, `inject` from `tsyringe`
   - Keep: `Logger`, `TOKENS` from `@ptah-extension/vscode-core`
   - Keep: `QueryFunction` from `../types/sdk-types/claude-sdk.types`
   - Keep: `ClaudeCliDetector` from `../detector/claude-cli-detector`
   - Keep: `SDK_TOKENS` from `../di/tokens`

6. **Simplify `getQueryFunction()`** (lines 115-135). Replace the body to use the static import:

   ```typescript
   async getQueryFunction(): Promise<QueryFunction> {
     if (this.cachedSdkQuery) {
       return this.cachedSdkQuery;
     }

     this.cachedSdkQuery = query as QueryFunction;
     this.logger.info('[SdkModuleLoader] SDK query function cached (bundled)');
     return this.cachedSdkQuery;
   }
   ```

7. **Remove the entire `resolveAndImportSdk()` private method** (lines 215-310)

8. **Update the class JSDoc** (lines 76-84) to reflect that the SDK is now bundled, not runtime-resolved

9. **Update the file header comment** (lines 1-18) to reflect the SDK is bundled

**What to KEEP**:

- `preload()` method (lines 147-165) -- still useful for activation-time caching
- `getCliJsPath()` method (lines 177-199) -- still needed for `pathToClaudeCodeExecutable`
- `isLoaded()` method (lines 204-206)
- `clearCache()` method (lines 211-214)
- `cachedSdkQuery` and `cachedCliJsPath` fields
- Constructor with DI injections

**Quality Requirements**:

- No `// TODO`, `// PLACEHOLDER`, or `// STUB` comments
- File should go from ~311 lines to ~100-120 lines
- All remaining methods must have complete implementations

---

### Task 2.2: Simplify sdk-resolver.ts to pass-through import -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-adapters\sdk-resolver.ts`
**Spec Reference**: implementation-plan.md Phase 3 (lines 231-272)

**What to change**:

Replace the entire file content. The file currently has 106 lines of runtime resolution logic. Replace with a simplified pass-through:

1. **Remove all imports** (lines 12-14):

   ```typescript
   import { realpathSync, existsSync } from 'fs';
   import { dirname, join, sep } from 'path';
   import { pathToFileURL } from 'url';
   ```

2. **Remove `dynamicImport()` function** (lines 21-23)

3. **Remove `findPackageFromBinary()` function** (lines 83-106)

4. **Simplify `resolveAndImportSdk()`** (lines 35-71) to:

   ```typescript
   /**
    * Import an SDK package. With esbuild bundling, the package is resolved
    * at bundle time and the dynamic import() returns the bundled module.
    *
    * The cliBinaryPath parameter is retained for API compatibility but unused
    * since SDKs are now bundled into main.mjs.
    */
   export async function resolveAndImportSdk<T>(packageName: string, _cliBinaryPath?: string): Promise<T> {
     return (await import(packageName)) as T;
   }
   ```

5. **Update the file header comment** (lines 1-11) to reflect bundling

**Quality Requirements**:

- Function signature preserved (same name, same generic type parameter, same parameter types)
- Both callers (`copilot-sdk.adapter.ts:901` and `codex-cli.adapter.ts:154`) continue to work without modification
- File should go from ~106 lines to ~20-25 lines
- No unused imports remain

---

### Task 2.3: Update comments in adapter files that reference runtime resolution -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-adapters\copilot-sdk.adapter.ts`
**File**: `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-adapters\codex-cli.adapter.ts`
**Spec Reference**: implementation-plan.md Phase 3 (note about callers)

**What to change**:

Update JSDoc comments in both adapter files that reference "NOT bundled" / "resolved at runtime":

1. In `copilot-sdk.adapter.ts` around line 896-900, update the comment block:
   - Old: "The SDK is NOT bundled with the extension. It is resolved at runtime from the user's system via resolveAndImportSdk()..."
   - New: "The SDK is bundled with the extension. resolveAndImportSdk() returns the bundled module via dynamic import()."

2. In `codex-cli.adapter.ts` around line 144-148, update the comment block:
   - Old: "The package is NOT bundled with the extension. It is resolved at runtime from the user's system via resolveAndImportSdk()..."
   - New: "The SDK is bundled with the extension. resolveAndImportSdk() returns the bundled module via dynamic import()."

**Quality Requirements**:

- Only comment changes, no logic changes
- Do not change any function signatures or import statements

---

**Batch 2 Verification**:

- `sdk-module-loader.ts` reduced from ~311 to ~100-120 lines
- `sdk-resolver.ts` reduced from ~106 to ~20-25 lines
- No unused imports in any file
- No `// TODO` or placeholder comments
- Both adapter files still compile (comments only changed)
- Build passes: `npx nx build ptah-extension-vscode`
- code-logic-reviewer approved

---

## Batch 3: Build Verification and Fallback Handling -- COMPLETE

**Developer**: backend-developer
**Tasks**: 2 | **Dependencies**: Batch 1 + Batch 2
**Commit**: N/A (verification-only batch, no source code changes)

### Task 3.1: Run build and resolve any esbuild warnings or errors -- COMPLETE

**Spec Reference**: implementation-plan.md Phase 6 (lines 335-362)

**What to do**:

1. Run `npx nx build ptah-extension-vscode` and capture output
2. Check for esbuild warnings about unresolvable packages:
   - If `@github/copilot` causes an error (the CLI binary package, not SDK), add it to externals in `project.json`
   - If `@openai/codex` causes an error (the CLI binary package, not SDK), add it to externals in `project.json`
   - If `ajv` related warnings appear, verify the `createRequire` banner handles them
3. Check the bundle output:
   - Verify `dist/apps/ptah-extension-vscode/main.mjs` exists
   - Verify SDK bare imports are NOT present in the output (code is inlined)
   - Verify tree-sitter imports ARE present (still external)

**If build fails**: Apply the fallback from the implementation plan -- add CLI binary packages to externals:

```json
"external": [
  "vscode",
  "tree-sitter",
  "tree-sitter-javascript",
  "tree-sitter-typescript",
  "@github/copilot",
  "@openai/codex"
]
```

**Quality Requirements**:

- Build must succeed with zero errors
- Warnings are acceptable only if they are non-fatal and documented

---

### Task 3.2: Verify bundle contents and VSIX packaging -- COMPLETE

**What to do**:

1. After successful build, verify bundle contents:

   ```bash
   # Check main.mjs size (expected: ~5-6 MB)
   ls -la dist/apps/ptah-extension-vscode/main.mjs

   # Verify SDKs are inlined (no bare imports)
   grep -c "@anthropic-ai/claude-agent-sdk" dist/apps/ptah-extension-vscode/main.mjs
   # Expected: 0

   grep -c "@github/copilot-sdk" dist/apps/ptah-extension-vscode/main.mjs
   # Expected: 0

   grep -c "@openai/codex-sdk" dist/apps/ptah-extension-vscode/main.mjs
   # Expected: 0

   # Verify tree-sitter still external
   grep -c "tree-sitter" dist/apps/ptah-extension-vscode/main.mjs
   # Expected: > 0
   ```

2. Run pre-package and verify node_modules:

   ```bash
   npx nx run ptah-extension-vscode:pre-package

   # Check node_modules -- should only have tree-sitter
   ls dist/apps/ptah-extension-vscode/node_modules/
   # Expected: NO @anthropic-ai, @github, @openai directories
   ```

**Quality Requirements**:

- `main.mjs` size between 4-7 MB
- No SDK bare imports in bundle
- `node_modules/` contains only tree-sitter packages
- No `require("ajv/...")` unresolved calls in bundle

---

**Batch 3 Verification**:

- Build succeeds with no errors
- Bundle size within targets (main.mjs: 4-7 MB)
- SDKs inlined, tree-sitter external
- Pre-package produces clean node_modules
- All verification checks pass
