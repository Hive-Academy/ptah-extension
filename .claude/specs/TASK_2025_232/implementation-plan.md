# Implementation Plan - TASK_2025_232: Bundle SDK Dependencies into esbuild Output

## Codebase Investigation Summary

### SDKs Analyzed

| SDK              | Package                          | Installed Size        | JS API Size        | Module Format            | Has Native Bindings                                   | Bundleable         |
| ---------------- | -------------------------------- | --------------------- | ------------------ | ------------------------ | ----------------------------------------------------- | ------------------ |
| Claude Agent SDK | `@anthropic-ai/claude-agent-sdk` | ~47 MB (with vendor/) | 608 KB (`sdk.mjs`) | ESM (`"type": "module"`) | No (vendor/ is CLI binary, stripped by .vscodeignore) | YES                |
| Copilot SDK      | `@github/copilot-sdk`            | 230 KB (`dist/`)      | 230 KB             | ESM (`"type": "module"`) | No                                                    | YES (with caveats) |
| Codex SDK        | `@openai/codex-sdk`              | 56 KB (`dist/`)       | 56 KB              | ESM (`"type": "module"`) | No                                                    | YES (with caveats) |

### Critical Findings

#### 1. Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`)

**Entry point**: `sdk.mjs` (608 KB, 105 lines -- already minified/bundled by Anthropic)
**Dependencies**: Zero runtime `dependencies` in package.json. `zod` is a `peerDependency` but is inlined in `sdk.mjs`.
**Dynamic requires**: Uses `require("ajv/dist/runtime/equal")`, `require("ajv/dist/runtime/ucs2length")`, `require("ajv/dist/runtime/uri")`, `require("ajv/dist/runtime/validation_error")`, `require("ajv-formats/dist/formats")` -- all five are CJS requires that esbuild will resolve since `ajv` and `ajv-formats` are installed.
**Dynamic imports**: Only `import('node:buffer')` -- a Node.js built-in, not a problem.
**`import.meta.url`**: Used in two places to resolve `cli.js` path relative to the SDK location. The `pathToClaudeCodeExecutable` option overrides this (already implemented in TASK_2025_194).
**Evidence**: `D:/projects/ptah-extension/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs` line 58 (the `Aa` query function uses `pathToClaudeCodeExecutable` with `import.meta.url` as fallback).

**Bundling verdict**: SAFE TO BUNDLE. The `pathToClaudeCodeExecutable` override in `SdkModuleLoader.getCliJsPath()`, `PtahCliAdapter`, `PtahCliRegistry`, and `InternalQueryService` already handles the `import.meta.url` problem. The `require("ajv/...")` calls will be resolved by esbuild since the banner already provides `createRequire(import.meta.url)`.

#### 2. Copilot SDK (`@github/copilot-sdk`)

**Entry point**: `dist/index.js` (re-exports from `client.js`, `session.js`, `types.js`)
**Dependencies**: `@github/copilot` (128 MB CLI binary), `vscode-jsonrpc`, `zod`
**Critical pattern**: `dist/client.js:32` uses `import.meta.resolve("@github/copilot/sdk")` to locate the CLI binary at runtime.
**How it works**: The Copilot SDK spawns the `@github/copilot` CLI as a child process, communicating via JSON-RPC. The `import.meta.resolve()` call finds the CLI's path in `node_modules`.

**Bundling risk**: `import.meta.resolve("@github/copilot/sdk")` will break when bundled because the `@github/copilot` package won't be in `node_modules/` anymore. However, **our code never uses this codepath** -- the `CopilotSdkAdapter` in `D:/projects/ptah-extension/libs/backend/llm-abstraction/src/lib/services/cli-adapters/copilot-sdk.adapter.ts` passes `cliPath` explicitly to `CopilotClient`, which is found via the `detect()` method (CLI path resolver). When `cliPath` is provided, the SDK skips the `import.meta.resolve()` fallback.

