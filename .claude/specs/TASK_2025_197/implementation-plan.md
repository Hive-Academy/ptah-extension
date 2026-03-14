# Implementation Plan - TASK_2025_197

## Remove @github/copilot-sdk and @openai/codex-sdk from Extension Bundle

### Problem Statement

The extension currently bundles `@github/copilot-sdk` (with its 103MB `@github/copilot` transitive dep) and `@openai/codex-sdk` into the webpack output. These inflate the extension's `.vsix` package size enormously. Since these are optional provider SDKs (users may not use Copilot or Codex at all), they should be discovered from the user's system at runtime, not shipped with the extension.

---

## Codebase Investigation Summary

### Current Bundling Architecture

**Webpack config** (`apps/ptah-extension-vscode/webpack.config.js:56-67`):

- Lines 56-61: `@github/copilot*` packages are bundled (matched by `request.startsWith('@github/copilot')`)
- Lines 63-67: `@openai/codex-sdk` is bundled (matched by `request.startsWith('@openai/codex-sdk')`)
- Lines 50-54: `@anthropic-ai/claude-agent-sdk` is bundled -- this STAYS bundled (core dependency)

**Root package.json** (`package.json:76,84`):

- `"@github/copilot-sdk": "^0.1.25"` -- listed as dependency
- `"@openai/codex-sdk": "^0.104.0"` -- listed as dependency

**Extension package.json** (`apps/ptah-extension-vscode/package.json`):

- Neither SDK is listed here (no changes needed to extension manifest)

### Current Dynamic Import Pattern

Both adapters already use dynamic `import()` -- they do NOT statically import the SDKs:

**Copilot SDK adapter** (`libs/backend/llm-abstraction/src/lib/services/cli-adapters/copilot-sdk.adapter.ts:844-846`):

```typescript
const sdkModule = (await import('@github/copilot-sdk')) as unknown as CopilotSdkModule;
```

Called in `ensureClient()` method.

**Codex SDK adapter** (`libs/backend/llm-abstraction/src/lib/services/cli-adapters/codex-cli.adapter.ts:147-162`):

```typescript
async function getCodexSdk(): Promise<CodexSdkModule> {
  const mod = (await import('@openai/codex-sdk')) as CodexSdkModule;
  codexSdkModule = mod; // cached
  return mod;
}
```

Called via `getCodexSdk()` helper.

### Local Type Mirrors (KEEP)

Both adapters define comprehensive local TypeScript interfaces that mirror the SDK types:

- **Copilot**: Lines 56-214 define `SdkClientOptions`, `SdkSessionConfig`, `SdkSession`, `SdkClient`, `CopilotSdkModule`, etc.
- **Codex**: Lines 46-131 define `CodexSdkModule`, `CodexClient`, `CodexThread`, `CodexThreadEvent`, etc.

These exist specifically to avoid compile-time ESM/CJS resolution issues and MUST be preserved.

### CLI Detection Service (`libs/backend/llm-abstraction/src/lib/services/cli-detection.service.ts`):

Each adapter has a `detect()` method that checks if the CLI binary is installed (using `resolveCliPath` from `cli-adapter.utils.ts:29-35`, which uses the `which` library). Detection is independent of SDK availability -- it checks for the CLI binary, not the SDK package.

### Key Insight: Decoupled Detection vs SDK Usage

The architecture already separates two concerns:

1. **CLI detection** (`detect()`) -- checks if `copilot` or `codex` binary is on PATH
2. **SDK usage** (`runSdk()` / `ensureClient()`) -- dynamically imports the SDK package

This separation means we can make the SDK import gracefully fail without affecting detection.

---

## Architecture Design

### Approach: Dynamic Import with Graceful Catch (Simplest, Most Robust)

The adapters already use `await import('@github/copilot-sdk')` and `await import('@openai/codex-sdk')`. When these packages are not bundled by webpack, the dynamic import will attempt Node.js module resolution from:

1. The extension's own `node_modules/` (won't find it -- not shipped)
2. The global `node_modules/` if NODE_PATH is set
3. Standard Node.js module resolution chain

**However**, since VS Code extensions run in a sandboxed Node.js environment, standard global npm installs may not be discoverable. The most reliable approach is:

1. **Try the bare `import()` first** -- this works if the user has the SDK installed in a location Node.js can resolve (e.g., project-local `node_modules`, global with NODE_PATH)
2. **Try resolving from the globally-installed CLI's location** -- the CLI binary (e.g., `copilot`) is installed via npm, and its sibling `node_modules` will contain the SDK. We can compute this path from the detected binary path.
3. **If both fail, mark SDK as unavailable** -- the adapter's `runSdk()` throws a clear error, and the provider is effectively disabled for SDK mode.

### Runtime SDK Resolution Strategy

```
Step 1: await import('@github/copilot-sdk')
  -> Works if: SDK in project node_modules, global NODE_PATH, etc.
  -> Fails with: MODULE_NOT_FOUND

Step 2: Resolve from CLI binary location
  -> CLI path: /usr/local/bin/copilot (symlink to ../lib/node_modules/@github/copilot-sdk/...)
  -> Compute: resolve CLI realpath -> walk up to find node_modules/@github/copilot-sdk
  -> await import(absolutePath)
  -> Works if: SDK was npm-installed globally alongside the CLI

Step 3: Fail gracefully
  -> throw Error("@github/copilot-sdk not found. Install it: npm install -g @github/copilot-sdk")
```

### Why This Approach

- **No new dependencies**: Uses Node.js built-in `fs.realpathSync`, `path.dirname`, standard `import()`
- **Matches existing pattern**: Both adapters already use dynamic import with error handling
- **Minimal code changes**: Only the import call sites need wrapping
- **CLI path available**: `detect()` already resolves the binary path, which is passed to `ensureClient()`/`runSdk()` via `options.binaryPath`

---

## Component Specifications

### Component 1: SDK Runtime Resolver Utility

**Purpose**: Centralized utility to resolve ESM-only SDK packages at runtime from user-installed locations.

**File**: `libs/backend/llm-abstraction/src/lib/services/cli-adapters/sdk-resolver.ts` (CREATE)

**Responsibilities**:

- Try bare `import(specifier)` first (standard Node.js resolution)
- Fall back to resolving from the CLI binary's install location
- Return the loaded module or throw a descriptive error
- Cache successful resolution paths for subsequent imports

**Implementation Pattern**:

```typescript
import { realpathSync } from 'fs';
import { dirname, join, sep } from 'path';

/**
 * Resolve and dynamically import an ESM-only SDK package that is NOT bundled
 * with the extension. Tries standard Node.js resolution first, then falls
 * back to locating the package relative to the CLI binary's install location.
 *
 * @param packageName - npm package name (e.g., '@github/copilot-sdk')
 * @param cliBinaryPath - Absolute path to the CLI binary (from detect())
 * @returns The loaded module
 * @throws Error with install instructions if the package cannot be found
 */
export async function resolveAndImportSdk<T>(packageName: string, cliBinaryPath?: string): Promise<T> {
  // Attempt 1: Standard Node.js module resolution
  try {
    return (await import(packageName)) as T;
  } catch {
    // MODULE_NOT_FOUND -- expected when not bundled
  }

  // Attempt 2: Resolve from CLI binary's install tree
  if (cliBinaryPath) {
    const sdkPath = findPackageFromBinary(cliBinaryPath, packageName);
    if (sdkPath) {
      try {
        return (await import(sdkPath)) as T;
      } catch {
        // Found the path but import failed -- fall through to error
      }
    }
  }

  // All attempts failed
  throw new Error(`${packageName} is not installed. ` + `Install it globally: npm install -g ${packageName}`);
}

/**
 * Given a CLI binary path (possibly a symlink), resolve the real path
 * and walk up the directory tree to find the SDK package in a sibling
 * node_modules directory.
 */
function findPackageFromBinary(binaryPath: string, packageName: string): string | null {
  try {
    const realPath = realpathSync(binaryPath);
    let dir = dirname(realPath);

    // Walk up looking for node_modules/<packageName>
    // Stop at filesystem root
    const root = dir.substring(0, dir.indexOf(sep) + 1) || sep;
    while (dir !== root) {
      const candidate = join(dir, 'node_modules', packageName);
      try {
        // Check if package.json exists in the candidate
        realpathSync(join(candidate, 'package.json'));
        return candidate;
      } catch {
        // Not found at this level, go up
      }
      dir = dirname(dir);
    }
  } catch {
    // realpathSync failed -- binary path invalid
  }
  return null;
}
```