**Evidence**: `copilot-sdk.adapter.ts` always passes `cliPath` from the detection result. The `sdk-resolver.ts` dynamically imports the SDK JS module but never bundles the CLI itself.

**Bundling verdict**: SAFE TO BUNDLE. The CLI binary is user-installed and found via detect(). Only the SDK's JS API (230 KB) gets bundled. The `import.meta.resolve("@github/copilot/sdk")` is dead code in our usage because `cliPath` is always provided.

#### 3. Codex SDK (`@openai/codex-sdk`)

**Entry point**: `dist/index.js` (463 lines)
**Dependencies**: `@openai/codex` (20 KB wrapper that references platform-specific binary packages)
**Critical pattern**: Uses `createRequire(import.meta.url)` to create a `moduleRequire`, then calls `moduleRequire.resolve("@openai/codex/package.json")` to find the CLI binary path.
**How it works**: `findCodexPath()` resolves the Codex CLI binary from the `@openai/codex-{platform}` optional dependency package.

**Bundling risk**: Similar to Copilot -- `moduleRequire.resolve("@openai/codex/package.json")` will fail when `@openai/codex` isn't in `node_modules/`. However, our `CodexCliAdapter` passes `codexPathOverride` to the `Codex` constructor, which skips `findCodexPath()` entirely.

**Evidence**: `codex-cli.adapter.ts` resolves the Codex CLI path via detect() and passes it as `codexPathOverride` to `new Codex({codexPathOverride: ...})`.

**Bundling verdict**: SAFE TO BUNDLE. The CLI path is resolved externally. Only the SDK's JS API (56 KB) gets bundled.

### Current Build Architecture

**Source**: `D:/projects/ptah-extension/apps/ptah-extension-vscode/project.json`

```
esbuild (ESM, node20, bundle=true, thirdParty=true)
  external: [vscode, claude-sdk, copilot-sdk, codex-sdk, tree-sitter-*]
  banner: createRequire(import.meta.url) polyfill
  output: main.mjs (~4 MB without SDKs)

pre-package:
  npm install --omit=dev  --> installs externalized packages into dist/node_modules/

vsce package:
  VSIX = main.mjs + webview/ + node_modules/ (~12.7 MB, 3237 files)
```

**Problem**: `npm install --omit=dev` pulls full SDK packages (47 MB Claude, 128 MB Copilot, etc.) into dist/node_modules/. The `.vscodeignore` strips binaries but leaves thousands of unminified JS files.

### Target Architecture

```
esbuild (ESM, node20, bundle=true, thirdParty=true)
  external: [vscode, tree-sitter, tree-sitter-javascript, tree-sitter-typescript]
  banner: createRequire(import.meta.url) polyfill
  output: main.mjs (~5 MB with SDKs bundled + minified)

pre-package:
  npm install --omit=dev  --> only tree-sitter native modules in dist/node_modules/

vsce package:
  VSIX = main.mjs + webview/ + node_modules/ (tree-sitter only, ~5-6 MB, ~250 files)
```

---

## Risk Analysis

### Risk 1: Claude SDK `import.meta.url` Resolution (LOW)

**Risk**: The Claude SDK uses `import.meta.url` to construct the path to `cli.js`. When bundled, `import.meta.url` points to `main.mjs` in the dist folder, not the SDK's original location.

**Mitigation**: Already handled. The extension passes `pathToClaudeCodeExecutable` in every SDK query call:

- `SdkModuleLoader.getCliJsPath()` (source: `D:/projects/ptah-extension/libs/backend/agent-sdk/src/lib/helpers/sdk-module-loader.ts:177`)
- `PtahCliAdapter.buildQueryOptions()` (source: `D:/projects/ptah-extension/libs/backend/agent-sdk/src/lib/ptah-cli/ptah-cli-adapter.ts:922`)
- `PtahCliRegistry.spawnAgent()` (source: `D:/projects/ptah-extension/libs/backend/agent-sdk/src/lib/ptah-cli/ptah-cli-registry.ts:625`)
- `InternalQueryService.execute()` (source: `D:/projects/ptah-extension/libs/backend/agent-sdk/src/lib/internal-query/internal-query.service.ts:131`)