**Evidence**:

- `resolveCliPath()` in `cli-adapter.utils.ts:29-35` uses `which` to find CLI binaries -- the resolved path is passed as `options.binaryPath` to adapter methods
- Both adapters receive `binaryPath` in their `runSdk()`/`ensureClient()` methods (copilot: line 834, codex: line 481-486)
- The `which` library resolves symlinks by default, but we use `realpathSync` for robustness

### Component 2: Copilot SDK Adapter Changes

**File**: `libs/backend/llm-abstraction/src/lib/services/cli-adapters/copilot-sdk.adapter.ts` (MODIFY)

**Changes**:

1. Import `resolveAndImportSdk` from `./sdk-resolver`
2. Replace the bare `import('@github/copilot-sdk')` in `ensureClient()` (line 844-846) with `resolveAndImportSdk<CopilotSdkModule>('@github/copilot-sdk', binaryPath)`
3. Update the error message to include install instructions

**Current code** (line 844-846):

```typescript
const sdkModule = (await import('@github/copilot-sdk')) as unknown as CopilotSdkModule;
```

**New code**:

```typescript
import { resolveAndImportSdk } from './sdk-resolver';

// In ensureClient():
const sdkModule = await resolveAndImportSdk<CopilotSdkModule>('@github/copilot-sdk', binaryPath);
```

### Component 3: Codex SDK Adapter Changes

**File**: `libs/backend/llm-abstraction/src/lib/services/cli-adapters/codex-cli.adapter.ts` (MODIFY)

**Changes**:

1. Import `resolveAndImportSdk` from `./sdk-resolver`
2. Replace the `getCodexSdk()` function (lines 147-162) to use `resolveAndImportSdk`
3. The function already caches the module (`codexSdkModule` variable on line 137) -- preserve this pattern
4. Pass `binaryPath` through: `getCodexSdk()` needs access to the CLI binary path for fallback resolution. Since `runSdk()` has `options.binaryPath`, pass it as a parameter.

**Current code** (lines 147-162):

```typescript
async function getCodexSdk(): Promise<CodexSdkModule> {
  if (codexSdkModule) return codexSdkModule;
  try {
    const mod = (await import('@openai/codex-sdk')) as CodexSdkModule;
    codexSdkModule = mod;
    return mod;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load @openai/codex-sdk: ${message}. ` + `Ensure the package is installed: npm install @openai/codex-sdk`);
  }
}
```

**New code**:

```typescript
import { resolveAndImportSdk } from './sdk-resolver';

async function getCodexSdk(binaryPath?: string): Promise<CodexSdkModule> {
  if (codexSdkModule) return codexSdkModule;
  const mod = await resolveAndImportSdk<CodexSdkModule>('@openai/codex-sdk', binaryPath);
  codexSdkModule = mod;
  return mod;
}
```

Update the call site in `runSdk()` (line 446):

```typescript
// Before:
const sdk = await getCodexSdk();
// After:
const sdk = await getCodexSdk(options.binaryPath);
```

### Component 4: Webpack Configuration Changes

**File**: `apps/ptah-extension-vscode/webpack.config.js` (MODIFY)

**Changes**:

1. Remove lines 56-67 (the `@github/copilot` and `@openai/codex-sdk` bundling rules)
2. These packages will now fall through to the "externalize scoped packages" rule on line 76-78, which marks them as `commonjs` externals
3. However, since we want the dynamic import to fail cleanly at runtime (not try to require a non-existent commonjs module), we should let them hit the externals rule -- the `import()` in our resolver will handle the MODULE_NOT_FOUND gracefully

**Current lines to REMOVE** (56-67):

```javascript
// Bundle @github/copilot-sdk and @github/copilot - both ESM-only
if (request.startsWith('@github/copilot')) {
  return callback(); // Bundle it
}