**Residual risk**: None -- `pathToClaudeCodeExecutable` is explicitly set everywhere.

### Risk 2: Claude SDK `require("ajv/...")` Calls (LOW)

**Risk**: The minified `sdk.mjs` uses CJS `require()` for five `ajv` and `ajv-formats` sub-paths. These are wrapped in the esbuild banner's `createRequire(import.meta.url)` polyfill.

**Mitigation**: esbuild will statically resolve these `require()` calls and inline the ajv modules into the bundle. The `ajv` package is installed as a transitive dependency.

**Verification**: After bundling, check that the output doesn't contain unresolved `require("ajv/...")` calls. If esbuild can't resolve them (unlikely), add an esbuild plugin to alias them.

### Risk 3: Copilot SDK `import.meta.resolve()` (LOW)

**Risk**: `@github/copilot-sdk/dist/client.js:32` calls `import.meta.resolve("@github/copilot/sdk")` to find the CLI binary.

**Mitigation**: This code path is only reached when `cliPath` is not provided to `CopilotClient`. Our `CopilotSdkAdapter` always provides `cliPath` from the CLI detection system. The fallback code becomes dead code.

**Residual risk**: If esbuild chokes on `import.meta.resolve()` during bundling (not a runtime issue, but a static analysis issue), we can suppress it with an esbuild plugin that replaces the call with a no-op fallback. However, `import.meta.resolve()` is valid ESM syntax that esbuild should pass through.

### Risk 4: Codex SDK `createRequire(import.meta.url).resolve()` (LOW)

**Risk**: `@openai/codex-sdk/dist/index.js` creates a `moduleRequire` from `import.meta.url` and calls `moduleRequire.resolve("@openai/codex/package.json")`.

**Mitigation**: This is inside `findCodexPath()` which is only called when `codexPathOverride` is not set. Our `CodexCliAdapter` always provides `codexPathOverride`. The resolution logic becomes dead code.

**Residual risk**: At runtime, if `findCodexPath()` were somehow called, it would throw "Unable to locate Codex CLI binaries" -- but this path is never taken in our code.

### Risk 5: Copilot SDK Dependency on `vscode-jsonrpc` (LOW)

**Risk**: `@github/copilot-sdk` depends on `vscode-jsonrpc` which is imported at the top of `client.js`. This needs to be bundled too.

**Mitigation**: `vscode-jsonrpc` is a pure JS package (no native bindings). esbuild will bundle it since `thirdParty: true` is set and it's not in the `external` array. Already installed as a transitive dependency.

### Risk 6: ESM/CJS Interop (LOW)

**Risk**: All three SDKs are `"type": "module"` (ESM). The extension outputs ESM (`main.mjs`). No interop concern.

**Mitigation**: esbuild handles ESM-to-ESM bundling natively. The `createRequire` banner polyfill handles the few CJS `require()` calls inside the Claude SDK (for ajv).

### Risk 7: Bundle Size Increase (LOW)

**Risk**: Bundling three SDKs increases `main.mjs` size.

**Estimated impact**:

- Claude SDK `sdk.mjs`: +608 KB (already minified by Anthropic)
- Copilot SDK `dist/`: +230 KB (will be minified by esbuild)
- Codex SDK `dist/`: +56 KB (will be minified by esbuild)
- `ajv` + `ajv-formats`: ~100 KB minified
- `vscode-jsonrpc`: ~50 KB minified
- **Total increase**: ~1 MB to `main.mjs`

**Net VSIX impact**: +1 MB to bundle, -8 MB from removing `node_modules/` = **net reduction of ~7 MB** in VSIX size.

### Risk 8: `SdkModuleLoader.resolveAndImportSdk()` Becomes Dead Code (NONE)