// Bundle @openai/codex-sdk - ESM-only
if (request.startsWith('@openai/codex-sdk')) {
  return callback(); // Bundle it
}
```

**Important**: After removing these lines, `@github/copilot*` and `@openai/codex-sdk` will match the catch-all rule on line 76: `if (request.startsWith('@'))` which externalizes them as `commonjs`. This means webpack will emit `require('@github/copilot-sdk')` calls. But since our code uses `await import()` which webpack transforms, we need to ensure webpack doesn't transform the dynamic imports for these specific packages.

**Actually**, the cleaner approach: The adapters use `await import('@github/copilot-sdk')`. Webpack will see this and either:

- If the package is set to "bundle", webpack resolves and bundles it
- If the package is externalized, webpack emits `require()` or `import()` for it

Since we want the import to happen at runtime (not bundle time), externalizing is correct. When the package isn't installed in the extension's `node_modules`, the `require()` will throw, which our `resolveAndImportSdk` catches and retries with an absolute path.

**However**, there's a subtlety: our `resolveAndImportSdk` uses `import(packageName)` which webpack will transform into its own module resolution. To prevent webpack from touching the dynamic import in `sdk-resolver.ts`, we can use a webpack-opaque pattern:

```typescript
// Prevent webpack from transforming this import
const dynamicImport = new Function('specifier', 'return import(specifier)');
return (await dynamicImport(packageName)) as T;
```

This ensures the import happens purely at Node.js runtime, bypassing webpack's module resolution entirely.

**Updated webpack changes**:

1. Remove the copilot/codex bundling rules (lines 56-67)
2. No need to add new externals rules -- the packages simply won't be referenced in the bundle at all, because `sdk-resolver.ts` uses runtime-only `import()` via `new Function`

### Component 5: Root package.json Cleanup (Optional)

**File**: `package.json` (MODIFY)

**Decision**: Keep the dependencies in root `package.json` for now. They are needed for:

- TypeScript compilation (the local type mirrors reference SDK types in comments)
- Development/testing (developers may want to test with the SDKs installed locally)
- The `npm install` in CI still installs them, but they won't be bundled

If extension size is still a concern after removing from the bundle, these can be moved to `devDependencies` in a follow-up task.

---

## Ordered Implementation Tasks

### Task 1: Create SDK Runtime Resolver Utility

**File**: `libs/backend/llm-abstraction/src/lib/services/cli-adapters/sdk-resolver.ts` (CREATE)
**Description**: Create `resolveAndImportSdk()` function and `findPackageFromBinary()` helper
**Verification**: File compiles, unit test passes with mocked imports

### Task 2: Update Codex SDK Adapter

**File**: `libs/backend/llm-abstraction/src/lib/services/cli-adapters/codex-cli.adapter.ts` (MODIFY)
**Description**:

- Import `resolveAndImportSdk` from `./sdk-resolver`
- Rewrite `getCodexSdk()` to accept `binaryPath` param and use `resolveAndImportSdk`
- Update call site in `runSdk()` to pass `options.binaryPath`
  **Verification**: TypeScript compiles, existing Codex tests still pass

### Task 3: Update Copilot SDK Adapter

**File**: `libs/backend/llm-abstraction/src/lib/services/cli-adapters/copilot-sdk.adapter.ts` (MODIFY)
**Description**:

- Import `resolveAndImportSdk` from `./sdk-resolver`
- Replace `import('@github/copilot-sdk')` in `ensureClient()` with `resolveAndImportSdk<CopilotSdkModule>('@github/copilot-sdk', binaryPath)`
  **Verification**: TypeScript compiles, existing Copilot tests still pass

### Task 4: Update Webpack Configuration

**File**: `apps/ptah-extension-vscode/webpack.config.js` (MODIFY)
**Description**: Remove the bundling rules for `@github/copilot*` and `@openai/codex-sdk` (lines 56-67)
**Verification**: `npm run build:all` succeeds, output bundle does NOT contain copilot/codex SDK code

### Task 5: Verify Bundle Size Reduction

**Description**: Build the extension and compare bundle size before/after
**Verification**: `main.js` bundle is significantly smaller (expect ~100MB+ reduction from @github/copilot native prebuilds)

---

## Risk Assessment

### Low Risk

- **Local type mirrors already exist**: Both adapters define their own TypeScript interfaces. No compile-time dependency on the SDK packages.
- **Dynamic imports already used**: The code paths already use `await import()`, so the change is minimal.
- **Detection is independent**: `detect()` checks for the CLI binary on PATH, not the SDK package. Detection continues to work regardless of SDK availability.

### Medium Risk

- **Webpack `import()` transformation**: Webpack may transform `import('packageName')` into its own `__webpack_require__` call, which would fail differently than a standard Node.js MODULE_NOT_FOUND. Mitigation: Use `new Function('specifier', 'return import(specifier)')` to create a webpack-opaque dynamic import.
- **Node.js ESM/CJS interop at runtime**: The SDKs are ESM-only (`"type": "module"`). When loaded via dynamic `import()` at runtime (not bundled), Node.js must handle ESM loading. In Node.js 18+, `import()` of ESM packages works from CJS contexts. VS Code extensions run on Node.js 18+, so this should work. Mitigation: Test with actual globally-installed SDKs.

### Low-Medium Risk

- **Path resolution on Windows**: npm global installs on Windows use `.cmd` wrapper scripts. `realpathSync` on the `.cmd` file may not resolve to the actual JS entry point. Mitigation: The `findPackageFromBinary` function walks up the directory tree from the binary's real path, so even if the resolved path is the `.cmd` file's location, the walk-up will find `node_modules` in the npm prefix directory. Also, `resolveCliPath` already handles Windows paths via the `which` library.
- **npm global install locations vary**: `npm root -g` can be in different locations depending on OS and nvm/fnm usage. Mitigation: Walking up from the binary's real path handles all cases because npm symlinks binaries from the global `bin/` to the package in global `lib/node_modules/`.

### Negligible Risk

- **Users without SDKs installed**: The adapters already handle SDK unavailability gracefully. The `detect()` method checks for the CLI binary, and if the binary is found but the SDK can't be loaded, `runSdk()` will throw a descriptive error that surfaces in the UI. This is the expected behavior -- users must install the SDK to use that provider.

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: backend-developer
**Rationale**:

- All changes are in Node.js backend code (webpack config, TypeScript adapters)
- Requires understanding of Node.js module resolution, ESM/CJS interop, webpack externals
- No frontend/UI changes

### Complexity Assessment

**Complexity**: LOW-MEDIUM
**Estimated Effort**: 2-3 hours

### Files Affected Summary

**CREATE**:

- `libs/backend/llm-abstraction/src/lib/services/cli-adapters/sdk-resolver.ts`

**MODIFY**:

- `libs/backend/llm-abstraction/src/lib/services/cli-adapters/codex-cli.adapter.ts`
- `libs/backend/llm-abstraction/src/lib/services/cli-adapters/copilot-sdk.adapter.ts`
- `apps/ptah-extension-vscode/webpack.config.js`

### Critical Verification Points

1. **Webpack-opaque import**: The `sdk-resolver.ts` MUST use `new Function('specifier', 'return import(specifier)')` to prevent webpack from transforming the dynamic import. If webpack intercepts it, the runtime resolution will not work as intended.

2. **realpathSync availability**: This is a Node.js `fs` built-in, always available in the extension host. No new dependencies needed.

3. **Error message quality**: When SDK is not found, the error message must tell the user exactly what to install: `npm install -g @github/copilot-sdk` or `npm install -g @openai/codex-sdk`.

4. **Caching behavior**: The Codex adapter already caches the loaded module in `codexSdkModule`. The Copilot adapter caches the `client` instance (which internally holds the SDK reference). No additional caching needed in `sdk-resolver.ts` since the callers cache.

### Architecture Delivery Checklist

- [x] All components specified with evidence
- [x] All patterns verified from codebase (dynamic import, resolveCliPath, error handling)
- [x] All imports/decorators verified as existing
- [x] Quality requirements defined
- [x] Integration points documented
- [x] Files affected list complete
- [x] Developer type recommended (backend-developer)
- [x] Complexity assessed (LOW-MEDIUM, 2-3 hours)
- [x] No step-by-step implementation (team-leader decomposes into atomic tasks)