**Impact**: The entire `resolveAndImportSdk()` method in `SdkModuleLoader` exists only because the SDK was external. When bundled, `import('@anthropic-ai/claude-agent-sdk')` succeeds immediately (resolved at bundle time). The CLI binary fallback path is never needed.

**Decision**: Remove the runtime resolution logic and simplify to a direct import. This eliminates ~200 lines of dead code.

---

## Implementation Steps

### Phase 1: esbuild Configuration Change

**File**: `D:/projects/ptah-extension/apps/ptah-extension-vscode/project.json`

**Change**: Remove the three SDK packages from the `external` array.

```json
// BEFORE (line 35-43)
"external": [
  "vscode",
  "@anthropic-ai/claude-agent-sdk",
  "@github/copilot-sdk",
  "@openai/codex-sdk",
  "tree-sitter",
  "tree-sitter-javascript",
  "tree-sitter-typescript"
]

// AFTER
"external": [
  "vscode",
  "tree-sitter",
  "tree-sitter-javascript",
  "tree-sitter-typescript"
]
```

**Rationale**: With SDKs no longer external, esbuild will resolve and inline their JS code into `main.mjs`. The banner's `createRequire(import.meta.url)` polyfill handles the ajv CJS `require()` calls inside Claude SDK.

### Phase 2: Simplify SDK Module Loader (Dead Code Removal)

**File**: `D:/projects/ptah-extension/libs/backend/agent-sdk/src/lib/helpers/sdk-module-loader.ts`

**Change**: The entire runtime resolution dance (`resolveAndImportSdk()`, `findPackageFromBinary()`, `dynamicImport()`) is dead code when the SDK is bundled. Simplify `getQueryFunction()` to directly import the SDK.

**Before (simplified)**:

```typescript
// 310 lines of runtime SDK resolution with CLI binary fallback
private async resolveAndImportSdk(): Promise<Record<string, unknown>> {
  // Attempt 1: Standard Node.js module resolution
  // Attempt 2: Resolve from Claude CLI binary's install tree
  // Throw descriptive error
}
```

**After**:

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';

// In getQueryFunction():
async getQueryFunction(): Promise<QueryFunction> {
  if (this.cachedSdkQuery) {
    return this.cachedSdkQuery;
  }
  this.cachedSdkQuery = query as QueryFunction;
  return this.cachedSdkQuery;
}
```

**Specific removals**:

- Remove `dynamicImport()` helper function (lines 36-38)
- Remove `findPackageFromBinary()` helper function (lines 50-73)
- Remove `resolveAndImportSdk()` method (lines 228-310)
- Simplify `getQueryFunction()` to use a static import
- Remove `SDK_PACKAGE_NAME` constant (line 29)
- Remove unused imports: `realpathSync`, `existsSync` from `fs`; `dirname`, `join`, `sep` from `path`; `pathToFileURL` from `url`

**Note**: Keep `getCliJsPath()` and `preload()` -- they are still used for `pathToClaudeCodeExecutable` resolution.

### Phase 3: Simplify SDK Resolver (Dead Code Removal)

**File**: `D:/projects/ptah-extension/libs/backend/llm-abstraction/src/lib/services/cli-adapters/sdk-resolver.ts`

**Change**: The `resolveAndImportSdk()` function and `findPackageFromBinary()` helper exist for the same reason -- runtime SDK discovery. When SDKs are bundled, the bare `import()` always succeeds.

**Before**:

```typescript
// 107 lines of runtime resolution with CLI binary fallback
export async function resolveAndImportSdk<T>(packageName: string, cliBinaryPath?: string): Promise<T> {
  // Attempt 1: Standard Node.js module resolution
  // Attempt 2: Resolve from CLI binary's install tree
  // Throw descriptive error
}
```

**After**: Since both `copilot-sdk.adapter.ts` and `codex-cli.adapter.ts` call `resolveAndImportSdk()`, simplify to a pass-through dynamic import:

```typescript
/**
 * Import an SDK package. With esbuild bundling, the package is resolved
 * at bundle time and the dynamic import() returns the bundled module.
 *
 * The cliBinaryPath parameter is retained for API compatibility but unused.
 */
export async function resolveAndImportSdk<T>(packageName: string, _cliBinaryPath?: string): Promise<T> {
  return (await import(packageName)) as T;
}
```

**Specific removals**:

- Remove `findPackageFromBinary()` function (lines 83-106)
- Remove `dynamicImport()` wrapper (lines 21-23)
- Remove unused imports: `realpathSync`, `existsSync` from `fs`; `dirname`, `join`, `sep` from `path`; `pathToFileURL` from `url`

**Alternative**: If the adapters are the only callers, inline the `import()` and delete `sdk-resolver.ts` entirely. Check callers first.

### Phase 4: Extension package.json Dependency Cleanup

**File**: `D:/projects/ptah-extension/apps/ptah-extension-vscode/package.json`

**Change**: Remove the SDK packages from `dependencies`. They are now bundled into `main.mjs` and don't need to be installed via `npm install --omit=dev` during packaging.

```json
// BEFORE (lines 564-571)
"dependencies": {
  "@anthropic-ai/claude-agent-sdk": "^0.2.81",
  "@github/copilot-sdk": "^0.1.25",
  "@openai/codex-sdk": "^0.104.0",
  "tree-sitter": "^0.21.1",
  "tree-sitter-javascript": "^0.23.1",
  "tree-sitter-typescript": "^0.23.2"
}

// AFTER
"dependencies": {
  "tree-sitter": "^0.21.1",
  "tree-sitter-javascript": "^0.23.1",
  "tree-sitter-typescript": "^0.23.2"
}
```

**Why**: The extension `package.json` (the one in the dist output, not the root workspace) lists `dependencies` that `npm install --omit=dev` resolves during `pre-package`. By removing SDK packages here, `npm install` only installs tree-sitter native modules.

**IMPORTANT**: The SDKs must remain in the root workspace `package.json` (not changed) so they are available at build time for esbuild to bundle.

### Phase 5: Simplify .vscodeignore

**File**: `D:/projects/ptah-extension/apps/ptah-extension-vscode/.vscodeignore`

**Change**: Remove the SDK-specific exclusion rules (lines 79-96) since those packages will no longer be in `node_modules/`.

```
# REMOVE these blocks (lines 79-96):

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

**Also remove** the generic `node_modules/` trimming rules (lines 44-70) if `node_modules/` will only contain tree-sitter. Actually, keep them as defensive safety -- they're harmless and protect against future dependency additions.

### Phase 6: Verify esbuild Handles `import.meta.resolve()` and `createRequire()`

**Potential issue**: esbuild may warn or error on `import.meta.resolve("@github/copilot/sdk")` inside `@github/copilot-sdk/dist/client.js` during bundling.

**Investigation needed during implementation**:

1. Run `nx build ptah-extension-vscode` and check for esbuild warnings
2. If esbuild replaces `import.meta.resolve()` (which it shouldn't for target=node20), we need to preserve it
3. If esbuild errors on the unresolvable package path, add it as an external or use a plugin

**Likely outcomes**:

- esbuild passes `import.meta.resolve()` through untouched (it's a runtime API, not a static import) -- **most likely**
- esbuild tries to resolve `@github/copilot/sdk` and warns it can't find it -- add `@github/copilot` to externals (it's the CLI binary, not needed at build time)
- esbuild fails entirely -- use `logOverride` to suppress the warning

**Fallback**: If `@github/copilot` or `@openai/codex` cause build failures (because they are dependencies of the SDKs and esbuild tries to resolve them), add ONLY the CLI binary packages to externals:

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

This keeps the JS SDK APIs bundled while externalizing the CLI binary references that are resolved at runtime. These packages would NOT be in the VSIX -- they're user-installed.

---

## Verification Strategy

### Build Verification

```bash
# 1. Build the extension
nx build ptah-extension-vscode

# 2. Check bundle output exists and size
ls -la dist/apps/ptah-extension-vscode/main.mjs
# Expected: ~5-6 MB (up from ~4 MB due to bundled SDKs)

# 3. Verify SDKs are bundled (not external imports)
grep -c "@anthropic-ai/claude-agent-sdk" dist/apps/ptah-extension-vscode/main.mjs
# Expected: 0 (bare import should not appear; code is inlined)

grep -c "@github/copilot-sdk" dist/apps/ptah-extension-vscode/main.mjs
# Expected: 0

grep -c "@openai/codex-sdk" dist/apps/ptah-extension-vscode/main.mjs
# Expected: 0

# 4. Verify tree-sitter still external
grep -c "tree-sitter" dist/apps/ptah-extension-vscode/main.mjs
# Expected: > 0 (external imports remain)

# 5. Verify ajv is bundled (not unresolved require)
grep "require.*ajv" dist/apps/ptah-extension-vscode/main.mjs
# Expected: 0 (ajv should be inlined, not dynamic require)
```

### Package Verification

```bash
# 1. Run pre-package (installs only tree-sitter to node_modules)
nx run ptah-extension-vscode:pre-package

# 2. Check node_modules contents
ls dist/apps/ptah-extension-vscode/node_modules/
# Expected: ONLY tree-sitter-related packages (no @anthropic-ai, @github, @openai)

# 3. Package VSIX
cd dist/apps/ptah-extension-vscode && npx @vscode/vsce package --allow-missing-repository --allow-star-activation

# 4. Check VSIX size
ls -la *.vsix
# Expected: < 6 MB (target: ~5 MB)

# 5. List VSIX contents to verify no SDK node_modules
npx @vscode/vsce ls | grep -i "anthropic\|copilot-sdk\|codex-sdk"
# Expected: no results

# 6. Count files in VSIX
npx @vscode/vsce ls | wc -l
# Expected: ~200-300 files (down from ~3237)
```

### VSIX Size Targets

| Metric        | Current             | Target                   | Maximum |
| ------------- | ------------------- | ------------------------ | ------- |
| main.mjs      | ~4 MB               | ~5 MB                    | 7 MB    |
| node_modules/ | ~56 MB uncompressed | tree-sitter only (~2 MB) | 5 MB    |
| VSIX total    | 12.7 MB             | ~5 MB                    | 6 MB    |
| File count    | ~3237               | ~250                     | 500     |

### Runtime Testing Checklist

- [ ] Extension activates without errors in clean VS Code install
- [ ] SDK preload succeeds during activation (`[SdkModuleLoader] SDK pre-loaded successfully`)
- [ ] Chat session works (Claude Agent SDK query function operates correctly)
- [ ] Setup wizard analysis works (InternalQueryService fires successfully)
- [ ] Ptah CLI agents work (PtahCliRegistry.spawnAgent with third-party providers)
- [ ] Session import works (SessionImporterService reads existing sessions)
- [ ] Session history replay works (SessionHistoryReaderService loads JSONL files)
- [ ] Copilot SDK adapter initializes when Copilot CLI is installed
- [ ] Codex SDK adapter initializes when Codex CLI is installed
- [ ] `pathToClaudeCodeExecutable` resolves correctly (check output channel logs)
- [ ] No "module not found" errors in Extension Host output
- [ ] No marketplace scanner warnings from `vsce ls`

---

## Rollback Plan

### Quick Revert

If bundling causes runtime issues, revert with a single commit that restores:

1. **`project.json`**: Add SDKs back to `external` array
2. **`package.json`**: Add SDKs back to `dependencies`
3. **`.vscodeignore`**: Re-add SDK binary exclusion rules
4. **`sdk-module-loader.ts`**: `git checkout` to restore runtime resolution
5. **`sdk-resolver.ts`**: `git checkout` to restore runtime resolution

All changes are contained in 5 files. No database migrations, no API changes, no protocol changes. Pure build/packaging concern.

### Partial Rollback

If only one SDK causes issues, re-externalize just that SDK:

```json
"external": [
  "vscode",
  "@github/copilot-sdk",  // <-- re-externalize if Copilot causes issues
  "tree-sitter",
  "tree-sitter-javascript",
  "tree-sitter-typescript"
]
```

And add it back to extension `package.json` dependencies + `.vscodeignore` exclusions.

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: backend-developer

**Rationale**:

- All changes are in build configuration (`project.json`) and backend services (`sdk-module-loader.ts`, `sdk-resolver.ts`)
- No frontend/UI changes
- Requires understanding of Node.js module resolution, ESM/CJS interop, and esbuild behavior
- Requires careful verification of bundled output

### Complexity Assessment

**Complexity**: MEDIUM
**Estimated Effort**: 2-4 hours

**Breakdown**:

- Phase 1 (esbuild config): 10 minutes
- Phase 2 (sdk-module-loader simplification): 30 minutes
- Phase 3 (sdk-resolver simplification): 20 minutes
- Phase 4 (package.json cleanup): 5 minutes
- Phase 5 (.vscodeignore cleanup): 10 minutes
- Phase 6 (build verification and troubleshooting): 1-2 hours
- Runtime testing: 30-60 minutes

### Files Affected Summary

**MODIFY** (5 files):

1. `D:/projects/ptah-extension/apps/ptah-extension-vscode/project.json` -- Remove 3 items from external array
2. `D:/projects/ptah-extension/libs/backend/agent-sdk/src/lib/helpers/sdk-module-loader.ts` -- Simplify to static import, remove ~200 lines
3. `D:/projects/ptah-extension/libs/backend/llm-abstraction/src/lib/services/cli-adapters/sdk-resolver.ts` -- Simplify to pass-through import, remove ~80 lines
4. `D:/projects/ptah-extension/apps/ptah-extension-vscode/package.json` -- Remove 3 SDK dependencies
5. `D:/projects/ptah-extension/apps/ptah-extension-vscode/.vscodeignore` -- Remove ~18 lines of SDK exclusion rules

### Critical Verification Points

**Before Implementation, Developer Must Verify**:

1. **Build succeeds with no esbuild errors/warnings about unresolvable modules**
   - If `@github/copilot` or `@openai/codex` cause resolution errors, add them (the CLI packages, not the SDK packages) to externals

2. **The `createRequire` banner polyfill handles ajv `require()` calls in Claude SDK**
   - Evidence: Banner at `project.json:32`: `"js": "import { createRequire } from 'module'; const require = createRequire(import.meta.url);"`
   - The Claude SDK's `require("ajv/...")` calls will use this polyfilled `require`

3. **`import.meta.url` in bundled code points to the correct location**
   - In the bundled `main.mjs`, `import.meta.url` will be the file URL of `dist/apps/ptah-extension-vscode/main.mjs`
   - This affects `createRequire(import.meta.url)` -- the require will resolve from the dist directory
   - Since tree-sitter is the only remaining node_modules dependency and it's resolved via Node.js resolution, this is fine

4. **`pathToClaudeCodeExecutable` is set in ALL query call sites**
   - Already verified in Risk Analysis. All four call sites pass the resolved CLI path.

### Architecture Delivery Checklist

- [x] All components specified with evidence
- [x] All patterns verified from codebase
- [x] All imports/APIs verified as existing
- [x] Quality requirements defined (VSIX size targets)
- [x] Integration points documented
- [x] Files affected list complete
- [x] Developer type recommended (backend-developer)
- [x] Complexity assessed (MEDIUM, 2-4 hours)
- [x] Rollback plan defined
- [x] No step-by-step implementation (team-leader decomposes)
